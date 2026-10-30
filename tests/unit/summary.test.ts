/**
 * The one-screen summary (R49).
 *
 * These tests pin the *projection*: given an `AuditData`, what does the user read first, in
 * what order, and — the point of the round — does it ever turn "I could not look" into
 * "nothing is wrong". A summary that lies is worse than the 162-line ledger it replaced.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EntryClaim, EnvFingerprint, Verdict } from '../../packages/core/dist/index.js'
import type { AuditData } from '../../packages/plugin/dist/audit-data.js'
import { buildProfileSummary, formatProfileSummary } from '../../packages/plugin/dist/summary.js'

const ENV: EnvFingerprint = {
  dsh: '0.1.0-rc.6',
  node: 'v24.15.0',
  platform: 'win32',
  arch: 'x64',
  profile: 'web',
  profileDir: '~/.dsh/profiles/web',
  bundles: ['@deepseek-ai/dsh-base'],
  installed: [],
}

function claim(id: string): EntryClaim {
  return { id, name: `@deepseek-ai/${id}`, disabled: false, group: false, source: 'profile:web#patch', depth: 0 }
}

function verdict(
  name: string,
  conclusion: Verdict['conclusion'],
  options: { reasons?: Verdict['reasons']; remediation?: Verdict['remediation'] } = {},
): Verdict {
  return {
    schemaVersion: 1,
    subject: { name, version: null, kind: 'entry' },
    env: ENV,
    conclusion,
    confidence: { level: 'medium', basis: 'declared' },
    reasons: options.reasons ?? [],
    evidence: [],
    remediation: options.remediation ?? [],
    missingEvidence: conclusion === 'unknown' ? ['missing.row-module'] : [],
    generatedAt: '2026-10-30T00:00:00.000Z',
  }
}

function data(overrides: Partial<AuditData> = {}): AuditData {
  return {
    env: ENV,
    claims: [],
    grouped: new Map(),
    collisions: [],
    artifacts: [],
    duplicates: [],
    duplicateFindings: [],
    rows: [],
    rowVerdicts: [],
    presetDeclarations: [],
    snapshot: null,
    inventoryVerdicts: [],
    diff: { missing: [], undeclared: [], ambiguous: [] },
    declared: [],
    errors: [],
    ...overrides,
  }
}

/* ------------------------------ honesty rules ------------------------------ */

test('an empty composition is not a clean one', () => {
  const summary = buildProfileSummary(data(), { locale: 'zh' })
  assert.equal(summary.tone, 'attention', 'zero rows must never render as "ok"')
  assert.match(summary.headline, /没有读到任何行/)
  assert.equal(summary.counts.rows, 0)
})

test('rows and judged are different numbers, and the summary says which is which', () => {
  const claims = Array.from({ length: 156 }, (_, index) => claim(`row-${index}`))
  const summary = buildProfileSummary(
    data({
      claims,
      rowVerdicts: [verdict('hmr', 'unknown', { reasons: [{ code: 'missing.row-module', severity: 'warn', messageId: 'admission.unconstrained' }] })],
    }),
    { locale: 'zh' },
  )
  assert.equal(summary.counts.rows, 156, 'the denominator a user expects')
  assert.equal(summary.counts.judged, 1, 'only rows that declared a DSH range were judged')
  const text = formatProfileSummary(summary, { locale: 'zh', env: ENV })
  assert.match(text, /156 行（1 行有判定）/)
  assert.match(text, /其余 155 行不声明任何 DSH 区间/, 'silence is not a pass, and the text says so')
})

/* --------------------------------- tones ---------------------------------- */

test('a denied row is "broken", and its remediation command is carried verbatim', () => {
  const summary = buildProfileSummary(
    data({
      claims: [claim('llm-pi-ai')],
      rowVerdicts: [
        verdict('llm-pi-ai', 'blocked', {
          reasons: [{ code: 'admission-denied-engines', severity: 'block', messageId: 'admission.denied', params: { runtime: '0.1.0-rc.6' } }],
          remediation: [{ kind: 'allow-version', command: 'dsh plugin allow llm-pi-ai', note: 'allow this engine' }],
        }),
      ],
    }),
    { locale: 'zh' },
  )
  assert.equal(summary.tone, 'broken')
  assert.match(summary.headline, /有 1 处真的坏了/)
  assert.equal(summary.issues[0]?.kind, 'denied')
  assert.equal(summary.issues[0]?.fix, 'dsh plugin allow llm-pi-ai')
  assert.match(summary.issues[0]?.line ?? '', /0\.1\.0-rc\.6/, 'the localized reason is rendered, not the code')
})

test('an entry-id collision outranks a duplicate copy, which outranks "cannot tell"', () => {
  const summary = buildProfileSummary(
    data({
      claims: [claim('a'), claim('b'), claim('c')],
      collisions: [{ id: 'llm', kind: 'conflicting-definitions', owners: ['@x/one', '@y/two'], count: 2, names: ['@x/one', '@y/two'] }],
      duplicateFindings: [
        { name: '@deepseek-ai/dsh-llm', kind: 'different-versions', copies: [{ path: 'profiles/web/node_modules', version: '1.0.0', scope: 'profile' }, { path: 'profiles/node_modules', version: '2.0.0', scope: 'shared' }] },
      ],
      rowVerdicts: [verdict('hmr', 'unknown')],
    }),
    { locale: 'zh', limit: 10 },
  )
  assert.deepEqual(
    summary.issues.map((issue) => issue.kind),
    ['collision', 'duplicate', 'unknown'],
    'users act top-down: broken > may-not-boot > warning > cannot-tell',
  )
  assert.equal(summary.tone, 'broken')
  assert.match(summary.issues[0]?.line ?? '', /@x\/one, @y\/two/)
  assert.match(summary.issues[1]?.line ?? '', /1\.0\.0 \/ 2\.0\.0/)
})

test('unknown rows alone are "attention", not "broken"', () => {
  const summary = buildProfileSummary(data({ claims: [claim('hmr')], rowVerdicts: [verdict('hmr', 'unknown')] }), { locale: 'zh' })
  assert.equal(summary.tone, 'attention')
  assert.match(summary.headline, /缺少证据/)
  assert.equal(summary.issues[0]?.kind, 'unknown')
})

test('a profile read error is surfaced, never swallowed', () => {
  const summary = buildProfileSummary(data({ errors: ['patch ./cordis.patch.yml could not be parsed'] }), { locale: 'zh' })
  assert.equal(summary.tone, 'attention')
  assert.equal(summary.issues[0]?.kind, 'unreadable')
  assert.match(summary.issues[0]?.line ?? '', /could not be parsed/)
})

/* ------------------------------ the cap ----------------------------------- */

test('the summary is capped and says how many it left out', () => {
  const claims = Array.from({ length: 9 }, (_, index) => claim(`row-${index}`))
  const rowVerdicts = claims.map((item) => verdict(item.id, 'unknown'))
  const summary = buildProfileSummary(data({ claims, rowVerdicts }), { locale: 'zh', limit: 3 })
  assert.equal(summary.issues.length, 3)
  assert.equal(summary.more, 6)
  const text = formatProfileSummary(summary, { locale: 'zh', env: ENV })
  assert.match(text, /… 6 条未显示/)
})

test('the cap does not change the counts or the tone', () => {
  const claims = Array.from({ length: 9 }, (_, index) => claim(`row-${index}`))
  const rowVerdicts = claims.map((item) => verdict(item.id, 'unknown'))
  const small = buildProfileSummary(data({ claims, rowVerdicts }), { locale: 'zh', limit: 1 })
  const large = buildProfileSummary(data({ claims, rowVerdicts }), { locale: 'zh', limit: 99 })
  assert.deepEqual(small.counts, large.counts)
  assert.equal(small.tone, large.tone)
})

/* ----------------------------- determinism -------------------------------- */

test('the same data yields byte-identical output (the summary is a pure function)', () => {
  const build = (): AuditData =>
    data({
      claims: [claim('a'), claim('b')],
      rowVerdicts: [verdict('a', 'blocked'), verdict('b', 'unknown')],
    })
  const left = formatProfileSummary(buildProfileSummary(build(), { locale: 'zh' }), { locale: 'zh', env: ENV })
  const right = formatProfileSummary(buildProfileSummary(build(), { locale: 'zh' }), { locale: 'zh', env: ENV })
  assert.equal(left, right)
})

test('both locales are complete: no template placeholder leaks into the text', () => {
  for (const locale of ['zh', 'en'] as const) {
    const text = formatProfileSummary(
      buildProfileSummary(data({ claims: [claim('a')], rowVerdicts: [verdict('a', 'blocked')] }), { locale }),
      { locale, env: ENV },
    )
    assert.doesNotMatch(text, /\{(n|rows|judged|go|denied|unknown|collisions|owners|versions)\}/, `${locale} left a placeholder`)
  }
})

/* --------------------------- plain language (R49b) ------------------------- */

test('the plain sentence never contradicts the tone', () => {
  const cases = [
    { data: data({ claims: [claim('a')], rowVerdicts: [verdict('a', 'go')] }), forbidden: /break|坏|消失|判断不了/ },
    { data: data({ claims: [claim('a')], rowVerdicts: [verdict('a', 'unknown')] }), forbidden: /All good|一切正常/ },
    { data: data({ claims: [claim('a')], rowVerdicts: [verdict('a', 'blocked')] }), forbidden: /All good|一切正常|nothing needs fixing/ },
    { data: data(), forbidden: /All good|一切正常/ },
  ]
  for (const locale of ['zh', 'en'] as const) {
    for (const item of cases) {
      const summary = buildProfileSummary(item.data, { locale })
      assert.ok(summary.plain.length > 10, `${locale}: plain sentence missing`)
      assert.doesNotMatch(summary.plain, item.forbidden, `${locale}/${summary.tone}: "${summary.plain}" reads wrong for this verdict`)
      // No template placeholder may leak into the sentence a first-time user reads.
      assert.doesNotMatch(summary.plain, /\{[a-z]+\}/, `${locale}: plain leaked a placeholder: ${summary.plain}`)
    }
  }
})

test('every issue carries a plain meaning alongside the technical line', () => {
  const summary = buildProfileSummary(
    data({
      claims: [claim('a'), claim('b'), claim('c'), claim('d')],
      rowVerdicts: [
        verdict('a', 'blocked', {
          reasons: [{ code: 'x', severity: 'block', messageId: 'admission.denied', params: {} }],
          remediation: [{ kind: 'allow-version', command: 'dsh plugin allow a', note: 'n' }],
        }),
        verdict('b', 'unknown'),
      ],
      collisions: [{ id: 'llm', kind: 'conflicting-definitions', owners: ['x', 'y'], count: 2, names: ['x', 'y'] }],
      duplicateFindings: [
        { name: '@deepseek-ai/dsh-llm', kind: 'different-versions', copies: [{ path: 'a', version: '1.0.0', scope: 'profile' }, { path: 'b', version: '2.0.0', scope: 'shared' }] },
      ],
      errors: ['patch ./cordis.patch.yml could not be parsed'],
    }),
    { locale: 'zh', limit: 10 },
  )
  const kinds = new Set(summary.issues.map((issue) => issue.kind))
  for (const kind of ['denied', 'collision', 'duplicate', 'unknown', 'unreadable']) {
    assert.ok(kinds.has(kind as never), `missing an issue of kind ${kind}`)
  }
  for (const issue of summary.issues) {
    assert.ok(issue.plain.length > 5, `${issue.kind}: no plain sentence`)
    assert.notEqual(issue.plain, issue.line, `${issue.kind}: plain must differ from the technical line`)
    assert.doesNotMatch(issue.plain, /admission|entry id|peer|@deepseek-ai/, `${issue.kind}: plain leaked jargon: ${issue.plain}`)
  }
})
