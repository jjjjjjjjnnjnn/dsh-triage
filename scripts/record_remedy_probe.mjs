#!/usr/bin/env node
/**
 * "Then which build should they install?" — the remedy side of a reply draft (R71).
 *
 * WHY THIS EXISTS: R57's three reply drafts all end with an action ("install a build that matches your
 * runtime" / "pin the version"). That advice was never measured. Meanwhile the same engine can answer it:
 * probe the *proposed* build against the target runtime and record whether it passes. Advice that has been
 * run through the same admission rules as the diagnosis is the difference between a helpful reply and
 * "check whether a newer version exists".
 *
 * WHAT IT IS NOT: a promise. `admitted` means the published declaration admits this runtime — nothing about
 * whether the code runs, and nothing about the reporter's machine.
 *
 *   node scripts/record_remedy_probe.mjs --target 0.2.1-rc.5 --pins "@deepseek-ai/dsh-mcp-client@0.2.1-rc.5"
 *
 * EXIT: 0 artifact written · 2 usage or nothing measured (an unreadable registry is not a "no").
 */

import process from 'node:process'

import { fetchPackument } from '../packages/signals/dist/index.js'
import { probePackage } from './lib/discussion-probe.mjs'
import { writeEvidence } from './lib/evidence.mjs'
import { abs, isoStamp } from './lib/kit.mjs'

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

const target = String(argOf('--target', '')).trim()
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(target)) {
  process.stderr.write('usage: node scripts/record_remedy_probe.mjs --target <exact version> --pins "<pkg>@<version>,..."\n')
  process.exit(2)
}

const pins = String(argOf('--pins', ''))
  .split(',')
  .map((value) => value.trim())
  .filter((value) => /^(@?[a-z0-9][a-z0-9._/-]*[a-z0-9])@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/i.test(value))
if (pins.length === 0) {
  process.stderr.write('usage: node scripts/record_remedy_probe.mjs --target <version> --pins "<pkg>@<version>,..."\n')
  process.exit(2)
}

const outDir = String(argOf('--out', 'data/results'))
/*
 * One packument read per package, kept: the same read answers two different questions and the reply
 * drafts cite both — "what does this build declare?" and "what does `latest` actually point at?".
 * (R47's `version-drift` lesson: the tag is a fact with a timestamp, not a property of the package.)
 */
const packuments = new Map()
const loadPackument = (name) => {
  if (!packuments.has(name)) packuments.set(name, fetchPackument(name, {}))
  return packuments.get(name)
}

const rows = []
for (const pin of pins) {
  const at = pin.lastIndexOf('@')
  const name = pin.slice(0, at)
  const version = pin.slice(at + 1)
  const probe = await probePackage(name, target, { pinned: version, loadPackument })
  const packument = await loadPackument(name)
  const tags = packument?.ok === true ? (packument.value?.distTags ?? null) : null
  rows.push({
    package: name,
    version,
    target,
    state: probe.state,
    admission_status: probe.admission_status ?? null,
    admits_target: probe.admits_target ?? null,
    mode: probe.mode ?? null,
    declared_range: probe.declared_range ?? null,
    unmet: Array.isArray(probe.unmet) ? probe.unmet : [],
    detail: probe.detail ?? null,
    dist_tags: tags === null ? null : { latest: tags.latest ?? null, next: tags.next ?? null },
  })
}

const measured = rows.filter((row) => row.state === 'measured')
if (measured.length === 0) {
  process.stderr.write('nothing was measured, so nothing is written (an unreadable registry is not a no)\n')
  process.exit(2)
}

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_remedy_probe.mjs',
  generated_at: stamp,
  question: 'if the reporter installs this exact build, does the published declaration admit the target runtime?',
  sample: { target, pins },
  rows,
  limits: [
    'live registry read: a snapshot at one timestamp, not byte-for-byte reproducible offline',
    'admitted is a declaration-layer result; it says nothing about whether the code runs on the reporter\'s machine',
    'the engine is the same `evaluateAdmission` used by `check` / `why` / `upgrade` — a second rule set would be a bug',
  ],
}

const result = writeEvidence({
  outDir,
  fileName: `remedy-probe-${stamp.replace(/[:.]/g, '-')}.json`,
  text: `${JSON.stringify(payload, null, 2)}\n`,
})
if (!result.ok) {
  process.stderr.write(`refusing to overwrite existing evidence: ${result.target}\n`)
  process.exit(2)
}

for (const row of rows) {
  const peers = row.declared_range === null ? '' : ` · ${String(row.declared_range).split(' , ').length} peer(s)`
  process.stdout.write(`${row.package}@${row.version} → ${String(row.admission_status)} on ${row.target}${peers}\n`)
}
process.stdout.write(`ssot ${result.display} sha256=${result.sha256.slice(0, 12)}…\n`)
