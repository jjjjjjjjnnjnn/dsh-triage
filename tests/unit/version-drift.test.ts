/**
 * Registry version facts (T-109) and range-shape advice (T-115).
 *
 * WHY THIS FILE EXISTS: CASE-10849 / CASE-10201 both start one step before anything
 * we used to look at — `latest` pointed at a build admission then rejected. And the
 * *shape* of a declared range predicts the next failure: an exact pin dies on the
 * next upstream patch, an unbounded range silently admits a breaking major.
 *
 * The negative controls matter more than the happy path here: registry facts are
 * `measured-registry` tier and must never move a conclusion.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  evaluateAdmission,
  judgeRangeShape,
  judgeVersionDrift,
  renderVerdict,
  verdictFromAdmission,
  verdictsFromRowAdmission,
  type EnvFingerprint,
  type RegistryFacts,
} from '@dsh-triage/core'

const STAMP = '2026-10-27T00:00:00.000Z'

const env: EnvFingerprint = {
  dsh: '0.2.1-rc.3',
  node: '24.15.0',
  platform: 'win32',
  arch: 'x64',
  profile: 'web',
  profileDir: '<sandbox>/profiles/web',
  bundles: [],
  installed: [{ name: '@deepseek-ai/dsh', version: '0.2.1-rc.3' }],
}

/** The real shape of `@deepseek-ai/dsh-tools` that started the finding. */
const dshToolsFacts: RegistryFacts = {
  latest: '0.0.1-rc.1',
  next: null,
  versions: ['0.2.1-rc.2', '0.0.1-rc.1', '0.2.1-rc.3'],
  publishedAt: { '0.2.1-rc.3': '2026-10-20T00:00:00.000Z' },
}

test('a stale "latest" tag is drift, even when it is itself a prerelease', () => {
  const drift = judgeVersionDrift(dshToolsFacts)
  assert.equal(drift.standing, 'latest-behind')
  assert.equal(drift.latest, '0.0.1-rc.1')
  assert.equal(drift.newest, '0.2.1-rc.3')
  assert.equal(drift.newestPublishedAt, '2026-10-20T00:00:00.000Z')
  assert.match(drift.detail, /0\.2\.1-rc\.3 is already published/)
})

test('a stable "latest" with a newer prerelease is not drift', () => {
  // Calling this a defect would flag every package that ships prereleases.
  const drift = judgeVersionDrift({
    latest: '0.1.7',
    next: '0.2.0-rc.1',
    versions: ['0.1.7', '0.2.0-rc.1'],
  })
  assert.equal(drift.standing, 'prerelease-ahead')
  assert.equal(drift.newest, '0.2.0-rc.1')
})

test('a genuinely stale stable tag is drift against stable builds', () => {
  const drift = judgeVersionDrift({
    latest: '1.0.0',
    next: null,
    versions: ['1.0.0', '1.2.0', '2.0.0-rc.1'],
  })
  assert.equal(drift.standing, 'latest-behind')
  assert.equal(drift.newestStable, '1.2.0', 'stable channel decides, not the prerelease')
})

test('missing or unusable tags are reported, never guessed', () => {
  assert.equal(judgeVersionDrift({ latest: null, next: null, versions: ['1.0.0'] }).standing, 'latest-missing')
  assert.equal(judgeVersionDrift({ latest: 'not-a-version', next: null, versions: ['1.0.0'] }).standing, 'unknown')
  assert.equal(judgeVersionDrift({ latest: '1.0.0', next: null, versions: [] }).standing, 'unknown')
  assert.equal(judgeVersionDrift({ latest: '1.0.0', next: null, versions: ['1.0.0'] }).standing, 'none')
})

test('a deprecated build is never recommended as the newer one', () => {
  // Advising an install of the newest build when the author deprecated it would be
  // advice that harms the user; deprecation outranks recency.
  const drift = judgeVersionDrift({
    latest: '0.2.1-rc.3',
    next: null,
    versions: ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4'],
    deprecated: ['0.2.1-rc.4'],
  })
  assert.equal(drift.standing, 'none', 'the deprecated build must not count as drift')
  assert.equal(drift.newest, '0.2.1-rc.3')
})

test('range shapes: exact, unbounded, bounded, unusable, absent', () => {
  const shape = (range: unknown) => judgeRangeShape(range).shape
  assert.equal(shape('0.2.1-rc.2'), 'exact')
  assert.equal(shape('*'), 'unbounded')
  assert.equal(shape('x'), 'unbounded')
  assert.equal(shape('>=0.2.0-rc.1'), 'unbounded', 'a bare >= has no ceiling')
  assert.equal(shape('>=1.0.0 || >=2.0.0'), 'unbounded', 'a union is only bounded when every arm is')
  assert.equal(shape('^0.2.1-rc.2'), 'bounded')
  assert.equal(shape('~0.2.1'), 'bounded')
  assert.equal(shape('>=0.2.0-rc.1 <0.3.0-0'), 'bounded')
  // Looks unbounded, is not: semver expands these to `>=1.0.0 <2.0.0-0`.
  assert.equal(shape('1.x'), 'bounded')
  assert.equal(shape('1'), 'bounded')
  assert.equal(shape('1.2'), 'bounded')
  assert.equal(shape('workspace:*'), 'unusable')
  assert.equal(shape('not-a-range'), 'unusable')
  assert.equal(shape(''), 'absent')
  assert.equal(shape(undefined), 'absent')
})

test('a package whose every version is deprecated says so instead of "no valid semver"', () => {
  const drift = judgeVersionDrift({
    latest: '1.0.0',
    next: null,
    versions: ['1.0.0', '1.1.0'],
    deprecated: ['1.0.0', '1.1.0'],
  })
  assert.equal(drift.standing, 'unknown')
  assert.equal(drift.detail, 'every published version is deprecated')
})

test('a tag naming an unpublished version is reported, not called healthy', () => {
  // `dsh plugin add <name>` cannot resolve such a tag at all, so "points at the
  // newest published build" would be a false reassurance (R10 adversary finding).
  const drift = judgeVersionDrift({ latest: '1.0.0', next: null, versions: ['0.9.0'] })
  assert.equal(drift.standing, 'latest-unpublished')
  const prereleaseTag = judgeVersionDrift({ latest: '3.0.0-rc.1', next: null, versions: ['2.0.0'] })
  assert.equal(prereleaseTag.standing, 'latest-unpublished')
})

test('a tag pointing at a deprecated build is reported as such', () => {
  const drift = judgeVersionDrift({
    latest: '2.0.0',
    next: null,
    versions: ['1.0.0', '2.0.0'],
    deprecated: ['2.0.0'],
  })
  assert.equal(drift.standing, 'latest-deprecated')
})

test('an exact pin written with "=" or inside a union is not "unbounded"', () => {
  // Both shapes cannot drift, so the "no upper bound" warning would be a false alarm.
  assert.equal(judgeRangeShape('=1.2.3').shape, 'exact')
  assert.equal(judgeRangeShape('1.2.3 || 4.5.6').shape, 'bounded')
  assert.equal(judgeRangeShape('^1.2.3 || 4.5.6').shape, 'bounded')
})

test('the terminal shows the loudest reason first, and still shows the row id', () => {
  const manifest = { peerDependencies: { '@deepseek-ai/dsh-tools': '*' } }
  const verdict = verdictFromAdmission({
    subject: { name: '@deepseek-ai/dsh-tools', version: '0.0.1-rc.1', kind: 'plugin' },
    env,
    admission: evaluateAdmission(manifest, env.dsh),
    generatedAt: STAMP,
    manifest,
    rangeAdvice: true,
    registryDrift: judgeVersionDrift(dshToolsFacts),
  })
  const text = renderVerdict(verdict, 'en')
  assert.match(text, /dist-tag "latest" points at/, 'the round headline must not be cut to "…more"')

  const rows = verdictsFromRowAdmission({
    env,
    rows: [
      {
        rowId: 'hooks-claude-code',
        module: '@deepseek-ai/dsh-hooks-claude-code',
        source: 'patch:profile',
        manifest: { peerDependencies: { '@deepseek-ai/dsh-llm': '0.2.1-rc.2' } },
        version: '0.2.1-rc.2',
      },
    ],
    generatedAt: STAMP,
  })
  const rowText = renderVerdict(rows[0]!, 'en')
  assert.match(rowText, /loader row hooks-claude-code/, 'the row id stays pinned first')
})

test('registry drift never moves the conclusion, only the reasons', () => {
  const manifest = { peerDependencies: { '@deepseek-ai/dsh-tools': '^0.2.0-rc.1' } }
  const admission = evaluateAdmission(manifest, env.dsh)
  assert.equal(admission.status, 'admitted')

  const without = verdictFromAdmission({
    subject: { name: '@deepseek-ai/dsh-tools', version: '0.2.1-rc.3', kind: 'plugin' },
    env,
    admission,
    generatedAt: STAMP,
    manifest,
  })
  assert.equal(without.conclusion, 'go')

  const withDrift = verdictFromAdmission({
    subject: { name: '@deepseek-ai/dsh-tools', version: '0.2.1-rc.3', kind: 'plugin' },
    env,
    admission,
    generatedAt: STAMP,
    manifest,
    registryDrift: judgeVersionDrift(dshToolsFacts),
  })
  assert.equal(withDrift.conclusion, 'go', 'a stale tag is advice to pin, not a verdict')
  const warn = withDrift.reasons.find((reason) => reason.messageId === 'registry.latest-behind')
  assert.equal(warn?.severity, 'warn')
  assert.equal(warn?.params?.['latest'], '0.0.1-rc.1')
  assert.match(String(warn?.params?.['published']), /published 2026-10-20/)
  assert.ok(
    withDrift.evidence.some((item) => item.id === 'registry-tags' && item.tier === 'measured-registry'),
    'registry facts must carry their own tier',
  )
})

test('a stale tag cannot soften a denial either', () => {
  const manifest = { peerDependencies: { '@deepseek-ai/dsh-tools': '0.0.1-rc.1' } }
  const admission = evaluateAdmission(manifest, env.dsh)
  assert.equal(admission.status, 'denied')
  const verdict = verdictFromAdmission({
    subject: { name: '@deepseek-ai/dsh-tools', version: '0.0.1-rc.1', kind: 'plugin' },
    env,
    admission,
    generatedAt: STAMP,
    manifest,
    registryDrift: judgeVersionDrift(dshToolsFacts),
  })
  assert.equal(verdict.conclusion, 'blocked')
})

test('range advice appears only when asked for, and never changes the conclusion', () => {
  const exact = { peerDependencies: { '@deepseek-ai/dsh-tools': '0.2.1-rc.3' } }
  const admission = evaluateAdmission(exact, env.dsh)
  assert.equal(admission.status, 'admitted')

  const quiet = verdictFromAdmission({
    subject: { name: 'x', version: '1.0.0', kind: 'plugin' },
    env,
    admission,
    generatedAt: STAMP,
  })
  assert.equal(
    quiet.reasons.some((reason) => reason.messageId === 'admission.range-exact-pin'),
    false,
    'why/audit must stay quiet: this is shopping advice',
  )

  const advised = verdictFromAdmission({
    subject: { name: 'x', version: '1.0.0', kind: 'plugin' },
    env,
    admission,
    generatedAt: STAMP,
    rangeAdvice: true,
  })
  assert.equal(advised.conclusion, 'go')
  const pin = advised.reasons.find((reason) => reason.messageId === 'admission.range-exact-pin')
  assert.equal(pin?.params?.['key'], '@deepseek-ai/dsh-tools')
  assert.equal(pin?.severity, 'info')

  const unbounded = { peerDependencies: { '@deepseek-ai/dsh-tools': '*' } }
  const loose = verdictFromAdmission({
    subject: { name: 'x', version: '1.0.0', kind: 'plugin' },
    env,
    admission: evaluateAdmission(unbounded, env.dsh),
    generatedAt: STAMP,
    rangeAdvice: true,
  })
  assert.equal(loose.conclusion, 'go', 'a sloppy range is not a blocker')
  const open = loose.reasons.find((reason) => reason.messageId === 'admission.range-unbounded')
  assert.equal(open?.severity, 'warn')
})
