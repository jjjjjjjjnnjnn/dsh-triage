/**
 * D5's three numbers: the reading rules, pinned (R54).
 *
 * `docs/specs/D5-measurement.md` lists N1–N7; every one of them is a test below. The two directions
 * matter equally: a rule that always says "fail" is as useless as one that always says "pass", so
 * N7 (all three met, window still open) must produce `pass`.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { D5_THRESHOLDS, isExternalReference, judgeD5, windowOf } from '../../scripts/lib/d5-score.mjs'

const POSTED = '2026-11-03T10:00:00.000Z'
const SAME_DAY = '2026-11-05T10:00:00.000Z'
const AFTER_WINDOW = '2026-11-20T10:00:00.000Z'
const post = { url: 'https://github.com/deepseek-ai/deepseek-harness/discussions/12000', number: 12000, author: 'us' }

test('N1: 634 weekly downloads in a single-day burst is not demand', () => {
  const evidence = judgeD5({
    post,
    postedOn: POSTED,
    now: AFTER_WINDOW,
    readings: {
      reactions: { value: 10 },
      externalReferences: { value: 1, entries: [{ url: 'https://example.invalid/x', author: 'someone' }] },
      weeklyDownloads: { value: 634, shape: 'single-day-burst' },
    },
  })
  assert.equal(evidence.numbers.weekly_downloads.met, false)
  assert.equal(evidence.verdict, 'fail')
})

test('N2: three green numbers without a post date is unmeasurable, not pass (R70: was no-post)', () => {
  /*
   * R70 changed the label, not the intent. The spec's first row used to be "no posted_on OR no post URL →
   * no-post"; but when the URL is right there, saying "nothing was posted" is false. The honest answer is
   * "I cannot read the window start" = unmeasurable. Still never `pass`.
   */
  const evidence = judgeD5({
    post,
    postedOn: null,
    now: AFTER_WINDOW,
    readings: {
      reactions: { value: 40 },
      externalReferences: { value: 5, entries: [] },
      weeklyDownloads: { value: 90, shape: 'steady' },
    },
  })
  assert.equal(evidence.verdict, 'unmeasurable')
  assert.equal(evidence.reason, 'window-start-unreadable')
  assert.equal(evidence.counts_as_demand, false)
  // The post itself is still reported: the tool must not claim there is no sample.
  assert.equal(evidence.post?.url, post.url)
})

test('N2b: with no post at all the answer is still no-post', () => {
  const evidence = judgeD5({
    post: null,
    postedOn: null,
    now: AFTER_WINDOW,
    readings: {
      reactions: { value: 40 },
      externalReferences: { value: 5, entries: [] },
      weeklyDownloads: { value: 90, shape: 'steady' },
    },
  })
  assert.equal(evidence.verdict, 'no-post')
  assert.equal(evidence.post, null)
})

test('N3: an unreadable number is unmeasurable, never fail', () => {
  const evidence = judgeD5({
    post,
    postedOn: POSTED,
    now: AFTER_WINDOW,
    readings: {
      reactions: { state: 'unreadable' },
      externalReferences: { value: 3, entries: [] },
      weeklyDownloads: { value: 90, shape: 'steady' },
    },
  })
  assert.equal(evidence.verdict, 'unmeasurable')
  assert.equal(evidence.numbers.reactions.state, 'unreadable')
  assert.equal(evidence.numbers.reactions.value, null)
  assert.equal(evidence.counts_as_demand, false)
})

test('N4: our own pull requests and our own repository never count as external references', () => {
  const self = { login: 'jjjjjjjjnnjnn', repository: 'github.com/jjjjjjjjnnjnn/dsh-triage', ownPulls: ['github.com/zhu1090093659/dsh-community-plugins/pull/65'] }
  assert.equal(
    isExternalReference({ url: 'https://github.com/zhu1090093659/dsh-community-plugins/pull/65', author: 'someone' }, self),
    false,
    'our own submission is not an external reference',
  )
  assert.equal(
    isExternalReference({ url: 'https://github.com/jjjjjjjjnnjnn/dsh-triage/issues/7', author: 'someone', repository: 'jjjjjjjjnnjnn/dsh-triage' }, self),
    false,
    'our own issue is not an external reference',
  )
  assert.equal(
    isExternalReference({ url: 'https://github.com/someone/blog/issues/3', author: 'jjjjjjjjnnjnn' }, self),
    false,
    'our own account is not somebody else',
  )
  assert.equal(
    isExternalReference({ url: 'https://github.com/someone/notes/issues/3', author: 'someone', repository: 'someone/notes' }, self),
    true,
    'a stranger linking the repo is the thing D5 counts',
  )
  const evidence = judgeD5({
    post,
    postedOn: POSTED,
    now: AFTER_WINDOW,
    readings: {
      reactions: { value: 12 },
      externalReferences: { value: 0, entries: [] },
      weeklyDownloads: { value: 25, shape: 'steady' },
    },
  })
  assert.equal(evidence.numbers.external_references.met, false)
  assert.equal(evidence.verdict, 'fail')
})

test('N5: the window closes exactly on day 14', () => {
  const before = windowOf({ postedOn: POSTED, now: '2026-11-17T09:59:59.999Z' })
  const at = windowOf({ postedOn: POSTED, now: '2026-11-17T10:00:00.000Z' })
  assert.equal(before.closed, false)
  assert.equal(at.closed, true)
  assert.equal(at.ends_at, '2026-11-17T10:00:00.000Z')
})

test('N6: two of three numbers met, window closed, is fail', () => {
  const evidence = judgeD5({
    post,
    postedOn: POSTED,
    now: AFTER_WINDOW,
    readings: {
      reactions: { value: D5_THRESHOLDS.reactions - 1 },
      externalReferences: { value: 0, entries: [] },
      weeklyDownloads: { value: 25, shape: 'steady' },
    },
  })
  assert.equal(evidence.verdict, 'fail')
})

test('N7: three numbers met before the window closes is still pass', () => {
  const evidence = judgeD5({
    post,
    postedOn: POSTED,
    now: SAME_DAY,
    readings: {
      reactions: { value: D5_THRESHOLDS.reactions },
      externalReferences: { value: D5_THRESHOLDS.external_references, entries: [{ url: 'https://github.com/someone/x/issues/1', author: 'someone' }] },
      weeklyDownloads: { value: D5_THRESHOLDS.weekly_downloads, shape: 'steady' },
    },
  })
  assert.equal(evidence.verdict, 'pass')
  assert.equal(evidence.counts_as_demand, true)
  assert.equal(evidence.window.closed, false)
})

test('pending is its own answer: the window is open and not everything is met', () => {
  const evidence = judgeD5({
    post,
    postedOn: POSTED,
    now: SAME_DAY,
    readings: {
      reactions: { value: 0 },
      externalReferences: { value: 0, entries: [] },
      weeklyDownloads: { value: 0, shape: 'no-record' },
    },
  })
  assert.equal(evidence.verdict, 'pending')
  assert.equal(evidence.counts_as_demand, false)
})

test('N8: a start date that does not exist yields no window at all, not a rolled one', () => {
  /*
   * R67 (T-836). `Date.parse('2026-02-30T12:00:00Z')` returns a finite epoch (March 2) — so before this,
   * a typo produced a *valid-looking* 14-day window two days late, and the verdict was computed from it.
   * Now the window refuses the start instead of silently moving it.
   */
  for (const postedOn of ['2026-02-30T12:00:00Z', '2026-13-01T00:00:00Z', '2026-11-02', '2026-11-02T99:99:99Z']) {
    const window = windowOf({ postedOn, now: '2026-11-05T00:00:00.000Z' })
    assert.equal(window.posted_on, null, `${postedOn} must not produce a window`)
    assert.equal(window.ends_at, null)
    assert.equal(window.days_left, null)
  }
  // And the judge refuses to compute a verdict from a missing window: since R70 that is `unmeasurable`
  // (a post exists, the date is the problem), not `no-post`.
  const evidence = judgeD5({ post, postedOn: '2026-02-30T12:00:00Z', now: '2026-11-05T00:00:00.000Z', readings: {} })
  assert.equal(evidence.verdict, 'unmeasurable')
  assert.equal(evidence.reason, 'window-start-unreadable')
})

test('N9: an offset start date is the same window as its UTC spelling', () => {
  const offset = windowOf({ postedOn: '2026-11-02T18:36:00+01:00', now: '2026-11-05T00:00:00.000Z' })
  const utc = windowOf({ postedOn: '2026-11-02T17:36:00.000Z', now: '2026-11-05T00:00:00.000Z' })
  assert.deepEqual(offset, utc)
  assert.equal(offset.posted_on, '2026-11-02T17:36:00.000Z')
})
