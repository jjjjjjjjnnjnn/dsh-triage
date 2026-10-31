/**
 * The download-shape rule behind D5 (`docs/ROADMAP.md` §2, approved 2026-10-31).
 *
 * The risk this file exists to kill: D5 says "weekly downloads >= 20", the API answered `634`, and every
 * one of those 634 landed on a single day between two silent days. Reading that as demand would have
 * declared the product's existence gate passed on the strength of a crawler.
 *
 * So the tests pin:
 *
 *   - the real 2026-10-22..10-30 series is a **burst**, not demand (negative control against the tempting read);
 *   - a burst of any size is not demand, including one that clears the threshold;
 *   - "we could not read a series" is `unmeasurable`, never "no demand";
 *   - the boundary is explicit: exactly 80% of the window is still steady, 81% is not;
 *   - the result does not depend on the order the API returned the days in.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BURST_PEAK_SHARE,
  D5_MINIMUM_WEEK_DOWNLOADS,
  classifyDownloadShape,
  judgeWeeklyDemand,
} from '../../scripts/lib/download-shape.mjs'

/** The real series the npm downloads API returned for `dsh-triage` (queried 2026-10-31). */
const REAL_TRIAGE_SERIES = [
  { day: '2026-10-22', downloads: 0 },
  { day: '2026-10-23', downloads: 0 },
  { day: '2026-10-24', downloads: 0 },
  { day: '2026-10-25', downloads: 0 },
  { day: '2026-10-26', downloads: 0 },
  { day: '2026-10-27', downloads: 0 },
  { day: '2026-10-28', downloads: 0 },
  { day: '2026-10-29', downloads: 634 },
  { day: '2026-10-30', downloads: 0 },
]

test('the real 634-downloads series is a burst, and a burst is not demand', () => {
  const shape = classifyDownloadShape(REAL_TRIAGE_SERIES)
  assert.equal(shape.shape, 'single-day-burst')
  assert.equal(shape.total, 634)
  assert.equal(shape.days_with_downloads, 1)
  assert.equal(shape.peak_day, '2026-10-29')
  assert.equal(shape.peak_share, 1)

  const judgement = judgeWeeklyDemand(shape)
  assert.equal(judgement.verdict, 'burst-not-demand')
  assert.equal(judgement.counts_as_demand, false, '634 weekly downloads must NOT satisfy D5')

  // The tempting misread, stated as an assertion: raw total alone would have passed the threshold.
  assert.ok(shape.total !== null && shape.total >= D5_MINIMUM_WEEK_DOWNLOADS)
})

test('a smaller burst is still not demand', () => {
  const shape = classifyDownloadShape([
    { day: '2026-10-01', downloads: 0 },
    { day: '2026-10-02', downloads: 25 },
    { day: '2026-10-03', downloads: 0 },
  ])
  assert.equal(shape.shape, 'single-day-burst')
  assert.equal(judgeWeeklyDemand(shape).counts_as_demand, false)
})

test('a steady window above the threshold counts, a steady one below does not', () => {
  const above = classifyDownloadShape(
    ['01', '02', '03', '04', '05', '06', '07'].map((day) => ({ day: `2026-10-${day}`, downloads: 4 })),
  )
  assert.equal(above.shape, 'steady')
  assert.equal(above.total, 28)
  assert.equal(judgeWeeklyDemand(above).verdict, 'threshold-met')
  assert.equal(judgeWeeklyDemand(above).counts_as_demand, true)

  const below = classifyDownloadShape(
    ['01', '02', '03', '04', '05', '06', '07'].map((day) => ({ day: `2026-10-${day}`, downloads: 2 })),
  )
  assert.equal(below.shape, 'steady')
  assert.equal(judgeWeeklyDemand(below).verdict, 'below-threshold')
  assert.equal(judgeWeeklyDemand(below).counts_as_demand, false)

  // The threshold is a parameter, not a constant baked into the classifier.
  assert.equal(judgeWeeklyDemand(below, { minimum: 10 }).verdict, 'threshold-met')
})

test('the peak-share boundary is explicit: exactly 80% is steady, 81% is a burst', () => {
  assert.equal(BURST_PEAK_SHARE, 0.8)
  const atBoundary = classifyDownloadShape([
    { day: '2026-10-01', downloads: 80 },
    { day: '2026-10-02', downloads: 20 },
  ])
  assert.equal(atBoundary.peak_share, 0.8)
  assert.equal(atBoundary.shape, 'steady')

  const overBoundary = classifyDownloadShape([
    { day: '2026-10-01', downloads: 81 },
    { day: '2026-10-02', downloads: 19 },
  ])
  assert.equal(overBoundary.peak_share, 0.81)
  assert.equal(overBoundary.shape, 'single-day-burst')
})

test('an all-zero window is no-downloads, which is not the same claim as a 404', () => {
  const shape = classifyDownloadShape([
    { day: '2026-10-01', downloads: 0 },
    { day: '2026-10-02', downloads: 0 },
  ])
  assert.equal(shape.shape, 'no-downloads')
  assert.equal(shape.total, 0)
  assert.equal(shape.peak_day, null)
  assert.equal(judgeWeeklyDemand(shape).verdict, 'no-demand-observed')

  // `no-record` is the recorder's mapping of a 404 and is judged the same way, but keeps its own name.
  const noRecord = judgeWeeklyDemand({ shape: 'no-record', total: null })
  assert.equal(noRecord.verdict, 'no-demand-observed')
  assert.match(noRecord.detail, /不等于 0/)
})

test('a series we could not read is unmeasurable, never "no demand"', () => {
  for (const bad of [null, undefined, [], [{ day: '2026-10-01' }], [{ day: '', downloads: 1 }], [{ day: '2026-10-01', downloads: -1 }], [{ day: '2026-10-01', downloads: Number.NaN }], ['nope']]) {
    const shape = classifyDownloadShape(bad as never)
    assert.equal(shape.shape, 'unreadable', `input ${JSON.stringify(bad)} must be unreadable`)
    const judgement = judgeWeeklyDemand(shape)
    assert.equal(judgement.verdict, 'unmeasurable')
    assert.equal(judgement.counts_as_demand, false)
    assert.match(judgement.detail, /没测到/)
  }

  // An unknown shape name from a future version must not be silently treated as demand either.
  assert.equal(judgeWeeklyDemand({ shape: 'spiky', total: 100 }).verdict, 'unmeasurable')
})

test('the classification does not depend on the order the API returned the days in', () => {
  const forwards = classifyDownloadShape(REAL_TRIAGE_SERIES)
  const backwards = classifyDownloadShape([...REAL_TRIAGE_SERIES].reverse())
  assert.deepEqual(backwards, forwards)
})
