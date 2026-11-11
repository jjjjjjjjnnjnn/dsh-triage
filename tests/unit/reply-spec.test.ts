/**
 * The replies have to exist, and the artifact has to be able to say so (R94).
 *
 * WHY THIS EXISTS: for nine days the repository's only proof that the three outreach replies were
 * "ready" was prose in `registry.json`. Recording them as posted without a machine check would turn
 * a hand-written URL into evidence — the shape this project keeps rejecting.
 *
 * WHAT THE REAL RUN ALREADY SHOWED (negative controls, executed by hand on 2026-11-11):
 *   - a made-up comment id (`…discussioncomment-99999`) → refused, no artifact;
 *   - a discussion URL without `#discussioncomment-<id>` → refused, no artifact;
 *   - somebody else's comment (`…-18655229`, author `JulienKervarrec`) → refused, no artifact.
 * Those three are not fixtures: they were run against the live API and produced no file, which is
 * what "a reply that cannot be verified is not a reply" has to mean.
 *
 * THIS FILE pins the parts that can be checked without the network: the URL shape and the pairing
 * between the `#<n>` a caller declares and the discussion the URL actually names. A spec that names
 * the wrong thread would attribute our words to somebody else's question.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseReplySpec } from '../../scripts/lib/reply-spec.mjs'

test('a discussion-comment URL is parsed into the thread it names', () => {
  const spec = parseReplySpec('8202', 'https://github.com/deepseek-ai/deepseek-harness/discussions/8202#discussioncomment-19542005')
  assert.equal(spec.ok, true)
  assert.equal(spec.owner, 'deepseek-ai')
  assert.equal(spec.repo, 'deepseek-harness')
  assert.equal(spec.number, 8202)
  assert.equal(spec.commentId, '19542005')
})

test('NEGATIVE CONTROL: a URL that is not a comment is refused, not coerced into one', () => {
  const spec = parseReplySpec('8202', 'https://github.com/deepseek-ai/deepseek-harness/discussions/8202')
  assert.equal(spec.ok, false)
  assert.ok(String(spec.detail).includes('discussioncomment'))
})

test('NEGATIVE CONTROL: a declared number that disagrees with the URL is refused', () => {
  const spec = parseReplySpec('11687', 'https://github.com/deepseek-ai/deepseek-harness/discussions/8202#discussioncomment-1')
  assert.equal(spec.ok, false)
  assert.ok(String(spec.detail).includes('11687'))
})

test('NEGATIVE CONTROL: a non-GitHub host is refused even if it looks like the same path', () => {
  assert.equal(parseReplySpec('8202', 'https://gitlab.com/a/b/-/discussions/8202#discussioncomment-1').ok, false)
  assert.equal(parseReplySpec('8202', 'http://github.com/a/b/discussions/8202#discussioncomment-1').ok, false)
})

test('a spec without the `n=` half is refused rather than defaulting to the URL', () => {
  assert.equal(parseReplySpec('', 'https://github.com/a/b/discussions/8202#discussioncomment-1').ok, false)
})
