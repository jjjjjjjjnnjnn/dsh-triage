#!/usr/bin/env node
/**
 * Record one `audit` run as hash-locked SSOT (M2-a).
 *
 * WHY: `audit` prints for humans, but a step of work needs an artifact that gate
 * `step-review` can re-hash, and that a reviewer can replay. This is the audit
 * counterpart of `record_case.mjs`: same engine, same redaction, one file.
 *
 * It records the three facts this round added:
 *   - which installed package put a row's copy there (`findDeclarers`),
 *   - whether one package name exists at two versions (`findDuplicateCopies`),
 *   - the row verdicts that result from both.
 *
 *   node scripts/record_audit.mjs --dsh-home <sandbox> --profile desktop --stamp 2026-10-27T00:00:00.000Z
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { abs, fileUrl, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const rawStamp = argOf('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601\n`)
  process.exit(2)
}
const profile = argOf('--profile', 'web')
const dshHome = argOf('--dsh-home', join(process.env['USERPROFILE'] ?? homedir(), '.dsh'))

const core = await import(fileUrl('packages/core/dist/index.js'))
const plugin = await import(fileUrl('packages/plugin/dist/load.js'))

const envResult = await core.loadEnv({ dshHome, profile })
if (!envResult.ok) {
  process.stderr.write(`cannot read the profile: ${envResult.error.code} — ${envResult.error.detail}\n`)
  process.exit(3)
}
const env = envResult.value
const redactRoots = [homedir(), tmpdir(), dshHome]

const composition = await plugin.loadComposition(env, dshHome)
const claims = []
for (const layer of composition.layers) {
  if (layer.patchText === null) continue
  const patch = core.parsePatchYaml(layer.patchText)
  if (!patch.ok) continue
  claims.push(...core.extractEntryClaims(patch.value, `bundle:${layer.name}`))
}
for (const [text, label] of [
  [composition.profilePatch.text, 'patch:profile'],
  [composition.homePatch.text, 'patch:home'],
]) {
  if (text === null) continue
  const patch = core.parsePatchYaml(text)
  if (!patch.ok) continue
  claims.push(...core.extractEntryClaims(patch.value, label))
}

const rows = await plugin.resolveRows(env, core.rowTargets(claims))
const duplicates = await plugin.findDuplicateCopies(env)
const rowVerdicts = core.verdictsFromRowAdmission({ env, rows, generatedAt: stamp })
const duplicateVerdicts = core.verdictsFromDuplicateCopies({ env, duplicates, generatedAt: stamp })

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_audit.mjs',
  generated_at: stamp,
  command: 'audit',
  env: core.redactEnv(env, redactRoots),
  scanned: {
    bundles: composition.layers.length,
    rows: claims.length,
    import_targets: rows.length,
  },
  rows: rows.map((row) => ({
    row_id: row.rowId,
    module: row.module,
    source: row.source,
    version: row.version,
    declared_by: (row.declaredBy ?? []).map((origin) => ({ name: origin.name, version: origin.version, field: origin.field })),
  })),
  duplicates: duplicates.map((duplicate) => ({
    name: duplicate.name,
    kind: duplicate.kind,
    copies: duplicate.copies.map((copy) => ({ scope: copy.scope, path: copy.path, version: copy.version })),
  })),
  verdicts: [...rowVerdicts, ...duplicateVerdicts].map((verdict) => core.redactVerdict(verdict, redactRoots)),
  // Composition errors can name files; redact them the same way as everything else.
  errors: composition.errors.map((error) =>
    redactRoots.reduce((text, root) => (root === '' ? text : text.split(root).join('~')), error),
  ),
}

const fileName = `audit-${stamp.replaceAll(':', '-')}.json`
mkdirSync(abs('data/results'), { recursive: true })
const target = abs(join('data/results', fileName))
const text = `${JSON.stringify(payload, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, sha256(text), 'utf8')

process.stdout.write(
  `audit: ${rows.length} row(s) · ${duplicates.length} duplicate group(s) · ${payload.verdicts.length} verdict(s)\n`,
)
for (const row of payload.rows) {
  const origins = row.declared_by.map((origin) => `${origin.name}@${origin.version ?? '?'} (${origin.field})`).join(', ')
  process.stdout.write(`  ${row.row_id} -> ${row.module}@${row.version ?? 'missing'}${origins === '' ? '' : `  declared by ${origins}`}\n`)
}
for (const duplicate of payload.duplicates) {
  process.stdout.write(
    `  duplicate ${duplicate.name} (${duplicate.kind}): ${duplicate.copies.map((copy) => `${copy.scope}=${copy.version ?? '?'}`).join(' vs ')}\n`,
  )
}
process.stdout.write(`ssot data/results/${fileName} sha256=${sha256(text).slice(0, 12)}…\n`)
