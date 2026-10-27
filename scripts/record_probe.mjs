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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  process.stderr.write('usage: node scripts/record_probe.mjs --candidate <path|name@x.y.z> --dsh-main <bin.js> [--install <dir>] [--label ok] [--expect go|blocked|unknown] [--browser <path>] [--registry <url>] [--stamp <iso>]\n')
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
const browser = argOf('--browser', null)
const registryOverride = argOf('--registry', null)

const candidatePackage = candidatePackageName(candidate)
if (candidatePackage === null) {
  process.stderr.write(`cannot determine which package "${candidate}" installs as\n`)
  process.exit(2)
}
const candidateKind = /^[A-Za-z]:[\\/]|^\//.test(candidate) || candidate.startsWith('file:') ? 'path' : 'registry'

// ADR-0004: an external candidate is only accepted as an exact pin, so the artifact can
// say which bytes ran. A range would make "it worked" unreproducible. `npm:` aliases are
// stripped first: `npm:foo@1.2.3` installs `foo`, and fetching `/npm:foo/1.2.3` would 404
// while still recording a "resolved" version that was never resolved (R15 review finding).
const registrySpec = candidate.startsWith('npm:') ? candidate.slice('npm:'.length) : candidate
if (candidateKind === 'registry' && !/^(@[^/:]+\/)?[^@:]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(registrySpec)) {
  process.stderr.write(
    `refusing an unpinned registry candidate "${candidate}": ADR-0004 requires name@x.y.z (got a range or a tag)\n`,
  )
  process.exit(2)
}

/** Registry metadata for the artifact (never the tarball itself — ADR-0004 §4/§5). */
async function resolveRegistryFacts(spec) {
  if (candidateKind !== 'registry') return null
  const pinned = spec.startsWith('npm:') ? spec.slice('npm:'.length) : spec
  const at = pinned.lastIndexOf('@')
  const name = pinned.slice(0, at)
  const version = pinned.slice(at + 1)
  const registry = String(registryOverride ?? 'https://registry.npmjs.org').replace(/\/+$/, '')
  try {
    // A concrete version endpoint needs `application/json`; install-v1 answers 406 (R12 pitfall).
    const response = await fetch(`${registry}/${name.replace('/', '%2F')}/${version}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return { version: null, requested: version, error: `HTTP ${response.status}` }
    const manifest = await response.json()
    return {
      version: typeof manifest.version === 'string' ? manifest.version : version,
      // These are the registry's CLAIMS, not a verification of the installed bytes: the
      // tarball is never downloaded by this script (ADR-0004 §4/§5).
      claim: 'registry-metadata (not verified against the tarball)',
      license: typeof manifest.license === 'string' ? manifest.license : null,
      unpacked_size: typeof manifest.dist?.unpackedSize === 'number' ? manifest.dist.unpackedSize : null,
      integrity: typeof manifest.dist?.integrity === 'string' ? manifest.dist.integrity : null,
      tarball: typeof manifest.dist?.tarball === 'string' ? manifest.dist.tarball : null,
      deprecated: typeof manifest.deprecated === 'string' ? manifest.deprecated : null,
      dependencies: Object.keys(manifest.dependencies ?? {}).length,
    }
  } catch (error) {
    // No invented version: an unresolved fetch reports the error and no version.
    return { version: null, requested: version, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
}

const resolved = await resolveRegistryFacts(candidate)

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

// Capture the lockfile the install produced, before `executeProbe` deletes the sandbox.
const installFacts = { lockfile: null }
const deps = realProbeDeps({
  ...(browser === null ? {} : { browser }),
  ...(registryOverride === null ? {} : { baseEnv: { ...process.env, NPM_CONFIG_REGISTRY: registryOverride } }),
})
const baseInstall = deps.install
const instrumentedDeps = {
  ...deps,
  install: async (input) => {
    const result = await baseInstall(input)
    const profileDir = join(input.dshHome, 'profiles', input.profile)
    const lockfile = join(profileDir, 'pnpm-lock.yaml')
    installFacts.lockfile = existsSync(lockfile)
      ? { present: true, bytes: Buffer.byteLength(readFileSync(lockfile, 'utf8'), 'utf8'), sha256: sha256(readFileSync(lockfile, 'utf8')) }
      : { present: false }
    return result
  },
}

const run = await executeProbe({ plan: plan.value, dshMain, candidatePackage }, instrumentedDeps)
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
    kind: candidateKind,
    resolved: resolved === null ? null : { ...resolved, tarball: resolved.tarball === undefined || resolved.tarball === null ? null : redact(resolved.tarball) },
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
  readiness: run.readiness === null ? null : { source: run.readiness.source, port: run.readiness.port },
  render:
    run.render === null
      ? { status: 'unmeasured', reason: run.renderSkipped === null ? 'render check not requested' : redact(run.renderSkipped) }
      : {
          status: run.render.state,
          detail: redact(run.render.detail),
          ms: run.render.ms,
          // Signals only: no URL, no token, no page content.
          signals:
            run.render.signals === null
              ? null
              : {
                  title_length: run.render.signals.title.length,
                  ready_state: run.render.signals.readyState,
                  body_children: run.render.signals.bodyChildren,
                  root_id: run.render.signals.rootId,
                  root_children: run.render.signals.rootChildren,
                  text_length: run.render.signals.textLength,
                  html_bytes: run.render.signals.htmlBytes,
                },
        },
  install: { lockfile: installFacts.lockfile },
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
    'answers boot + HTTP + candidate row phase + whether the page mounted visible DOM',
    'does not judge security or maliciousness (COMPLIANCE.md §5)',
    'does not judge functionality, content correctness, or that tools registered (T-303)',
    'a blank page is caught only when a Chromium-family browser is available; otherwise client-rendered is unmeasured',
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
