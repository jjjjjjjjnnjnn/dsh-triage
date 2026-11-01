/**
 * Which version does the post-publish check prove? (R53)
 *
 * The regression this pins down: `record_publish` used to default `--version` to
 * `0.1.0`. On 2026-11-01 the release published three packages at `0.3.1` and left
 * `@dsh-triage/core` behind; anyone who then ran the check without a flag would have
 * been told about a release from six versions ago while `latest` was uninstallable.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { resolvePublishVersion } from '../../scripts/lib/publish-target.mjs'

const manifest = JSON.parse(readFileSync('packages/plugin/package.json', 'utf8')) as { version: string }

test('an explicit exact version is used verbatim', () => {
  const resolved = resolvePublishVersion({ requested: '0.3.1', manifestVersion: '9.9.9' })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.ok && resolved.version, '0.3.1')
  assert.equal(resolved.ok && resolved.source, 'argument')
})

test('a prerelease is an exact version and survives unchanged', () => {
  const resolved = resolvePublishVersion({ requested: '0.2.1-rc.5', manifestVersion: manifest.version })
  assert.equal(resolved.ok && resolved.version, '0.2.1-rc.5')
})

test('no flag means the manifest users install, never a hardcoded default', () => {
  const resolved = resolvePublishVersion({ requested: null, manifestVersion: manifest.version })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.ok && resolved.version, manifest.version)
  assert.equal(resolved.ok && resolved.source, 'manifest')
  // the actual regression: the old default was `0.1.0`
  assert.notEqual(resolved.ok && resolved.version, '0.1.0')
})

test('anything that is not an exact semver is refused rather than normalised', () => {
  for (const value of ['v0.3.1', '^0.3.1', '~0.3.1', '0.3', 'latest', 'next', '0.3.1 || 0.4.0', '  ', '']) {
    const resolved = resolvePublishVersion({ requested: value, manifestVersion: manifest.version })
    if (value.trim() === '') {
      assert.equal(resolved.ok, true, `empty "${value}" falls back to the manifest`)
      continue
    }
    assert.equal(resolved.ok, false, `"${value}" must be refused`)
    assert.match(resolved.ok === false ? resolved.error : '', /exact semver/)
  }
})

test('a manifest without an exact version is an error, not a guess', () => {
  for (const version of [undefined, null, '', 'workspace:*', 'v0.3.1', 42]) {
    const resolved = resolvePublishVersion({ requested: null, manifestVersion: version })
    assert.equal(resolved.ok, false, `manifest version ${String(version)} must not resolve`)
  }
})
