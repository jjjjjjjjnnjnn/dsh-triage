import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  evaluateAdmission,
  mergeVerdicts,
  renderVerdict,
  verdictFromAdmission,
  verdictsFromCollisions,
  type EnvFingerprint,
  type Verdict,
} from '@dsh-triage/core'

const env: EnvFingerprint = {
  dsh: '0.2.1-rc.2',
  node: '24.15.0',
  platform: 'win32',
  arch: 'x64',
  profile: 'web',
  profileDir: 'C:/Users/test/.dsh/profiles/web',
  bundles: ['@deepseek-ai/dsh-base'],
  installed: [{ name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' }],
}

const stamp = '2026-10-26T00:00:00.000Z'

function verdictFor(manifest: unknown): Verdict {
  return verdictFromAdmission({
    subject: { name: 'example-plugin', version: '1.0.0', kind: 'plugin' },
    env,
    admission: evaluateAdmission(manifest, env.dsh),
    generatedAt: stamp,
  })
}

test('a denied declaration is blocked and always carries remediation', () => {
  const verdict = verdictFor({ peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.2.0-rc.2 <0.2.1-0' } })
  assert.equal(verdict.conclusion, 'blocked')
  assert.ok(verdict.remediation.length > 0)
  assert.ok(verdict.remediation.some((item) => item.kind === 'allow-version'))
  assert.ok(verdict.remediation.every((item) => item.note.length > 0))
})

test('blocked verdicts keep the exact exemption command with the real profile', () => {
  const verdict = verdictFor({ engines: { dsh: '0.2.0-rc.2' } })
  const allow = verdict.remediation.find((item) => item.kind === 'allow-version')
  assert.ok(allow?.command?.includes('--profile web'))
  assert.ok(allow?.command?.includes('example-plugin@1.0.0'))
  assert.ok(allow?.command?.includes('--dsh-version 0.2.1-rc.2'))
})

test('unknown is used when the plugin declares nothing, and names the missing evidence', () => {
  const verdict = verdictFor({})
  assert.equal(verdict.conclusion, 'unknown')
  assert.ok(verdict.missingEvidence.length > 0)
  assert.ok(verdict.missingEvidence.includes('missing.probe'))
})

test('declaration-only passes are graded medium confidence, not high', () => {
  const verdict = verdictFor({ engines: { dsh: '>=0.2.0-rc.1 <0.3.0-0' } })
  assert.equal(verdict.conclusion, 'go')
  assert.equal(verdict.confidence.level, 'medium')
  assert.equal(verdict.confidence.basis, 'declared')
  assert.ok(verdict.evidence.some((item) => item.tier === 'measured-local'), 'runtime scan is local evidence')
})

test('a higher minimum version recommends upgrading dsh rather than downgrading', () => {
  const verdict = verdictFor({ engines: { dsh: '>=0.2.1-rc.3' } })
  assert.ok(verdict.remediation.some((item) => item.kind === 'upgrade-dsh'))
})

test('entry id collisions are blocked and name the owners', () => {
  const verdicts = verdictsFromCollisions({
    env,
    generatedAt: stamp,
    collisions: [
      { id: 'tools', kind: 'conflicting-definitions', owners: ['bundle:a', 'bundle:b'], count: 2, names: ['x', 'y'] },
    ],
  })
  assert.equal(verdicts.length, 1)
  const [verdict] = verdicts
  assert.ok(verdict)
  assert.equal(verdict.conclusion, 'blocked')
  assert.equal(verdict.subject.kind, 'entry')
  assert.ok(verdict.remediation.some((item) => item.kind === 'disable-entry'))
  assert.ok(verdict.remediation.some((item) => item.note.includes('x vs y')))
})

test('merging keeps the worst conclusion and dedupes evidence', () => {
  const go = verdictFor({ engines: { dsh: '>=0.2.0-rc.1 <0.3.0-0' } })
  const blocked = verdictFor({ engines: { dsh: '0.2.0-rc.2' } })
  const merged = mergeVerdicts([go, blocked, go])
  assert.equal(merged.conclusion, 'blocked')
  const ids = merged.evidence.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('rendering is deterministic and mentions evidence provenance', () => {
  const verdict = verdictFor({ engines: { dsh: '0.2.0-rc.2' } })
  const zh = renderVerdict(verdict, 'zh')
  const en = renderVerdict(verdict, 'en')
  assert.equal(zh, renderVerdict(verdict, 'zh'))
  assert.match(zh, /不可用/)
  assert.match(en, /not usable/)
  assert.match(zh, /evidence/)
})
