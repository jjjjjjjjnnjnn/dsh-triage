import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMarketIndex, entriesFromEvidence, type MeasuredCandidate } from '../../packages/plugin/dist/index-source.js'

/*
 * The index is the only place this project hands data to a THIRD-PARTY consumer (DSH's plugin market),
 * so the rules that matter are the ones that keep it from dressing a guess up as a listing (T-403).
 */

const record = (artifact: string, payload: MeasuredCandidate) => ({ artifact, payload })

const go = (name: string, version: string, generatedAt = '2026-10-28T00:00:00.000Z'): MeasuredCandidate => ({
  generated_at: generatedAt,
  conclusion: 'go',
  candidate: { package: name, kind: 'registry', resolved: { version } },
  runtime: { version: '0.2.1-rc.4' },
})

test('only measured "go" versions become entries, and the newest run wins', () => {
  const { entries, excluded } = entriesFromEvidence(
    [
      record('probe-old.json', { ...go('a-plugin', '1.0.0', '2026-10-01T00:00:00.000Z'), conclusion: 'blocked' }),
      record('probe-new.json', go('a-plugin', '1.0.1', '2026-10-28T00:00:00.000Z')),
      record('probe-unknown.json', { ...go('b-plugin', '2.0.0'), conclusion: 'unknown' }),
    ],
    () => 1_700_000_000,
    () => null,
  )
  assert.deepEqual(entries.map((entry) => `${entry.name}@${entry.version}`), ['a-plugin@1.0.1'])
  assert.deepEqual(excluded, [{ package: 'b-plugin', reason: 'conclusion was unknown' }])
})

test('a diagnostic-hook run is never listed (R26 rule)', () => {
  const { entries } = entriesFromEvidence(
    [
      record('probe-real.json', go('a-plugin', '1.0.0', '2026-10-27T00:00:00.000Z')),
      record('probe-hook.json', { ...go('a-plugin', '9.9.9', '2026-10-29T00:00:00.000Z'), sandbox: { hook_config: { x: 1 } } }),
    ],
    () => 1_700_000_000,
    () => null,
  )
  assert.deepEqual(entries.map((entry) => entry.version), ['1.0.0'], 'the newer hook run must not win')
})

test('a local candidate is excluded: it has no npm version to list', () => {
  const { entries, excluded } = entriesFromEvidence(
    [record('probe-local.json', { ...go('fixture', '1.0.0'), candidate: { package: 'fixture', kind: 'path', resolved: { version: '1.0.0' } } })],
    () => 1_700_000_000,
    () => null,
  )
  assert.deepEqual(entries, [])
  assert.match(excluded[0]?.reason ?? '', /not a registry candidate/u)
})

test('a version the registry never timestamped is excluded, not invented', () => {
  const { entries, excluded } = entriesFromEvidence([record('probe-a.json', go('a-plugin', '1.0.0'))], () => null, () => null)
  assert.deepEqual(entries, [])
  assert.match(excluded[0]?.reason ?? '', /no timestamp/u)
})

test('ranges: exact SemVer only, and a workspace range never reaches the index', () => {
  const { document, skipped } = buildMarketIndex(
    [
      { name: 'a-plugin', version: 'latest', publishTimestamp: 1_700_000_000, dshRange: null },
      { name: 'a-plugin', version: '^1.2.3', publishTimestamp: 1_700_000_000, dshRange: null },
      { name: 'a-plugin', version: '1.2.3', publishTimestamp: 1_700_000_000, dshRange: 'workspace:*' },
    ],
    { generatedFor: 'dsh 0.2.1-rc.4' },
  )
  assert.equal(document.plugins.length, 1)
  assert.deepEqual(document.plugins[0]?.versions.map((entry) => entry.version), ['1.2.3'])
  assert.equal(document.plugins[0]?.versions[0]?.engines, undefined, 'workspace: is not a publishable range')
  assert.equal(skipped.length, 2)
})

test('a missing timestamp is dropped rather than defaulted to now', () => {
  const { document, skipped } = buildMarketIndex([{ name: 'a-plugin', version: '1.0.0', publishTimestamp: 0, dshRange: null }])
  assert.deepEqual(document.plugins, [])
  assert.match(skipped[0]?.reason ?? '', /publish timestamp/u)
})

test('the document is deterministic and sorted by package name', () => {
  const entries = [
    { name: 'z-plugin', version: '1.0.0', publishTimestamp: 1, dshRange: null },
    { name: 'a-plugin', version: '1.0.0', publishTimestamp: 2, dshRange: '>=0.2.0-rc.1 <0.3.0-0' },
  ]
  const first = JSON.stringify(buildMarketIndex(entries).document)
  const second = JSON.stringify(buildMarketIndex(entries).document)
  assert.equal(first, second, 'same evidence, same bytes')
  const document = buildMarketIndex(entries).document
  assert.deepEqual(document.plugins.map((plugin) => plugin.name), ['a-plugin', 'z-plugin'])
  assert.equal(document.plugins[0]?.versions[0]?.engines?.dsh, '>=0.2.0-rc.1 <0.3.0-0')
})

test('the description says what an absent package means', () => {
  const { document } = buildMarketIndex([], { generatedFor: 'dsh 0.2.1-rc.4' })
  assert.match(document.description.en, /never measured/u)
  assert.match(document.description.zh, /没测过/u)
  assert.doesNotMatch(document.description.en, /^Only good plugins/u, 'the index may not claim a quality verdict')
})
