/**
 * Publish order versus semver order (M9 / T-861).
 *
 * Every test here is one of the spec's negative controls or one of the four verdicts, because this
 * judgement exists to stop a specific lie: "higher semver" being read as "newer code". The two
 * directions that matter are opposite — a renumbered old line must be a trap, and a normal patch
 * must never be one — so a one-sided test suite would be worthless.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { judgeUpdateOrder, type RegistryFacts } from '../../packages/core/dist/index.js'

function facts(options: {
  readonly versions: readonly string[]
  readonly publishedAt: Record<string, string>
  readonly latest?: string | null
  readonly next?: string | null
}): RegistryFacts {
  return {
    latest: options.latest === undefined ? null : options.latest,
    next: options.next ?? null,
    versions: options.versions,
    publishedAt: options.publishedAt,
  }
}

test('N1: a same-line patch published later is not a trap', () => {
  const order = judgeUpdateOrder(
    facts({
      versions: ['0.2.5', '0.2.6'],
      publishedAt: { '0.2.5': '2026-11-03T11:45:32.384Z', '0.2.6': '2026-11-04T23:20:44.548Z' },
      latest: '0.2.6',
    }),
    '0.2.5',
  )
  assert.equal(order.verdict, 'no-trap')
  assert.equal(order.candidate?.version, '0.2.6')
  assert.ok((order.candidate?.daysOlder ?? 0) < 0, 'the candidate is newer, so the gap is negative')
})

test('N2: a renumbered old line published earlier is a trap', () => {
  const order = judgeUpdateOrder(
    facts({
      versions: ['0.2.6', '0.12.3'],
      publishedAt: { '0.2.6': '2026-11-04T23:20:44.548Z', '0.12.3': '2026-10-18T16:25:28.000Z' },
      latest: '0.2.6',
    }),
    '0.2.6',
  )
  assert.equal(order.verdict, 'trap')
  assert.equal(order.candidate?.version, '0.12.3')
  assert.ok((order.candidate?.daysOlder ?? 0) > 17, `expected > 17 days older, got ${String(order.candidate?.daysOlder)}`)
  assert.match(order.detail, /published .* before the installed 0\.2\.6/u)
})

test('N3: a higher semver published later is not a trap (opposite direction to N2)', () => {
  const order = judgeUpdateOrder(
    facts({
      versions: ['0.2.1-rc.5', '0.2.2-rc.1'],
      publishedAt: { '0.2.1-rc.5': '2026-10-30T08:00:00.000Z', '0.2.2-rc.1': '2026-11-05T07:00:00.000Z' },
      latest: '0.2.1-rc.5',
      next: '0.2.2-rc.1',
    }),
    '0.2.1-rc.5',
  )
  assert.equal(order.verdict, 'no-trap')
  assert.equal(order.candidate?.version, '0.2.2-rc.1')
  assert.equal(order.latestLags, true, 'latest is behind next — a channel fact, reported separately')
})

test('N4: nothing above the installed version is `no-candidate`, not "up to date"', () => {
  const order = judgeUpdateOrder(
    facts({ versions: ['0.2.6'], publishedAt: { '0.2.6': '2026-11-04T23:20:44.548Z' }, latest: '0.2.6' }),
    '0.2.6',
  )
  assert.equal(order.verdict, 'no-candidate')
  assert.equal(order.candidate, null)
  assert.match(order.detail, /no published version has a higher semver/u)
})

test('N5: a missing publish time for the candidate is `unmeasured`, never a guess', () => {
  const order = judgeUpdateOrder(
    facts({ versions: ['0.2.6', '0.12.3'], publishedAt: { '0.2.6': '2026-11-04T23:20:44.548Z' }, latest: '0.2.6' }),
    '0.2.6',
  )
  assert.equal(order.verdict, 'unmeasured')
  assert.equal(order.candidate, null)
  assert.match(order.detail, /no publish time for 0\.12\.3/u)
})

test('N5b: a missing publish time for the installed version is also `unmeasured`', () => {
  const order = judgeUpdateOrder(
    facts({ versions: ['0.2.6'], publishedAt: {}, latest: '0.2.6' }),
    '0.2.6',
  )
  assert.equal(order.verdict, 'unmeasured')
  assert.match(order.detail, /installed version/u)
})

test('an unparsable publish time is `unmeasured`, not day zero', () => {
  const order = judgeUpdateOrder(
    facts({
      versions: ['0.2.5', '0.2.6'],
      publishedAt: { '0.2.5': 'last tuesday', '0.2.6': '2026-11-04T23:20:44.548Z' },
      latest: '0.2.6',
    }),
    '0.2.5',
  )
  assert.equal(order.verdict, 'unmeasured')
})

test('the candidate is the highest semver above installed, not the newest published overall', () => {
  const order = judgeUpdateOrder(
    facts({
      versions: ['0.2.6', '0.2.7', '0.12.3'],
      publishedAt: {
        '0.2.6': '2026-11-04T00:00:00.000Z',
        '0.2.7': '2026-11-04T12:00:00.000Z',
        '0.12.3': '2026-10-18T00:00:00.000Z',
      },
      latest: '0.2.7',
    }),
    '0.2.6',
  )
  assert.equal(order.candidate?.version, '0.12.3', 'the manager offers the highest semver, which is the old line')
  assert.equal(order.verdict, 'trap')
})

test('unparsable published versions are ignored instead of crashing the comparison', () => {
  const order = judgeUpdateOrder(
    facts({
      versions: ['0.2.5', 'nightly', '0.2.6'],
      publishedAt: { '0.2.5': '2026-11-03T00:00:00.000Z', '0.2.6': '2026-11-04T00:00:00.000Z' },
      latest: '0.2.6',
    }),
    '0.2.5',
  )
  assert.equal(order.verdict, 'no-trap')
  assert.equal(order.candidate?.version, '0.2.6')
})

test('latest-lags is true only when the tag is below the highest published version', () => {
  const behind = judgeUpdateOrder(
    facts({ versions: ['0.1.6-alpha.2', '0.2.2-rc.1'], publishedAt: { '0.1.6-alpha.2': '2026-06-01T00:00:00.000Z', '0.2.2-rc.1': '2026-11-05T00:00:00.000Z' }, latest: '0.1.6-alpha.2' }),
    '0.1.6-alpha.2',
  )
  assert.equal(behind.latestLags, true)
  assert.equal(behind.verdict, 'no-trap')

  const current = judgeUpdateOrder(
    facts({ versions: ['0.2.6'], publishedAt: { '0.2.6': '2026-11-04T00:00:00.000Z' }, latest: '0.2.6' }),
    '0.2.6',
  )
  assert.equal(current.latestLags, false)
})

test('a prerelease candidate is named as one, so the advice is not read as a stable upgrade', () => {
  const order = judgeUpdateOrder(
    facts({
      versions: ['0.2.6', '0.3.0-rc.1'],
      publishedAt: { '0.2.6': '2026-11-04T00:00:00.000Z', '0.3.0-rc.1': '2026-10-01T00:00:00.000Z' },
      latest: '0.2.6',
    }),
    '0.2.6',
  )
  assert.equal(order.verdict, 'trap')
  assert.match(order.detail, /\(prerelease\)/u)
})

test('the judgement is a pure function: same facts, same bytes (C4)', () => {
  const publishedAt = { '0.2.6': '2026-11-04T23:20:44.548Z', '0.12.3': '2026-10-18T16:25:28.000Z' } as const
  const input = facts({ versions: ['0.2.6', '0.12.3'], publishedAt, latest: '0.2.6' })
  const first = judgeUpdateOrder(input, '0.2.6')
  assert.equal(JSON.stringify(first), JSON.stringify(judgeUpdateOrder(input, '0.2.6')))
  // Every instant in the answer must be one the caller supplied: the function may not invent a clock.
  const instants = JSON.stringify(first).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g) ?? []
  assert.ok(instants.length > 0, 'the answer should quote the publish times it was given')
  for (const instant of instants) {
    assert.ok((Object.values(publishedAt) as readonly string[]).includes(instant), `${instant} was not an input`)
  }
})
