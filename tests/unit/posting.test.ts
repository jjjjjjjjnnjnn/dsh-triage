/**
 * "The posted-url rule says what it means" (R65/R66).
 *
 * WHY THESE CASES: the rule has been wrong three times, and every mistake was in the matcher. So the cases
 * are the mistakes themselves, in the order they cost something:
 *
 *   1. R56 — an X post could not be recorded at all (rule only accepted discussion URLs)
 *   2. R64 — `2026-11-02T18:36:00+01:00` was refused with the false message "not timezone-qualified"
 *   3. R65 — an independent adversary found a *nonexistent* instant passing: `2026-02-30T12:00:00Z`
 *      returned `ok: true, problems: []` because the regex counted digits and `Date.parse` rolls Feb 30
 *      into Mar 2; `2026-13-01T00:00:00Z` returned `NaN`, which the future-check read as "not in the
 *      future". A one-character typo produced zero signals.
 *
 * The last group is the one that matters most: a checker that accepts a date which does not exist is worse
 * than no checker, because it *looks* like the window is pinned down.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { POSTING_PLATFORMS, judgePosting, parseInstant } from '../../scripts/lib/posting.mjs'

const NOW = '2026-11-02T20:00:00.000Z'
const X_URL = 'https://x.com/jjjj1955714/status/2117306628227940741'
const DISCUSSION_URL = 'https://github.com/deepseek-ai/deepseek-harness/discussions/11813'
const X_CHANNEL = 'X · 线程（中文主选 / 英文备选）'

test('an X post on a channel that names X passes, including the share-link query', () => {
  const verdict = judgePosting({ channel: X_CHANNEL, url: X_URL, postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.platform, 'x')
  assert.deepEqual(verdict.problems, [])
  assert.equal(verdict.posted_at, '2026-11-02T17:36:00.000Z')

  const shareLink = judgePosting({ channel: X_CHANNEL, url: `${X_URL}?s=46&t=abc`, postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
  assert.equal(shareLink.ok, true)
})

test('a discussion post on a discussion channel passes', () => {
  const verdict = judgePosting({
    channel: 'upstream GitHub Discussions · 「Show Your Plugins!」分类',
    url: DISCUSSION_URL,
    postedOn: '2026-11-01T20:24:37.000Z',
    now: NOW,
  })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.platform, 'github-discussion')
})

test('an X URL recorded against a GitHub channel fails, and names both sides', () => {
  const verdict = judgePosting({ channel: 'GitHub Discussions · 分类', url: X_URL, postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
  assert.equal(verdict.ok, false)
  // `platform` reports where the URL is (that is the fact); the problem names what the channel said.
  assert.equal(verdict.platform, 'x')
  assert.ok(verdict.problems.some((line) => line.includes('is on x, but the channel names github-discussion')))
})

test('an instant that does not exist is refused — a typo must not pass silently (R65 adversary)', () => {
  for (const postedOn of [
    '2026-02-30T12:00:00Z', // 2026 is not a leap year; Date.parse rolls this to Mar 2
    '2026-04-31T00:00:00.000Z',
    '2026-13-01T00:00:00Z', // month 13 → NaN
    '2026-11-02T99:99:99Z', // → NaN
    '2026-11-02T18:36:00+99:00', // not a zone
    '2026-11-02T18:36:00+01:99', // not a zone
    '2026-11-02T18:36:60Z', // leap second: not handled, so not accepted
    '0000-01-01T00:00:00Z', // no plausible post lives here
  ]) {
    const verdict = judgePosting({ channel: X_CHANNEL, url: X_URL, postedOn, now: NOW })
    assert.equal(verdict.ok, false, `${postedOn} must be refused`)
    assert.equal(verdict.posted_at, null, `${postedOn} must not produce a canonical instant`)
    assert.ok(
      verdict.problems.some((line) => line.includes('cannot accept')),
      `${postedOn} must be refused for existing, got ${JSON.stringify(verdict.problems)}`,
    )
  }
})

test('parseInstant round-trips real instants and normalises offsets', () => {
  assert.equal(parseInstant('2026-11-02T17:36:00.000Z')?.canonical, '2026-11-02T17:36:00.000Z')
  assert.equal(parseInstant('2026-11-02T18:36:00+01:00')?.canonical, '2026-11-02T17:36:00.000Z')
  assert.equal(parseInstant('2026-11-03T01:36:00+08:00')?.canonical, '2026-11-02T17:36:00.000Z')
  assert.equal(parseInstant('2026-11-02T17:36:00-01:00')?.canonical, '2026-11-02T18:36:00.000Z')
  // A fractional part shorter than 3 digits is still the same instant family.
  assert.equal(parseInstant('2026-11-02T17:36:00.5Z')?.canonical, '2026-11-02T17:36:00.500Z')
  for (const value of ['2026-11-02', '2026-11-02T17:36', '2026-02-30T00:00:00Z', '', null, 42]) {
    assert.equal(parseInstant(value), null, `${String(value)} must not parse`)
  }
})

test('a bare date fails — it would move the 14-day window by up to a day', () => {
  const verdict = judgePosting({ channel: X_CHANNEL, url: X_URL, postedOn: '2026-11-02', now: NOW })
  assert.equal(verdict.ok, false)
  // Shape, not existence: a date-only string is a real day but not an instant.
  assert.ok(verdict.problems.some((line) => line.includes('not written as an ISO-8601 instant')))
})

test('an offset timestamp passes — +01:00 is timezone-qualified (the R64 bug)', () => {
  const offset = judgePosting({ channel: X_CHANNEL, url: X_URL, postedOn: '2026-11-02T18:36:00+01:00', now: NOW })
  assert.equal(offset.ok, true)
  assert.equal(offset.posted_at, '2026-11-02T17:36:00.000Z')
  assert.equal(offset.posted_at, judgePosting({ channel: X_CHANNEL, url: X_URL, postedOn: '2026-11-02T17:36:00.000Z', now: NOW }).posted_at)
})

test('an instant without seconds or zone fails', () => {
  for (const postedOn of ['2026-11-02T17:36', '2026-11-02 17:36:00Z', '2026-11-02T17:36:00']) {
    const verdict = judgePosting({ channel: X_CHANNEL, url: X_URL, postedOn, now: NOW })
    assert.equal(verdict.ok, false, `${postedOn} must be refused`)
  }
})

test('a future instant fails', () => {
  const verdict = judgePosting({ channel: X_CHANNEL, url: X_URL, postedOn: '2026-12-01T00:00:00.000Z', now: NOW })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((line) => line.includes('in the future')))
  // The same instant seen from a later clock is fine: "future" is relative to the reference time.
  assert.equal(judgePosting({ channel: X_CHANNEL, url: X_URL, postedOn: '2026-12-01T00:00:00.000Z', now: '2027-01-01T00:00:00.000Z' }).ok, true)
})

test('the reference time may be a number of milliseconds', () => {
  const now = Date.parse(NOW)
  assert.equal(judgePosting({ channel: X_CHANNEL, url: X_URL, postedOn: '2026-11-02T17:36:00.000Z', now }).ok, true)
  assert.equal(judgePosting({ channel: X_CHANNEL, url: X_URL, postedOn: '2026-12-01T00:00:00.000Z', now }).ok, false)
})

test('a channel that names no verifiable platform fails instead of passing vacuously', () => {
  for (const channel of ['V2EX · 程序员节点', 'V2EX 分享发现', 'B 站 60–90 秒脚本', '中文社区长文（项目口吻，不露个人身份）', '']) {
    const verdict = judgePosting({ channel, url: 'https://github.com/deepseek-ai/deepseek-harness/discussions/11813', postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
    assert.equal(verdict.ok, false, `${channel} must not pass silently`)
    assert.ok(verdict.problems.some((line) => line.includes('names no platform')))
  }
})

test('a channel may mention another platform to exclude it, as long as the URL is on one it names', () => {
  /*
   * R66's first cut refused any channel naming two platforms, which blocked true records: "X thread, not
   * an issue" and "GitHub Discussions（不是 issue）" are natural ways to say what a post is NOT. An
   * independent adversary flagged that as a new false-reject class (N-2), so the rule now lets the URL
   * decide: it must be on exactly one verifiable platform, and the channel must name that platform.
   */
  const cases = [
    ['X thread, not an issue', X_URL, 'x'],
    ['GitHub Discussions（不是 issue）', DISCUSSION_URL, 'github-discussion'],
    ['Discussion on X', X_URL, 'x'],
    ['GitHub Discussions · also on X', DISCUSSION_URL, 'github-discussion'],
  ] as const
  for (const [channel, url, platform] of cases) {
    const verdict = judgePosting({ channel, url, postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
    assert.equal(verdict.ok, true, `${channel} + ${url} must be accepted`)
    assert.equal(verdict.platform, platform)
  }
})

test('what stays forbidden: a URL on a platform the channel never names, or no platform at all', () => {
  // The channel names X; the URL is a GitHub discussion → the record is incoherent, not merely verbose.
  const wrongPlatform = judgePosting({ channel: X_CHANNEL, url: DISCUSSION_URL, postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
  assert.equal(wrongPlatform.ok, false)
  assert.ok(wrongPlatform.problems.some((line) => line.includes('is on github-discussion, but the channel names x')))

  // The channel says nothing this check can verify (V2EX / B 站 / 中文社区) → red, never vacuous green.
  for (const channel of ['V2EX · 程序员节点', 'B 站 60–90 秒脚本', '', 'Discussion']) {
    const verdict = judgePosting({ channel, url: X_URL, postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
    assert.equal(verdict.ok, false, `${channel || '(empty)'} must not pass silently`)
    assert.ok(verdict.problems.some((line) => line.includes('names no platform') || line.includes('is on x, but the channel names')))
  }

  // A URL on nothing we recognise is refused regardless of the channel.
  const unknownUrl = judgePosting({ channel: X_CHANNEL, url: 'https://example.com/p/1', postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
  assert.equal(unknownUrl.ok, false)
  assert.ok(unknownUrl.problems.some((line) => line.includes('not on a platform')))
})

test('V2EX is not the platform X', () => {
  const x = POSTING_PLATFORMS.find((platform) => platform.id === 'x')
  assert.equal(x?.channel.test(X_CHANNEL), true)
  // The `X` in `V2EX` is preceded by a letter, so it is not the word "X".
  assert.equal(x?.channel.test('V2EX · 程序员节点'), false)
  assert.equal(x?.channel.test('V2EX 分享发现'), false)
})

test('a URL on the wrong shape of the right platform still fails', () => {
  for (const url of [
    'https://github.com/deepseek-ai/deepseek-harness/discussions/not-a-number',
    'https://github.com/deepseek-ai/deepseek-harness/discussions/11813-evil',
    'https://x.com/jjjj1955714/status/',
    'https://x.com/jjjj1955714',
    'http://x.com/jjjj1955714/status/2117306628227940741',
    'https://x.com.evil.example/jjjj1955714/status/2117306628227940741',
    'https://evil.example/https://x.com/jjjj1955714/status/2117306628227940741',
  ]) {
    const channel = url.includes('github') ? 'GitHub Discussions · 分类' : X_CHANNEL
    const verdict = judgePosting({ channel, url, postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
    assert.equal(verdict.ok, false, `${url} must be refused`)
  }
})
