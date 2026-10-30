import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { classifyWhoami, npmInvocation } from '../../scripts/lib/npm-auth.mjs'

/*
 * Why these cases: on 2026-10-30 `pnpm run release:publish` refused to publish with
 *
 *   FAIL  not-logged-in: npm 不认这个 token（`npm whoami` 返回 401）
 *
 * while `npm whoami` in the same shell printed the operator's user name. The check had never
 * run — `spawnSync('npm', …)` cannot start `npm.cmd` on Windows (ENOENT, the CVE-2024-27980
 * mitigation) — and every failure was rendered with a hard-coded 401 sentence. A broken check
 * was reported as broken credentials, which is the one mistake this project must never make:
 * a conclusion that was not measured.
 *
 * The red control below is the exact command the old code ran, so the regression cannot come
 * back silently on Windows.
 */

test('the old invocation really does fail on Windows, which is why this module exists', () => {
  if (process.platform !== 'win32') return // on POSIX `npm` is a script and spawns fine
  const naive = spawnSync('npm', ['whoami'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  // Pinned as a measurement, not a preference: if this ever starts returning a status, the
  // ComSpec indirection can be revisited instead of defended.
  assert.equal((naive.error as NodeJS.ErrnoException | undefined)?.code, 'ENOENT')
  assert.notEqual(naive.status, 0)
})

test('on Windows npm is reached through ComSpec, never spawned as a batch file', () => {
  const invocation = npmInvocation(['whoami'], 'win32', { ComSpec: 'C:\\Windows\\system32\\cmd.exe' })
  assert.equal(invocation.command, 'C:\\Windows\\system32\\cmd.exe')
  assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.equal(invocation.args[3], 'npm whoami')
})

test('on POSIX npm is spawned directly, without a shell', () => {
  assert.deepEqual(npmInvocation(['whoami'], 'linux'), { command: 'npm', args: ['whoami'] })
})

test('arguments containing spaces stay one argument', () => {
  const invocation = npmInvocation(['view', 'dsh-triage', '--registry', 'https://registry.npmjs.org'], 'win32', {})
  assert.equal(invocation.command, 'cmd.exe')
  assert.equal(invocation.args[3], 'npm view dsh-triage --registry https://registry.npmjs.org')
})

test('a real user name is a login, not a check failure', () => {
  const verdict = classifyWhoami({ ok: true, stdout: 'jjjjjjjjnnjnn\n', stderr: '' })
  assert.equal(verdict.state, 'logged-in')
  assert.equal(verdict.user, 'jjjjjjjjnnjnn')
})

test('an expired token is reported as not-logged-in', () => {
  const verdict = classifyWhoami({
    ok: false,
    stdout: '',
    stderr: 'npm error code E401\nnpm error Unable to authenticate, need: Bearer authorization',
  })
  assert.equal(verdict.state, 'not-logged-in')
})

test('no credentials at all is also not-logged-in, because `npm login` is the fix', () => {
  const verdict = classifyWhoami({ ok: false, stdout: '', stderr: 'npm error code ENEEDAUTH\nnpm error need auth' })
  assert.equal(verdict.state, 'not-logged-in')
})

test('RED CONTROL: a check that never ran is not a verdict about credentials', () => {
  // The literal text the preflight used to receive on Windows before this fix.
  const verdict = classifyWhoami({ ok: false, stdout: '', stderr: 'spawnSync npm ENOENT' })
  assert.equal(verdict.state, 'could-not-run')
  assert.equal(verdict.user, null)
  assert.match(verdict.detail, /ENOENT/)
})

test('exiting 0 with no name is unproven, not logged in', () => {
  const verdict = classifyWhoami({ ok: true, stdout: '\n  \n', stderr: '' })
  assert.equal(verdict.state, 'could-not-run')
})

test('the observed line is kept so the report can quote it instead of paraphrasing it', () => {
  const verdict = classifyWhoami({ ok: false, stdout: '', stderr: '\n\nspawnSync npm EINVAL\nsecond line' })
  assert.equal(verdict.observed, 'spawnSync npm EINVAL')
})
