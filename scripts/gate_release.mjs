#!/usr/bin/env node
/**
 * Gate: release readiness.
 *
 * Two levels on purpose:
 * - default: structural checks that must hold during development;
 * - `--publish`: additionally rejects placeholders (e.g. `REPLACE-ME` in the
 *   repository URL). Run this before `npm publish`.
 *
 * Negative control: `--mutate` breaks the version field of the first package.
 */

import { exists, listDir, readJson, readText, runGate } from './lib/kit.mjs'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

await runGate('release', async ({ checks, mutate, strict }) => {
  const publishStrict = strict || process.argv.includes('--publish')
  const dirs = listDir('packages').filter((entry) => entry.isDirectory)
  checks.require('packages-present', dirs.length >= 3, `${dirs.length} packages`)

  for (const dir of dirs) {
    const manifestPath = `packages/${dir.name}/package.json`
    if (!checks.require(`manifest:${dir.name}`, exists(manifestPath))) continue
    const manifest = readJson(manifestPath)
    const label = String(manifest.name ?? dir.name)
    const isPublic = manifest.private !== true

    checks.add(`name:${label}`, typeof manifest.name === 'string' && manifest.name.length > 0)
    const version = mutate && label === (readJson('packages/core/package.json').name) ? 'not-semver' : manifest.version
    checks.add(`version:${label}`, SEMVER.test(String(version)), String(version))
    checks.add(
      `description:${label}`,
      typeof manifest.description === 'string' && manifest.description.length >= 30,
      `${String(manifest.description ?? '').length} chars`,
    )
    checks.add(`license:${label}`, manifest.license === 'MIT', String(manifest.license))
    checks.add(`files:${label}`, Array.isArray(manifest.files) && manifest.files.includes('dist'), JSON.stringify(manifest.files ?? []))
    checks.add(`engines-node:${label}`, typeof manifest.engines?.node === 'string', String(manifest.engines?.node))
    checks.add(
      `repository:${label}`,
      typeof manifest.repository?.url === 'string' && /^(git\+https:\/\/|https:\/\/)/.test(manifest.repository.url),
      String(manifest.repository?.url ?? ''),
    )
    checks.add(`exports:${label}`, manifest.exports !== undefined && manifest.main !== undefined)

    if (isPublic) {
      // Dogfooding: anything that is a DSH profile layer must declare the DSH
      // range it supports. Plain libraries (core/signals/probe) are not bundles
      // and must not pretend to be.
      if (manifest.dsh?.bundle !== undefined) {
        checks.add(`engines-dsh:${label}`, typeof manifest.engines?.dsh === 'string', String(manifest.engines?.dsh))
      } else {
        checks.add(`not-a-bundle:${label}`, manifest.dsh === undefined, 'plain library must not declare dsh.bundle')
      }
      checks.add(`readme:${label}`, exists(`packages/${dir.name}/README.md`), 'packages/<name>/README.md')
    }

    const deps = { ...(manifest.dependencies ?? {}), ...(manifest.peerDependencies ?? {}), ...(manifest.optionalDependencies ?? {}) }
    const badWorkspace = Object.entries(deps)
      .filter(([, spec]) => String(spec).startsWith('workspace:'))
      .filter(([dep]) => !String(dep).startsWith('@dsh-triage/'))
    checks.add(`workspace-deps:${label}`, badWorkspace.length === 0, badWorkspace.map(([dep]) => dep).join(', ') || 'ok')

    if (publishStrict && isPublic) {
      checks.add(
        `no-placeholder:${label}`,
        !readText(manifestPath).includes('REPLACE-ME'),
        'replace REPLACE-ME in repository.url before publishing',
      )
    }
  }

  checks.require('license-file', readText('LICENSE').includes('MIT License'))
  checks.require('readme-root', readText('README.md').length > 500)
})
