/**
 * R102 · M16-C6: "the two surfaces agree" must be computable, and it must name what it compared.
 *
 * The negative control that matters is the one R101 actually shipped: `0 collisions` on the panel and
 * `1 collision` in the CLI read as "both are fine" when the comparison was done by eye. A rule that
 * cannot go red on that input is not a rule.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ACTIONABLE_FIELDS, judgePanelAgreement } from '../../scripts/lib/panel-agreement.mjs'

const side = (dsh: string | null, source: string | null, counts: Record<string, number | null> | null) => ({
  dsh,
  dshSource: source,
  counts,
})

test('identical readings agree on version and on every actionable field', () => {
  const counts = { rows: 289, denied: 0, collisions: 0, duplicateCopies: 0, errors: 0 }
  const judged = judgePanelAgreement(side('0.2.2-rc.1', 'kernel', counts), side('0.2.2-rc.1', 'kernel-asar', counts))
  assert.equal(judged.agree_on_version, true)
  assert.equal(judged.agree_on_actionable, true)
  assert.deepEqual(judged.mismatches, [])
  // The provenance label is not part of the comparison: two callers, one runtime (M11-C7 / M14-C2).
  assert.equal(judged.row_counts_differ, false)
})

test('N1: the collision R101 left behind is a real disagreement', () => {
  const panel = side('0.2.2-rc.1', 'kernel', { rows: 242, denied: 0, collisions: 0, duplicateCopies: 0, errors: 0 })
  const cli = side('0.2.2-rc.1', 'kernel-asar', { rows: 158, denied: 0, collisions: 1, duplicateCopies: 0, errors: 0 })
  const judged = judgePanelAgreement(panel, cli)
  assert.equal(judged.agree_on_actionable, false, 'one collision on one side and none on the other is a disagreement')
  assert.deepEqual(judged.mismatches, [{ field: 'collisions', panel: 0, cli: 1 }])
  assert.equal(judged.agree_on_version, true)
  assert.equal(judged.row_counts_differ, true)
})

test('N2: a different runtime version is a version disagreement, not an actionable one', () => {
  const counts = { rows: 202, denied: 0, collisions: 0, duplicateCopies: 0, errors: 0 }
  const judged = judgePanelAgreement(side('0.2.2-rc.1', 'kernel', counts), side('0.1.0-rc.6', 'inferred', counts))
  assert.equal(judged.agree_on_version, false)
  assert.equal(judged.agree_on_actionable, true)
  assert.deepEqual(judged.mismatches.map((item) => item.field), ['dsh'])
})

test('N3: row counts may differ without being a disagreement', () => {
  const judged = judgePanelAgreement(
    side('0.2.2-rc.1', 'kernel', { rows: 289, denied: 0, collisions: 0, duplicateCopies: 0, errors: 0 }),
    side('0.2.2-rc.1', 'kernel-asar', { rows: 202, denied: 0, collisions: 0, duplicateCopies: 0, errors: 0 }),
  )
  assert.equal(judged.agree_on_actionable, true, 'the Host sees the kernel layer; the CLI sees the profile')
  assert.equal(judged.row_counts_differ, true)
})

test('N4: every field the rule uses is named in one place', () => {
  // A control that only checked `denied` would pass R101's actual disagreement, so the list itself is
  // the rule. Adding a new actionable count without adding it here must be a visible decision.
  assert.deepEqual([...ACTIONABLE_FIELDS].sort(), ['collisions', 'denied', 'duplicateCopies', 'errors'])
  const counts = { rows: 1, denied: 0, collisions: 0, duplicateCopies: 1, errors: 0 }
  const judged = judgePanelAgreement(side('0.2.2-rc.1', 'kernel', counts), side('0.2.2-rc.1', 'kernel', { ...counts, duplicateCopies: 0 }))
  assert.equal(judged.agree_on_actionable, false, 'a duplicate-copy difference must be caught too')
})

test('N5: a missing count is not a zero, and two missing answers are not a disagreement', () => {
  const judged = judgePanelAgreement(side('0.2.2-rc.1', 'kernel', null), side('0.2.2-rc.1', 'kernel', { denied: 0 }))
  // `null !== 0` is a disagreement, which is the honest reading: an absent number is not a zero.
  assert.equal(judged.agree_on_actionable, false)
  assert.deepEqual(judged.mismatches.map((item) => item.field), ['denied'])

  // Both sides missing the same field: nobody answered, so nothing contradicts — and nothing is claimed.
  const bothMissing = judgePanelAgreement(side('0.2.2-rc.1', 'kernel', null), side('0.2.2-rc.1', 'kernel', null))
  assert.equal(bothMissing.agree_on_actionable, true)
  assert.deepEqual(bothMissing.mismatches, [])
})
