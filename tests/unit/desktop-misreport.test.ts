/**
 * R101 · M14/M15 acceptance: the desktop profile must stop misreporting installed plugins, and the
 * one-screen answer must not count "never declared a range" as an anomaly.
 *
 * The three readings this file pins were taken on the maintainer's machine on 2026-11-12:
 *   before: 202 rows / 20 judged / 0 go / 8 blocked / 12 unknown / 1 collision, "检测到 9 项兼容异常"
 *   after : 202 rows / 55 judged / 0 go / 0 blocked / 55 unknown / 1 collision, "检测到 1 项兼容异常"
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runtimeLabel } from '../../packages/plugin/dist/summary.js'
import { buildProfileSummary } from '../../packages/plugin/dist/summary.js'
import { loadEnv } from '../../packages/core/dist/env.js'
import { loadAuditData } from '../../packages/plugin/dist/audit-data.js'

const dshHome = `${process.env['USERPROFILE'] ?? process.env['HOME']}/.dsh`

async function summaryFor(profile: string) {
  const env = await loadEnv({ dshHome, profile })
  if (env.ok === false) return null
  const loaded = await loadAuditData({
    env: env.value,
    dshHome,
    stamp: '2026-11-12T17:00:00.000Z',
    snapshotPath: null,
    noRedact: false,
  })
  if (loaded.ok === false) return null
  return buildProfileSummary(loaded.data, { locale: 'zh', limit: 8 })
}

test('M14-C2: a kernel-asar fingerprint is labelled as such, not as "inferred"', () => {
  assert.equal(runtimeLabel({ dsh: '0.2.2-rc.1', dshSource: 'kernel-asar' }), '0.2.2-rc.1 (kernel-asar)')
  // M11 labels must keep working unchanged.
  assert.equal(runtimeLabel({ dsh: '0.2.2-rc.1', dshSource: 'kernel' }), '0.2.2-rc.1 (kernel)')
  assert.equal(runtimeLabel({ dsh: '0.1.0-rc.6', dshSource: 'inferred' }), '0.1.0-rc.6 (inferred)')
  // An unlabelled fingerprint renders exactly as before.
  assert.equal(runtimeLabel({ dsh: '0.2.2-rc.1' }), '0.2.2-rc.1')
})

test('M14-N1/N4: on a desktop install the runtime is the archive version and nothing is denied', async (t) => {
  const summary = await summaryFor('desktop')
  // If this machine has no desktop archive the probe is `absent`; then the old behaviour applies and this
  // assertion is not evidence either way. `web` covers the archive-less path in the next test.
  const env = await loadEnv({ dshHome, profile: 'desktop' })
  if (summary === null || env.ok === false) {
    t.skip('no desktop profile / archive on this machine: this is a measurement, not a rule')
    return
  }
  if (env.value.dshSource !== 'kernel-asar') {
    t.skip('the desktop profile here has no archive-backed runtime, so M14 has nothing to measure')
    return
  }

  assert.equal(summary.counts.denied, 0, 'no installed plugin may be denied on a real desktop profile (N1/N4)')
  // Before the fix this was 20 judged with 8 denied. The archive lets more rows be judged at all — the
  // remainder are `unknown` because they never declare a range, which is a different thing from a denial.
  assert.ok(summary.counts.judged >= 50, `the archive must let rows be judged, got ${summary.counts.judged}`)
})

test('M15-N8: nothing actionable means the one-screen answer says zero, not "an anomaly"', async (t) => {
  const env = await loadEnv({ dshHome, profile: 'web' })
  const summary = await summaryFor('web')
  if (env.ok === false || summary === null) {
    t.skip('no `web` profile on this machine: the reading needs the maintainer home')
    return
  }
  // `web` declares two rows and neither has an entry-id collision.
  assert.equal(summary.counts.collisions, 0)
  assert.equal(summary.counts.denied, 0)
  assert.ok(
    summary.headline.includes('0 项需要处理'),
    `an all-unknown profile must say "0 need you", got: ${summary.headline}`,
  )
  assert.equal(
    summary.headline.includes('异常'),
    false,
    'the headline must not use the word anomaly when nothing is actionable',
  )
  assert.equal(summary.tone, 'attention', 'unknown-only is attention, never broken')
})

test('M15: counts expose actionable and unjudged separately', async (t) => {
  const summary = await summaryFor('desktop')
  if (summary === null) {
    t.skip('no desktop profile on this machine: the reading needs the maintainer home')
    return
  }
  assert.equal(
    summary.counts.actionable,
    summary.counts.denied + summary.counts.collisions + summary.counts.duplicateCopies + summary.counts.errors,
    'actionable is a named sum, not a hand-tallied number',
  )
  assert.equal(summary.counts.unjudged, summary.counts.unknown)
})

test('M15 negative control: a denial still reads as an anomaly', async () => {
  // Build a synthetic summary input rather than mutating the machine: one denied verdict must still say so.
  const fakeData = {
    claims: [{ entryId: 'x', module: 'x' }],
    rowVerdicts: [
      {
        conclusion: 'blocked',
        subject: { name: 'broken-plugin', version: '1.0.0', kind: 'entry' },
        reasons: [{ code: 'c', severity: 'block', messageId: 'admission.unmet.peer', params: { key: 'dsh', range: '>=9', runtime: '1' } }],
        remediation: [],
        evidence: [],
        missingEvidence: [],
      },
    ],
    collisions: [],
    duplicateFindings: [],
    errors: [],
  }
  const summary = buildProfileSummary(fakeData as never, { locale: 'zh', limit: 4 })
  assert.equal(summary.tone, 'broken')
  assert.ok(summary.headline.includes('异常'), 'a real denial must still be called an anomaly')
  assert.equal(summary.counts.actionable, 1)
})
