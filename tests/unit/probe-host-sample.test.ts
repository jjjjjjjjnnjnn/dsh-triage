/**
 * The sample loop's replacement policy (ADR-0008 option E).
 *
 * WHY THIS IS A REAL PROCESS AND NOT A PURE FUNCTION TEST: the decision under test lives
 * inside `bootAndSampleHost`'s polling loop, next to the spawn, the kill and the timers. A
 * fake launcher that writes the same overlay's `out:` file — nothing more — drives that loop
 * end to end without a DSH install, and the test can therefore assert the thing that actually
 * matters: how long the loop waits before it gives up.
 *
 * THE THREE REGRESSIONS THE ADR DEMANDS, all here:
 *   1. `settled: false` converges immediately (no replacement window);
 *   2. an `{error}` sample still opens the window and can catch the replacement sample;
 *   3. an `{error}` that is never replaced waits the whole window out.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { bootAndSampleHost, isReadableSample, isUsableSample } from '@dsh-triage/probe'

const FAKE_LAUNCHER = `
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const patchPath = args[args.indexOf('--patch') + 1]
const out = /out: '([^']+)'/.exec(readFileSync(patchPath, 'utf8'))[1]
const write = (payload) => writeFileSync(out, JSON.stringify(payload, null, 2) + '\\n', 'utf8')

const UNSETTLED = { kind: 'live', settled: false, wait_ms: 15000, applies: 1, attempts: [{ n: 1, ok: true }] }
const GOOD = { kind: 'live', settled: true, wait_ms: 400, applies: 2, attempts: [{ n: 1, ok: true }] }
const ERROR = {
  kind: 'live',
  settled: false,
  applies: 1,
  attempts: [{ n: 1, ok: false, code: 'inactive-context' }],
  error: { name: 'inactive-context', code: 'inactive-context', message: 'cannot get required service "loader" in inactive context' },
}

const mode = process.env.FAKE_SAMPLE_MODE
if (mode === 'unsettled') {
  setTimeout(() => write(UNSETTLED), 50)
} else if (mode === 'error-then-good') {
  setTimeout(() => write(ERROR), 50)
  setTimeout(() => write(GOOD), 400)
} else if (mode === 'error-only') {
  setTimeout(() => write(ERROR), 50)
}
// Stay alive like a Host would: the probe kill is part of what this loop is measured with.
setInterval(() => {}, 1000)
`

interface Harness {
  readonly dshMain: string
  readonly scratchRoot: string
  readonly dshHome: string
  readonly profileDir: string
  readonly hookSource: string
}

function harness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-host-sample-'))
  const dshMain = join(root, 'fake-launcher.mjs')
  writeFileSync(dshMain, FAKE_LAUNCHER, 'utf8')
  // The hook is only *copied* by `bootAndSampleHost`; the fake launcher never loads it.
  const hookSource = join(root, 'hook.mjs')
  writeFileSync(hookSource, 'export const name = "fake-hook"\n', 'utf8')
  const dshHome = join(root, 'home')
  mkdirSync(join(dshHome, 'profiles', 'web'), { recursive: true })
  return { dshMain, scratchRoot: join(root, 'scratch'), dshHome, profileDir: join(dshHome, 'profiles', 'web'), hookSource }
}

function boot(mode: string, extra: { sampleReplaceWindowMs?: number; timeoutMs?: number } = {}) {
  const each = harness()
  return bootAndSampleHost({
    dshMain: each.dshMain,
    dshHome: each.dshHome,
    profile: 'web',
    profileDir: each.profileDir,
    hookSource: each.hookSource,
    scratchRoot: each.scratchRoot,
    env: { ...process.env, FAKE_SAMPLE_MODE: mode },
    // No readiness / render: this test is about the sample loop, not the Host's surface.
    settleMs: 0,
    timeoutMs: extra.timeoutMs ?? 30_000,
    sampleReplaceWindowMs: extra.sampleReplaceWindowMs ?? 5_000,
  })
}

test('ADR-0008 E: a settled:false sample converges without opening a replacement window', async () => {
  const result = await boot('unsettled')
  assert.equal(result.error, null)
  assert.equal((result.payload as Record<string, unknown>)['settled'], false)
  // The sample is readable but not usable: the judge still has to answer `unknown`.
  assert.equal(isReadableSample(result.payload), true)
  assert.equal(isUsableSample(result.payload), false)
  // THE POINT OF E: the same payload used to cost one whole `sampleReplaceWindowMs` (20s by
  // default). 5s window here, so anything near it means the window was opened again.
  assert.equal(result.replacement.waited, false)
  assert.equal(result.replacement.waitedMs, 0)
  assert.equal(result.replacement.stoppedBy, 'readable-sample')
  assert.ok(
    result.segments.sampleWaitMs < 4_000,
    `a settled:false sample must not wait out the 5000ms window (waited ${result.segments.sampleWaitMs}ms)`,
  )
})

test('ADR-0008 E: an {error} sample still waits for the apply that replaces it', async () => {
  const result = await boot('error-then-good', { sampleReplaceWindowMs: 5_000 })
  assert.equal(isReadableSample(result.payload), true)
  assert.equal(isUsableSample(result.payload), true, 'the replacement sample must win')
  assert.equal(result.replacement.waited, true)
  assert.equal(result.replacement.samples, 2)
  assert.equal(result.replacement.stoppedBy, 'readable-sample')
})

test('ADR-0008 E: an {error} that is never replaced still waits the whole window', async () => {
  const result = await boot('error-only', { sampleReplaceWindowMs: 1_200 })
  assert.equal(isUsableSample(result.payload), false)
  assert.equal(isReadableSample(result.payload), false)
  assert.equal(result.replacement.waited, true)
  assert.equal(result.replacement.stoppedBy, 'unreadable-window')
  assert.ok(result.replacement.waitedMs >= 800, `expected a real wait, got ${result.replacement.waitedMs}ms`)
})

test('a launcher that never writes a sample reports the timeout, not a wait', async () => {
  const result = await boot('nothing', { timeoutMs: 800, sampleReplaceWindowMs: 200 })
  assert.equal(result.payload, null)
  assert.notEqual(result.error, null)
  assert.equal(result.replacement.samples, 0)
  assert.equal(result.replacement.waited, false)
  assert.equal(result.replacement.stoppedBy, 'timeout')
})
