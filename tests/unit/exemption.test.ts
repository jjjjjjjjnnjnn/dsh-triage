/**
 * Exemptions (T-816): the profile can grant an exact plugin@version permission to run on an exact
 * runtime. The loader honours it at boot; our audit had ignored it, so a profile the runtime admits
 * was reported as blocked. These tests pin both halves: the reader's refusal behaviour, and the
 * verdict change (blocked → go, with the risk still visible).
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  isExactExemptionVersion,
  isExempted,
  parseExemptionKey,
  readProfileExemptions,
  verdictsFromRowAdmission,
  type EnvFingerprint,
  type RowDeclaration,
} from '../../packages/core/dist/index.js'

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'triage-exemption-'))
}

function env(): EnvFingerprint {
  return {
    dsh: '0.2.1-rc.4',
    node: 'v24.15.0',
    platform: 'win32',
    arch: 'x64',
    profile: 'web',
    profileDir: join('~', '.dsh', 'profiles', 'web'),
    bundles: [],
    installed: [],
  }
}

/** A row whose manifest denies the running runtime (peer/engines both too old). */
function deniedRow(): RowDeclaration {
  return {
    rowId: 'hmr',
    module: '@fixture/plugin',
    source: 'profile:web#patch',
    manifest: { name: '@fixture/plugin', version: '1.2.3', engines: { dsh: '0.1.0-rc.6' } },
    version: '1.2.3',
  }
}

/* --------------------------------- reader --------------------------------- */

test('exact-version keys are parsed, ranges are not', () => {
  assert.deepEqual(parseExemptionKey('@scope/name@1.2.3'), { name: '@scope/name', version: '1.2.3' })
  assert.deepEqual(parseExemptionKey('p@0.2.1-rc.4'), { name: 'p', version: '0.2.1-rc.4' })
  assert.equal(parseExemptionKey('p@^1.0.0'), null)
  assert.equal(parseExemptionKey('p'), null)
  assert.equal(isExactExemptionVersion('1.2.3'), true)
  assert.equal(isExactExemptionVersion('1.2'), false)
})

test('a missing file authorizes nothing but stays writable; a broken one authorizes nothing and is not', () => {
  const empty = dir()
  const broken = dir()
  try {
    assert.deepEqual(readProfileExemptions(empty), { exemptions: {}, rewritable: true, warnings: [] })

    writeFileSync(join(broken, 'compatibility.json'), '{ nope', 'utf8')
    const reading = readProfileExemptions(broken)
    assert.deepEqual(reading.exemptions, {})
    assert.equal(reading.rewritable, false, 'rewriting would discard whatever the user has')
    assert.match(reading.warnings[0] ?? '', /cannot be read|comparing/)

    writeFileSync(join(broken, 'compatibility.json'), JSON.stringify({ 'p@1.0.0': ['0.2.0'] }), 'utf8')
    const valid = readProfileExemptions(broken)
    assert.deepEqual(valid.exemptions, { 'p@1.0.0': ['0.2.0'] })
    assert.equal(valid.rewritable, true)
  } finally {
    rmSync(empty, { recursive: true, force: true })
    rmSync(broken, { recursive: true, force: true })
  }
})

test('an exemption matches the exact pair only', () => {
  const exemptions = { '@fixture/plugin@1.2.3': ['0.2.1-rc.4'] }
  assert.equal(isExempted(exemptions, '@fixture/plugin', '1.2.3', '0.2.1-rc.4'), true)
  assert.equal(isExempted(exemptions, '@fixture/plugin', '1.2.3', '0.2.1-rc.5'), false, 'not another runtime')
  assert.equal(isExempted(exemptions, '@fixture/plugin', '1.2.4', '0.2.1-rc.4'), false, 'not another version')
  assert.equal(isExempted(exemptions, '@fixture/plugin', null, '0.2.1-rc.4'), false, 'no version means no match')
})

/* --------------------------------- verdict -------------------------------- */

test('without an exemption the row is blocked (the behaviour we had)', () => {
  const verdicts = verdictsFromRowAdmission({ env: env(), rows: [deniedRow()], generatedAt: '2026-10-30T00:00:00.000Z' })
  assert.equal(verdicts.length, 1)
  assert.equal(verdicts[0]?.conclusion, 'blocked')
})

test('with an exemption the row is admitted — and the risk is still stated', () => {
  const verdicts = verdictsFromRowAdmission({
    env: env(),
    rows: [deniedRow()],
    exemptions: { '@fixture/plugin@1.2.3': ['0.2.1-rc.4'] },
    generatedAt: '2026-10-30T00:00:00.000Z',
  })
  assert.equal(verdicts.length, 1)
  assert.equal(verdicts[0]?.conclusion, 'go', 'the loader admits it, so `blocked` would be wrong')
  const exempted = verdicts[0]?.reasons.find((reason) => reason.code === 'admission-exempted')
  assert.ok(exempted, 'the exemption must leave a reason behind')
  assert.equal(exempted?.severity, 'warn')
  assert.deepEqual(exempted?.params, { module: '@fixture/plugin', version: '1.2.3', runtime: '0.2.1-rc.4' })
  // The unmet requirements stay in the reasons: an exemption does not make the declaration true.
  assert.ok(verdicts[0]?.reasons.some((reason) => reason.messageId === 'admission.unmet.peer' || reason.code.startsWith('admission-denied')))
})

test('an exemption for a different version changes nothing', () => {
  const verdicts = verdictsFromRowAdmission({
    env: env(),
    rows: [deniedRow()],
    exemptions: { '@fixture/plugin@1.2.2': ['0.2.1-rc.4'] },
    generatedAt: '2026-10-30T00:00:00.000Z',
  })
  assert.equal(verdicts[0]?.conclusion, 'blocked')
})
