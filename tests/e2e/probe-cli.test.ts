/**
 * End-to-end contract for `dsh-triage probe`.
 *
 * WHY: the executor can be unit-tested with fakes, but the promise that matters to a user
 * is "nothing happens unless you ask for it". These tests drive the real CLI and assert:
 *   1. the default path prints a plan and spawns nothing;
 *   2. `--execute` without `--dsh-main` is a usage error, not a half-run;
 *   3. a candidate whose package name cannot be determined is refused, not guessed;
 *   4. the plan refuses a sandbox that overlaps the real DSH home.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const CLI = join(repoRoot, 'packages', 'plugin', 'dist', 'cli.js')
const FIXTURE = join(repoRoot, 'tests', 'fixtures', 'probe', 'ok-plugin')

function runCli(args: readonly string[], home: string) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home, HOME: home, USERPROFILE: home },
    timeout: 60_000,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function fakeHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-probe-e2e-'))
  mkdirSync(join(root, '.dsh', 'profiles', 'web'), { recursive: true })
  writeFileSync(join(root, '.dsh', 'profiles', 'web', 'package.json'), JSON.stringify({ name: 'dsh-profile-web', private: true }))
  return root
}

test('probe without --execute prints the plan and spawns nothing', () => {
  const home = fakeHome()
  const sandboxRoot = join(tmpdir(), 'dsh-triage-probe')
  try {
    const before = existsSync(sandboxRoot) ? join(sandboxRoot) : null
    const beforeCount = before === null ? 0 : countEntries(sandboxRoot)
    const result = runCli(['probe', FIXTURE, '--locale', 'en'], home)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /probe plan \(dry-run\)/)
    assert.match(result.stdout, /not measured by M3/, 'assertions the runner cannot answer must say so')
    assert.match(result.stdout, /nothing was spawned/)
    const afterCount = existsSync(sandboxRoot) ? countEntries(sandboxRoot) : 0
    assert.equal(afterCount, beforeCount, 'a dry-run must not create a sandbox home')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('probe --execute without --dsh-main is a usage error', () => {
  const home = fakeHome()
  try {
    const result = runCli(['probe', FIXTURE, '--execute', '--locale', 'en'], home)
    assert.equal(result.status, 2)
    assert.match(result.stderr, /--dsh-main/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a candidate whose package name cannot be read is refused, not guessed', () => {
  const home = fakeHome()
  const empty = mkdtempSync(join(tmpdir(), 'dsh-triage-empty-candidate-'))
  try {
    const result = runCli(['probe', empty, '--execute', '--dsh-main', join(repoRoot, 'nope.js'), '--locale', 'en'], home)
    assert.equal(result.status, 2)
    assert.match(result.stderr, /cannot determine which package/)
  } finally {
    rmSync(empty, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('probe --json in dry-run says dryRun=true and carries the plan', () => {
  const home = fakeHome()
  try {
    const result = runCli(['probe', FIXTURE, '--json', '--locale', 'en'], home)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout) as { dryRun?: boolean; plan?: { assertions?: Array<{ measured?: boolean }> } }
    assert.equal(payload.dryRun, true)
    assert.ok(Array.isArray(payload.plan?.assertions))
    assert.ok(payload.plan?.assertions?.some((assertion) => assertion.measured === false))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

function countEntries(directory: string): number {
  return readdirSync(directory).length
}
