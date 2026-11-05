#!/usr/bin/env node
/**
 * Publish-order evidence, recorded from the product path plus the four pure cases (T-861).
 *
 * WHY BOTH HALVES: the live half proves the CLI actually reaches the registry and prints the block;
 * the case half pins the judgement in both directions — a renumbered old line must be a `trap`, and
 * a normal patch must never be one. A recorder that only showed live readings could look green while
 * the comparison silently reported "no trap" for everything (the R83 lesson: a post-mitigation
 * reading cannot tell "correct" from "nothing left to compare").
 *
 *   node scripts/record_update_order.mjs --stamp 2026-11-05T11:30:00.000Z \
 *     --dsh-home sandbox/upstream/0.2.1-rc.4/home --profile upstream
 *
 * EXIT: 0 artifact written · 2 usage / the CLI could not be run.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { judgeUpdateOrder } from '../packages/core/dist/index.js'
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
const outDir = String(argOf('--out', 'data/results'))
const profile = String(argOf('--profile', 'upstream'))
const dshHome = String(argOf('--dsh-home', join('sandbox', 'upstream', '0.2.1-rc.4', 'home')))
const repoRoot = resolve(import.meta.dirname, '..')
const cli = join(repoRoot, 'packages', 'plugin', 'dist', 'cli.js')
if (!existsSync(cli)) {
  process.stderr.write(`the CLI is not built: ${cli}\n`)
  process.exit(2)
}
if (!existsSync(join(repoRoot, dshHome))) {
  process.stderr.write(`no profile at ${dshHome}; pass --dsh-home\n`)
  process.exit(2)
}

/* --------------------------------- live half -------------------------------- */

const run = spawnSync(process.execPath, [cli, 'audit', '--registry', '--json', '--locale', 'en', '--dsh-home', dshHome, '--profile', profile], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
})

let payload
try {
  payload = JSON.parse(String(run.stdout ?? ''))
} catch {
  process.stderr.write(`the CLI did not print JSON (exit ${String(run.status)})\n${String(run.stderr ?? '').slice(0, 400)}\n`)
  process.exit(2)
}
const rows = Array.isArray(payload?.update_order) ? payload.update_order : null
if (rows === null) {
  process.stderr.write('the CLI printed no update_order block; nothing was measured\n')
  process.exit(2)
}

/* -------------------------------- pure half --------------------------------- */

const cases = [
  {
    id: 'N1-same-line-patch',
    expect: 'no-trap',
    facts: { latest: '0.2.6', next: null, versions: ['0.2.5', '0.2.6'], publishedAt: { '0.2.5': '2026-11-03T11:45:32.384Z', '0.2.6': '2026-11-04T23:20:44.548Z' } },
    installed: '0.2.5',
  },
  {
    id: 'N2-renumbered-old-line',
    expect: 'trap',
    facts: { latest: '0.2.6', next: null, versions: ['0.2.6', '0.12.3'], publishedAt: { '0.2.6': '2026-11-04T23:20:44.548Z', '0.12.3': '2026-10-18T16:25:28.000Z' } },
    installed: '0.2.6',
  },
  {
    id: 'N3-higher-semver-published-later',
    expect: 'no-trap',
    facts: { latest: '0.2.1-rc.5', next: '0.2.2-rc.1', versions: ['0.2.1-rc.5', '0.2.2-rc.1'], publishedAt: { '0.2.1-rc.5': '2026-10-30T08:00:00.000Z', '0.2.2-rc.1': '2026-11-05T07:00:00.000Z' } },
    installed: '0.2.1-rc.5',
  },
  {
    id: 'N4-nothing-above',
    expect: 'no-candidate',
    facts: { latest: '0.2.6', next: null, versions: ['0.2.6'], publishedAt: { '0.2.6': '2026-11-04T23:20:44.548Z' } },
    installed: '0.2.6',
  },
  {
    id: 'N5-candidate-time-missing',
    expect: 'unmeasured',
    facts: { latest: '0.2.6', next: null, versions: ['0.2.6', '0.12.3'], publishedAt: { '0.2.6': '2026-11-04T23:20:44.548Z' } },
    installed: '0.2.6',
  },
].map((entry) => {
  const order = judgeUpdateOrder(entry.facts, entry.installed)
  return { id: entry.id, installed: entry.installed, expected: entry.expect, actual: order.verdict, candidate: order.candidate, passed: order.verdict === entry.expect }
})

/* --------------------------------- artifact --------------------------------- */

const result = {
  schema_version: 1,
  produced_by: 'scripts/record_update_order.mjs',
  generated_at: stamp,
  question: 'does the installed set contain a package whose highest-semver neighbour was published earlier than what is installed?',
  sample: { kind: 'measured', profile, dsh_home: '(dsh-home)' },
  live: {
    cli_exit: run.status,
    rows: rows.length,
    verdicts: rows.reduce((counts, row) => ({ ...counts, [row.verdict]: (counts[row.verdict] ?? 0) + 1 }), {}),
  },
  rows,
  cases,
  passed: cases.every((entry) => entry.passed),
  limits: [
    'the live half reads one machine\'s installed set against the registry at one moment; the rows describe that profile, not the ecosystem',
    'traps are counted, not predicted: `no-candidate` means "no higher semver is published", never "you are up to date"',
    'publish order says nothing about whether either build runs — that is the probe, a different command',
    'unmeasured rows are kept on purpose: an unreadable registry must not look like a clean answer',
  ],
  recompute: `node scripts/record_update_order.mjs --stamp ${stamp} --dsh-home '${'(dsh-home)'}' --profile ${profile}`,
}

const fileName = `update-order-${stamp.replace(/[:.]/g, '-')}.json`
const written = writeEvidence({ outDir, fileName, text: `${JSON.stringify(result, null, 2)}\n`, root: repoRoot })
if (!written.ok) {
  process.stderr.write(`refusing to overwrite existing evidence: ${written.target}\n`)
  process.exit(2)
}

for (const row of rows) {
  const candidate = row.candidate === null ? '' : ` → ${row.candidate.version}`
  process.stdout.write(`${String(row.verdict).padEnd(12)} ${row.name}@${row.version}${candidate}\n`)
}
process.stdout.write(`cases        ${cases.filter((entry) => entry.passed).length}/${cases.length}\n`)
process.stdout.write(`ssot ${written.display} (${written.sha256.slice(0, 12)}…)\n`)
process.exit(result.passed ? 0 : 1)
