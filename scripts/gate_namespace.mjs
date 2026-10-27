#!/usr/bin/env node
/**
 * Gate: namespace safety.
 *
 * Hard rule from PROJECT_RULES.md §9: never reuse an upstream loader row id or
 * service name. A collision with a core row id does not degrade gracefully — it
 * makes the whole profile fail to boot (`duplicate loader entry id`), which is
 * exactly the class of failure this project exists to prevent.
 *
 * Zero-dependency on purpose: the patch file is parsed with a line scanner, not
 * with a YAML library, so the gate can never fail due to a missing module.
 *
 * Negative control: `--mutate` pretends one row id is `plugin-manager`.
 */

import { exists, listDir, readJson, readText, runGate } from './lib/kit.mjs'

const RESERVED_IDS = new Set([
  'plugin-manager',
  'plugin-market',
  'tools',
  'session',
  'llm',
  'web',
  'permission',
  'settings',
  'commands',
  'skills',
  'agent',
  'loader',
  'base',
])

const ROW_PREFIX = 'compat-'

await runGate('namespace', async ({ checks, mutate }) => {
  const patchPath = 'packages/plugin/cordis.patch.yml'
  if (!checks.require('patch-exists', exists(patchPath))) return
  const patch = readText(patchPath)

  const ids = []
  const names = []
  // Rows must arrive through `insert:`. A top-level `- id: x / name: y` is an *edit of
  // entry x*; upstream drops it when x does not exist and only writes a stderr warning
  // (`patch: entry "x" not found`), so the bundle installs cleanly and mounts nothing.
  // Measured in R14 on 0.2.1-rc.4 — see docs/specs/M3-probe.md §2.
  const notInserted = []
  let currentItemIsInsert = false
  for (const line of patch.split(/\r?\n/)) {
    const withoutComment = line.replace(/\s+#.*$/, '')
    if (/^- insert:\s*$/.test(withoutComment)) {
      currentItemIsInsert = true
      continue
    }
    if (/^- /.test(withoutComment)) currentItemIsInsert = false
    const idMatch = /^\s*-\s+id:\s*(\S+)\s*$/.exec(withoutComment)
    if (idMatch !== null) {
      ids.push(idMatch[1])
      if (!currentItemIsInsert) notInserted.push(idMatch[1])
    }
    const nameMatch = /^\s+name:\s*(\S+)\s*$/.exec(withoutComment)
    if (nameMatch !== null) names.push(nameMatch[1])
  }

  checks.require('rows-present', ids.length >= 1, `${ids.length} rows`)

  checks.add(
    'rows-are-inserted',
    notInserted.length === 0,
    notInserted.length > 0
      ? `these rows patch an entry instead of inserting one (upstream skips unknown targets): ${notInserted.join(', ')}`
      : 'ok',
  )

  if (mutate && ids.length > 0) ids[0] = 'plugin-manager'

  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  checks.add('no-duplicate-ids', duplicates.length === 0, duplicates.join(', '))

  const badPrefix = ids.filter((id) => !id.startsWith(ROW_PREFIX))
  checks.add('row-prefix', badPrefix.length === 0, badPrefix.length > 0 ? `must start with ${ROW_PREFIX}: ${badPrefix.join(', ')}` : 'ok')

  const reserved = ids.filter((id) => RESERVED_IDS.has(id))
  checks.add('no-reserved-ids', reserved.length === 0, reserved.length > 0 ? `reserved upstream ids: ${reserved.join(', ')}` : 'ok')

  const plugin = readJson('packages/plugin/package.json')
  const resolvable = names.filter((name) => name.startsWith(`${plugin.name}/`) || name.startsWith('.'))
  checks.add('row-names-resolve', resolvable.length === names.length, names.join(', '))

  checks.add(
    'bundle-declared',
    plugin.dsh?.bundle?.patch === './cordis.patch.yml',
    JSON.stringify(plugin.dsh ?? null),
  )

  // Package naming: public surface must stay inside our scope so the gate can
  // reason about it, and so users cannot confuse us with a core package.
  const packages = listDir('packages').filter((entry) => entry.isDirectory)
  for (const dir of packages) {
    const manifestPath = `packages/${dir.name}/package.json`
    if (!exists(manifestPath)) {
      checks.add(`pkg:${dir.name}`, false, 'missing package.json')
      continue
    }
    const manifest = readJson(manifestPath)
    const nameOk = manifest.name === 'dsh-triage' || String(manifest.name).startsWith('@dsh-triage/')
    checks.add(`pkg-name:${dir.name}`, nameOk, String(manifest.name))
  }

  // Any future cordis service must be namespaced as well.
  const serviceProblem = []
  for (const dir of packages) {
    for (const file of listFilesUnder(`packages/${dir.name}/src`)) {
      const text = readText(file)
      for (const match of text.matchAll(/\.(?:provide|set)\(\s*['"]([^'"]+)['"]/g)) {
        if (!match[1].startsWith('compat')) serviceProblem.push(`${file}:${match[1]}`)
      }
    }
  }
  checks.add('service-prefix', serviceProblem.length === 0, serviceProblem.slice(0, 5).join(', ') || 'ok')
})

function listFilesUnder(relativePath) {
  const out = []
  const walk = (current) => {
    for (const entry of listDir(current)) {
      const next = `${current}/${entry.name}`
      if (entry.isDirectory) walk(next)
      else if (entry.isFile && entry.name.endsWith('.ts')) out.push(next)
    }
  }
  walk(relativePath)
  return out
}
