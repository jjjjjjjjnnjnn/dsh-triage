/**
 * "The public repo is the container subtree" has to mean *only* that (R93).
 *
 * WHY THESE CASES: this comparison is the only thing keeping the npm page describing the repository that
 * actually exists, and it is run after every push — by a human, from memory. So it is a pure function, and
 * the cases are the ways it has been (or could be) wrong:
 *
 *   1. **vacuous green** — `git rev-parse` failing quietly returns `''`, and `'' === ''` reads as "in sync".
 *      That is the R51/R52 shape (a value that was never read, reported as a conclusion), and it leads;
 *   2. **the wrong push** — pushing the container's *root* onto the public repo keeps every file, so a
 *      "does it look complete?" check passes while the public tree has grown a `dsh-triage/` prefix;
 *   3. **behind read as broken** — between a round's commits and its push the public repo is the cut of an
 *      older commit. That is the ordinary state of this machine, so collapsing it into `drift` would make
 *      the honest answer indistinguishable from the broken one;
 *   4. **drift said in a way nobody can act on** — "trees differ" without naming which side changed costs
 *      another round to diagnose.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { judgePublicCut } from '../../scripts/lib/public-cut.mjs'

/**
 * Unwrap the single problem a verdict is expected to carry. `noUncheckedIndexedAccess` is on, so the test
 * has to spell that out: asserting `problems.length === 1` and then indexing still leaves the compiler
 * (rightly) unconvinced that the element exists.
 */
const onlyProblem = (problems: readonly string[]): string => {
  const [first] = problems
  if (first === undefined) throw new assert.AssertionError({ message: 'expected exactly one problem' })
  return first
}

const HEAD = '79a55cd17dd72e7f8172e24a0aee5505c7b45596'
const HEAD_TREE = 'bbeba718bcc0402cef01f73d3a075000726dce4a'
const OLDER = '5c9f645a00000000000000000000000000000000'
const OLDER_TREE = '0f3a8c2e5d1b7a9c4e6f8d0b2a4c6e8f0a2c4e6d'
const OTHER_UNKNOWN = 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3'
const ROOT_TREE = 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0'

test('a public tree equal to HEAD\'s subtree is in sync, and nothing is reported as a problem', () => {
  const verdict = judgePublicCut({ headSubtreeTree: HEAD_TREE, head: HEAD, publicTree: HEAD_TREE, publicHead: HEAD, ref: 'origin/main' })
  assert.equal(verdict.status, 'in-sync')
  assert.deepEqual(verdict.problems, [])
})

test('unreadable refs are unmeasured, never in sync — an empty read must not compare equal to an empty read', () => {
  /*
   * The negative control that matters: `git rev-parse` prints nothing and exits non-zero for a ref it cannot
   * resolve, and a caller that swallows the exit code returns `''` — where `'' === ''` is *true*. Reporting
   * "in sync" out of two empty strings would say the public repo is current on a machine that never fetched it.
   */
  const base = { headSubtreeTree: HEAD_TREE, head: HEAD, publicTree: HEAD_TREE, publicHead: HEAD }
  for (const patch of [
    { headSubtreeTree: '' },
    { headSubtreeTree: null },
    { head: '' },
    { head: undefined },
    { publicTree: '' },
    { publicTree: 'origin/main' },
    { publicHead: '' },
    { publicHead: 'abc123' },
    { publicHead: HEAD.toUpperCase() },
    { publicHead: HEAD.slice(0, -1) },
  ]) {
    const input = { ...base, ...patch }
    const verdict = judgePublicCut(input)
    assert.equal(verdict.status, 'unmeasured', `${JSON.stringify(patch)} must not be judged`)
    assert.ok(verdict.problems.length > 0, 'an unmeasured verdict must say what could not be read')
  }
})

test('a public tree equal to an older container commit is behind, not drift', () => {
  /*
   * This is the state the machine sits in for the whole of a round: the round's commits are in, the push is
   * not. A red here would be a red every round, and "red every round" is how real reds stop being read.
   */
  const verdict = judgePublicCut({
    headSubtreeTree: HEAD_TREE,
    head: HEAD,
    publicTree: OLDER_TREE,
    publicHead: OLDER,
    matchingCommit: OLDER,
    commitsBehind: 5,
    ref: 'origin/main',
  })
  assert.equal(verdict.status, 'behind')
  assert.equal(verdict.problems.length, 1)
  assert.ok(onlyProblem(verdict.problems).includes('5c9f645'), 'the message must name the commit the public repo was cut from')
  assert.ok(onlyProblem(verdict.problems).includes('5 commit'), 'the message must say how far behind it is')
  assert.ok(/Nothing is wrong/.test(onlyProblem(verdict.problems)), 'behind must not read as a failure')
})

test('behind with an unknown distance still says behind, and does not print a made-up distance', () => {
  const verdict = judgePublicCut({
    headSubtreeTree: HEAD_TREE, head: HEAD, publicTree: OLDER_TREE, publicHead: OLDER,
    matchingCommit: OLDER, commitsBehind: null, ref: 'origin/main',
  })
  assert.equal(verdict.status, 'behind')
  assert.ok(!/commit\(s\) behind/.test(onlyProblem(verdict.problems)), 'an unread count must not be rendered as 0 or NaN')
  assert.ok(!onlyProblem(verdict.problems).includes('NaN'))
})

test('a public tree equal to the container ROOT is drift, and the message says the prefix is the reason', () => {
  /*
   * The wrong push keeps every file, so "does it look complete?" cannot see it. It gets its own sentence.
   */
  const verdict = judgePublicCut({
    headSubtreeTree: HEAD_TREE, head: HEAD, publicTree: ROOT_TREE, publicHead: HEAD,
    rootTree: ROOT_TREE, ref: 'origin/main',
  })
  assert.equal(verdict.status, 'drift')
  assert.ok(onlyProblem(verdict.problems).includes('ROOT'), 'the message must name the root-vs-subtree mistake')
  assert.ok(onlyProblem(verdict.problems).includes('prefix'), 'the message must name the consequence a reader can check')
  assert.ok(onlyProblem(verdict.problems).includes('main:dsh-triage'), 'the message must name the re-cut command')
})

test('a public tree matching no container commit is drift, and both trees and the ref are named', () => {
  const verdict = judgePublicCut({ headSubtreeTree: HEAD_TREE, head: HEAD, publicTree: OTHER_UNKNOWN, publicHead: HEAD, ref: 'origin/main' })
  assert.equal(verdict.status, 'drift')
  assert.equal(verdict.problems.length, 1)
  assert.ok(onlyProblem(verdict.problems).includes(HEAD_TREE))
  assert.ok(onlyProblem(verdict.problems).includes(OTHER_UNKNOWN))
  assert.ok(onlyProblem(verdict.problems).includes('origin/main'), 'the message must name which ref was read')
  assert.ok(/never contained|edited by hand/.test(onlyProblem(verdict.problems)), 'both causes must be named')
})

test('the ref defaults to origin/main rather than rendering "undefined" into the message', () => {
  const verdict = judgePublicCut({ headSubtreeTree: HEAD_TREE, head: HEAD, publicTree: OTHER_UNKNOWN, publicHead: HEAD })
  assert.equal(verdict.status, 'drift')
  assert.ok(onlyProblem(verdict.problems).includes('origin/main'))
  assert.ok(!onlyProblem(verdict.problems).includes('undefined'))
})

test('a SHA-256 repository object id (64 hex) is accepted as well as SHA-1 (40 hex)', () => {
  const long = 'a'.repeat(64)
  assert.equal(judgePublicCut({ headSubtreeTree: long, head: long, publicTree: long, publicHead: long }).status, 'in-sync')
})

test('a matching commit that is not an object id is refused, not silently trusted', () => {
  const verdict = judgePublicCut({
    headSubtreeTree: HEAD_TREE, head: HEAD, publicTree: OLDER_TREE, publicHead: OLDER,
    matchingCommit: 'origin/main', commitsBehind: 1,
  })
  assert.equal(verdict.status, 'unmeasured')
})
