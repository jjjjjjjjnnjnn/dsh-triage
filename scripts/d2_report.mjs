#!/usr/bin/env node
/**
 * D2 sample report: turn a probe matrix into one recomputable decision artifact.
 *
 * WHY THIS EXISTS: D2 (`docs/ROADMAP.md` §2) is the gate that decides whether the probe is a
 * product or an experiment. Until now the number was read off a matrix summary by hand, and
 * "n=6, 2 go" was one bad sentence away from becoming "33% success". This script derives the
 * numbers from a recorded matrix artifact, states the definitions it used, and **refuses to
 * pass when the denominator is too small** — a gate that can say "not yet" is the only kind
 * worth having.
 *
 * THREE NUMBERS, KEPT APART ON PURPOSE:
 *   - `probe_reliability` — did the run finish, clean up and produce a verdict at all?
 *     An honest `unknown` counts as a verdict: "I could not measure" is an answer, not a crash.
 *   - `real_pass_rate` — among real plugins that produced a verdict, how many were `go`?
 *     This is a product statement about the ecosystem + our judgement, not about our plumbing.
 *     It comes with a Wilson 95% interval, because n is small and 9/10 is not "90% ± nothing".
 *   - `failure_shapes` — how many distinct failure kinds the batch actually exhibited. D2 asks
 *     for ≥5; a green board that only ever saw one shape proves much less than it looks.
 *
 *   node scripts/d2_report.mjs
 *   node scripts/d2_report.mjs --matrix data/results/probe-matrix-2026-10-27T20-30-00.000Z.json --stamp 2026-10-27T21:00:00.000Z
 *   node scripts/d2_report.mjs --min-real 12 --min-shapes 6
 *
 * Exit code is 0 whenever the artifact was written: a failing D2 gate is data, not an
 * infrastructure error. Read `gate.passed`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { abs, isoStamp } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const flagValue = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const rawStamp = flagValue('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-10-27T21:00:00.000Z\n`)
  process.exit(2)
}
/** `abs()` is repo-root relative; an absolute path (tests, callers) is left alone. */
const pathFor = (value) => (isAbsolute(value) ? value : abs(value))
const resultsDir = pathFor(flagValue('--results', 'data/results'))
const outDir = pathFor(flagValue('--out', 'data/results'))
const minReal = Number(flagValue('--min-real', '10'))
const minReliability = Number(flagValue('--min-reliability', '0.9'))
const minShapes = Number(flagValue('--min-shapes', '5'))
const bootBudgetMs = Number(flagValue('--boot-budget-ms', '20000'))
const asJson = argv.includes('--json')
for (const [name, value] of [
  ['--min-real', minReal],
  ['--min-reliability', minReliability],
  ['--min-shapes', minShapes],
  ['--boot-budget-ms', bootBudgetMs],
]) {
  if (!Number.isFinite(value) || value < 0) {
    process.stderr.write(`${name} needs a non-negative number\n`)
    process.exit(2)
  }
}

/** Newest matrix in the results directory, unless one was named explicitly. */
function newestMatrix() {
  if (!existsSync(resultsDir)) return null
  const candidates = readdirSync(resultsDir)
    .filter((name) => name.startsWith('probe-matrix-') && name.endsWith('.json'))
    .map((name) => {
      const path = join(resultsDir, name)
      try {
        const payload = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
        return { path, generatedAt: String(payload?.generated_at ?? '') }
      } catch {
        return null
      }
    })
    .filter((entry) => entry !== null)
  if (candidates.length === 0) return null
  candidates.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
  return candidates[0].path
}

const explicitMatrix = flagValue('--matrix', null)
const matrixPath = explicitMatrix === null ? newestMatrix() : pathFor(String(explicitMatrix))
if (matrixPath === null || !existsSync(matrixPath)) {
  process.stderr.write(
    `no matrix artifact found (looked in ${resultsDir}); run scripts/record_probe_matrix.mjs first, or pass --matrix <file>\n`,
  )
  process.exit(2)
}

const matrixText = readFileSync(matrixPath, 'utf8').replace(/^\uFEFF/, '')
const matrix = JSON.parse(matrixText)
const runs = Array.isArray(matrix.runs) ? matrix.runs : []
if (runs.length === 0) {
  process.stderr.write(`${matrixPath}: no runs\n`)
  process.exit(2)
}

/* -------------------------------- measuring -------------------------------- */

const displayPath = (path) => path.replace(abs('.'), '').replace(/^[\\/]/, '').replaceAll('\\', '/')

const measured = runs.map((run) => {
  const payload = run?.artifact?.payload ?? null
  const real = run?.real === true
  const conclusion = typeof payload?.conclusion === 'string' ? payload.conclusion : null
  const bootMs = typeof payload?.timings?.bootToSampleMs === 'number' ? payload.timings.bootToSampleMs : null
  // The whole boot step (spawn → settle → readiness → kill wait). This is the number a user
  // actually waits for, which is not the same as boot→sample (ADR-0006).
  const bootStep = Array.isArray(payload?.steps) ? payload.steps.find((step) => step?.id === 'boot') : null
  const bootStepMs = typeof bootStep?.ms === 'number' ? bootStep.ms : null
  const cleanupOk = payload?.cleanup?.removed === true && payload?.cleanup?.port_closed === true
  const reasons = Array.isArray(payload?.reasons) ? payload.reasons : []
  return {
    label: String(run?.label ?? 'unknown'),
    real,
    shape: String(run?.shape ?? 'unspecified'),
    conclusion,
    bootMs,
    bootStepMs,
    cleanupOk,
    hasArtifact: payload !== null,
    // Only reasons that actually accuse or withhold judgement. Info reasons (`probe.served`,
    // `probe.render-ok`, `probe.row-active`) are evidence that a run happened, not a failure
    // shape -- counting them made a batch look nine shapes deep when it had five.
    reasonIds: reasons
      .filter((reason) => reason?.severity === 'block' || reason?.severity === 'warn')
      .filter((reason) => typeof reason?.messageId === 'string')
      .map((reason) => String(reason.messageId)),
    // T-314: the boot step, split where the time actually went (null on older artifacts).
    bootSegments: payload?.timings?.bootSegments ?? null,
    phases: reasons
      .filter((reason) => reason?.severity === 'block' || reason?.severity === 'warn')
      .filter((reason) => typeof reason?.params?.phase === 'string')
      .map((reason) => String(reason.params.phase)),
  }
})

const countBy = (values) =>
  values.reduce((out, key) => {
    const name = key === null ? 'none' : String(key)
    out[name] = (out[name] ?? 0) + 1
    return out
  }, {})

const realRuns = measured.filter((run) => run.real)
const realVerdicts = countBy(realRuns.map((run) => run.conclusion))
const realDecided = (realVerdicts['go'] ?? 0) + (realVerdicts['blocked'] ?? 0)
const realGo = realVerdicts['go'] ?? 0
const realPassRate = realDecided === 0 ? null : realGo / realDecided

/** Wilson score interval: the honest way to say "9 of 10" without claiming "90%". */
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

const boots = measured.map((run) => run.bootMs).filter((value) => typeof value === 'number').sort((left, right) => left - right)
/**
 * The 20s budget is a promise about a REAL candidate's probe, so it gates on real runs only
 * (R19, HUMAN-signed: `audit/SIGNOFF.md`). A never-settling fixture costs `boot + 15s settle`
 * ≈ 21s by construction — it can never fit, and counting it would make the gate unpassable for
 * a reason that says nothing about the product. Fixtures are still measured and reported
 * separately; the check does not become a 90% rule for real runs, it stays "all of them".
 */
const realSampled = realRuns.filter((run) => run.bootMs !== null)
const realWithinBudget = realSampled.filter((run) => run.bootMs !== null && run.bootMs <= bootBudgetMs).length
const fixturesOverBudget = measured.filter((run) => !run.real && run.bootMs !== null && run.bootMs > bootBudgetMs)
const sampled = measured.filter((run) => run.bootMs !== null).length
/** Descriptive only: every sampled run inside the budget, real or not (the gate ignores this). */
const withinBudgetAll = measured.filter((run) => run.bootMs !== null && run.bootMs <= bootBudgetMs).length
/**
 * ADR-0006 (accepted 2026-10-28): the wall clock a user waits for is the whole `boot` step,
 * which includes the 15s settle wait when the tree never settles. Published, never gated.
 */
const wallClocks = measured.map((run) => run.bootStepMs).filter((value) => typeof value === 'number')
const wallClockMax = wallClocks.length === 0 ? null : Math.max(...wallClocks)

/**
 * T-314: where the boot wall clock goes, across every run that reported segments.
 *
 * WHY MAX PER SEGMENT AND NOT A SUM OF AVERAGES: the point is "what is the worst contributor",
 * and a caller can compare each maximum with `wall_clock.max_ms` to see whether one phase
 * dominates. Segments only exist on artifacts produced after R23, so the count is published.
 */
const SEGMENT_KEYS = [
  'spawn',
  'sampleWait',
  'settle',
  'readiness',
  'render',
  'kill',
  'postKillWait',
  'scratchCleanup',
]
const segmentRuns = measured
  .map((run) => run.bootSegments)
  .filter((segments) => segments !== null && typeof segments === 'object')
const segmentMax = {}
for (const key of SEGMENT_KEYS) {
  const values = segmentRuns
    .map((segments) => segments[key])
    .filter((value) => typeof value === 'number')
  segmentMax[`${key}_ms`] = values.length === 0 ? null : Math.max(...values)
}
const bootBreakdown = {
  runs_with_segments: segmentRuns.length,
  max_per_segment: segmentMax,
  note:
    'sampleWaitMs is the sample wait only; since ADR-0008 E the replacement window is opened for an {error} sample alone, so a settled:false reading converges immediately (the artifacts record inventory.replacement_waited instead of leaving it to be inferred)',
}

/**
 * A run "reliably measured" when it produced an artifact, cleaned up, stayed inside the boot
 * budget (when it sampled) and ended in a stated conclusion. `unknown` counts: refusing to
 * judge a tree that never settled is a correct answer, not a broken run. The budget term only
 * applies to real candidates, for the same reason as above.
 */
const reliable = measured.filter(
  (run) =>
    run.hasArtifact &&
    run.cleanupOk &&
    run.conclusion !== null &&
    (run.bootMs === null || !run.real || run.bootMs <= bootBudgetMs),
)
const reliabilityRate = measured.length === 0 ? 0 : reliable.length / measured.length

/** Distinct failure shapes: conclusion + reason (+ the phase, so failed ≠ missing fiber). */
const shapes = new Map()
for (const run of measured) {
  if (run.conclusion === null || run.conclusion === 'go') continue
  const phases = run.phases.length === 0 ? [''] : run.phases
  for (const messageId of run.reasonIds.length === 0 ? ['(no reason)'] : run.reasonIds) {
    for (const phase of phases) {
      const key = `${run.conclusion}:${messageId}${phase === '' ? '' : `(${phase})`}`
      const entry = shapes.get(key) ?? { shape: key, runs: [] }
      if (!entry.runs.includes(run.label)) entry.runs.push(run.label)
      shapes.set(key, entry)
    }
  }
}
const failureShapes = [...shapes.values()].sort((left, right) => left.shape.localeCompare(right.shape))

const checks = [
  {
    id: 'min-real-runs',
    ok: realRuns.length >= minReal,
    detail: `${realRuns.length} real run(s), need ${minReal}`,
  },
  {
    id: 'cleanup-complete',
    ok: measured.every((run) => run.cleanupOk),
    detail: measured.every((run) => run.cleanupOk)
      ? `${measured.length}/${measured.length} cleaned up`
      : `${measured.filter((run) => run.cleanupOk).length}/${measured.length} cleaned up`,
  },
  {
    id: 'boot-budget',
    // Real runs only (R19, HUMAN-signed): see the comment above `realSampled`.
    ok: realSampled.length === realWithinBudget,
    detail:
      `${realWithinBudget}/${realSampled.length} real sampled run(s) within ${bootBudgetMs}ms` +
      (fixturesOverBudget.length === 0
        ? ''
        : ` · ${fixturesOverBudget.length} fixture(s) over budget by construction (${fixturesOverBudget
            .map((run) => `${run.label}=${run.bootMs}ms`)
            .join(', ')})`),
  },
  {
    id: 'probe-reliability',
    ok: reliabilityRate >= minReliability,
    detail: `${Math.round(reliabilityRate * 1000) / 10}% produced an artifact, cleaned up and stated a conclusion (need ${Math.round(minReliability * 1000) / 10}%)`,
  },
  {
    id: 'failure-shapes',
    ok: failureShapes.length >= minShapes,
    detail: `${failureShapes.length} distinct failure shape(s), need ${minShapes}`,
  },
]

const gatePassed = checks.every((check) => check.ok)

const artifact = {
  schema_version: 1,
  produced_by: 'scripts/d2_report.mjs',
  generated_at: stamp,
  source: {
    matrix: displayPath(matrixPath),
    matrix_sha256: createHash('sha256').update(matrixText).digest('hex'),
    matrix_generated_at: matrix.generated_at ?? null,
    plan: matrix.plan?.path ?? null,
  },
  definitions: {
    probe_reliability:
      'a run counts when it produced an artifact, the sandbox was removed, every port it used is closed, the boot stayed inside the budget (real runs only — see R19 below), and the run stated a conclusion (unknown included: refusing to judge an unsettled tree is an answer)',
    real_pass_rate: 'go / (go + blocked) over real runs; unknown is listed separately and never folded into either side',
    failure_shape: 'conclusion + reason messageId (+ the row phase when the reason names one)',
    boot_budget:
      'the 20s boot budget gates REAL candidates only. A fixture built to never settle costs boot + the 15s settle timeout ≈ 21s by construction, so counting it would fail the gate for a reason that says nothing about a candidate. Fixture timings are published below and never hidden (R19, HUMAN-signed)',
  },
  denominator: {
    runs: measured.length,
    real_runs: realRuns.length,
    real_booted: realRuns.filter((run) => run.bootMs !== null).length,
    non_real_runs: measured.length - realRuns.length,
    min_real_required: minReal,
    enough: realRuns.length >= minReal,
  },
  verdicts: countBy(measured.map((run) => run.conclusion)),
  real_verdicts: realVerdicts,
  probe_reliability: {
    runs: measured.length,
    reliable: reliable.length,
    unknown_runs: measured.filter((run) => run.conclusion === 'unknown').length,
    rate: Math.round(reliabilityRate * 1000) / 1000,
    threshold: minReliability,
  },
  real_pass_rate: {
    go: realGo,
    blocked: realVerdicts['blocked'] ?? 0,
    unknown: realVerdicts['unknown'] ?? 0,
    decided: realDecided,
    rate: realPassRate === null ? null : Math.round(realPassRate * 1000) / 1000,
    wilson95: wilson(realGo, realDecided),
  },
  timing: {
    sampled,
    budget_ms: bootBudgetMs,
    // Two scopes on purpose: what the gate reads, and what actually happened (R19).
    real_sampled: realSampled.length,
    real_within_budget: realWithinBudget,
    fixtures_over_budget: fixturesOverBudget.map((run) => ({ label: run.label, boot_to_sample_ms: run.bootMs })),
    within_budget: withinBudgetAll,
    min: boots[0] ?? null,
    median: boots.length === 0 ? null : boots[Math.floor(boots.length / 2)],
    max: boots.at(-1) ?? null,
    // ADR-0006: what a human actually waits for. Recorded, not judged.
    wall_clock: {
      max_ms: wallClockMax,
      source: 'steps[boot].ms — the whole step, including the settle wait and the kill wait',
      note:
        'measured (T-314): a judged candidate is dominated by the sample wait plus render + kill + post-kill; a tree that never settles no longer pays a replacement window — ADR-0008 E removed it for settled:false samples (that window alone was ≈20s in R23), so what is left is the hook settle plus the same render/kill tail',
    },
    // T-314: the segmentation behind `wall_clock`. Descriptive only.
    boot_breakdown: bootBreakdown,
  },
  cleanup: { ok: measured.filter((run) => run.cleanupOk).length, checked: measured.length },
  failure_shapes: failureShapes,
  gate: { passed: gatePassed, checks },
  limits: [
    'real plugins are a convenience sample picked by hand from npm search, not a random sample of the ecosystem',
    'the pass rate says "this batch of pinned plugins composes on this sandbox runtime", not "plugins work"',
    'synthetic and fixture failures are labelled and excluded from the pass rate; they only count as shapes',
    'measured on one machine / one sandbox runtime (0.2.1-rc.4); there is no Linux or macOS probe evidence yet',
  ],
}

mkdirSync(outDir, { recursive: true })
const fileName = `d2-${stamp.replaceAll(':', '-')}.json`
const target = join(outDir, fileName)
const text = `${JSON.stringify(artifact, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${createHash('sha256').update(text).digest('hex')}\n`, 'utf8')

if (asJson) {
  process.stdout.write(text)
} else {
  process.stdout.write(`D2 · ${displayPath(target)}\n`)
  process.stdout.write(
    `  real runs   ${realRuns.length} (booted ${artifact.denominator.real_booted}) · enough=${artifact.denominator.enough}\n`,
  )
  process.stdout.write(
    `  verdicts    ${JSON.stringify(artifact.verdicts)} · real ${JSON.stringify(realVerdicts)}\n`,
  )
  process.stdout.write(
    `  reliability ${artifact.probe_reliability.reliable}/${artifact.probe_reliability.runs} = ${artifact.probe_reliability.rate}\n`,
  )
  process.stdout.write(
    `  pass rate   ${realGo}/${realDecided}${artifact.real_pass_rate.wilson95 === null ? '' : ` · Wilson95 ${artifact.real_pass_rate.wilson95.join('–')}`}\n`,
  )
  process.stdout.write(
    `  timing      ${artifact.timing.min}–${artifact.timing.max}ms (${artifact.timing.within_budget}/${artifact.timing.sampled} within budget)\n`,
  )
  process.stdout.write(`  shapes      ${failureShapes.length}: ${failureShapes.map((entry) => entry.shape).join(', ')}\n`)
  for (const check of checks) process.stdout.write(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.id} — ${check.detail}\n`)
  process.stdout.write(`  gate        ${gatePassed ? 'PASSED' : 'NOT PASSED'}\n`)
}
