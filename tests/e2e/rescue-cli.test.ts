/**
 * `dsh-triage rescue` end to end (M8 A 段).
 *
 * The unit tests prove the classification. This file proves the two promises that cannot be tested
 * without a real profile on disk:
 *
 *   - **N1 / C4: read-only really is read-only.** The manifest is hashed before and after, and the
 *     plan's `manifestSha256` must equal both — a formatted rewrite would show up here even though
 *     every unit test stayed green.
 *   - **C5 / N4: the boundary sentence is part of the output**, in both locales, so "does not prove
 *     the host boots" cannot be dropped silently in a later refactor.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const CLI = join(repoRoot, 'packages', 'plugin', 'dist', 'cli.js')

interface Fixture {
  readonly root: string
  readonly dshHome: string
  readonly profileDir: string
  readonly manifestPath: string
}

function buildFixture(options: { readonly bundles: readonly string[] | null; readonly dependencies?: Record<string, string> }): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-rescue-'))
  const dshHome = join(root, 'home', '.dsh')
  const profileDir = join(dshHome, 'profiles', 'web')
  const sharedModules = join(dshHome, 'profiles', 'node_modules')

  mkdirSync(profileDir, { recursive: true })
  mkdirSync(join(sharedModules, '@deepseek-ai', 'dsh'), { recursive: true })
  mkdirSync(join(sharedModules, '@acme', 'dsh-widgets'), { recursive: true })

  writeFileSync(
    join(sharedModules, '@deepseek-ai', 'dsh', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.4' }),
  )
  writeFileSync(
    join(sharedModules, '@acme', 'dsh-widgets', 'package.json'),
    JSON.stringify({ name: '@acme/dsh-widgets', version: '1.0.3' }),
  )

  const manifest: Record<string, unknown> = {
    name: 'dsh-profile-web',
    private: true,
    dependencies: options.dependencies ?? { '@acme/dsh-widgets': '^1.0.0' },
    dsh: { profile: {} },
  }
  if (options.bundles !== null) {
    ;(manifest['dsh'] as Record<string, unknown>)['profile'] = { bundles: options.bundles }
  }

  const manifestPath = join(profileDir, 'package.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { root, dshHome, profileDir, manifestPath }
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function run(args: readonly string[]): { readonly code: number; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', windowsHide: true })
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

test('rescue plans, exits 1, and leaves the manifest byte-identical (N1 / C4)', () => {
  const fixture = buildFixture({ bundles: ['@deepseek-ai/dsh', '@acme/dsh-widgets'] })
  try {
    const before = sha256(fixture.manifestPath)
    const result = run(['rescue', '--dsh-home', fixture.dshHome, '--locale', 'en', '--json'])
    assert.equal(result.code, 1, `expected findings, got ${result.code}: ${result.stderr}`)
    const payload = JSON.parse(result.stdout) as { plan: { evidence: string; removable: unknown[]; manifestSha256: string } }
    assert.equal(payload.plan.evidence, 'scanned')
    assert.equal(payload.plan.removable.length, 1)
    assert.equal(payload.plan.manifestSha256, before, 'the plan must hash the bytes it read')
    assert.equal(sha256(fixture.manifestPath), before, 'a plan must not rewrite the manifest')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('the boundary sentence is printed in English and in Chinese (C5 / N4)', () => {
  const fixture = buildFixture({ bundles: ['@deepseek-ai/dsh', '@acme/dsh-widgets'] })
  try {
    const en = run(['rescue', '--dsh-home', fixture.dshHome, '--locale', 'en'])
    assert.match(en.stdout, /does not prove the host boots/u)
    assert.match(en.stdout, /nothing was written/u)
    assert.match(en.stdout, /probe --execute/u)

    const zh = run(['rescue', '--dsh-home', fixture.dshHome, '--locale', 'zh'])
    assert.match(zh.stdout, /不证明启动成功/u)
    assert.match(zh.stdout, /未修改任何文件/u)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('an official-only profile is exit 0 and says there is nothing to trim', () => {
  const fixture = buildFixture({ bundles: ['@deepseek-ai/dsh'], dependencies: { '@deepseek-ai/dsh': '^0.2.1' } })
  try {
    const result = run(['rescue', '--dsh-home', fixture.dshHome, '--locale', 'en'])
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /nothing to trim/u)
    assert.match(result.stdout, /does not prove the host boots/u)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('a missing bundles field is reported as a likely wrong --dsh-home, not as "all good" (N6)', () => {
  const fixture = buildFixture({ bundles: null })
  try {
    const result = run(['rescue', '--dsh-home', fixture.dshHome, '--locale', 'en'])
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /has no dsh\.profile\.bundles field/u)
    assert.match(result.stdout, /points somewhere else/u)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('an unreadable profile is exit 3 with a hint, never an empty plan (N5)', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-rescue-missing-'))
  try {
    const result = run(['rescue', '--dsh-home', join(root, 'nope'), '--locale', 'en'])
    assert.equal(result.code, 3, `expected unavailable, got ${result.code}: ${result.stdout}`)
    assert.match(result.stderr, /cannot read the profile/u)
    assert.match(result.stderr, /hint:/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('--apply removes exactly the listed bundles from bundles only, and --undo restores the manifest byte for byte', () => {
  const fixture = buildFixture({ bundles: ['@deepseek-ai/dsh', '@acme/dsh-widgets'] })
  try {
    const before = sha256(fixture.manifestPath)

    const applied = run(['rescue', '--apply', '--dsh-home', fixture.dshHome, '--locale', 'en', '--json', '--no-redact'])
    assert.equal(applied.code, 0, `apply should succeed: ${applied.stderr}`)
    const payload = JSON.parse(applied.stdout) as { plan: { removable: unknown[] }; run: { journal: string; removed: string[]; dryRun: boolean } }
    assert.equal(payload.plan.removable.length, 1, 'the plan is computed before the write')
    assert.equal(payload.run.dryRun, false)
    assert.deepEqual(payload.run.removed, ['@acme/dsh-widgets'])

    const afterApply = JSON.parse(readFileSync(fixture.manifestPath, 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    assert.deepEqual(afterApply.dsh.profile.bundles, ['@deepseek-ai/dsh'], 'only the third-party bundle left')
    assert.deepEqual(afterApply.dependencies, { '@acme/dsh-widgets': '^1.0.0' }, 'dependencies must not change')
    assert.notEqual(sha256(fixture.manifestPath), before, 'apply is supposed to change the file')

    const undone = run(['rescue', '--undo', payload.run.journal, '--locale', 'en'])
    assert.equal(undone.code, 0, `undo should succeed: ${undone.stderr}`)
    assert.equal(sha256(fixture.manifestPath), before, 'undo must restore the original bytes, not an equivalent file')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('--undo refuses to overwrite a profile that changed after the rescue (N11)', () => {
  const fixture = buildFixture({ bundles: ['@deepseek-ai/dsh', '@acme/dsh-widgets'] })
  try {
    const applied = run(['rescue', '--apply', '--dsh-home', fixture.dshHome, '--locale', 'en', '--json', '--no-redact'])
    assert.equal(applied.code, 0, applied.stderr)
    const journal = (JSON.parse(applied.stdout) as { run: { journal: string } }).run.journal

    // The user edits the profile after the rescue: overwriting that would be a second silent change.
    writeFileSync(fixture.manifestPath, `${readFileSync(fixture.manifestPath, 'utf8')}\n`, 'utf8')
    const edited = sha256(fixture.manifestPath)

    const undone = run(['rescue', '--undo', journal, '--locale', 'en'])
    assert.equal(undone.code, 3, `expected a refusal, got ${undone.code}: ${undone.stdout}`)
    assert.match(undone.stderr, /changed after this rescue was applied/u)
    assert.equal(sha256(fixture.manifestPath), edited, 'a refused undo must not touch the file')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('the JSON plan carries no absolute home path (N7)', () => {
  const fixture = buildFixture({ bundles: ['@deepseek-ai/dsh', '@acme/dsh-widgets'] })
  try {
    const result = run(['rescue', '--dsh-home', fixture.dshHome, '--locale', 'en', '--json'])
    assert.equal(result.code, 1, result.stderr)
    assert.doesNotMatch(result.stdout, /dsh-triage-rescue-/u, 'the temp home must not be echoed back')
    assert.doesNotMatch(result.stdout, /AppData|Users/u, 'a plan is not a place to leak a home path')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
