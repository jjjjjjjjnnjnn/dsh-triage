#!/usr/bin/env node
/**
 * One restore point, written by a script (R78).
 *
 * WHY THIS EXISTS: `backup/BACKUP_POLICY.md` has said since M0 that "关键决策点（里程碑通过 / 判据变更 /
 * 发布前）落 `backup/snapshots/<name>.json` + `.sha256`，快照由脚本生成（M2 起提供
 * `scripts/snapshot_state.mjs`）". That script was never written and `backup/snapshots/` still held only
 * `.gitkeep` — a rule that reads as enforced and is not. Nothing in the gate suite could notice, because no
 * check ever looked at `backup/`. This file makes the promise executable; `gate_governance` now checks that
 * the script named in the policy exists and that every snapshot is hash-locked.
 *
 * WHAT A SNAPSHOT IS: a claim about **this commit**, not a backup of the repository (git is the backup).
 * It carries: the published version, the runtime, the gate verdict, and a sha256 manifest of every SSOT
 * artifact. Restoring means `git checkout <tag>` + reading this file to know what "green" looked like.
 *
 * WHAT IT DELIBERATELY EXCLUDES: gate **durations** and absolute paths. Both would make two runs of the same
 * commit differ, which is the reproducibility rule this repository enforces everywhere else.
 *
 *   node scripts/snapshot_state.mjs --stamp 2026-11-03T16:50:00.000Z --name before-handover
 *   node scripts/snapshot_state.mjs --no-gates          # skip running the gate suite
 *
 * EXIT CODES: 0 written · 1 the gate suite is red (snapshot still written, marked) · 2 bad usage / could not run.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { writeEvidence } from './lib/evidence.mjs'
import { abs, isoStamp, repoRoot, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-11-03T16:50:00.000Z\n`)
  process.exit(2)
}

const withGates = !argv.includes('--no-gates')
const nameArg = argOf('--name', null)
if (nameArg !== null && !/^[A-Za-z0-9._-]+$/.test(String(nameArg))) {
  process.stderr.write(`--name must be a plain label (letters, digits, dot, dash, underscore), got "${String(nameArg)}"\n`)
  process.exit(2)
}

const root = repoRoot()
const version = JSON.parse(readFileSync(join(root, 'packages/plugin/package.json'), 'utf8')).version
const label = nameArg === null ? `snapshot-${version}-${stamp.replaceAll(':', '-')}` : `snapshot-${version}-${nameArg}`

const git = (...args) => {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  return run.status === 0 ? String(run.stdout ?? '').trim() : null
}

/**
 * The gate verdict. `scripts/gate.mjs --json` is the machine view; durations are dropped on purpose so the
 * same commit always yields the same snapshot body.
 */
let gates = null
if (withGates) {
  const run = spawnSync(process.execPath, ['scripts/gate.mjs', '--json'], { cwd: root, encoding: 'utf8', windowsHide: true })
  try {
    const parsed = JSON.parse(String(run.stdout ?? ''))
    gates = {
      ok: parsed.ok === true,
      mode: parsed.mode,
      gates: (Array.isArray(parsed.gates) ? parsed.gates : []).map((gate) => ({ id: gate.id, ok: gate.ok === true })),
    }
  } catch {
    /* A gate run we cannot parse is not a green gate. */
    gates = { ok: false, mode: null, gates: [], unreadable: true }
  }
}

/** Every SSOT artifact, hash-locked, sorted: the part of "state" a tag alone cannot tell you. */
const ssot = readdirSync(join(root, 'data/results'))
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => {
    const text = readFileSync(join(root, 'data/results', name), 'utf8')
    return { file: name, sha256: sha256(text) }
  })

const ledger = JSON.parse(readFileSync(join(root, 'audit/gate_ledger.json'), 'utf8'))
const payload = {
  schema_version: 1,
  produced_by: 'scripts/snapshot_state.mjs',
  generated_at: stamp,
  release: {
    package: 'dsh-triage',
    version,
    git_head: git('rev-parse', 'HEAD'),
    git_branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    // Untracked files count too: a snapshot of a tree nobody committed describes a state nobody can restore.
    git_dirty: String(git('status', '--porcelain') ?? '').length > 0,
  },
  runtime: { node: process.version, platform: process.platform },
  gates,
  gate_registry: (Array.isArray(ledger.gates) ? ledger.gates : []).map((gate) => gate.id),
  ssot: { count: ssot.length, artifacts: ssot },
  limits: [
    'a snapshot describes ONE commit: it is not a backup (git is) and it is not a claim about a published version — check data/results/publish-*.json for that',
    'gate durations and absolute paths are excluded so two runs of the same commit produce the same body',
    'the SSOT manifest hashes the JSON files only; the sibling .sha256 files are themselves checkable with gate `ssot`',
    '`git_dirty: true` means the snapshot describes a tree that has uncommitted or untracked changes — restore it only together with that working copy',
  ],
}

const written = writeEvidence({
  outDir: abs(join('backup', 'snapshots')),
  fileName: `${label}.json`,
  text: `${JSON.stringify(payload, null, 2)}\n`,
})
if (written.ok !== true) {
  process.stderr.write(`refusing to overwrite ${written.target}\n`)
  process.exit(2)
}

process.stdout.write(
  `snapshot ${written.display} (${written.sha256.slice(0, 12)}…)\n` +
    `  version ${version} · head ${String(payload.release.git_head).slice(0, 7)} · dirty ${String(payload.release.git_dirty)}\n` +
    `  gates ${gates === null ? 'not run (--no-gates)' : gates.ok ? `green · ${gates.gates.length}` : 'RED'} · ssot ${ssot.length} artifact(s)\n`,
)
process.exit(gates !== null && gates.ok === false ? 1 : 0)
