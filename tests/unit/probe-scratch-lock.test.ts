/**
 * A scratch directory the probe cannot delete — reproduced on demand (BS-41 / R37 `T-321`).
 *
 * THE GAP THIS CLOSES: R37 caught, once in 40 idle matrix runs, that Windows held a handle on the
 * probe's own `triage-live-*` directory: `rmSync` threw `EPERM`, the exception escaped
 * `bootAndSampleHost`, and the judge — left with "no sample, no URL, no startup failure" — fell
 * through to `probe.boot-timeout` and reported the candidate `blocked`
 * (`data/results/probe-matrix-2026-10-29T15-30-00.000Z.json`, `real-unlag@1.12.5`). The fix
 * (record the failure, never throw) is pinned by N24 / N24b — but both of those tests hand-write
 * the shape the fix is supposed to produce. Nobody could make the OS produce it, so "it is fixed"
 * rested on a unit test plus one historical artifact (`BS-41`).
 *
 * HOW THE LOCK IS MADE (measured on this machine, R40 — the raw attempts are recorded in the R40
 * audit note; what survived is below):
 *
 *   - `fs.openSync(file)` and `fs.opendirSync(dir)` do NOT block deletion: libuv opens with
 *     `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`, so `rmSync(dir)` still SUCCEEDS.
 *     A naive "hold a handle" fixture therefore proves nothing.
 *   - a CHILD PROCESS whose CWD is inside the directory DOES block it: the CWD handle is opened
 *     without `FILE_SHARE_DELETE`, and `rmSync(dir, {recursive:true, force:true})` throws
 *     `EPERM, Permission denied: \\?\…\triage-live-…` — the exact error and message shape of the
 *     R37 incident. It is a real OS lock, released when the child dies.
 *   - `icacls <dir> /deny <user>:(D,DC)` also yields EPERM, but it leaves ACL state on the
 *     operator's machine; the CWD handle leaves none.
 *
 * SO NO SEAM WAS ADDED: `host.ts` is untouched. The fixture drives the REAL `bootAndSampleHost`,
 * and the only fake part is the "Host" itself — the same 20-line fake launcher pattern
 * `probe-host-sample.test.ts` already uses. It spawns a locker instead of a DSH tree, which is
 * exactly what a real Host's helper process does when it lands in our scratch directory.
 *
 * WHAT A REVERT OF `T-321` WOULD BREAK:
 *   - `host.ts` back to `rmSync(probeDir)` in the `try` (the pre-R37 shape): test 1 and test 2
 *     fail with an unhandled EPERM instead of a returned sample.
 *   - `exec.ts` stops recording `setupError` → `bootSetupError`: test 3's verdict flips from
 *     `unknown` to `blocked` with `probe.boot-timeout`.
 *   - `judgeProbe` loses the `probe-measurement-unavailable` branch: test 3 fails on the
 *     conclusion *and* on both assertions.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { bootAndSampleHost, buildProbePlan, executeProbe, isUsableSample, judgeProbe, probeAssertions } from '@dsh-triage/probe'
import type { BootSampleResult, ProbeExecDeps, ProbeRun } from '@dsh-triage/probe'

const CANDIDATE = 'triage-probe-fixture-ok'
const AT = '2026-10-29T00:00:00.000Z'

/*
 * The lock only exists on Windows: POSIX `rmdir` frees a directory that some process has as its
 * CWD, so the same fixture would (correctly) delete the scratch dir and prove nothing. The CI
 * runs `pnpm run test` on ubuntu too, so the two lock tests are skipped there instead of being
 * made to pass with a Linux-shaped claim they cannot support.
 */
const windowsOnly = process.platform === 'win32' ? false : 'the CWD handle blocks deletion only on Windows (POSIX rmdir succeeds)'

/**
 * A launcher that behaves like a Host for the one fact under test: it holds the probe's scratch
 * directory open (as its own helper's CWD) and then writes a healthy, settled sample.
 *
 * WHY THE LOCK IS TWO HOPS AWAY (measured, R40): the probe kills the tree it spawned
 * (`taskkill /pid <launcher> /T /F`) and Windows keeps the parent/child link in the process
 * table, so a DIRECT child of the launcher is still found and killed even after the launcher
 * itself has exited — the lock then dies ~1.2s before the cleanup and the fixture proves nothing.
 * A grandchild whose intermediate parent exited first is not reachable from that tree, which is
 * also what a real lingering helper looks like.
 *
 * It writes the locker's pid OUTSIDE the scratch root so the test can kill it: the whole point is
 * that the scratch directory cannot be cleaned up, so nothing may be stored there and expected to
 * survive.
 */
const FAKE_LAUNCHER = `
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const patchPath = args[args.indexOf('--patch') + 1]
const out = /out: '([^']+)'/.exec(readFileSync(patchPath, 'utf8'))[1]
const write = (payload) => writeFileSync(out, JSON.stringify(payload, null, 2) + '\\n', 'utf8')

const SAMPLE = {
  kind: 'live',
  sampled_at: '2026-10-29T00:00:00.000Z',
  transport: 'in-process-projection',
  method: 'readPluginInventory',
  profile: 'probe',
  wait_ms: 300,
  excluded: [],
  applies: 1,
  settled: true,
  attempts: [{ n: 1, ok: true }],
  snapshot: {
    transport: 'in-process-projection',
    entries: [
      { entryId: 'include:triage-probe-ok', moduleName: '${CANDIDATE}', fiberPhase: 'active', enabled: true },
      { entryId: 'include:base', moduleName: '@deepseek-ai/dsh-base', fiberPhase: 'active', enabled: true },
    ],
  },
}

if (process.env.FAKE_SAMPLE_MODE === 'lock-scratch') {
  // Hop 1: a helper whose CWD is the probe's own scratch dir (the overlay lives there). It
  // starts hop 2, prints 'ready' and exits, so hop 2 is orphaned before the probe's tree kill.
  const helper = spawn(process.execPath, [process.env.FAKE_LOCK_HELPER], {
    cwd: dirname(patchPath),
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, FAKE_LOCK_DIR: dirname(patchPath) },
  })
  await new Promise((resolve) => helper.stdout.once('data', resolve))
  write(SAMPLE)
  // Exit now: the lock has to outlive the "Host", exactly like a lingering helper process.
  process.exit(0)
}
`

/** Hop 2: the actual locker. It holds the directory as its CWD and outlives both parents. */
const LOCK_HELPER = `
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const locker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  cwd: process.env.FAKE_LOCK_DIR,
  stdio: 'ignore',
  detached: true,
  windowsHide: true,
})
writeFileSync(process.env.FAKE_LOCK_PID_FILE, String(locker.pid), 'utf8')
locker.unref()
console.log('ready')
process.exit(0)
`

interface Harness {
  readonly root: string
  readonly dshMain: string
  readonly scratchRoot: string
  readonly dshHome: string
  readonly profileDir: string
  readonly hookSource: string
  readonly lockPidFile: string
  readonly lockHelper: string
}

function harness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-scratch-lock-'))
  const dshMain = join(root, 'fake-launcher.mjs')
  writeFileSync(dshMain, FAKE_LAUNCHER, 'utf8')
  const lockHelper = join(root, 'lock-helper.mjs')
  writeFileSync(lockHelper, LOCK_HELPER, 'utf8')
  // Only *copied* by `bootAndSampleHost`; the fake launcher never loads it.
  const hookSource = join(root, 'hook.mjs')
  writeFileSync(hookSource, 'export const name = "fake-hook"\n', 'utf8')
  const dshHome = join(root, 'home')
  mkdirSync(join(dshHome, 'profiles', 'web'), { recursive: true })
  return {
    root,
    dshMain,
    scratchRoot: join(root, 'scratch'),
    dshHome,
    profileDir: join(dshHome, 'profiles', 'web'),
    hookSource,
    lockPidFile: join(root, 'lock.pid'),
    lockHelper,
  }
}

function bootLocked(each: Harness): Promise<BootSampleResult> {
  return bootAndSampleHost({
    dshMain: each.dshMain,
    dshHome: each.dshHome,
    profile: 'web',
    profileDir: each.profileDir,
    hookSource: each.hookSource,
    scratchRoot: each.scratchRoot,
    env: {
      ...process.env,
      FAKE_SAMPLE_MODE: 'lock-scratch',
      FAKE_LOCK_PID_FILE: each.lockPidFile,
      FAKE_LOCK_HELPER: each.lockHelper,
    },
    settleMs: 0,
    timeoutMs: 30_000,
    sampleReplaceWindowMs: 1_000,
  })
}

/** Kill the locker the fixture started (if it ever got that far). */
function releaseLocker(each: Harness): void {
  if (!existsSync(each.lockPidFile)) return
  const pid = Number.parseInt(readFileSync(each.lockPidFile, 'utf8').trim(), 10)
  if (!Number.isFinite(pid) || pid <= 0) return
  spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { encoding: 'utf8' })
}

/**
 * `rmSync` until the OS has released the handle the killed locker held.
 *
 * WHY RETRY: a killed process releases its handles asynchronously, so the first attempt after
 * `taskkill /F` can still see the directory as locked. 40 × 50ms is generous and bounded — and
 * it doubles as the proof that the LOCK was the cause: once the locker is gone the same `rmSync`
 * that just threw EPERM succeeds.
 */
async function removeWithRetry(directory: string, attempts = 40): Promise<Error | null> {
  let last: Error | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(directory, { recursive: true, force: true })
      if (!existsSync(directory)) return null
      last = new Error(`still there: ${directory}`)
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error))
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return last
}

/* --------------------------- the OS, not a seam --------------------------- */

test(
  'a scratch dir held by a live CWD lock: the sample survives, the leak is reported (BS-41)',
  { skip: windowsOnly },
  async () => {
    const each = harness()
    try {
      const result = await bootLocked(each)

      /*
       * (1) THE MEASUREMENT SURVIVED. Before R37 the cleanup exception escaped and destroyed a
       * sample that had already been read. This is the assertion that stops that from coming back.
       */
      assert.equal(result.host.status, 'sampled', 'the sample was read before cleanup failed')
      assert.equal(isUsableSample(result.payload), true, 'cleaning up late must not discard a good sample')
      assert.equal(result.setupError, null, 'preparation succeeded; only the removal was refused')

      /*
       * (2) THE FAILURE IS REPORTED, NOT SWALLOWED. The claim in BS-41 is "the OS can refuse
       * this"; the artifact has to carry that refusal, or the next reader sees a clean run.
       */
      assert.notEqual(result.scratchCleanupError, null, 'a leaked scratch dir must never be silent')
      assert.match(
        String(result.scratchCleanupError),
        /^E(PERM|BUSY|ACCES)/,
        `expected the Windows sharing/permission error the R37 artifact showed, got: ${result.scratchCleanupError}`,
      )

      /*
       * (3) THE LEAK IS REAL ON DISK. `rm -r` may have deleted the files inside before it was
       * refused the root, so only the root is asserted — and that is the fact that matters: a
       * directory the probe could not remove stayed behind under the shared temp root.
       * Asserting it keeps the fixture honest: if the lock ever stopped working, this test would
       * fail instead of quietly passing on a machine where the mechanism is gone.
       */
      const leftovers = readdirSync(each.scratchRoot)
      assert.equal(leftovers.length, 1, `expected one leaked probe dir, got: ${leftovers.join(', ') || 'none'}`)
      assert.match(String(leftovers[0]), /^triage-live-/, 'the leaked directory is the probe scratch dir')
    } finally {
      releaseLocker(each)
      const failure = await removeWithRetry(each.root)
      assert.equal(failure, null, `the fixture must clean up after itself: ${failure?.message ?? ''}`)
    }
  },
)

test(
  'a cleanup EPERM does not turn a measured candidate into blocked or unknown (BS-41)',
  { skip: windowsOnly },
  async () => {
    const each = harness()
    try {
      const result = await bootLocked(each)
      const run = await runExec(bootDep(async () => result))

      // Same facts the judge would see in production: one active row, served port, and our
      // scratch cleanup refused by the OS.
      assert.notEqual(run.bootScratchCleanupError, null, 'the artifact must publish the leak')
      assert.equal(run.bootSetupError, null, 'a cleanup failure is not a setup failure')

      const judgement = judgeProbe({ run, at: AT })
      assert.equal(
        judgement.conclusion,
        'go',
        'R37 regression: our own file lock must not change the verdict about the candidate',
      )
      assert.deepEqual(judgement.missingEvidence, [], 'nothing was missing — the reading is valid')
      assert.equal(judgement.reasons.some((reason) => reason.messageId === 'probe.boot-timeout'), false)
      assert.equal(
        probeAssertions(run).find((assertion) => assertion.id === 'boot-sampled')?.status,
        'passed',
        'the sample is the artifact; the leftover directory is not part of it',
      )
      assert.equal(run.steps.find((step) => step.id === 'boot')?.status, 'passed')
    } finally {
      releaseLocker(each)
      const failure = await removeWithRetry(each.root)
      assert.equal(failure, null, `the fixture must clean up after itself: ${failure?.message ?? ''}`)
    }
  },
)

test('a scratch dir that cannot even be created is unknown + missing.probe, never blocked (N24, real fixture)', async () => {
  /*
   * This is N24 with the fake replaced by the OS. `mkdirSync(scratchRoot, {recursive:true})` where
   * the scratch root's parent is a FILE fails with ENOTDIR — no injected error, no seam. The
   * interesting part is not the failure but what the engine does with it: the historical bug was
   * that "no sample, no URL, no startup failed" meant `probe.boot-timeout` → `blocked`.
   */
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-scratch-setup-'))
  try {
    const blocker = join(root, 'not-a-directory')
    writeFileSync(blocker, 'x', 'utf8')
    const dshMain = join(root, 'fake-launcher.mjs')
    writeFileSync(dshMain, FAKE_LAUNCHER, 'utf8')
    const hookSource = join(root, 'hook.mjs')
    writeFileSync(hookSource, 'export const name = "fake-hook"\n', 'utf8')
    const dshHome = join(root, 'home')
    mkdirSync(join(dshHome, 'profiles', 'web'), { recursive: true })

    const result = await bootAndSampleHost({
      dshMain,
      dshHome,
      profile: 'web',
      profileDir: join(dshHome, 'profiles', 'web'),
      hookSource,
      scratchRoot: join(blocker, 'scratch'),
      env: { ...process.env, FAKE_SAMPLE_MODE: 'lock-scratch', FAKE_LOCK_PID_FILE: join(root, 'unused.pid') },
      settleMs: 0,
      timeoutMs: 5_000,
    })

    // The boot layer reports the refusal instead of throwing (a throw is what N24b covers).
    assert.equal(result.payload, null)
    assert.match(String(result.error), /^scratch-setup-failed: /)
    assert.match(String(result.setupError), /^scratch-setup-failed: /)
    assert.equal(result.scratchCleanupError, null, 'nothing was created, so nothing leaked')
    // Nothing was spawned: the unmeasured boot is all zeros, not a Host that failed to start.
    assert.equal(result.segments.totalMs, 0)
    assert.equal(result.host.first_line, '')

    const run = await runExec(bootDep(async () => result))
    const judgement = judgeProbe({ run, at: AT })
    assert.equal(judgement.conclusion, 'unknown', 'our filesystem is not the plugin')
    assert.ok(judgement.missingEvidence.includes('missing.probe'))
    assert.equal(judgement.missingEvidence.includes('missing.inventory'), false, 'nothing was measured at all')
    assert.equal(judgement.reasons.some((reason) => reason.messageId === 'probe.boot-timeout'), false)
    assert.ok(judgement.reasons.some((reason) => reason.messageId === 'probe.measurement-unavailable'))
    const bootStep = run.steps.find((step) => step.id === 'boot')
    assert.equal(bootStep?.status, 'failed')
    assert.match(String(bootStep?.detail), /scratch-setup-failed/)
    // The three boot-dependent assertions all read `unmeasured`, never `failed`.
    for (const id of ['boot-sampled', 'http-served', 'inventory-active']) {
      assert.equal(probeAssertions(run).find((assertion) => assertion.id === id)?.status, 'unmeasured', id)
    }
  } finally {
    const failure = await removeWithRetry(root)
    assert.equal(failure, null, `the fixture must clean up after itself: ${failure?.message ?? ''}`)
  }
})

/* ------------------------------ exec plumbing ------------------------------ */

function plan() {
  const built = buildProbePlan({
    candidate: 'tests/fixtures/probe/ok-plugin',
    realDshHome: join(tmpdir(), 'dsh-triage-probe-real', '.dsh'),
    workRoot: join(tmpdir(), 'dsh-triage-probe'),
  })
  assert.ok(built.ok)
  if (!built.ok) throw new Error('plan failed')
  return built.value
}

/**
 * The same mapping `packages/plugin/src/probe-run.ts` uses in production.
 *
 * WHY COPY IT HERE: the point of this file is that a REAL `BootSampleResult` reaches the judge
 * with the R37 fields intact. A fake deps object that hand-writes `setupError` is exactly the
 * weakness BS-41 was about, so the adapter is the production one, re-stated once.
 */
function bootDep(observe: () => Promise<BootSampleResult>): ProbeExecDeps['bootAndSample'] {
  return async () => {
    const boot = await observe()
    return {
      sample: boot.payload,
      seconds: boot.host.seconds,
      finalSeconds: boot.finalSeconds,
      detail: boot.error === null ? `sampled in ${boot.host.seconds}s` : boot.error,
      http: boot.http,
      readiness: boot.readiness,
      render: boot.render,
      renderSkipped: boot.renderSkipped,
      urlPrinted: boot.host.url_printed,
      firstLine: boot.host.first_line,
      errorTail: boot.host.error_tail,
      startupFailed: boot.host.startup_failed,
      bindFailedPorts: boot.host.bind_failed_ports,
      segments: boot.segments,
      replacement: boot.replacement,
      setupError: boot.setupError ?? null,
      scratchCleanupError: boot.scratchCleanupError ?? null,
    }
  }
}

/** Everything except `boot` is a fake: this file is about the boot layer's own filesystem. */
async function runExec(boot: ProbeExecDeps['bootAndSample']): Promise<ProbeRun> {
  let clock = 0
  return executeProbe(
    { plan: plan(), dshMain: '/fake/bin.js', candidatePackage: CANDIDATE },
    {
      now: () => {
        clock += 10
        return clock
      },
      readRuntimeVersion: async () => ({ version: '0.2.1-rc.4', detail: 'runtime 0.2.1-rc.4' }),
      install: async () => ({ exitCode: 0, detail: 'installed' }),
      bootAndSample: boot,
      probeHttp: async () => ({ status: 303, detail: 'HTTP 303' }),
      cleanup: async () => ({ removed: true, portClosed: true, detail: 'sandbox removed' }),
    },
  )
}
