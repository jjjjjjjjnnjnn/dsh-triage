/**
 * One probe implementation for R57 and R59, pinned (R59).
 *
 * Every test here is a way the probe could lie: judging `latest` when the thread named a version,
 * treating a 404 as a denial, or judging a bare name that is a different registry entry.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  judgePackageName,
  packumentFromSnapshot,
  pinnedVersions,
  planProbeTargets,
  probePackage,
  selectProbeTargets,
} from '../../scripts/lib/discussion-probe.mjs'
import { tierOfThread } from '../../scripts/lib/question-coverage.mjs'

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

/* ------------------------------------------------------------------ *
 * R88 / X2: a name that cannot be a package is recorded, not asked
 * ------------------------------------------------------------------ */

test('X2-N1: names that break npm naming rules are refused before any request', () => {
  /*
   * 20 fixtures, five per rule class. Every token here was seen in the committed R59 artifact — the
   * extractor really did emit `@4.22.4/node_modules`, `DSH-internal` and `…-2026-10-24.zip`.
   * The reason asserted is the first rule that fires, which is why the uppercase file name below is
   * reported as `uppercase`: the point is that it is refused, not which rule caught it first.
   */
  const fixtures: Array<[string, string]> = [
    ['@4.22.4/node_modules', 'path-fragment'],
    ['@2.1.1/node_modules', 'path-fragment'],
    ['node_modules/pkg', 'path-fragment'],
    ['a/node_modules/b', 'path-fragment'],
    ['x/node_modules', 'path-fragment'],
    ['@0.34.5/libvips', 'version-path'],
    ['@0.35.5/libvips', 'version-path'],
    ['@1.0.0/x', 'version-path'],
    ['@12.3.4/y', 'version-path'],
    ['@0.0.1/z', 'version-path'],
    ['dsh-crash-report-2026-10-24.zip', 'file-name'],
    ['dsh-2026-10-24.error.log', 'file-name'],
    ['payload.json', 'file-name'],
    ['screen.png', 'file-name'],
    ['bundle.tgz', 'file-name'],
    ['DSH-internal', 'uppercase'],
    ['DSH-native', 'uppercase'],
    ['DSH-crash-report-2026-10-24.zip', 'uppercase'],
    ['@DeepSeek.x.x.x.demo', 'uppercase'],
    ['DSH-BUG-REPORT-seq-gap-overlap', 'uppercase'],
  ]
  for (const [name, reason] of fixtures) {
    const judged = judgePackageName(name)
    assert.equal(judged.probeable, false, `${name} must be refused`)
    assert.equal(judged.reason, reason, `${name} must be refused as ${reason}`)
  }

  /*
   * The other direction, and the reason this filter can exist at all: a name that is merely
   * *unlikely* is still asked. `dsh-fs-local` is a real upstream module id and `dsh-v0.1.2-alpha.3`
   * is a version glued onto a name — both 404, but neither breaks a naming rule, so refusing them
   * would be a heuristic that could silently cost a thread its only reading.
   */
  for (const name of ['@deepseek-ai/dsh-mcp-client', 'third-a', 'dsh-fs-local', 'dsh-v0.1.2-alpha.3', 'dsh-system-prompt']) {
    const judged = judgePackageName(name)
    assert.equal(judged.probeable, true, `${name} must still be probed`)
    assert.equal(judged.reason, null)
  }
  // The remaining rule classes are edge cases rather than fixture rows; they still have to hold.
  assert.equal(judgePackageName('').reason, 'empty')
  assert.equal(judgePackageName('_private').reason, 'leading-dot-underscore')
  assert.equal(judgePackageName('.hidden').reason, 'leading-dot-underscore')
  assert.equal(judgePackageName('dsh bug report').reason, 'whitespace')
  assert.equal(judgePackageName('a'.repeat(215)).reason, 'too-long')
})

test('X2-N1: a selection keeps refused names as targets, so the caller cannot shrink the count', () => {
  const selection = selectProbeTargets(
    { packages: ['DSH-internal', 'third-a'] },
    'DSH-internal third-a',
  )
  assert.deepEqual(selection.targets.map((entry) => entry.name), ['DSH-internal', 'third-a'])
  assert.deepEqual(selection.rejected, [{ name: 'DSH-internal', reason: 'uppercase' }])
  assert.equal(selection.targets.length, 2, 'a refused name must stay in targets, not be dropped')
})

test('X2-N1: the plan asks only for names that could be packages, in the original order', () => {
  const plan = planProbeTargets([
    { name: 'third-a', pinned: '1.2.3', probeable: true, reason: null },
    { name: 'DSH-internal', probeable: false, reason: 'uppercase' },
  ])
  assert.equal(plan.length, 2)
  assert.equal(plan[0]?.kind, 'fetch')
  assert.equal(plan[1]?.kind, 'rejected')
  if (plan[1]?.kind === 'rejected') {
    assert.equal(plan[1].record.state, 'unreadable')
    assert.equal(plan[1].record.verdict, null)
    assert.match(plan[1].record.detail ?? '', /not sent to the registry/)
    assert.match(plan[1].record.detail ?? '', /uppercase/)
    /*
     * X2-N2: the record has exactly these four keys. A timestamp or a random id here would make the
     * artifact unreproducible, which this repository treats as a defect rather than a detail.
     */
    assert.deepEqual(Object.keys(plan[1].record).sort(), ['detail', 'package', 'state', 'verdict'])
  }
})

test('X2-N3: a refused name lands on the same tier as the 404 it replaces (counts conserved)', () => {
  const measured = { state: 'measured', package: 'third-a', admission_status: 'denied', version_source: 'latest' }
  const askedThen404 = { state: 'unreadable', package: 'DSH-internal', detail: 'npm has no package DSH-internal' }
  const refused = {
    state: 'unreadable',
    package: 'DSH-internal',
    detail: 'name is not a package (uppercase); not sent to the registry',
  }
  assert.equal(tierOfThread({ layer: 'admission', probes: [askedThen404] }), 'probe-unreadable')
  assert.equal(tierOfThread({ layer: 'admission', probes: [refused] }), 'probe-unreadable')
  assert.equal(
    tierOfThread({ layer: 'admission', probes: [measured, askedThen404] }),
    tierOfThread({ layer: 'admission', probes: [measured, refused] }),
  )
  // and a thread with only refused names is still not "not-relevant"/"needs-their-profile"
  assert.equal(tierOfThread({ layer: 'unknown', probes: [refused] }), 'probe-unreadable')
})
