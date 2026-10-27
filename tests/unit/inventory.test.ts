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
  findPresetDivergence,
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
  return parseOk({ entries })
}

/** Parse a whole snapshot literal (transport, presets, …) and fail the test if it is refused. */
function parseOk(value: unknown): InventorySnapshot {
  const parsed = parseInventorySnapshot(value, { source: 'fixture', sampledAt: SAMPLED, profile: 'web' })
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

test('unknown keys inside the wrapped snapshot are surfaced too', () => {
  const parsed = parseInventorySnapshot(
    { snapshot: { entries: [], presetV3: [] } },
    { source: 'fixture', sampledAt: SAMPLED },
  )
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.value.unknownKeys, ['presetV3'], 'a field added inside `snapshot` is just as interesting')
})

test('agentPresets are parsed into presets instead of being swallowed (T-112)', () => {
  const parsed = parseInventorySnapshot(
    {
      entries: [],
      agentPresets: [
        { id: 'reviewer', rows: [{ entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'failed' }] },
      ],
    },
    { source: 'fixture', sampledAt: SAMPLED },
  )
  assert.ok(parsed.ok)
  assert.equal(parsed.value.presets.length, 1)
  assert.equal(parsed.value.presets[0]?.id, 'reviewer')
  assert.equal(parsed.value.presets[0]?.rows.length, 1)

  const verdicts = verdictsFromInventory({ env, snapshot: parsed.value, declared: [], generatedAt: STAMP })
  assert.equal(verdicts.length, 1, 'a failing preset row must not be invisible')
  assert.equal(verdicts[0]?.conclusion, 'blocked')
  assert.equal(verdicts[0]?.reasons[0]?.code, 'runtime.preset-fiber-failed')
  assert.ok(
    verdicts[0]?.evidence.some((item) => item.id === 'preset' && item.source === 'preset:reviewer'),
    'the verdict must name the preset it came from',
  )
})

test('a preset row that is enabled but has no fiber is unknown, never blocked', () => {
  // Upstream documents preset `fiberPhase` as "the root-fiber phase when the
  // composition is live; null otherwise". `null` therefore also means "no session ever
  // composed this preset" — calling that `blocked` would invent a failure, and calling
  // it `go` would hide one. The main list keeps blocking on the same shape; this
  // asymmetry is the whole reason presets need their own table row.
  const parsed = parseInventorySnapshot(
    {
      entries: [],
      agentPresets: [
        { id: 'minimal', rows: [{ entryId: 'persona', moduleName: '@deepseek-ai/dsh-persona', enabled: true, fiberPhase: null }] },
      ],
    },
    { source: 'fixture', sampledAt: SAMPLED },
  )
  assert.ok(parsed.ok)
  const verdicts = verdictsFromInventory({ env, snapshot: parsed.value, declared: [], generatedAt: STAMP })
  assert.equal(verdicts.length, 1)
  assert.equal(verdicts[0]?.conclusion, 'unknown')
  assert.equal(verdicts[0]?.reasons[0]?.code, 'runtime.preset-no-fiber')
  assert.deepEqual(verdicts[0]?.missingEvidence, ['missing.preset-phase'])
})

test('a conditional preset row is unknown and names the gate', () => {
  const parsed = parseInventorySnapshot(
    {
      entries: [],
      agentPresets: [
        {
          id: 'standard',
          rows: [
            {
              entryId: 'tool-bash',
              moduleName: '@deepseek-ai/dsh-tool-bash',
              enabled: 'conditional',
              condition: "process.platform === 'win32'",
              fiberPhase: null,
            },
          ],
        },
      ],
    },
    { source: 'fixture', sampledAt: SAMPLED },
  )
  assert.ok(parsed.ok)
  const verdicts = verdictsFromInventory({ env, snapshot: parsed.value, declared: [], generatedAt: STAMP })
  assert.equal(verdicts.length, 1)
  assert.equal(verdicts[0]?.conclusion, 'unknown')
  assert.equal(verdicts[0]?.reasons[0]?.code, 'runtime.preset-conditional')
  assert.equal(verdicts[0]?.reasons[0]?.params?.['condition'], "process.platform === 'win32'")
})

test('a broken preset stays listed as unknown with its own reason', () => {
  const parsed = parseInventorySnapshot(
    { entries: [], agentPresets: [{ id: 'cordis', broken: 'composition file is not readable', rows: [] }] },
    { source: 'fixture', sampledAt: SAMPLED },
  )
  assert.ok(parsed.ok)
  const verdicts = verdictsFromInventory({ env, snapshot: parsed.value, declared: [], generatedAt: STAMP })
  assert.equal(verdicts.length, 1)
  assert.equal(verdicts[0]?.conclusion, 'unknown')
  assert.equal(verdicts[0]?.reasons[0]?.code, 'runtime.preset-unjudged')
  assert.equal(verdicts[0]?.reasons[0]?.params?.['reason'], 'composition file is not readable')
})

test('a disabled preset row is a composition choice, not a finding', () => {
  // The shipped `minimal` preset is built out of rows like this. Reporting each one
  // would bury the real findings; the row stays visible in the listing and in --json.
  const parsed = parseInventorySnapshot(
    {
      entries: [],
      agentPresets: [
        { id: 'minimal', rows: [{ entryId: 'tool-bash', moduleName: '@deepseek-ai/dsh-tool-bash', enabled: false, fiberPhase: null }] },
      ],
    },
    { source: 'fixture', sampledAt: SAMPLED },
  )
  assert.ok(parsed.ok)
  assert.equal(parsed.value.presets[0]?.rows.length, 1, 'the row is still parsed and visible')
  assert.deepEqual(verdictsFromInventory({ env, snapshot: parsed.value, declared: [], generatedAt: STAMP }), [])
})

test('cross-preset divergence is surfaced and neither value is rounded', () => {
  const parsed = parseInventorySnapshot(
    {
      entries: [],
      agentPresets: [
        { id: 'ptc', rows: [{ entryId: 'workflow-ptc', moduleName: '@deepseek-ai/dsh-workflow-ptc', enabled: true, fiberPhase: 'active' }] },
        { id: 'standard', rows: [{ entryId: 'workflow-ptc', moduleName: '@deepseek-ai/dsh-workflow-ptc', enabled: true, fiberPhase: 'failed' }] },
      ],
    },
    { source: 'fixture', sampledAt: SAMPLED },
  )
  assert.ok(parsed.ok)
  const divergence = findPresetDivergence(parsed.value.presets)
  assert.equal(divergence.length, 1)
  assert.equal(divergence[0]?.entryId, 'workflow-ptc')
  assert.match(String(divergence[0]?.summary), /active@ptc/)
  assert.match(String(divergence[0]?.summary), /failed@standard/)

  const verdicts = verdictsFromInventory({ env, snapshot: parsed.value, declared: [], generatedAt: STAMP })
  const codes = verdicts.map((verdict) => verdict.reasons[0]?.code)
  assert.ok(codes.includes('runtime.preset-divergence'), 'the disagreement must be named')
  assert.ok(codes.includes('runtime.preset-fiber-failed'), 'the failing side still blocks on its own')
})

test('the transport a sample declares is recorded and never upgraded to a Remote call', () => {
  const projection = parseInventorySnapshot(
    { transport: 'in-process-projection', entries: [] },
    { source: 'fixture', sampledAt: SAMPLED },
  )
  assert.ok(projection.ok)
  assert.equal(projection.value.transport, 'in-process-projection')

  const projected = verdictsFromInventory({
    env,
    snapshot: parseOk({
      transport: 'in-process-projection',
      entries: [{ entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'failed' }],
    }),
    declared: [],
    generatedAt: STAMP,
  })
  assert.ok(
    projected.every((verdict) => verdict.evidence.every((item) => !String(item.method).includes('plugin-inventory/list'))),
    'an in-process read must not claim the Remote endpoint',
  )
  assert.ok(projected[0]?.evidence.some((item) => item.method === 'readPluginInventory (in-process projection)'))

  // The published artifact keeps the transport *inside* the snapshot; reading only the
  // wrapper made `audit --snapshot` call it "unstated" while the file plainly said so.
  const nested = parseOk({
    snapshot: {
      transport: 'in-process-projection',
      entries: [{ entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'failed' }],
    },
  })
  assert.equal(nested.transport, 'in-process-projection', 'a transport inside the snapshot counts')

  const remote = verdictsFromInventory({
    env,
    snapshot: parseOk({
      transport: 'remote',
      entries: [{ entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'failed' }],
    }),
    declared: [],
    generatedAt: STAMP,
  })
  assert.ok(remote[0]?.evidence.some((item) => item.method === 'plugin-inventory/list'))

  const unstated = verdictsFromInventory({
    env,
    snapshot: snapshot([{ entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'failed' }]),
    declared: [],
    generatedAt: STAMP,
  })
  assert.ok(
    unstated[0]?.evidence.every((item) => !String(item.method).includes('plugin-inventory/list')),
    'no transport, no Remote claim',
  )

  const bogus = parseInventorySnapshot({ transport: 'carrier-pigeon', entries: [] }, { source: 'fixture', sampledAt: SAMPLED })
  assert.equal(bogus.ok, false, 'a transport nobody defines is refused, not ignored')
  assert.ok(!bogus.ok && bogus.error.detail.includes('carrier-pigeon'))
})

test('a refused preset names the offending row and field', () => {
  const cases = [
    {
      snapshot: { entries: [], agentPresets: [{ id: 'standard', rows: [{ entryId: 'tools', enabled: true, fiberPhase: 'active' }] }] },
      includes: 'moduleName',
    },
    {
      snapshot: { entries: [], agentPresets: [{ id: 'standard', rows: [{ entryId: 'tools', moduleName: '@x/y', enabled: 'yes', fiberPhase: null }] }] },
      includes: 'enabled',
    },
    {
      snapshot: { entries: [], agentPresets: 'agentPresets' },
      includes: 'not an array',
    },
    {
      snapshot: {
        entries: [],
        agentPresets: [{ id: 'dup', rows: [] }, { id: 'dup', rows: [] }],
      },
      includes: 'more than once',
    },
    {
      snapshot: {
        entries: [],
        agentPresets: [
          {
            id: 'cordis',
            broken: 'unreadable',
            rows: [{ entryId: 'tools', moduleName: '@x/y', enabled: true, fiberPhase: 'failed' }],
          },
        ],
      },
      includes: 'marked broken and still carries',
    },
    {
      snapshot: { entries: [], agentPresets: [{ id: 'standard', rows: [{ entryId: 't', moduleName: '@x/y', enabled: true, fiberPhase: 'sleeping' }] }] },
      includes: 'sleeping',
    },
  ]
  for (const { snapshot: value, includes } of cases) {
    const parsed = parseInventorySnapshot(value, { source: 'fixture', sampledAt: SAMPLED })
    assert.equal(parsed.ok, false, `expected a refusal for ${includes}`)
    assert.ok(!parsed.ok && parsed.error.detail.includes(includes), `detail must mention "${includes}", got "${parsed.ok ? '' : parsed.error.detail}"`)
  }
})

test('a disabled entry nobody declares is reported once, as disabled', () => {
  const verdicts = verdictsFromInventory({
    env,
    snapshot: snapshot([{ entryId: 'hooks', moduleName: '@deepseek-ai/dsh-hooks-claude-code', enabled: false, fiberPhase: null }]),
    declared: [],
    generatedAt: STAMP,
  })
  assert.equal(verdicts.length, 1, 'no second "runs but undeclared" card for a row that is off')
  assert.equal(verdicts[0]?.reasons[0]?.code, 'runtime.disabled')
})

test('an absent fiberPhase key is no-fiber, not silence', () => {
  const verdicts = verdictsFromInventory({
    env,
    snapshot: snapshot([{ entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true }]),
    declared: [{ entryId: 'tools', module: '@deepseek-ai/dsh-tools' }],
    generatedAt: STAMP,
  })
  assert.equal(verdicts.length, 1)
  assert.equal(verdicts[0]?.conclusion, 'blocked')
  assert.equal(verdicts[0]?.reasons[0]?.code, 'runtime.no-fiber')
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

test('a loader id carrying its group path still matches the flat declared row', () => {
  // Measured on a real sandbox Host: the loader wraps the profile's cordis.yml in an
  // `include` group, so patch row `tool-bash` runs as `include:tool-bash`. Comparing
  // those literally produced 96 "absent" + 195 "undeclared" rows out of a healthy Host.
  const built = snapshot([
    { entryId: 'include:tool-bash', moduleName: '@deepseek-ai/dsh-tool-bash', enabled: true, fiberPhase: 'active' },
    { entryId: 'include:tool-pwsh', moduleName: '@deepseek-ai/dsh-tool-pwsh', enabled: true, fiberPhase: 'active' },
  ])
  const declared = [
    { entryId: 'tool-bash', module: '@deepseek-ai/dsh-tool-bash' },
    { entryId: 'tool-pwsh', module: '@deepseek-ai/dsh-tool-pwsh' },
  ]
  const diff = compareInventory(built, declared)
  assert.deepEqual(diff.missing, [], 'a prefixed runtime id is not "missing"')
  assert.deepEqual(diff.undeclared, [], 'and the declared row is not "undeclared" either')

  const verdicts = verdictsFromInventory({ env, snapshot: built, declared, generatedAt: STAMP })
  assert.deepEqual(verdicts, [], 'a healthy prefixed row produces no finding')
})

test('an exact id wins over a suffixed one, and two candidates are never guessed', () => {
  const built = snapshot([
    { entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'failed' },
    { entryId: 'include:tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'active' },
    { entryId: 'a:shared', moduleName: '@deepseek-ai/dsh-shared', enabled: true, fiberPhase: 'active' },
    { entryId: 'b:shared', moduleName: '@deepseek-ai/dsh-shared', enabled: true, fiberPhase: 'active' },
  ])
  const exact = verdictsFromInventory({
    env,
    snapshot: built,
    declared: [{ entryId: 'tools', module: '@deepseek-ai/dsh-tools' }],
    generatedAt: STAMP,
  })
  const blocked = exact.filter((verdict) => verdict.conclusion === 'blocked')
  assert.equal(blocked.length, 1, 'only the exact id is judged as the declared row')
  assert.equal(blocked[0]?.reasons[0]?.params?.['entryId'], 'tools', 'the exact match is the one that blocks')
  assert.ok(
    !exact.some((verdict) => verdict.reasons[0]?.params?.['entryId'] === 'include:tools' && verdict.conclusion !== 'risky'),
    'the suffixed twin is never credited with the declaration',
  )

  const ambiguous = verdictsFromInventory({
    env,
    snapshot: built,
    declared: [{ entryId: 'shared', module: '@deepseek-ai/dsh-shared' }],
    generatedAt: STAMP,
  })
  const codes = ambiguous.map((verdict) => verdict.reasons[0]?.code)
  assert.ok(codes.includes('runtime.ambiguous-entry'), 'two tail matches are reported, not resolved')
  assert.ok(!codes.includes('runtime.missing-entry'), 'and the row is not called absent either')
  const card = ambiguous.find((verdict) => verdict.reasons[0]?.code === 'runtime.ambiguous-entry')
  assert.deepEqual(card?.missingEvidence, ['missing.row-identity'])
  assert.equal(card?.conclusion, 'unknown')
})

test('a suffix match must load the declared package, or the row is not the same row', () => {
  // Adversary finding: matching on the id tail alone let `other:tools` (loading
  // `@other/pkg/tools`) satisfy a declaration for `tools` (@deepseek-ai/dsh-tools).
  // A genuinely missing plugin then cancelled out against an unrelated row and the
  // sample reported *zero* findings — the exact false negative this layer exists to stop.
  const built = snapshot([{ entryId: 'other:tools', moduleName: '@other/pkg/tools', enabled: true, fiberPhase: 'active' }])
  const verdicts = verdictsFromInventory({
    env,
    snapshot: built,
    declared: [{ entryId: 'tools', module: '@deepseek-ai/dsh-tools' }],
    generatedAt: STAMP,
  })
  const codes = verdicts.map((verdict) => verdict.reasons[0]?.code)
  assert.ok(codes.includes('runtime.missing-entry'), 'the declared row is missing, not satisfied by a stranger')
  assert.ok(codes.includes('runtime.undeclared-entry'), 'and the stranger is still reported as undeclared')

  const samePackage = verdictsFromInventory({
    env,
    snapshot: built,
    declared: [{ entryId: 'tools', module: '@other/pkg' }],
    generatedAt: STAMP,
  })
  assert.deepEqual(samePackage, [], 'a subpath export of the same package is the same row')
})

