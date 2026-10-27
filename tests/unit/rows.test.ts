/**
 * Row-level admission attribution (CASE-11080).
 *
 * WHY THIS FILE EXISTS: upstream admits or rejects the module a **loader row**
 * imports. A profile whose rows are pinned to the previous build loses those
 * rows silently after an upgrade — the only trace is one stderr line. Judging
 * bundles alone produced a false "no denials" for exactly that case, so the
 * negative controls below are as important as the happy path.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  verdictsFromRowAdmission,
  rowTargets,
  type EntryClaim,
  type EnvFingerprint,
  type RowDeclaration,
} from '@dsh-triage/core'

const env: EnvFingerprint = {
  dsh: '0.2.1-rc.3',
  node: '24.15.0',
  platform: 'win32',
  arch: 'x64',
  profile: 'case11080',
  profileDir: 'C:/Users/test/.dsh/profiles/case11080',
  bundles: [],
  installed: [{ name: '@deepseek-ai/dsh', version: '0.2.1-rc.3' }],
}

const stamp = '2026-10-26T00:00:00.000Z'

/** The real shape of `@deepseek-ai/dsh-hooks-claude-code@0.2.1-rc.2`. */
const pinnedPeers = {
  peerDependencies: {
    '@deepseek-ai/cordis': '~4.0.5',
    '@deepseek-ai/dsh-llm': '0.2.1-rc.2',
    '@deepseek-ai/dsh-tools': '0.2.1-rc.2',
  },
}

function row(overrides: Partial<RowDeclaration> & Pick<RowDeclaration, 'rowId' | 'module'>): RowDeclaration {
  return {
    source: 'patch:profile',
    manifest: pinnedPeers,
    version: '0.2.1-rc.2',
    ...overrides,
  }
}

test('a row pinned to the previous build is blocked and names itself', () => {
  const verdicts = verdictsFromRowAdmission({
    env,
    rows: [row({ rowId: 'hooks-claude-code', module: '@deepseek-ai/dsh-hooks-claude-code' })],
    generatedAt: stamp,
  })
  assert.equal(verdicts.length, 1, 'one module, one verdict')
  const [verdict] = verdicts
  assert.ok(verdict)
  assert.equal(verdict.conclusion, 'blocked')
  assert.equal(verdict.subject.kind, 'entry')
  assert.equal(verdict.subject.name, '@deepseek-ai/dsh-hooks-claude-code')
  assert.equal(verdict.subject.version, '0.2.1-rc.2')

  // The row id must reach the reader, otherwise the user cannot act on it.
  const scope = verdict.reasons.find((reason) => reason.messageId === 'admission.row-scope')
  assert.equal(scope?.params?.['rows'], 'hooks-claude-code')

  const peer = verdict.reasons.find((reason) => reason.messageId === 'admission.unmet.peer')
  assert.equal(peer?.params?.['key'], '@deepseek-ai/dsh-llm')
  assert.equal(peer?.params?.['runtime'], '0.2.1-rc.3')

  assert.ok(
    verdict.remediation.some((item) => item.kind === 'disable-entry' && item.params?.['id'] === 'hooks-claude-code'),
    'the fix must name the exact row to disable',
  )
  assert.ok(verdict.remediation.some((item) => item.kind === 'allow-version'))
})

test('two rows importing the same module collapse into one verdict that lists both', () => {
  const verdicts = verdictsFromRowAdmission({
    env,
    rows: [
      row({ rowId: 'hooks-a', module: '@deepseek-ai/dsh-hooks-claude-code', source: 'patch:profile' }),
      row({ rowId: 'hooks-b', module: '@deepseek-ai/dsh-hooks-claude-code', source: 'bundle:@deepseek-ai/dsh-base' }),
    ],
    generatedAt: stamp,
  })
  assert.equal(verdicts.length, 1)
  const [verdict] = verdicts
  assert.ok(verdict)
  const scope = verdict.reasons.find((reason) => reason.messageId === 'admission.row-scope')
  assert.equal(scope?.params?.['rows'], 'hooks-a, hooks-b')
  assert.match(String(scope?.params?.['source']), /bundle:@deepseek-ai\/dsh-base/)
  assert.equal(verdict.remediation.filter((item) => item.kind === 'disable-entry').length, 2)
})

test('a row whose package is not installed is unknown, never silently fine', () => {
  const verdicts = verdictsFromRowAdmission({
    env,
    rows: [row({ rowId: 'ghost-row', module: 'dsh-plugin-that-was-removed', manifest: null, version: null })],
    generatedAt: stamp,
  })
  assert.equal(verdicts.length, 1)
  const [verdict] = verdicts
  assert.ok(verdict)
  assert.equal(verdict.conclusion, 'unknown')
  assert.deepEqual(verdict.missingEvidence, ['missing.row-module'])
  assert.ok(verdict.remediation.length > 0, 'unknown still needs a next step')
})

test('a row that declares nothing is unknown, not silent (R9 / T-107)', () => {
  // CASE-7590: neither plugin declares an @deepseek-ai/dsh* peer, so the old engine
  // produced zero verdicts — indistinguishable from "everything is fine".
  const verdicts = verdictsFromRowAdmission({
    env,
    rows: [
      row({ rowId: 'dsh-im', module: '@xmanrui/dsh-im', manifest: { name: '@xmanrui/dsh-im' }, version: '4.26.0' }),
      row({ rowId: 'modlens', module: '@liustack/modlens', manifest: { name: '@liustack/modlens' }, version: '3.26.3' }),
    ],
    generatedAt: stamp,
  })
  assert.equal(verdicts.length, 2, 'one unknown per module — never silence')
  for (const verdict of verdicts) {
    assert.equal(verdict.conclusion, 'unknown')
    assert.deepEqual(verdict.missingEvidence, ['missing.peer-declaration'])
    assert.ok(
      verdict.reasons.some((reason) => reason.messageId === 'admission.row-unconstrained'),
      'the reason must be the row-level one, not the bundle-level admission.unconstrained',
    )
    assert.ok(verdict.remediation.length > 0, 'unknown still needs a next step')
    assert.equal(verdict.subject.kind, 'entry')
  }
  const im = verdicts.find((verdict) => verdict.subject.name === '@xmanrui/dsh-im')
  const reason = im?.reasons.find((item) => item.messageId === 'admission.row-unconstrained')
  assert.equal(reason?.params?.['rows'], 'dsh-im')
  assert.equal(reason?.params?.['module'], '@xmanrui/dsh-im')
})

test('several undeclared rows for one module collapse into a single unknown', () => {
  const verdicts = verdictsFromRowAdmission({
    env,
    rows: [
      row({ rowId: 'im-a', module: '@xmanrui/dsh-im', manifest: {} }),
      row({ rowId: 'im-b', module: '@xmanrui/dsh-im', manifest: {} }),
    ],
    generatedAt: stamp,
  })
  assert.equal(verdicts.length, 1)
  const [verdict] = verdicts
  const reason = verdict?.reasons.find((item) => item.messageId === 'admission.row-unconstrained')
  assert.equal(reason?.params?.['rows'], 'im-a, im-b', 'the reader needs every row that pulled the module in')
})

test('rows that admit the running build stay silent', () => {
  const verdicts = verdictsFromRowAdmission({
    env,
    rows: [row({ rowId: 'ok-row', module: 'dsh-plugin-fine', manifest: { engines: { dsh: '>=0.2.0-rc.1 <0.3.0-0' } }, version: '1.2.3' })],
    generatedAt: stamp,
  })
  assert.deepEqual(verdicts, [], 'no news is not a finding')
})

test('without a runtime version row-level attribution stays silent', () => {
  const verdicts = verdictsFromRowAdmission({
    env: { ...env, dsh: null },
    rows: [row({ rowId: 'hooks-claude-code', module: '@deepseek-ai/dsh-hooks-claude-code' })],
    generatedAt: stamp,
  })
  assert.deepEqual(verdicts, [], 'bundle verdicts already report the unknown runtime')
})

test('rowTargets keeps only rows that import a module', () => {
  const claims: EntryClaim[] = [
    { id: 'group-a', name: null, disabled: false, group: true, source: 'patch:profile', depth: 0 },
    { id: 'config-only', name: null, disabled: false, group: false, source: 'patch:profile', depth: 0 },
    { id: 'disabled-row', name: '@deepseek-ai/dsh-hooks-claude-code', disabled: true, group: false, source: 'patch:home', depth: 0 },
    { id: 'hooks-row', name: '@deepseek-ai/dsh-hooks-claude-code', disabled: false, group: false, source: 'patch:profile', depth: 0 },
    { id: 'hooks-row', name: '@deepseek-ai/dsh-hooks-claude-code', disabled: false, group: false, source: 'patch:profile', depth: 0 },
  ]
  const targets = rowTargets(claims)
  assert.deepEqual(
    targets.map((target) => `${target.source}#${target.rowId}`),
    ['patch:profile#hooks-row'],
    'groups, config-only overrides, disabled rows and repeats are not admission targets',
  )
})
