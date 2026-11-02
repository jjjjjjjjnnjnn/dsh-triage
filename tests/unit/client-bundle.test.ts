/**
 * "The published package still carries a usable browser half" (R62 / T-829).
 *
 * WHY THESE CASES: each one is a packaging mistake that ships green today. The negative cases matter
 * more than the positive one — a checker that can only say "yes" would be the fourth repeat of the
 * mistake this repo keeps paying for (a check that never ran reading as a pass).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REQUIRED_LOADER, REQUIRED_SLOT, judgeClientBundle, resolveClientEntry } from '../../scripts/lib/client-bundle.mjs'

const MANIFEST = {
  name: 'dsh-triage',
  version: '0.3.2',
  dsh: { client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-settings'] } },
  exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' }, './client': './client.js' },
}

const SOURCE = `window.__ModuleLoader__.load({ id: 'dsh-triage', apply() { slots.inject('${REQUIRED_SLOT}', () => {}) } })`

test('a healthy bundle resolves, carries the loader and names the settings slot', () => {
  const verdict = judgeClientBundle({ manifest: MANIFEST, file: { exists: true, source: SOURCE } })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.entry, './client.js')
  assert.equal(verdict.bytes, SOURCE.length)
  assert.deepEqual(verdict.facts, { declared: true, platform: 'web', present: true, loader: true, slot: true })
})

test('a package without a dsh.client declaration is not installable as a browser half', () => {
  const verdict = judgeClientBundle({ manifest: { ...MANIFEST, dsh: {} }, file: { exists: true, source: SOURCE } })
  assert.equal(verdict.ok, false)
  assert.match(verdict.detail, /no dsh\.client declaration/)
})

test('the client platform must be web, not merely present', () => {
  const verdict = judgeClientBundle({
    manifest: { ...MANIFEST, dsh: { client: { platform: 'node' } } },
    file: { exists: true, source: SOURCE },
  })
  assert.equal(verdict.ok, false)
  assert.match(verdict.detail, /not "web"/)
})

test('an exports entry pointing at a file that is not in the tarball is red', () => {
  // The `files:` field dropping client.js is the shape that ships green today.
  const verdict = judgeClientBundle({ manifest: MANIFEST, file: { exists: false } })
  assert.equal(verdict.ok, false)
  assert.match(verdict.detail, /not in the installed package/)
})

test('a file that lost the client-runner contract is red', () => {
  const verdict = judgeClientBundle({ manifest: MANIFEST, file: { exists: true, source: "export const x = 1" } })
  assert.equal(verdict.ok, false)
  assert.match(verdict.detail, /does not carry __ModuleLoader__\.load/)
})

test('a bundle that never names settings.plugins.tab is red (it would register nowhere)', () => {
  const verdict = judgeClientBundle({
    manifest: MANIFEST,
    file: { exists: true, source: '__ModuleLoader__.load({ id: "x", apply() {} })' },
  })
  assert.equal(verdict.ok, false)
  assert.match(verdict.detail, /never names settings\.plugins\.tab/)
})

test('the exports field may be an object with a default, which is how bundlers write it', () => {
  const manifest = { ...MANIFEST, exports: { './client': { types: './client.d.ts', default: './client.js' } } }
  assert.equal(resolveClientEntry(manifest), './client.js')
  assert.equal(judgeClientBundle({ manifest, file: { exists: true, source: SOURCE } }).ok, true)
})

test('no exports field at all is a red, not a crash', () => {
  const verdict = judgeClientBundle({ manifest: { ...MANIFEST, exports: undefined }, file: { exists: true, source: SOURCE } })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.entry, null)
  assert.match(verdict.detail, /names no file/)
})

test('a null manifest or missing file is a red with a readable reason', () => {
  assert.equal(judgeClientBundle({ manifest: null, file: null }).ok, false)
  assert.equal(judgeClientBundle({ manifest: MANIFEST, file: null }).ok, false)
  assert.match(judgeClientBundle({ manifest: MANIFEST, file: null }).detail, /not in the installed package/)
})

test('the required strings are the contract, so they are exported rather than inline', () => {
  assert.equal(REQUIRED_LOADER, '__ModuleLoader__.load')
  assert.equal(REQUIRED_SLOT, 'settings.plugins.tab')
})
