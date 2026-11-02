/**
 * "The posted-url rule says what it means" (R65).
 *
 * WHY THESE CASES: the rule has been wrong twice, and both mistakes were in the matcher. So the cases are
 * the mistakes themselves, in the order they cost something:
 *
 *   1. an X post recorded against a channel that only says "GitHub Discussions" → must fail
 *   2. `2026-11-02` (bare date) → must fail, because `Date.parse` reads it as UTC midnight and moves a
 *      14-day window by up to a day
 *   3. `2026-11-02T18:36:00+01:00` → must PASS: it is timezone-qualified, and this machine runs at UTC+1.
 *      R64 rejected it with a message claiming it was not — that is the bug this file exists for.
 *   4. a future instant → must fail
 *   5. a channel that names no platform (`V2EX` / `B 站` / 中文社区) → must fail loudly rather than pass
 *      vacuously, and `V2EX` must not be read as the platform "X"
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { POSTING_PLATFORMS, judgePosting } from '../../scripts/lib/posting.mjs'

const NOW = '2026-11-02T20:00:00.000Z'
const X_URL = 'https://x.com/jjjj1955714/status/2117306628227940741'
const DISCUSSION_URL = 'https://github.com/deepseek-ai/deepseek-harness/discussions/11813'

test('an X post on a channel that names X passes, including the share-link query', () => {
  const verdict = judgePosting({ channel: 'X · 线程（中文主选 / 英文备选）', url: X_URL, postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.platform, 'x')
  assert.deepEqual(verdict.problems, [])

  const shareLink = judgePosting({
    channel: 'X · 线程',
    url: `${X_URL}?s=46&t=abc`,
    postedOn: '2026-11-02T17:36:00.000Z',
    now: NOW,
  })
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

test('an X URL recorded against a GitHub channel fails, and names the platform it expected', () => {
  const verdict = judgePosting({
    channel: 'GitHub Discussions · 「Show Your Plugins!」分类',
    url: X_URL,
    postedOn: '2026-11-02T17:36:00.000Z',
    now: NOW,
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.platform, 'github-discussion')
  assert.ok(verdict.problems.some((line) => line.includes('is not a github-discussion URL')))
})

test('a bare date fails — it would move the 14-day window by up to a day', () => {
  const verdict = judgePosting({ channel: 'X · 线程', url: X_URL, postedOn: '2026-11-02', now: NOW })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((line) => line.includes('explicit zone')))
})

test('an offset timestamp passes — +01:00 is timezone-qualified (the R64 bug)', () => {
  const verdict = judgePosting({ channel: 'X · 线程', url: X_URL, postedOn: '2026-11-02T18:36:00+01:00', now: NOW })
  assert.equal(verdict.ok, true)
  assert.deepEqual(verdict.problems, [])

  // Same instant, two spellings: the rule must not care which one the human typed.
  const utc = judgePosting({ channel: 'X · 线程', url: X_URL, postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
  assert.equal(utc.ok, true)
  assert.equal(Date.parse('2026-11-02T18:36:00+01:00'), Date.parse('2026-11-02T17:36:00.000Z'))
})

test('an instant without seconds or zone fails', () => {
  for (const postedOn of ['2026-11-02T17:36', '2026-11-02 17:36:00Z', '2026-11-02T17:36:00']) {
    const verdict = judgePosting({ channel: 'X · 线程', url: X_URL, postedOn, now: NOW })
    assert.equal(verdict.ok, false, `${postedOn} must be refused`)
  }
})

test('a future instant fails', () => {
  const verdict = judgePosting({ channel: 'X · 线程', url: X_URL, postedOn: '2026-12-01T00:00:00.000Z', now: NOW })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((line) => line.includes('in the future')))
})

test('a channel that names no verifiable platform fails instead of passing vacuously', () => {
  for (const channel of ['V2EX · 程序员节点', 'V2EX 分享发现', 'B 站 60–90 秒脚本', '中文社区长文（项目口吻，不露个人身份）']) {
    const verdict = judgePosting({ channel, url: 'https://example.com/p/1', postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
    assert.equal(verdict.ok, false, `${channel} must not pass silently`)
    assert.ok(verdict.problems.some((line) => line.includes('names no platform')))
  }
})

test('V2EX is not the platform X', () => {
  const x = POSTING_PLATFORMS.find((platform) => platform.id === 'x')
  assert.equal(x?.channel.test('X · 线程（中文主选 / 英文备选）'), true)
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
  ]) {
    const channel = url.includes('github') ? 'GitHub Discussions · 分类' : 'X · 线程'
    const verdict = judgePosting({ channel, url, postedOn: '2026-11-02T17:36:00.000Z', now: NOW })
    assert.equal(verdict.ok, false, `${url} must be refused`)
  }
})
