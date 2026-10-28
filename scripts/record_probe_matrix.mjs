#!/usr/bin/env node
/**
 * Probe matrix (D2 denominator).
 *
 * D2 asks "does the probe succeed ≥90% of the time within 20s, and always clean up?".
 * That question needs a denominator, and a denominator needs more than one candidate. This
 * script runs N pinned candidates through `record_probe.mjs`, then writes ONE summary that
 * EMBEDS every run's artifact (redacted) plus its sha256, so the batch is self-contained
 * evidence even though the per-run files live in a scratch directory.
 *
 * WHY THE RUNS GO TO A SCRATCH DIR: each `probe-*.json` in `data/results` is a reviewed
 * step (`gate step-review` forbids orphans). A matrix is a *batch*; its SSOT is the summary.
 *
 *   node scripts/record_probe_matrix.mjs --plan tests/fixtures/probe/matrix-r16.json \
 *     --dsh-main <bin.js> --stamp 2026-10-27T14:40:00.000Z
 *
 * Exit codes: 0 recorded · 1 a run did not meet its expectation · 2 bad usage.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { makeRedactor } from './lib/live.mjs'

const argv = process.argv.slice(2)
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
const planPath = pathFor(String(argOf('--plan', '')))
const dshMain = pathFor(String(argOf('--dsh-main', '')))
const installDir = pathFor(String(argOf('--install', '')))
const outDir = pathFor(String(argOf('--out', 'data/results')))
const browser = argOf('--browser', null)
if (planPath === '' || !existsSync(planPath) || dshMain === '') {
  process.stderr.write('usage: node scripts/record_probe_matrix.mjs --plan <file.json> --dsh-main <bin.js> [--install <dir>] [--browser <path>] [--stamp <iso>]\n')
  process.exit(2)
}

const plan = JSON.parse(readFileSync(planPath, 'utf8').replace(/^\uFEFF/, ''))
if (!Array.isArray(plan.candidates) || plan.candidates.length === 0) {
  process.stderr.write(`${planPath}: expected { candidates: [{ label, spec, expect }] }\n`)
  process.exit(2)
}

const scratch = mkdtempSync(join(tmpdir(), 'triage-matrix-'))
const redact = makeRedactor([abs('.'), homedir(), tmpdir()])
const runs = []
let expectationMisses = 0

/**
 * OPTIONAL BACKGROUND LOAD (`--load <n>`), for `BS-32`'s second half.
 *
 * WHY (R36→R37): every stability batch so far was taken on an idle machine, so the project could
 * describe a spread but not its source. This flag starts `n` CPU-busy Node processes for the whole
 * batch and records what the machine actually did (`observed_busy_percent`, computed from
 * `os.cpus()` deltas — `os.loadavg()` is always 0 on Windows, so it would be a fake reading).
 *
 * WHAT IT IS NOT: a benchmark harness. The busy loop is one shape of load (CPU saturation in this
 * user), chosen because it is measurable, reproducible, and leaves the disk/network mostly alone —
 * a disk-heavy load would confound install time with boot time.
 */
const loadWorkers = Number(argOf('--load', '0'))
const loadState = startLoad(loadWorkers)

for (const [index, candidate] of plan.candidates.entries()) {
  const label = String(candidate.label ?? `run-${index + 1}`).replace(/[^a-zA-Z0-9._-]+/g, '-')
  // One second apart so file names stay unique and ordered.
  const runStamp = new Date(Date.parse(stamp) + index * 1000).toISOString()
  const args = [
    'scripts/record_probe.mjs',
    '--candidate', String(candidate.spec),
    '--dsh-main', dshMain,
    '--label', label,
    '--out', scratch,
    '--stamp', runStamp,
  ]
  if (installDir !== '') args.push('--install', installDir)
  if (browser !== null) args.push('--browser', String(browser))
  if (candidate.expect !== undefined) args.push('--expect', String(candidate.expect))
  if (candidate.registry !== undefined) args.push('--registry', String(candidate.registry))
  if (candidate.npmrcRegistry !== undefined) args.push('--npmrc-registry', String(candidate.npmrcRegistry))
  // R17: a candidate that needs a longer readiness window may ask for one; the default stays
  // the documented 5s for a settled tree.
  if (candidate.readinessTimeoutMs !== undefined) args.push('--readiness-timeout', String(candidate.readinessTimeoutMs))
  if (candidate.unsettledTimeoutMs !== undefined) args.push('--unsettled-timeout', String(candidate.unsettledTimeoutMs))

  process.stdout.write(`\n[${index + 1}/${plan.candidates.length}] ${label} ← ${candidate.spec}\n`)
  const started = Date.now()
  const child = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 900_000 })
  const ms = Date.now() - started
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`.trim()
  const artifactPath = join(scratch, `probe-${label}-${runStamp.replaceAll(':', '-')}.json`)
  let artifact = null
  if (existsSync(artifactPath)) {
    const text = readFileSync(artifactPath, 'utf8')
    artifact = {
      path: `probe-${label}-${runStamp.replaceAll(':', '-')}.json`,
      sha256: createHash('sha256').update(text).digest('hex'),
      payload: JSON.parse(text),
    }
  }
  const expectationMet = artifact === null ? false : artifact.payload.expectation_met !== false
  if (!expectationMet) expectationMisses += 1
  runs.push({
    label,
    spec: String(candidate.spec),
    shape: String(candidate.shape ?? 'unspecified'),
    // `real` marks a candidate that is a genuine plugin rather than a deliberately broken
    // shape. D2's denominator only counts these (R17).
    real: candidate.real === true || String(candidate.shape ?? '').startsWith('real'),
    expect: candidate.expect ?? null,
    exit: child.status,
    ms,
    expectation_met: expectationMet,
    conclusion: artifact?.payload?.conclusion ?? null,
    boot_to_sample_ms: artifact?.payload?.timings?.bootToSampleMs ?? null,
    install_ms: artifact?.payload?.timings?.installMs ?? null,
    render_ms: artifact?.payload?.timings?.renderMs ?? null,
    cleanup_ok:
      artifact === null
        ? null
        : artifact.payload.cleanup?.removed === true && artifact.payload.cleanup?.port_closed === true,
    assertion_shape: artifact === null ? null : shapeOf(artifact.payload.assertions ?? []),
    artifact: artifact === null ? null : { path: artifact.path, sha256: artifact.sha256, payload: artifact.payload },
    output_tail: artifact === null ? redact(output.split(/\r?\n/).slice(-6).join('\n')) : null,
  })
}

const summary = summarize(runs)
const load = stopLoad(loadState)
const matrix = {
  schema_version: 1,
  produced_by: 'scripts/record_probe_matrix.mjs',
  generated_at: stamp,
  plan: { path: redact(planPath), candidates: plan.candidates.length, note: plan.note ?? null },
  /*
   * R37 (`BS-32` second half): what the machine was doing during this batch. `workers: 0` means an
   * idle-machine batch; anything else is a loaded batch and must be read as such.
   */
  load,
  runs,
  summary,
  limits: [
    'synthetic failures (missing package, bogus version, unreachable registry) are labeled by shape; they are not evidence about real plugin quality',
    'each run is embedded verbatim (already redacted by record_probe) with its own sha256',
    'boot→sample is the only timing judged against the 20s budget; install and render are separate segments',
    'n is still small: a percentage is a description of this batch, not a population estimate',
    ...(load.workers === 0
      ? []
      : [
          'this batch ran under locally generated CPU load; it describes the probe under THAT load, not the default budget path',
          'the load is CPU-busy loops in this user account, not memory/disk/network pressure and not parallel probe runs',
        ]),
  ],
}

mkdirSync(outDir, { recursive: true })
const target = join(outDir, `probe-matrix-${stamp.replaceAll(':', '-')}.json`)
const text = `${JSON.stringify(matrix, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

process.stdout.write(`\n${JSON.stringify(summary, null, 1)}\n`)
process.stdout.write(`wrote ${target}\n`)
process.exitCode = expectationMisses === 0 ? 0 : 1

/* --------------------------------- helpers -------------------------------- */

/**
 * Start `workers` CPU-busy Node processes for the duration of the batch.
 *
 * Busy is a tight loop that touches `Date.now()` every iteration: without a syscall the JIT can turn
 * an empty loop into nothing, and then "loaded" would be a label with no load behind it.
 */
function startLoad(workers) {
  const cores = cpus().length
  const state = {
    workers: Number.isFinite(workers) && workers > 0 ? Math.floor(workers) : 0,
    cores,
    kind: 'cpu-busy-loop',
    started_at: null,
    ended_at: null,
    duration_ms: null,
    cpu: null,
    children: [],
    killed: null,
  }
  if (state.workers === 0) {
    delete state.children
    return state
  }
  state.cpu = cpuTimes()
  state.started_at = new Date().toISOString()
  const source = 'const end = Date.now() + 6 * 60 * 60 * 1000; while (Date.now() < end) {}'
  for (let index = 0; index < state.workers; index += 1) {
    const child = spawn(process.execPath, ['-e', source], { stdio: 'ignore', windowsHide: true })
    child.on('error', () => {
      // A worker that cannot start is reported by `killed`/count rather than crashing the batch.
    })
    state.children.push(child)
  }
  process.stdout.write(`load: ${state.workers} cpu-busy worker(s) on ${cores} core(s) for the whole batch\n`)
  return state
}

/** Stop the load and measure what the machine actually did meanwhile. */
function stopLoad(state) {
  if (state.workers > 0) {
    let killed = 0
    for (const child of state.children) {
      try {
        child.kill('SIGKILL')
        killed += 1
      } catch {
        // Already gone; the count below is what the artifact reports.
      }
    }
    state.killed = killed
    state.ended_at = new Date().toISOString()
    state.duration_ms = Date.parse(state.ended_at) - Date.parse(state.started_at)
    const after = cpuTimes()
    if (state.cpu !== null && after.total > state.cpu.total) {
      const idleDelta = after.idle - state.cpu.idle
      const totalDelta = after.total - state.cpu.total
      state.cpu = {
        source: 'os.cpus() cumulative times, delta over the batch',
        observed_busy_percent: Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10,
      }
    } else {
      state.cpu = { source: 'os.cpus() cumulative times', observed_busy_percent: null }
    }
    delete state.children
  }
  return state
}

/** Aggregate cumulative CPU times; `loadavg` is unusable on Windows, this is not. */
function cpuTimes() {
  let idle = 0
  let total = 0
  for (const core of cpus()) {
    const times = core.times
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total }
}

function shapeOf(assertions) {
  return assertions
    .filter((item) => item.status !== 'passed')
    .map((item) => `${item.id}:${item.status}`)
    .sort()
    .join(',') || 'all-passed'
}

function summarize(entries) {
  const boots = entries.map((entry) => entry.boot_to_sample_ms).filter((value) => typeof value === 'number').sort((a, b) => a - b)
  const installs = entries.map((entry) => entry.install_ms).filter((value) => typeof value === 'number').sort((a, b) => a - b)
  const reachedBoot = entries.filter((entry) => typeof entry.boot_to_sample_ms === 'number')
  const byConclusion = entries.reduce((out, entry) => {
    const key = entry.conclusion ?? 'no-artifact'
    out[key] = (out[key] ?? 0) + 1
    return out
  }, {})
  return {
    n: entries.length,
    by_conclusion: byConclusion,
    // D2 is "how often does a real candidate probe cleanly". Synthetic failure shapes are
    // labelled and excluded from that count instead of being averaged in (R17).
    real_starts: entries.filter((entry) => entry.real).length,
    real_by_conclusion: entries
      .filter((entry) => entry.real)
      .reduce((out, entry) => {
        const key = entry.conclusion ?? 'no-artifact'
        out[key] = (out[key] ?? 0) + 1
        return out
      }, {}),
    synthetic_failures: entries.filter((entry) => !entry.real).length,
    expectation_misses: entries.filter((entry) => !entry.expectation_met).length,
    cleanup_ok: entries.filter((entry) => entry.cleanup_ok === true).length,
    cleanup_checked: entries.filter((entry) => entry.cleanup_ok !== null).length,
    boot_to_sample_ms: {
      n: boots.length,
      min: boots[0] ?? null,
      median: boots.length === 0 ? null : boots[Math.floor(boots.length / 2)],
      max: boots.at(-1) ?? null,
      within_20s: reachedBoot.filter((entry) => entry.boot_to_sample_ms <= 20_000).length,
    },
    install_ms: {
      n: installs.length,
      min: installs[0] ?? null,
      median: installs.length === 0 ? null : installs[Math.floor(installs.length / 2)],
      max: installs.at(-1) ?? null,
    },
    shapes: entries.map((entry) => ({ label: entry.label, shape: entry.shape, assertion_shape: entry.assertion_shape })),
  }
}
