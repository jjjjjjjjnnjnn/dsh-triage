/**
 * `sanitizeOutcome` / `assertOutcomeLine`: 0 PII has to be *executed*, not declared.
 *
 * Pinned here (spec `docs/specs/M5-reflow.md` §5 and negative controls N2 / N9):
 *   1. a whitelist projection that rejects the WHOLE record on one extra key - silently
 *      dropping `profileDir` would leave the leak path in the caller forever (N2);
 *   2. a forbidden-shape scan that catches a real home path / UNC path / `file://` URL /
 *      credential-shaped string, including inside the array fields;
 *   3. the 1024-byte line cap, which is what makes a 2000-character log tail impossible
 *      even before the field whitelist is consulted (N9, both routes);
 *   4. determinism: no clock, no randomness, no environment read - the `id` and `at`
 *      come from the caller, exactly like `generatedAt` in `verdict.ts`.
 *
 * Every assertion below names the exact rejection reason AND field, so a sanitizer that
 * starts rejecting the wrong thing cannot pass by being "safely red".
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sanitizeOutcome, assertOutcomeLine, MAX_OUTCOME_BYTES } from '@dsh-triage/core'

/** A record that is legal in every field; each case below breaks exactly one thing. */
function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    id: '9f2c1e7ab34d05f68c1d2e3a4b5c6d7e',
    at: '2026-10-29T10:00:00.000Z',
    source: 'check',
    package: 'dsh-status-rotator',
    version: '0.38.0',
    dsh_version: '0.2.1-rc.4',
    os: 'win32',
    arch: 'x64',
    node_major: 24,
    profile_kind: 'web',
    conclusion: 'go',
    reason_message_ids: ['admission.admitted', 'admission.declared-only'],
    evidence_tiers: ['declared', 'measured-local'],
    probe: null,
    ...overrides,
  }
}

function rejected(input: unknown): { reason: string; field: string | null } {
  const result = sanitizeOutcome(input)
  assert.equal(result.ok, false, `expected a rejection, got ${JSON.stringify(result)}`)
  if (result.ok) throw new Error('unreachable')
  return { reason: result.reason, field: result.field }
}

test('the reference record is accepted and its bytes are re-serializable', () => {
  const result = sanitizeOutcome(valid())
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.record.schema_version, 1)
  assert.equal(result.record.package, 'dsh-status-rotator')
  assert.deepEqual(result.record.reason_message_ids, ['admission.admitted', 'admission.declared-only'])
  // Round-trip: what we hand to disk parses back into the same object.
  const again = sanitizeOutcome(JSON.parse(JSON.stringify(result.record)))
  assert.equal(again.ok, true)
})

/**
 * Credential-shaped strings are built at runtime on purpose: a literal `sk-…` in this file would
 * trip the repository's own `no-credentials` scan (`scripts/gate_governance.mjs`), and weakening
 * that scan to accommodate a test would be exactly backwards.
 */
const OPENAI_SHAPED = `sk-${'a'.repeat(24)}`
const GITHUB_SHAPED = `ghp_${'a'.repeat(24)}`
const NPM_SHAPED = `npm_${'a'.repeat(24)}`

test('N2: one extra key rejects the whole record instead of being dropped', () => {
  // The path is a real home-shaped profile dir: the exact thing R3 A1 / R14 F-2 leaked.
  const withPath = valid({ profileDir: 'C:\\Users\\someone\\.dsh\\profiles\\web' })
  assert.deepEqual(rejected(withPath), { reason: 'unknown-field', field: 'profileDir' })

  // A plausible-but-unlisted field is treated the same way: there is no "harmless extra".
  assert.deepEqual(rejected(valid({ hostname: 'lab-machine' })), { reason: 'unknown-field', field: 'hostname' })
  assert.deepEqual(rejected(valid({ error_tail: 'npm ERR! ...' })), { reason: 'unknown-field', field: 'error_tail' })
  // A nested unknown key is named with its parent, so the fix is obvious.
  assert.deepEqual(
    rejected(valid({ source: 'probe', probe: { total_ms_bucket: 'lt5s', boot_ms_bucket: 'lt5s', samples: 3 } })),
    { reason: 'unknown-field', field: 'probe.samples' },
  )
})

/** Twelve message ids that satisfy the grammar, the count cap and the sort order, but add up to >1024 bytes. */
function oversizedIds(): string[] {
  return Array.from(
    { length: 12 },
    (_unused, index) => `admission.${'a'.repeat(80)}${String(index).padStart(2, '0')}`,
  )
}

test('N9: a 2000-character log tail cannot get in through any field', () => {
  const tail = `npm ERR! ${'x'.repeat(2000)}`

  // Route 1 — value-shape: free text in a field that has a closed grammar.
  assert.deepEqual(rejected(valid({ package: tail })), { reason: 'value-shape', field: 'package' })
  assert.deepEqual(rejected(valid({ conclusion: tail })), { reason: 'value-shape', field: 'conclusion' })
  assert.deepEqual(rejected(valid({ reason_message_ids: [tail] })), {
    reason: 'value-shape',
    field: 'reason_message_ids',
  })
  // A padded-but-still-semver-shaped version dies on the 64-character field cap, not on the line cap.
  assert.deepEqual(rejected(valid({ version: `1.0.0-${'a'.repeat(700)}` })), {
    reason: 'value-shape',
    field: 'version',
  })

  // Route 2 — too-long: a record that passes every domain check and is simply too big.
  assert.deepEqual(rejected(valid({ reason_message_ids: oversizedIds() })), { reason: 'too-long', field: null })

  // The cap is a BYTE cap, not a character cap: multi-byte text is not free (and here the
  // non-ASCII text is already refused by the message-id grammar).
  assert.deepEqual(rejected(valid({ reason_message_ids: [`admission.${'亚'.repeat(400)}`] })), {
    reason: 'value-shape',
    field: 'reason_message_ids',
  })
  assert.equal(MAX_OUTCOME_BYTES, 1024)
})

test('the 1024-byte cap is measured on the serialized line, not on a field', () => {
  // Guard against the cap going vacuous: a smaller set of the same ids is accepted.
  const under = oversizedIds().slice(0, 4)
  const accepted = sanitizeOutcome(valid({ reason_message_ids: under }))
  assert.equal(accepted.ok, true)
  if (!accepted.ok) return
  assert.ok(new TextEncoder().encode(JSON.stringify(accepted.record)).length <= MAX_OUTCOME_BYTES)
  assert.deepEqual(rejected(valid({ reason_message_ids: oversizedIds() })), { reason: 'too-long', field: null })
})

test('hostile matrix: every shape of PII is refused with an exact reason', () => {
  const cases: Array<[string, unknown, { reason: string; field: string | null }]> = [
    ['not an object', 'a string', { reason: 'not-an-object', field: null }],
    ['an array', [], { reason: 'not-an-object', field: null }],
    ['null', null, { reason: 'not-an-object', field: null }],
    ['schema_version 2', valid({ schema_version: 2 }), { reason: 'value-shape', field: 'schema_version' }],
    ['id not hex', valid({ id: 'ZZZZ' }), { reason: 'value-shape', field: 'id' }],
    ['id uppercase hex', valid({ id: '9F2C1E7AB34D05F68C1D2E3A4B5C6D7E' }), { reason: 'value-shape', field: 'id' }],
    ['id 31 chars', valid({ id: 'a'.repeat(31) }), { reason: 'value-shape', field: 'id' }],
    ['id 33 chars', valid({ id: 'a'.repeat(33) }), { reason: 'value-shape', field: 'id' }],
    ['at without millis', valid({ at: '2026-10-29T10:00:00Z' }), { reason: 'bad-timestamp', field: 'at' }],
    ['at with an offset', valid({ at: '2026-10-29T10:00:00.000+02:00' }), { reason: 'bad-timestamp', field: 'at' }],
    ['at local date only', valid({ at: '2026-10-29' }), { reason: 'bad-timestamp', field: 'at' }],
    ['source prose', valid({ source: 'declaration' }), { reason: 'value-shape', field: 'source' }],
    ['package with uppercase', valid({ package: 'DSH-Status' }), { reason: 'value-shape', field: 'package' }],
    ['package with a space', valid({ package: 'dsh status' }), { reason: 'value-shape', field: 'package' }],
    ['package too long', valid({ package: `a${'b'.repeat(214)}` }), { reason: 'value-shape', field: 'package' }],
    ['version is a range', valid({ version: '^0.38.0' }), { reason: 'value-shape', field: 'version' }],
    ['version latest', valid({ version: 'latest' }), { reason: 'value-shape', field: 'version' }],
    ['version with build metadata', valid({ version: '0.38.0+build.7' }), { reason: 'value-shape', field: 'version' }],
    ['dsh_version prose', valid({ dsh_version: '0.2.1-rc.4 (patched)' }), { reason: 'value-shape', field: 'dsh_version' }],
    ['os onboarding', valid({ os: 'windows' }), { reason: 'value-shape', field: 'os' }],
    ['arch unknown', valid({ arch: 's390x' }), { reason: 'value-shape', field: 'arch' }],
    ['node_major as a string', valid({ node_major: '24' }), { reason: 'value-shape', field: 'node_major' }],
    ['node_major out of range', valid({ node_major: 12 }), { reason: 'value-shape', field: 'node_major' }],
    ['node_major fractional', valid({ node_major: 24.5 }), { reason: 'value-shape', field: 'node_major' }],
    ['profile_kind mobile', valid({ profile_kind: 'mobile' }), { reason: 'value-shape', field: 'profile_kind' }],
    ['conclusion passed', valid({ conclusion: 'passed' }), { reason: 'value-shape', field: 'conclusion' }],
    [
      '13 message ids',
      valid({ reason_message_ids: Array.from({ length: 13 }, (_u, i) => `probe.row-missing.${i}`) }),
      { reason: 'value-shape', field: 'reason_message_ids' },
    ],
    [
      'unsorted message ids',
      valid({ reason_message_ids: ['probe.served', 'admission.admitted'] }),
      { reason: 'value-shape', field: 'reason_message_ids' },
    ],
    [
      'duplicate message ids',
      valid({ reason_message_ids: ['probe.served', 'probe.served'] }),
      { reason: 'value-shape', field: 'reason_message_ids' },
    ],
    [
      'message id outside the namespace',
      valid({ reason_message_ids: ['error.something'] }),
      { reason: 'value-shape', field: 'reason_message_ids' },
    ],
    ['evidence tier invented', valid({ evidence_tiers: ['measured-crowd'] }), { reason: 'value-shape', field: 'evidence_tiers' }],
    ['probe on a check record', valid({ probe: { total_ms_bucket: 'lt5s', boot_ms_bucket: null } }), { reason: 'value-shape', field: 'probe' }],
    [
      'probe bucket in millis',
      valid({ source: 'probe', probe: { total_ms_bucket: 4210, boot_ms_bucket: null } }),
      { reason: 'value-shape', field: 'probe.total_ms_bucket' },
    ],
    // Forbidden shapes, injected into fields whose grammar would otherwise accept them.
    ['openai key in version', valid({ version: `1.0.0-${OPENAI_SHAPED}` }), { reason: 'value-shape', field: 'version' }],
    // Grammar-first: these shapes are ALSO paths/tokens, but the field grammar already
    // refuses them, so the forbidden-shape scan never has to fire. Both lines are kept
    // because "rejected, and by which rule" is the contract, not just "rejected".
    ['home path in a reason id', valid({ reason_message_ids: ['admission.C:/Users/x'] }), { reason: 'value-shape', field: 'reason_message_ids' }],
    ['file url in dsh_version', valid({ dsh_version: 'file:///C:/x/0.2.1' }), { reason: 'value-shape', field: 'dsh_version' }],
    ['posix home in version', valid({ version: '1.0.0-/home/someone' }), { reason: 'value-shape', field: 'version' }],
    ['tilde path in version', valid({ version: '1.0.0-~/.dsh' }), { reason: 'value-shape', field: 'version' }],
    ['unc path in version', valid({ version: '1.0.0-\\\\server\\share' }), { reason: 'value-shape', field: 'version' }],
    ['github token in version', valid({ version: `1.0.0-${GITHUB_SHAPED}` }), { reason: 'value-shape', field: 'version' }],
    ['npm token in version', valid({ version: `1.0.0-${NPM_SHAPED}` }), { reason: 'value-shape', field: 'version' }],
    ['token= in version', valid({ version: '1.0.0-token=x' }), { reason: 'value-shape', field: 'version' }],
  ]

  for (const [label, input, expected] of cases) {
    assert.deepEqual(rejected(input), expected, label)
  }
})

test('a scoped package name is legal: the path patterns need path context', () => {
  const result = sanitizeOutcome(valid({ package: '@michengai/dsh-archive-manager' }))
  assert.equal(result.ok, true, 'a bare `/` inside a scope is not a path')
  if (!result.ok) return
  assert.equal(result.record.package, '@michengai/dsh-archive-manager')
})

test('the two whitespace-shaped patterns are defence in depth, not reachable through this schema', () => {
  /*
   * `/bearer\s/i` and `/token=/i` cannot fire on any CURRENT field, because every accepted value
   * is whitespace-free (semver, message id, enum, 32 hex, ISO timestamp) - a value carrying
   * whitespace is already refused by the field grammar. They stay in the scan as the second line
   * for a future field; this test records WHY they are not in the hostile matrix above, so a
   * reader does not mistake the gap for a missing assertion.
   */
  assert.equal(sanitizeOutcome(valid({ version: '1.0.0-bearer.x' })).ok, true)
  // The credential-shaped part is what matters, and it is still refused - by the grammar here.
  assert.deepEqual(rejected(valid({ version: '1.0.0-Bearer token' })), { reason: 'value-shape', field: 'version' })
  assert.deepEqual(rejected(valid({ version: '1.0.0-token=x' })), { reason: 'value-shape', field: 'version' })
})

test('a probe record carries buckets only, never milliseconds', () => {
  const ok = sanitizeOutcome(
    valid({
      source: 'probe',
      probe: { total_ms_bucket: '5to20s', boot_ms_bucket: '5to20s' },
    }),
  )
  assert.equal(ok.ok, true)
  if (!ok.ok) return
  assert.deepEqual(ok.record.probe, { total_ms_bucket: '5to20s', boot_ms_bucket: '5to20s' })

  // Non-web surface: no boot bucket at all.
  const tui = sanitizeOutcome(
    valid({ source: 'probe', profile_kind: 'tui', probe: { total_ms_bucket: 'gte60s', boot_ms_bucket: null } }),
  )
  assert.equal(tui.ok, true)
})

test('`dsh_version: null` is a fact, not a malformed record', () => {
  const result = sanitizeOutcome(valid({ dsh_version: null }))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.record.dsh_version, null)
})

test('assertOutcomeLine refuses what JSON.parse alone would accept', () => {
  const good = JSON.stringify(valid())
  const ok = assertOutcomeLine(good)
  assert.equal(ok.ok, true)

  assert.deepEqual(pick(assertOutcomeLine('')), { reason: 'not-json', field: null })
  assert.deepEqual(pick(assertOutcomeLine('   ')), { reason: 'not-json', field: null })
  assert.deepEqual(pick(assertOutcomeLine('{not json')), { reason: 'not-json', field: null })
  assert.deepEqual(pick(assertOutcomeLine('null')), { reason: 'not-an-object', field: null })
  assert.deepEqual(pick(assertOutcomeLine('[1,2]')), { reason: 'not-an-object', field: null })
  // A hand-edited line that gained a key is a rejected line, not a repaired record.
  const polluted = JSON.stringify({ ...valid(), profileDir: 'C:\\Users\\someone\\.dsh' })
  assert.deepEqual(pick(assertOutcomeLine(polluted)), { reason: 'unknown-field', field: 'profileDir' })
})

test('the sanitizer is deterministic and never reads a clock', () => {
  const input = valid()
  const first = sanitizeOutcome(input)
  const second = sanitizeOutcome(input)
  assert.deepEqual(first, second)
  const at = first.ok ? first.record.at : null
  assert.equal(at, '2026-10-29T10:00:00.000Z', 'the caller owns `at`; the sanitizer must not rewrite it')
  // The same bytes in a different key order still produce the same assembled record.
  const reordered = Object.fromEntries(Object.entries(input).reverse())
  assert.deepEqual(sanitizeOutcome(reordered), first)
})

function pick(
  result: ReturnType<typeof assertOutcomeLine>,
): { reason: string; field: string | null } {
  if (result.ok) throw new Error('expected a rejection')
  return { reason: result.reason, field: result.field }
}
