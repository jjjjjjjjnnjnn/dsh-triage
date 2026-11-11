/**
 * The artifact must be able to prove the sentence the round is about (R94).
 *
 * WHY THESE CASES: R94 shipped a reading — "13 duplicate groups, 0 findings" — and the recorded
 * duplicate list did not carry `surface`, the field that explains the zero. That is the shape this
 * project keeps writing down: a number in prose whose evidence cannot reproduce it. So the
 * projection is pinned in both directions:
 *
 *   - `surface: false` must survive, or the artifact cannot show which groups were downgraded;
 *   - an absent `surface` must stay `null`, not become `false` — the engine treats absence as a
 *     finding, so recording it as `false` would launder an unstated group into a quiet one;
 *   - `findings` must be the number the engine emitted, never a re-derivation from the groups.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { projectDuplicate, summariseDuplicates } from '../../scripts/lib/audit-projection.mjs'

const copy = (scope: string, version: string | null) => ({ scope, path: `profiles/desktop/node_modules/x`, version })

test('a downgraded duplicate keeps surface:false, and its copies survive verbatim', () => {
  const projected = projectDuplicate({
    name: '@babel/runtime',
    kind: 'different-versions',
    surface: false,
    copies: [copy('profile', '7.29.13'), copy('shared', '7.29.7')],
  })
  assert.equal(projected.surface, false)
  assert.equal(projected.copies.length, 2)
  assert.equal(projected.copies[0]?.version, '7.29.13')
})

test('NEGATIVE CONTROL: a missing surface stays null, it never becomes false', () => {
  // The engine's rule is `surface !== false` → a finding. Recording `false` here would silently
  // downgrade a hand-built group and the artifact would then disagree with the verdicts.
  const projected = projectDuplicate({ name: 'hand-built', kind: 'different-versions', copies: [copy('profile', '1.0.0')] })
  assert.equal(projected.surface, null)
  assert.notEqual(projected.surface, false)
})

test('surface:true survives as true, so "counted and actionable" is visible too', () => {
  const projected = projectDuplicate({ name: '@deepseek-ai/dsh-llm', kind: 'different-versions', surface: true, copies: [] })
  assert.equal(projected.surface, true)
})

test('a malformed group does not throw; it becomes an explicitly empty record', () => {
  const projected = projectDuplicate({})
  assert.equal(projected.name, '')
  assert.equal(projected.kind, 'unknown')
  assert.equal(projected.surface, null)
  assert.deepEqual(projected.copies, [])
})

test('the summary counts the three states apart and takes findings from the engine', () => {
  const groups = [
    { name: 'a', kind: 'different-versions', surface: false, copies: [] },
    { name: 'b', kind: 'different-versions', surface: false, copies: [] },
    { name: 'c', kind: 'different-versions', surface: true, copies: [] },
    { name: 'd', kind: 'different-versions', copies: [] },
    { name: 'e', kind: 'same-version', surface: false, copies: [] },
  ]
  const summary = summariseDuplicates({ groups, findings: 1 })
  assert.equal(summary.groups, 5)
  assert.equal(summary.findings, 1)
  assert.equal(summary.downgraded, 3)
  assert.equal(summary.unstated_surface, 1)
  assert.equal(summary.different_versions, 4)
})

test('NEGATIVE CONTROL: a wrong findings number is not repaired from the groups', () => {
  // If this were re-derived, a scanner that stopped emitting verdicts would still look healthy.
  const groups = [{ name: 'a', kind: 'different-versions', surface: true, copies: [] }]
  assert.equal(summariseDuplicates({ groups, findings: 0 }).findings, 0)
  assert.equal(summariseDuplicates({ groups, findings: 7 }).findings, 7)
  assert.equal(summariseDuplicates({ groups, findings: -1 }).findings, 0)
})
