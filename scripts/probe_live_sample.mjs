#!/usr/bin/env node
/**
 * Live-sample attempt recorder (B1/B2 · input side of T-201/P1).
 *
 * WHY THIS EXISTS: the phase layer (`packages/core/src/inventory.ts`) is proven on
 * synthetic samples only. `docs/HANDOFF.md` §8 says the honest phrasing is "the
 * phase table is implemented, the machine was never sampled". This script exists so
 * that an attempt to sample a real 0.2.x runtime is itself evidence: either it
 * produces a `sample.kind=live` snapshot, or it records *why* it could not, with the
 * preconditions it actually checked.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 * - it never writes to the real `~/.dsh` (every child process gets `DSH_HOME` = the
 *   sandbox home passed on the command line);
 * - it never claims a snapshot it did not get: `outcome` is `blocked` (a precondition
 *   failed) or `composed-only` (the declaration tree resolves, but composing is not
 *   mounting), and `rows` is always empty — a phase snapshot needs a mounted Host
 *   (T-201 P1), not this script;
 * - it runs no agent session and reads no credentials.
 *
 *   node scripts/probe_live_sample.mjs --dsh-home <sandbox>/home --profile upstream \
 *        --install <sandbox>/install --stamp 2026-10-27T16:00:00.000Z
 *
 * Exit code is 0 whenever the artifact was written — a blocked attempt is data, not
 * an infrastructure error. Read `outcome` to see what happened.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = argOf('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-10-27T16:00:00.000Z\n`)
  process.exit(2)
}

const profile = String(argOf('--profile', 'upstream'))
const dshHome = pathFor(String(argOf('--dsh-home', join(process.env['USERPROFILE'] ?? homedir(), '.dsh'))))
const installDir = pathFor(String(argOf('--install', '')))
const outDir = String(argOf('--out', 'data/results'))
const asJson = argv.includes('--json')

/** Everything written to disk is redacted: `data/results` may be published. */
const redactRoots = [homedir(), tmpdir(), dshHome, installDir].filter((root) => root !== '')
const redact = (value) =>
  redactRoots.reduce((text, root) => (root === '' ? text : text.split(root).join('~')), String(value))

const profileDir = join(dshHome, 'profiles', profile)
const blockers = []
const evidence = []

function record(id, ok, detail) {
  evidence.push({ id, ok, detail })
  if (!ok) blockers.push(id)
}

/* ------------------------------ preconditions ------------------------------- */

const manifestPath = join(profileDir, 'package.json')
record('profile-manifest', existsSync(manifestPath), redact(manifestPath))

let manifest = null
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    record('profile-manifest-parses', false, 'package.json is not valid JSON')
  }
}

const profileModules = existsSync(join(profileDir, 'node_modules'))
const sharedModules = existsSync(join(dshHome, 'profiles', 'node_modules'))
record(
  'profile-dependencies-installed',
  profileModules || sharedModules,
  `profile=${profileModules} shared=${sharedModules}`,
)

const dshBin = process.platform === 'win32' ? join(installDir, 'node_modules', '.bin', 'dsh.cmd') : join(installDir, 'node_modules', '.bin', 'dsh')
const dshAvailable = installDir !== '' && existsSync(dshBin)
record('dsh-binary', dshAvailable, dshAvailable ? redact(dshBin) : 'no --install directory with node_modules/.bin/dsh')

/* --------------------------- what the CLI tells us -------------------------- */

/**
 * Windows cannot `spawn` a `.cmd` directly (EINVAL); go through `ComSpec /c`, the
 * same way `gate_release_pack.mjs` does. Stdout is hashed instead of stored so the
 * artifact stays deterministic and free of machine-specific paths.
 */
function runDsh(args) {
  const env = { ...process.env, DSH_HOME: dshHome }
  const result =
    process.platform === 'win32'
      ? spawnSync(process.env['ComSpec'] ?? 'cmd.exe', ['/c', dshBin, ...args], { encoding: 'utf8', env, timeout: 120000 })
      : spawnSync(dshBin, args, { encoding: 'utf8', env, timeout: 120000 })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  return {
    exit_code: result.status ?? -1,
    stdout_sha256: sha256(stdout),
    stdout_lines: stdout.trimEnd() === '' ? 0 : stdout.trimEnd().split(/\r?\n/).length,
    // Kept only as a short, redacted label (a version string is not machine-specific);
    // the rest of stdout stays a hash so the artifact is deterministic.
    stdout_first_line: redact(stdout.trimEnd().split(/\r?\n/)[0] ?? '').slice(0, 80),
    stderr_first_line: redact(stderr.trimEnd().split(/\r?\n/)[0] ?? '').slice(0, 200),
  }
}

const cli = { version: null, dump_config: null }
if (dshAvailable) {
  cli.version = runDsh(['--version'])
  record('dsh-runs', cli.version.exit_code === 0, `exit ${cli.version.exit_code}`)
  // `--dump-config` composes the profile tree without mounting: it proves the
  // *declaration* side resolves, and cannot produce fiber phases.
  cli.dump_config = runDsh(['--profile', profile, '--dump-config'])
  record('profile-composes', cli.dump_config.exit_code === 0, `exit ${cli.dump_config.exit_code}`)
}

/* --------------------------------- outcome ---------------------------------- */

/**
 * What this attempt actually established.
 *
 * `sampled` is deliberately NOT reachable from here: `--dump-config` composes the
 * declaration tree without mounting anything, and `pluginInventory` is a Remote-only
 * service with no same-process Cordis merge. Claiming a phase snapshot from this
 * script would be fabricated evidence, so the only outcomes are "we could not even
 * compose" and "we composed, but phases still need a mounted Host".
 */
const outcome = blockers.length === 0 ? 'composed-only' : 'blocked'

/** Explain the blocker from the evidence that failed, never from a hardcoded story. */
const WHY_NOT = {
  'profile-manifest': 'the sandbox has no profile manifest to boot',
  'profile-manifest-parses': 'the sandbox profile manifest is not readable JSON',
  'profile-dependencies-installed': 'the sandbox profile has no node_modules, so no entry can mount',
  'dsh-binary': 'no dsh binary was found under the given --install directory',
  'dsh-runs': 'the dsh binary in the sandbox does not run',
  'profile-composes': 'the sandbox profile does not even compose',
}

const snapshotRow = {
  schema_version: 1,
  produced_by: 'scripts/probe_live_sample.mjs',
  generated_at: stamp,
  sample: {
    kind: 'live-attempt',
    profile,
    dsh_home: redact(dshHome),
    // What the profile *asks for* is a range, not a running version; keep them apart.
    declared_range: manifest === null ? null : String(manifest?.dependencies?.['@deepseek-ai/dsh'] ?? 'unknown'),
    observed_runtime: cli.version === null || cli.version.stdout_first_line === '' ? null : cli.version.stdout_first_line,
    bundles: Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [],
  },
  outcome,
  blockers,
  evidence,
  cli,
  // The contract that would have to be satisfied to make this a `sampled` row.
  next_step: {
    requirement:
      'a mounted Host plus a loader projection: either an in-process read of ctx.loader.entries() or a pluginInventory/list Remote call (T-201 P1)',
    why_not_here:
      blockers.length === 0
        ? 'the profile composes, but composing is declaration-only; phases exist only after mount'
        : blockers.map((id) => WHY_NOT[id] ?? id).join('; '),
    reference: 'docs/specs/M2-inventory.md §4 (P1)',
  },
  // No verdicts: an attempt is not a conclusion, and inventing rows here would be
  // exactly the fake evidence the four-state contract forbids.
  rows: [],
}

const fileName = `ns-live-attempt-${stamp.replaceAll(':', '-')}.json`
const target = join(pathFor(outDir), fileName)
mkdirSync(pathFor(outDir), { recursive: true })
const text = `${JSON.stringify(snapshotRow, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, sha256(text), 'utf8')

if (asJson) process.stdout.write(text)
process.stdout.write(
  `live sample attempt: ${outcome.toUpperCase()} · blockers ${blockers.length === 0 ? 'none' : blockers.join(', ')}\n`,
)
for (const item of evidence) {
  process.stdout.write(`  ${item.ok ? 'OK  ' : 'MISS'} ${item.id.padEnd(30)} ${item.detail}\n`)
}
process.stdout.write(`ssot ${outDir}/${fileName} sha256=${sha256(text).slice(0, 12)}…\n`)
