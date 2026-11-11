/**
 * An artifact that names the profile must not carry the operator's home path (R94).
 *
 * WHY THESE CASES: `record_rescue.mjs` published the CLI's `plan` verbatim, and a plan entry for a
 * package installed from a local tarball looked like
 * `file:C:/Users/<name>/Desktop/.../dsh-remedy-0.3.5.tgz`. The recorder had already replaced
 * `inputs.dsh_home` with a placeholder, so the artifact *looked* redacted — and
 * `gate_governance/results-privacy` caught it on the first measured run. M8's C8 says: profile name
 * only, never the user's absolute path.
 *
 * The negative controls are the important half: the scrub must not damage strings it does not own,
 * and it must not leave a home path behind just because it used the other separator.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { scrubAbsolutePaths } from '../../scripts/lib/scrub-paths.mjs'

test('a Windows home path inside a package spec is replaced, not merely hidden from one field', () => {
  const input = { plan: { removable: [{ name: 'x', spec: 'file:C:\\Users\\alice\\Desktop\\proj\\pkg.tgz' }] } }
  const out = scrubAbsolutePaths(input, 'C:\\Users\\alice')
  const text = JSON.stringify(out)
  assert.ok(!text.includes('alice'), `home leaked: ${text}`)
  assert.ok(text.includes('pkg.tgz'), 'the rest of the spec must survive')
})

test('a forward-slash spelling of the same home is caught too', () => {
  const out = JSON.stringify(scrubAbsolutePaths({ spec: 'file:C:/Users/alice/x.tgz' }, 'C:\\Users\\alice'))
  assert.ok(!out.includes('alice'), out)
})

test('NEGATIVE CONTROL: an unrelated path is untouched', () => {
  const input = { spec: 'file:./vendor/pkg.tgz', name: '@scope/pkg', version: '1.0.0' }
  assert.deepEqual(scrubAbsolutePaths(input, 'C:\\Users\\alice'), input)
})

test('NEGATIVE CONTROL: a package name that merely contains "Users" is not rewritten', () => {
  const input = { name: 'users-bundle', version: '2.1.0' }
  assert.deepEqual(scrubAbsolutePaths(input, 'C:\\Users\\alice'), input)
})

test('posix home shapes are caught without a home argument', () => {
  const out = JSON.stringify(scrubAbsolutePaths({ a: '/Users/bob/x', b: '/home/carol/y', c: '/root/z' }, ''))
  assert.ok(!/bob|carol/.test(out), out)
  assert.ok(out.includes('/root') === false || !out.includes('/root/z'), out)
})

test('non-string leaves pass through unchanged', () => {
  const input = { n: 1, ok: true, nil: null, list: [1, 'plain', false] }
  assert.deepEqual(scrubAbsolutePaths(input, 'C:\\Users\\alice'), input)
})
