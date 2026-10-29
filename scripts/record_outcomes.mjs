#!/usr/bin/env node
/**
 * M5-a real run recorder (`T-501`, `docs/specs/M5-reflow.md` §17 item 8).
 *
 * WHAT IT DOES, IN ORDER: enables the local outcome store in an ISOLATED data directory, runs
 * `check` twice and `probe --execute` once through the real CLI (so the records come from the
 * same code path a user hits), reads the store back, purges it, and finally runs `check` once
 * more to prove that a purged store is never silently re-created.
 *
 * WHY AN ISOLATED DATA DIRECTORY: `%LOCALAPPDATA%\\dsh-triage` belongs to the operator, and this
 * script's last step deletes that store. Pointing the children at a fresh temp directory makes
 * the run hermetic: it can never wipe records the operator actually wanted, and "nothing is
 * left afterwards" is a property of the run rather than a hope.
 *
 * WHAT LANDS IN THE ARTIFACT: counts and shapes. NOT the records, NOT the package name, NOT an
 * id, NOT a path. `data/results/**` is published (iron law 5), and a record's key names exactly
 * what the operator judged.
 *
 * WHAT IT ALSO MEASURES: N3. `check --json` is run twice against the same store - once with no
 * prior, once with a prior - and both payloads are hashed. If a prior ever leaked into a
 * verdict, those two hashes would differ, and the artifact would say so.
 *
 *   node scripts/record_outcomes.mjs --stamp 2026-10-30T01:10:00.000Z \
 *     [--package dsh-status-rotator@0.38.0] [--dsh-main <bin.js>] [--out data/results]
 *
 * Requires `pnpm build` (it imports the built store to read the records back).
 * Exit codes: 0 all checks passed and recorded · 1 recorded but a check failed · 2 bad usage.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, fileUrl, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = argOf('--stamp', null)
const stamp = rawStamp === null ? null : isoStamp(String(rawStamp))
if (stamp === null) {
  process.stderr.write('usage: node scripts/record_outcomes.mjs --stamp <ISO> [--package <name@x.y.z>] [--dsh-main <bin.js>] [--out <dir>]\n')
  process.exit(2)
}

const packageSpec = String(argOf('--package', 'dsh-status-rotator@0.38.0'))
const packageName = packageSpec.startsWith('@')
  ? packageSpec.slice(0, packageSpec.indexOf('@', 1) === -1 ? undefined : packageSpec.indexOf('@', 1))
  : packageSpec.split('@')[0]
const dshMain = pathFor(String(argOf('--dsh-main', 'sandbox/upstream/0.2.1-rc.4/install/node_modules/@deepseek-ai/dsh/lib/bin.js')))
const outDir = pathFor(String(argOf('--out', 'data/results')))
const asJson = argv.includes('--json')

const CLI = abs('packages/plugin/dist/cli.js')
const STORE_MODULE = 'packages/plugin/dist/outcomes/store.js'
const CORE_MODULE = 'packages/core/dist/outcome.js'
for (const prerequisite of [CLI, abs(STORE_MODULE), abs(CORE_MODULE)]) {
  if (!existsSync(prerequisite)) {
    process.stderr.write(`${prerequisite} is missing: run \`pnpm build\` first\n`)
    process.exit(2)
  }
}
if (!existsSync(dshMain)) {
  process.stderr.write(`missing DSH launcher at ${dshMain}; pass --dsh-main <path to @deepseek-ai/dsh/lib/bin.js>\n`)
  process.exit(2)
}

const store = await import(fileUrl(STORE_MODULE))

/** A fresh local data directory, so nothing the operator owns can be touched. */
const dataRoot = mkdtempSync(join(tmpdir(), 'triage-outcomes-run-'))
const storeRoot = join(dataRoot, 'dsh-triage')
const storeEnv = process.platform === 'win32' ? { LOCALAPPDATA: dataRoot } : { XDG_DATA_HOME: dataRoot, HOME: dataRoot }

const runs = []
function runCli(id, command, args) {
  const started = Date.now()
  const child = spawnSync(process.execPath, [CLI, ...args], {
    cwd: abs('.'),
    encoding: 'utf8',
    env: { ...process.env, ...storeEnv, DSH_TRIAGE_LOCALE: 'en' },
    timeout: 600_000,
  })
  const ms = Date.now() - started
  const stdout = child.stdout ?? ''
  const stderr = child.stderr ?? ''
  const payload = stdout.trim().startsWith('{') ? safeParse(stdout) : null
  const entry = {
    id,
    // The command shape WITHOUT the package spec: the artifact must not name what was judged.
    command,
    exit: child.status,
    ms,
    payload_sha256: payload === null ? null : sha256(stdout),
    conclusion: payload?.verdict?.conclusion ?? null,
    prior_present: payload === null ? null : Object.hasOwn(payload, 'prior'),
    prior_records: payload?.prior?.n ?? null,
    stdout_empty: stdout.trim() === '',
    stderr_lines: stderr.trim() === '' ? 0 : stderr.trim().split('\n').length,
  }
  runs.push(entry)
  return { entry, payload, stdout, stderr }
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const checks = []
const check = (id, ok, detail) => {
  checks.push({ id, ok: Boolean(ok), detail })
  return ok
}

// 1. Opt in — inside the isolated data directory only.
const enabled = runCli('enable', 'outcomes --enable --json', ['outcomes', '--enable', '--json'])
check('store-enabled', enabled.entry.exit === 0 && enabled.payload?.mode === 'local', `exit ${enabled.entry.exit}`)

// 2. First judgement: nothing stored yet, so there is no prior to show.
const first = runCli('check-a', 'check --json', ['check', packageSpec, '--json', '--stamp', stamp])
check('check-a-produces-a-verdict', first.payload?.verdict !== undefined, `exit ${first.entry.exit}`)
check('check-a-has-no-prior', first.entry.prior_present === false, 'a plain `check --json` never carries a prior block')

// 3. Second judgement of the SAME key: the store now holds a prior. N3 says the payload must be
//    byte-identical to step 2 - a prior is an annotation, not an input.
const second = runCli('check-b', 'check --json', ['check', packageSpec, '--json', '--stamp', stamp])
const byteIdentical = first.entry.payload_sha256 !== null && first.entry.payload_sha256 === second.entry.payload_sha256
check('n3-check-json-byte-identical', byteIdentical, `${first.entry.payload_sha256?.slice(0, 12) ?? '—'} vs ${second.entry.payload_sha256?.slice(0, 12) ?? '—'}`)

// 4. `--explain` is the ONLY place a prior may appear.
const explained = runCli('check-explain', 'check --explain --json', ['check', packageSpec, '--json', '--explain', '--stamp', stamp])
const priorPresent = explained.entry.prior_present === true
const priorCount = explained.payload?.prior?.n ?? null
check('prior-annotation-appears-in-explain', priorPresent, `prior present: ${String(priorPresent)}`)
check('prior-is-annotation-only', explained.payload?.prior?.annotation_only === true, 'annotation_only must be the literal true')
check('prior-note-id', explained.payload?.prior?.note_id === 'prior.annotation-only', String(explained.payload?.prior?.note_id ?? '—'))
check('prior-counts-earlier-measurements', typeof priorCount === 'number' && priorCount >= 1, `n=${String(priorCount)}`)
// The verdict itself is identical to the plain run: the annotation changed nothing.
const explainVerdict = JSON.stringify(explained.payload?.verdict ?? null)
const plainVerdict = JSON.stringify(second.payload?.verdict ?? null)
check('n3-explained-verdict-unchanged', explainVerdict === plainVerdict, 'the verdict with a prior equals the verdict without one')

// 5. One isolated probe run: a record with `source: "probe"` and timing buckets.
const probed = runCli('probe', 'probe --execute --json', ['probe', packageSpec, '--execute', '--dsh-main', dshMain, '--json', '--stamp', stamp])
check('probe-produces-a-verdict', probed.payload?.verdict !== undefined, `exit ${probed.entry.exit}`)

// 6. What the store actually holds — read with the same reader `outcomes --status` uses.
const read = store.readOutcomeRecords(storeRoot)
const status = runCli('status', 'outcomes --status --json', ['outcomes', '--status', '--json'])
check('status-agrees-with-the-library', status.payload?.records === read.records.length, `${String(status.payload?.records)} vs ${read.records.length}`)

const bySource = {}
const byConclusion = {}
const byProfileKind = {}
const tierCounts = {}
const totalBuckets = {}
const bootBuckets = {}
const keyIds = new Set()
let completeKeys = 0
let minLineBytes = null
let maxLineBytes = null
for (const record of read.records) {
  bySource[record.source] = (bySource[record.source] ?? 0) + 1
  byConclusion[record.conclusion] = (byConclusion[record.conclusion] ?? 0) + 1
  byProfileKind[record.profile_kind] = (byProfileKind[record.profile_kind] ?? 0) + 1
  for (const tier of record.evidence_tiers) tierCounts[tier] = (tierCounts[tier] ?? 0) + 1
  if (record.probe !== null) {
    totalBuckets[record.probe.total_ms_bucket] = (totalBuckets[record.probe.total_ms_bucket] ?? 0) + 1
    const boot = record.probe.boot_ms_bucket ?? 'none'
    bootBuckets[boot] = (bootBuckets[boot] ?? 0) + 1
  }
  keyIds.add(JSON.stringify([record.package, record.version, record.dsh_version, record.os, record.arch, record.node_major, record.profile_kind]))
  if (record.dsh_version !== null && record.profile_kind !== 'unknown') completeKeys += 1
  const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8')
  minLineBytes = minLineBytes === null ? bytes : Math.min(minLineBytes, bytes)
  maxLineBytes = maxLineBytes === null ? bytes : Math.max(maxLineBytes, bytes)
}

const storeShapes = {
  records: read.records.length,
  rejected_lines: read.rejected,
  lines: read.lines,
  by_source: sortedObject(bySource),
  by_conclusion: sortedObject(byConclusion),
  by_profile_kind: sortedObject(byProfileKind),
  evidence_tiers: sortedObject(tierCounts),
  probe_total_ms_bucket: sortedObject(totalBuckets),
  probe_boot_ms_bucket: sortedObject(bootBuckets),
  distinct_keys: keyIds.size,
  records_with_complete_key: completeKeys,
  record_bytes: { min: minLineBytes, max: maxLineBytes, cap: 1024 },
}
check('store-has-both-sources', (bySource['check'] ?? 0) >= 1 && (bySource['probe'] ?? 0) >= 1, JSON.stringify(sortedObject(bySource)))
check('every-record-has-a-complete-key', completeKeys === read.records.length, `${completeKeys}/${read.records.length}`)
check('no-record-exceeds-the-byte-cap', maxLineBytes === null || maxLineBytes <= 1024, `max ${String(maxLineBytes)} bytes`)

// 7. Purge: the deletion path must leave nothing behind.
const purged = runCli('purge', 'outcomes --purge --json', ['outcomes', '--purge', '--json', '--stamp', stamp])
const purgeReport = purged.payload
check('purge-deletes-what-was-recorded', purgeReport?.purge?.deleted_records === read.records.length, `${String(purgeReport?.purge?.deleted_records)} vs ${read.records.length}`)
check('purge-removes-the-directory', purgeReport?.purge?.directory_removed === true, String(purgeReport?.purge?.directory_removed))
check('purge-leaves-nothing', Array.isArray(purgeReport?.purge?.remaining) && purgeReport.purge.remaining.length === 0, JSON.stringify(purgeReport?.purge?.remaining ?? null))
check('purge-store-absent', purgeReport?.store_root_exists === false, String(purgeReport?.store_root_exists))
const directoryAfterPurge = existsSync(storeRoot)

// 7b. The same verb a SECOND time, in text mode: this is the output a user pastes into an issue,
//     so it must carry no quote, no separator and no package name (N13), and a repeated purge
//     must be a no-op with exit 0 (N6 idempotency).
const purgeTextRun = runCli('purge-again', 'outcomes --purge', ['outcomes', '--purge', '--stamp', stamp])
const purgeText = purgeTextRun.stdout
check('purge-is-idempotent', purgeTextRun.entry.exit === 0 && /purged\s+0 outcome records/.test(purgeText), `exit ${purgeTextRun.entry.exit}`)
check(
  'purge-output-has-no-data',
  !/"|\\|\//.test(purgeText) && !purgeText.includes(packageName),
  'no quote, no separator, no package name in the human output',
)

// 8. A purged store must not silently come back: `check` writes nothing when the mode is off.
const afterCheck = runCli('check-after-purge', 'check --json', ['check', packageSpec, '--json', '--stamp', stamp])
const statusAfter = runCli('status-after-purge', 'outcomes --status --json', ['outcomes', '--status', '--json'])
check('check-still-works-after-purge', afterCheck.entry.exit === 0, `exit ${afterCheck.entry.exit}`)
check('check-after-purge-writes-nothing', statusAfter.payload?.records === 0 && existsSync(storeRoot) === false, `records ${String(statusAfter.payload?.records)}, dir exists ${String(existsSync(storeRoot))}`)

const passed = checks.every((entry) => entry.ok)
const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_outcomes.mjs',
  generated_at: stamp,
  isolation: {
    mode: 'temp-local-data-directory',
    // Two facts, both machine-checkable after the run: we used a temp dir, and it is gone.
    directory_removed_at_end: !directoryAfterPurge && !existsSync(storeRoot),
    store_root_exists_after_run: existsSync(storeRoot),
  },
  runs,
  n3: {
    plain_runs: ['check-a', 'check-b'],
    byte_identical: byteIdentical,
    payload_sha256: second.entry.payload_sha256,
    explain_run: 'check-explain',
    explain_prior_present: priorPresent,
    explain_prior_n: priorCount,
    explain_verdict_matches_plain: explainVerdict === plainVerdict,
    note: 'a prior is an annotation (ADR-0011 option A): the verdict is identical with and without one, and only `--explain` shows it',
  },
  store_shapes: storeShapes,
  purge: {
    noop: purgeReport?.purge?.noop ?? null,
    deleted_records: purgeReport?.purge?.deleted_records ?? null,
    deleted_files: purgeReport?.purge?.deleted_files ?? null,
    rejected_lines_dropped: purgeReport?.purge?.rejected_lines_dropped ?? null,
    directory_removed: purgeReport?.purge?.directory_removed ?? null,
    remaining: purgeReport?.purge?.remaining ?? null,
    store_root_exists: purgeReport?.store_root_exists ?? null,
  },
  after_purge: {
    check_exit: afterCheck.entry.exit,
    status_records: statusAfter.payload?.records ?? null,
    status_mode: statusAfter.payload?.mode ?? null,
    store_root_exists: existsSync(storeRoot),
  },
  checks,
  passed,
  limits: [
    'this run proves the local half only: nothing was uploaded, aggregated or compared across users (that is a different milestone and a different ADR)',
    'one machine, one runtime, one pinned candidate: the store shapes are not a claim about install or usage volume',
    'the store lived in a temp data directory, so the platform-specific real path was exercised but the directory-permission behaviour of the operator machine was not',
    'D4 is measured by scripts/d4_report.mjs on a library that has existed for a while; this run cannot produce 30 paired keys',
    'a prior is an annotation only (ADR-0011 option A): no conclusion, confidence or evidence tier was changed by this milestone',
  ],
}

const text = `${JSON.stringify(artifact, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const fileName = `outcomes-${stamp.replaceAll(':', '-')}.json`
const target = join(outDir, fileName)
if (existsSync(target)) {
  process.stderr.write(`refusing to overwrite existing evidence: ${join('data/results', fileName)}\n`)
  process.exit(2)
}
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, sha256(text), 'utf8')

// The isolated data directory is removed whether or not the run passed: a failed run must not
// leave a library behind that the next run would then read as a prior.
rmSync(dataRoot, { recursive: true, force: true })

if (asJson) process.stdout.write(text)
else {
  process.stdout.write(`M5-a local reflow · ${join('data/results', fileName)}\n`)
  for (const entry of runs) process.stdout.write(`  ${entry.exit === 0 ? 'ok  ' : 'FAIL'} ${entry.id.padEnd(16)} exit ${entry.exit} · ${entry.ms}ms\n`)
  process.stdout.write(`  store    ${storeShapes.records} record(s) · ${JSON.stringify(storeShapes.by_source)} · ${storeShapes.distinct_keys} key(s)\n`)
  process.stdout.write(`  purge    ${String(artifact.purge.deleted_records)} deleted · dir removed ${String(artifact.purge.directory_removed)}\n`)
  process.stdout.write(`  N3       byte-identical ${String(byteIdentical)} · prior visible only with --explain ${String(priorPresent)}\n`)
  for (const entry of checks) process.stdout.write(`  ${entry.ok ? 'PASS' : 'FAIL'}  ${entry.id} — ${entry.detail}\n`)
  process.stdout.write(`  verdict  ${passed ? 'all checks passed' : 'CHECK FAILED (artifact written anyway)'}\n`)
  process.stdout.write(`ssot ${join('data/results', fileName)} sha256=${sha256(text).slice(0, 12)}…\n`)
}

process.exit(passed ? 0 : 1)

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
}
