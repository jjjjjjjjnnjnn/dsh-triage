/**
 * Install-origin attribution (`npm explain` for the shadowing cases).
 *
 * CASE-10364 / CASE-10759 both hinge on one sentence the user had to reconstruct
 * by hand: "this copy is here because <plugin> lists it under dependencies".
 * These tests pin that sentence onto the row verdict, and pin the negative: a
 * peerDependencies edge is not an origin (peers do not install a copy).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verdictsFromRowAdmission, type EnvFingerprint, type RowDeclaration } from '@dsh-triage/core'

const STAMP = '2026-10-27T00:00:00.000Z'
const env: EnvFingerprint = {
  dsh: '0.2.1-rc.2',
  node: '22.19.0',
  platform: 'linux',
  arch: 'x64',
  profile: 'desktop',
  profileDir: '~/.dsh/profiles/desktop',
  bundles: [],
  installed: [],
}

const deniedManifest = {
  name: '@deepseek-ai/dsh-tools',
  version: '0.0.1-rc.1',
  peerDependencies: { '@deepseek-ai/dsh-agent': '^0.0.1-rc.1' },
}

function row(overrides: Partial<RowDeclaration> = {}): RowDeclaration {
  return {
    rowId: 'tools',
    module: '@deepseek-ai/dsh-tools',
    source: 'patch:profile',
    manifest: deniedManifest,
    version: '0.0.1-rc.1',
    ...overrides,
  }
}

test('a dependency-declared copy names the declaring plugin and the field', () => {
  const [verdict] = verdictsFromRowAdmission({
    env,
    rows: [row({ declaredBy: [{ name: 'dsh-pdf', version: '0.1.0', field: 'dependencies' }] })],
    generatedAt: STAMP,
  })
  assert.equal(verdict?.conclusion, 'blocked')
  const origin = verdict?.reasons.find((reason) => reason.code === 'admission-row-declared-by')
  assert.ok(origin, 'the deleting evidence must name where the copy came from')
  assert.deepEqual(origin?.params, { module: '@deepseek-ai/dsh-tools', by: 'dsh-pdf@0.1.0', fields: 'dependencies' })
  assert.ok(
    verdict?.evidence.some((item) => item.id === 'install-origin' && item.tier === 'scanned'),
    'origin is a scan fact, not a declaration',
  )
  assert.ok(
    verdict?.remediation.some((item) => item.kind === 'remove-plugin' && item.messageId === 'remediation.declared-by'),
    'the fix is move-to-peers / drop the declaring plugin, not pin a newer build',
  )
})

test('an optionalDependencies copy is still an origin', () => {
  const [verdict] = verdictsFromRowAdmission({
    env,
    rows: [row({ declaredBy: [{ name: 'dsh-opt', version: '2.0.0', field: 'optionalDependencies' }] })],
    generatedAt: STAMP,
  })
  const origin = verdict?.reasons.find((reason) => reason.code === 'admission-row-declared-by')
  assert.equal(origin?.params?.['fields'], 'optionalDependencies', 'optional deps do materialise a copy')
})

test('a peerDependencies edge is not an origin and adds no noise', () => {
  const [verdict] = verdictsFromRowAdmission({
    env,
    rows: [row({ declaredBy: [{ name: 'some-plugin', version: '1.0.0', field: 'peerDependencies' }] })],
    generatedAt: STAMP,
  })
  assert.equal(verdict?.conclusion, 'blocked')
  assert.ok(!verdict?.reasons.some((reason) => reason.code === 'admission-row-declared-by'), 'peers do not install a copy')
  assert.ok(!verdict?.remediation.some((item) => item.messageId === 'remediation.declared-by'))
})

test('several declaring plugins are listed together, deterministically', () => {
  const [verdict] = verdictsFromRowAdmission({
    env,
    rows: [
      row({
        declaredBy: [
          { name: 'b-plugin', version: '2.0.0', field: 'dependencies' },
          { name: 'a-plugin', version: '1.0.0', field: 'optionalDependencies' },
        ],
      }),
    ],
    generatedAt: STAMP,
  })
  const origin = verdict?.reasons.find((reason) => reason.code === 'admission-row-declared-by')
  assert.equal(origin?.params?.['by'], 'b-plugin@2.0.0, a-plugin@1.0.0')
  assert.equal(origin?.params?.['fields'], 'dependencies, optionalDependencies')
})

test('without an origin the verdict is unchanged (no extra reason, no extra fix)', () => {
  const [verdict] = verdictsFromRowAdmission({ env, rows: [row()], generatedAt: STAMP })
  assert.ok(!verdict?.reasons.some((reason) => reason.code === 'admission-row-declared-by'))
  assert.ok(!verdict?.remediation.some((item) => item.messageId === 'remediation.declared-by'))
})
