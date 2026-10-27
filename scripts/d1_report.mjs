#!/usr/bin/env node
/**
 * D1 sample report: turn the real-case batch into one recomputable artifact.
 *
 * Decision gate D1 (`docs/ROADMAP.md` 搂2) says the attribution claim is only
 * accepted when `why` names the real root cause in at least 8 of 10 real cases.
 * Until now that number lived in prose. This script derives it from the SSOT
 * (`data/results/why-case-*.json`), so the gate can be recomputed instead of
 * quoted, and a re-labelled case shows up as a changed line, not as a rewording.
 *
 * It never judges a case itself: the `hit` verdict comes from `record_case.mjs`,
 * which judges against the machine-checkable label in `data/cases/<ID>/case.json`.
 *
 *   node scripts/d1_report.mjs
 *   node scripts/d1_report.mjs --stamp 2026-10-26T12:00:00.000Z
 *   node scripts/d1_report.mjs --results data/results --out data/results
 *
 * Exit code is 0 whenever the artifact was written 鈥?a failing D1 gate is data,
 * not an infrastructure error. Read `gate.passed` to see the verdict.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const flagValue = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const rawStamp = flagValue('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-10-26T12:00:00.000Z\n`)
  process.exit(2)
}
const resultsDir = flagValue('--results', 'data/results')
const outDir = flagValue('--out', 'data/results')
/** `abs()` is repo-root relative; a caller passing an absolute path (tests) keeps it. */
const pathFor = (value) => (isAbsolute(value) ? value : abs(value))
const minimumHits = Number(flagValue('--min-hit', '8'))
const minimumTotal = Number(flagValue('--min-total', '10'))
const asJson = argv.includes('--json')

if (!Number.isInteger(minimumHits) || minimumHits < 0 || !Number.isInteger(minimumTotal) || minimumTotal <= 0) {
  process.stderr.write('--min-hit/--min-total must be integers (hit >= 0, total > 0)\n')
  process.exit(2)
}

/* ------------------------------- collect cases ------------------------------ */

const PREFIX = 'why-case-'
const SUFFIX = '.json'
const files = readdirSync(pathFor(resultsDir)).filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))

/** Newest artifact wins per case id: a re-run must not double-count a case. */
const byCase = new Map()
const superseded = []
for (const name of files) {
  const path = `${resultsDir}/${name}`
  const text = readFileSync(pathFor(path), 'utf8')
  let payload
  try {
    payload = JSON.parse(text)
  } catch (error) {
    process.stderr.write(`cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
  const id = String(payload?.case?.id ?? '')
  if (id === '') {
    process.stderr.write(`${path} has no case.id 鈥?refuse to count it\n`)
    process.exit(2)
  }
  const verdicts = Array.isArray(payload?.verdicts) ? payload.verdicts : []
  const conclusions = [...new Set(verdicts.map((verdict) => String(verdict?.conclusion ?? '?')))].sort()
  const entry = {
    id,
    artifact: path,
    artifact_sha256: sha256(text),
    generated_at: String(payload?.generated_at ?? ''),
    mode: String(payload?.mode ?? ''),
    verdict: String(payload?.hit?.verdict ?? ''),
    label: payload?.hit?.expected ?? null,
    matched_module: payload?.hit?.matched?.subject?.name ?? null,
    why: String(payload?.hit?.why ?? ''),
    verdict_count: verdicts.length,
    conclusions,
  }
  if (entry.verdict !== 'hit' && entry.verdict !== 'miss') {
    process.stderr.write(`${path} has hit.verdict="${entry.verdict}" 鈥?expected hit|miss\n`)
    process.exit(2)
  }
  const previous = byCase.get(id)
  if (previous === undefined) byCase.set(id, entry)
  else if (entry.generated_at > previous.generated_at) {
    superseded.push(previous.artifact)
    byCase.set(id, entry)
  } else superseded.push(entry.artifact)
}

const cases = [...byCase.values()].sort((left, right) => left.id.localeCompare(right.id))
if (cases.length === 0) {
  process.stderr.write(`no ${PREFIX}*${SUFFIX} artifacts under ${resultsDir}: run record_case.mjs first\n`)
  process.exit(2)
}

/**
 * How a miss failed. Added in R9 (T-107/T-108): before those fixes a case could
 * "miss" by producing zero verdicts, which is indistinguishable from a healthy
 * profile — the silent failure this project exists to remove. Keeping the two
 * kinds apart stops "we said nothing" from hiding behind "we said unknown".
 */
function missKind(entry) {
  if (entry.verdict === 'hit') return null
  if (entry.conclusions.includes('unknown')) return 'explicit-unknown'
  if (entry.verdict_count === 0) return 'silent'
  return 'explicit-other'
}
for (const entry of cases) entry.miss_kind = missKind(entry)

/* --------------------------------- aggregate -------------------------------- */

const hits = cases.filter((entry) => entry.verdict === 'hit').length
const misses = cases.length - hits
const hitRate = Math.round((hits / cases.length) * 1000) / 1000
const enoughSamples = cases.length >= minimumTotal
const enoughHits = hits >= minimumHits

// Misses split by how honest the answer was. A green D1 says "we name the root
// cause"; this breakdown says what happened in the cases where we do not.
const missByKind = {}
for (const entry of cases) {
  if (entry.miss_kind === null) continue
  missByKind[entry.miss_kind] = (missByKind[entry.miss_kind] ?? 0) + 1
}
const sortedMissKinds = Object.fromEntries(Object.entries(missByKind).sort(([a], [b]) => a.localeCompare(b)))

const labelSources = {}
for (const entry of cases) {
  const source = String(entry?.label?.requirement_key_source ?? 'unstated')
  labelSources[source] = (labelSources[source] ?? 0) + 1
}
const sortedLabelSources = Object.fromEntries(Object.entries(labelSources).sort(([a], [b]) => a.localeCompare(b)))

const payload = {
  schema_version: 1,
  produced_by: 'scripts/d1_report.mjs',
  generated_at: stamp,
  gate: {
    id: 'D1',
    criterion: `why names the real root cause in >=${minimumHits} of >=${minimumTotal} real cases`,
    minimum_hits: minimumHits,
    minimum_total: minimumTotal,
    samples_ok: enoughSamples,
    hits_ok: enoughHits,
    passed: enoughSamples && enoughHits,
  },
  totals: {
    cases: cases.length,
    hit: hits,
    miss: misses,
    hit_rate: hitRate,
    required: `${minimumHits}/${minimumTotal}`,
    miss_by_kind: sortedMissKinds,
  },
  // How each label's requirement key was obtained. A key quoted by the reporter
  // and a key derived from the published manifest are both legitimate, but they
  // are not equally strong evidence, so the report never hides the difference.
  label_key_sources: sortedLabelSources,
  cases,
  superseded: superseded.sort(),
}

const fileName = `d1-${stamp.replaceAll(':', '-')}.json`
const target = join(pathFor(outDir), fileName)
mkdirSync(pathFor(outDir), { recursive: true })
const text = `${JSON.stringify(payload, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, sha256(text), 'utf8')

if (asJson) process.stdout.write(text)
process.stdout.write(
  `D1: ${hits}/${cases.length} hit (${misses} miss) 路 required ${minimumHits}/${minimumTotal} 路 ` +
    `${payload.gate.passed ? 'PASSED' : 'NOT PASSED'} 路 key sources ${JSON.stringify(sortedLabelSources)}\n`,
)
for (const entry of cases) {
  process.stdout.write(
    `  ${entry.verdict.toUpperCase().padEnd(4)} ${entry.id.padEnd(11)} ${entry.mode.padEnd(9)} ${entry.matched_module ?? '-'}` +
      `${entry.miss_kind === null ? '' : `  [${entry.miss_kind}]`}\n`,
  )
}
if (superseded.length > 0) {
  process.stdout.write(`  superseded (not counted): ${superseded.join(', ')}\n`)
}
process.stdout.write(`ssot ${outDir}/${fileName} sha256=${sha256(text).slice(0, 12)}鈥n`)
