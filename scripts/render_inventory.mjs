#!/usr/bin/env node
/**
 * Render a `pluginInventory/list` snapshot through the same engine the CLI uses
 * and hash-lock the result (M2-a / T-201 P2).
 *
 * WHY A SCRIPT: `audit --snapshot` prints for humans, but a step of work needs an
 * artifact that gate `step-review` can re-hash. This is the inventory counterpart
 * of `record_case.mjs` — same engine, same redaction, one file of evidence.
 *
 *   node scripts/render_inventory.mjs --snapshot data/fixtures/inventory/desktop-web.json \
 *     --dsh-home <sandbox> --profile desktop --stamp 2026-10-27T00:00:00.000Z
 *
 * The snapshot is judged, never trusted: an unknown phase or a missing module name
 * aborts with exit 2, because silently dropping the runtime layer would turn
 * "I could not read the phases" into "no problems found".
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { abs, fileUrl, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const snapshotPath = argOf('--snapshot', null)
if (snapshotPath === null || snapshotPath.trim() === '') {
  process.stderr.write('usage: node scripts/render_inventory.mjs --snapshot <file> [--dsh-home <path>] [--profile <name>] [--stamp <iso>] [--sample <label>]\n')
  process.exit(2)
}
const rawStamp = argOf('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-10-27T00:00:00.000Z\n`)
  process.exit(2)
}
const profile = argOf('--profile', 'web')
const dshHome = argOf('--dsh-home', join(process.env['USERPROFILE'] ?? homedir(), '.dsh'))

/**
 * `live` is not a flag: it must be declared by the export itself. A hand-written
 * fixture cannot claim to be a Host sample by passing an argument.
 */
function sampleKindOf(value) {
  if (value === null || typeof value !== 'object') return 'synthetic'
  const declared = value['kind']
  if (declared === 'live') {
    if (typeof value['sampled_at'] !== 'string') {
      process.stderr.write('snapshot declares kind=live without sampled_at — refusing to label it live\n')
      process.exit(2)
    }
    return 'live'
  }
  return 'synthetic'
}

const core = await import(fileUrl('packages/core/dist/index.js'))
const plugin = await import(fileUrl('packages/plugin/dist/load.js'))

let raw
try {
  raw = JSON.parse(readFileSync(snapshotPath, 'utf8'))
} catch (error) {
  process.stderr.write(`cannot read ${snapshotPath}: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}

const envResult = await core.loadEnv({ dshHome, profile })
if (!envResult.ok) {
  process.stderr.write(`cannot read the profile: ${envResult.error.code} — ${envResult.error.detail}\n`)
  process.exit(3)
}
const env = envResult.value
const redactRoots = [homedir(), tmpdir(), dshHome]
const source = core.redactPath(snapshotPath, redactRoots)

const parsed = core.parseInventorySnapshot(raw, { source, sampledAt: stamp, profile })
if (!parsed.ok) {
  process.stderr.write(`snapshot rejected: ${parsed.error.code} — ${parsed.error.detail}\n`)
  process.exit(2)
}
const snapshot = parsed.value
const sampleKind = sampleKindOf(raw)

/* Declared rows come from the same composition the CLI reads (bundle + patch layers). */
const composition = await plugin.loadComposition(env, dshHome)
const claims = []
for (const layer of composition.layers) {
  if (layer.patchText === null) continue
  const patch = core.parsePatchYaml(layer.patchText)
  if (!patch.ok) continue
  claims.push(...core.extractEntryClaims(patch.value, `bundle:${layer.name}`))
}
for (const [text, sourceLabel] of [
  [composition.profilePatch.text, 'patch:profile'],
  [composition.homePatch.text, 'patch:home'],
]) {
  if (text === null) continue
  const patch = core.parsePatchYaml(text)
  if (!patch.ok) continue
  claims.push(...core.extractEntryClaims(patch.value, sourceLabel))
}
const declared = claims.map((claim) => ({ entryId: claim.id, module: claim.name }))

const verdicts = core.verdictsFromInventory({ env, snapshot, declared, generatedAt: stamp }).map((verdict) =>
  core.redactVerdict(verdict, redactRoots),
)
const diff = core.compareInventory(snapshot, declared)

const payload = {
  schema_version: 1,
  produced_by: 'scripts/render_inventory.mjs',
  generated_at: stamp,
  command: 'audit --snapshot',
  // Honesty about the input: a live Host sample and a contract-derived fixture are
  // not the same evidence, and the artifact must say which one it is.
  sample: {
    kind: sampleKind,
    source,
    sampled_at: snapshot.sampledAt,
    profile: snapshot.profile,    note:
      sampleKind === 'live'
        ? 'exported from a running Host via pluginInventory/list (the file declared kind=live and a sampled_at)'
        : 'synthetic snapshot: exercises the phase table, not a live observation of this machine',
  },
  env: core.redactEnv(env, redactRoots),
  inventory: {
    management_available: snapshot.managementAvailable,
    unknown_keys: snapshot.unknownKeys,
    unjudged: snapshot.unjudged,
    declared_without_module: declared.filter((row) => row.module === null).length,
    entries: snapshot.entries.map((entry) => ({
      entry_id: entry.entryId,
      module: entry.moduleName,
      enabled: entry.enabled,
      phase: entry.fiberPhase,
    })),
    missing: diff.missing,
    undeclared: diff.undeclared.map((entry) => ({ entry_id: entry.entryId, module: entry.moduleName, phase: entry.fiberPhase })),
  },
  verdicts,
  summary: verdicts.reduce((acc, verdict) => ({ ...acc, [verdict.conclusion]: (acc[verdict.conclusion] ?? 0) + 1 }), {}),
  discarded: false,
}

const fileName = `inventory-${stamp.replaceAll(':', '-')}.json`
mkdirSync(abs('data/results'), { recursive: true })
const target = abs(join('data/results', fileName))
const text = `${JSON.stringify(payload, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, sha256(text), 'utf8')

process.stdout.write(
  `inventory: ${snapshot.entries.length} entries · ${diff.missing.length} missing · ${diff.undeclared.length} undeclared · ${JSON.stringify(payload.summary)}\n`,
)
for (const verdict of verdicts) process.stdout.write(`${core.renderVerdict(verdict, 'en')}\n\n`)
process.stdout.write(`ssot data/results/${fileName} sha256=${sha256(text).slice(0, 12)}…\n`)
