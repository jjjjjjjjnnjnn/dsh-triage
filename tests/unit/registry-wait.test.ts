/**
 * The retry policy behind "the version is not on the registry yet" (R62).
 *
 * WHY THESE CASES: each one is a decision the release chain actually has to make. The dangerous
 * direction is retrying the wrong failure (five minutes of waiting before reporting an expired token)
 * or giving up on the right one (a red artifact for a release that worked — which is what happened
 * three times in five minutes on 0.3.2).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_REGISTRY_WAIT_MS,
  MAX_ATTEMPTS,
  describePropagationWait,
  describeVisibilityWait,
  looksLikePropagationLag,
  shouldRetryInstall,
  shouldRetryVisibility,
} from '../../scripts/lib/registry-wait.mjs'

const NOTARGET = 'npm error notarget No matching version found for dsh-triage@0.3.2.'

test('the propagation shape is recognised from npm\'s own words', () => {
  assert.equal(looksLikePropagationLag({ code: 1, output: NOTARGET }), true)
  assert.equal(looksLikePropagationLag({ code: 1, output: 'npm error code ETARGET' }), true)
  assert.equal(looksLikePropagationLag({ code: 1, output: 'npm error 404 Not Found' }), false)
})

test('a successful install never triggers a retry', () => {
  assert.equal(shouldRetryInstall({ code: 0, output: '', elapsedMs: 0, budgetMs: DEFAULT_REGISTRY_WAIT_MS, attempt: 1 }), false)
})

test('a notarget failure retries while the budget lasts', () => {
  assert.equal(shouldRetryInstall({ code: 1, output: NOTARGET, elapsedMs: 30_000, budgetMs: 300_000, attempt: 2 }), true)
})

test('the same failure stops once the budget is spent — it must fail for real', () => {
  assert.equal(shouldRetryInstall({ code: 1, output: NOTARGET, elapsedMs: 300_001, budgetMs: 300_000, attempt: 3 }), false)
})

test('a credential failure is answered at once, not after five minutes', () => {
  // R50's lesson in the other direction: a broken token is a conclusion, not a slow registry.
  assert.equal(shouldRetryInstall({ code: 1, output: 'npm error code E401', elapsedMs: 0, budgetMs: 300_000, attempt: 1 }), false)
})

test('a zero or missing budget means "ask once" (the negative-control shape)', () => {
  assert.equal(shouldRetryInstall({ code: 1, output: NOTARGET, elapsedMs: 0, budgetMs: 0, attempt: 1 }), false)
  assert.equal(shouldRetryInstall({ code: 1, output: NOTARGET, elapsedMs: 0, budgetMs: Number.NaN, attempt: 1 }), false)
})

test('a failure with no output is not assumed to be propagation', () => {
  assert.equal(shouldRetryInstall({ code: 1, output: '', elapsedMs: 0, budgetMs: 300_000, attempt: 1 }), false)
  assert.equal(shouldRetryInstall({ code: null, output: NOTARGET, elapsedMs: 0, budgetMs: 300_000, attempt: 1 }), true)
})

test('the attempt cap holds even with an enormous budget', () => {
  assert.equal(shouldRetryInstall({ code: 1, output: NOTARGET, elapsedMs: 1, budgetMs: 10 * 60 * 60 * 1000, attempt: MAX_ATTEMPTS }), false)
})

test('the artifact sentence says whether there was a wait at all', () => {
  assert.match(describePropagationWait({ attempts: 1, waitedMs: 0 }), /first try/)
  const waited = describePropagationWait({ attempts: 4, waitedMs: 45_000, settled: true })
  assert.match(waited, /3 time\(s\)/)
  assert.match(waited, /45000ms/)
  assert.match(waited, /got a real answer/)
})

test('a wait that ended in the same answer is called a failure, not a wait', () => {
  // This is the control run: budget spent, registry still says 9.9.9 is not there.
  const spent = describePropagationWait({ attempts: 2, waitedMs: 16_516, settled: false })
  assert.match(spent, /still did/)
  assert.match(spent, /real failure, not a wait/)
  assert.doesNotMatch(spent, /got a real answer/)
})

/*
 * R91: the read side had no wait at all.
 *
 * 0.3.5's first publish artifact recorded `root-manifest`, four `version:*` and `dist-tags-agree` as
 * red while the same run's install probe resolved 315s later — the registry had the version the
 * whole time. These cases pin the decision that was missing, and the direction that must NOT change:
 * a spent budget is still a failure.
 */

test('the read side retries while the packument is behind and the budget lasts', () => {
  assert.equal(shouldRetryVisibility({ visible: false, elapsedMs: 30_000, budgetMs: 300_000, attempt: 2 }), true)
})

test('a visible version never triggers a retry', () => {
  assert.equal(shouldRetryVisibility({ visible: true, elapsedMs: 30_000, budgetMs: 300_000, attempt: 2 }), false)
})

test('a spent budget stops the read wait — the red artifact must still be possible', () => {
  assert.equal(shouldRetryVisibility({ visible: false, elapsedMs: 300_001, budgetMs: 300_000, attempt: 3 }), false)
})

test('a zero budget means "read once", which is the shape the red 0.3.5 artifact had', () => {
  assert.equal(shouldRetryVisibility({ visible: false, elapsedMs: 0, budgetMs: 0, attempt: 1 }), false)
  assert.equal(shouldRetryVisibility({ visible: false, elapsedMs: 0, budgetMs: Number.NaN, attempt: 1 }), false)
})

test('the read wait obeys the same attempt cap as the install wait', () => {
  assert.equal(
    shouldRetryVisibility({ visible: false, elapsedMs: 1, budgetMs: 10 * 60 * 60 * 1000, attempt: MAX_ATTEMPTS }),
    false,
  )
})

test('the read sentence separates "it appeared" from "it never appeared"', () => {
  assert.match(describeVisibilityWait({ attempts: 1, waitedMs: 0 }), /first read/)
  const appeared = describeVisibilityWait({ attempts: 3, waitedMs: 30_000, settled: true })
  assert.match(appeared, /2 read\(s\)/)
  assert.match(appeared, /appeared after 30000ms/)
  const never = describeVisibilityWait({ attempts: 4, waitedMs: 300_000, settled: false })
  assert.match(never, /still did not/)
  assert.match(never, /real failure, not a wait/)
  assert.doesNotMatch(never, /appeared after/)
})
