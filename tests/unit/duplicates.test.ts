/**
 * Duplicate-copy detection (borrowed from Maven's `dependencyConvergence`, `pip
 * check` and `npm explain`).
 *
 * The rule that matters: only **different versions** are a finding. pnpm puts one
 * version in two roots by hard link, and flagging that would bury the real signal.
 * The other rule: a finding must name both paths and both versions, because "two
 * copies exist" without locations is not actionable.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verdictsFromDuplicateCopies, type DuplicateCopy, type EnvFingerprint } from '@dsh-triage/core'

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

function duplicate(overrides: Partial<DuplicateCopy> = {}): DuplicateCopy {
  return {
    name: '@deepseek-ai/dsh-tools',
    kind: 'different-versions',
    copies: [
      { path: 'profiles/desktop/node_modules/@deepseek-ai/dsh-tools', version: '0.0.1-rc.1', scope: 'profile' },
      { path: 'profiles/node_modules/@deepseek-ai/dsh-tools', version: '0.2.1-rc.2', scope: 'shared' },
    ],
    ...overrides,
  }
}

test('two different versions produce one risky verdict naming both copies', () => {
  const verdicts = verdictsFromDuplicateCopies({ env, duplicates: [duplicate()], generatedAt: STAMP })
  assert.equal(verdicts.length, 1)
  const [verdict] = verdicts
  assert.equal(verdict?.conclusion, 'risky', 'the host may still boot: risky, not blocked')
  assert.equal(verdict?.subject.name, '@deepseek-ai/dsh-tools')
  assert.equal(verdict?.reasons[0]?.code, 'collision-duplicate-copy')
  const params = verdict?.reasons[0]?.params ?? {}
  assert.equal(params['versions'], '0.0.1-rc.1 vs 0.2.1-rc.2')
  assert.match(String(params['paths']), /profile:.*profile.*node_modules/)
  assert.equal(verdict?.evidence.length, 2, 'both copies must be cited as evidence')
  assert.ok(verdict?.evidence.every((item) => item.tier === 'scanned'))
  assert.ok((verdict?.remediation.length ?? 0) >= 1)
})

test('the same version in two roots is the normal pnpm picture, not a finding', () => {
  const same = duplicate({
    kind: 'same-version',
    copies: [
      { path: 'profiles/desktop/node_modules/x', version: '1.0.0', scope: 'profile' },
      { path: 'profiles/node_modules/x', version: '1.0.0', scope: 'shared' },
    ],
  })
  assert.deepEqual(verdictsFromDuplicateCopies({ env, duplicates: [same], generatedAt: STAMP }), [])
})

test('a lone copy is not a duplicate', () => {
  const single = duplicate({
    copies: [{ path: 'profiles/desktop/node_modules/x', version: '1.0.0', scope: 'profile' }],
  })
  assert.deepEqual(verdictsFromDuplicateCopies({ env, duplicates: [single], generatedAt: STAMP }), [])
})

test('a nested copy inside another plugin counts as the dangerous case', () => {
  const nested = duplicate({
    copies: [
      { path: 'profiles/desktop/node_modules/@deepseek-ai/dsh-tools', version: '0.2.1-rc.2', scope: 'profile' },
      {
        path: 'profiles/desktop/node_modules/dsh-pdf/node_modules/@deepseek-ai/dsh-tools',
        version: '0.0.1-rc.1',
        scope: 'nested',
      },
    ],
  })
  const [verdict] = verdictsFromDuplicateCopies({ env, duplicates: [nested], generatedAt: STAMP })
  assert.equal(verdict?.evidence.length, 2)
  assert.ok(verdict?.evidence.some((item) => item.source.includes('dsh-pdf/node_modules')))
})

test('output is deterministic and sorted by package name', () => {
  const input = {
    env,
    duplicates: [duplicate({ name: 'z-pkg' }), duplicate({ name: 'a-pkg' })],
    generatedAt: STAMP,
  }
  const first = verdictsFromDuplicateCopies(input)
  const second = verdictsFromDuplicateCopies(input)
  assert.deepEqual(second, first)
  assert.deepEqual(first.map((verdict) => verdict.subject.name), ['a-pkg', 'z-pkg'])
})
