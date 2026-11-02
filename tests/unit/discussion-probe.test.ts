/**
 * One probe implementation for R57 and R59, pinned (R59).
 *
 * Every test here is a way the probe could lie: judging `latest` when the thread named a version,
 * treating a 404 as a denial, or judging a bare name that is a different registry entry.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  packumentFromSnapshot,
  pinnedVersions,
  probePackage,
  selectProbeTargets,
} from '../../scripts/lib/discussion-probe.mjs'

const TARGET = '0.2.1-rc.5'

const packument = (name: string, versions: Record<string, unknown>, latest: string | null) => ({
  ok: true as const,
  value: {
    name,
    latest,
    versions: new Map(
      Object.entries(versions).map(([version, manifest]) => [
        version,
        { version, ...(manifest as Record<string, unknown>) },
      ]),
    ),
    modified: null,
    distTags: latest === null ? {} : { latest },
    publishedAt: {},
  },
})

const loaderFor = (value: ReturnType<typeof packument>) => async () => value

test('a thread that pinned a version is judged at that version, not at latest', async () => {
  const fetch = loaderFor(
    packument('@scope/pkg', {
      '0.1.0-rc.1': { engines: { dsh: '>=0.1.0 <0.2.0-0' } },
      '0.2.1-rc.4': { engines: { dsh: '>=0.2.0 <0.2.2-0' } },
    }, '0.1.0-rc.1'),
  )
  const result = await probePackage('@scope/pkg', TARGET, { pinned: '0.2.1-rc.4', loadPackument: fetch })
  assert.equal(result.state, 'measured')
  assert.equal(result.version, '0.2.1-rc.4')
  assert.equal(result.version_source, 'thread-pinned')
  assert.equal(result.admission_status, 'admitted')
})

test('without a pin the registry latest is used, and the choice is recorded', async () => {
  const fetch = loaderFor(
    packument('pkg', {
      '0.1.0': { engines: { dsh: '^0.1.0' } },
      '0.2.1-rc.4': { engines: { dsh: '>=0.2.0 <0.2.2-0' } },
    }, '0.2.1-rc.4'),
  )
  const result = await probePackage('pkg', TARGET, { loadPackument: fetch })
  assert.equal(result.version, '0.2.1-rc.4')
  assert.equal(result.version_source, 'latest')
  assert.equal(result.admission_status, 'admitted')
})

test('a 404 is unreadable, never denied', async () => {
  const result = await probePackage('missing', TARGET, {
    loadPackument: async () => ({ ok: false as const, error: { code: 'not-found', detail: 'npm has no package missing' } }),
  })
  assert.equal(result.state, 'unreadable')
  assert.equal(result.admission_status, undefined)
  assert.match(result.detail ?? '', /no package/)
})

test('a pinned version that is not on the registry is unreadable, not rounded to another version', async () => {
  const fetch = loaderFor(packument('pkg', { '0.1.0': { engines: { dsh: '*' } } }, '0.1.0'))
  const result = await probePackage('pkg', TARGET, { pinned: '0.1.0-rc.7', loadPackument: fetch })
  assert.equal(result.state, 'unreadable')
  assert.match(result.detail ?? '', /0\.1\.0-rc\.7/)
})

test('a declaration that does not contain the target denies, and names the requirement', async () => {
  const fetch = loaderFor(packument('pkg', { '0.1.0': { engines: { dsh: '^0.1.0' } } }, '0.1.0'))
  const result = await probePackage('pkg', TARGET, { loadPackument: fetch })
  assert.equal(result.admission_status, 'denied')
  assert.equal(result.admits_target, false)
  assert.match(result.declared_range ?? '', /\^0\.1\.0/)
  assert.ok((result.unmet?.length ?? 0) > 0)
})

test('no declaration is unconstrained: "declares nothing" is not a compatibility answer', async () => {
  const fetch = loaderFor(packument('pkg', { '1.0.0': {} }, '1.0.0'))
  const result = await probePackage('pkg', TARGET, { loadPackument: fetch })
  assert.equal(result.admission_status, 'unconstrained')
  assert.equal(result.declared_range, null)
})

test('a scoped name does not also yield its bare suffix', () => {
  const selection = selectProbeTargets({ packages: ['@deepseek-ai/dsh-mcp-client', 'dsh-mcp-client'] }, 'see @deepseek-ai/dsh-mcp-client@0.1.0-rc.7')
  assert.deepEqual(selection.targets.map((entry) => entry.name), ['@deepseek-ai/dsh-mcp-client'])
  assert.equal(selection.targets[0]?.pinned, '0.1.0-rc.7')
})

test('third-party packages are probed first, and at most three are probed', () => {
  const selection = selectProbeTargets(
    { packages: ['@deepseek-ai/dsh-tools', 'third-a', 'third-b', 'third-c'] },
    'third-a third-b third-c @deepseek-ai/dsh-tools',
  )
  assert.deepEqual(selection.targets.map((entry) => entry.name), ['third-a', 'third-b', 'third-c'])
  assert.equal(selection.omitted, 1)
})

test('pinned versions are read case-insensitively and keep the first occurrence', () => {
  const pinned = pinnedVersions('@Scope/Pkg@1.2.3 then @scope/pkg@9.9.9')
  assert.equal(pinned.get('@scope/pkg'), '1.2.3')
})

test('a snapshot round-trips: the offline probe reaches the same verdict as the live one', async () => {
  const live = packument('pkg', { '0.2.1-rc.4': { engines: { dsh: '>=0.2.0 <0.2.2-0' } } }, '0.2.1-rc.4')
  const before = await probePackage('pkg', TARGET, { loadPackument: loaderFor(live) })

  const snapshot = {
    name: 'pkg',
    state: 'measured',
    dist_tags: { latest: '0.2.1-rc.4' },
    latest: '0.2.1-rc.4',
    versions: { '0.2.1-rc.4': { engines: { dsh: '>=0.2.0 <0.2.2-0' }, peerDependencies: null, deprecated: null } },
  }
  const offline = await probePackage('pkg', TARGET, {
    loadPackument: async () => ({ ok: true as const, value: packumentFromSnapshot(snapshot) }),
  })
  assert.deepEqual(offline, before)
})

test('R59: a snapshot that wrote null for an absent declaration still means unconstrained', async () => {
  // The first full run normalised undefined -> null, and the offline recompute flipped every
  // "declares nothing" package into "denied". The reader must restore the absent field.
  const snapshot = {
    name: 'pkg',
    state: 'measured',
    latest: '1.0.0',
    versions: { '1.0.0': { engines: null, peerDependencies: null, deprecated: null } },
  }
  const result = await probePackage('pkg', TARGET, {
    loadPackument: async () => ({ ok: true as const, value: packumentFromSnapshot(snapshot) }),
  })
  assert.equal(result.admission_status, 'unconstrained')
})

test('R59: a real declaration in the snapshot is preserved (null-restoring is not "ignore everything")', async () => {
  const snapshot = {
    name: 'pkg',
    state: 'measured',
    latest: '1.0.0',
    versions: { '1.0.0': { engines: { dsh: '^0.1.0' }, peerDependencies: null, deprecated: null } },
  }
  const result = await probePackage('pkg', TARGET, {
    loadPackument: async () => ({ ok: true as const, value: packumentFromSnapshot(snapshot) }),
  })
  assert.equal(result.admission_status, 'denied')
})
