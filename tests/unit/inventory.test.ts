/**
 * Runtime inventory contracts (M2-a / T-201 P2).
 *
 * These tests encode docs/specs/M2-inventory.md §3 and §6. The gate
 * `inventory-contract` replays the same table, so a change here that is not
 * reflected in the spec fails in two places instead of one.
 *
 * The important property is negative: silence must mean "measured and healthy",
 * never "could not read it". A renamed upstream field, a missing phase or an
 * unreadable entry must surface as an error or an `unknown`, not as a clean bill.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FIBER_PHASES,
  compareInventory,
  parseInventorySnapshot,
  phaseConclusion,
  verdictsFromInventory,
  type EnvFingerprint,
  type InventoryEntry,
  type InventorySnapshot,
} from '@dsh-triage/core'

const STAMP = '2026-10-26T00:00:00.000Z'
const SAMPLED = '2026-10-25T08:00:00.000Z'

const env: EnvFingerprint = {
  dsh: '0.2.1-rc.2',
  node: '22.19.0',
  platform: 'linux',
  arch: 'x64',
  profile: 'web',
  profileDir: '~/.dsh/profiles/web',
  bundles: [],
  installed: [],
}

function snapshot(entries: readonly Record<string, unknown>[]): InventorySnapshot {
  const parsed = parseInventorySnapshot({ entries }, { source: 'fixture', sampledAt: SAMPLED, profile: 'web' })
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error.detail)
  return parsed.value
}

function entry(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    entryId: 'tools',
    moduleName: '@deepseek-ai/dsh-tools',
    enabled: true,
    fiberPhase: 'active',
    raw: {},
    ...overrides,
  }
}

test('the enum the engine accepts is the enum upstream publishes', () => {
  assert.deepEqual([...FIBER_PHASES], ['pending', 'loading', 'active', 'failed', 'unloading'])
})

test('a renamed or unknown fiberPhase is refused, never coerced into "fine"', () => {
  const renamed = parseInventorySnapshot(
    { entries: [{ entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'sleeping' }] },
    { source: 'fixture', sampledAt: SAMPLED },
  )
  assert.equal(renamed.ok, false)
  assert.ok(!renamed.ok && renamed.error.code === 'inventory-invalid')
  assert.ok(!renamed.ok && renamed.error.detail.includes('sleeping'), 'the detail must name the offending value')

  const missingModule = parseInventorySnapshot(
    { entries: [{ entryId: 'tools', enabled: true, fiberPhase: 'active' }] },
    { source: 'fixture', sampledAt: SAMPLED },
  )
  assert.equal(missingModule.ok, false, 'an entry without a module cannot be attributed')

  const notAnObject = parseInventorySnapshot('nope', { source: 'fixture', sampledAt: SAMPLED })
  assert.equal(notAnObject.ok, false)
})

test('the P1 wrapper {snapshot, sampled_at, profile} is accepted and its metadata wins', () => {
  const parsed = parseInventorySnapshot(
    {
      sampled_at: '2026-10-24T09:00:00.000Z',
      profile: 'desktop',
      snapshot: { managementAvailable: true, entries: [] },
    },
    { source: 'export.json', sampledAt: SAMPLED, profile: 'web' },
  )
  assert.ok(parsed.ok)
  assert.equal(parsed.value.sampledAt, '2026-10-24T09:00:00.000Z')
  assert.equal(parsed.value.profile, 'desktop')
  assert.equal(parsed.value.managementAvailable, true)
})

test('unknown top-level keys are surfaced instead of interpreted', () => {
  const parsed = parseInventorySnapshot(
    { entries: [], agentPresetsV2: [{ id: 'x' }] },
    { source: 'fixture', sampledAt: SAMPLED },
  )
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value.unknownKeys, ['agentPresetsV2'])
})

test('phase → conclusion follows the spec table exactly', () => {
  assert.equal(phaseConclusion(entry({ fiberPhase: 'active' })), null, 'active is covered by the bundle verdict')
  assert.equal(phaseConclusion(entry({ fiberPhase: 'pending' })), null, 'transient phases would flap between samples')
  assert.equal(phaseConclusion(entry({ fiberPhase: 'loading' })), null)
  assert.equal(phaseConclusion(entry({ fiberPhase: 'unloading' })), null)

  const failed = phaseConclusion(entry({ fiberPhase: 'failed' }))
  assert.equal(failed?.conclusion, 'blocked')
  assert.equal(failed?.code, 'runtime.fiber-failed')

  const noFiber = phaseConclusion(entry({ fiberPhase: null, enabled: true }))
  assert.equal(noFiber?.conclusion, 'blocked', 'enabled but no fiber is the CASE-11080 shape')
  assert.equal(noFiber?.code, 'runtime.no-fiber')

  const disabled = phaseConclusion(entry({ fiberPhase: null, enabled: false }))
  assert.equal(disabled?.conclusion, 'risky', 'a deliberate disable is not a crash')
  assert.equal(disabled?.code, 'runtime.disabled')

  const disabledWithPhase = phaseConclusion(entry({ fiberPhase: 'failed', enabled: false }))
  assert.equal(disabledWithPhase?.code, 'runtime.disabled', 'disabled wins over the phase')
})

test('phase verdicts carry measured-local evidence with the sampling time and profile', () => {
  const verdicts = verdictsFromInventory({
    env,
    snapshot: snapshot([
      { entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: null },
    ]),
    declared: [{ entryId: 'tools', module: '@deepseek-ai/dsh-tools' }],
    generatedAt: STAMP,
  })
  assert.equal(verdicts.length, 1)
  const [verdict] = verdicts
  assert.equal(verdict?.conclusion, 'blocked')
  assert.ok(verdict?.evidence.every((item) => item.tier === 'measured-local'))
  assert.ok(verdict?.evidence.some((item) => item.at === SAMPLED), 'the sample time must survive into evidence')
  assert.ok(verdict?.evidence.some((item) => item.source === 'web'), 'the profile must survive into evidence')
  assert.ok((verdict?.remediation.length ?? 0) > 0, 'blocked needs a remediation')
  assert.equal(verdict?.confidence.basis, 'measured-local')
})

test('an empty snapshot turns every declared row into unknown, never silence', () => {
  const verdicts = verdictsFromInventory({
    env,
    snapshot: snapshot([]),
    declared: [
      { entryId: 'tools', module: '@deepseek-ai/dsh-tools' },
      { entryId: 'session', module: '@deepseek-ai/dsh-session' },
      { entryId: 'no-module', module: null },
    ],
    generatedAt: STAMP,
  })
  assert.equal(verdicts.length, 2, 'rows without a module cannot be judged and are not invented')
  for (const verdict of verdicts) {
    assert.equal(verdict.conclusion, 'unknown')
    assert.deepEqual(verdict.missingEvidence, ['missing.fiber'])
    assert.ok(verdict.reasons.some((reason) => reason.code === 'runtime.missing-entry'))
  }
})

test('an entry that runs but no layer declares is risky, not blocked', () => {
  const verdicts = verdictsFromInventory({
    env,
    snapshot: snapshot([
      { entryId: 'preset-row', moduleName: '@deepseek-ai/dsh-agent-preset', enabled: true, fiberPhase: 'active' },
    ]),
    declared: [],
    generatedAt: STAMP,
  })
  assert.equal(verdicts.length, 1)
  assert.equal(verdicts[0]?.conclusion, 'risky')
  assert.equal(verdicts[0]?.reasons[0]?.code, 'runtime.undeclared-entry')
})

test('output is deterministic and ordered by entry id', () => {
  const built = snapshot([
    { entryId: 'zeta', moduleName: '@deepseek-ai/zeta', enabled: true, fiberPhase: null },
    { entryId: 'alpha', moduleName: '@deepseek-ai/alpha', enabled: false, fiberPhase: null },
  ])
  const input = {
    env,
    snapshot: built,
    declared: [
      { entryId: 'alpha', module: '@deepseek-ai/alpha' },
      { entryId: 'zeta', module: '@deepseek-ai/zeta' },
    ],
    generatedAt: STAMP,
  }
  const first = verdictsFromInventory(input)
  const second = verdictsFromInventory(input)
  assert.deepEqual(second, first, 'same input, same output')
  assert.deepEqual(first.map((verdict) => verdict.reasons[0]?.params?.['entryId']), ['alpha', 'zeta'])
})

test('the declared-vs-running diff names both directions', () => {
  const built = snapshot([
    { entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'active' },
    { entryId: 'preset-row', moduleName: '@deepseek-ai/dsh-agent-preset', enabled: true, fiberPhase: 'active' },
  ])
  const diff = compareInventory(built, [
    { entryId: 'tools', module: '@deepseek-ai/dsh-tools' },
    { entryId: 'mcp-client', module: '@deepseek-ai/dsh-mcp-client' },
  ])
  assert.deepEqual(diff.missing.map((row) => row.entryId), ['mcp-client'])
  assert.deepEqual(diff.undeclared.map((item) => item.entryId), ['preset-row'])
})
