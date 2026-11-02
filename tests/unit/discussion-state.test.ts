/**
 * "Can we still reply there?" (R71).
 *
 * WHY THESE CASES: the drafts are prepared in one round and posted in another, by a human. Between the
 * two the thread can be answered, closed, or — most likely of all — not readable (rate limit, token
 * expired, repo moved). The gate's job is to keep that third case from printing the same word as the
 * first, because "nobody answered yet" is exactly what a `null` would otherwise look like.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REPLY_GATES, judgeReplyGate } from '../../scripts/lib/discussion-state.mjs'

test('an unreadable thread is never reported as open', () => {
  // The whole point: these four must not collapse into `open`.
  assert.equal(judgeReplyGate(null), 'unreadable')
  assert.equal(judgeReplyGate(undefined), 'unreadable')
  assert.equal(judgeReplyGate('open'), 'unreadable')
  assert.equal(judgeReplyGate({}), 'unreadable')
  assert.equal(judgeReplyGate({ closed: false }), 'unreadable')
  assert.equal(judgeReplyGate({ isAnswered: false }), 'unreadable')
})

test('only two observed false flags make a thread open', () => {
  assert.equal(judgeReplyGate({ closed: false, isAnswered: false }), 'open')
})

test('an accepted answer wins over "still not closed"', () => {
  // GitHub's own `isAnswered` is the signal a human would act on; a thread with an accepted answer is
  // not a place to drop a root-cause reply.
  assert.equal(judgeReplyGate({ closed: false, isAnswered: true }), 'answered')
})

test('closed wins over answered, because nothing can be posted either way', () => {
  assert.equal(judgeReplyGate({ closed: true, isAnswered: true }), 'closed')
  assert.equal(judgeReplyGate({ closed: true, isAnswered: false }), 'closed')
})

test('a non-boolean flag is not a false one', () => {
  // `"false"` and `0` are the shapes a JSON round-trip or a hand-built fixture produces. Reading them as
  // false would recreate the R66 `NaN` bug in a new place.
  assert.equal(judgeReplyGate({ closed: 'false', isAnswered: false }), 'unreadable')
  assert.equal(judgeReplyGate({ closed: false, isAnswered: 'false' }), 'unreadable')
  assert.equal(judgeReplyGate({ closed: 0, isAnswered: false }), 'unreadable')
})

test('our own artifact rows round-trip through the same gate', () => {
  // `record_discussion_state` writes rows with `answered` (past tense) rather than `isAnswered`, so the
  // rule has to hold for both spellings — otherwise re-judging a snapshot would disagree with the live run.
  assert.equal(judgeReplyGate({ closed: false, answered: false }), 'open')
  assert.equal(judgeReplyGate({ closed: false, answered: true }), 'answered')
  assert.equal(judgeReplyGate({ closed: false }), 'unreadable')
})

test('the gate names are the four the artifact counts, and nothing else', () => {
  assert.deepEqual([...REPLY_GATES].sort(), ['answered', 'closed', 'open', 'unreadable'])
})
