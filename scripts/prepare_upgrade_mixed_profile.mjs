#!/usr/bin/env node
/**
 * Prepare the curated "mixed declaration" profile (`T-503`, R44).
 *
 * WHY THIS EXISTS: `upgrade --to` can only report `improved` when a unit is **denied today
 * and admitted at the target**. The in-repo sandbox pins every package to the running
 * `0.2.1-rc.4`, so that bucket is structurally empty there (R42 measured `improved = 0` on a
 * real 192-unit composition). This script builds a second, disposable profile whose
 * declarations are **the published ones, unmodified** — only the selection of packages is
 * curated — so all four buckets can be observed on real ecosystem data.
 *
 * WHAT IS REAL HERE: every package is installed from the registry at a pinned version with
 * `--ignore-scripts` (no third-party install hooks run) and its `package.json` is never
 * edited. What is authored: which packages are installed, and the profile's loader rows.
 *
 * WHAT IS NOT DONE: no Host is booted, no `~/.dsh` is read or written, and no credentials are
 * inherited (`sandboxNpmEnv` points `npm_config_userconfig` at an empty file inside the
 * sandbox — the same helper the probe uses, R20).
 *
 *   node scripts/prepare_upgrade_mixed_profile.mjs [--out sandbox/upgrade-mixed] [--force]
 *
 * The package list is the measured output of `scripts/scan_upgrade_declarations.mjs`: of 1585
 * scanned plugins, none declares a range that denies `0.2.1-rc.4` and is admitted by a **newer**
 * release, so the real geometry for `improved` today is "move back to `0.2.1-rc.3`". Each entry
 * below carries the bucket it is there to produce.
 *
 * Exit codes: 0 prepared · 2 bad usage / missing runtime / refusing to overwrite.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { sandboxNpmEnv } from '../packages/probe/dist/host.js'
import { abs } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const out = pathFor(String(argOf('--out', 'sandbox/upgrade-mixed')))
const runtimeNodeModules = pathFor(String(argOf('--runtime', 'sandbox/upstream/0.2.1-rc.4/install/node_modules')))
const profile = String(argOf('--profile', 'mixed'))
const force = argv.includes('--force')
const RUNTIME_VERSION = '0.2.1-rc.4'

/**
 * The curated set. `target: '0.2.1-rc.3'` is the run the recorder makes — relation `older`,
 * which is exactly what the real ecosystem offers today (nothing newer than rc.4 is published).
 */
const PACKAGES = [
  {
    name: 'dsh-noname-kit',
    version: '1.10.8',
    bucket: 'improved',
    why: 'engines.dsh is an exact union ending at 0.2.1-rc.3: denied on rc.4, admitted on rc.3',
  },
  {
    name: 'dsh-motion-ui',
    version: '0.8.8',
    bucket: 'improved',
    why: 'two peers pinned to a union ending at 0.2.1-rc.3 (same shape, more requirements)',
  },
  {
    name: '@kirkchinese/dsh-citeciter',
    version: '0.9.0-beta.6',
    bucket: 'improved',
    why: 'sixteen peers pinned to a union ending at 0.2.1-rc.3: the 21-requirement stress case',
  },
  {
    name: 'dsh-plugin-gate',
    version: '1.3.2',
    bucket: 'would-be-denied',
    why: 'peers still pinned to ^0.1.0-rc.6: denied today AND at the target (already_denied_at_current)',
  },
  {
    name: 'dsh-cost-meter',
    version: '1.9.45',
    bucket: 'likely-fine',
    why: 'multi-branch range (>=0.2.0-rc.1 <0.3.0-0 || >=0.2.1-0 <0.3.0-0): admitted on both sides',
  },
  {
    name: '@xmanrui/dsh-im',
    version: '5.7.0',
    bucket: 'cannot-tell',
    why: 'declares only engines.node: silence is never "fine"',
  },
]

if (!existsSync(join(runtimeNodeModules, '@deepseek-ai', 'dsh', 'package.json'))) {
  process.stderr.write(
    `no runtime at ${runtimeNodeModules}: run \`node scripts/bootstrap_upstream.mjs\` first (the sandbox is git-ignored)\n`,
  )
  process.exit(2)
}
if (existsSync(out) && !force && !existsSync(join(out, 'home', 'profiles', profile, 'package.json'))) {
  process.stderr.write(`${out} already exists and is not a profile prepared by this script; pass --force to rebuild it\n`)
  process.exit(2)
}
if (existsSync(out) && force) rmSync(out, { recursive: true, force: true })

const home = join(out, 'home')
const profileDir = join(home, 'profiles', profile)
const sharedModules = join(home, 'profiles', 'node_modules')
mkdirSync(profileDir, { recursive: true })

// The shared `profiles/node_modules` is where a real DSH home keeps the runtime; pointing it at
// the in-repo sandbox install keeps the runtime byte-identical to the one the probe measures.
// A re-run into an existing tree keeps the link it already has (re-linking would throw EEXIST).
if (!existsSync(sharedModules)) {
  symlinkSync(runtimeNodeModules, sharedModules, process.platform === 'win32' ? 'junction' : 'dir')
}

const dependencies = Object.fromEntries(PACKAGES.map((entry) => [entry.name, entry.version]))
writeFileSync(
  join(profileDir, 'package.json'),
  `${JSON.stringify(
    {
      name: `dsh-profile-${profile}`,
      private: true,
      dependencies,
      // No bundle layer on purpose: every unit here is a loader row, so the artifact says
      // "rows only" instead of inventing bundles this profile does not have.
      dsh: { profile: { bundles: [] } },
    },
    null,
    2,
  )}\n`,
  'utf8',
)
writeFileSync(
  join(profileDir, 'cordis.yml'),
  '# dsh profile root — an empty entry list; the tree is composed from patches.\n[]\n',
  'utf8',
)
writeFileSync(
  join(profileDir, 'cordis.patch.yml'),
  [
    '# Curated mixed-declaration profile (T-503). Every row names a REAL published package;',
    '# nothing here edits the package manifests. Row ids keep the `compat-` prefix the',
    '# namespace gate requires of rows we author.',
    '- insert:',
    ...PACKAGES.map(
      (entry) =>
        `    - id: compat-mixed-${entry.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}\n      name: ${JSON.stringify(entry.name)}`,
    ),
    '',
  ].join('\n'),
  'utf8',
)

// Empty user npmrc inside the sandbox: no operator token travels, same rule as the probe (R20).
const env = sandboxNpmEnv(process.env, home)

/**
 * Re-use an install that already matches the pins.
 *
 * WHY: rebuilding this profile costs ~9 minutes against the real registry, and a re-run that
 * only needs the patch file rewritten should not pay that. The check is per package and on the
 * version that actually landed — "the directory exists" is not the same as "the pin is there".
 */
function landedVersions() {
  const landed = new Map()
  for (const entry of PACKAGES) {
    const manifestPath = join(profileDir, 'node_modules', ...entry.name.split('/'), 'package.json')
    if (!existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (typeof manifest.version === 'string') landed.set(entry.name, manifest.version)
    } catch {
      /* unreadable manifest = not a usable install */
    }
  }
  return landed
}

const alreadyLanded = landedVersions()
const missing = PACKAGES.filter((entry) => alreadyLanded.get(entry.name) !== entry.version)
if (existsSync(out) && !force && missing.length > 0) {
  // A half-updated tree would make the impact list describe a composition nobody runs, so a
  // mismatched install is rebuilt deliberately rather than patched in place.
  process.stderr.write(
    `${out} exists but does not carry the pins: ${missing.map((entry) => `${entry.name}@${entry.version}`).join(', ')}\n` +
      '  pass --force to rebuild it\n',
  )
  process.exit(2)
}

const npmArgs = [
  'install',
  '--prefix',
  profileDir,
  '--no-package-lock',
  '--no-audit',
  '--no-fund',
  // No third-party install hook runs: this profile is read, never booted.
  '--ignore-scripts',
  // The packages peer-depend on react 18 and 19 in the same tree; npm's resolver refuses that
  // combination, and nothing here renders. Peer *declarations* are what we judge, and they stay
  // on disk either way — skipping peer installation is the narrower change than `--force`.
  '--legacy-peer-deps',
  '--loglevel',
  'error',
]
const started = Date.now()
const install =
  missing.length === 0
    ? { status: 0, stdout: '', stderr: '' }
    : process.platform === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/c', 'npm', ...npmArgs], { encoding: 'utf8', env, timeout: 600_000 })
      : spawnSync('npm', npmArgs, { encoding: 'utf8', env, timeout: 600_000 })
const ms = Date.now() - started

if (install.status !== 0) {
  process.stderr.write(`npm install failed (exit ${String(install.status)}):\n${install.stderr ?? ''}\n${install.stdout ?? ''}\n`)
  process.exit(2)
}

// Read back what actually landed: a profile that claims a version it does not have would make
// the impact list describe a composition nobody runs.
const problems = []
for (const entry of PACKAGES) {
  const manifestPath = join(profileDir, 'node_modules', ...entry.name.split('/'), 'package.json')
  if (!existsSync(manifestPath)) {
    problems.push(`${entry.name}: not installed under ${join('<out>', 'home', 'profiles', profile, 'node_modules')}`)
    continue
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.version !== entry.version) problems.push(`${entry.name}: installed ${manifest.version}, expected ${entry.version}`)
}

process.stdout.write(`mixed declaration profile · ${out}\n`)
process.stdout.write(`  runtime   ${RUNTIME_VERSION} (shared node_modules → in-repo sandbox install)\n`)
process.stdout.write(`  profile   ${profile} · ${PACKAGES.length} real package(s) · install ${missing.length === 0 ? 'reused (pins already on disk)' : `${ms}ms`}\n`)
for (const entry of PACKAGES) process.stdout.write(`  ${entry.bucket.padEnd(16)} ${entry.name}@${entry.version}\n`)
process.stdout.write(`  scripts   --ignore-scripts (no third-party install hook ran)\n`)
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`check FAILED: ${problem}\n`)
  process.exit(2)
}
process.stdout.write(
  `next      node scripts/record_upgrade_impact.mjs --stamp <ISO> --to 0.2.1-rc.3 --dsh-home ${out}/home --profile ${profile} --expect-improved\n`,
)
