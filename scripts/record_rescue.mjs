#!/usr/bin/env node
/**
 * "If this host will not start, which bundles would a rescue trim — and did asking change anything?"
 *
 * WHY THIS RECORDER EXISTS: `rescue` is the first command in this package whose whole promise is
 * that it *does not* touch the machine. A unit test can prove the classifier is pure; only a run
 * against a real profile can prove the command left the manifest alone — so this script hashes the
 * manifest, runs the CLI, hashes it again, and refuses to call the run clean if the bytes moved.
 *
 * WHAT IT DOES NOT DO: it does not apply anything, and it does not claim the host would boot after
 * a trim. Those are `--apply` (M8 B 段) and `probe --execute` respectively.
 *
 *   node scripts/record_rescue.mjs --stamp 2026-11-05T09:40:00.000Z --dsh-home "$env:USERPROFILE/.dsh"
 *   node scripts/record_rescue.mjs --stamp <iso> --dsh-home <fixture-home> --kind synthetic
 *
 * EXIT: 0 artifact written and the manifest is unchanged · 1 artifact written, manifest CHANGED
 *       (an honest red) · 2 bad usage / nothing measured (no artifact).
 */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { writeEvidence } from './lib/evidence.mjs'
import { isoStamp } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601\n`)
  process.exit(2)
}

const profile = String(argOf('--profile', 'web'))
const dshHome = String(argOf('--dsh-home', process.env['DSH_HOME'] ?? join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '', '.dsh')))
const outDir = String(argOf('--out', 'data/results'))
const kind = String(argOf('--kind', 'measured'))
if (kind !== 'measured' && kind !== 'synthetic') {
  process.stderr.write('usage: --kind measured|synthetic\n')
  process.exit(2)
}

const repoRoot = resolve(import.meta.dirname, '..')
const cli = join(repoRoot, 'packages', 'plugin', 'dist', 'cli.js')
if (!existsSync(cli)) {
  process.stderr.write(`the CLI is not built: ${cli}\n`)
  process.exit(2)
}

const profileDir = join(resolve(dshHome), 'profiles', profile)
const manifestPath = join(profileDir, 'package.json')
if (!existsSync(manifestPath)) {
  process.stderr.write(`nothing was measured: no profile manifest at ${manifestPath}\n`)
  process.exit(2)
}

const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const before = sha256Of(manifestPath)

const run = spawnSync(process.execPath, [cli, 'rescue', '--json', '--locale', 'en', '--dsh-home', resolve(dshHome), '--profile', profile], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
})

const after = sha256Of(manifestPath)
if (run.status !== 0 && run.status !== 1) {
  process.stderr.write(`nothing was measured: the CLI exited ${String(run.status)}\n${String(run.stderr ?? '').slice(0, 400)}\n`)
  process.exit(2)
}

let parsed
try {
  parsed = JSON.parse(String(run.stdout ?? ''))
} catch {
  process.stderr.write('nothing was measured: the CLI did not print JSON\n')
  process.exit(2)
}

const plan = parsed?.plan
if (plan === undefined || plan === null || plan.evidence !== 'scanned') {
  process.stderr.write('nothing was measured: the JSON had no scanned plan\n')
  process.exit(2)
}

const readOnly = before === after
const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_rescue.mjs',
  generated_at: stamp,
  question: 'if this host will not start, which dsh.profile.bundles entries would a rescue trim — and did asking change the profile?',
  sample: { kind, profile },
  inputs: {
    // Deliberately a placeholder: an artifact is published, a home path is not.
    dsh_home: '(dsh-home)',
    cli: 'packages/plugin/dist/cli.js',
    cli_exit: run.status,
    manifest_sha256: before,
    manifest_sha256_after: after,
    read_only: readOnly,
  },
  counts: {
    bundles: plan.bundles.length,
    removable: plan.removable.length,
    third_party: plan.thirdParty,
    unresolved: plan.unresolved,
  },
  plan,
  limits: [
    'a plan is computed from the profile manifest only: it does not prove the host boots, before or after a trim',
    'the CLI was invoked with --json; this artifact is that output plus the before/after manifest hashes',
    kind === 'synthetic'
      ? 'SYNTHETIC PROFILE: the manifest was constructed for this run, so the numbers describe the fixture, not a user machine'
      : 'one machine, one profile, one moment: the counts describe this profile, not the ecosystem',
    'evidence tier is `scanned` — dsh.profile.bundles is configuration read off disk, not something the package declares',
  ],
  recompute: `node scripts/record_rescue.mjs --stamp ${stamp} --dsh-home '${'(dsh-home)'}' --profile ${profile} --kind ${kind}`,
}

const fileName = `${kind === 'synthetic' ? 'rescue-fixture' : 'rescue'}-${stamp.replace(/[:.]/g, '-')}.json`
const result = writeEvidence({ outDir, fileName, text: `${JSON.stringify(payload, null, 2)}\n`, root: repoRoot })
if (!result.ok) {
  process.stderr.write(`refusing to overwrite existing evidence: ${result.target}\n`)
  process.exit(2)
}

process.stdout.write(`profile      ${profile} (${kind})\n`)
process.stdout.write(`bundles      ${payload.counts.bundles} · removable ${payload.counts.removable} · third-party ${payload.counts.third_party} · unresolved ${payload.counts.unresolved}\n`)
process.stdout.write(`manifest     ${before.slice(0, 12)}… → ${after.slice(0, 12)}… (read-only: ${String(readOnly)})\n`)
process.stdout.write(`ssot ${result.display} (${result.sha256.slice(0, 12)}…)\n`)

if (!readOnly) {
  process.stderr.write('the manifest changed during a plan: that is not a read-only command\n')
  process.exit(1)
}
process.exit(0)
