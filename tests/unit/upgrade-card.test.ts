/**
 * M6 upgrade-day card (`docs/specs/M6-upgrade-day.md`, T-801).
 *
 * These tests are the spec's controls, not a smoke test: the card is the only artefact most users will read,
 * so the two ways it can lie — a number that the judgement did not produce, and a promise that an upgrade
 * fixes something — are pinned here.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  judgeUpgradeImpact,
  renderUpgradeCard,
  scrubCardText,
  type EnvFingerprint,
  type RowDeclaration,
  type UpgradeImpact,
} from '@dsh-triage/core'

const stamp = '2026-10-29T00:00:00.000Z'
const CURRENT = '0.2.1-rc.4'
const TARGET = '0.3.0'

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
  return { source: 'patch:profile', version: '1.0.0', manifest: {}, ...overrides }
}

function judge(rows: readonly RowDeclaration[]): UpgradeImpact {
  const result = judgeUpgradeImpact({ env: envOf(), target: TARGET, bundles: [], rows, generatedAt: stamp })
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('unreachable')
  return result.impact
}

/** One row per bucket: admitted now / denied at target / denied now but admitted at target / no declaration. */
function fourBuckets(): UpgradeImpact {
  return judge([
    rowOf({
      rowId: 'fine',
      module: 'mod-fine',
      manifest: { name: 'mod-fine', version: '1.0.0', engines: { dsh: '>=0.2.0-rc.1 <0.4.0-0' } },
    }),
    rowOf({
      rowId: 'denied',
      module: 'mod-denied',
      manifest: { name: 'mod-denied', version: '1.0.0', engines: { dsh: '>=0.2.0-rc.1 <0.3.0-0' } },
    }),
    rowOf({
      rowId: 'improved',
      module: 'mod-improved',
      manifest: { name: 'mod-improved', version: '1.0.0', engines: { dsh: '>=0.3.0' } },
    }),
    rowOf({ rowId: 'quiet', module: 'mod-quiet', manifest: { name: 'mod-quiet', version: '1.0.0' } }),
  ])
}

const zhCard = (impact: UpgradeImpact): string => renderUpgradeCard(impact, { locale: 'zh' })

test('M6-C1: the first content line after the title is the conclusion, and it carries all four counts', () => {
  const impact = fourBuckets()
  const lines = zhCard(impact).split('\n')
  assert.ok(lines[0]?.startsWith('# 升级日'))
  const conclusion = lines.find((line) => line.startsWith('**'))
  assert.ok(conclusion !== undefined, 'no conclusion line')
  for (const value of [
    impact.counts.would_be_denied,
    impact.counts.cannot_tell,
    impact.counts.improved,
    impact.counts.likely_fine,
  ]) {
    assert.ok(conclusion.includes(String(value)), `conclusion ${conclusion} is missing ${value}`)
  }
  assert.ok(conclusion.includes(TARGET))
})

test('M6-C2/N2: the counts in the card come from `impact.counts`, not from the unit list', () => {
  const impact = fourBuckets()
  const mutated: UpgradeImpact = { ...impact, counts: { ...impact.counts, would_be_denied: impact.counts.would_be_denied + 7 } }
  assert.ok(zhCard(mutated).includes(`升到 ${TARGET} → ${impact.counts.would_be_denied + 7}`))
})

test('M6-C3: output is markdown a release thread can take (table + headings, no terminal decoration)', () => {
  const card = zhCard(fourBuckets())
  assert.ok(card.includes('| 桶 | 数量 | 意思 |'))
  assert.ok(card.includes('## '))
  assert.ok(!card.includes('\u001b['), 'no ANSI escapes')
})

test('M6-C4/N4: the boundary survives and the card never promises an upgrade will fix something', () => {
  for (const card of [zhCard(fourBuckets()), renderUpgradeCard(fourBuckets(), { locale: 'en' })]) {
    const lower = card.toLowerCase()
    for (const forbidden of ['升级会修好', '升级即修复', 'upgrading fixes', 'upgrade fixes']) {
      assert.equal(lower.includes(forbidden.toLowerCase()), false, `forbidden promise: ${forbidden}`)
    }
    assert.ok(card.includes('目标版本会放行它') || card.includes('the target admits it'))
  }
})

test('M6-C5/N6: the same impact renders byte-identically twice', () => {
  const impact = fourBuckets()
  assert.equal(zhCard(impact), zhCard(impact))
  assert.equal(renderUpgradeCard(impact, { locale: 'en' }), renderUpgradeCard(impact, { locale: 'en' }))
})

test('M6-C6/N5: roots and path shapes are scrubbed before the card leaves the machine', () => {
  const scrubbed = scrubCardText('at C:\\Users\\someone\\Desktop\\x and /home/someone/y', ['C:\\Users\\someone'])
  assert.equal(scrubbed.includes('someone'), false, scrubbed)
  const card = renderUpgradeCard(fourBuckets(), { locale: 'zh', redactRoots: ['C:\\Users\\someone'] })
  assert.equal(/[A-Za-z]:\\Users\\/.test(card), false)
})

test('M6-N1: a profile with nothing to judge says so instead of rendering an empty table', () => {
  const impact = fourBuckets()
  const empty: UpgradeImpact = { ...impact, counts: { ...impact.counts, total: 0, bundles: 0, rows: 0, would_be_denied: 0, cannot_tell: 0, improved: 0, likely_fine: 0 }, units: [] }
  const card = zhCard(empty)
  assert.ok(card.includes('没有可判单元'))
  assert.equal(card.includes('| 桶 |'), false)
})

test('M6-N11: `improved` shows both sides (denied today, admitted at target)', () => {
  const impact = fourBuckets()
  const unit = impact.units.find((candidate) => candidate.bucket === 'improved')
  assert.ok(unit, 'fixture produced no improved unit')
  const card = zhCard(impact)
  const section = card.slice(card.indexOf('## 今天被拒、目标放行'))
  assert.ok(section.includes(unit.id))
  // The target side is the section itself; the current side must be spelled out as "现在".
  assert.ok(section.includes('现在'), section)
  assert.ok(section.includes('>=0.3.0'), 'the unmet range that makes it broken today is named')
})

test('M6-N12: a unit that is already broken today is not blamed on the upgrade', () => {
  const impact = judge([
    rowOf({
      rowId: 'already',
      module: 'mod-already',
      // Denied at the running runtime AND at the target: admission never admits it.
      manifest: { name: 'mod-already', version: '1.0.0', engines: { dsh: '>=9.0.0' } },
    }),
  ])
  assert.ok(impact.units.every((unit) => unit.already_denied_at_current))
  assert.ok(zhCard(impact).includes('今天已经是坏的（不是这次升级造成的）'))
})

test('M6: a long bucket is capped and the omitted count is stated', () => {
  const rows = Array.from({ length: 12 }, (_, index) =>
    rowOf({
      rowId: `fine-${index}`,
      module: `mod-${index}`,
      manifest: { name: `mod-${index}`, version: '1.0.0', engines: { dsh: '>=0.2.0-rc.1 <0.4.0-0' } },
    }),
  )
  const card = zhCard(judge(rows))
  assert.ok(card.includes('另外 4 个'), card)
})
