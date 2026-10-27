#!/usr/bin/env node
/**
 * Registry facts recorder (T-109 / T-115).
 *
 * WHY THIS EXISTS: the dist-tag drift finding (`@deepseek-ai/dsh-tools` published
 * `latest = 0.0.1-rc.1` while `0.2.1-rc.x` was already out) was a claim in a review
 * document. A claim about the registry has to come from the registry, with a
 * timestamp, or it is just a memory. This script asks npm, applies the same pure
 * judgement the CLI uses, and writes the result to the SSOT.
 *
 * WHAT IT DOES NOT DO: no tarball download, no execution, no install. Metadata only.
 *
 * Determinism: the artifact is a snapshot of a moving target, exactly like
 * `data/results/upstream-*.json`. The stamp is pinned, so two runs on the same
 * registry state agree; a later run is expected to differ and must not be
 * back-dated over this file.
 *
 *   node scripts/record_registry.mjs --stamp 2026-10-27T19:00:00.000Z
 *   node scripts/record_registry.mjs --package @deepseek-ai/dsh-tools --stamp …
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { judgeVersionDrift } from '@dsh-triage/core'
import { fetchPackument } from '@dsh-triage/signals'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const values = (name) => {
  const out = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1] !== undefined) out.push(argv[index + 1])
  }
  return out
}
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = argOf('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-10-27T19:00:00.000Z\n`)
  process.exit(2)
}

const packages = values('--package')
if (packages.length === 0) packages.push('@deepseek-ai/dsh-tools', '@deepseek-ai/dsh', '@deepseek-ai/dsh-base')
const outDir = String(argOf('--out', 'data/results'))
const asJson = argv.includes('--json')

const entries = []
for (const name of packages) {
  const packument = await fetchPackument(name, { at: stamp })
  if (!packument.ok) {
    entries.push({ name, ok: false, error: packument.error.code, detail: packument.error.detail })
    continue
  }
  const drift = judgeVersionDrift({
    latest: packument.value.latest,
    next: packument.value.distTags['next'] ?? null,
    versions: [...packument.value.versions.keys()],
    publishedAt: packument.value.publishedAt,
    deprecated: [...packument.value.versions.values()]
      .filter((manifest) => manifest.deprecated !== undefined)
      .map((manifest) => manifest.version),
  })
  entries.push({
    name,
    ok: true,
    dist_tags: Object.fromEntries(Object.entries(packument.value.distTags).sort(([a], [b]) => a.localeCompare(b))),
    versions_published: packument.value.versions.size,
    newest_published_at: drift.newestPublishedAt,
    drift: {
      latest: drift.latest,
      next: drift.next,
      newest: drift.newest,
      newest_stable: drift.newestStable,
      standing: drift.standing,
      detail: drift.detail,
    },
  })
}

const failed = entries.filter((entry) => entry.ok === false)
const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_registry.mjs',
  generated_at: stamp,
  // Where these facts come from, so nobody mistakes them for a local measurement.
  source: { registry: 'https://registry.npmjs.org', tier: 'measured-registry', fetched_at: stamp },
  packages: entries,
  summary: {
    packages: entries.length,
    failures: failed.length,
    drift: entries
      .filter((entry) => entry.ok === true && entry.drift !== undefined)
      .map((entry) => `${entry.name}: ${entry.drift.standing}`)
      .sort(),
  },
}

const fileName = `registry-${stamp.replaceAll(':', '-')}.json`
const target = join(pathFor(outDir), fileName)
mkdirSync(pathFor(outDir), { recursive: true })
const text = `${JSON.stringify(payload, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, sha256(text), 'utf8')

if (asJson) process.stdout.write(text)
for (const line of payload.summary.drift) process.stdout.write(`drift  ${line}\n`)
for (const entry of failed) process.stdout.write(`error  ${entry.name}: ${entry.error} (${entry.detail})\n`)
process.stdout.write(`ssot ${outDir}/${fileName} sha256=${sha256(text).slice(0, 12)}…\n`)
