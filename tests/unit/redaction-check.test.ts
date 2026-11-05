/**
 * The "is it safe to paste" checker, pinned both ways (R88 / X1-A).
 *
 * A redaction check that has only ever been run on redacted text proves nothing: it would pass on a
 * checker that always returns "clean". So every leak class has a positive case here, and every
 * allowed shape has a negative one.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findAbsolutePaths } from '../../scripts/lib/redaction-check.mjs'

test('X1-N1: every absolute-path shape is caught', () => {
  const positive: Array<[string, string]> = [
    ['C:\\Users\\alice\\profiles\\web', 'windows-drive'],
    ['D:\\projects\\dsh', 'windows-drive'],
    ['/home/alice/.dsh/profiles/web', 'posix-home'],
    ['/Users/alice/.dsh', 'posix-home'],
    ['/root/.dsh/credentials', 'posix-home'],
  ]
  for (const [text, label] of positive) {
    const found = findAbsolutePaths(text)
    assert.ok(found.leaks.includes(label), `${text} must be reported as ${label}`)
  }
})

test('X1-N1: the shapes the tool actually prints are NOT reported as leaks', () => {
  const negative: Array<[string, boolean]> = [
    ['分诊台 · dsh 0.1.0-rc.6 · profile web · win32/x64', false],
    ['profileDir  ~\\profiles\\web', true],
    ['~/.dsh/profiles/web', true],
    ['data/results/listing-2026-11-05T16-20-00.000Z.json', false],
    ['https://github.com/jjjjjjjjnnjnn/dsh-triage', false],
  ]
  for (const [text, homeRelative] of negative) {
    const found = findAbsolutePaths(text)
    assert.deepEqual(found.leaks, [], `${text} must not be a leak`)
    assert.equal(found.homeRelative, homeRelative, `${text} home-relative flag`)
  }
})

test('X1-N1: a home-relative path is flagged as "names your profile" but is not a leak', () => {
  const found = findAbsolutePaths('profileDir  ~\\profiles\\web')
  assert.deepEqual(found.leaks, [])
  assert.equal(found.homeRelative, true)
})
