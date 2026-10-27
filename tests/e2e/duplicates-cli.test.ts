/**
 * End-to-end: duplicate copies + install-origin attribution.
 *
 * Both features were borrowed from other ecosystems' diagnostic tools:
 *   - Maven `dependencyConvergence` / `pip check`: "one name, two versions" is a
 *     finding, and it must print both paths;
 *   - `npm explain`: the useful sentence is *why* the copy is here.
 *
 * This fixture is the silent half of discussion #10364: the profile carries an
 * old `dsh-tools` copy that a third-party plugin dragged in. Because the copy is
 * old enough to fail admission we also see the origin line; the duplicate line is
 * what would still be there if the versions happened to be compatible.
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
const STAMP = '2026-10-27T00:00:00.000Z'

interface Fixture {
  readonly root: string
  readonly home: string
  readonly dshHome: string
}

function manifest(dir: string, value: unknown): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(value, null, 2))
}

function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-dup-'))
  const home = join(root, 'home')
  const dshHome = join(home, '.dsh')
  const profileDir = join(dshHome, 'profiles', 'desktop')
  const shared = join(dshHome, 'profiles', 'node_modules')

  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'desktop', private: true, dependencies: { '@deepseek-ai/dsh': '0.2.1-rc.2' }, dsh: { profile: { bundles: [] } } }),
  )
  writeFileSync(join(profileDir, 'cordis.patch.yml'), "- id: tools\n  name: '@deepseek-ai/dsh-tools'\n")

  manifest(join(shared, '@deepseek-ai', 'dsh'), { name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' })
  // The in-box copy lives in the shared root...
  manifest(join(shared, '@deepseek-ai', 'dsh-tools'), {
    name: '@deepseek-ai/dsh-tools',
    version: '0.2.1-rc.2',
    peerDependencies: { '@deepseek-ai/dsh-agent': '0.2.1-rc.2' },
  })
  // ...and a third-party plugin drags an old copy into the profile root.
  manifest(join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-tools'), {
    name: '@deepseek-ai/dsh-tools',
    version: '0.0.1-rc.1',
    peerDependencies: { '@deepseek-ai/dsh-agent': '^0.0.1-rc.1' },
  })
  manifest(join(profileDir, 'node_modules', 'dsh-pdf'), {
    name: 'dsh-pdf',
    version: '0.1.0',
    dependencies: { '@deepseek-ai/dsh-tools': '^0.0.1-rc.1' },
  })
  return { root, home, dshHome }
}

function runCli(args: readonly string[], fixture: Fixture) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, DSH_TRIAGE_LOCALE: 'en', HOME: fixture.home, USERPROFILE: fixture.home },
  })
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

test('audit reports the two copies with both versions, and exits 1', () => {
  const fixture = buildFixture()
  try {
    const result = runCli(['audit', '--json', '--dsh-home', fixture.dshHome, '--profile', 'desktop', '--stamp', STAMP], fixture)
    assert.equal(result.status, 1, `expected findings, got ${result.status}: ${result.stderr}`)
    const payload = JSON.parse(result.stdout)

    assert.equal(payload.duplicates.length, 1)
    const [duplicate] = payload.duplicates
    assert.equal(duplicate.name, '@deepseek-ai/dsh-tools')
    assert.equal(duplicate.kind, 'different-versions')
    assert.deepEqual(
      duplicate.copies.map((copy: { scope: string; version: string }) => [copy.scope, copy.version]),
      [
        ['profile', '0.0.1-rc.1'],
        ['shared', '0.2.1-rc.2'],
      ],
    )
    for (const copy of duplicate.copies as { path: string }[]) {
      assert.ok(copy.path.startsWith('profiles/'), `path must be relative to the DSH home: ${copy.path}`)
    }
    assert.ok(!result.stdout.includes(fixture.root.replaceAll('\\', '\\\\')), 'temp root leaked into JSON')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('why names the declaring plugin, not just the denied row', () => {
  const fixture = buildFixture()
  try {
    const result = runCli(['why', '--json', '--dsh-home', fixture.dshHome, '--profile', 'desktop', '--stamp', STAMP], fixture)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout) as {
      verdicts: { subject: { name: string }; conclusion: string; reasons: { code: string; params?: Record<string, string> }[] }[]
    }

    const row = payload.verdicts.find((verdict) => verdict.subject.name === '@deepseek-ai/dsh-tools' && verdict.conclusion === 'blocked')
    assert.ok(row, 'the shadowed copy must be blocked')
    const origin = row.reasons.find((reason) => reason.code === 'admission-row-declared-by')
    assert.ok(origin, 'must answer "why is this copy here"')
    assert.equal(origin.params?.['by'], 'dsh-pdf@0.1.0')
    assert.equal(origin.params?.['fields'], 'dependencies')

    const duplicate = payload.verdicts.find((verdict) => verdict.reasons.some((reason) => reason.code === 'collision-duplicate-copy'))
    assert.ok(duplicate, 'the same fact must also show up as a duplicate-copy finding')
    assert.equal(duplicate.conclusion, 'risky')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('a single copy produces neither a duplicate nor an origin line', () => {
  const fixture = buildFixture()
  try {
    const profileDir = join(fixture.dshHome, 'profiles', 'desktop')
    rmSync(join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-tools'), { recursive: true, force: true })
    rmSync(join(profileDir, 'node_modules', 'dsh-pdf'), { recursive: true, force: true })

    const audit = runCli(['audit', '--json', '--dsh-home', fixture.dshHome, '--profile', 'desktop', '--stamp', STAMP], fixture)
    assert.equal(audit.status, 0, audit.stderr)
    assert.deepEqual(JSON.parse(audit.stdout).duplicates, [])

    const why = runCli(['why', '--json', '--dsh-home', fixture.dshHome, '--profile', 'desktop', '--stamp', STAMP], fixture)
    const payload = JSON.parse(why.stdout) as { verdicts: { reasons: { code: string }[] }[] }
    assert.ok(!payload.verdicts.some((verdict) => verdict.reasons.some((reason) => reason.code === 'admission-row-declared-by')))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('the same version in both roots is silent (pnpm hard link, not a finding)', () => {
  const fixture = buildFixture()
  try {
    // Make the profile copy identical in version to the shared one.
    manifest(join(fixture.dshHome, 'profiles', 'desktop', 'node_modules', '@deepseek-ai', 'dsh-tools'), {
      name: '@deepseek-ai/dsh-tools',
      version: '0.2.1-rc.2',
      peerDependencies: { '@deepseek-ai/dsh-agent': '0.2.1-rc.2' },
    })

    const audit = runCli(['audit', '--json', '--dsh-home', fixture.dshHome, '--profile', 'desktop', '--stamp', STAMP], fixture)
    const payload = JSON.parse(audit.stdout) as { duplicates: unknown[] }
    assert.deepEqual(payload.duplicates, [], 'same version twice is the normal layout')
    assert.ok(!audit.stdout.includes('duplicate copies'), 'no duplicate section in text output either')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
