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
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { verdictsFromDuplicateCopies, type DuplicateCopy, type EnvFingerprint } from '@dsh-triage/core'
import { findDuplicateCopies } from '../../packages/plugin/dist/load.js'

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

/*
 * T-866 / R92: measured on a real machine, 13 of 13 duplicates were plain libraries and none was
 * a bundle or a harness package, yet all 13 would have opened the screen as "issues". A duplicate
 * is a finding only when the package can collide inside DSH; the rest are counted, not surfaced.
 */

test('a plain library twice is counted, not a finding', () => {
  const library = duplicate({
    name: '@babel/runtime',
    surface: false,
    copies: [
      { path: 'profiles/desktop/node_modules/@babel/runtime', version: '7.29.13', scope: 'profile' },
      { path: 'profiles/node_modules/@babel/runtime', version: '7.29.7', scope: 'shared' },
    ],
  })
  assert.deepEqual(verdictsFromDuplicateCopies({ env, duplicates: [library], generatedAt: STAMP }), [])
})

test('a harness package twice is still a finding — that is the identity-split case', () => {
  const harness = duplicate({ name: '@deepseek-ai/dsh-agent', surface: true })
  const verdicts = verdictsFromDuplicateCopies({ env, duplicates: [harness], generatedAt: STAMP })
  assert.equal(verdicts.length, 1)
  assert.equal(verdicts[0]?.conclusion, 'risky')
})

test('a profile bundle twice is still a finding even if it is not a harness package', () => {
  const bundleEnv: EnvFingerprint = { ...env, bundles: ['dshmarket', '@deepseek-ai/dsh-base'] }
  const plugin = duplicate({ name: 'dshmarket', surface: true })
  assert.equal(verdictsFromDuplicateCopies({ env: bundleEnv, duplicates: [plugin], generatedAt: STAMP }).length, 1)
})

test('an unstated surface is treated as a finding, never silently downgraded', () => {
  // Hand-built duplicates (benchmarks, older callers) carry no field; dropping them would turn a
  // missing property into a conclusion.
  const unstated = duplicate({ name: 'some-library' })
  assert.equal(unstated.surface, undefined)
  assert.equal(verdictsFromDuplicateCopies({ env, duplicates: [unstated], generatedAt: STAMP }).length, 1)
})

test('an unknown version is not evidence of a different version', () => {
  const unknownVsKnown = duplicate({
    copies: [
      { path: 'profiles/desktop/node_modules/x', version: null, scope: 'profile' },
      { path: 'profiles/node_modules/x', version: '1.0.0', scope: 'shared' },
    ],
  })
  assert.deepEqual(
    verdictsFromDuplicateCopies({ env, duplicates: [unknownVsKnown], generatedAt: STAMP }),
    [],
    'cannot prove two different versions from one unreadable manifest',
  )

  const twoUnknowns = duplicate({
    kind: 'same-version',
    copies: [
      { path: 'profiles/desktop/node_modules/x', version: null, scope: 'profile' },
      { path: 'profiles/node_modules/x', version: null, scope: 'shared' },
    ],
  })
  assert.deepEqual(verdictsFromDuplicateCopies({ env, duplicates: [twoUnknowns], generatedAt: STAMP }), [])
})

test('versions are ordered numerically, so the subject carries the higher one', () => {
  const [verdict] = verdictsFromDuplicateCopies({
    env,
    duplicates: [
      duplicate({
        copies: [
          { path: 'profiles/desktop/node_modules/x', version: '0.9.0', scope: 'profile' },
          { path: 'profiles/node_modules/x', version: '0.10.0', scope: 'shared' },
        ],
      }),
    ],
    generatedAt: STAMP,
  })
  assert.equal(verdict?.reasons[0]?.params?.['versions'], '0.9.0 vs 0.10.0')
  assert.equal(verdict?.subject.version, '0.10.0', 'string ordering would have picked 0.9.0')
})

test('a linked copy is reported and marked in evidence', () => {
  const [verdict] = verdictsFromDuplicateCopies({
    env,
    duplicates: [
      duplicate({
        copies: [
          { path: 'profiles/desktop/node_modules/x', version: '1.0.0', scope: 'profile' },
          { path: 'profiles/desktop/node_modules/linked-x', version: '2.0.0', scope: 'nested', linked: true },
        ],
      }),
    ],
    generatedAt: STAMP,
  })
  assert.equal(verdict?.conclusion, 'risky')
  assert.equal(verdict?.evidence.length, 2)
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

/*
 * The scanner decides `surface` from the profile itself, so the rule cannot drift from the data it
 * is judging: a bundle in `dsh.profile.bundles` and a `@deepseek-ai/dsh*` package can collide; a
 * plain library that merely exists twice cannot.
 */
test('the scan labels a bundle and a harness package as surface, a library as not', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-dup-'))
  const home = join(root, 'home')
  const profileDir = join(home, 'profiles', 'desktop')
  const write = (path: string, value: unknown): void => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  }

  // Two versions of each, in the two roots the scanner reads.
  for (const [scope, dir] of [
    ['profile', join(profileDir, 'node_modules')],
    ['shared', join(home, 'profiles', 'node_modules')],
  ] as const) {
    write(join(dir, 'dshmarket', 'package.json'), { name: 'dshmarket', version: scope === 'profile' ? '2.0.0' : '1.0.0' })
    write(join(dir, '@deepseek-ai', 'dsh-agent', 'package.json'), {
      name: '@deepseek-ai/dsh-agent',
      version: scope === 'profile' ? '0.2.2-rc.1' : '0.1.0-rc.6',
    })
    write(join(dir, '@babel', 'runtime', 'package.json'), {
      name: '@babel/runtime',
      version: scope === 'profile' ? '7.29.13' : '7.29.7',
    })
  }
  write(join(profileDir, 'package.json'), {
    name: 'dsh-profile-test',
    dsh: { profile: { bundles: ['dshmarket'] } },
  })

  const scanned = await findDuplicateCopies({
    dsh: '0.2.2-rc.1',
    node: '22.19.0',
    platform: 'win32',
    arch: 'x64',
    profile: 'desktop',
    profileDir,
    bundles: ['dshmarket'],
    installed: [],
  })

  const surfaceOf = new Map(scanned.map((entry) => [entry.name, entry.surface]))
  assert.equal(surfaceOf.get('dshmarket'), true, 'a profile bundle can collide')
  assert.equal(surfaceOf.get('@deepseek-ai/dsh-agent'), true, 'a harness package can collide')
  assert.equal(surfaceOf.get('@babel/runtime'), false, 'a plain library that exists twice cannot')
})
