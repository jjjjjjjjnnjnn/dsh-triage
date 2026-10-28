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
import { buildProbePlan, executeProbe, findFreePort, judgeProbe, runInstall, scrubbedEnv } from '../packages/probe/dist/index.js'
import { candidatePackageName, normalizeCandidateSpec, probeScratchRoot, realProbeDeps } from '../packages/plugin/dist/probe-run.js'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
/** Integer flag in [min, max]; `null` when absent or malformed (caller reports usage). */
const numberArg = (name, fallback, min, max) => {
  const raw = argOf(name, null)
  if (raw === null) return fallback
  if (!/^\d+$/.test(String(raw))) return null
  const value = Number(raw)
  return value >= min && value <= max ? value : null
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
  process.stderr.write('usage: node scripts/record_probe.mjs --candidate <path|name@x.y.z> --dsh-main <bin.js> [--install <dir>] [--label ok] [--expect go|blocked|unknown] [--browser <path>] [--registry <url>] [--npmrc-registry <url>] [--stamp <iso>]\n')
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
/**
 * T-305b: make the PROFILE's registry unreachable. Env-level `NPM_CONFIG_REGISTRY` is
 * neutralised by the launcher (R15 F19) but `<profile>/.npmrc` is honoured (R16 F24).
 * The profile only exists after its first install, so we initialize it with a local
 * fixture first; that fixture is recorded as `sandbox.preinit`, never as the candidate.
 */
const npmrcRegistry = argOf('--npmrc-registry', null)
/**
 * R17: how long to wait for the Host to answer, and how long a tree that is still composing
 * gets. The second window can only ever produce `unknown` (see `judgeProbe`), so a caller
 * cannot use it to buy a `blocked`.
 */
const readinessTimeoutMs = numberArg('--readiness-timeout', null, 1_000, 120_000)
const unsettledReadinessMs = numberArg('--unsettled-timeout', null, 1_000, 300_000)
if (readinessTimeoutMs === null && argv.includes('--readiness-timeout')) {
  process.stderr.write('--readiness-timeout needs an integer between 1000 and 120000 (ms)\n')
  process.exit(2)
}
if (unsettledReadinessMs === null && argv.includes('--unsettled-timeout')) {
  process.stderr.write('--unsettled-timeout needs an integer between 1000 and 300000 (ms)\n')
  process.exit(2)
}

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

const freePort = await findFreePort()
const plan = buildProbePlan({
  candidate,
  realDshHome,
  workRoot: probeScratchRoot(),
  profile,
  dshBin: dshMain,
  ...(freePort === null ? {} : { basePort: freePort }),
})
if (!plan.ok) {
  process.stderr.write(`probe plan refused: ${plan.error.code} (${plan.error.detail})\n`)
  process.exit(3)
}

/**
 * Initialize the profile (and optionally point it at a different registry) BEFORE the
 * measured install. Both actions are recorded, because a probe that quietly prepared the
 * sandbox would be hiding part of the experiment.
 */
const preinit = { fixture: null, detail: null, npmrc: null }
if (npmrcRegistry !== null) {
  const fixture = abs('tests/fixtures/probe/ok-plugin')
  const env = scrubbedEnv(process.env, { DSH_HOME: plan.value.sandboxHome })
  const initialized = runInstall({
    dshMain,
    dshHome: plan.value.sandboxHome,
    profile,
    candidate: fixture,
    timeoutMs: 180_000,
    env,
  })
  preinit.fixture = { exit: initialized.exitCode, detail: initialized.detail }
  if (initialized.exitCode !== 0) {
    process.stderr.write(`could not initialize the sandbox profile for --npmrc-registry: ${initialized.detail}\n`)
    process.exit(3)
  }
  const npmrcPath = join(plan.value.sandboxProfileDir, '.npmrc')
  const text = `registry=${npmrcRegistry}\n`
  writeFileSync(npmrcPath, text, 'utf8')
  preinit.npmrc = { registry: npmrcRegistry, bytes: Buffer.byteLength(text, 'utf8'), written: existsSync(npmrcPath) }
}

// Capture the lockfile the install produced, before `executeProbe` deletes the sandbox.
const installFacts = { lockfile: null, endpoints: [] }
const deps = realProbeDeps({
  ...(browser === null ? {} : { browser }),
  ...(readinessTimeoutMs === null ? {} : { readinessTimeoutMs }),
  ...(unsettledReadinessMs === null ? {} : { unsettledReadinessMs }),
  ...(registryOverride === null ? {} : { baseEnv: { ...process.env, NPM_CONFIG_REGISTRY: registryOverride } }),
})
const baseInstall = deps.install
const instrumentedDeps = {
  ...deps,
  install: async (input) => {
    const result = await baseInstall(input)
    installFacts.endpoints = [...(result.endpoints ?? [])]
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
    // R17: was the port asked from the OS (`allocated`) or taken from the plan digest?
    port_origin: freePort === null ? 'plan-digest' : 'allocated',
    port: plan.value.port,
    overlap_check: 'disjoint (validateProbePlan)',
    env_scrubbed: true,
    preinit:
      preinit.npmrc === null && preinit.fixture === null
        ? null
        : {
            fixture: preinit.fixture === null ? null : { exit: preinit.fixture.exit, detail: redact(preinit.fixture.detail ?? '') },
            npmrc: preinit.npmrc === null ? null : { registry: String(preinit.npmrc.registry), bytes: preinit.npmrc.bytes, written: preinit.npmrc.written },
          },
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
    // R17: whether the reading can support a verdict at all. `settled:false` and an
    // `error_code` are what separate "slow" from "broken".
    settled: run.sample === null ? null : run.sample.settled,
    error_code: run.sample === null ? null : run.sample.errorCode,
    attempts: run.sample === null ? null : run.sample.attempts,
    applies: run.sample === null ? null : run.sample.applies,
    candidate_rows: run.sample === null ? [] : run.sample.candidateRows.map((row) => ({ ...row, moduleName: redact(row.moduleName) })),
    excluded: run.sample === null ? [] : [...run.sample.excluded],
    error: run.sample === null || run.sample.error === null ? null : redact(run.sample.error),
  },
  http: run.http === null ? null : { status: run.http.status, detail: redact(run.http.detail) },
  // R17: was the Host up at all? `url_printed` is a fact (the launcher printed its URL),
  // never the URL itself -- the token never enters an artifact.
  boot: {
    url_printed: run.urlPrinted,
    first_line: run.firstLine === null ? null : redact(run.firstLine),
    // Only on a no-sample boot: the launcher's own reason (e.g. "startup failed: 2 required
    // plugins did not activate"). Token-redacted in host.ts before it gets here.
    error_tail: run.errorTail === null ? null : redact(run.errorTail),
    startup_failed: run.startupFailed,
    // Ports the Host could not bind. Present even on a sampled run: it is how the artifact
    // shows that a failure was ours (R17: this machine excludes 53461-53560).
    bind_failed_ports: [...run.bindFailedPorts],
  },
  readiness: run.readiness === null ? null : {
    source: run.readiness.source,
    port: run.readiness.port,
    // R17: "we waited N s" has to survive into the artifact, otherwise a short window and a
    // dead plugin look the same after the fact.
    outcome: run.readiness.outcome,
    waited_ms: run.readiness.waited_ms,
    window_ms: run.readiness.window_ms,
    url_seen: run.readiness.url_seen,
  },
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
  install: {
    lockfile: installFacts.lockfile,
    // T-305b: which endpoints the package manager actually tried (sanitised in host.ts).
    endpoints: installFacts.endpoints,
    exit_code: run.steps.find((step) => step.id === 'install')?.exitCode ?? null,
    // T-310: the reason, not just the exit code. `source` records where it was read from
    // (R19 fact F34: the diagnostics log drops the code, the launcher stderr keeps it).
    diagnosis:
      run.installDiagnosis === null
        ? null
        : {
            code: run.installDiagnosis.code,
            key_line: run.installDiagnosis.key_line,
            source: run.installDiagnosis.source,
          },
    // R20: pnpm's own statement that it sent a credential. The sandbox redirects the user
    // npmrc, so this must be `false`; `true` means the redirect stopped working.
    registry_auth_used: run.installAuthUsed,
  },
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
    // R20: the sandbox stops inheriting the operator's npm credentials; this is the claim.
    'the sandbox uses no registry credentials (npm user config is an empty file inside the sandbox)',
    // ADR-0006 (accepted 2026-10-28): 20s is a measurement budget, not a wall-clock promise.
    'a tree that never settles is returned by ≈25s (boot + the 15s settle wait), not 20s',
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
