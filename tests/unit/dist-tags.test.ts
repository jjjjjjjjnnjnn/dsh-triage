/**
 * "The four packages on npm point at the same version" (R64).
 *
 * WHY THESE CASES: both real release incidents were the same shape, and neither was caught by a test —
 * 0.3.1 published a `latest` that could not be installed, and 0.3.3 rolled three packages back to
 * 0.3.2 while `signals` stayed on 0.3.3. The negative cases below are those two incidents, written as
 * fixtures, plus the two ways this check could lie: an unreachable registry read as "agree", and a tag
 * pointing at a version that was never published.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PUBLISHED_PACKAGES, judgeDistTags } from '../../scripts/lib/dist-tags.mjs'
import type { PackumentTags } from '../../scripts/lib/dist-tags.mjs'

const VERSIONS = ['0.3.0', '0.3.1', '0.3.2', '0.3.3']

/** A packument shape as the registry serves it, for all four packages at one version. */
const healthy = (version: string): PackumentTags[] =>
  PUBLISHED_PACKAGES.map((name) => ({ name, distTags: { latest: version }, versions: VERSIONS }))

test('all four packages on the same version is the healthy case', () => {
  const verdict = judgeDistTags({ expectedVersion: '0.3.3', packages: healthy('0.3.3') })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.problems.length, 0)
  assert.deepEqual(verdict.latest, {
    '@dsh-triage/core': '0.3.3',
    '@dsh-triage/signals': '0.3.3',
    '@dsh-triage/probe': '0.3.3',
    'dsh-triage': '0.3.3',
  })
  assert.equal(verdict.detail, 'all 4 package(s) point latest at 0.3.3')
})

test('the 0.3.3 rollback: three packages back on 0.3.2 while signals stayed on 0.3.3', () => {
  const packages = healthy('0.3.2')
  packages[1] = { name: '@dsh-triage/signals', distTags: { latest: '0.3.3' }, versions: VERSIONS }
  const verdict = judgeDistTags({ expectedVersion: '0.3.3', packages })
  assert.equal(verdict.ok, false)
  // The package that was right is not blamed; the three that rolled back each get one line…
  assert.equal(verdict.problems.filter((line) => line.startsWith('@dsh-triage/signals:')).length, 0)
  assert.equal(verdict.problems.filter((line) => line.includes('latest=0.3.2, expected 0.3.3')).length, 3)
  // …and the shape is named once, with the odd one out.
  const disagreement = verdict.problems.filter((line) => line.includes('disagree on latest'))
  assert.equal(disagreement.length, 1)
  assert.ok(disagreement[0]?.includes('0.3.3 on @dsh-triage/signals'))
  assert.equal(verdict.tagsAgree, false)
})

test('every package agreeing on the wrong version is still a failure', () => {
  const verdict = judgeDistTags({ expectedVersion: '0.3.3', packages: healthy('0.3.2') })
  assert.equal(verdict.ok, false)
  // Agreement alone is not the claim: they agree, and they are all wrong.
  assert.equal(verdict.tagsAgree, true)
  assert.equal(verdict.problems.filter((line) => line.includes('expected 0.3.3')).length, 4)
  assert.ok(!verdict.problems.some((line) => line.includes('disagree')))
})

test('the 0.3.1 staging shape: latest names a version a stranger cannot install', () => {
  const packages = healthy('0.3.1')
  packages[3] = { name: 'dsh-triage', distTags: { latest: '0.3.4' }, versions: ['0.3.0', '0.3.1', '0.3.2', '0.3.3'] }
  const verdict = judgeDistTags({ expectedVersion: '0.3.1', packages })
  assert.equal(verdict.ok, false)
  assert.deepEqual(verdict.dangling, [{ name: 'dsh-triage', tag: 'latest', version: '0.3.4' }])
  assert.ok(verdict.problems.some((line) => line.includes('not a published version')))
})

test('an unreachable registry is unmeasured, never agreement', () => {
  const packages = healthy('0.3.3')
  packages[0] = { name: '@dsh-triage/core', unreachable: true }
  const verdict = judgeDistTags({ expectedVersion: '0.3.3', packages })
  assert.equal(verdict.ok, false)
  assert.deepEqual(verdict.unreachable, ['@dsh-triage/core'])
  assert.equal(verdict.latest['@dsh-triage/core'], null)
  assert.ok(verdict.problems.some((line) => line.includes('unmeasured')))
  // The three it could read are not turned into a pass.
  assert.equal(verdict.tagsAgree, true)
  assert.equal(verdict.ok, false)
})

test('a leftover tag on a real version is reported but does not fail the release', () => {
  const packages = healthy('0.3.3')
  packages[1] = { name: '@dsh-triage/signals', distTags: { latest: '0.3.3', next: '0.3.2' }, versions: VERSIONS }
  const verdict = judgeDistTags({ expectedVersion: '0.3.3', packages })
  assert.equal(verdict.ok, true)
  assert.deepEqual(verdict.extraTags, [{ name: '@dsh-triage/signals', tag: 'next', version: '0.3.2' }])
  assert.ok(verdict.detail.includes('@dsh-triage/signals@next=0.3.2'))
})

test('no packument at all is a vacuous verdict, not a pass', () => {
  const verdict = judgeDistTags({ expectedVersion: '0.3.3', packages: [] })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((line) => line.includes('vacuous')))
})
