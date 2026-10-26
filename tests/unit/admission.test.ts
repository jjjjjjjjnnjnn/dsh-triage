import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateAdmission, evaluateRange } from '@dsh-triage/core'

const RUNTIME = '0.2.1-rc.2'

test('engines.dsh decides on its own and peers are ignored', () => {
  const result = evaluateAdmission(
    { engines: { dsh: '>=0.2.0-rc.1 <0.3.0-0' }, peerDependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' } },
    RUNTIME,
  )
  assert.equal(result.status, 'admitted')
  assert.equal(result.mode, 'engines')
  assert.equal(result.requirements.length, 1)
})

test('peers are ANDed: one failure denies and names the requirement', () => {
  const result = evaluateAdmission(
    {
      peerDependencies: {
        '@deepseek-ai/dsh': '^0.2.0-rc.1',
        '@deepseek-ai/dsh-agent': '>=0.2.1-rc.3',
      },
    },
    RUNTIME,
  )
  assert.equal(result.status, 'denied')
  assert.deepEqual(
    result.unmet.map((requirement) => requirement.key),
    ['@deepseek-ai/dsh-agent'],
  )
})

test('no declaration means unconstrained, not admitted', () => {
  const result = evaluateAdmission({}, RUNTIME)
  assert.equal(result.status, 'unconstrained')
  assert.equal(result.mode, 'none')
})

test('an empty range is incompatible even though semver would treat it as *', () => {
  const evaluated = evaluateRange('', RUNTIME)
  assert.equal(evaluated.satisfied, false)
  assert.equal(evaluated.failure, 'empty-range')
  assert.equal(evaluateAdmission({ engines: { dsh: '' } }, RUNTIME).status, 'denied')
})

test('invalid, workspace and malformed declarations deny instead of throwing', () => {
  assert.equal(evaluateRange('not a range', RUNTIME).failure, 'invalid-range')
  assert.equal(evaluateRange('workspace:^', RUNTIME).failure, 'workspace-protocol')
  assert.equal(evaluateRange(2026, RUNTIME).failure, 'malformed-manifest')
  assert.equal(evaluateAdmission({ engines: { dsh: 2026 } }, RUNTIME).status, 'denied')
})

test('cordis peers are not admission inputs', () => {
  const result = evaluateAdmission({ peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' } }, RUNTIME)
  assert.equal(result.status, 'unconstrained')
})

test('prereleases participate in matching', () => {
  assert.equal(evaluateRange('^0.2.0', RUNTIME).satisfied, true)
  assert.equal(evaluateRange('^0.2.1-rc.2', RUNTIME).satisfied, true)
  assert.equal(evaluateRange('0.2.0-rc.2', RUNTIME).satisfied, false)
})

test('missing runtime is indeterminate, never silently admitted', () => {
  const result = evaluateAdmission({ engines: { dsh: '>=0.2.0-rc.1' } }, null)
  assert.equal(result.status, 'indeterminate')
  assert.equal(result.indeterminateReason, 'runtime-version-unknown')
})

test('requirement order is stable so output can be diffed', () => {
  const manifest = {
    peerDependencies: {
      '@deepseek-ai/dsh-tools': '^0.2.0',
      '@deepseek-ai/dsh-agent': '^0.1.0',
      '@deepseek-ai/dsh': '^0.2.0',
    },
  }
  const first = evaluateAdmission(manifest, RUNTIME).requirements.map((requirement) => requirement.key)
  assert.deepEqual(first, ['@deepseek-ai/dsh', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-tools'])
})
