#!/usr/bin/env node
/**
 * D4 report (M5-a, `ADR-0011` option A): how often does a local prior agree with the next
 * measurement of the same exact key?
 *
 * WHY THIS IS NOT "does the prior improve hit rate": with option A a prior is an annotation
 * only, so the conclusion sequence is byte-identical with and without one and the old
 * "hit-rate difference ≥10pp" criterion is 0 by construction (`ADR-0011` §2). What CAN be
 * measured is agreement between a retrospective prior window and a later measurement window
 * on the same seven-tuple key - no ground truth required.
 *
 * WHAT IT WILL SAY TODAY: `insufficient-pairs`. The largest honest corpus this repository has
 * is 13 pinned candidates on one runtime, and the threshold is 30 pairs. "The script runs" is
 * not "D4 passed" (`docs/specs/M5-reflow.md` §13), and this script refuses to judge below 30
 * pairs instead of reporting a number from a denominator that shrank until it looked good.
 *
 * PRIVACY: the artifact carries counts, a window, an input hash and a limits list. It never
 * carries a record, an id, a package name or a path - a key identifies exactly what the user
 * judged. Every line is validated with the SAME `sanitizeOutcome` the store writes with, so a
 * hand-edited library cannot fabricate pairs.
 *
 * DETERMINISM: same library + same `--cutoff` + same `--stamp` ⇒ byte-identical artifact. No
 * clock is read, every collection is sorted, and `--stamp` is the only timestamp in the file.
 *
 *   node scripts/d4_report.mjs --store <dir-or-file> --cutoff 2026-10-20T00:00:00.000Z \
 *     --stamp 2026-10-29T10:00:00.000Z [--out data/results] [--strict] [--json]
 *
 * Requires `pnpm build` (it imports the built engine, not a copy of it).
 * Exit codes: 0 recorded · 1 `--strict` and the gate did not pass · 2 bad usage · 3 could not read the library.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, fileUrl, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))
const strict = argv.includes('--strict')
const asJson = argv.includes('--json')

const rawStamp = argOf('--stamp', null)
const stamp = rawStamp === null ? null : isoStamp(String(rawStamp))
if (stamp === null) {
  process.stderr.write('usage: node scripts/d4_report.mjs --store <dir|file> --cutoff <ISO> --stamp <ISO> [--out <dir>] [--strict] [--json]\n')
  process.exit(2)
}
const rawCutoff = argOf('--cutoff', null)
const cutoff = rawCutoff === null ? null : isoStamp(String(rawCutoff))
if (cutoff === null) {
  process.stderr.write(`invalid --cutoff "${String(rawCutoff)}": expected ISO-8601 with milliseconds, e.g. 2026-10-20T00:00:00.000Z\n`)
  process.exit(2)
}
const rawStore = argOf('--store', null)
if (rawStore === null) {
  process.stderr.write('missing --store <dir|file>\n')
  process.exit(2)
}
const storePath = pathFor(String(rawStore))
const outDir = pathFor(String(argOf('--out', 'data/results')))

const libraryPath = existsSync(storePath) && statSync(storePath).isFile() ? storePath : join(storePath, 'outcomes.jsonl')
if (!existsSync(libraryPath)) {
  process.stderr.write(`no outcome library at ${join(String(rawStore), 'outcomes.jsonl')}\n`)
  process.exit(3)
}

/** The engine is imported from `dist/`, so D4 recomputes with the same validator the store uses. */
const enginePath = 'packages/core/dist/outcome.js'
if (!existsSync(abs(enginePath))) {
  process.stderr.write(`${enginePath} is missing: run \`pnpm build\` first\n`)
  process.exit(3)
}
const { assertOutcomeLine, computeLocalPrior, outcomeKeyOf } = await import(fileUrl(enginePath))

const text = readFileSync(libraryPath, 'utf8')
const records = []
let rejectedLines = 0
let totalLines = 0
for (const raw of text.split('\n')) {
  const line = raw.trim()
  if (line === '') continue
  totalLines += 1
  const parsed = assertOutcomeLine(line)
  if (!parsed.ok) {
    rejectedLines += 1
    continue
  }
  records.push(parsed.record)
}

/** A stable, in-memory identity for a key. NEVER written to the artifact (it names a package). */
const keyId = (key) => JSON.stringify([key.package, key.version, key.dsh, key.os, key.arch, key.node_major, key.profile_kind])

const timestamps = records.map((record) => record.at).sort()
const t0 = timestamps[0] ?? null
const t1 = timestamps.at(-1) ?? null

const priorWindow = records.filter((record) => record.at < cutoff)
const laterWindow = records.filter((record) => record.at >= cutoff)

/** keyId → { key, prior[], later[] } */
const groups = new Map()
const groupOf = (record, side) => {
  const key = outcomeKeyOf(record)
  const id = keyId(key)
  const entry = groups.get(id) ?? { key, prior: [], later: [] }
  entry[side].push(record)
  groups.set(id, entry)
  return entry
}
for (const record of priorWindow) groupOf(record, 'prior')
for (const record of laterWindow) groupOf(record, 'later')

let pairs = 0
let hits = 0
let ties = 0
let keysOneSided = 0
let keysIncomplete = 0
let laterDisagreements = 0

// Sorted by keyId so iteration order (and therefore any future per-pair output) is stable.
for (const [, entry] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  if (entry.prior.length === 0 || entry.later.length === 0) {
    keysOneSided += 1
    continue
  }
  // The prior window's majority, computed by the same function the CLI shows the user. A key
  // that is incomplete (`dsh = null`, `profile_kind = unknown`) cannot be matched at all (§2),
  // so it is excluded instead of being counted as a tie.
  const prior = computeLocalPrior(entry.prior, entry.key)
  if (prior === null) {
    keysIncomplete += 1
    continue
  }
  // "The later measurement" is the FIRST record of the later window (§13): picking the
  // friendliest one afterwards would be choosing the answer.
  const ordered = [...entry.later].sort((left, right) => (left.at === right.at ? left.id.localeCompare(right.id) : left.at.localeCompare(right.at)))
  const laterConclusion = ordered[0].conclusion
  const distinct = new Set(entry.later.map((record) => record.conclusion))
  if (entry.later.length >= 2 && distinct.size >= 2) laterDisagreements += 1
  if (prior.majority === null) {
    ties += 1
    continue
  }
  pairs += 1
  if (prior.majority === laterConclusion) hits += 1
}

/**
 * Wilson score interval - the SAME implementation as `scripts/d2_report.mjs` (§13: do not
 * rewrite it). Rounded to 3 decimals so the artifact stays byte-stable.
 */
function wilson(successes, total) {
  if (total === 0) return null
  const z = 1.96
  const p = successes / total
  const denominator = 1 + (z * z) / total
  const centre = p + (z * z) / (2 * total)
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))
  return [Math.max(0, (centre - spread) / denominator), Math.min(1, (centre + spread) / denominator)].map(
    (value) => Math.round(value * 1000) / 1000,
  )
}

const MIN_PAIRS = 30
const MIN_WILSON_LOW = 0.8
const agreement = pairs === 0 ? null : hits / pairs
const interval = wilson(hits, pairs)
const enough = pairs >= MIN_PAIRS
const wilsonLow = interval === null ? null : interval[0]
const passed = enough && wilsonLow !== null && wilsonLow >= MIN_WILSON_LOW
const reason = passed ? null : enough ? 'wilson-low-below-threshold' : 'insufficient-pairs'

const payload = {
  schema_version: 1,
  produced_by: 'scripts/d4_report.mjs',
  generated_at: stamp,
  /** A criterion rewrite is a HUMAN decision (`ADR-0011` §4.2); the artifact says which one ran. */
  criterion: 'ADR-0011-A: agreement between a retrospective prior window and the next measurement of the same exact key',
  input_sha256: createHash('sha256').update(text).digest('hex'),
  input: {
    lines: totalLines,
    valid_records: records.length,
    rejected_lines: rejectedLines,
  },
  window: {
    t0,
    t1,
    cutoff,
    prior_records: priorWindow.length,
    later_records: laterWindow.length,
    definition: 'prior window = [t0, cutoff), later window = [cutoff, t1]; both bounds come from the library, never from a clock',
  },
  pairs,
  hits,
  agreement: agreement === null ? null : Math.round(agreement * 1000) / 1000,
  wilson: { level: 0.95, low: wilsonLow, high: interval === null ? null : interval[1] },
  ties,
  keys_one_sided: keysOneSided,
  keys_incomplete: keysIncomplete,
  later_disagreements: laterDisagreements,
  threshold: { min_pairs: MIN_PAIRS, min_wilson_low: MIN_WILSON_LOW },
  gate: {
    passed,
    reason,
    checks: [
      { id: 'min-pairs', ok: enough, detail: `${pairs} paired key(s), need ${MIN_PAIRS}` },
      {
        id: 'wilson-low',
        ok: wilsonLow !== null && wilsonLow >= MIN_WILSON_LOW,
        detail: wilsonLow === null ? 'no pairs, so no interval' : `Wilson95 low ${wilsonLow}, need >= ${MIN_WILSON_LOW}`,
      },
    ],
  },
  limits: [
    'insufficient-pairs means REFUSED, not "close": with fewer than 30 paired keys no agreement rate is published as a finding',
    'agreement is not accuracy: there is no ground truth, and the same key measured twice on this machine already disagrees sometimes (BS-32)',
    'a prior is an annotation only (ADR-0011 option A): it never enters conclusion / confidence / evidence, so this number cannot be read as "the prior improved a verdict"',
    'the pairing rule is retrospective: the cutoff is chosen by the operator after the data exists, which is why the window is published in full',
    'ties (no strict majority in the prior window) are removed from numerator AND denominator instead of being counted as disagreement',
    'measured on one library from one machine; nothing here is a statement about other users or other runtimes',
  ],
}

mkdirSync(outDir, { recursive: true })
const fileName = `d4-${stamp.replaceAll(':', '-')}.json`
const target = join(outDir, fileName)
const serialized = `${JSON.stringify(payload, null, 2)}\n`
writeFileSync(target, serialized, 'utf8')
writeFileSync(`${target}.sha256`, sha256(serialized), 'utf8')

if (asJson) {
  process.stdout.write(serialized)
} else {
  process.stdout.write(`D4 (ADR-0011 option A) · ${target}\n`)
  process.stdout.write(`  input      ${records.length} record(s) from ${totalLines} line(s) · ${rejectedLines} rejected\n`)
  process.stdout.write(`  window     prior [${t0 ?? '—'}, ${cutoff}) · later [${cutoff}, ${t1 ?? '—'}]\n`)
  process.stdout.write(`  pairs      ${pairs} (ties ${ties}, one-sided ${keysOneSided}, incomplete ${keysIncomplete})\n`)
  process.stdout.write(`  agreement  ${hits}/${pairs}${interval === null ? '' : ` · Wilson95 ${interval[0]}–${interval[1]}`}\n`)
  process.stdout.write(`  gate       ${passed ? 'PASSED' : `NOT PASSED (${reason})`}${strict && !passed ? ' · strict → exit 1' : ''}\n`)
}

// T-317: the artifact and its .sha256 are on disk before this exit, so a red D4 can never mean
// "no evidence was recorded".
if (strict && !passed) process.exit(1)
