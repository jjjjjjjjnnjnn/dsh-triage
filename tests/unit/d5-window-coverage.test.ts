/**
 * "When is the last day I can still measure each D5 window day?" (R76)
 *
 * WHY THIS IS TESTED THIS WAY: the claim it replaces was written in prose in three files
 * ("run again before 11-08, otherwise the first 7 days are permanently missing") and it was wrong twice
 * over — npm publishes its rolling window with a **2-day lag**, and consecutive runs ≤7 days apart close
 * the window without a hole. So the tests below are ordered by how expensive the mistake would be:
 *
 *   1. a day that can still be collected reported as `lost` → someone gives up on a day that was reachable;
 *   2. a day that is gone reported as `collect-now` → someone runs a command that cannot help;
 *   3. a recompute counted as coverage → the window looks covered while nobody ever measured it (R72's shape);
 *   4. the deadline computed off by one → the exact bug this round exists to remove.
 *
 * Every case is a hand-built fixture; nothing here reads the clock or the network.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_LAG_DAYS,
  ROLLING_WINDOW_DAYS,
  dayToNumber,
  judgeWindowCoverage,
  numberToDay,
} from '../../scripts/lib/d5-window-coverage.mjs'

const D5_WINDOW = { windowStart: '2026-11-01', windowEnd: '2026-11-15' }
const measured = (from: string, to: string, file = `market-baseline-${from}.json`) => ({
  file,
  kind: 'measured',
  from,
  to,
})

test('R76: the live 11-03 baseline covers 11-01 only, and the next run is due by 11-10', () => {
  // This is the real state on 2026-11-03: the only in-window baseline is 10-26..11-01.
  const result = judgeWindowCoverage({
    ...D5_WINDOW,
    today: '2026-11-03',
    baselines: [measured('2026-10-26', '2026-11-01')],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.covered, ['2026-11-01'])
  assert.equal(result.window?.days, 15)
  assert.equal(result.counts?.missing, 14)
  // 11-02 is not published yet on 11-03 (lag 2), so nothing is collectible *today*…
  assert.equal(result.verdict, 'not-yet')
  assert.equal(result.counts?.collectible_now, 0)
  // …but the soonest-expiring day (11-02) is last collectible on 11-10: that is the real deadline.
  assert.equal(result.next_run_by, '2026-11-10')
  assert.equal(result.days_until_next_run, 7)
  assert.equal(result.urgent, false)
})

test('R76: running on 11-07 (the literal "before 11-08" advice) leaves 11-06 to be rescued by 11-14', () => {
  const result = judgeWindowCoverage({
    ...D5_WINDOW,
    today: '2026-11-08',
    baselines: [
      measured('2026-10-26', '2026-11-01', 'market-baseline-2026-11-03T06-22-20.130Z.json'),
      // A run on 11-07 with the measured 2-day lag publishes 10-30..11-05.
      measured('2026-10-30', '2026-11-05', 'market-baseline-2026-11-07T06-00-00.000Z.json'),
    ],
  })
  assert.deepEqual(result.covered, [
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
  ])
  const sixth = result.missing?.find((entry) => entry.day === '2026-11-06')
  assert.equal(sixth?.state, 'collect-now')
  assert.equal(sixth?.first_collectible, '2026-11-08')
  assert.equal(sixth?.last_collectible, '2026-11-14')
  assert.equal(result.verdict, 'collect-now')
  assert.equal(result.next_run_by, '2026-11-14')
})

test('R76: "after 11-08 the first 7 days are gone forever" is false — a run on 11-10 closes the hole', () => {
  // The two runs that already exist on 11-10: 11-03 (…11-01) and a fresh one (11-02..11-08).
  const result = judgeWindowCoverage({
    ...D5_WINDOW,
    today: '2026-11-10',
    baselines: [
      measured('2026-10-26', '2026-11-01', 'market-baseline-2026-11-03T06-22-20.130Z.json'),
      measured('2026-11-02', '2026-11-08', 'market-baseline-2026-11-10T06-00-00.000Z.json'),
    ],
  })
  // The first seven window days are covered with no gap, on a day the old prose called too late.
  assert.deepEqual(result.covered, [
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-06',
    '2026-11-07',
    '2026-11-08',
  ])
  assert.equal(result.counts?.lost, 0)
  assert.equal(result.missing?.[0]?.day, '2026-11-09')
  assert.equal(result.next_run_by, '2026-11-17')
})

test('R76: a day whose rolling window has closed is `lost`, and that is the only hard failure', () => {
  const result = judgeWindowCoverage({
    ...D5_WINDOW,
    today: '2026-11-12',
    baselines: [measured('2026-10-26', '2026-11-01')],
  })
  const second = result.missing?.find((entry) => entry.day === '2026-11-02')
  // 11-02 was collectible on runs 11-04..11-10; on 11-12 it is unreachable.
  assert.equal(second?.last_collectible, '2026-11-10')
  assert.equal(second?.state, 'lost')
  assert.equal(result.verdict, 'lost')
  assert.equal(result.urgent, true)
  // Losing 11-02 must not hide what is still reachable: on a 11-12 run the newest published day is 11-10.
  assert.equal(result.missing?.find((entry) => entry.day === '2026-11-10')?.state, 'collect-now')
  assert.equal(result.missing?.find((entry) => entry.day === '2026-11-12')?.state, 'upcoming')
})

test('R76: a recompute never counts as coverage, and it says why', () => {
  const result = judgeWindowCoverage({
    ...D5_WINDOW,
    today: '2026-11-05',
    baselines: [
      { file: 'market-baseline-2026-11-01T07-10-00.000Z.json', kind: 'recompute', from: '2026-11-01', to: '2026-11-07' },
      { file: 'market-baseline-old.json', kind: 'unproven', from: '2026-11-01', to: '2026-11-07' },
    ],
  })
  assert.deepEqual(result.covered, [])
  assert.deepEqual(result.used, [])
  assert.deepEqual(
    result.ignored?.map((entry) => entry.reason),
    ['recompute-does-not-prove-collection', 'origin-unproven'],
  )
})

test('R76: a fully covered window is `complete` and asks for nothing', () => {
  const result = judgeWindowCoverage({
    ...D5_WINDOW,
    today: '2026-11-15',
    baselines: [
      measured('2026-10-26', '2026-11-01'),
      measured('2026-11-02', '2026-11-08'),
      measured('2026-11-09', '2026-11-15'),
    ],
  })
  assert.equal(result.verdict, 'complete')
  assert.equal(result.counts?.missing, 0)
  assert.equal(result.next_run_by, null)
  assert.equal(result.urgent, false)
  assert.equal(result.covered?.length, 15)
})

test('R76: `urgent` is decided by the deadline, not by how many days are missing', () => {
  const baseline = [measured('2026-10-26', '2026-11-01')]
  // next_run_by = 11-10. One day of slack → urgent; two → not.
  const slackTwo = judgeWindowCoverage({ ...D5_WINDOW, today: '2026-11-08', baselines: baseline })
  assert.equal(slackTwo.next_run_by, '2026-11-10')
  assert.equal(slackTwo.days_until_next_run, 2)
  assert.equal(slackTwo.urgent, false)
  const slackOne = judgeWindowCoverage({ ...D5_WINDOW, today: '2026-11-09', baselines: baseline })
  assert.equal(slackOne.days_until_next_run, 1)
  assert.equal(slackOne.urgent, true)
  const deadlineDay = judgeWindowCoverage({ ...D5_WINDOW, today: '2026-11-10', baselines: baseline })
  assert.equal(deadlineDay.days_until_next_run, 0)
  assert.equal(deadlineDay.urgent, true)
  // `urgentWithinDays` only widens the warning; it never changes the verdict or the deadline.
  const wider = judgeWindowCoverage({ ...D5_WINDOW, today: '2026-11-08', baselines: baseline, urgentWithinDays: 2 })
  assert.equal(wider.urgent, true)
  assert.equal(wider.next_run_by, '2026-11-10')
  assert.equal(wider.verdict, slackTwo.verdict)
})

test('R76: unreadable window bounds are refused instead of rolled (R66 shape)', () => {
  assert.equal(judgeWindowCoverage({ ...D5_WINDOW, today: '2026-11-03', windowStart: '2026-02-30' }).reason, 'window-start-unreadable')
  assert.equal(judgeWindowCoverage({ ...D5_WINDOW, today: '2026-11-03', windowEnd: '2026-11-31' }).reason, 'window-end-unreadable')
  assert.equal(
    judgeWindowCoverage({ windowStart: '2026-11-15', windowEnd: '2026-11-01', today: '2026-11-03' }).reason,
    'window-inverted',
  )
  assert.equal(judgeWindowCoverage({ ...D5_WINDOW, today: '2026-11-03', lagDays: 7 }).reason, 'lag-days-invalid')
  assert.equal(judgeWindowCoverage({ ...D5_WINDOW, today: '2026-11-03', lagDays: -1 }).reason, 'lag-days-invalid')
})

test('R76: the constants describe the registry, and day arithmetic is UTC and invertible', () => {
  assert.equal(ROLLING_WINDOW_DAYS, 7)
  assert.equal(DEFAULT_LAG_DAYS, 2)
  // A run on R publishes [R-8, R-2] — this is the arithmetic every case above depends on.
  assert.equal(numberToDay(dayToNumber('2026-11-03')! - 8), '2026-10-26')
  assert.equal(numberToDay(dayToNumber('2026-11-03')! - 2), '2026-11-01')
  // Day arithmetic must cross month and year boundaries (the window runs over 12-28..01-03 next time).
  assert.equal(numberToDay(dayToNumber('2026-12-31')! + 1), '2027-01-01')
  assert.equal(dayToNumber('2026-11-31'), null)
  assert.equal(dayToNumber('01.11.2026'), null)
})

test('R76: a live baseline outside the window is reported with zero contribution, not hidden', () => {
  // The pre-window baselines are read but prove nothing about the D5 window — "used 4" must not read as
  // "4 weeks covered".
  const result = judgeWindowCoverage({
    ...D5_WINDOW,
    today: '2026-11-03',
    baselines: [
      measured('2026-10-18', '2026-10-24', 'market-baseline-2026-10-25T06-00-00.000Z.json'),
      measured('2026-10-23', '2026-10-29', 'market-baseline-2026-10-31T06-40-00.000Z.json'),
      measured('2026-10-26', '2026-11-01', 'market-baseline-2026-11-03T06-22-20.130Z.json'),
    ],
  })
  assert.deepEqual(
    result.used?.map((entry) => entry.days_in_window),
    [0, 0, 1],
  )
  assert.equal(result.counts?.covered, 1)
})

test('R76: the same artifact set always yields the same answer (no clock, no ordering leak)', () => {
  const forward = judgeWindowCoverage({
    ...D5_WINDOW,
    today: '2026-11-06',
    baselines: [measured('2026-10-26', '2026-11-01'), measured('2026-10-28', '2026-11-03')],
  })
  const reversed = judgeWindowCoverage({
    ...D5_WINDOW,
    today: '2026-11-06',
    baselines: [measured('2026-10-28', '2026-11-03'), measured('2026-10-26', '2026-11-01')],
  })
  assert.deepEqual(forward.covered, reversed.covered)
  assert.deepEqual(forward.missing, reversed.missing)
  assert.equal(forward.next_run_by, reversed.next_run_by)
  assert.deepEqual(forward.covered, [
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
  ])
})
