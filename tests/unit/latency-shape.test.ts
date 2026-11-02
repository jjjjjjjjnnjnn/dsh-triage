/**
 * "One observation is not a distribution" (R68, closes `BS-54`).
 *
 * WHY THESE CASES: `BS-54` exists because a single 9510ms reading was treated as a fact about the
 * product. The cases below are the ways this report could repeat that: counting an unmeasured step as a
 * zero, letting a p90 be computed from three runs, or merging a negative control (which waits 300ms on
 * purpose) into the experience of a real user.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { judgeLatency, summarize } from '../../scripts/lib/latency-shape.mjs'

const sample = (ms: unknown, source = 'run.json', at: string | null = null) => ({ ms, at, source })

test('percentiles are observed values, not interpolations', () => {
  const summary = summarize([915, 919, 920, 921, 926])
  assert.equal(summary.n, 5)
  assert.equal(summary.min, 915)
  assert.equal(summary.median, 920)
  assert.equal(summary.max, 926)
  // nearest rank: ceil(0.9 × 5) = 5th value
  assert.equal(summary.p90, 926)
  assert.equal(summary.provisory, true, 'five points cannot carry a p90')
})

test('an even count takes the mean of the middle two, and ten points are not provisory', () => {
  const summary = summarize([1, 2, 3, 4])
  assert.equal(summary.median, 2.5)
  assert.equal(summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).provisory, false)
})

test('unmeasured is not zero: nulls and non-numbers are dropped, not counted', () => {
  const summary = summarize([900, null, undefined, Number.NaN, '1000', -5, 1000])
  assert.equal(summary.n, 2, 'only 900 and 1000 are observations')
  assert.equal(summary.min, 900)
  assert.equal(summary.max, 1000)
})

test('a single observation is refused as a distribution', () => {
  const verdict = judgeLatency({ series: [{ id: 'summary.tab_ms', kind: 'browser', group: 'measurement', values: [sample(9510)] }] })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((line) => line.includes('single observation is not a distribution')))
  // …and the number is still reported, so a reader can see what the one run said.
  assert.equal(verdict.series[0]?.max, 9510)
})

test('a series with no observation is "not measured", never "fast"', () => {
  const verdict = judgeLatency({ series: [{ id: 'upgrade.route_ms', kind: 'engine', group: 'measurement', values: [sample(null)] }] })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((line) => line.includes('not measured')))
  assert.equal(verdict.series[0]?.n, 0)
})

test('groups stay separate: a control run cannot drag the median of the real experience', () => {
  const verdict = judgeLatency({
    series: [
      { id: 'summary.tab_ms', kind: 'browser', group: 'measurement', values: [sample(920), sample(921), sample(919)] },
      { id: 'summary.tab_ms', kind: 'browser', group: 'negative-control', values: [sample(300), sample(512)] },
    ],
  })
  assert.equal(verdict.series.length, 2)
  const real = verdict.series.find((entry) => entry.group === 'measurement')
  const control = verdict.series.find((entry) => entry.group === 'negative-control')
  assert.equal(real?.median, 920)
  assert.equal(control?.median, 406)
  assert.notEqual(real?.median, control?.median)
})

test('the slow tail is carried verbatim, newest of the slow three first', () => {
  const verdict = judgeLatency({
    series: [
      {
        id: 'summary.tab_ms',
        kind: 'browser',
        group: 'measurement',
        values: [sample(920, 'a.json'), sample(5557, 'b.json'), sample(9510, 'c.json'), sample(941, 'd.json')],
      },
    ],
  })
  assert.deepEqual(verdict.series[0]?.slowest.map((entry) => entry.ms), [9510, 5557, 941])
  assert.equal(verdict.series[0]?.slowest[0]?.source, 'c.json')
})

test('no series at all is a vacuous report, not a fast one', () => {
  const verdict = judgeLatency({ series: [] })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((line) => line.includes('vacuous')))
})
