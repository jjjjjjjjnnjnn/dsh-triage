/**
 * "Did upstream publish a new rc?" (R64).
 *
 * WHY THESE CASES: the only way this watcher can hurt us is by being confidently wrong in the calm
 * direction. So the cases are ordered by that risk: an unreadable registry must NOT read as "unchanged",
 * a first observation must not read as "changed", and a rollback must not read as "unchanged".
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NEXT_RELEASE_STATES, judgeNextChange, pickNewestObservation } from '../../scripts/lib/next-release.mjs'

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

test('a trailing space is not a new release (R65 adversary)', () => {
  // Before R66 this reported `changed` and wrote an artifact, printing `upgrade --to " "` as the next step.
  for (const version of ['0.2.1-rc.5 ', ' 0.2.1-rc.5', '\t0.2.1-rc.5\n']) {
    const verdict = judgeNextChange({ previous: { version: '0.2.1-rc.5', at: null }, current: { ok: true, version } })
    assert.equal(verdict.state, 'unchanged', `${JSON.stringify(version)} must read as unchanged`)
    assert.equal(verdict.writesArtifact, false)
  }
})

test('a whitespace-only version is unreadable, not a change', () => {
  for (const version of [' ', '\n', '\u0000']) {
    const verdict = judgeNextChange({ previous: { version: '0.2.1-rc.5', at: null }, current: { ok: true, version } })
    assert.equal(verdict.state, 'unmeasured')
    assert.equal(verdict.writesArtifact, false)
  }
})

test('a previous observation with no usable version is unmeasured, not "first observation"', () => {
  // Reporting `baseline` here would let a corrupted artifact pass as a clean start.
  for (const version of ['', '   ']) {
    const verdict = judgeNextChange({ previous: { version, at: '2026-11-02T09:00:00.000Z' }, current: { ok: true, version: '0.2.1-rc.6' } })
    assert.equal(verdict.state, 'unmeasured')
    assert.equal(verdict.writesArtifact, false)
  }
})

/*
 * R71: which observation is "the previous one"?
 *
 * This became a function because the watcher only looked in its own `--out` directory. In CI `--out` is
 * `$RUNNER_TEMP`, so `previous` was always null and the verdict was always `baseline` — a scheduled
 * watcher that can never say `changed`. These cases pin the selection rule itself.
 */

test('the newest parseable observation wins, whatever order the files came back in', () => {
  const older = { version: '0.2.1-rc.4', at: '2026-10-29T09:00:00.000Z' }
  const newer = { version: '0.2.1-rc.5', at: '2026-11-02T17:40:00.322Z' }
  for (const candidates of [
    [older, newer],
    [newer, older],
  ]) {
    assert.deepEqual(pickNewestObservation(candidates), { version: '0.2.1-rc.5', at: '2026-11-02T17:40:00.322Z' })
  }
})

test('an unparseable timestamp is ignored, not treated as newest or oldest', () => {
  const picked = pickNewestObservation([
    { version: '0.2.1-rc.4', at: 'not a date' },
    { version: '0.2.1-rc.5', at: '2026-11-02T17:40:00.322Z' },
  ])
  assert.deepEqual(picked, { version: '0.2.1-rc.5', at: '2026-11-02T17:40:00.322Z' })
  // Only junk on disk: we did not read a baseline, so nothing may be reported as one.
  assert.equal(pickNewestObservation([{ version: '0.2.1-rc.5', at: 'soon' }]), null)
})

test('an observation without a usable version is not a baseline', () => {
  assert.equal(pickNewestObservation([{ at: '2026-11-02T17:40:00.322Z' }]), null)
  assert.equal(pickNewestObservation([{ version: '   ', at: '2026-11-02T17:40:00.322Z' }]), null)
})

test('nothing to read is null, and so is a non-array', () => {
  assert.equal(pickNewestObservation([]), null)
  assert.equal(pickNewestObservation(null), null)
  assert.equal(pickNewestObservation(undefined), null)
})

test('a timestamp tie keeps the first entry, so the same disk state always picks the same baseline', () => {
  const at = '2026-11-02T17:40:00.322Z'
  const picked = pickNewestObservation([
    { version: '0.2.1-rc.5', at },
    { version: '0.2.1-rc.6', at },
  ])
  assert.deepEqual(picked, { version: '0.2.1-rc.5', at })
})
