/**
 * The coverage arithmetic, pinned (R59).
 *
 * The whole risk of this feature is flattering ourselves: counting "declares nothing" as an answer,
 * or quietly moving the denominator until the ratio looks good. Each test below is one of those
 * temptations, plus the boundary cases the README will quote.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assertComplete,
  coverageOf,
  formatInterval,
  formatPercent,
  manualReviewSample,
  reviewAgreement,
  scrubHomePaths,
  shareOf,
  signalSnippets,
  tierOfThread,
  wilson95,
} from '../../scripts/lib/question-coverage.mjs'

const measured = (status: string) => ({ state: 'measured', admission_status: status })

test('N4: a thread with one denied and one admitted package is a denial, not a pass', () => {
  assert.equal(
    tierOfThread({ layer: 'admission', probes: [measured('admitted'), measured('denied')] }),
    'names-a-denial',
  )
})

test('R59-S1: an upstream package that was NOT pinned is context, not an answer', () => {
  assert.equal(
    tierOfThread({
      layer: 'runtime',
      probes: [{ state: 'measured', package: '@deepseek-ai/dsh-tools', version_source: 'latest', admission_status: 'denied' }],
    }),
    'upstream-only',
  )
  assert.equal(
    tierOfThread({
      layer: 'runtime',
      probes: [{ state: 'measured', package: '@deepseek-ai/dsh-tools', version_source: 'latest', admission_status: 'admitted' }],
    }),
    'upstream-only',
  )
})

test('R59-S1: an upstream package the thread pinned IS judged at that version and can answer', () => {
  assert.equal(
    tierOfThread({
      layer: 'admission',
      probes: [{ state: 'measured', package: '@deepseek-ai/dsh-mcp-client', version_source: 'thread-pinned', admission_status: 'denied' }],
    }),
    'names-a-denial',
  )
  assert.equal(
    tierOfThread({
      layer: 'admission',
      probes: [{ state: 'measured', package: '@deepseek-ai/dsh-mcp-client', version_source: 'thread-pinned', admission_status: 'admitted' }],
    }),
    'rules-out-declaration',
  )
})

test('R59-S1: a third-party package counts whether or not the thread pinned it', () => {
  assert.equal(
    tierOfThread({
      layer: 'admission',
      probes: [{ state: 'measured', package: 'dsh-better-sidebar', version_source: 'latest', admission_status: 'denied' }],
    }),
    'names-a-denial',
  )
})

test('R59-S1: an upstream-only denial stays in the denominator but never in the headline', () => {
  const coverage = coverageOf([
    { layer: 'runtime', verdict: 'partially-answerable', tier: 'upstream-only' },
    { layer: 'admission', verdict: 'answerable', tier: 'names-a-denial' },
  ])
  assert.equal(coverage.tiers['upstream-only'], 1)
  assert.equal(coverage.headline.count, 1)
  assert.equal(coverage.headline.denominator, 2)
})

test('N3: a runtime thread whose packages all admit the target rules the declaration layer out', () => {
  assert.equal(tierOfThread({ layer: 'runtime', probes: [measured('admitted')] }), 'rules-out-declaration')
})

test('N2: "declares nothing" is its own tier, never an answer', () => {
  assert.equal(tierOfThread({ layer: 'admission', probes: [measured('unconstrained')] }), 'declares-nothing')
  assert.equal(tierOfThread({ layer: 'admission', probes: [measured('indeterminate')] }), 'declares-nothing')
})

test('N1: a package we could not read is probe-unreadable, not a denial', () => {
  assert.equal(tierOfThread({ layer: 'admission', probes: [{ state: 'unreadable', detail: 'HTTP 429' }] }), 'probe-unreadable')
})

test('a relevant thread with no package name needs their profile; a silent one is not ours', () => {
  assert.equal(tierOfThread({ layer: 'admission', probes: [] }), 'needs-their-profile')
  assert.equal(tierOfThread({ layer: 'unknown', probes: [] }), 'not-relevant')
})

test('N2/N1: the headline numerator excludes declares-nothing, and probe-unreadable stays in the denominator', () => {
  const coverage = coverageOf([
    { layer: 'admission', verdict: 'answerable', tier: 'names-a-denial' },
    { layer: 'admission', verdict: 'answerable', tier: 'rules-out-declaration' },
    { layer: 'admission', verdict: 'answerable', tier: 'declares-nothing' },
    { layer: 'admission', verdict: 'answerable', tier: 'probe-unreadable' },
    { layer: 'admission', verdict: 'needs-their-profile', tier: 'needs-their-profile' },
    { layer: 'unknown', verdict: 'not-ours', tier: 'not-relevant' },
  ])
  assert.equal(coverage.threads, 6)
  assert.equal(coverage.relevant, 5)
  assert.equal(coverage.decidable, 4)
  assert.equal(coverage.headline.count, 2, 'only tier 1 + tier 2')
  assert.equal(coverage.headline.denominator, 6, 'the population is the denominator, not the decidable subset')
  assert.equal(coverage.headline.ratio, 2 / 6)
  assert.equal(coverage.sensitivity.relevant.denominator, 5)
  assert.equal(coverage.sensitivity.decidable.denominator, 4)
})

test('N5: an empty population has no ratio and no interval (never 0%)', () => {
  const coverage = coverageOf([])
  assert.equal(coverage.headline.ratio, null)
  assert.equal(coverage.headline.wilson95, null)
  assert.equal(coverage.tiers['names-a-denial'], 0)
})

test('a numerator larger than its denominator is refused, not printed as 103%', () => {
  assert.throws(() => shareOf(3, 2), /cannot exceed/)
  assert.throws(() => shareOf(-1, 2), /non-negative/)
  assert.throws(() => shareOf(1.5, 2), /integer/)
})

test('an unknown tier or layer throws instead of being bucketed somewhere convenient', () => {
  assert.throws(() => coverageOf([{ layer: 'admission', verdict: 'answerable', tier: 'mostly-fine' as never }]), /unknown tier/)
  assert.throws(() => coverageOf([{ layer: 'vibes', verdict: 'answerable', tier: 'not-relevant' }]), /unknown layer/)
  assert.throws(() => coverageOf([{ layer: 'admission', verdict: 'solved', tier: 'not-relevant' }]), /unknown verdict/)
})

test('N6: Wilson bounds stay inside [0,1] and are ordered', () => {
  assert.deepEqual(wilson95(0, 10), [0, 0.278])
  assert.deepEqual(wilson95(10, 10), [0.722, 1])
  assert.equal(wilson95(0, 0), null)
  const [low, high] = wilson95(3, 12) as [number, number]
  assert.ok(low >= 0 && high <= 1 && low < high)
})

test('the review sample is deterministic, content-blind and independent of input order', () => {
  const numbers = Array.from({ length: 100 }, (_, index) => index + 1)
  const first = manualReviewSample(numbers, { seed: 20261102, size: 20 })
  const second = manualReviewSample([...numbers].reverse(), { seed: 20261102, size: 20 })
  assert.equal(first.length, 20)
  assert.deepEqual(first, second)
  assert.deepEqual(manualReviewSample(numbers, { seed: 20261102, size: 20 }), first)
  assert.notDeepEqual(manualReviewSample(numbers, { seed: 20261103, size: 20 }), first)
})

test('agreement is exact on both fields, and a review outside the sample is refused', () => {
  const rows = [
    { number: 1, layer: 'admission', verdict: 'answerable' },
    { number: 2, layer: 'runtime', verdict: 'partially-answerable' },
  ]
  const agreement = reviewAgreement(rows, [
    { number: 1, layer: 'admission', verdict: 'answerable' },
    { number: 2, layer: 'composition', verdict: 'partially-answerable', why: 'reads as a collision' },
  ])
  assert.equal(agreement.total, 2)
  assert.equal(agreement.agree, 1)
  assert.equal(agreement.agreement, 0.5)
  assert.equal(agreement.disagreements.length, 1)
  assert.equal(agreement.disagreements[0]?.why, 'reads as a collision')
  assert.throws(() => reviewAgreement(rows, [{ number: 99, layer: 'admission', verdict: 'answerable' }]), /not in the sample/)
})

test('N8: an incomplete census is refused; a pilot is labelled instead of pretending', () => {
  assert.equal(assertComplete({ total_count: 10, fetched: 9 }).ok, false)
  assert.equal(assertComplete({ total_count: 10, fetched: 10 }).ok, true)
  assert.equal(assertComplete({ total_count: 0, fetched: 0 }).ok, true)
  const pilot = assertComplete({ total_count: 100, fetched: 20, pilot: true })
  assert.equal(pilot.ok, true)
  assert.match(pilot.detail, /pilot/)
})

test('the README formats come from one place', () => {
  assert.equal(formatPercent(0.1234), '12.3%')
  assert.equal(formatPercent(null), null)
  assert.equal(formatInterval([0.108, 0.14]), '10.8–14.0%')
  assert.equal(formatInterval(null), null)
})

test('a projection keeps enough of the matched text to audit the layer choice', () => {
  const snippets = signalSnippets('升级到 0.2.1-rc.5 之后插件不见了，peer 不兼容', 3)
  assert.ok(snippets.length > 0)
  assert.ok(snippets.every((entry) => entry.snippet.length > 0))
})

test('a home path in a title is redacted before it reaches the SSOT', () => {
  assert.equal(scrubHomePaths('/home/alice/project/file.log'), '/home/<user>/project/file.log')
  assert.equal(scrubHomePaths('C:\\Users\\alice\\project'), 'C:\\Users\\<user>\\project')
  // The false positive that forced this: a UI bug title mentioning 方向键/Home/End/Enter.
  assert.ok(!/\/home\/[a-z0-9._-]+\//i.test(scrubHomePaths('方向键/Home/End/Enter')))
})
