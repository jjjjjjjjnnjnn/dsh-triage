#!/usr/bin/env node
/**
 * Live inventory recorder (T-201 P1 · the artifact side of B1/B2).
 *
 * WHAT IT DOES, IN ORDER:
 *   1. copies `scripts/probe_hooks/inventory-hook.mjs` into a scratch directory inside
 *      the sandbox and writes a one-entry `--patch` overlay that mounts it;
 *   2. boots the sandbox Host (`dsh --profile <p> --patch <overlay>`), waits for the
 *      hook to write its sample, then kills the whole process tree;
 *   3. runs the real CLI (`audit --snapshot`) over that sample;
 *   4. compares the two and writes ONE artifact: `data/results/inventory-live-*.json`
 *      with `sample.kind=live`, the raw snapshot, the Host-side summary, the CLI-side
 *      conclusions and `cross_check.agree`.
 *
 * WHY THE CROSS-CHECK IS NOT OPTIONAL: a sample is only worth something if the engine
 * that reads it offline reaches the same per-row conclusions the Host reported. If they
 * disagree the script exits 1 and the artifact says `agree: false` — B1/B2 stay open.
 *
 * WHY THE PROBE IS MOUNTED RATHER THAN PATCHED INTO THE PROFILE: the profile stays
 * untouched (the overlay is a launcher layer), so the declared tree this script reads
 * is the deployment's own; the probe row is reported in `excluded`, never scored.
 *
 *   node scripts/record_live_inventory.mjs \
 *     --dsh-home <sandbox>/home --profile upstream --install <sandbox>/install \
 *     --stamp 2026-10-27T22:00:00.000Z
 *
 * Exit codes: 0 sampled + cross-check agrees · 1 sampled but the two sides disagree
 * · 3 could not sample (blocked; the artifact records why).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { bootAndSample } from './lib/live.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = argOf('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-10-27T22:00:00.000Z\n`)
  process.exit(2)
}

const profile = String(argOf('--profile', 'upstream'))
const dshHome = pathFor(String(argOf('--dsh-home', join(process.env['USERPROFILE'] ?? homedir(), '.dsh'))))
const installDir = pathFor(String(argOf('--install', '')))
const outDir = pathFor(String(argOf('--out', 'data/results')))
const collectTimeoutMs = Number(argOf('--collect-timeout-ms', '180000'))
const settleTimeoutMs = Number(argOf('--settle-timeout-ms', '20000'))

const redactRoots = [abs('.'), homedir(), tmpdir(), dshHome, installDir].filter((root) => root !== '')
const labelOf = (root) => (root === abs('.') ? '<repo>' : '~')
/**
 * Redact a path that may arrive in three shapes: native (backslashes), POSIX-ish
 * (forward slashes, e.g. from YAML or a package manifest) and a `file:///` URL with
 * percent-encoded segments. The probe's own row is spelled as such a URL by the
 * loader, and missing that shape published `C:/Users/<name>/...` in a first draft.
 */
const redact = (value) => {
  let text = String(value)
  if (text.includes('%')) {
    try {
      text = decodeURIComponent(text)
    } catch {
      // Not percent-encoded after all; keep the original.
    }
  }
  for (const root of redactRoots) {
    for (const variant of [root, root.replaceAll('\\', '/')]) {
      text = text.split(variant).join(labelOf(root))
    }
  }
  return text
}

const blockers = []
const record = (id, ok, detail) => {
  if (!ok) blockers.push({ id, detail })
  return { id, ok, detail }
}

/* ------------------------------ preconditions ------------------------------ */

const evidence = []
const profileDir = join(dshHome, 'profiles', profile)
evidence.push(record('profile-manifest', existsSync(join(profileDir, 'package.json')), redact(profileDir)))
const dshMain = installDir === '' ? '' : join(installDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const dshMainExists = dshMain !== '' && existsSync(dshMain)
evidence.push(record('dsh-runtime', dshMainExists, dshMainExists ? redact(dshMain) : 'no --install directory with @deepseek-ai/dsh/lib/bin.js'))
const hookSource = abs('scripts/probe_hooks/inventory-hook.mjs')
evidence.push(record('hook-present', existsSync(hookSource), redact(hookSource)))

const runtimeVersion =
  dshMainExists && installDir !== ''
    ? (() => {
        try {
          return String(JSON.parse(readFileSync(join(installDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version ?? '')
        } catch {
          return null
        }
      })()
    : null

/* --------------------------------- sampling -------------------------------- */

let sample = null
let host = { status: 'skipped' }

if (blockers.length === 0) {
  // One implementation of "write overlay → boot → wait for the hook → kill the tree",
  // shared with scripts/record_live_capabilities.mjs, so two recorders can never sample
  // different moments with subtly different boot rules.
  const result = await bootAndSample({
    dshMain,
    dshHome,
    profile,
    profileDir,
    hookSource,
    scratchRoot: resolve(dshHome, '..'),
    timeoutMs: collectTimeoutMs,
    config: {
      // `out`, `resolveFrom` and `profile` are written by bootAndSample itself; repeating
      // `profile` here produced a duplicate YAML key and the overlay failed to parse.
      runtimeVersion,
      selfId: 'triage-inventory-probe',
      timeoutMs: settleTimeoutMs,
    },
  })
  host = { ...result.host, first_line: redact(result.host.first_line) }
  evidence.push(
    record(
      'host-sampled',
      result.payload !== null,
      result.payload === null ? String(result.error) : `probe wrote its sample in ${result.host.seconds}s`,
    ),
  )
  const payload = result.payload
  if (payload !== null) {
    if (payload.error !== undefined) {
      evidence.push(record('hook-completed', false, `${payload.error.name}: ${payload.error.message}`))
    } else {
      // Provenance is a precondition, not decoration: a sample that does not say how it
      // was taken cannot be judged, and the auditor must not have to read the sidecar.
      const declared = payload.snapshot?.transport ?? payload.transport ?? null
      evidence.push(
        record(
          'sample-declares-transport',
          declared === 'in-process-projection',
          `transport=${String(declared)} (inside snapshot: ${String(payload.snapshot?.transport ?? null)})`,
        ),
      )
      const excludedIds = (payload.excluded ?? []).map((row) => row.entryId).filter((id) => typeof id === 'string')
      const stillThere = excludedIds.filter((id) => (payload.snapshot?.entries ?? []).some((entry) => entry.entryId === id))
      evidence.push(
        record(
          'excluded-rows-absent',
          excludedIds.length > 0 && stillThere.length === 0,
          stillThere.length === 0
            ? `${excludedIds.length} excluded row(s), none of them scored`
            : `still scored: ${stillThere.join(', ')}`,
        ),
      )
      evidence.push(
        record(
          'hook-completed',
          true,
          `${payload.snapshot?.entries?.length ?? 0} entries after ${payload.wait_ms}ms (probe excluded)`,
        ),
      )
      sample = redactDeep(payload)
    }
  }
}

/* ------------------------- the CLI judges the same file ------------------------ */

let cli = null
let crossCheck = { performed: false, agree: false, detail: 'no sample to check' }

if (sample !== null) {
  const cliPath = abs('packages/plugin/dist/cli.js')
  const sampleFile = join(outDir, `.crosscheck-${stamp.replaceAll(':', '-')}.json`)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(sampleFile, `${JSON.stringify(sample, null, 2)}\n`, 'utf8')
  try {
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        'audit',
        '--dsh-home',
        dshHome,
        '--profile',
        profile,
        '--snapshot',
        sampleFile,
        '--json',
        '--stamp',
        stamp,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    if (result.status === null || result.stdout.trim() === '') {
      crossCheck = { performed: false, agree: false, detail: `the CLI produced no JSON (exit ${String(result.status)})` }
    } else {
      const parsed = JSON.parse(result.stdout)
      const inventory = parsed.inventory ?? {}
      const verdicts = Array.isArray(inventory.verdicts) ? inventory.verdicts : []
      const byCode = new Map()
      const byCodeIds = new Map()
      for (const verdict of verdicts) {
        for (const reason of verdict.reasons ?? []) {
          byCode.set(reason.code, (byCode.get(reason.code) ?? 0) + 1)
          const id = reason.params?.entryId ?? reason.params?.module ?? verdict.subject?.name ?? '?'
          const preset = reason.params?.preset
          byCodeIds.set(reason.code, [...(byCodeIds.get(reason.code) ?? []), preset === undefined ? String(id) : `${preset}:${id}`])
        }
      }
      const entries = Array.isArray(inventory.entries) ? inventory.entries : []
      cli = {
        exit_code: result.status,
        entries: entries.length,
        transport: inventory.transport ?? null,
        missing: Array.isArray(inventory.missing) ? inventory.missing.length : 0,
        undeclared: (inventory.undeclared ?? []).map((entry) => entry.entry_id),
        verdicts: verdicts.length,
        by_code: Object.fromEntries([...byCode].sort(([a], [b]) => a.localeCompare(b))),
        by_code_ids: Object.fromEntries([...byCodeIds].map(([code, ids]) => [code, [...ids].sort()])),
        phases: Object.fromEntries(entries.map((entry) => [entry.entry_id, entry.phase ?? 'none'])),
        presets: (inventory.presets ?? []).map((preset) => ({
          id: preset.id,
          rows: preset.rows.length,
          broken: preset.broken,
          phases: Object.fromEntries(
            (preset.rows ?? []).map((row) => [
              row.entry_id ?? row.module,
              `${row.enabled === true ? 'on' : row.enabled === false ? 'off' : 'conditional'}:${row.phase ?? 'none'}`,
            ]),
          ),
        })),
        preset_declarations: (parsed.preset_declarations ?? []).map((declaration) => ({
          preset_id: declaration.preset_id,
          rows: declaration.rows,
        })),
      }
      crossCheck = compareSides(sample.host_summary, cli)
    }
  } finally {
    rmSync(sampleFile, { force: true })
  }
}

/**
 * The Host said "this row is in this phase"; the CLI read the same JSON with the same
 * engine. Comparison is **by identity, not by count**: the adversary flipped 87 preset
 * rows to `failed` while every total stayed the same and the first version of this check
 * still said "agree row for row".
 */
function compareSides(hostSummary, cliSide) {
  const problems = []
  const hostPhases = hostSummary?.phases ?? null
  if (!isRecord(hostPhases)) problems.push('the Host summary carries no per-row phase map')
  else {
    const cliPhases = cliSide.phases ?? {}
    const hostIds = Object.keys(hostPhases).sort()
    const cliIds = Object.keys(cliPhases).sort()
    if (hostIds.join('|') !== cliIds.join('|')) {
      const onlyHost = hostIds.filter((id) => !cliPhases[id])
      const onlyCli = cliIds.filter((id) => !(id in hostPhases))
      problems.push(`entry ids differ (host only: ${onlyHost.slice(0, 3).join(',') || 'none'}; cli only: ${onlyCli.slice(0, 3).join(',') || 'none'})`)
    } else {
      const wrong = hostIds.filter((id) => hostPhases[id] !== cliPhases[id])
      if (wrong.length > 0) problems.push(`${wrong.length} row(s) in a different phase, e.g. ${wrong[0]}: host=${hostPhases[wrong[0]]} cli=${cliPhases[wrong[0]]}`)
    }
  }

  const compareIdentity = (label, hostIds, cliIds) => {
    if (!Array.isArray(hostIds)) {
      problems.push(`the Host summary carries no ${label} list`)
      return
    }
    const left = [...hostIds].sort().join('|')
    const right = [...(cliIds ?? [])].sort().join('|')
    if (left !== right) problems.push(`${label} ids differ (host: ${left || 'none'} · cli: ${right || 'none'})`)
  }
  compareIdentity('disabled', hostSummary?.disabled, cliSide.by_code_ids?.['runtime.disabled'])
  compareIdentity('failed', hostSummary?.failed, cliSide.by_code_ids?.['runtime.fiber-failed'])
  compareIdentity('no-fiber', hostSummary?.no_fiber_enabled, cliSide.by_code_ids?.['runtime.no-fiber'])

  const hostPresets = hostSummary?.presets ?? null
  if (hostPresets !== null) {
    compareIdentity('conditional preset', hostPresets.conditional, cliSide.by_code_ids?.['runtime.preset-conditional'])
    const byPreset = isRecord(hostPresets.by_preset) ? hostPresets.by_preset : null
    if (byPreset === null) problems.push('the Host summary carries no per-preset row map')
    else {
      for (const [presetId, hostRows] of Object.entries(byPreset)) {
        const cliPreset = (cliSide.presets ?? []).find((preset) => preset.id === presetId)
        if (cliPreset === undefined) {
          problems.push(`preset ${presetId} is missing from the CLI output`)
          continue
        }
        const hostText = JSON.stringify(hostRows)
        const cliText = JSON.stringify(Object.fromEntries(Object.entries(cliPreset.phases).sort(([a], [b]) => a.localeCompare(b))))
        if (hostText !== cliText) problems.push(`preset ${presetId} rows differ between host and CLI`)
      }
    }
    if ((cliSide.presets ?? []).length !== hostPresets.groups) {
      problems.push(`preset groups: host says ${hostPresets.groups}, CLI says ${(cliSide.presets ?? []).length}`)
    }
  }

  return {
    performed: true,
    agree: problems.length === 0,
    // Naming what was compared is part of the claim: "agree" must not be read as
    // "the sample is true" — both sides consume the same projection.
    scope: [
      'per-entry phase map',
      'disabled / failed / no-fiber identity lists',
      'per-preset row map + conditional identity list',
      'verdict code counts',
    ],
    caveat:
      'both sides read the same readPluginInventory(ctx) projection: this proves the summary and the offline engine agree, not that the Host state is correct',
    detail: problems.length === 0 ? 'Host summary and CLI conclusions agree row for row' : problems.join('; '),
    host: {
      entries: hostSummary?.entries ?? null,
      by_phase: hostSummary?.by_phase ?? null,
      disabled: Array.isArray(hostSummary?.disabled) ? hostSummary.disabled.length : null,
      failed: Array.isArray(hostSummary?.failed) ? hostSummary.failed.length : null,
      no_fiber_enabled: Array.isArray(hostSummary?.no_fiber_enabled) ? hostSummary.no_fiber_enabled.length : null,
      presets: hostPresets,
    },
    cli: {
      entries: cliSide.entries,
      transport: cliSide.transport,
      missing: cliSide.missing,
      undeclared: cliSide.undeclared,
      verdicts: cliSide.verdicts,
      by_code: cliSide.by_code,
    },
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Redact every string in the payload: `data/results` may be published. */
function redactDeep(value) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(redactDeep)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = redactDeep(item)
    return out
  }
  return value
}

/* --------------------------------- artifact -------------------------------- */

const outcome = blockers.length > 0 ? 'blocked' : sample === null ? 'blocked' : crossCheck.agree ? 'sampled' : 'disagreement'
const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_live_inventory.mjs',
  generated_at: stamp,
  sample: {
    kind: sample === null ? 'live-attempt' : 'live',
    profile,
    dsh_home: redact(dshHome),
    runtime_version: runtimeVersion,
    wait_ms: sample?.wait_ms ?? null,
    transport: sample?.transport ?? null,
    method: sample?.method ?? null,
  },
  outcome,
  blockers,
  evidence,
  host,
  // Empty when the sample never happened: an attempt is not a conclusion.
  snapshot: sample === null ? null : sample.snapshot,
  host_summary: sample?.host_summary ?? null,
  excluded: sample?.excluded ?? [],
  cli,
  cross_check: crossCheck,
  next_step:
    outcome === 'blocked'
      ? { requirement: 'a profile that mounts (deps installed, dsh binary present)', reference: 'docs/specs/M2-inventory.md §8' }
      : outcome === 'disagreement'
        ? { requirement: 'the CLI and the Host must agree before B1/B2 can close', detail: crossCheck.detail }
        : { requirement: 'none for P1; the Remote transport (P3) is a separate task', reference: 'docs/specs/M2-inventory.md §4' },
}

mkdirSync(outDir, { recursive: true })
const fileName = `inventory-live-${stamp.replaceAll(':', '-')}.json`
const target = join(outDir, fileName)
const text = `${JSON.stringify(artifact, null, 2)}\n`
writeFileSync(target, text, 'utf8')
// `gate_ssot` compares the whole file against the computed digest: hash only, no name.
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

process.stdout.write(`wrote ${redact(target)}\n`)
process.stdout.write(`outcome ${outcome} · ${artifact.sample.kind} · entries ${artifact.cli?.entries ?? 0} · agree ${crossCheck.agree}\n`)
if (outcome === 'blocked') {
  for (const blocker of blockers) process.stdout.write(`blocked  ${blocker.id}: ${blocker.detail}\n`)
  process.exit(3)
}
if (outcome === 'disagreement') {
  process.stdout.write(`disagreement: ${crossCheck.detail}\n`)
  process.exit(1)
}
if (!crossCheck.agree) process.exit(1)
