/**
 * `audit --snapshot <file>` end-to-end (M2-a / T-201 P2).
 *
 * WHY an e2e and not only a unit test: the phase layer is only useful if it
 * reaches the command a user runs. This test mounts a synthetic profile, feeds a
 * `pluginInventory/list` export, and checks three things a unit test cannot:
 *   1. the runtime phases appear next to the declared rows (B1's shape);
 *   2. declared-but-not-running shows up instead of vanishing (B2);
 *   3. the snapshot path is redacted in `--json` (B4), and a renamed upstream
 *      phase exits 3 with a reason instead of printing "no problems found".
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const CLI = join(repoRoot, 'packages', 'plugin', 'dist', 'cli.js')
const STAMP = '2026-10-26T00:00:00.000Z'

interface Fixture {
  readonly root: string
  readonly home: string
  readonly dshHome: string
}

function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-inventory-'))
  const home = join(root, 'home')
  const dshHome = join(home, '.dsh')
  const profileDir = join(dshHome, 'profiles', 'web')
  const sharedModules = join(dshHome, 'profiles', 'node_modules')

  mkdirSync(profileDir, { recursive: true })
  mkdirSync(join(sharedModules, '@deepseek-ai', 'dsh'), { recursive: true })
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'web', private: true, dependencies: { '@deepseek-ai/dsh': '0.2.1-rc.2' }, dsh: { profile: { bundles: [] } } }),
  )
  // Two declared rows: one the snapshot says is dead, one the snapshot omits.
  writeFileSync(
    join(profileDir, 'cordis.patch.yml'),
    "- id: tools\n  name: '@deepseek-ai/dsh-tools'\n- id: mcp-client\n  name: '@deepseek-ai/dsh-mcp-client'\n",
  )
  writeFileSync(
    join(sharedModules, '@deepseek-ai', 'dsh', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' }),
  )
  return { root, home, dshHome }
}

function writeSnapshot(fixture: Fixture, payload: unknown): string {
  const path = join(fixture.root, 'inventory.json')
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return path
}

function runCli(args: readonly string[], fixture: Fixture) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, DSH_TRIAGE_LOCALE: 'en', HOME: fixture.home, USERPROFILE: fixture.home },
  })
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

test('audit --snapshot reports phases, the missing row and the undeclared row', () => {
  const fixture = buildFixture()
  try {
    const snapshot = writeSnapshot(fixture, {
      sampled_at: '2026-10-25T08:00:00.000Z',
      profile: 'web',
      snapshot: {
        managementAvailable: true,
        entries: [
          { entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: null },
          { entryId: 'preset-row', moduleName: '@deepseek-ai/dsh-agent-preset', enabled: true, fiberPhase: 'active' },
          { entryId: 'session', moduleName: '@deepseek-ai/dsh-session', enabled: false, fiberPhase: null },
        ],
      },
    })

    const result = runCli(['audit', '--json', '--snapshot', snapshot, '--dsh-home', fixture.dshHome, '--stamp', STAMP], fixture)
    assert.equal(result.status, 1, `expected findings exit code, got ${result.status}: ${result.stderr}`)
    const payload = JSON.parse(result.stdout)

    assert.equal(payload.command, 'audit')
    assert.equal(payload.inventory.sampled_at, '2026-10-25T08:00:00.000Z')
    assert.equal(payload.inventory.profile, 'web')
    assert.equal(payload.inventory.management_available, true)
    assert.deepEqual(
      payload.inventory.entries.map((entry: { entry_id: string; phase: string | null }) => [entry.entry_id, entry.phase]),
      [
        ['preset-row', 'active'],
        ['session', null],
        ['tools', null],
      ],
      'every sampled entry must be listed with its phase',
    )

    // B2: declared but not running — the row the snapshot forgot.
    assert.deepEqual(payload.inventory.missing.map((row: { entryId: string }) => row.entryId), ['mcp-client'])

    const byCode = new Map<string, { conclusion: string; missingEvidence?: string[] }>()
    for (const verdict of payload.inventory.verdicts) {
      for (const reason of verdict.reasons) byCode.set(reason.code, verdict)
    }
    assert.equal(byCode.get('runtime.no-fiber')?.conclusion, 'blocked', 'enabled but no fiber is a failure')
    assert.equal(byCode.get('runtime.missing-entry')?.conclusion, 'unknown')
    assert.deepEqual(byCode.get('runtime.missing-entry')?.missingEvidence, ['missing.fiber'])
    assert.equal(byCode.get('runtime.disabled')?.conclusion, 'risky', 'a disabled row is not a crash')
    assert.equal(byCode.get('runtime.undeclared-entry')?.conclusion, 'risky')

    // B4: the snapshot path and the profile dir are home paths, so JSON must redact them.
    assert.ok(
      String(payload.inventory.source).startsWith('~'),
      `snapshot source not redacted: ${payload.inventory.source}`,
    )
    assert.ok(!result.stdout.includes(fixture.root.replaceAll('\\', '\\\\')), 'temp root leaked into JSON')
    assert.ok(!result.stdout.includes(fixture.home.replaceAll('\\', '\\\\')), 'home path leaked into JSON')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('a renamed upstream phase exits 3 instead of pretending the profile is fine', () => {
  const fixture = buildFixture()
  try {
    const snapshot = writeSnapshot(fixture, {
      entries: [{ entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'sleeping' }],
    })
    const result = runCli(['audit', '--snapshot', snapshot, '--dsh-home', fixture.dshHome, '--stamp', STAMP], fixture)
    assert.equal(result.status, 3, `expected EXIT_UNAVAILABLE, got ${result.status}`)
    assert.match(result.stderr, /inventory-invalid/)
    assert.match(result.stderr, /sleeping/, 'the error must name the value we did not understand')
    assert.ok(!result.stdout.includes('no runtime finding'), 'must not print a clean bill after failing to read the sample')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('without --snapshot the audit output is unchanged (the layer is opt-in)', () => {
  const fixture = buildFixture()
  try {
    const result = runCli(['audit', '--json', '--dsh-home', fixture.dshHome, '--stamp', STAMP], fixture)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.inventory, null, 'no snapshot, no phase claims')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('presets reach the terminal and the JSON, and the transport is printed', () => {
  const fixture = buildFixture()
  try {
    const snapshot = writeSnapshot(fixture, {
      kind: 'live',
      transport: 'in-process-projection',
      sampled_at: '2026-10-25T08:00:00.000Z',
      profile: 'web',
      snapshot: {
        entries: [{ entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'active' }],
        agentPresets: [
          {
            id: 'standard',
            isDefault: true,
            rows: [
              { entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'active' },
              { entryId: 'tool-bash', moduleName: '@deepseek-ai/dsh-tool-bash', enabled: false, fiberPhase: null },
            ],
          },
          {
            id: 'ptc',
            isDefault: false,
            rows: [{ entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'failed' }],
          },
        ],
      },
    })

    const result = runCli(['audit', '--snapshot', snapshot, '--dsh-home', fixture.dshHome, '--stamp', STAMP], fixture)
    // T-112: the two presets disagree about `tools`, and the failing side must survive.
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stdout, /transport in-process-projection/, 'the sample transport is part of the header')
    assert.match(result.stdout, /agent presets \(2\)/, 'the preset section must render')
    assert.match(result.stdout, /standard \(default\)/, 'the default preset is named')
    assert.match(result.stdout, /cross-preset divergence: 1/, 'the disagreement is counted')
    assert.ok(!result.stdout.includes('plugin-inventory/list'), 'a projection must not print the Remote endpoint')

    const json = runCli(
      ['audit', '--json', '--snapshot', snapshot, '--dsh-home', fixture.dshHome, '--stamp', STAMP],
      fixture,
    )
    const payload = JSON.parse(json.stdout)
    assert.equal(payload.inventory.transport, 'in-process-projection')
    assert.deepEqual(
      payload.inventory.presets.map((preset: { id: string; rows: unknown[] }) => [preset.id, preset.rows.length]),
      [
        ['ptc', 1],
        ['standard', 2],
      ],
      'presets are sorted by id and keep their rows',
    )
    const presetCodes = payload.inventory.verdicts
      .flatMap((verdict: { reasons: { code: string }[] }) => verdict.reasons.map((reason) => reason.code))
      .filter((code: string) => code.startsWith('runtime.preset-'))
    assert.ok(presetCodes.includes('runtime.preset-fiber-failed'), 'the failing preset row blocks')
    assert.ok(presetCodes.includes('runtime.preset-divergence'), 'the disagreement is a verdict, not only a line')
    assert.ok(!presetCodes.includes('runtime.preset-disabled'), 'a disabled preset row is not a finding')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
