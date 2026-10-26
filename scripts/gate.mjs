#!/usr/bin/env node
/**
 * Gate runner.
 *
 *   node scripts/gate.mjs              run every registered gate
 *   node scripts/gate.mjs --fast       skip gates that need a build
 *   node scripts/gate.mjs --mutate     negative controls: every gate MUST fail
 *   node scripts/gate.mjs --json       machine-readable summary
 *
 * The registry lives in `audit/gate_ledger.json`; `gate_governance` keeps the
 * registry and `scripts/` in sync, so a new gate cannot be forgotten.
 */

import { spawnSync } from 'node:child_process'
import { readJson, repoRoot } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const fast = argv.includes('--fast')
const mutate = argv.includes('--mutate')
const json = argv.includes('--json')

const ledger = readJson('audit/gate_ledger.json')
const gates = (ledger.gates ?? []).filter((gate) => !(fast && gate.requires_build))

const results = []
for (const gate of gates) {
  const args = [gate.script]
  if (mutate) args.push('--mutate')
  if (json) args.push('--json')
  const started = Date.now()
  const run = spawnSync(process.execPath, args, { cwd: repoRoot(), encoding: 'utf8' })
  const durationMs = Date.now() - started
  const exitCode = run.status ?? 1
  const passed = mutate ? exitCode !== 0 : exitCode === 0
  results.push({
    id: gate.id,
    script: gate.script,
    exitCode,
    durationMs,
    ok: passed,
    // In mutate mode a failing gate is the desired outcome; keep the log for triage.
    log: mutate ? undefined : tail(`${run.stdout ?? ''}${run.stderr ?? ''}`),
  })
  if (!json) {
    const label = mutate ? (exitCode !== 0 ? 'CAUGHT' : 'MISSED') : exitCode === 0 ? 'PASS' : 'FAIL'
    process.stdout.write(`${label.padEnd(7)} ${gate.id.padEnd(18)} ${String(durationMs).padStart(5)}ms\n`)
    if (!passed) {
      process.stdout.write(`${tail(`${run.stdout ?? ''}${run.stderr ?? ''}`, 12)}\n`)
    }
  }
}

const failed = results.filter((result) => !result.ok)
if (json) {
  process.stdout.write(
    `${JSON.stringify(
      { mode: mutate ? 'mutate' : 'normal', fast, ok: failed.length === 0, gates: results },
      null,
      2,
    )}\n`,
  )
} else {
  process.stdout.write(
    `\n${failed.length === 0 ? 'ALL GREEN' : `${failed.length} GATE(S) FAILED`} · ${gates.length} gates${mutate ? ' · negative control mode' : ''}\n`,
  )
}
process.exitCode = failed.length === 0 ? 0 : 1

function tail(text, lines = 8) {
  const all = text.trimEnd().split(/\r?\n/)
  return all.slice(-lines).join('\n')
}
