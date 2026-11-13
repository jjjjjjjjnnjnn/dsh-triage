/**
 * "Which channels did we publish on, and which one feeds D5?" (R73)
 *
 * WHY: eleven days before the only product judgement, the temptation is to read four channels of promotion
 * as *evidence of demand*. `docs/specs/D5-measurement.md` counts three things and none of them is "how many
 * places we posted". These cases pin that boundary, plus the two ways a ledger normally rots: a wrong host
 * and a duplicate record.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CHANNEL_EVIDENCE, CHANNEL_PLATFORMS, judgeChannels } from '../../scripts/lib/channels.mjs'

const NOW = '2026-11-03T00:00:00.000Z'
const GITHUB = 'https://github.com/deepseek-ai/deepseek-harness/discussions/11813'
const REDDIT = 'https://www.reddit.com/r/DeepSeek/comments/1xm84py/understanding/'
const X = 'https://x.com/jjjj1955714/status/2117306628227940741'

const counted = (overrides: Record<string, unknown> = {}) => ({
  id: 'github-11813',
  platform: 'github-discussion',
  url: GITHUB,
  posted_on: '2026-11-01T20:24:37.000Z',
  d5_counts: true,
  evidence: 'measured',
  ...overrides,
})
const notCounted = (overrides: Record<string, unknown> = {}) => ({
  id: 'reddit-deepseek',
  platform: 'reddit',
  url: REDDIT,
  posted_on: null,
  d5_counts: false,
  why_not_counted: 'reactions only count #11813; a subreddit upvote is not one of the three numbers',
  evidence: 'declared-url-reachable',
  ...overrides,
})

const judge = (channels: unknown, extra: Record<string, unknown> = {}) =>
  judgeChannels({ channels, now: NOW, registryUrl: GITHUB, registryPostedOn: '2026-11-01T20:24:37.000Z', ...extra })

test('a coherent ledger passes and names the one channel that feeds D5', () => {
  const verdict = judge([counted(), notCounted(), notCounted({ id: 'reddit-harness', url: REDDIT.replace('1xm84py', '1xm88ex') })])
  assert.deepEqual(verdict.problems, [])
  assert.equal(verdict.counted, 'github-11813')
})

test('a second counted channel is refused: the spec counts one discussion', () => {
  const verdict = judge([counted(), notCounted({ d5_counts: true, posted_on: '2026-11-02T00:00:00.000Z' })])
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => problem.includes('exactly one channel may have d5_counts=true')))
})

test('promotion without a reason is refused — this is the whole point of the module', () => {
  for (const why of [undefined, '', '   ', 'too short']) {
    const verdict = judge([counted(), notCounted({ why_not_counted: why })])
    assert.equal(verdict.ok, false, `why_not_counted=${JSON.stringify(why)} must be refused`)
    assert.ok(verdict.problems.some((problem) => problem.includes('why_not_counted')))
  }
})

test('a URL on the wrong host for its platform is refused', () => {
  // The realistic typo: a reddit link pasted under the X platform, or a subreddit link that is not a comment.
  const verdict = judge([counted(), notCounted({ platform: 'x' })])
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => problem.includes('does not look like a x link')))
  assert.equal(judge([counted(), notCounted({ url: 'https://www.reddit.com/r/DeepSeek/' })]).ok, false)
})

test('the counted channel must be the D5 registry\'s own post, to the millisecond', () => {
  const wrongUrl = judge([counted({ url: 'https://github.com/deepseek-ai/deepseek-harness/discussions/9999' })])
  assert.ok(wrongUrl.problems.some((problem) => problem.includes('the D5 registry names')))
  const wrongTime = judge([counted()], { registryPostedOn: '2026-11-01T21:24:37.000Z' })
  assert.ok(wrongTime.problems.some((problem) => problem.includes('disagree by 3600000ms')))
})

test('a counted channel without a real instant is refused, a counted one in the future too', () => {
  assert.equal(judge([counted({ posted_on: null })]).ok, false)
  assert.equal(judge([counted({ posted_on: '2026-02-30T12:00:00.000Z' })]).ok, false)
  assert.equal(judge([counted({ posted_on: '2026-12-01T00:00:00.000Z' })]).ok, false)
})

test('a non-counted channel may leave the date empty — but must still be a real link', () => {
  // The honest shape for Reddit: reachable, unreadable, date unknown. Not a guess.
  assert.equal(judge([counted(), notCounted({ posted_on: null })]).ok, true)
  assert.equal(judge([counted(), notCounted({ posted_on: 'not a date' })]).ok, true)
})

test('duplicate ids and duplicate urls are refused', () => {
  assert.equal(judge([counted(), notCounted({ id: 'github-11813' })]).ok, false)
  assert.equal(judge([counted(), notCounted({ url: GITHUB })]).ok, false)
})

test('an unknown platform, a missing evidence level and an empty ledger are all refused', () => {
  assert.equal(judge([counted(), notCounted({ platform: 'mastodon' })]).ok, false)
  assert.equal(judge([counted(), notCounted({ evidence: 'trust-me' })]).ok, false)
  assert.equal(judge([]).ok, false)
})

test('the lane and evidence names are the ones the ledger may use, and nothing else', () => {
  /*
   * R104 added `github-pull`: an awesome-list submission is a pull request, not a discussion. Keeping it
   * in its own lane is what stops "we have a PR open" from being read as "we posted in a discussion" —
   * only the latter can feed D5.
   */
  assert.deepEqual(Object.keys(CHANNEL_PLATFORMS).sort(), ['github-discussion', 'github-pull', 'reddit', 'x'])
  assert.deepEqual([...CHANNEL_EVIDENCE].sort(), ['declared', 'declared-url-reachable', 'measured'])
})

test('a submission PR is accepted in its own lane, and still cannot feed D5', () => {
  const PR = 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14880'
  const ok = judge([counted(), notCounted({ id: 'awesome-pr', platform: 'github-pull', url: PR })])
  assert.deepEqual(ok.problems, [])
  // A PR counted toward D5 would move a frozen number: the spec counts reactions on #11813.
  const miscounted = judge([counted(), notCounted({ id: 'awesome-pr', platform: 'github-pull', url: PR, d5_counts: true, posted_on: '2026-11-13T05:30:00.000Z' })])
  assert.equal(miscounted.ok, false)
  // And the lanes stay separate in both directions.
  assert.equal(judge([counted(), notCounted({ id: 'x', platform: 'github-discussion', url: PR })]).ok, false)
})
