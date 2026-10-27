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

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
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
const matrix = {
  schema_version: 1,
  produced_by: 'scripts/record_probe_matrix.mjs',
  generated_at: stamp,
  plan: { path: redact(planPath), candidates: plan.candidates.length, note: plan.note ?? null },
  runs,
  summary,
  limits: [
    'synthetic failures (missing package, bogus version, unreachable registry) are labeled by shape; they are not evidence about real plugin quality',
    'each run is embedded verbatim (already redacted by record_probe) with its own sha256',
    'boot→sample is the only timing judged against the 20s budget; install and render are separate segments',
    'n is still small: a percentage is a description of this batch, not a population estimate',
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
