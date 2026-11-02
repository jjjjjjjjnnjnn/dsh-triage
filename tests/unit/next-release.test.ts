/**
 * "Did upstream publish a new rc?" (R64).
 *
 * WHY THESE CASES: the only way this watcher can hurt us is by being confidently wrong in the calm
 * direction. So the cases are ordered by that risk: an unreadable registry must NOT read as "unchanged",
 * a first observation must not read as "changed", and a rollback must not read as "unchanged".
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NEXT_RELEASE_STATES, judgeNextChange } from '../../scripts/lib/next-release.mjs'

test('a readable registry with no history is a baseline, not a discovery', () => {
  const verdict = judgeNextChange({ previous: null, current: { ok: true, version: '0.2.1-rc.5' } })
  assert.equal(verdict.state, 'baseline')
  assert.equal(verdict.changed, false)
  assert.equal(verdict.writesArtifact, true)
  assert.equal(verdict.from, null)
  assert.equal(verdict.to, '0.2.1-rc.5')
})

test('the same value twice is unchanged, and nothing is written', () => {
  const verdict = judgeNextChange({
    previous: { version: '0.2.1-rc.5', at: '2026-11-02T09:00:00.000Z' },
    current: { ok: true, version: '0.2.1-rc.5' },
  })
  assert.equal(verdict.state, 'unchanged')
  assert.equal(verdict.changed, false)
  assert.equal(verdict.writesArtifact, false)
  assert.ok(verdict.detail.includes('2026-11-02T09:00:00.000Z'))
})

test('a new rc is changed, and both values are reported verbatim', () => {
  const verdict = judgeNextChange({
    previous: { version: '0.2.1-rc.5', at: '2026-11-02T09:00:00.000Z' },
    current: { ok: true, version: '0.2.1-rc.6' },
  })
  assert.equal(verdict.state, 'changed')
  assert.equal(verdict.changed, true)
  assert.equal(verdict.from, '0.2.1-rc.5')
  assert.equal(verdict.to, '0.2.1-rc.6')
})

test('a rollback is changed too — it changes what the card would say', () => {
  const verdict = judgeNextChange({
    previous: { version: '0.2.1-rc.6', at: '2026-11-03T09:00:00.000Z' },
    current: { ok: true, version: '0.2.1-rc.5' },
  })
  assert.equal(verdict.state, 'changed')
  assert.equal(verdict.changed, true)
  assert.ok(verdict.detail.includes('rollback'))
})

test('an unreadable registry is unmeasured — never "no update", never an artifact', () => {
  for (const current of [
    { ok: false, version: null, detail: 'HTTP 403' },
    { ok: false, version: null, detail: 'network error (ENOTFOUND)' },
    { ok: true, version: null, detail: 'no "next" tag' },
    { ok: true, version: '' },
  ]) {
    const verdict = judgeNextChange({ previous: { version: '0.2.1-rc.5', at: '2026-11-02T09:00:00.000Z' }, current })
    assert.equal(verdict.state, 'unmeasured')
    assert.equal(verdict.changed, false)
    assert.equal(verdict.writesArtifact, false)
    assert.ok(verdict.detail.includes('not "no update"'))
  }
})

test('the state list is what the script switches on', () => {
  assert.deepEqual(NEXT_RELEASE_STATES, ['baseline', 'changed', 'unchanged', 'unmeasured'])
  const seen = new Set(
    [
      judgeNextChange({ previous: null, current: { ok: true, version: 'a' } }),
      judgeNextChange({ previous: { version: 'a', at: null }, current: { ok: true, version: 'b' } }),
      judgeNextChange({ previous: { version: 'a', at: null }, current: { ok: true, version: 'a' } }),
      judgeNextChange({ previous: { version: 'a', at: null }, current: { ok: false } }),
    ].map((verdict) => verdict.state),
  )
  assert.deepEqual([...seen].sort(), [...NEXT_RELEASE_STATES].sort())
})
