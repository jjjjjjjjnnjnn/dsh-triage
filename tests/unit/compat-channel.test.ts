/**
 * `dsh.compatibility` as secondary evidence (R9 / T-108, blind spot BS-13).
 *
 * WHY THIS FILE EXISTS: CASE-7590 was scored as a miss because neither plugin
 * declares an `@deepseek-ai/dsh*` peer. The R6 adversary pass found that
 * `@xmanrui/dsh-im` does publish a machine-readable statement —
 * `dsh.compatibility.dsh = 0.1.7-alpha.1` + `dshReleases` — that the engine never
 * read. Reading it must never turn into a second, weaker admission engine, so the
 * tier-discipline controls below are the point of the file.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  evaluateAdmission,
  judgeCompatChannel,
  readCompatChannel,
  verdictFromAdmission,
  verdictsFromRowAdmission,
  type EnvFingerprint,
  type RowDeclaration,
} from '@dsh-triage/core'

const STAMP = '2026-10-27T00:00:00.000Z'

const env: EnvFingerprint = {
  dsh: '0.1.7-alpha.2',
  node: '24.15.0',
  platform: 'win32',
  arch: 'x64',
  profile: 'case7590',
  profileDir: '<sandbox>/profiles/case7590',
  bundles: [],
  installed: [{ name: '@deepseek-ai/dsh', version: '0.1.7-alpha.2' }],
}

/** The real shape of `@xmanrui/dsh-im@4.26.0` (trimmed to the fields that matter). */
const dshImManifest = {
  name: '@xmanrui/dsh-im',
  engines: { node: '>=22.19' },
  dsh: {
    compatibility: {
      dsh: '0.1.7-alpha.1',
      profiles: ['web'],
      dshReleases: { '0.1.7-alpha.1': 'compatible' },
    },
  },
}

/** `@liustack/modlens@3.26.3` publishes no compatibility channel at all. */
const modlensManifest = { name: '@liustack/modlens', engines: { node: '>=22.19' } }

test('the channel is read verbatim, and its claim is one actionable line', () => {
  const channel = readCompatChannel(dshImManifest)
  assert.ok(channel)
  assert.equal(channel.pinned, '0.1.7-alpha.1')
  assert.deepEqual(channel.releases, [{ version: '0.1.7-alpha.1', status: 'compatible' }])
  assert.deepEqual(channel.profiles, ['web'])
  assert.equal(channel.claim, 'dsh 0.1.7-alpha.1')
})

test('a manifest without the channel reports nothing, never "compatible"', () => {
  assert.equal(readCompatChannel(modlensManifest), null)
  assert.equal(judgeCompatChannel(modlensManifest, env.dsh), null)
  // Malformed shapes degrade to "no channel" instead of a guess.
  assert.equal(readCompatChannel({ dsh: { compatibility: 'yes' } }), null)
  assert.equal(readCompatChannel({ dsh: { compatibility: { dshReleases: ['0.1.0'] } } }), null)
  assert.equal(readCompatChannel(null), null)
})

test('the exact dshReleases entry beats the broader dsh statement', () => {
  const manifest = {
    dsh: { compatibility: { dsh: '0.1.0', dshReleases: { '0.2.1-rc.3': 'compatible' } } },
  }
  const reading = judgeCompatChannel(manifest, '0.2.1-rc.3')
  assert.equal(reading?.standing, 'match', 'the per-version statement is the author being specific')
  const other = judgeCompatChannel(manifest, '0.2.1-rc.4')
  assert.equal(other?.standing, 'mismatch')
})

test('release keys are compared the way an author writes them (R9 adversary finding)', () => {
  // A byte comparison missed the explicit entry, fell through to `dsh: "*"` and
  // reported a *match* for a build the author had marked incompatible — the one
  // direction this channel must never get wrong.
  const manifest = { dsh: { compatibility: { dsh: '*', dshReleases: { 'v0.1.7-alpha.2': 'incompatible' } } } }
  assert.equal(judgeCompatChannel(manifest, '0.1.7-alpha.2')?.standing, 'mismatch')
  const padded = { dsh: { compatibility: { dshReleases: { ' 0.1.7-alpha.2 ': 'compatible' } } } }
  assert.equal(judgeCompatChannel(padded, '0.1.7-alpha.2')?.standing, 'match')
  // Guards against a loose normaliser: a different build must not match.
  assert.equal(judgeCompatChannel(padded, '0.1.7-alpha.3')?.standing, 'unknown')
})

test('an unknown release status is not treated as compatible', () => {
  const manifest = { dsh: { compatibility: { dshReleases: { '0.1.7-alpha.2': 'untested' } } } }
  assert.equal(judgeCompatChannel(manifest, '0.1.7-alpha.2')?.standing, 'mismatch')
})

test('profiles alone cannot judge a version', () => {
  const manifest = { dsh: { compatibility: { profiles: ['web'] } } }
  assert.equal(judgeCompatChannel(manifest, '0.1.7-alpha.2')?.standing, 'unknown')
  assert.equal(judgeCompatChannel(manifest, null)?.standing, 'unknown')
})

// --- tier discipline (the negative controls) --------------------------------

test('the channel can never upgrade a passing declaration into "declared fine"', () => {
  const manifest = { engines: { dsh: '>=0.1.0' }, dsh: { compatibility: { dsh: '0.1.7-alpha.1' } } }
  const admission = evaluateAdmission(manifest, env.dsh)
  assert.equal(admission.status, 'admitted')
  const verdict = verdictFromAdmission({
    subject: { name: 'x', version: '1.0.0', kind: 'plugin' },
    env,
    admission,
    generatedAt: STAMP,
    manifest,
  })
  assert.equal(verdict.conclusion, 'go', 'the conclusion still comes from the peer range only')
  const warn = verdict.reasons.find((reason) => reason.messageId === 'admission.compat-channel-mismatch')
  assert.ok(warn, 'the disagreement must be visible as a separate reason')
  assert.equal(warn.severity, 'warn', 'never a block')
})

test('the channel can never soften a denial into a pass', () => {
  const manifest = {
    peerDependencies: { '@deepseek-ai/dsh-tools': '0.1.6-alpha.2' },
    dsh: { compatibility: { dsh: '0.1.7-alpha.2', dshReleases: { '0.1.7-alpha.2': 'compatible' } } },
  }
  const admission = evaluateAdmission(manifest, env.dsh)
  assert.equal(admission.status, 'denied')
  const verdict = verdictFromAdmission({
    subject: { name: 'x', version: '1.0.0', kind: 'plugin' },
    env,
    admission,
    generatedAt: STAMP,
    manifest,
  })
  assert.equal(verdict.conclusion, 'blocked', 'a self-declaration never overrides the peer range')
})

test('the channel alone never blocks: worst case is unknown', () => {
  const manifest = { dsh: { compatibility: { dsh: '0.0.1' } } }
  const admission = evaluateAdmission(manifest, env.dsh)
  assert.equal(admission.status, 'unconstrained')
  const verdict = verdictFromAdmission({
    subject: { name: 'x', version: '1.0.0', kind: 'plugin' },
    env,
    admission,
    generatedAt: STAMP,
    manifest,
  })
  assert.equal(verdict.conclusion, 'unknown')
  assert.ok(verdict.missingEvidence.includes('missing.admission'))
  assert.ok(
    verdict.reasons.some((reason) => reason.messageId === 'admission.compat-channel-mismatch'),
    'when there is no peer range, the author channel is the only thing worth naming',
  )
})

// --- the case that motivated all of this ------------------------------------

test('CASE-7590 rows: unknown instead of silence, with the unread channel named', () => {
  const rows: RowDeclaration[] = [
    { rowId: 'dsh-im', module: '@xmanrui/dsh-im', source: 'patch:profile', manifest: dshImManifest, version: '4.26.0' },
    { rowId: 'modlens', module: '@liustack/modlens', source: 'patch:profile', manifest: modlensManifest, version: '3.26.3' },
  ]
  const verdicts = verdictsFromRowAdmission({ env, rows, generatedAt: STAMP })
  assert.equal(verdicts.length, 2, 'two modules, two unknowns — the case no longer produces zero verdicts')

  const im = verdicts.find((verdict) => verdict.subject.name === '@xmanrui/dsh-im')
  assert.equal(im?.conclusion, 'unknown')
  const mismatch = im?.reasons.find((reason) => reason.messageId === 'admission.compat-channel-mismatch')
  assert.equal(mismatch?.params?.['claim'], 'dsh 0.1.7-alpha.1')
  assert.equal(mismatch?.params?.['runtime'], '0.1.7-alpha.2')
  assert.ok(
    im?.evidence.some((item) => item.id === 'compat-channel' && item.tier === 'declared'),
    'secondary evidence is attached, with its tier, next to the admission conclusion',
  )

  const modlens = verdicts.find((verdict) => verdict.subject.name === '@liustack/modlens')
  assert.equal(modlens?.conclusion, 'unknown')
  assert.deepEqual(modlens?.missingEvidence, ['missing.peer-declaration'])
  assert.ok(
    modlens?.evidence.every((item) => item.id !== 'compat-channel'),
    'no channel means no invented evidence',
  )
})
