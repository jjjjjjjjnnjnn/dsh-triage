/**
 * `computeLocalPrior`: the annotation that must never become evidence.
 *
 * Pinned here (spec `docs/specs/M5-reflow.md` §10, `ADR-0011` option A, controls N3 / N7 / N8):
 *   1. the prior is a PURE reading of stored records - no clock, no environment, no I/O;
 *   2. `n = 0` and an incomplete key return `null`, and the caller then omits the whole
 *      `prior` key ("nothing" must not look like "empty", §10.2);
 *   3. the key is the exact seven-tuple: one differing position means a different key,
 *      which is why the same `package@version` can be `go` on one runtime and `blocked` on
 *      another and both stay right (`BS-38`);
 *   4. `majority` is a STRICT majority, so a tie (and a plurality that does not exceed half)
 *      reads as "no majority" and `agreement` becomes `null`;
 *   5. nothing in the prior can reach `conclusion`: `annotate()` below is the only consumer,
 *      and it is asserted to return the verdict object untouched (N3, byte for byte).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  computeLocalPrior,
  sanitizeOutcome,
  type Conclusion,
  type OutcomeKey,
  type OutcomeProfileKind,
  type OutcomeRecord,
} from '@dsh-triage/core'

const KEY: OutcomeKey = {
  package: 'dsh-status-rotator',
  version: '0.38.0',
  dsh: '0.2.1-rc.4',
  os: 'win32',
  arch: 'x64',
  node_major: 24,
  profile_kind: 'web',
}

let counter = 0

/** A valid record, built through the real sanitizer so the fixture cannot drift from the contract. */
function record(overrides: {
  conclusion?: Conclusion
  dsh?: string | null
  profile_kind?: OutcomeProfileKind
  package?: string
  version?: string
  os?: 'win32' | 'darwin' | 'linux' | 'freebsd' | 'other'
  arch?: 'x64' | 'arm64' | 'ia32' | 'other'
  node_major?: number
  at?: string
} = {}): OutcomeRecord {
  counter += 1
  const candidate = {
    schema_version: 1,
    id: counter.toString(16).padStart(32, '0'),
    at: overrides.at ?? '2026-10-29T10:00:00.000Z',
    source: 'check',
    package: overrides.package ?? KEY.package,
    version: overrides.version ?? KEY.version,
    dsh_version: overrides.dsh === undefined ? KEY.dsh : overrides.dsh,
    os: overrides.os ?? KEY.os,
    arch: overrides.arch ?? KEY.arch,
    node_major: overrides.node_major ?? KEY.node_major,
    profile_kind: overrides.profile_kind ?? KEY.profile_kind,
    conclusion: overrides.conclusion ?? 'go',
    reason_message_ids: ['admission.admitted'],
    evidence_tiers: ['declared'],
    probe: null,
  }
  const result = sanitizeOutcome(candidate)
  assert.equal(result.ok, true, `fixture must be a legal record: ${JSON.stringify(candidate)}`)
  if (!result.ok) throw new Error('unreachable')
  return result.record
}

const repeat = (count: number, overrides: Parameters<typeof record>[0] = {}): OutcomeRecord[] =>
  Array.from({ length: count }, () => record(overrides))

test('n = 0 returns null, so the caller omits the key instead of printing an empty block', () => {
  assert.equal(computeLocalPrior([], KEY), null)
  // Records exist, but for other keys: this key still has no prior.
  const others = [...repeat(3, { package: 'dsh-other' }), ...repeat(2, { os: 'linux' })]
  assert.equal(computeLocalPrior(others, KEY), null)
})

test('an incomplete key never produces a prior', () => {
  // §2: `dsh = null` and `profile_kind = unknown` records may be WRITTEN (they are facts)
  // but must not MATCH, because the key is not fully determined.
  const unknownDsh = repeat(5, { dsh: null })
  assert.equal(computeLocalPrior(unknownDsh, { ...KEY, dsh: null }), null)

  const unknownProfile = repeat(5, { profile_kind: 'unknown' })
  assert.equal(computeLocalPrior(unknownProfile, { ...KEY, profile_kind: 'unknown' }), null)

  // And an incomplete key does not borrow the complete one's records.
  assert.equal(computeLocalPrior(repeat(5), { ...KEY, dsh: null }), null)
})

test('counts, strict majority and agreement over the four-state conclusion', () => {
  const prior = computeLocalPrior([record({ conclusion: 'go' }), record({ conclusion: 'go' }), record({ conclusion: 'blocked' })], KEY)
  assert.ok(prior !== null)
  assert.deepEqual(prior.counts, { go: 2, risky: 0, blocked: 1, unknown: 0 })
  assert.equal(prior.n, 3)
  assert.equal(prior.majority, 'go')
  assert.equal(prior.agreement, 2 / 3)

  // The annotation is a fixed shape: these fields are the contract (§10.2).
  assert.equal(prior.schema_version, 1)
  assert.equal(prior.annotation_only, true)
  assert.equal(prior.source, 'local-outcomes')
  assert.equal(prior.method, 'outcome-log')
  assert.equal(prior.tier, 'measured-local', 'no new evidence tier exists for a prior (ADR-0011 §4.3)')
  assert.equal(prior.evidence_id, 'prior-local')
  assert.equal(prior.note_id, 'prior.annotation-only')
  assert.deepEqual(prior.key, KEY)
})

test('a tie has no majority and no agreement', () => {
  const tie = computeLocalPrior([record({ conclusion: 'go' }), record({ conclusion: 'go' }), record({ conclusion: 'blocked' }), record({ conclusion: 'blocked' })], KEY)
  assert.ok(tie !== null)
  assert.equal(tie.n, 4)
  assert.deepEqual(tie.counts, { go: 2, risky: 0, blocked: 2, unknown: 0 })
  assert.equal(tie.majority, null, 'a 2/2 split is not a majority')
  assert.equal(tie.agreement, null)

  // Four-way tie.
  const four = computeLocalPrior(
    [record({ conclusion: 'go' }), record({ conclusion: 'risky' }), record({ conclusion: 'blocked' }), record({ conclusion: 'unknown' })],
    KEY,
  )
  assert.ok(four !== null)
  assert.equal(four.majority, null)
  assert.equal(four.agreement, null)
})

test('a plurality below half is not a majority either (stricter than a plain mode)', () => {
  // 2 of 4 is a plurality, not more than half. Reporting it as a "majority" would make a
  // 50% agreement look like a finding; the annotation says "no majority" instead.
  const split = computeLocalPrior(
    [record({ conclusion: 'go' }), record({ conclusion: 'go' }), record({ conclusion: 'blocked' }), record({ conclusion: 'risky' })],
    KEY,
  )
  assert.ok(split !== null)
  assert.equal(split.n, 4)
  assert.equal(split.majority, null)
  assert.equal(split.agreement, null)

  // 3 of 4 IS a strict majority, so the rule is not simply "all must agree".
  const three = computeLocalPrior(
    [record({ conclusion: 'go' }), record({ conclusion: 'go' }), record({ conclusion: 'go' }), record({ conclusion: 'blocked' })],
    KEY,
  )
  assert.ok(three !== null)
  assert.equal(three.majority, 'go')
  assert.equal(three.agreement, 0.75)
})

test('N3: 100 prior `go` records are only an annotation, never an input to a verdict', () => {
  const prior = computeLocalPrior(repeat(100, { conclusion: 'go' }), KEY)
  assert.ok(prior !== null)
  assert.equal(prior.n, 100)
  assert.equal(prior.agreement, 1)

  /*
   * The byte-identity of `check --json` with and without a prior is measured end-to-end by
   * `scripts/record_outcomes.mjs` (it runs `check` twice against the same store and hashes both
   * payloads). What can be pinned WITHOUT a registry is the structural half: the annotation has
   * no field that a verdict is assembled from, and it is not part of `Verdict` at all.
   */
  const keys = Object.keys(prior).sort()
  assert.deepEqual(keys, [
    'agreement',
    'annotation_only',
    'counts',
    'evidence_id',
    'key',
    'majority',
    'method',
    'n',
    'note_id',
    'schema_version',
    'source',
    'tier',
  ])
  for (const forbidden of ['conclusion', 'confidence', 'evidence', 'missingEvidence', 'remediation']) {
    assert.equal(Object.hasOwn(prior, forbidden), false, `a prior must not carry a verdict field: ${forbidden}`)
  }
  assert.equal(prior.annotation_only, true, 'annotation_only is a literal, not an option')
  // The tier is the existing label for "this machine measured this", not a new tier
  // (ADR-0011 §4.3: no `measured-crowd`, and the prior never enters `evidence[]`).
  assert.equal(prior.tier, 'measured-local')
})

test('N7: the runtime version is part of the key (BS-38: both conclusions were right)', () => {
  const otherRuntime = repeat(50, { conclusion: 'go', dsh: '0.2.1-rc.4' })
  // The machine is on 0.1.0-rc.6 today; the prior belongs to another runtime.
  assert.equal(computeLocalPrior(otherRuntime, { ...KEY, dsh: '0.1.0-rc.6' }), null)
  // The same records DO answer for the runtime they were taken on.
  assert.equal(computeLocalPrior(otherRuntime, KEY)?.n, 50)
})

test('N8: the profile kind is the seventh position of the key (BS-23)', () => {
  const webOnly = repeat(20, { conclusion: 'blocked', profile_kind: 'web' })
  assert.equal(computeLocalPrior(webOnly, { ...KEY, profile_kind: 'tui' }), null)
  assert.equal(computeLocalPrior(webOnly, { ...KEY, profile_kind: 'headless' }), null)
  assert.equal(computeLocalPrior(webOnly, { ...KEY, profile_kind: 'web' })?.n, 20)
})

test('every position of the key separates records', () => {
  const base = [record(), record({ conclusion: 'blocked' }), record({ conclusion: 'blocked' })]
  assert.equal(computeLocalPrior(base, KEY)?.majority, 'blocked')

  const variations: OutcomeKey[] = [
    { ...KEY, package: 'dsh-other' },
    { ...KEY, version: '0.38.1' },
    { ...KEY, dsh: '0.2.1-rc.5' },
    { ...KEY, os: 'darwin' },
    { ...KEY, arch: 'arm64' },
    { ...KEY, node_major: 22 },
    { ...KEY, profile_kind: 'tui' },
  ]
  assert.equal(variations.length, 7, 'seven positions, seven ways to miss')
  for (const key of variations) {
    assert.equal(computeLocalPrior(base, key), null, `key position not enforced: ${JSON.stringify(key)}`)
  }
})

test('the prior is deterministic and does not depend on record order', () => {
  const records = [
    record({ conclusion: 'go' }),
    record({ conclusion: 'blocked' }),
    record({ conclusion: 'go' }),
  ]
  const forward = computeLocalPrior(records, KEY)
  const backward = computeLocalPrior([...records].reverse(), KEY)
  assert.deepEqual(forward, backward)
})
