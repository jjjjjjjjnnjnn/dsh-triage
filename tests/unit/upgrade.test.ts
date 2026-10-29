/**
 * M5-b upgrade impact (`docs/specs/M5-upgrade.md` §9).
 *
 * Every test here exists for one of the spec's negative controls. The point is not "the
 * function returns a list" — it is that the buckets cannot be produced by mistake:
 *
 *   - a range that never satisfies anything must not look like "clean upgrade";
 *   - a missing package must not look like "will break";
 *   - registry facts must not be able to move a unit between buckets;
 *   - the unit's verdict must be the SAME verdict `why` prints (no second rule set).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  evaluateAdmission,
  judgeUpgradeImpact,
  renderUpgradeImpact,
  verdictFromAdmission,
  verdictsFromRowAdmission,
  type EnvFingerprint,
  type RowDeclaration,
  type UpgradeImpact,
  type UpgradeImpactInput,
  type UpgradeUnit,
} from '@dsh-triage/core'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const stamp = '2026-10-30T00:00:00.000Z'
const TARGET = '0.3.0'
const CURRENT = '0.2.1-rc.4'

function envOf(overrides: Partial<EnvFingerprint> = {}): EnvFingerprint {
  return {
    dsh: CURRENT,
    node: '24.15.0',
    platform: 'win32',
    arch: 'x64',
    profile: 'web',
    profileDir: '<dsh-home>/profiles/web',
    bundles: [],
    installed: [],
    ...overrides,
  }
}

function rowOf(overrides: Partial<RowDeclaration> & { readonly rowId: string; readonly module: string }): RowDeclaration {
  return {
    source: 'patch:profile',
    version: '1.0.0',
    manifest: {},
    ...overrides,
  }
}

function judge(input: Partial<UpgradeImpactInput> & Pick<UpgradeImpactInput, 'rows'>): UpgradeImpact {
  const result = judgeUpgradeImpact({
    env: envOf(),
    target: TARGET,
    bundles: [],
    generatedAt: stamp,
    ...input,
  })
  assert.equal(result.ok, true, `expected a judgement, got ${result.ok ? '' : result.code}`)
  if (!result.ok) throw new Error('unreachable')
  return result.impact
}

function bucketOf(impact: UpgradeImpact, id: string): string {
  const unit = impact.units.find((candidate) => candidate.id === id)
  assert.ok(unit, `missing unit ${id}`)
  return unit.bucket
}

function unitOf(impact: UpgradeImpact, id: string): UpgradeUnit {
  const unit = impact.units.find((candidate) => candidate.id === id)
  assert.ok(unit, `missing unit ${id}`)
  return unit
}

/* ------------------------------ N2 · all admitted ------------------------------ */

test('N2: a profile whose declarations all admit the target is entirely likely-fine', () => {
  const impact = judge({
    rows: [
      rowOf({
        rowId: 'a',
        module: 'mod-a',
        manifest: { name: 'mod-a', version: '1.0.0', engines: { dsh: '>=0.2.0-rc.1 <0.4.0-0' } },
      }),
      rowOf({
        rowId: 'b',
        module: 'mod-b',
        manifest: { name: 'mod-b', version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh-llm': '*' } },
      }),
    ],
    bundles: [{ name: 'bundle-a', version: '1.0.0', manifest: { name: 'bundle-a', engines: { dsh: '*' } } }],
  })

  assert.equal(impact.counts.would_be_denied, 0)
  assert.equal(impact.counts.cannot_tell, 0)
  assert.equal(impact.counts.improved, 0)
  assert.equal(impact.counts.likely_fine, 3)
  assert.equal(impact.counts.total, 3)
  assert.equal(impact.counts.total, impact.counts.bundles + impact.counts.rows, 'total is the sum of both unit kinds')
  for (const unit of impact.units) assert.equal(unit.cause, 'admitted-at-target')
})

/* --------------------------- N3 · target == current --------------------------- */

test('N3: with the target equal to the running runtime, improved is empty and denials match `why`', () => {
  const pinned = rowOf({
    rowId: 'pinned',
    module: 'pinned-mod',
    manifest: { name: 'pinned-mod', version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh-llm': '0.2.1-rc.4' } },
  })
  const stale = rowOf({
    rowId: 'stale',
    module: 'stale-mod',
    manifest: { name: 'stale-mod', version: '1.0.0', engines: { dsh: '0.1.0-rc.6' } },
  })
  const rows = [pinned, stale]
  const impact = judge({ target: CURRENT, rows })
  assert.equal(impact.counts.improved, 0, 'nothing can improve when nothing changes')
  assert.equal(impact.target_relation, 'same')

  // What `why` says at this runtime, using the very same engine call `why` makes.
  const whyVerdicts = verdictsFromRowAdmission({ env: envOf({ dsh: CURRENT }), rows, generatedAt: stamp })
  const deniedByWhy = new Set(whyVerdicts.filter((verdict) => verdict.conclusion === 'blocked').map((verdict) => verdict.subject.name))
  for (const unit of impact.units) {
    assert.equal(
      unit.bucket === 'would-be-denied',
      deniedByWhy.has(unit.name),
      `${unit.name}: bucket ${unit.bucket} disagrees with why`,
    )
  }
  assert.equal(bucketOf(impact, 'row:pinned'), 'likely-fine')
  assert.equal(bucketOf(impact, 'row:stale'), 'would-be-denied', 'a range that excludes the runtime is denied')
  assert.equal(unitOf(impact, 'row:stale').already_denied_at_current, true)
})

/* ---------------------------- N4/N5 · bad target ---------------------------- */

test('N4/N5: a range, a partial version, a tag and an empty string are usage errors, never findings', () => {
  for (const target of ['0.3', '^0.3.0', 'latest', '', '   ', 'not-a-version']) {
    const result = judgeUpgradeImpact({
      env: envOf(),
      target,
      bundles: [],
      rows: [rowOf({ rowId: 'a', module: 'mod-a', manifest: { name: 'mod-a', engines: { dsh: '*' } } })],
      generatedAt: stamp,
    })
    assert.equal(result.ok, false, `target "${target}" must be rejected`)
    if (result.ok) continue
    assert.equal(result.code, 'invalid-target')
    // The message must say what a valid target looks like; "denied everything" would be a
    // silent false report, which is exactly why the guard exists.
    assert.match(result.detail, /exact semver version/)
    assert.equal('impact' in result, false, 'no impact may be produced for an invalid target')
  }
})

/* ------------------------- N6 · the package is absent ------------------------- */

test('N6: an uninstalled module is cannot-tell (not installed), never would-be-denied', () => {
  const impact = judge({
    rows: [rowOf({ rowId: 'ghost', module: 'dsh-plugin-that-was-removed', manifest: null, version: null })],
    bundles: [{ name: 'snapshot-only-bundle', version: null, manifest: null }],
  })

  const ghost = unitOf(impact, 'row:ghost')
  assert.equal(ghost.bucket, 'cannot-tell')
  assert.equal(ghost.cause, 'not-installed')
  assert.deepEqual(ghost.missing_evidence, ['missing.row-module'])
  assert.equal(ghost.verdict?.conclusion, 'unknown')
  assert.ok(ghost.verdict && ghost.verdict.missingEvidence.length > 0, 'unknown verdicts must say what is missing')

  const bundle = unitOf(impact, 'bundle:snapshot-only-bundle')
  assert.equal(bundle.bucket, 'cannot-tell')
  assert.equal(bundle.cause, 'not-installed')
  assert.deepEqual(bundle.missing_evidence, ['missing.admission'])
  assert.equal(bundle.verdict, null, 'a bundle with no manifest has nothing to judge')
})

/* -------------------------- N7 · no declaration at all -------------------------- */

test('N7: silence is not a pass — no DSH declaration is cannot-tell, never likely-fine', () => {
  const impact = judge({
    rows: [rowOf({ rowId: 'silent', module: 'silent-mod', manifest: { name: 'silent-mod', version: '1.0.0' } })],
    bundles: [{ name: 'silent-bundle', version: '1.0.0', manifest: { name: 'silent-bundle' } }],
  })

  const row = unitOf(impact, 'row:silent')
  assert.equal(row.bucket, 'cannot-tell')
  assert.equal(row.cause, 'no-declaration')
  assert.deepEqual(row.missing_evidence, ['missing.peer-declaration'])
  assert.equal(row.verdict?.conclusion, 'unknown')

  const bundle = unitOf(impact, 'bundle:silent-bundle')
  assert.equal(bundle.bucket, 'cannot-tell')
  assert.deepEqual(bundle.missing_evidence, ['missing.admission', 'missing.probe'])
  assert.equal(impact.counts.likely_fine, 0)
})

/* ----------------------- N8 · the declaration is unusable ---------------------- */

test('N8: an unsatisfiable declaration is a denial now and on the target, and says so', () => {
  const rows = [
    rowOf({ rowId: 'empty', module: 'mod-empty', manifest: { name: 'mod-empty', engines: { dsh: '' } } }),
    rowOf({ rowId: 'junk', module: 'mod-junk', manifest: { name: 'mod-junk', engines: { dsh: 'not a range' } } }),
    rowOf({ rowId: 'ws', module: 'mod-ws', manifest: { name: 'mod-ws', peerDependencies: { '@deepseek-ai/dsh-llm': 'workspace:*' } } }),
  ]
  const impact = judge({ rows })

  for (const id of ['row:empty', 'row:junk', 'row:ws']) {
    const unit = unitOf(impact, id)
    assert.equal(unit.bucket, 'would-be-denied', `${id} is a definite denial, not an absence of information`)
    assert.equal(unit.cause, 'unusable-declaration')
    assert.equal(unit.already_denied_at_current, true, 'the defect denies on the running runtime too')
    assert.equal(unit.verdict?.conclusion, 'blocked')
    assert.ok(
      unit.remediation.some((fix) => fix.messageId === 'remediation.pin-version-unusable'),
      'the fix must name the declaration defect, not "install another build"',
    )
  }
  assert.equal(impact.counts.cannot_tell, 0, 'unusable declarations must not hide inside cannot-tell')
})

/* ------------------------- N9 · registry never moves a unit ------------------------- */

test('N9: registry facts and registry failures never move a unit between buckets', () => {
  const input: UpgradeImpactInput = {
    env: envOf(),
    target: TARGET,
    generatedAt: stamp,
    rows: [
      rowOf({
        rowId: 'old',
        module: 'old-mod',
        manifest: { name: 'old-mod', version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh-llm': '0.2.1-rc.4' } },
      }),
      rowOf({ rowId: 'ghost', module: 'ghost-mod', manifest: null, version: null }),
    ],
    bundles: [],
  }
  const without = judgeUpgradeImpact(input)
  assert.equal(without.ok, true)
  if (!without.ok) return

  const withAdmitting = judgeUpgradeImpact({
    ...input,
    registry: [
      { package: 'old-mod', version: '2.0.0', declaredRange: '@deepseek-ai/dsh-llm@>=0.3.0', admitsTarget: true, publishedAt: '2026-10-01T00:00:00.000Z' },
      { package: 'old-mod', version: '1.5.0', declaredRange: '@deepseek-ai/dsh-llm@>=0.2.0 <0.4.0', admitsTarget: true },
      { package: 'ghost-mod', version: '0.9.0', declaredRange: 'engines.dsh 0.2.1-rc.4', admitsTarget: false },
    ],
    registryFailures: [{ package: 'unreachable-mod', code: 'network-error', detail: 'getaddrinfo ENOTFOUND' }],
  })
  assert.equal(withAdmitting.ok, true)
  if (!withAdmitting.ok) return

  // The whole point: annotations are attached AFTER bucketing, so adding/removing them
  // cannot change a single bucket or count.
  const shape = (impact: UpgradeImpact): unknown =>
    impact.units.map((unit) => ({ id: unit.id, bucket: unit.bucket, cause: unit.cause, missing: unit.missing_evidence }))
  assert.deepEqual(shape(withAdmitting.impact), shape(without.impact))
  assert.deepEqual(withAdmitting.impact.counts, without.impact.counts)

  const old = unitOf(withAdmitting.impact, 'row:old')
  assert.equal(old.suggestions.length, 2, 'both facts for this package are annotations')
  assert.equal(old.suggestions[0]?.version, '2.0.0', 'newest candidate first')
  assert.equal(old.suggestions.every((note) => note.annotation_only === true), true)
  assert.equal(old.suggestions.every((note) => note.tier === 'measured-registry'), true)
  assert.equal(old.suggestions.every((note) => note.note_id === 'upgrade.registry-annotation'), true)

  const ghost = unitOf(withAdmitting.impact, 'row:ghost')
  assert.equal(ghost.suggestions[0]?.admits_target, false, 'a fact that does not admit is still shown, as evidence')

  assert.equal(withAdmitting.impact.registry.consulted, true)
  assert.equal(withAdmitting.impact.registry.facts, 3)
  assert.deepEqual(
    withAdmitting.impact.registry.failures.map((failure) => failure.package),
    ['unreachable-mod'],
  )
  // `likely-fine` units never carry suggestions: there is no version to look for.
  const admittedUnit = judge({
    rows: [rowOf({ rowId: 'ok', module: 'ok-mod', manifest: { name: 'ok-mod', engines: { dsh: '*' } } })],
    registry: [{ package: 'ok-mod', version: '3.0.0', declaredRange: '*', admitsTarget: true }],
  })
  assert.equal(unitOf(admittedUnit, 'row:ok').suggestions.length, 0)
})

/* ------------------------------- N13 · ordering ------------------------------- */

test('N13: the impact list is ordered by bucket/kind/name/id and does not depend on input order', () => {
  const rows = [
    rowOf({ rowId: 'zzz', module: 'z-mod', manifest: { name: 'z-mod', engines: { dsh: '0.1.0-rc.6' } } }),
    rowOf({ rowId: 'aaa', module: 'a-mod', manifest: { name: 'a-mod', manifest2: undefined, engines: { dsh: '*' } } }),
    rowOf({ rowId: 'mmm', module: 'm-mod', manifest: null, version: null }),
    rowOf({ rowId: 'bbb', module: 'b-mod', manifest: { name: 'b-mod', peerDependencies: { '@deepseek-ai/dsh-llm': '0.2.1-rc.4' } } }),
  ]
  const bundles = [
    { name: 'bundle-z', version: '1.0.0', manifest: { name: 'bundle-z', engines: { dsh: '*' } } },
    { name: 'bundle-a', version: '1.0.0', manifest: { name: 'bundle-a', engines: { dsh: '0.1.0-rc.6' } } },
  ]
  const forward = judge({ rows, bundles })
  const reversed = judge({ rows: [...rows].reverse(), bundles: [...bundles].reverse() })
  assert.equal(JSON.stringify(forward), JSON.stringify(reversed), 'input order must not reach the output')

  // Bucket order, then bundle-before-row, then name.
  const order = forward.units.map((unit) => `${unit.bucket}|${unit.kind}|${unit.name}`)
  assert.deepEqual(order, [
    'would-be-denied|bundle|bundle-a',
    'would-be-denied|row|b-mod',
    'would-be-denied|row|z-mod',
    'cannot-tell|row|m-mod',
    'likely-fine|bundle|bundle-z',
    'likely-fine|row|a-mod',
  ])
  assert.deepEqual(forward.buckets, ['would-be-denied', 'cannot-tell', 'improved', 'likely-fine'])
})

/* -------------------------- N14 · current is unknown -------------------------- */

test('N14: when the running runtime cannot be read, improved stays empty and direction is unknown', () => {
  const rows = [
    rowOf({ rowId: 'needs-new', module: 'needs-new', manifest: { name: 'needs-new', peerDependencies: { '@deepseek-ai/dsh-llm': '>=0.3.0' } } }),
  ]
  const impact = judge({ env: envOf({ dsh: null }), rows })
  assert.equal(impact.current, null)
  assert.equal(impact.current_valid, false)
  assert.equal(impact.target_relation, 'unknown')
  assert.equal(impact.counts.improved, 0, 'without a current runtime, "it got better" cannot be claimed')
  const unit = unitOf(impact, 'row:needs-new')
  assert.equal(unit.bucket, 'likely-fine')
  assert.equal(unit.current.status, null)
  assert.equal(unit.current.runtime, null)
  assert.equal(unit.already_denied_at_current, false)
})

test('N14b: an unparsable current runtime is recorded as invalid, not evaluated as a denial', () => {
  const impact = judge({
    env: envOf({ dsh: 'not-a-version' }),
    rows: [rowOf({ rowId: 'needs-new', module: 'needs-new', manifest: { name: 'needs-new', peerDependencies: { '@deepseek-ai/dsh-llm': '>=0.3.0' } } })],
  })
  const unit = unitOf(impact, 'row:needs-new')
  assert.equal(unit.current.status, 'invalid-runtime')
  assert.equal(unit.bucket, 'likely-fine')
  assert.equal(impact.counts.improved, 0)
})

/* ----------------------------- improved · evidence ----------------------------- */

test('improved requires a known current runtime, a real range mismatch today, and admission at the target', () => {
  const improved = judge({
    rows: [rowOf({ rowId: 'up', module: 'up-mod', manifest: { name: 'up-mod', version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh-llm': '>=0.3.0' } } })],
  })
  const unit = unitOf(improved, 'row:up')
  assert.equal(unit.bucket, 'improved')
  assert.equal(unit.cause, 'denied-now-admitted-then')
  assert.equal(unit.current.status, 'denied')
  assert.equal(unit.target.status, 'admitted')
  assert.equal(unit.current.unmet.length, 1)
  assert.equal(unit.current.unmet[0]?.failure, null, 'only a real range mismatch counts as "the upgrade fixes it"')

  // Same shape, but the current denial is a declaration defect: upgrading cannot fix it.
  const defective = judge({
    env: envOf({ dsh: CURRENT }),
    rows: [rowOf({ rowId: 'up', module: 'up-mod', manifest: { name: 'up-mod', engines: { dsh: 'not a range' } } })],
    target: TARGET,
  })
  const defectUnit = unitOf(defective, 'row:up')
  assert.notEqual(defectUnit.bucket, 'improved', 'an unusable declaration is not "improved by the upgrade"')
  assert.equal(defectUnit.bucket, 'would-be-denied')
})

/* ------------------------- same engine, no second rule set ------------------------- */

test('every unit verdict is the verdict the same engine produces (no second rule set)', () => {
  const rows = [
    rowOf({ rowId: 'pinned', module: 'pinned-mod', manifest: { name: 'pinned-mod', version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh-llm': '0.2.1-rc.4' } } }),
    rowOf({ rowId: 'free', module: 'free-mod', manifest: { name: 'free-mod', version: '1.0.0', engines: { dsh: '*' } } }),
    rowOf({ rowId: 'silent', module: 'silent-mod', manifest: { name: 'silent-mod', version: '1.0.0' } }),
    rowOf({ rowId: 'ghost', module: 'ghost-mod', manifest: null, version: null }),
  ]
  const bundles = [{ name: 'b', version: '1.0.0', manifest: { name: 'b', engines: { dsh: '>=0.2.0-rc.1 <0.3.0-0' } } }]
  const impact = judge({ rows, bundles })
  const targetEnv = envOf({ dsh: TARGET })

  for (const row of rows) {
    const unit = unitOf(impact, `row:${row.rowId}`)
    const [whyVerdict] = verdictsFromRowAdmission({ env: targetEnv, rows: [row], generatedAt: stamp })
    if (whyVerdict !== undefined) {
      assert.deepEqual(unit.verdict, whyVerdict, `${row.rowId}: target verdict must equal why's verdict`)
    } else {
      const expected = verdictFromAdmission({
        subject: { name: row.module, version: row.version, kind: 'entry' },
        env: targetEnv,
        admission: evaluateAdmission(row.manifest, TARGET),
        generatedAt: stamp,
      })
      assert.deepEqual(unit.verdict, expected, `${row.rowId}: an admitted row still gets the shared builder`)
    }
    assert.equal(unit.verdict?.env.dsh, TARGET, 'the verdict env must name the TARGET, not the running runtime')
  }

  const bundle = unitOf(impact, 'bundle:b')
  const expectedBundle = verdictFromAdmission({
    subject: { name: 'b', version: '1.0.0', kind: 'plugin' },
    env: targetEnv,
    admission: evaluateAdmission(bundles[0]?.manifest, TARGET),
    generatedAt: stamp,
  })
  assert.deepEqual(bundle.verdict, expectedBundle)
})

test('a denied row names the row id and offers the same fixes `why` offers', () => {
  const impact = judge({
    rows: [rowOf({ rowId: 'compat-status', module: '@deepseek-ai/dsh-status', manifest: { name: '@deepseek-ai/dsh-status', version: '0.2.1-rc.4', peerDependencies: { '@deepseek-ai/dsh-session': '0.2.1-rc.4' } } })],
  })
  const unit = unitOf(impact, 'row:compat-status')
  const scope = unit.reasons.find((reason) => reason.messageId === 'admission.row-scope')
  assert.equal(scope?.params?.['rows'], 'compat-status', 'the exact row to disable must be in the output')
  assert.ok(unit.reasons.some((reason) => reason.messageId === 'admission.unmet.peer'))
  assert.ok(unit.remediation.some((fix) => fix.kind === 'pin-version'))
  assert.ok(unit.remediation.some((fix) => fix.kind === 'disable-entry' && fix.params?.['id'] === 'compat-status'))
})

/* ------------------------------ purity / offline ------------------------------ */

test('the module is pure: no fs, no network, no clock, no environment', () => {
  const source = readFileSync(`${repoRoot}packages/core/src/upgrade.ts`, 'utf8')
  for (const forbidden of [
    'node:fs',
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'undici',
    'axios',
    'fetch(',
    'process.env',
    'Date.now',
    'Math.random',
    'new Date(',
  ]) {
    assert.equal(source.includes(forbidden), false, `upgrade.ts must not contain ${forbidden}`)
  }
})

/* -------------------------------- rendering -------------------------------- */

test('rendering is deterministic, names the profile and never claims "will work"', () => {
  const impact = judge({
    env: envOf({ profile: 'upstream' }),
    rows: [
      rowOf({ rowId: 'pinned', module: 'pinned-mod', manifest: { name: 'pinned-mod', version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh-llm': '0.2.1-rc.4' } } }),
      rowOf({ rowId: 'free', module: 'free-mod', manifest: { name: 'free-mod', engines: { dsh: '*' } } }),
    ],
    profileSource: 'live',
  })
  const first = renderUpgradeImpact(impact, 'en')
  const second = renderUpgradeImpact(impact, 'en')
  assert.equal(first, second)
  assert.match(first, /profile "upstream"/, 'the output must name the profile the answer belongs to')
  assert.match(first, /0\.3\.0/)
  assert.match(first, /admitted ≠ works/)
  assert.match(first, /would-be-denied · 1 unit/)
  assert.match(first, /likely-fine · 1 unit/)
  assert.equal(/will work|works fine|safe to upgrade/i.test(first), false)

  const zh = renderUpgradeImpact(impact, 'zh')
  assert.match(zh, /profile「upstream」/)
  assert.match(zh, /放行 ≠ 能用/)
  assert.notEqual(zh, first)
})

test('an empty composition renders "nothing was sampled", not a clean bill of health', () => {
  const impact = judge({ rows: [] })
  assert.equal(impact.counts.total, 0)
  const text = renderUpgradeImpact(impact, 'en')
  assert.match(text, /nothing was sampled/)
  assert.equal(/likely-fine · 0/.test(text), false, 'no bucket headers at all when nothing was read')
})
