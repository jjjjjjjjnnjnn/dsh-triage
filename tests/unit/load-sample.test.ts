/**
 * "The tail is unexplained" can stop being unexplainable (R70, the other half of `BS-54`).
 *
 * WHY: R68 produced the distribution and rightly refused to attribute its tail — the artifacts recorded the
 * result but nothing about the conditions. The cases below are the ways a load reading could lie: reading
 * `os.loadavg()` on Windows (always 0), dividing by a zero-length window, or reporting 100% because the
 * arithmetic went negative.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { busyPercent, cpuTimes, describeConditions } from '../../scripts/lib/load-sample.mjs'

test('busy percent is the delta, not the absolute cumulative time', () => {
  // 1000ms of CPU time elapsed, 500 of it idle → half busy.
  assert.equal(busyPercent({ idle: 1000, total: 4000 }, { idle: 1500, total: 5000 }), 50)
  // A machine that was idle the whole window reads 0, not "unknown".
  assert.equal(busyPercent({ idle: 0, total: 0 }, { idle: 1000, total: 1000 }), 0)
  // Fully busy reads 100.
  assert.equal(busyPercent({ idle: 0, total: 100 }, { idle: 0, total: 1100 }), 100)
})

test('an unusable window is null, never a made-up number', () => {
  // Zero elapsed time (the run was too short to sample).
  assert.equal(busyPercent({ idle: 10, total: 10 }, { idle: 10, total: 10 }), null)
  // Counter went backwards (clock change / bad sample).
  assert.equal(busyPercent({ idle: 100, total: 500 }, { idle: 50, total: 400 }), null)
  // Idle delta larger than the total delta cannot be a percentage.
  assert.equal(busyPercent({ idle: 0, total: 0 }, { idle: 900, total: 500 }), null)
  // Missing fields.
  assert.equal(busyPercent({}, { idle: 1, total: 2 }), null)
  assert.equal(busyPercent(null as never, { idle: 1, total: 2 }), null)
})

test('cpuTimes returns monotonic cumulative counters on this machine', () => {
  const before = cpuTimes()
  const after = cpuTimes()
  assert.ok(before.total > 0)
  assert.ok(after.total >= before.total, 'cumulative total must not go backwards')
  assert.ok(after.idle >= before.idle)
})

test('conditions carry the limits, and say loadavg is useless on Windows', () => {
  const conditions = describeConditions({
    before: { idle: 0, total: 0 },
    after: { idle: 400, total: 1000 },
    startedAt: '2026-11-02T20:00:00.000Z',
    endedAt: '2026-11-02T20:01:00.000Z',
  })
  assert.equal(conditions.cpu.observed_busy_percent, 60)
  assert.ok(conditions.cpu.cores >= 1)
  assert.equal(conditions.cpu.loadavg_usable, process.platform !== 'win32')
  assert.equal(conditions.window.started_at, '2026-11-02T20:00:00.000Z')
  assert.ok(conditions.limits.some((line) => line.includes('CPU only')))
})
