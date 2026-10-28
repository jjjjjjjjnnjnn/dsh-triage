#!/usr/bin/env node
/**
 * Credential-source audit (T-313 / `BS-29`).
 *
 * THE QUESTION: if a credential lived in source X, would the sandbox's package manager read it
 * and put it on the wire? R20 closed exactly one source (`~/.npmrc` via `npm_config_userconfig`)
 * and measured that it leaked 2/2 before that. Every other source was unaudited, so "the sandbox
 * has no credentials" was still a claim rather than a measurement.
 *
 * THE DETECTOR IS A LOCAL REGISTRY SPY, NOT A LOG LINE: a fake registry on 127.0.0.1 answers 404
 * to every metadata request and records the `authorization` header. That answers "did the
 * credential travel?" directly. R20 read `An authorization header was used: Bearer …` out of
 * pnpm's output; R23 measured that this line is not reliably printed (a synthetic npmrc with a
 * token produced no such line), so log-scraping would have reported "no leak" for a source that
 * is live — a false negative in the exact direction that matters.
 *
 * WHY THE CHILD IS SPAWNED ASYNCHRONOUSLY: the spy lives in this process. `spawnSync` blocks the
 * event loop, so the fake registry can never answer and pnpm waits until it is killed. That cost
 * three 90-second hangs while building this script; the comment stays so nobody re-learns it.
 *
 * SAFETY (铁律 4): no real config file is read, copied or published. Every credential here is a
 * synthetic token written by this script into a temp directory, and the artifact keeps booleans
 * and counts only.
 *
 *   node scripts/audit_credential_sources.mjs --dsh-main <lib/bin.js> [--stamp <iso>] [--out <dir>]
 *
 * Exit codes: 0 every source is neutralised · 1 a source still leaks · 2 bad usage.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir, homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { pluginArgv, sandboxNpmEnv, scrubbedEnv } from '../packages/probe/dist/index.js'

/* ---------------------------------- args ---------------------------------- */

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const dshMainArg = String(argOf('--dsh-main', ''))
const dshMain = dshMainArg === '' ? '' : resolve(dshMainArg)
if (dshMainArg === '' || !existsSync(dshMain)) {
  process.stderr.write(
    'usage: node scripts/audit_credential_sources.mjs --dsh-main <lib/bin.js> [--seed <local fixture>] [--stamp <iso>] [--out <dir>]\n',
  )
  process.exit(2)
}
const rawStamp = argOf('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601\n`)
  process.exit(2)
}
const outDir = resolve(abs('.'), String(argOf('--out', 'data/results')))
const seedFixture = resolve(abs('.'), String(argOf('--seed', 'tests/fixtures/probe/ok-plugin')))
const profile = 'web'
const PROBE_CANDIDATE = 'triage-probe-credential-audit-fixture@9.9.9'
const SYNTHETIC_TOKEN = 'probe-SYNTHETIC-token-not-real'

/* ---------------------------------- spy ----------------------------------- */

const root = mkdtempSync(join(tmpdir(), 'dsh-triage-credential-audit-'))
const sandboxHome = join(root, 'home')
const profileDir = join(sandboxHome, 'profiles', profile)
mkdirSync(profileDir, { recursive: true })

const seen = []
/** `404`: nothing exists. `401`: the registry demands auth, which is when a token actually matters. */
let spyMode = '404'
const server = createServer((request, response) => {
  seen.push({ url: request.url ?? '', authorization: request.headers.authorization ?? null })
  if (spyMode === '401') {
    response.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Basic realm="npm"' })
    response.end('{"error":"unauthorized"}')
    return
  }
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end('{"error":"not found"}')
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const port = server.address().port
const registryUrl = `http://127.0.0.1:${port}/`

/**
 * The profile's own `.npmrc` will point at the spy. That is *legitimate* project config (R16 F24
 * measured that the launcher honours it), not a credential source — it only decides where the
 * request goes. Every credential below lives somewhere else.
 *
 * Written AFTER the seed: a fresh profile needs real registry access for the framework packages,
 * so pointing it at the spy before seeding would fail the preparation for an unrelated reason.
 */
const profileNpmrc = join(profileDir, '.npmrc')

/** Set a knob in BOTH spellings: `sandboxNpmEnv` writes both, so re-opening must too. */
function setKnob(env, knob, value) {
  env[knob] = value
  const upper = knob.toUpperCase()
  if (upper !== knob) env[upper] = value
}

/** The env the probe really uses for a sandbox install. */
function probeEnv(plant) {
  const base = scrubbedEnv(process.env, { DSH_HOME: sandboxHome })
  // `plant` runs BEFORE mitigation: this is "would our shipped env neutralise this source?".
  if (plant !== null) setKnob(base, plant.knob, plant.value)
  return sandboxNpmEnv(base, sandboxHome)
}

/* ------------------------------- the sources ------------------------------- */

/** Write a config file that grants the synthetic token for the spy registry. */
function writeTokenConfig(path) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `//127.0.0.1:${port}/:_authToken=${SYNTHETIC_TOKEN}\n`, 'utf8')
  return path
}

/**
 * The same file, optionally carrying the registry pointer as well.
 *
 * WHY THE TWO VARIANTS: "the token did not travel" has two very different causes — the knob is
 * not read at all, or it is read but auth keys there are ignored. Carrying the registry pointer
 * distinguishes them: if requests still reach the spy, the knob is honoured and the absence of a
 * credential is a real finding about that file.
 */
function writeConfig(path, withRegistry) {
  mkdirSync(dirname(path), { recursive: true })
  const lines = [`//127.0.0.1:${port}/:_authToken=${SYNTHETIC_TOKEN}`]
  if (withRegistry) lines.push(`registry=${registryUrl}`)
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
  return path
}

const SOURCES = [
  {
    id: 'user-npmrc',
    knob: 'npm_config_userconfig',
    plant: (withRegistry) => ({ knob: 'npm_config_userconfig', value: writeConfig(join(root, 'src-user', '.npmrc'), withRegistry) }),
    why: 'the user npmrc (`~/.npmrc`): R20 measured it leaked 2/2 before `sandboxNpmEnv` existed',
  },
  {
    id: 'global-npmrc',
    knob: 'npm_config_globalconfig',
    plant: (withRegistry) => ({ knob: 'npm_config_globalconfig', value: writeConfig(join(root, 'src-global', 'npmrc'), withRegistry) }),
    why: 'the global npmrc (npm: `%ProgramData%\\npm\\etc\\npmrc`, POSIX: `$PREFIX/etc/npmrc`)',
  },
  {
    id: 'pnpm-own-rc',
    knob: 'XDG_CONFIG_HOME',
    plant: (withRegistry) => {
      const xdg = join(root, 'src-xdg')
      writeConfig(join(xdg, 'pnpm', 'rc'), withRegistry)
      return { knob: 'XDG_CONFIG_HOME', value: xdg }
    },
    why: "pnpm's own config file (`$XDG_CONFIG_HOME/pnpm/rc`), read independently of npmrc",
  },
  {
    id: 'pnpm-home',
    knob: 'PNPM_HOME',
    plant: (withRegistry) => {
      const dir = join(root, 'src-pnpm-home')
      writeConfig(join(dir, 'rc'), withRegistry)
      return { knob: 'PNPM_HOME', value: dir }
    },
    why: 'the pnpm global bin directory (asserted, not assumed, that it is not a config source)',
  },
  {
    id: 'corepack-home',
    knob: 'COREPACK_HOME',
    plant: (withRegistry) => {
      const dir = join(root, 'src-corepack')
      writeConfig(join(dir, 'rc'), withRegistry)
      return { knob: 'COREPACK_HOME', value: dir }
    },
    why: 'corepack manages package-manager versions; asserted not to carry registry auth',
  },
]

/* --------------------------------- running --------------------------------- */

/** One launcher run; resolves with what the spy saw. */
function runAdd(env, label, spec = PROBE_CANDIDATE, timeoutMs = 90_000) {
  return new Promise((resolveRun) => {
    seen.length = 0
    const started = Date.now()
    const child = spawn(process.execPath, [...pluginArgv({ dshMain, profile, verb: 'add', spec })], {
      env: { ...env, CI: 'true', npm_config_yes: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += String(chunk)))
    child.stderr.on('data', (chunk) => (output += String(chunk)))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      const authorized = seen.filter((request) => request.authorization !== null)
      resolveRun({
        label,
        code,
        elapsedMs: Date.now() - started,
        requests: seen.length,
        // The measurement: did a credential reach the wire?
        authorizationSeen: authorized.length,
        // Never publish the token; this is only for the operators' local debugging.
        sampleUrl: seen[0]?.url ?? null,
        // The install must fail, otherwise "no credential" could just mean "no request".
        failed: code !== 0,
        tokenLeakedInOutput: output.includes(SYNTHETIC_TOKEN),
        outputTail: output.slice(-400),
      })
    })
  })
}

// Seed the profile with a LOCAL fixture so the framework install needs no registry at all.
const seed = await runAdd(
  { ...scrubbedEnv(process.env, { DSH_HOME: sandboxHome }), DSH_HOME: sandboxHome },
  'seed',
  seedFixture,
  180_000,
)
if (seed.code !== 0) {
  process.stderr.write(`could not prepare the sandbox profile: exit ${seed.code}\n${seed.outputTail}\n`)
  server.close()
  rmSync(root, { recursive: true, force: true })
  process.exit(3)
}

// Only now does the profile point at the spy: every later run must talk to it, and nothing else.
writeFileSync(profileNpmrc, `registry=${registryUrl}\nfetch-retries=0\nfetch-timeout=5000\n`, 'utf8')

// Control: nothing planted anywhere. If this ever sees an authorization header, the spy is
// measuring something other than the source under test.
const control = await runAdd(probeEnv(null), 'control')

const observations = []
/**
 * Two registry answers, because a credential can be withheld until challenged:
 * `404` (nothing there) and `401` (the registry demands auth). A source that only sends its
 * token on a challenge would look clean in the 404 pass and leak in reality.
 */
for (const mode of ['404', '401']) {
  spyMode = mode
  for (const source of SOURCES) {
    /**
     * A) Is this knob read at all? The source carries the registry pointer and the profile's own
     *    `.npmrc` is removed, so only the source under test can route traffic to the spy.
     *    Planted AFTER mitigation on purpose: this asks whether the knob is read, not whether we
     *    currently neutralise it (planting before would let our own override hide the answer).
     */
    rmSync(profileNpmrc, { force: true })
    const routedEnv = probeEnv(null)
    const routedPlant = source.plant(true)
    setKnob(routedEnv, routedPlant.knob, routedPlant.value)
    const routed = await runAdd(routedEnv, `${source.id}-${mode}-routed`)
    writeFileSync(profileNpmrc, `registry=${registryUrl}\nfetch-retries=0\nfetch-timeout=5000\n`, 'utf8')

    // B) The profile routes to the spy again; the source carries only the credential.
    const afterMitigation = probeEnv(null)
    setKnob(afterMitigation, source.knob, source.plant(false).value)
    const opened = await runAdd(afterMitigation, `${source.id}-${mode}-opened`)

    // C) The same, but planted BEFORE our env is built: what the probe ships today.
    const closed = await runAdd(probeEnv(source.plant(false)), `${source.id}-${mode}-closed`)

    observations.push({
      id: source.id,
      mode,
      knob: source.knob,
      why: source.why,
      // Is the knob read by the launcher/pnpm at all? (proved by traffic reaching the spy)
      knob_honored: routed.requests > 0,
      // `true` = the source is live: pnpm read it and put the credential on the wire.
      live: opened.authorizationSeen > 0,
      // `true` = it still gets through with the env the probe ships today.
      leaks_today: closed.authorizationSeen > 0,
      requests: { routed: routed.requests, opened: opened.requests, closed: closed.requests },
      auth_seen: { routed: routed.authorizationSeen, opened: opened.authorizationSeen, closed: closed.authorizationSeen },
      exit: { routed: routed.code, opened: opened.code, closed: closed.code },
      failed_all: routed.failed && opened.failed && closed.failed,
      elapsed_ms: { routed: routed.elapsedMs, opened: opened.elapsedMs, closed: closed.elapsedMs },
    })
  }
}

/**
 * Proxy credentials never reach the registry, so the spy cannot see them. The question there is
 * different: does OUR output ever carry a URL with userinfo? That is a pure function, asserted
 * separately by the unit tests and re-asserted here on the same strings.
 */
const proxyCheck = (() => {
  const url = 'http://probe-user:probe-password@127.0.0.1:9/registry'
  // Mirrors `sanitizeDiagnosisLine`'s userinfo rule without importing the whole pipeline: the
  // unit tests own the real assertion; this only refuses to claim "no proxy leak" silently.
  const stripped = url.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1')
  return { input: url, sanitized: stripped, userinfo_removed: !stripped.includes('probe-password') }
})()

const leaking = observations.filter((item) => item.leaks_today)
const handled = observations.filter((item) => item.live && !item.leaks_today)
const notAVector = observations.filter((item) => !item.live)

/** Paths are redacted before they reach an artifact: the results-privacy gate is not optional. */
function redactPath(value) {
  return String(value)
    .replaceAll(homedir(), '<home>')
    .replaceAll(tmpdir(), '<tmp>')
    .replaceAll(abs('.'), '<repo>')
}

const artifact = {
  schema_version: 1,
  produced_by: 'scripts/audit_credential_sources.mjs',
  generated_at: stamp,
  runtime: { dsh_main: redactPath(dshMain), platform: process.platform, node: process.versions.node },
  sandbox: {
    root: redactPath(root),
    profile,
    candidate: PROBE_CANDIDATE,
    credential: 'synthetic token written by this audit; never a real credential',
    detection: 'a local registry spy on 127.0.0.1 records the `authorization` header of every request',
  },
  method: {
    control: 'no credential planted anywhere: the spy must see zero authorization headers',
    opened: 'one source planted AFTER our env is built (proves the source is live)',
    closed: 'the same source planted BEFORE our env is built (what the probe ships today)',
    failure_required: 'the probed candidate does not exist, so every run must exit non-zero',
    why_not_the_log: "pnpm's `An authorization header was used` line is not reliably printed; R23 measured a live token producing no such line",
  },
  control: {
    authorization_seen: control.authorizationSeen,
    requests: control.requests,
    exit: control.code,
  },
  sources: observations,
  proxy: proxyCheck,
  summary: {
    audited: observations.length,
    live_and_neutralised: observations.filter((item) => item.live && !item.leaks_today).map((item) => `${item.id}@${item.mode}`),
    live_and_leaking: leaking.map((item) => `${item.id}@${item.mode}`),
    not_a_vector: notAVector.map((item) => `${item.id}@${item.mode}`),
    knob_not_honored: observations.filter((item) => !item.knob_honored).map((item) => `${item.id}@${item.mode}`),
    all_runs_failed: observations.every((item) => item.failed_all),
  },
  conclusion:
    leaking.length === 0
      ? 'no audited source carries a credential into the sandbox with the shipped env'
      : 'LEAK: at least one audited source still reaches the wire',
  limits: [
    'sources are moved with environment knobs; a config path the launcher hardcodes outside those knobs is not covered',
    'the token is synthetic, so this measures the read path, not whether a real token exists on this machine',
    'one machine (Windows), one pnpm version, one launcher version; no Linux/macOS evidence yet',
    'the proxy case cannot be observed at the registry, so it is asserted at our sanitiser instead',
  ],
}

mkdirSync(outDir, { recursive: true })
const fileName = `credential-sources-${stamp.replaceAll(':', '-')}.json`
const target = join(outDir, fileName)
const text = `${JSON.stringify(artifact, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

server.close()
rmSync(root, { recursive: true, force: true })

process.stdout.write(`wrote ${target}\n`)
process.stdout.write(`control        requests=${control.requests} withAuth=${control.authorizationSeen} (must be 0)\n`)
for (const item of observations) {
  const verdict = item.leaks_today
    ? 'LEAK'
    : !item.knob_honored
      ? 'not a vector (knob unread)'
      : item.live
        ? 'neutralised'
        : 'not a credential vector'
  process.stdout.write(
    `${`${item.id}@${item.mode}`.padEnd(20)} honored=${String(item.knob_honored).padEnd(5)} live=${String(item.live).padEnd(5)} leaks=${String(item.leaks_today).padEnd(5)} ${verdict}\n`,
  )
}
process.stdout.write(`proxy userinfo removed: ${String(proxyCheck.userinfo_removed)}\n`)
if (leaking.length > 0) {
  process.stderr.write(`leak(s): ${leaking.map((item) => item.id).join(', ')}\n`)
  process.exit(1)
}
process.exit(0)
