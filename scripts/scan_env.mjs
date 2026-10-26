#!/usr/bin/env node
/**
 * Real-run SSOT producer.
 *
 * Scans a real DSH profile (read-only), computes verdicts with the same engine
 * the CLI uses, and writes hash-locked results into `data/results/`.
 *
 *   node scripts/scan_env.mjs
 *   node scripts/scan_env.mjs --dsh-home "C:/Users/me/.dsh" --profile web
 *   node scripts/scan_env.mjs --stamp 2026-10-26T00:00:00.000Z   # reproducible
 *
 * Rules: never writes to the profile, never reads credentials, and a missing
 * profile is recorded as a real outcome rather than an error.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { abs, fileUrl, repoRoot, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const stamp = argOf('--stamp', new Date().toISOString())
const profile = argOf('--profile', 'web')
const dshHome = argOf('--dsh-home', process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh'))

const core = await import(fileUrl('packages/core/dist/index.js'))
const plugin = await import(fileUrl('packages/plugin/dist/load.js'))
const { homedir } = await import('node:os')

const env = await core.loadEnv({ dshHome, profile })
mkdirSync(abs('data/results'), { recursive: true })

/** Everything written to disk is redacted: `data/results` may be published. */
const redactRoots = [homedir(), dshHome]

if (!env.ok) {
  const payload = {
    schema_version: 1,
    produced_by: 'scripts/scan_env.mjs',
    generated_at: stamp,
    status: 'skipped',
    reason: env.error.code,
    detail: core.redactPath(env.error.detail, redactRoots),
    dsh_home: core.redactPath(dshHome, redactRoots),
    profile,
    verdicts: [],
  }
  writeResult('scan', payload, stamp)
  process.stdout.write(`skipped: ${env.error.code} (${env.error.detail})\n`)
  process.exit(0)
}

// IO uses the real paths; only the serialized fingerprint is redacted.
const realEnv = env.value
const fingerprint = core.redactEnv(realEnv, redactRoots)
const composition = await plugin.loadComposition(realEnv, dshHome)

const claims = []
for (const layer of composition.layers) {
  if (layer.patchText === null) continue
  const parsed = core.parsePatchYaml(layer.patchText)
  if (!parsed.ok) continue
  claims.push(...core.extractEntryClaims(parsed.value, `bundle:${layer.name}`))
}
for (const [text, source] of [
  [composition.profilePatch.text, 'patch:profile'],
  [composition.homePatch.text, 'patch:home'],
]) {
  if (text === null) continue
  const parsed = core.parsePatchYaml(text)
  if (!parsed.ok) continue
  claims.push(...core.extractEntryClaims(parsed.value, source))
}

const verdicts = composition.layers.map((layer) =>
  core.verdictFromAdmission({
    subject: { name: layer.name, version: layer.version, kind: 'plugin' },
    env: fingerprint,
    admission: core.evaluateAdmission(layer.manifest, realEnv.dsh),
    generatedAt: stamp,
  }),
)

const collisions = core.findEntryIdCollisions(claims)
verdicts.push(...core.verdictsFromCollisions({ env: fingerprint, collisions, generatedAt: stamp }))

const summary = verdicts.reduce(
  (acc, verdict) => ({ ...acc, [verdict.conclusion]: (acc[verdict.conclusion] ?? 0) + 1 }),
  {},
)

writeResult(
  'why',
  {
    schema_version: 1,
    produced_by: 'scripts/scan_env.mjs',
    generated_at: stamp,
    status: 'ok',
    env: fingerprint,
    verdicts: verdicts.map((verdict) => core.redactVerdict(verdict, redactRoots)),
    collisions,
    summary,
    scanned: { bundles: composition.layers.length, entries: claims.length },
    errors: composition.errors,
  },
  stamp,
)

process.stdout.write(
  `wrote data/results/why-${fileStamp(stamp)}.json · ${verdicts.length} verdicts · ${claims.length} rows · ${JSON.stringify(summary)}\n`,
)

function fileStamp(iso) {
  return iso.replaceAll(':', '-')
}

function writeResult(kind, payload, iso) {
  const name = `${kind}-${fileStamp(iso)}.json`
  const target = abs(join('data/results', name))
  const text = `${JSON.stringify(payload, null, 2)}\n`
  writeFileSync(target, text, 'utf8')
  writeFileSync(`${target}.sha256`, sha256(text), 'utf8')
  process.stdout.write(`ssot ${name} sha256=${sha256(text).slice(0, 12)}…\n`)
  void repoRoot
}
