#!/usr/bin/env node
/**
 * Stability report: the same plan, run N times, described as a distribution instead of a point.
 *
 * WHY THIS EXISTS (`BS-32`, T-319): the project kept saying "one probe takes ≈X seconds" and was
 * wrong every time the sample loop happened to start late — the same pinned candidate measured
 * 8.0s, 22.5s and 23.8s on one machine. A single number is not a measurement of a spread. This
 * script takes several matrix artifacts of the SAME plan, keeps every observation, and publishes
 * min/median/max/p90 plus how many runs crossed the 20s budget. It deliberately does not gate:
 * the budget gate is `d2_report`'s job, and a spread is evidence, not a verdict.
 *
 *   node scripts/stability_report.mjs --matrix data/results/probe-matrix-A.json --matrix data/results/probe-matrix-B.json
 *   node scripts/stability_report.mjs --glob data/results/probe-matrix-2026-10-28T1*.json
 *   node scripts/stability_report.mjs --matrix A --matrix B --matrix C --stamp 2026-10-28T17:00:00.000Z
 *
 * Exit codes: 0 report written · 2 bad usage (including "fewer than two matrices": a spread of one
 * run is not a spread, and pretending otherwise is how "≈8s" got published in the first place).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const values = (name) => argv.flatMap((value, index) => (value === name ? [argv[index + 1]] : [])).filter((value) => typeof value === 'string')
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
if (stamp === null) {
  process.stderr.write('invalid --stamp; expected ISO-8601\n')
  process.exit(2)
}

const explicit = values('--matrix').map(pathFor)
const glob = argOf('--glob', null)
const outDir = pathFor(argOf('--out', 'data/results'))
const budget = Number(argOf('--budget-ms', '20000'))

let inputs = explicit
if (inputs.length === 0 && typeof glob === 'string') {
  const dir = pathFor('data/results')
  const prefix = glob.split('/').pop() ?? ''
  const pattern = new RegExp(`^${prefix.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  inputs = readdirSync(dir)
    .filter((name) => pattern.test(name) && name.endsWith('.json'))
    .map((name) => join(dir, name))
    .sort()
}
if (inputs.length < 2) {
  process.stderr.write(`need at least 2 matrices (got ${inputs.length}): one observation has no spread\n`)
  process.exit(2)
}
for (const path of inputs) {
  if (!existsSync(path)) {
    process.stderr.write(`matrix not found: ${path}\n`)
    process.exit(2)
  }
}

const percentile = (sorted, fraction) => {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index]
}
const median = (sorted) => {
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle]
}
const describe = (values_) => {
  const sorted = values_.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b)
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    median: median(sorted),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1] ?? null,
  }
}

const matrices = inputs.map((path) => {
  const text = readFileSync(path, 'utf8')
  const payload = JSON.parse(text.replace(/^\uFEFF/, ''))
  if (!Array.isArray(payload.runs)) {
    process.stderr.write(`${path}: expected a recorded matrix (runs[])\n`)
    process.exit(2)
  }
  return { path, sha256: createHash('sha256').update(text).digest('hex'), payload }
})

/** label → every observation across the batches. */
const byLabel = new Map()
for (const matrix of matrices) {
  for (const run of matrix.payload.runs) {
    const label = String(run.label ?? '?')
    const entry = byLabel.get(label) ?? {
      label,
      real: run.real === true,
      shape: run.shape ?? null,
      verdicts: new Map(),
      boot: [],
      wait: [],
      final: [],
      install: [],
      exceeded: 0,
      batches: 0,
    }
    const payload = run.artifact?.payload ?? {}
    const boot = typeof run.boot_to_sample_ms === 'number' ? run.boot_to_sample_ms : payload.timings?.bootToSampleMs
    // A run that never booted (install failure) contributes a verdict but no timing.
    if (typeof boot === 'number') {
      entry.boot.push(boot)
      if (boot > budget) entry.exceeded += 1
    }
    const wait = payload.inventory?.wait_ms
    if (typeof wait === 'number') entry.wait.push(wait)
    const final = payload.timings?.bootToFinalSampleMs
    if (typeof final === 'number') entry.final.push(final)
    if (typeof run.install_ms === 'number') entry.install.push(run.install_ms)
    const verdict = String(run.conclusion ?? 'unknown')
    entry.verdicts.set(verdict, (entry.verdicts.get(verdict) ?? 0) + 1)
    entry.batches += 1
    byLabel.set(label, entry)
  }
}

const candidates = [...byLabel.values()]
  .map((entry) => {
    const verdicts = Object.fromEntries([...entry.verdicts.entries()].sort())
    const distinct = Object.keys(verdicts).length
    return {
      label: entry.label,
      real: entry.real,
      shape: entry.shape,
      runs: entry.batches,
      verdicts,
      // "unstable" means the same pinned candidate produced more than one conclusion across runs:
      // that is the shape worth showing, and `unknown` counts as a different answer, not as noise.
      verdict_stable: distinct === 1,
      boot_to_sample_ms: { ...describe(entry.boot), exceeded_budget: entry.exceeded, budget_ms: budget },
      hook_wait_ms: describe(entry.wait),
      boot_to_final_sample_ms: describe(entry.final),
      install_ms: describe(entry.install),
    }
  })
  .sort((a, b) => Number(b.real) - Number(a.real) || a.label.localeCompare(b.label))

const real = candidates.filter((candidate) => candidate.real)
const realObservations = matrices.flatMap((matrix) =>
  matrix.payload.runs
    .filter((run) => run.real === true)
    .map((run) => (typeof run.boot_to_sample_ms === 'number' ? run.boot_to_sample_ms : run.artifact?.payload?.timings?.bootToSampleMs))
    .filter((value) => typeof value === 'number'),
)
const unstable = candidates.filter((candidate) => candidate.verdict_stable === false)

const artifact = {
  schema_version: 1,
  produced_by: 'scripts/stability_report.mjs',
  generated_at: stamp,
  inputs: matrices.map((matrix) => ({
    path: displayPath(matrix.path),
    sha256: matrix.sha256,
    plan: matrix.payload.plan?.path ?? null,
    generated_at: matrix.payload.generated_at ?? null,
    runs: matrix.payload.runs.length,
  })),
  summary: {
    matrices: matrices.length,
    candidates: candidates.length,
    real_candidates: real.length,
    real_observations: realObservations.length,
    real_boot_to_sample_ms: describe(realObservations),
    real_runs_over_budget: realObservations.filter((value) => value > budget).length,
    budget_ms: budget,
    verdict_unstable: unstable.map((candidate) => candidate.label),
    // A spread of one run is not a spread; the schema enforces >= 2 matrices, and this states it.
    min_runs_per_candidate: Math.min(...candidates.map((candidate) => candidate.runs)),
  },
  candidates,
  definitions: {
    verdict_stable:
      'every run of this pinned candidate produced the SAME conclusion; `unknown` is a real answer, so go→unknown counts as unstable',
    boot_to_sample_ms:
      'the judged budget: spawn → the FIRST sample. T-312 made this the provisional sample, so it no longer includes the final settle',
    hook_wait_ms: "the hook's own settle wait, published in the inventory block (`wait_ms`)",
    exceeded_budget: `runs whose boot_to_sample_ms > ${budget}ms (published per candidate, never hidden)`,
    real_runs_over_budget: 'aggregate over real candidates only; fixtures are kept in the per-candidate rows',
  },
  limits: [
    'same machine, same sandbox runtime, same plan: this describes one Windows box, not the ecosystem',
    'the spread is what it is; a low p90 does not promise anything about the next run (`BS-32`)',
    'real candidates are a hand-picked convenience sample (`BS-27`)',
    'no gate here on purpose: the budget gate lives in `d2_report` (T-317 --strict for automation)',
  ],
}

function displayPath(path) {
  const root = abs('.')
  const normalized = path.replaceAll('\\', '/')
  const base = root.replaceAll('\\', '/')
  return normalized.startsWith(base) ? normalized.slice(base.length + 1) : normalized
}

mkdirSync(outDir, { recursive: true })
const target = join(outDir, `stability-${stamp.replaceAll(':', '-')}.json`)
const text = `${JSON.stringify(artifact, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${createHash('sha256').update(text).digest('hex')}\n`, 'utf8')

process.stdout.write(`stability · ${displayPath(target)}\n`)
process.stdout.write(`  matrices     ${matrices.length} · candidates ${candidates.length} (real ${real.length})\n`)
process.stdout.write(
  `  real boot→sample  ${artifact.summary.real_boot_to_sample_ms.min}–${artifact.summary.real_boot_to_sample_ms.max}ms` +
    ` · median ${artifact.summary.real_boot_to_sample_ms.median} · p90 ${artifact.summary.real_boot_to_sample_ms.p90}` +
    ` · over ${budget}ms: ${artifact.summary.real_runs_over_budget}/${realObservations.length}\n`,
)
process.stdout.write(
  `  unstable verdicts ${unstable.length === 0 ? 'none' : unstable.map((candidate) => `${candidate.label} ${JSON.stringify(candidate.verdicts)}`).join('; ')}\n`,
)
for (const candidate of candidates.filter((entry) => entry.real)) {
  const boot = candidate.boot_to_sample_ms
  process.stdout.write(
    `    ${candidate.label.padEnd(26)} ${JSON.stringify(candidate.verdicts).padEnd(24)} ` +
      `boot ${String(boot.min).padStart(5)}–${String(boot.max).padEnd(5)} median ${String(boot.median).padStart(5)} ` +
      `wait ${String(candidate.hook_wait_ms.min).padStart(5)}–${String(candidate.hook_wait_ms.max).padEnd(5)}` +
      ` ${boot.exceeded_budget > 0 ? `· ${boot.exceeded_budget}/${boot.n} over budget` : ''}\n`,
  )
}
