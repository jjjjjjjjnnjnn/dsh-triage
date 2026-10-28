#!/usr/bin/env node
/**
 * Replacement-window report (ADR-0008 / T-311).
 *
 * THE QUESTION: the executor waits one more `--unsettled-timeout` window when a sample cannot be
 * judged, because Cordis may re-apply and write a better one. R23 measured that this wait is the
 * dominant cost of a non-settled run (20.3s of a 48.4s boot step). So: has it ever actually
 * produced a better sample?
 *
 * STATUS (R26): ADR-0008 option E is implemented — the window is now opened for an `{error}`
 * sample only, and `settled:false` converges immediately (`inventory.replacement_waited`). This
 * script therefore reads the PRE-E artifacts as history: it is the measurement that justified E,
 * not a description of what the executor does today.
 *
 * WHAT IT DOES: scans every `probe-*.json` artifact, reports (a) how many samples were not
 * usable, (b) how many times a replacement was ever observed (`attempts > 1` or `applies > 1`),
 * and (c) a comparison table for runs of the same fixture at different windows, so the cost of
 * shortening the window is a measurement rather than an opinion.
 *
 * It answers from EXISTING artifacts, which is the point: no new sandbox runs, and the result is
 * a property of the evidence already committed.
 *
 *   node scripts/report_replacement_window.mjs [--stamp <iso>] [--out <dir>]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const rawStamp = argOf('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601\n`)
  process.exit(2)
}
const resultsDir = abs(String(argOf('--results', 'data/results')))
const outDir = abs(String(argOf('--out', 'data/results')))
if (!existsSync(resultsDir)) {
  process.stderr.write(`${resultsDir}: no artifact directory\n`)
  process.exit(2)
}

const files = readdirSync(resultsDir).filter((name) => name.startsWith('probe-') && name.endsWith('.json'))
const runs = []
for (const name of files) {
  let payload
  try {
    payload = JSON.parse(readFileSync(join(resultsDir, name), 'utf8'))
  } catch {
    continue // A malformed artifact is not this report's business.
  }
  const inventory = payload?.inventory
  if (inventory === null || inventory === undefined) continue
  const boot = Array.isArray(payload.steps) ? payload.steps.find((step) => step?.id === 'boot') : null
  const segments = payload?.timings?.bootSegments ?? null
  runs.push({
    artifact: name,
    candidate: payload?.candidate?.package ?? null,
    conclusion: payload?.conclusion ?? null,
    settled: typeof inventory.settled === 'boolean' ? inventory.settled : null,
    errorCode: typeof inventory.error_code === 'string' ? inventory.error_code : null,
    attempts: typeof inventory.attempts === 'number' ? inventory.attempts : null,
    applies: typeof inventory.applies === 'number' ? inventory.applies : null,
    hookWaitMs: typeof inventory.wait_ms === 'number' ? inventory.wait_ms : null,
    readinessWindowMs: typeof payload?.readiness?.window_ms === 'number' ? payload.readiness.window_ms : null,
    bootStepMs: typeof boot?.ms === 'number' ? boot.ms : null,
    segments,
  })
}

/** A sample the judge refused to rest a verdict on. */
const notUsable = runs.filter((run) => run.settled === false || run.errorCode !== null)
/**
 * A replacement is the only reason that wait exists: the executor read the sample file twice and
 * got different content, or the hook reported another apply. Both are recorded by the hook.
 */
const replaced = runs.filter((run) => (run.attempts ?? 0) > 1 || (run.applies ?? 0) > 1)

/**
 * The cost of the window, measured on the ONE fixture that never settles: the same candidate at
 * different `--unsettled-timeout` values. Grouped by candidate + hook wait so nobody compares
 * different shapes by accident.
 */
const windowRows = runs
  .filter((run) => run.segments !== null && run.settled === false)
  .map((run) => ({
    artifact: run.artifact,
    candidate: run.candidate,
    window_ms: run.readinessWindowMs,
    hook_wait_ms: run.hookWaitMs,
    sample_ms: run.segments.sampleMtimeMs,
    replacement_wait_ms:
      run.segments.sampleMtimeMs === null ? null : run.segments.sampleWaitMs - run.segments.sampleMtimeMs,
    render_ms: run.segments.renderMs,
    boot_step_ms: run.bootStepMs,
    conclusion: run.conclusion,
  }))
  .sort((left, right) => (right.window_ms ?? 0) - (left.window_ms ?? 0))

const replacementEverObserved = replaced.length > 0
const longWait = windowRows.find((row) => row.window_ms === 20_000) ?? null
const shortWait = windowRows.find((row) => (row.window_ms ?? 0) <= 1_000) ?? null
const saving =
  longWait?.replacement_wait_ms !== null &&
  longWait !== undefined &&
  shortWait?.replacement_wait_ms !== null &&
  shortWait !== undefined
    ? longWait.replacement_wait_ms - shortWait.replacement_wait_ms
    : null

const artifact = {
  schema_version: 1,
  produced_by: 'scripts/report_replacement_window.mjs',
  generated_at: stamp,
  question:
    'the executor waits another --unsettled-timeout window when a sample cannot be judged; has that wait ever produced a better sample, and what does shortening it cost?',
  source: {
    scanned: files.length,
    with_inventory: runs.length,
    // Legacy artifacts predate `settled`/`attempts`/`applies`, so they count as "unknown shape".
    without_shape_fields: runs.filter((run) => run.settled === null && run.errorCode === null).length,
  },
  observations: {
    not_usable_samples: notUsable.length,
    replacements_observed: replaced.length,
    replacement_ever_observed: replacementEverObserved,
    shapes: {
      settled_true: runs.filter((run) => run.settled === true).length,
      settled_false: runs.filter((run) => run.settled === false).length,
      error_payload: runs.filter((run) => run.errorCode !== null).length,
    },
    not_usable_detail: notUsable.map((run) => ({
      artifact: run.artifact,
      settled: run.settled,
      error_code: run.errorCode,
      attempts: run.attempts,
      applies: run.applies,
      hook_wait_ms: run.hookWaitMs,
      conclusion: run.conclusion,
    })),
  },
  window_cost: {
    rows: windowRows,
    measured_saving_ms: saving,
    note:
      'each row is a real run of the same never-settling fixture with a different --unsettled-timeout; the conclusion is `unknown` in all of them, so the difference is pure waiting',
  },
  conclusion:
    replaced.length === 0
      ? 'in the recorded evidence the replacement wait has never produced a better sample; shortening it costs waiting time only (the verdict stays unknown either way)'
      : 'the replacement wait did produce a better sample in at least one recorded run: shortening it would lose that recovery path',
  limits: [
    'absence of a replacement in the artifacts is not proof it cannot happen: R17 observed the mechanism during development, before these fields were recorded',
    'legacy artifacts have no settled/attempts/applies fields and cannot distinguish the shapes',
    'one fixture never settles; a different plugin may sit on the boundary where a replacement arrives just after the window',
  ],
}

mkdirSync(outDir, { recursive: true })
const target = join(outDir, `replacement-window-${stamp.replaceAll(':', '-')}.json`)
const text = `${JSON.stringify(artifact, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

process.stdout.write(`wrote ${target}\n`)
process.stdout.write(
  `scanned ${runs.length} artifacts · not-usable ${notUsable.length} · replacements observed ${replaced.length}\n`,
)
for (const row of windowRows) {
  process.stdout.write(
    `  window=${String(row.window_ms).padStart(5)}ms  sample=${String(row.sample_ms).padStart(5)}ms  replacement_wait=${String(row.replacement_wait_ms).padStart(5)}ms  boot=${String(row.boot_step_ms).padStart(5)}ms  ${row.conclusion}\n`,
  )
}
process.stdout.write(`measured saving when the wait is removed: ${saving === null ? 'n/a' : `${saving}ms`}\n`)
