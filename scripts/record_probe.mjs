#!/usr/bin/env node
/**
 * Probe recorder (M3 / T-301 · the artifact side).
 *
 * WHAT IT DOES, IN ORDER:
 *   1. builds the isolation plan for one candidate (sandbox `DSH_HOME`, own port);
 *   2. really installs it, boots the sandbox Host with the inventory probe overlay,
 *      measures readiness **while the Host is alive**, then kills the tree;
 *   3. judges what happened with `judgeProbe` (the same function the CLI uses);
 *   4. writes ONE artifact: `data/results/probe-<label>-<stamp>.json` + `.sha256`.
 *
 * WHY `--expect` EXISTS: a red run is a *finding*, not an infrastructure failure. Passing
 * `--expect blocked` makes the script exit 1 when the candidate unexpectedly works, so a
 * silently broken fixture cannot pass as proof.
 *
 *   node scripts/record_probe.mjs \
 *     --candidate tests/fixtures/probe/ok-plugin \
 *     --dsh-main sandbox/upstream/0.2.1-rc.4/install/node_modules/@deepseek-ai/dsh/lib/bin.js \
 *     --install sandbox/upstream/0.2.1-rc.4/install \
 *     --label ok --expect go --stamp 2026-10-28T02:00:00.000Z
 *
 * Exit codes: 0 recorded and matched · 1 recorded but the expectation was not met
 * · 2 bad usage · 3 could not record (the plan was refused).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { makeRedactor, redactDeep } from './lib/live.mjs'
import { buildProbePlan, executeProbe, judgeProbe } from '../packages/probe/dist/index.js'
import { candidatePackageName, normalizeCandidateSpec, probeScratchRoot, realProbeDeps } from '../packages/plugin/dist/probe-run.js'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = argOf('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-10-28T02:00:00.000Z\n`)
  process.exit(2)
}

const rawCandidate = String(argOf('--candidate', ''))
if (rawCandidate === '') {
  process.stderr.write('usage: node scripts/record_probe.mjs --candidate <path|spec> --dsh-main <bin.js> [--install <dir>] [--label ok] [--expect go|blocked] [--stamp <iso>]\n')
  process.exit(2)
}
const candidate = normalizeCandidateSpec(rawCandidate)
const dshMain = pathFor(String(argOf('--dsh-main', '')))
if (dshMain === '' || !existsSync(dshMain)) {
  process.stderr.write(`missing --dsh-main (launcher entry), got "${dshMain}"\n`)
  process.exit(2)
}
const installDir = pathFor(String(argOf('--install', '')))
const profile = String(argOf('--profile', 'web'))
const label = String(argOf('--label', 'probe')).replace(/[^a-zA-Z0-9._-]+/g, '-')
const expectation = argOf('--expect', null)
const outDir = pathFor(String(argOf('--out', 'data/results')))
const realDshHome = pathFor(String(argOf('--dsh-home', join(process.env['USERPROFILE'] ?? homedir(), '.dsh'))))

const candidatePackage = candidatePackageName(candidate)
if (candidatePackage === null) {
  process.stderr.write(`cannot determine which package "${candidate}" installs as\n`)
  process.exit(2)
}

const plan = buildProbePlan({
  candidate,
  realDshHome,
  workRoot: probeScratchRoot(),
  profile,
  dshBin: dshMain,
})
if (!plan.ok) {
  process.stderr.write(`probe plan refused: ${plan.error.code} (${plan.error.detail})\n`)
  process.exit(3)
}

const run = await executeProbe({ plan: plan.value, dshMain, candidatePackage }, realProbeDeps())
const judgement = judgeProbe({ run, at: stamp })
const expectationMet = expectation === null ? null : judgement.conclusion === String(expectation)

const redact = makeRedactor([abs('.'), homedir(), tmpdir(), realDshHome, installDir, plan.value.sandboxHome].filter((root) => root !== ''))

const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_probe.mjs',
  generated_at: stamp,
  label,
  expectation: expectation === null ? null : String(expectation),
  expectation_met: expectationMet,
  candidate: {
    spec: redact(candidate),
    package: candidatePackage,
    kind: /^[A-Za-z]:[\\/]|^\//.test(candidate) || candidate.startsWith('file:') ? 'path' : 'registry',
  },
  runtime: {
    source: installDir === '' ? '(not supplied)' : redact(installDir),
    version: run.runtimeVersion,
    dsh_main: redact(dshMain),
  },
  sandbox: {
    home: redact(plan.value.sandboxHome),
    profile: plan.value.profile,
    overlap_check: 'disjoint (validateProbePlan)',
    env_scrubbed: true,
  },
  steps: run.steps.map((step) => ({ ...step, detail: step.detail === null ? null : redact(step.detail) })),
  timings: run.timings,
  assertions: judgement.assertions.map((assertion) => ({
    ...assertion,
    detail: assertion.detail === null ? null : redact(assertion.detail),
  })),
  inventory: {
    transport: run.sample === null ? null : run.sample.transport,
    entries: run.sample === null ? null : run.sample.entries,
    wait_ms: run.sample === null ? null : run.sample.waitMs,
    candidate_rows: run.sample === null ? [] : run.sample.candidateRows.map((row) => ({ ...row, moduleName: redact(row.moduleName) })),
    excluded: run.sample === null ? [] : [...run.sample.excluded],
    error: run.sample === null || run.sample.error === null ? null : redact(run.sample.error),
  },
  http: run.http === null ? null : { status: run.http.status, detail: redact(run.http.detail) },
  cleanup: {
    removed: run.cleanup.removed,
    port_closed: run.cleanup.portClosed,
    detail: redact(run.cleanup.detail),
  },
  conclusion: judgement.conclusion,
  confidence: judgement.confidence,
  reasons: judgement.reasons.map((reason) => ({
    ...reason,
    ...(reason.params === undefined ? {} : { params: redactDeep(reason.params, redact) }),
  })),
  evidence: judgement.evidence.map((item) => ({ ...item, source: redact(item.source), ...(item.detail === undefined ? {} : { detail: redact(item.detail) }) })),
  missing_evidence: [...judgement.missingEvidence],
  // The honest boundary, in the artifact itself rather than only in a doc.
  limits: [
    'answers boot + HTTP + candidate row phase only',
    'does not judge security or maliciousness (COMPLIANCE.md §5)',
    'does not check that the client renders (T-302) or that tools registered (T-303)',
    'measured on a sandbox runtime, not on the user machine',
    'a plugin that needs credentials is unverified, not verified-safe',
  ],
}

mkdirSync(outDir, { recursive: true })
const fileName = `probe-${label}-${stamp.replaceAll(':', '-')}.json`
const target = join(outDir, fileName)
const text = `${JSON.stringify(redactDeep(artifact, redact), null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

process.stdout.write(`wrote ${target}\n`)
process.stdout.write(
  `${judgement.conclusion} · ${candidatePackage} · boot→sample ${
    run.timings.bootToSampleMs === null ? 'n/a' : `${Math.round(run.timings.bootToSampleMs / 100) / 10}s`
  } · http ${run.http === null ? 'n/a' : run.http.status} · rows ${run.sample === null ? 0 : run.sample.candidateRows.length}\n`,
)
if (expectation !== null && expectationMet === false) {
  process.stderr.write(`expectation not met: expected ${expectation}, got ${judgement.conclusion}\n`)
  process.exit(1)
}
process.exit(0)
