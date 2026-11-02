/**
 * "Which baseline file may the download number come from?" (R72, closes T-841)
 *
 * WHY: the recorder used to take the newest `market-baseline-*.json` **by file name**, and a recompute
 * artifact has the same prefix with a later stamp than the measurement it re-derives. So the default could
 * read a recompute of an older window and look perfectly ordinary. R52's two artifacts carry identical
 * numbers, which is exactly why the trap hid until someone looked.
 *
 * The cases below are ordered by how bad it would be to get them wrong: a recompute beating a live
 * measurement is the bug; refusing to read anything at all is the second way to be useless.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BASELINE_KINDS, pickBaselineArtifact } from '../../scripts/lib/d5-baseline.mjs'

const measured = (file: string, at: string) => ({
  file,
  produced_by: 'scripts/record_market_baseline.mjs',
  generated_at: at,
  offline: false,
})
const recompute = (file: string, at: string) => ({
  file,
  produced_by: 'scripts/record_market_baseline.mjs',
  generated_at: at,
  offline: true,
})

test('T-841: a newer recompute must not beat an older live measurement', () => {
  const picked = pickBaselineArtifact([
    measured('market-baseline-2026-10-31T06-40-00.000Z.json', '2026-10-31T06:40:00.000Z'),
    recompute('market-baseline-2026-10-31T07-10-00.000Z.json', '2026-10-31T07:10:00.000Z'),
  ])
  assert.equal(picked?.kind, 'measured')
  assert.equal(picked?.file, 'market-baseline-2026-10-31T06-40-00.000Z.json')
})

test('the newest measurement wins among measurements', () => {
  const picked = pickBaselineArtifact([
    measured('market-baseline-2026-10-20T06-00-00.000Z.json', '2026-10-20T06:00:00.000Z'),
    measured('market-baseline-2026-10-31T06-40-00.000Z.json', '2026-10-31T06:40:00.000Z'),
    recompute('market-baseline-2026-11-01T09-00-00.000Z.json', '2026-11-01T09:00:00.000Z'),
  ])
  assert.equal(picked?.file, 'market-baseline-2026-10-31T06-40-00.000Z.json')
})

test('only recomputes: read the newest one, but say what it is', () => {
  // The honest failure mode is "this number came from a recompute", not "I refused to look".
  const picked = pickBaselineArtifact([
    recompute('market-baseline-2026-10-31T07-10-00.000Z.json', '2026-10-31T07:10:00.000Z'),
    recompute('market-baseline-2026-10-31T07-00-00.000Z.json', '2026-10-31T07:00:00.000Z'),
  ])
  assert.equal(picked?.kind, 'recompute')
  assert.equal(picked?.file, 'market-baseline-2026-10-31T07-10-00.000Z.json')
})

test('an artifact that proves neither origin is never preferred over a proven one', () => {
  const picked = pickBaselineArtifact([
    { file: 'market-baseline-2026-11-01T00-00-00.000Z.json', produced_by: 'scripts/record_market_baseline.mjs', generated_at: '2026-11-01T00:00:00.000Z' },
    recompute('market-baseline-2026-10-31T07-10-00.000Z.json', '2026-10-31T07:10:00.000Z'),
  ])
  assert.equal(picked?.kind, 'recompute')
  assert.equal(picked?.file, 'market-baseline-2026-10-31T07-10-00.000Z.json')
})

test('another script\'s artifact is not a baseline, whatever its name', () => {
  const picked = pickBaselineArtifact([
    { file: 'market-baseline-2026-11-01T00-00-00.000Z.json', produced_by: 'scripts/something_else.mjs', generated_at: '2026-11-01T00:00:00.000Z', offline: false },
  ])
  assert.equal(picked, null)
})

test('nothing to read is null, and so is a non-array', () => {
  assert.equal(pickBaselineArtifact([]), null)
  assert.equal(pickBaselineArtifact(null), null)
  assert.equal(pickBaselineArtifact(undefined), null)
})

test('an unreadable timestamp does not make a baseline vanish', () => {
  const picked = pickBaselineArtifact([
    measured('market-baseline-2026-10-31T06-40-00.000Z.json', 'not a date'),
  ])
  assert.equal(picked?.file, 'market-baseline-2026-10-31T06-40-00.000Z.json')
  assert.equal(picked?.at, 'not a date')
})

test('the kind names are the three the artifact may print, and nothing else', () => {
  assert.deepEqual([...BASELINE_KINDS].sort(), ['measured', 'recompute', 'unproven'])
})
