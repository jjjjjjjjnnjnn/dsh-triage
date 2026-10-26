/**
 * End-to-end CLI contract test.
 *
 * WHY: every other test exercises functions. This one proves the thing a user
 * actually runs — `dsh-triage why --json` — against a synthetic DSH_HOME that
 * contains a deliberately incompatible bundle. It must:
 *   1. find the denial without a real DSH install;
 *   2. emit a copy-pasteable `allow-version` command for the right runtime;
 *   3. redact home paths in JSON output (the repo is meant to go public).
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

interface Fixture {
  readonly root: string
  readonly dshHome: string
  readonly home: string
}

function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-e2e-'))
  const home = join(root, 'home')
  const dshHome = join(home, '.dsh')
  const profileDir = join(dshHome, 'profiles', 'web')
  const sharedModules = join(dshHome, 'profiles', 'node_modules')

  mkdirSync(profileDir, { recursive: true })
  mkdirSync(join(sharedModules, '@deepseek-ai', 'dsh'), { recursive: true })
  mkdirSync(join(sharedModules, 'fake-bundle'), { recursive: true })

  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify(
      {
        name: 'dsh-profile-web',
        private: true,
        dependencies: { 'fake-bundle': '1.0.0' },
        dsh: { profile: { bundles: ['fake-bundle'] } },
      },
      null,
      2,
    ),
  )
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')

  // The runtime the verdict must be computed against.
  writeFileSync(
    join(sharedModules, '@deepseek-ai', 'dsh', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' }),
  )

  // A bundle that declares an older runtime on purpose → admission denies it.
  writeFileSync(
    join(sharedModules, 'fake-bundle', 'package.json'),
    JSON.stringify({
      name: 'fake-bundle',
      version: '1.0.0',
      engines: { dsh: '0.1.0-rc.6' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  )
  writeFileSync(
    join(sharedModules, 'fake-bundle', 'cordis.patch.yml'),
    '- id: compat-fake\n  name: fake-bundle/host\n',
  )

  return { root, dshHome, home }
}

function runCli(args: readonly string[], fixture: Fixture) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, DSH_TRIAGE_LOCALE: 'en', HOME: fixture.home, USERPROFILE: fixture.home },
  })
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

test('why --json attributes a denial and redacts the profile path', () => {
  const fixture = buildFixture()
  try {
    const result = runCli(
      ['why', '--json', '--dsh-home', fixture.dshHome, '--stamp', '2026-01-01T00:00:00.000Z'],
      fixture,
    )
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)

    assert.equal(payload.command, 'why')
    assert.equal(payload.verdicts.length, 1, 'one bundle, one verdict')

    const [verdict] = payload.verdicts
    assert.equal(verdict.conclusion, 'blocked')
    assert.equal(verdict.subject.name, 'fake-bundle')
    assert.ok(
      verdict.reasons.some((reason: { code: string }) => reason.code === 'admission-denied-engines'),
      'must attribute the denial to engines.dsh',
    )

    const allow = verdict.remediation.find((item: { kind: string }) => item.kind === 'allow-version')
    assert.ok(allow?.command?.includes('--dsh-version 0.2.1-rc.2'), 'fix must name the real runtime')
    assert.ok(allow?.command?.includes('--profile web'))

    // Privacy: JSON is shareable, so the home directory must not leak.
    assert.ok(verdict.env.profileDir.startsWith('~'), `profileDir not redacted: ${verdict.env.profileDir}`)
    assert.ok(!result.stdout.includes(fixture.home.replaceAll('\\', '\\\\')), 'raw home path leaked into JSON')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('why exits 1 under --strict when something is blocked', () => {
  const fixture = buildFixture()
  try {
    const result = runCli(
      ['why', '--strict', '--dsh-home', fixture.dshHome, '--stamp', '2026-01-01T00:00:00.000Z'],
      fixture,
    )
    assert.equal(result.status, 1, '--strict must fail the command when a verdict is not "go"')
    assert.match(result.stdout, /BLOCKED/)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('audit reports the loader row of the incompatible bundle', () => {
  const fixture = buildFixture()
  try {
    const result = runCli(['audit', '--json', '--dsh-home', fixture.dshHome], fixture)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    const entry = payload.claims
      .flatMap((group: { entries: { id: string; name: string | null }[] }) => group.entries)
      .find((row: { id: string }) => row.id === 'compat-fake')
    assert.ok(entry, 'capability ledger must contain the declared row')
    assert.equal(entry.name, 'fake-bundle/host')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
