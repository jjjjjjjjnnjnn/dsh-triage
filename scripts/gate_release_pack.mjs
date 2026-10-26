#!/usr/bin/env node
/**
 * Release readiness check (offline, no auth required).
 *
 *   node scripts/release_check.mjs            # all publishable packages
 *   node scripts/release_check.mjs --json
 *   node scripts/release_check.mjs --mutate   # negative control: MUST fail
 *
 * Uses `npm pack --dry-run --json` so we inspect exactly what would be published
 * (not what we think is published). Zero third-party deps; works without a
 * registry login, which is what makes it runnable in CI before `npm login`.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Checks, exists, listDir, readJson, repoRoot, runGate } from './lib/kit.mjs'

const MAX_PACKED_BYTES = 2 * 1024 * 1024

await runGate('release-check', async ({ checks, mutate }) => {
  const dirs = listDir('packages').filter((entry) => entry.isDirectory)
  checks.require('packages-present', dirs.length >= 3, `${dirs.length}`)

  for (const dir of dirs) {
    const manifestPath = `packages/${dir.name}/package.json`
    if (!exists(manifestPath)) {
      checks.add(`manifest:${dir.name}`, false, 'missing package.json')
      continue
    }
    const manifest = readJson(manifestPath)
    const label = String(manifest.name)
    if (manifest.private === true) continue

    const packed = packJson(dir.name)
    if (packed === null) {
      checks.add(`pack:${label}`, false, 'npm pack --dry-run failed')
      continue
    }
    const paths = packed.files.map((file) => file.path)
    const required = ['package.json', 'README.md', 'dist/index.js']
    if (manifest.dsh?.bundle?.patch !== undefined) {
      required.push(manifest.dsh.bundle.patch.replace(/^\.\//, ''), 'dist/cli.js', 'dist/host.js')
      for (const target of Object.values(manifest.bin ?? {})) {
        required.push(String(target).replace(/^\.\//, ''))
      }
    }
    if (mutate && dir.name === 'plugin') required.push('dist/this-file-does-not-exist.js')

    const missing = required.filter((file) => !paths.includes(file))
    checks.add(`files:${label}`, missing.length === 0, missing.join(', ') || `${paths.length} files`)

    const leaked = paths.filter((file) => file.startsWith('src/') || file.startsWith('tests/') || file.startsWith('node_modules/'))
    checks.add(`no-sources:${label}`, leaked.length === 0, leaked.slice(0, 3).join(', ') || 'ok')

    checks.add(
      `size:${label}`,
      packed.size <= MAX_PACKED_BYTES,
      `${Math.round(packed.size / 1024)} KiB packed (limit ${MAX_PACKED_BYTES / 1024} KiB)`,
    )

    if (manifest.dsh?.bundle !== undefined) {
      checks.add(`engines-dsh:${label}`, typeof manifest.engines?.dsh === 'string', String(manifest.engines?.dsh))
      const patchText = readFileSync(join(repoRoot(), 'packages', dir.name, manifest.dsh.bundle.patch), 'utf8')
      checks.add(
        `patch-namespaced:${label}`,
        patchText.includes('compat-'),
        'bundle patch must contain a compat- prefixed row',
      )
    }
  }
})

/** Run `npm pack --dry-run --json` inside one package and return the first entry. */
function packJson(dirName) {
  // Windows cannot spawn `npm.cmd` directly (EINVAL) and shell:true with args is
  // deprecated (DEP0190), so we go through ComSpec with one command string.
  const [command, args] =
    process.platform === 'win32'
      ? [process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', 'npm pack --dry-run --json']]
      : ['npm', ['pack', '--dry-run', '--json']]
  const result = spawnSync(command, args, {
    cwd: join(repoRoot(), 'packages', dirName),
    encoding: 'utf8',
  })
  if (result.status !== 0 || !result.stdout) return null
  try {
    const parsed = JSON.parse(result.stdout)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null
  } catch {
    return null
  }
}

void Checks
