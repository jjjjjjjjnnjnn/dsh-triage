#!/usr/bin/env node
/**
 * Bootstrap an isolated `@deepseek-ai/dsh` runtime for development (M2 prerequisite).
 *
 * WHY: the machine profile is on an older build, and the runtime signals this
 * project needs (`pluginInventory/list`, `fiberPhase`, …) only exist on 0.2.x.
 * Installing upstream into the real `$DSH_HOME` is forbidden (PROJECT_RULES §3),
 * so this script builds a throwaway home under `sandbox/` inside the repository:
 *
 *   <repo>/sandbox/upstream/<version>/install   ← npm install target
 *   <repo>/sandbox/upstream/<version>/home      ← isolated DSH_HOME
 *
 * It lives in the repo (git-ignored) rather than `%TEMP%` because the point of the
 * sandbox is to be inspectable while working on the project; nothing outside it is
 * written, and `rm -rf sandbox/` resets everything.
 *
 * With `--with-profile-deps` it also installs the profile's own dependencies, which
 * is what a *bootable* profile needs: without `node_modules` under the profile, the
 * loader has nothing to mount and no runtime phase can ever be observed.
 *
 * It then *proves* the contract it claims, by reading the installed packages
 * rather than by trusting this file: the dsh version, the presence of
 * `@deepseek-ai/dsh-host-plugin-inventory`, and the `fiberPhase` union that the
 * Remote actually serialises.
 *
 *   node scripts/bootstrap_upstream.mjs
 *   node scripts/bootstrap_upstream.mjs --version 0.2.1-rc.4 --with-profile-deps
 *   node scripts/bootstrap_upstream.mjs --root sandbox --dry-run
 *
 * Never touches `~/.dsh`, never reads or writes credentials, and records a real
 * outcome (`ok` / `skipped`) as SSOT either way.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const version = argOf('--version', '0.2.1-rc.2')
const rawStamp = argOf('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
const profile = argOf('--profile', 'upstream')
const dryRun = argv.includes('--dry-run')
const force = argv.includes('--force')
/** Repo-internal by default: the sandbox is meant to be inspectable, not hidden in %TEMP%. */
const root = argOf('--root', abs('sandbox'))
const withProfileDeps = argv.includes('--with-profile-deps')

if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-10-26T00:00:00.000Z\n`)
  process.exit(2)
}

const sandbox = join(root, 'upstream', version)
const installDir = join(sandbox, 'install')
const dshHome = join(sandbox, 'home')
const profileDir = join(dshHome, 'profiles', profile)
const checks = []

const record = (id, ok, detail = '') => {
  checks.push({ id, ok: Boolean(ok), detail })
  return ok
}

/* ------------------------------ registry truth ------------------------------ */

let manifest
try {
  const response = await fetch(`https://registry.npmjs.org/@deepseek-ai%2Fdsh/${version}`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`registry answered ${response.status}`)
  manifest = await response.json()
} catch (error) {
  record('registry', false, error instanceof Error ? error.message : String(error))
  finish('skipped', 'registry unreachable')
  process.exit(0)
}
record('registry', manifest.version === version, `published ${manifest.dist?.tarball ?? 'unknown tarball'}`)
const integrity = typeof manifest.dist?.integrity === 'string' ? manifest.dist.integrity : null

/* -------------------------------- install --------------------------------- */

const alreadyInstalled = existsSync(join(installDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
if (!alreadyInstalled || force) {
  if (!dryRun) {
    mkdirSync(installDir, { recursive: true })
    writeFileSync(
      join(installDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'dsh-triage-upstream-sandbox',
          private: true,
          description: 'Throwaway runtime for dsh-triage development; safe to delete.',
          dependencies: { '@deepseek-ai/dsh': version },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    const [command, args] =
      process.platform === 'win32'
        ? [process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', 'npm install --no-audit --no-fund --loglevel=error']]
        : ['npm', ['install', '--no-audit', '--no-fund', '--loglevel=error']]
    const result = spawnSync(command, args, { cwd: installDir, encoding: 'utf8', timeout: 900_000 })
    const ok = result.status === 0
    record('npm-install', ok, ok ? 'installed' : `${String(result.status)} ${String(result.stderr).slice(0, 400)}`)
    if (!ok) {
      finish('skipped', 'npm install failed')
      process.exit(0)
    }
  } else {
    record('npm-install', true, 'dry-run: would install')
  }
} else {
  record('npm-install', true, 'already installed (pass --force to reinstall)')
}

/* ------------------------- isolated profile skeleton ------------------------ */

const installedDshManifestPath = join(installDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const installedDsh = existsSync(installedDshManifestPath)
  ? JSON.parse(readFileSync(installedDshManifestPath, 'utf8'))
  : null
record(
  'installed-version',
  installedDsh?.version === version,
  installedDsh === null ? 'not installed' : String(installedDsh.version),
)

if (!dryRun) {
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify(
      {
        name: `dsh-profile-${profile}`,
        private: true,
        dependencies: {
          '@deepseek-ai/dsh': version,
          '@deepseek-ai/dsh-base': version,
          '@deepseek-ai/dsh-web-app': version,
        },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

/* --------------------------- profile dependencies --------------------------- */

/**
 * Install the profile's own dependencies.
 *
 * WHY: a profile without `node_modules` composes (the declaration tree resolves)
 * but can never mount, so `pluginInventory` has no fiber to report — this was the
 * exact blocker recorded in `data/results/ns-live-attempt-*.json`. Installing here
 * makes the sandbox a *bootable* runtime instead of a declaration fixture.
 */
let profileInstall = { status: 'skipped', detail: 'pass --with-profile-deps to install' }
if (dryRun) {
  profileInstall = { status: 'dry-run', detail: 'would install profile dependencies' }
} else if (withProfileDeps) {
  const [command, args] =
    process.platform === 'win32'
      ? [process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', 'npm install --no-audit --no-fund --loglevel=error']]
      : ['npm', ['install', '--no-audit', '--no-fund', '--loglevel=error']]
  const result = spawnSync(command, args, { cwd: profileDir, encoding: 'utf8', timeout: 1_800_000 })
  const ok = result.status === 0
  record('profile-deps-install', ok, ok ? 'installed' : `${String(result.status)} ${String(result.stderr).slice(0, 400)}`)
  profileInstall = { status: ok ? 'installed' : 'failed', detail: ok ? 'profile node_modules written' : String(result.stderr).slice(0, 400) }
}

/* --------------------------- the contract, measured -------------------------- */

const inventoryPackage = '@deepseek-ai/dsh-host-plugin-inventory'
const inventoryEntry = existsSync(join(installDir, 'node_modules', ...inventoryPackage.split('/'), 'package.json'))
  ? join(installDir, 'node_modules', ...inventoryPackage.split('/'))
  : findInstalled(inventoryPackage)
const inventoryManifest = inventoryEntry === null ? null : JSON.parse(readFileSync(join(inventoryEntry, 'package.json'), 'utf8'))
record(
  'plugin-inventory-present',
  inventoryManifest !== null,
  inventoryManifest === null ? 'not installed at this version' : String(inventoryManifest.version),
)

/** Read the phase union out of the generated Remote schema, not from memory. */
let phases = null
if (inventoryEntry !== null) {
  const remotePath = join(inventoryEntry, 'lib', 'typert.remote-client.js')
  if (existsSync(remotePath)) {
    const remote = readFileSync(remotePath, 'utf8')
    const match = remote.match(/'fiberPhase':\s*z\.union\(\[([^\]]+)\]\)/)
    if (match) {
      phases = [...match[1].matchAll(/z\.literal\((?:"([a-z]+)"|null)\)/g)].map((entry) => entry[1] ?? null)
    }
    record('pluginInventory/list', remote.includes("'pluginInventory/list'"), remotePath.replace(sandbox, '<sandbox>'))
  } else {
    record('pluginInventory/list', false, 'remote client artifact missing')
  }
}
record('fiberPhase', Array.isArray(phases) && phases.length > 0, phases === null ? 'not found' : phases.join(' | '))

/* ------------------------------- smoke launch ------------------------------- */

let smoke = { status: 'not-run', output: '' }
const binPath = join(installDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!dryRun && existsSync(binPath)) {
  const result = spawnSync(process.execPath, [binPath, '--version'], {
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, DSH_HOME: dshHome },
  })
  smoke = {
    status: result.status === 0 ? 'ok' : 'failed',
    output: `${String(result.stdout ?? '').trim()} ${String(result.stderr ?? '').trim()}`.trim().slice(0, 300),
  }
  record('dsh --version', result.status === 0, smoke.output)
}

/* ------------------------------ compose check ------------------------------- */

/**
 * `--dump-config` proves the *declaration* side resolves. It deliberately does not
 * mount anything: mounting is what `probe_live_sample.mjs` records, and phases only
 * exist after a mount. Keeping the two apart is what stops this script from claiming
 * a live sample it never took.
 */
let compose = { status: 'not-run', entries: null, stdout_sha256: null }
if (!dryRun && existsSync(binPath)) {
  const result = spawnSync(process.execPath, [binPath, '--profile', profile, '--dump-config'], {
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, DSH_HOME: dshHome },
  })
  const stdout = String(result.stdout ?? '')
  const ok = result.status === 0
  const entries = (stdout.match(/^- id:/gm) ?? []).length
  compose = { status: ok ? 'ok' : 'failed', entries, stdout_sha256: sha256(stdout) }
  record('profile-composes', ok, `${entries} entries`)
}

const profileModules = existsSync(join(profileDir, 'node_modules'))
record('profile-dependencies', profileModules, profileModules ? 'mounted-ready' : 'no node_modules (compose-only)')

finish(
  'ok',
  profileModules
    ? 'runtime + bootable profile installed; phases still need a mounted Host (see probe_live_sample.mjs)'
    : 'runtime installed; profile skeleton written (no node_modules yet — rerun with --with-profile-deps for a bootable profile)',
)

/* --------------------------------- helpers --------------------------------- */

function findInstalled(name) {
  const nested = join(installDir, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', ...name.split('/'))
  if (existsSync(join(nested, 'package.json'))) return nested
  const pnpm = join(installDir, 'node_modules', '.pnpm')
  let entries = []
  try {
    entries = readdirSync(pnpm)
  } catch {
    return null
  }
  const flattened = name.replace('@', '').replace('/', '+')
  for (const entry of entries.filter((candidate) => candidate.startsWith(flattened))) {
    const candidate = join(pnpm, entry, 'node_modules', ...name.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return null
}

function finish(status, note) {
  const payload = {
    schema_version: 1,
    produced_by: 'scripts/bootstrap_upstream.mjs',
    generated_at: stamp,
    status,
    note,
    limits: [
      'composing a profile is declaration-only: phases need a mounted Host (T-201)',
      'no credentials are copied or injected; nothing outside the repo sandbox is written',
      'the sandbox is git-ignored: `rm -rf sandbox/` resets it, and it must never be committed',
    ],
    requested_version: version,
    sandbox: { root: redact(sandbox), install: redact(installDir), dsh_home: redact(dshHome), profile },
    dry_run: dryRun,
    profile_dependencies: profileInstall,
    compose,
    registry: { tarball: manifest?.dist?.tarball ?? null, integrity },
    inventory: {
      package: inventoryPackage,
      version: inventoryManifest?.version ?? null,
      remote: inventoryManifest === null ? null : 'pluginInventory/list',
      fiber_phase: phases,
    },
    smoke,
    checks,
  }
  const text = `${JSON.stringify(payload, null, 2)}\n`
  for (const check of checks) process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'}  ${check.id}${check.detail ? ` — ${check.detail}` : ''}\n`)
  if (!dryRun) {
    mkdirSync(abs('data/results'), { recursive: true })
    const name = `upstream-${version}-${stamp.replaceAll(':', '-')}.json`
    writeFileSync(abs(join('data/results', name)), text, 'utf8')
    writeFileSync(abs(join('data/results', `${name}.sha256`)), sha256(text), 'utf8')
    process.stdout.write(`ssot data/results/${name} sha256=${sha256(text).slice(0, 12)}…\n`)
  }
  process.stdout.write(`sandbox: ${sandbox}${dryRun ? ' (dry-run, nothing installed)' : ''}\n`)
}

function redact(value) {
  // The sandbox now lives inside the repo, so the repo root is the path users would
  // otherwise see; redact it before the home directory (`~` / `<repo>` stay portable).
  return String(value)
    .replaceAll(abs('.'), '<repo>')
    .replaceAll(homedir(), '~')
    .replaceAll(tmpdir(), '%TEMP%')
}
