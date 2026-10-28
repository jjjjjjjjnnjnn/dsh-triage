/**
 * Host I/O for the probe: the four side effects, in one place.
 *
 * WHY ONE PLACE: R12/R13 shipped two recorders that each booted the same sandbox Host.
 * They were merged into one helper because two copies of "write overlay → spawn → wait for
 * the sample → kill the tree" drift silently until one of them samples a different moment
 * than the other. The M3 executor would have been the third copy, so the machinery lives
 * here and `scripts/lib/live.mjs` re-exports it.
 *
 * NOTHING HERE JUDGES ANYTHING. Failure is returned as data; `packages/probe/src/exec.ts`
 * decides what it means.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { isAbsolute, join } from 'node:path'
import { extractHostUrl, renderUrl, type HostUrl, type RenderCheck } from './render.js'

/* -------------------------------- overlay --------------------------------- */

export interface ExtraPatchEntry {
  readonly id: string
  readonly name?: string
  readonly disabled?: boolean
}

export interface BootSampleOptions {
  readonly dshMain: string
  readonly dshHome: string
  readonly profile: string
  readonly profileDir: string
  /** Path to the inventory hook that will be copied beside the overlay. */
  readonly hookSource: string
  readonly scratchRoot: string
  readonly config?: Readonly<Record<string, unknown>>
  readonly extraPatch?: readonly ExtraPatchEntry[]
  readonly timeoutMs?: number
  /** Base environment for the child; callers pass a scrubbed one. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
  /**
   * Arguments passed through to the profile's app (they must come after the launcher
   * flags). The probe uses `--port <p> --no-open`: the port makes the readiness check
   * predictable, and `--no-open` stops a probe from launching the user's browser.
   */
  readonly appArgs?: readonly string[]
  /**
   * Port to probe for readiness BEFORE the process tree is killed.
   *
   * This ordering is the whole point: the sample arrives while the Host is alive, and the
   * first version killed it first, so every HTTP check hit a dead port (measured in R14).
   */
  readonly readinessPort?: number
  /** How long to wait for the port after the sample lands. */
  readonly readinessTimeoutMs?: number
  /**
   * Readiness window used when the sample itself says the tree was still moving
   * (`settled: false`) or the projection could not be read at all.
   *
   * WHY A SEPARATE WINDOW (R17 / BS-25): "the tree has not finished composing" and "the
   * plugin is broken" used to produce the same `blocked` verdict. A settled tree keeps the
   * 5s budget (unchanged threshold); an unsettled one gets a longer, configurable window
   * that can only ever produce `unknown` (the judge enforces that, not this layer).
   */
  readonly unsettledReadinessMs?: number
  /**
   * How long an **unreadable** first sample may be replaced before we accept it.
   *
   * Cordis re-applies a plugin when its injected services come back, so an `{error}`
   * payload written by a task whose context died can be superseded by a healthy sample
   * from the new apply (measured in R17). We wait for that, bounded.
   *
   * ADR-0008 option E narrows this to `{error}` only: a `settled: false` sample is the
   * hook's own final word and converges immediately. See {@link SampleReplacement}.
   */
  readonly sampleReplaceWindowMs?: number
  /**
   * How long to wait for the FINAL sample after a provisional one (T-312).
   *
   * WHY THIS EXISTS: the hook now publishes its first readable snapshot immediately
   * (`provisional: true`) and overwrites it once the settle loop ends. The judged budget is
   * "spawn → first sample", so a tree that needs 10–18s to settle no longer breaches it — but
   * the verdict should still use the settled phase table when it arrives in time. Defaults to
   * the hook's own settle budget (`settleTimeoutMs`, 15s in the shipped hook): waiting longer
   * than the hook can possibly take would buy nothing.
   */
  readonly sampleUpgradeWindowMs?: number
  /** Settle time between the sample and the readiness probe, so a binding server is seen. */
  readonly settleMs?: number
  /**
   * Client-render check (T-302). `browser` comes from {@link findBrowser}; when the caller
   * has no browser, it passes `null` and the run reports the reason instead of a verdict.
   *
   * The check must run while the Host is alive — the page is served by this very process.
   */
  readonly render?: {
    readonly browser: string | null
    readonly timeoutMs?: number
  }
}

export interface HostReadiness {
  /**
   * Where the port came from. `host-url` is the launcher's own `dsh web: http://…` line
   * (T-306); `plan-port` is the fallback when that line never appeared.
   */
  readonly source: 'host-url' | 'plan-port'
  readonly port: number
  /** Did the window end with an answer? (`served` and `timeout` are facts, not verdicts.) */
  readonly outcome: 'served' | 'timeout'
  /** How long the window actually waited. Recorded so "we waited N s" survives review. */
  readonly waited_ms: number
  /** The budget this run used: settled trees keep 5s, unsettled ones get the long window. */
  readonly window_ms: number
  /** Did the launcher ever print its own `?token=` URL? */
  readonly url_seen: boolean
}

export interface HostObservation {
  readonly status: 'sampled' | 'no-sample'
  readonly seconds: number
  readonly log_sha256: string
  readonly first_line: string
  readonly error_tail: string | null
  /**
   * Did the launcher ever print its own `http://127.0.0.1:<port>/?token=…` line?
   *
   * WHY IT IS A SEPARATE FACT (R17): when the hook writes nothing, "the Host is up and our
   * instrument never ran" and "the Host never came up" produce the same empty file. The URL
   * line is the only evidence that separates them, and only the first is a measurement
   * failure (the second is a real `blocked`).
   */
  readonly url_printed: boolean
  /** Did the launcher declare startup failure? Then no sample will ever arrive (R17). */
  readonly startup_failed: boolean
  /** Ports the Host log says it could not bind (`listen EACCES: … 127.0.0.1:53506`). */
  readonly bind_failed_ports: readonly number[]
}

export interface BootSampleResult {
  readonly payload: unknown | null
  readonly host: HostObservation
  readonly error: string | null
  /**
   * Spawn → the FIRST sample (T-312). This is the judged number: the executor had an answer
   * this long after the boot started, even when that answer was the provisional one.
   */
  readonly seconds: number
  /** Spawn → the FINAL sample (equal to {@link seconds} when no upgrade happened). */
  readonly finalSeconds: number
  /** Readiness measured while the Host was still alive; `null` when not requested. */
  readonly http: { readonly status: number | null; readonly detail: string } | null
  /** Where the readiness port came from (T-306); `null` when readiness was not requested. */
  readonly readiness: HostReadiness | null
  /** Client-render result; `null` when it was skipped (see {@link BootSampleResult.renderSkipped}). */
  readonly render: RenderCheck | null
  /** Why the render check did not run, in publishable words; `null` when it did run. */
  readonly renderSkipped: string | null
  /**
   * Where the boot step's wall time went (T-314).
   *
   * WHY THIS EXISTS: R21 measured `boot` steps of 22.1–25.3s while `boot→sample` — the only
   * number the budget judges — was 9.6–12.2s. A 12s gap with no explanation is not a number
   * anyone can act on, and guessing ("it must be the settle") was already wrong once. Every
   * segment below is a clock reading taken around one await, so the sum has to add up.
   */
  readonly segments: BootSegments
  /**
   * What the sample loop did about the replacement window (ADR-0008 E).
   *
   * WHY IT IS A FIELD AND NOT A TIME DIFFERENCE: after E a `settled: false` sample converges
   * immediately while an `{error}` sample still waits the full window, so two runs can share
   * a `boot` wall clock and mean completely different things. Readers must not have to infer
   * "did we wait" from `sampleWaitMs - sampleMtimeMs`.
   */
  readonly replacement: SampleReplacement
  /**
   * The probe could not prepare its own scratch files, so nothing about the candidate was measured
   * (R37). `null` means preparation succeeded — it does NOT mean the boot succeeded.
   */
  readonly setupError?: string | null
  /** Our scratch directory survived its own removal; a leak, reported instead of thrown (R37). */
  readonly scratchCleanupError?: string | null
}

/**
 * The pnpm layout a sandbox ended up with (T-315 residual, R30).
 *
 * WHY NOT TRUST THE CONFIG: R26 wrote `nodeLinker: hoisted` into a copied source and the probe
 * still said `go`, but the artifact never recorded the layout — so the honest claim was "this
 * shape is not misjudged", not "pnpm switched". Reading the dir is cheap and makes the claim
 * checkable. Declared-but-not-applied is a real possibility (a shared store can win), which is
 * why `declared` and the observed layout are separate fields instead of one boolean.
 */
export interface NodeLayout {
  /** What the sandbox's `node_modules` really is (see {@link readNodeLayout} for how it is read). */
  readonly linker: 'isolated' | 'hoisted' | 'absent'
  /**
   * `nodeLinker` as pnpm itself wrote it into `node_modules/.modules.yaml` — which is the
   * EFFECTIVE value, not the config we copied. `null` = pnpm did not state it.
   */
  readonly declared: string | null
  /** Non-dot entries directly in `node_modules`. */
  readonly topLevel: number
  /**
   * Whether a top-level package entry is a symlink into the virtual store.
   *
   * THIS is the observation that separates the two layouts... except for packages installed as
   * local links (`file:`/`link:`), which are symlinks pointing OUTSIDE the store. R31 hit exactly
   * that: the probe fixture is installed as a link, so "is the first entry a symlink" answered
   * "isolated" for a hoisted tree. The count below only follows links that land inside
   * `.pnpm`, which is what the isolated layout actually does.
   */
  readonly topLevelSymlink: boolean | null
  /**
   * How many top-level entries are symlinks INTO `node_modules/.pnpm` (isolated shape).
   *
   * Local `file:`/`link:` dependencies are symlinks too, so they are counted separately by
   * construction: if this is 0 the layout is not isolated, whatever the first entry looks like.
   */
  readonly virtualStoreLinks: number
  /** Does `node_modules/.pnpm` exist? Present in both layouts on pnpm 12 — informational only. */
  readonly pnpmStore: boolean
}

/** Read {@link NodeLayout} from a profile dir. `null` = could not read (never a guess). */
export function readNodeLayout(dir: string): NodeLayout | null {
  try {
    const nodeModules = join(dir, 'node_modules')
    if (!existsSync(nodeModules)) {
      return { linker: 'absent', declared: null, topLevel: 0, topLevelSymlink: null, virtualStoreLinks: 0, pnpmStore: false }
    }
    const modulesYaml = join(nodeModules, '.modules.yaml')
    let declared: string | null = null
    if (existsSync(modulesYaml)) {
      // pnpm writes this file with quoted keys and trailing commas (`  "nodeLinker": "hoisted",`),
      // so a strict YAML line match misses it — R31 read `null` for a file that said exactly this.
      const match = /["']?nodeLinker["']?\s*:\s*["']?([A-Za-z0-9_-]+)/.exec(readFileSync(modulesYaml, 'utf8'))
      if (match !== null) declared = match[1] ?? null
    }
    const entries = readdirSync(nodeModules).filter((entry) => !entry.startsWith('.'))
    const store = join(nodeModules, '.pnpm')
    let topLevelSymlink: boolean | null = null
    let virtualStoreLinks = 0
    for (const entry of entries) {
      const full = join(nodeModules, entry)
      let isLink = false
      try {
        isLink = lstatSync(full).isSymbolicLink()
      } catch {
        continue
      }
      if (topLevelSymlink === null) topLevelSymlink = isLink
      if (isLink) {
        try {
          const target = readlinkSync(full)
          const resolved = isAbsolute(target) ? target : join(nodeModules, target)
          if (resolved.startsWith(store)) virtualStoreLinks += 1
        } catch {
          // An unreadable link is not evidence either way.
        }
      }
    }
    const linker =
      declared === 'isolated' || declared === 'hoisted'
        ? declared
        : entries.length === 0
          ? 'absent'
          : virtualStoreLinks > 0
            ? 'isolated'
            : 'hoisted'
    return {
      linker,
      declared,
      topLevel: entries.length,
      topLevelSymlink,
      virtualStoreLinks,
      pnpmStore: existsSync(store),
    }
  } catch {
    return null
  }
}

/**
 * The sample loop's replacement decision, recorded per run (ADR-0008 E).
 *
 * THE MEASUREMENT THAT PRODUCED IT: the 20.3s of an unjudgeable boot was one whole
 * replacement window, and across the 29 recorded artifacts that window never once produced a
 * better sample (`scripts/report_replacement_window.mjs`, `replacements_observed = 0`). So a
 * `settled: false` reading — the hook already spent its own settle budget — is accepted as
 * final, and only an unreadable `{error}` sample (the R17 dead-context shape, where a new
 * apply really can overwrite the file) still opens the window.
 */
export interface SampleReplacement {
  /** Only an unreadable sample opens the window; `settled: false` does not. */
  readonly policy: 'error-only'
  /**
   * Did the loop wait for a REPLACEMENT, i.e. sleep while holding an unreadable `{error}` sample?
   *
   * R29 (`BS-33`): before T-312 this flag was set by any sleep after the first sample, which
   * meant the T-312 upgrade wait (a provisional sample that is perfectly readable) was recorded
   * as a replacement wait — every matrix run after R28 read `replacement_waited: true` while
   * `stoppedBy: 'readable-sample'`. E's whole point is that the two waits are different
   * decisions, so the flag now means what the docs always claimed: `true` only for `{error}`.
   */
  readonly waited: boolean
  /** How long it kept running after that first sample (`0` when it did not wait). */
  readonly waitedMs: number
  /**
   * Why the loop outlived the first sample, or `null` when it did not.
   *
   * `unreadable` = ADR-0008 E's replacement window; `upgrade` = T-312's provisional→final
   * wait. Before R29 this distinction was only inferable from `stoppedBy` + `upgraded`.
   */
  readonly reason: 'unreadable' | 'upgrade' | null
  /** Distinct sample bodies the loop read; `>= 2` means the file was overwritten. */
  readonly samples: number
  /** Which condition ended the loop. */
  readonly stoppedBy: 'readable-sample' | 'upgrade-window' | 'unreadable-window' | 'timeout' | 'startup-failed'
  /**
   * T-312: the first sample was provisional and a final one replaced it.
   *
   * `false` with `samples >= 2` means the file was overwritten by something the loop did NOT
   * count as an upgrade (a different `applies` generation = another apply wrote it).
   */
  readonly upgraded: boolean
  /** T-312: how long the loop waited for that final sample (`0` when none was awaited). */
  readonly upgradeWaitedMs: number
}

/**
 * One clock reading per phase of a boot, all in milliseconds from the same origin.
 *
 * `totalMs` is spawn → return, which is what the caller's step timer also sees; if the two
 * disagree by more than a few ms, one of the boundaries is being measured in the wrong place.
 */
export interface BootSegments {
  /** spawn() returned. */
  readonly spawnMs: number
  /** spawn → the sample loop exited (may be after an upgrade, or a startup failure). */
  readonly sampleWaitMs: number
  /** spawn → the FIRST sample file's mtime: exactly what `boot→sample` judges (T-312). */
  readonly sampleMtimeMs: number | null
  /** spawn → the FINAL sample file's mtime; equal to `sampleMtimeMs` when no upgrade happened. */
  readonly finalSampleMtimeMs: number | null
  /** Sample loop exit → settle sleep finished. Includes the settle budget itself. */
  readonly settleMs: number
  /** Settle → the readiness window ended. */
  readonly readinessMs: number
  /** Readiness → the render observation returned (browser spawn + CDP + teardown). */
  readonly renderMs: number
  /** Killing the whole process tree (`taskkill /T /F` on Windows is not instant). */
  readonly killMs: number
  /** Fixed wait after the kill, so the OS can release ports. */
  readonly postKillWaitMs: number
  /** Removing the scratch directory (sample, overlay, hook, throwaway browser profile). */
  readonly scratchCleanupMs: number
  /** spawn → return. */
  readonly totalMs: number
}

/**
 * Boot the Host with a one-entry launcher overlay that mounts `hookSource`, wait for the
 * hook to write its sample, then kill the whole process tree.
 */
export async function bootAndSampleHost(options: BootSampleOptions): Promise<BootSampleResult> {
  const {
    dshMain,
    dshHome,
    profile,
    profileDir,
    hookSource,
    scratchRoot,
    config = {},
    extraPatch = [],
    timeoutMs = 180_000,
    env = process.env,
    appArgs = [],
    readinessPort,
    readinessTimeoutMs = 5_000,
    unsettledReadinessMs = 20_000,
    sampleReplaceWindowMs = unsettledReadinessMs,
    /**
     * T-312: how long to wait for the final sample after a provisional one. Tied to the shipped
     * hook's own settle budget (15s) — waiting longer than the hook can take would buy nothing.
     */
    sampleUpgradeWindowMs = 15_000,
    settleMs = 1_000,
  } = options
  /*
   * THE PROBE'S OWN SCRATCH DIR IS NOT PART OF THE MEASUREMENT (R37).
   *
   * Measured failure this prevents: `rmSync(probeDir)` threw EPERM (Windows held a handle), the
   * exception escaped `bootAndSampleHost`, the executor caught it as a failed `boot` step, and the
   * judge fell through to `probe.boot-timeout` — so a candidate was reported `blocked` because OUR
   * scratch directory could not be deleted
   * (`data/results/probe-matrix-2026-10-29T15-30-00.000Z.json`, `real-unlag`).
   *
   * So: preparation failures and scratch-cleanup failures are recorded as facts on the result and
   * never thrown, and a cleanup failure can no longer destroy a sample we already have.
   */
  let setupError: string | null = null
  let scratchCleanupError: string | null = null
  let probeDir: string | null = null
  try {
    mkdirSync(scratchRoot, { recursive: true })
    probeDir = mkdtempSync(join(scratchRoot, 'triage-live-'))
  } catch (error) {
    const detail = `scratch-setup-failed: ${error instanceof Error ? error.message : String(error)}`
    return unmeasuredBoot(detail, detail)
  }
  const samplePath = join(probeDir, 'sample.json')
  const patchPath = join(probeDir, 'overlay.patch.yml')
  const hookPath = join(probeDir, 'inventory-hook.mjs')
  let child: ChildProcess | null = null
  try {
    try {
      copyFileSync(hookSource, hookPath)

      /**
       * Merge the caller's hook config over the defaults instead of appending it.
       *
       * WHY (T-316): `resolveFrom` / `profile` used to be emitted before `config`, so a caller
       * could not override them — and an experiment that needs the hook to talk to a different
       * tree (e.g. one with no projection package, to make the hook write a real `{error}`) had
       * no way to say so. Duplicate YAML keys were the alternative and they are a parser trap.
       * `out` is written LAST on purpose: the sample path is the loop's contract, not a knob.
       */
      const hookConfig = { resolveFrom: profileDir.replaceAll('\\', '/'), profile, ...config }
      const configLines = [
        ...Object.entries(hookConfig)
          .filter(([key]) => key !== 'out')
          .map(([key, value]) => `        ${key}: ${JSON.stringify(value)}`),
        `        out: '${samplePath.replaceAll('\\', '/')}'`,
      ]
      writeFileSync(
        patchPath,
        [
          '- insert:',
          '    - id: triage-inventory-probe',
          "      name: './inventory-hook.mjs'",
          '      config:',
          ...configLines,
          // Experiment overlays come after the probe so a row the probe targets is already
          // composed when the overlay patches it (the launcher applies them in order).
          ...extraPatch.flatMap((entry) => [
            `- id: ${entry.id}`,
            ...(entry.name === undefined ? [] : [`  name: '${entry.name}'`]),
            ...(entry.disabled === undefined ? [] : [`  disabled: ${entry.disabled}`]),
          ]),
          '',
        ].join('\n'),
        'utf8',
      )
    } catch (error) {
      setupError = `scratch-setup-failed: ${error instanceof Error ? error.message : String(error)}`
      try {
        rmSync(probeDir, { recursive: true, force: true })
      } catch {
        // Leaving the directory behind is reported by the caller; the reason above is what matters.
      }
      return unmeasuredBoot(setupError, setupError)
    }

    const started = Date.now()
    child = spawn(process.execPath, [dshMain, '--profile', profile, '--patch', patchPath, ...appArgs], {
      env: { ...env, DSH_HOME: dshHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const spawnedAt = Date.now()
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    /**
     * Wait for a sample we can judge from.
     *
     * A file appearing is not enough (R17): the hook can write `{error}` when its context
     * died mid-compose, and Cordis re-applies the plugin once the services are back — the
     * next apply overwrites the same file with a healthy sample. So we keep the best sample
     * we have and wait, bounded, for a better one instead of freezing the first write.
     *
     * ADR-0008 E narrows who is worth waiting for: an unreadable `{error}` sample still opens
     * the window (that is exactly R17's recovery path), but a FINAL `settled: false` sample is
     * the hook's own last word, so it converges here instead of buying another full window.
     *
     * T-312 adds the other half: a `provisional: true` sample is readable but explicitly not
     * the hook's last word, so it opens a bounded upgrade window instead of converging. The
     * judged budget is the FIRST sample; the verdict uses the final one when it arrives.
     */
    let payload: unknown = null
    let sampleText: string | null = null
    let firstSampleAtMs: number | null = null
    let firstSampleWrittenAtMs: number | null = null
    let sampleWrittenAtMs: number | null = null
    let sampleReads = 0
    let waitedForReplacement = false
    /** R29 (`BS-33`): when the run started waiting on an UNREADABLE sample, and how long that lasted. */
    let replacementWaitStartedAtMs: number | null = null
    let replacementWaitedMs = 0
    let upgradeStartedAtMs: number | null = null
    let upgraded = false
    let stoppedBy: SampleReplacement['stoppedBy'] = 'timeout'
    for (;;) {
      const text = readTextOrNull(samplePath)
      if (text !== null && text !== sampleText) {
        sampleText = text
        sampleReads += 1
        payload = parseSample(text)
        const writtenAt = mtimeMsOf(samplePath)
        if (firstSampleAtMs === null) {
          firstSampleAtMs = Date.now()
          firstSampleWrittenAtMs = writtenAt
        }
        sampleWrittenAtMs = writtenAt ?? sampleWrittenAtMs
        // A final sample that replaces a provisional one is an upgrade, not a new apply.
        if (sampleReads > 1 && isReadableSample(payload) && !isProvisionalSample(payload)) upgraded = true
      }
      const readable = isReadableSample(payload)
      const provisional = readable && isProvisionalSample(payload)
      // R29 (`BS-33`): the replacement window ends the moment a readable sample lands, so its
      // duration is measured here rather than inferred from the loop's end (the T-312 upgrade
      // wait can follow it and would otherwise be folded into the same number).
      if (readable && replacementWaitStartedAtMs !== null && replacementWaitedMs === 0) {
        replacementWaitedMs = Date.now() - replacementWaitStartedAtMs
      }
      // T-312: when the provisional sample tells us its own settle budget, wait exactly that long
      // plus a margin — waiting less loses upgrades at the boundary, waiting more buys nothing.
      // A payload without the field (older hook) falls back to the configured window.
      const settleBudget = provisional ? settleTimeoutOf(payload) : null
      const upgradeWindowMs = settleBudget === null ? sampleUpgradeWindowMs : settleBudget + 1_000
      // `dsh: startup failed: …` is the launcher's own verdict: no sample will follow, and
      // waiting the whole boot timeout for one costs two minutes per broken candidate (R17).
      const startupFailed = `${stdout}\n${stderr}`.includes('startup failed')
      // ADR-0008 E: only an UNREADABLE sample is worth replacing, and only for one window.
      const replacedEnough = firstSampleAtMs !== null && !readable && Date.now() - firstSampleAtMs >= sampleReplaceWindowMs
      // T-312: a provisional sample is readable, so E would converge on it. Instead give the
      // hook one bounded window to publish the settled snapshot (it cannot exceed its own
      // settle budget, which is what the default window is tied to).
      if (provisional && upgradeStartedAtMs === null) upgradeStartedAtMs = Date.now()
      const upgradeEnough =
        provisional && upgradeStartedAtMs !== null && Date.now() - upgradeStartedAtMs >= upgradeWindowMs
      if (readable && !provisional) {
        stoppedBy = 'readable-sample'
        break
      }
      if (Date.now() - started >= timeoutMs) {
        stoppedBy = 'timeout'
        break
      }
      if (replacedEnough) {
        stoppedBy = 'unreadable-window'
        break
      }
      if (upgradeEnough) {
        stoppedBy = 'upgrade-window'
        break
      }
      if (startupFailed) {
        stoppedBy = 'startup-failed'
        break
      }
      // About to sleep while already holding a sample. R29 (`BS-33`): this is a REPLACEMENT
      // wait only when that sample was unreadable — E's decision. T-312 also sleeps here, but
      // on a readable provisional sample, and that wait is reported as `upgradeWaitedMs`.
      if (firstSampleAtMs !== null && !readable) {
        if (replacementWaitStartedAtMs === null) replacementWaitStartedAtMs = Date.now()
        waitedForReplacement = true
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
    const collected = payload !== null
    // The judged number is the FIRST sample (T-312); `finalSeconds` says when the sample the
    // verdict rests on arrived.
    const seconds = Math.round((((firstSampleWrittenAtMs ?? sampleWrittenAtMs) ?? Date.now()) - started) / 100) / 10
    const finalSeconds = Math.round(((sampleWrittenAtMs ?? Date.now()) - started) / 100) / 10
    // T-314 boundaries, all relative to `started` (the same origin as the judged budget). Each
    // is set to the previous phase's end until that phase actually runs, so a skipped phase
    // contributes 0 rather than a gap.
    const loopEndedAt = Date.now()
    const replacement: SampleReplacement = {
      policy: 'error-only',
      waited: waitedForReplacement,
      waitedMs:
        replacementWaitStartedAtMs === null
          ? 0
          : replacementWaitedMs > 0
            ? replacementWaitedMs
            : loopEndedAt - replacementWaitStartedAtMs,
      reason: waitedForReplacement ? 'unreadable' : upgradeStartedAtMs === null ? null : 'upgrade',
      samples: sampleReads,
      stoppedBy,
      upgraded,
      upgradeWaitedMs: upgradeStartedAtMs === null ? 0 : loopEndedAt - upgradeStartedAtMs,
    }
    let settleEndedAt = loopEndedAt
    let readinessEndedAt = loopEndedAt
    let renderEndedAt = loopEndedAt
    let http: { status: number | null; detail: string } | null = null
    let readiness: HostReadiness | null = null
    let render: RenderCheck | null = null
    let renderSkipped: string | null = null
    let hostUrl: HostUrl | null = null
    if (collected) {
      // Probe while the Host is alive. A server that binds a moment after the tree
      // settles is normal, so this retries instead of sampling one instant.
      await new Promise((resolveWait) => setTimeout(resolveWait, settleMs))
      settleEndedAt = Date.now()
      readinessEndedAt = settleEndedAt
      renderEndedAt = settleEndedAt
      // One window, two sources (R17): the launcher's own token URL and the planned port
      // are polled together, because waiting for the URL first (the R15 order) missed a URL
      // that appeared a moment later and then judged the fallback port.
      const unsettled = !isUsableSample(payload)
      const windowMs = unsettled ? unsettledReadinessMs : readinessTimeoutMs
      if (readinessPort !== undefined || options.render !== undefined) {
        const readinessStarted = Date.now()
        for (;;) {
          if (hostUrl === null) hostUrl = extractHostUrl(stdout)
          const port = hostUrl?.port ?? readinessPort
          if (port !== undefined) {
            http = await probeHttp(port, Math.min(2_000, windowMs))
            if (http.status !== null) break
          }
          if (Date.now() - readinessStarted >= windowMs) break
          await new Promise((resolveWait) => setTimeout(resolveWait, 250))
        }
        const port = hostUrl?.port ?? readinessPort
        if (port !== undefined) {
          readiness = {
            source: hostUrl === null ? 'plan-port' : 'host-url',
            port,
            outcome: http?.status === null || http === null ? 'timeout' : 'served',
            waited_ms: Date.now() - readinessStarted,
            window_ms: windowMs,
            url_seen: hostUrl !== null,
          }
        }
        readinessEndedAt = Date.now()
        renderEndedAt = readinessEndedAt
      }
      if (options.render !== undefined) {
        if (options.render.browser === null) {
          renderSkipped = 'no Chromium-family browser was found on this machine (pass --browser or DSH_TRIAGE_BROWSER)'
        } else if (hostUrl === null) {
          renderSkipped = 'the Host printed no http://127.0.0.1:<port>/?token=… line, so there was nothing to render'
        } else {
          // Still inside the Host's lifetime: the page is served by this process.
          render = await renderUrl({
            browser: options.render.browser,
            url: hostUrl.url,
            // Keep the throwaway browser profile inside this run's scratch dir, so a killed
            // probe cannot leave a browser profile behind under the shared temp root.
            scratchRoot: probeDir,
            ...(options.render.timeoutMs === undefined ? {} : { timeoutMs: options.render.timeoutMs }),
          })
        }
        renderEndedAt = Date.now()
      }
    }
    // R21 left ~12s of the boot step unexplained. This is where it gets accounted for: the
    // kill (`taskkill /T /F` walks the tree), the fixed post-kill wait, and the scratch
    // removal all happen AFTER the sample, and none of them were measured before.
    const killStarted = Date.now()
    killTree(child)
    const killMs = Date.now() - killStarted
    const postKillStarted = Date.now()
    await new Promise((resolveWait) => setTimeout(resolveWait, 1200))
    const postKillWaitMs = Date.now() - postKillStarted

    const stderrLine = stderr.trimEnd().split(/\r?\n/)[0] ?? ''
    const stdoutLine = stdout.trimEnd().split(/\r?\n/)[0] ?? ''
    const host: HostObservation = {
      status: collected ? 'sampled' : 'no-sample',
      seconds,
      log_sha256: sha256Of(`${stdout}\n${stderr}`),
      // Stderr first, stdout as the real fallback: a healthy `dsh web` prints its URL on
      // stdout, so `?? ` on an always-string value would have hidden it (R15 review finding).
      first_line: sanitizeLogLine(stderrLine !== '' ? stderrLine : stdoutLine).slice(0, 240),
      // Kept short and only on failure: a blocked boot must explain itself, but a healthy
      // one should not carry a log into a publishable artifact. BOTH streams: the launcher
      // prints its own startup diagnostic on stdout (R17).
      error_tail: collected ? null : sanitizeLogLine(`${stdout}\n${stderr}`.trimEnd()).slice(-1500),
      url_printed: extractHostUrl(stdout) !== null,
      startup_failed: `${stdout}\n${stderr}`.includes('startup failed'),
      bind_failed_ports: bindFailedPorts(`${stdout}\n${stderr}`),
    }
    // Measured here rather than in `finally`, because a segment nobody can read is not a
    // measurement. `finally` keeps the same call as a backstop if this throws.
    const scratchStarted = Date.now()
    scratchCleanupError = removeScratch(probeDir)
    const scratchCleanupMs = Date.now() - scratchStarted
    child = null

    const segments: BootSegments = {
      spawnMs: spawnedAt - started,
      sampleWaitMs: loopEndedAt - started,
      // T-312: the judged number is the FIRST sample; the final one is recorded beside it.
      sampleMtimeMs: firstSampleWrittenAtMs === null ? null : Math.round(firstSampleWrittenAtMs - started),
      finalSampleMtimeMs: sampleWrittenAtMs === null ? null : Math.round(sampleWrittenAtMs - started),
      settleMs: collected ? settleEndedAt - loopEndedAt : 0,
      readinessMs: readinessEndedAt - settleEndedAt,
      renderMs: renderEndedAt - readinessEndedAt,
      killMs,
      postKillWaitMs,
      scratchCleanupMs,
      totalMs: Date.now() - started,
    }
    if (!collected) {
      return { payload: null, host, error: 'the hook wrote nothing within the timeout', seconds, finalSeconds, http, readiness, render, renderSkipped, segments, replacement, setupError, scratchCleanupError }
    }
    return { payload, host, error: null, seconds, finalSeconds, http, readiness, render, renderSkipped, segments, replacement, setupError, scratchCleanupError }
  } finally {
    if (child !== null) killTree(child)
    // Backstop only: a failure here must not turn a measurement into a throw (R37).
    removeScratch(probeDir)
  }
}

/**
 * Remove the probe's own scratch directory, reporting instead of throwing.
 *
 * @returns `null` on success, else the OS message — the caller publishes it, because a leaked
 *          directory in %TEMP% is a fact and silence would hide it.
 */
function removeScratch(directory: string): string | null {
  try {
    rmSync(directory, { recursive: true, force: true })
    return existsSync(directory) ? `the scratch directory is still there after rm -r: ${directory}` : null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * The result of a boot that never happened because OUR side could not prepare its files.
 *
 * Every field says "not measured": no sample, no URL, no readiness, no segments. The reason is
 * carried twice on purpose — `error` for humans, `setupError` for the judge, which must report
 * `unknown` rather than blaming the candidate (R37).
 */
function unmeasuredBoot(reason: string, setupError: string): BootSampleResult {
  return {
    payload: null,
    host: {
      status: 'no-sample',
      seconds: 0,
      log_sha256: sha256Of(''),
      first_line: '',
      error_tail: null,
      url_printed: false,
      startup_failed: false,
      bind_failed_ports: [],
    },
    error: reason,
    seconds: 0,
    finalSeconds: 0,
    http: null,
    readiness: null,
    render: null,
    renderSkipped: null,
    segments: {
      spawnMs: 0,
      sampleWaitMs: 0,
      sampleMtimeMs: null,
      finalSampleMtimeMs: null,
      settleMs: 0,
      readinessMs: 0,
      renderMs: 0,
      killMs: 0,
      postKillWaitMs: 0,
      scratchCleanupMs: 0,
      totalMs: 0,
    },
    replacement: {
      policy: 'error-only',
      waited: false,
      waitedMs: 0,
      reason: null,
      samples: 0,
      stoppedBy: 'timeout',
      upgraded: false,
      upgradeWaitedMs: 0,
    },
    setupError,
    scratchCleanupError: null,
  }
}

/** On Windows the Host keeps helper processes alive; kill the tree, not the parent. */
export function killTree(child: ChildProcess): void {
  try {
    child.kill()
  } catch {
    // Already gone.
  }
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { encoding: 'utf8' })
  }
}

/** Deterministic digest used in artifacts instead of storing logs. */
export function sha256Of(text: string): string {
  return createHash('sha256').update(String(text)).digest('hex')
}

/** The dsh CLI entry inside an install directory, or '' when it is not there. */
export function dshMainOf(installDir: string): string {
  return installDir === '' ? '' : join(installDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/* --------------------------------- steps ---------------------------------- */

export interface RuntimeReadResult {
  readonly version: string | null
  readonly detail: string
}

/** `dsh --version`; the version string is the only thing we take from it. */
export function readRuntimeVersion(input: { dshMain: string; timeoutMs: number; env: NodeJS.ProcessEnv }): RuntimeReadResult {
  const run = spawnSync(process.execPath, [input.dshMain, '--version'], {
    env: input.env,
    encoding: 'utf8',
    timeout: input.timeoutMs,
    killSignal: 'SIGKILL',
  })
  const text = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  const match = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(text)
  if (run.status !== 0 || match === null) {
    return { version: null, detail: text === '' ? `dsh --version exited ${run.status ?? 'null'}` : text.slice(0, 240) }
  }
  return { version: match[0], detail: match[0] }
}

export interface InstallResult {
  readonly exitCode: number | null
  readonly detail: string
  /**
   * Registry endpoints the package manager actually tried when the install failed.
   *
   * WHY: T-305b's whole point is "name the source". The launcher only prints the path of a
   * diagnostics log, so the endpoint lives inside that file. We extract URLs, strip
   * credentials/query/fragment, and publish at most a few — never the log itself.
   */
  readonly endpoints?: readonly string[]
  /** The package manager's own reason, when it said one (T-310). */
  readonly diagnosis: InstallDiagnosis
  /**
   * Packages the package manager installed without running their build scripts (R19 F35).
   *
   * Empty means "the output named none" — never "none were affected", so callers must treat
   * an empty list as unknown rather than as evidence.
   */
  readonly ignoredPackages: readonly string[]
  /**
   * Did pnpm report sending an authorization header? (R20)
   *
   * WHY THIS IS A FIELD AND NOT A COMMENT: the sandbox inherits `$HOME`, so pnpm reads the
   * operator's `~/.npmrc` and — measured 2/2 with a 404 — sends their token to the registry.
   * {@link sandboxNpmEnv} redirects the user config into the sandbox, and this flag makes the
   * fix visible in every artifact instead of being a claim in a doc.
   */
  readonly authUsed: boolean
}

/**
 * Environment for a child that may run pnpm, with the operator's npm user config redirected.
 *
 * WHY: `scrubbedEnv` drops secret-looking env vars, but credentials also live in `~/.npmrc`,
 * which pnpm reads on its own. Measured in R20: a failing install printed
 * `An authorization header was used: Bearer npm_[hidden]` until `npm_config_userconfig`
 * pointed at an empty file inside the sandbox. We do not read that file (铁律 4) — we simply
 * stop inheriting it.
 *
 * The PROFILE's own `.npmrc` is untouched, so T-305b (a profile-level registry that must be
 * unreachable) still works: pnpm reads project config separately from user config.
 */
export function sandboxNpmEnv(env: NodeJS.ProcessEnv, dshHome: string): NodeJS.ProcessEnv {
  const userconfig = join(dshHome, 'probe-user-npmrc')
  try {
    if (!existsSync(userconfig)) writeFileSync(userconfig, '', 'utf8')
  } catch {
    // If the sandbox cannot take the file, the env still points at a path that will not
    // resolve — pnpm then behaves as "no user config", which is the safe side of this.
  }
  // Both spellings on purpose: pnpm reads the lower-case one, npm-compatible tools the upper.
  return { ...env, npm_config_userconfig: userconfig, NPM_CONFIG_USERCONFIG: userconfig }
}

/**
 * What the package manager said, not just that it said no (T-310).
 *
 * WHY THIS IS NOT `detail`: `detail` is the launcher's last line
 * (`dsh: plugin command failed; diagnostics: …`), which carries no cause at all. Measured in
 * R19: the diagnostics log for a pnpm failure contains exactly one line
 * (`Command failed with exit code 1: pnpm add …`), while the real code
 * (`ERR_PNPM_IGNORED_BUILDS`) is printed on the launcher's **stderr**. So the extraction
 * reads both, prefers the launcher, and says which one it used.
 */
export interface InstallDiagnosis {
  /** `ERR_PNPM_*` (or any `ERR_*`) code, or `null` when the output carries none. */
  readonly code: string | null
  /** One sanitised line that explains the failure, or `null` when there was nothing to read. */
  readonly key_line: string | null
  /** Where the reading came from — a claim about provenance, not a guess. */
  readonly source: 'launcher' | 'diagnostics-log' | 'none'
}

const ERROR_CODE = /\bERR_[A-Z0-9_]{2,}\b/

/** One line of package-manager output, stripped of decoration, URLs' secrets and length. */
export function sanitizeDiagnosisLine(line: string): string {
  const stripped = line
    // ANSI colour, then the box-drawing/arrow prefixes pnpm puts on `×`/`╰─▶` lines.
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/^[\s>×✖✗╰├│└─▶›—·•]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
  // A private registry URL can carry credentials in the userinfo part …
  const noUserInfo = stripped.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1')
  // … or a token in the query string. Neither ever belongs in an artifact.
  const noQuery = noUserInfo.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1')
  return sanitizeLogLine(noQuery).slice(0, 240)
}

/** Does this line say anything beyond its label? (`Error:` alone does not.) */
function substantive(text: string): boolean {
  return text.replace(/[^A-Za-z0-9]/g, '').length >= 8
}

/**
 * Package names whose build scripts the package manager refused to run.
 *
 * WHY THIS IS PARSED FROM THE RAW OUTPUT AND NOT FROM `key_line`: pnpm wraps the list over
 * several lines and `key_line` is one line (`Ignored build scripts: a@1.0.0,` — R21 measured
 * exactly that truncation). Membership in this list is what tells "the candidate was not
 * built" apart from "the profile I copied was not built", and those need opposite verdicts.
 */
export function ignoredBuildPackages(text: string): readonly string[] {
  const marker = text.indexOf('Ignored build scripts')
  if (marker === -1) return []
  // The list ends at the first blank line; 800 characters is ample for any realistic profile.
  const tail = text.slice(marker, marker + 800)
  const stop = tail.search(/\r?\n\s*\r?\n/)
  const block = stop === -1 ? tail : tail.slice(0, stop)
  const names = new Set<string>()
  for (const match of block.matchAll(/(@?[a-zA-Z0-9][a-zA-Z0-9._/-]*)@\d+\.\d+\.\d+/g)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  return [...names]
}

/**
 * The line that explains `code`.
 *
 * pnpm splits a failure across lines: `Error: ERR_PNPM_IGNORED_BUILDS` names the code, and
 * the very next lines carry the cause (`Ignored build scripts: …`). Publishing only the code
 * line would leave the reader with the same dead end as an exit code (R19 measured this).
 * So: use the code line when it explains itself, otherwise the first explanatory line below
 * it — never the harness's own `dsh: …` line and never a `help:`/`hint:` line, which are
 * pointers, not causes.
 */
function explanationFor(text: string, code: string): string | null {
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((line) => line.includes(code))
  if (index === -1) return null
  const raw = lines[index]
  if (raw === undefined) return null
  const codeLine = sanitizeDiagnosisLine(raw)
  if (substantive(codeLine.replace(code, ''))) return codeLine
  for (const line of lines.slice(index + 1, index + 9)) {
    const clean = sanitizeDiagnosisLine(line)
    if (clean === '') continue
    // `dsh: plugin command failed; diagnostics: <path>` is the launcher talking about itself:
    // it names no cause, and taking it would hide the package manager's own sentence (R19:
    // the missing-package run published exactly that line before this filter existed).
    if (/^dsh:/i.test(clean)) continue
    if (/^(help|hint|note|usage)\s*:/i.test(clean)) continue
    // Either pnpm's `label: detail` shape, or a plain sentence worth reading.
    if (/^[a-z][a-z ]{0,24}:\s*\S/i.test(clean) || clean.replace(/[^A-Za-z0-9]/g, '').length >= 20) return clean
  }
  return codeLine === '' ? null : codeLine
}

/** First line that reads like an error, else the first line that says anything at all. */
function firstErrorLine(text: string): string | null {
  const lines = text.split(/\r?\n/).map(sanitizeDiagnosisLine).filter((line) => line !== '')
  const loud = lines.find((line) => /\b(error|failed|cannot|unable|refused|denied|ignored)\b/i.test(line))
  return loud ?? lines[0] ?? null
}

/**
 * Pure core of {@link installDiagnosis}: no filesystem, so every rule is testable.
 *
 * Order matters and is measured, not assumed: the launcher's own output wins, because the
 * diagnostics log is a *summary* that drops the code (R19 fact F34).
 */
export function diagnosisFromText(input: { launcher: string; log?: string | null }): InstallDiagnosis {
  const launcher = input.launcher
  const log = input.log ?? null
  const launcherCode = ERROR_CODE.exec(launcher)?.[0] ?? null
  const logCode = log === null ? null : (ERROR_CODE.exec(log)?.[0] ?? null)
  const code = launcherCode ?? logCode
  if (code !== null) {
    const fromLauncher = launcherCode !== null
    const text = fromLauncher ? launcher : (log ?? '')
    return {
      code,
      key_line: explanationFor(text, code) ?? firstErrorLine(text),
      source: fromLauncher ? 'launcher' : 'diagnostics-log',
    }
  }
  const keyLine = firstErrorLine(launcher) ?? (log === null ? null : firstErrorLine(log))
  return {
    code: null,
    key_line: keyLine,
    source: keyLine === null ? 'none' : log !== null && firstErrorLine(launcher) === null ? 'diagnostics-log' : 'launcher',
  }
}

/**
 * Extract the failure reason from a launcher run, reading its diagnostics log when named.
 *
 * The log is capped at 64KB and read through the same guard as {@link failureEndpoints}: a
 * missing log is normal (the install may fail before one is written).
 */
export function installDiagnosis(output: string): InstallDiagnosis {
  const named = /diagnostics:\s*(.+?\.log)/.exec(output)?.[1]
  let log: string | null = null
  if (named !== undefined) {
    try {
      log = readFileSync(named.trim(), 'utf8').slice(0, 64 * 1024)
    } catch {
      log = null
    }
  }
  return diagnosisFromText({ launcher: output, log })
}

/**
 * `dsh plugin --profile <p> add <spec>` forwards to pnpm inside the profile.
 *
 * The candidate is installed into the SANDBOX home only; the caller passes the env, and
 * that env must already be scrubbed (see `scrubbedEnv`).
 */
export function runInstall(input: {
  dshMain: string
  dshHome: string
  profile: string
  candidate: string
  timeoutMs: number
  env: NodeJS.ProcessEnv
}): InstallResult {
  return runPluginCommand({
    argv: pluginArgv({ dshMain: input.dshMain, profile: input.profile, verb: 'add', spec: input.candidate }),
    dshHome: input.dshHome,
    timeoutMs: input.timeoutMs,
    env: input.env,
  })
}

/**
 * The argv of `dsh plugin …`, in one place.
 *
 * WHY IT IS EXPORTED: the credential-source audit (T-313) has to run the launcher with an env
 * it builds itself, so that it can prove a source WOULD leak if it were not closed. Copying the
 * argv into the audit would make the audit drift away from what the probe really runs.
 */
export function pluginArgv(input: {
  readonly dshMain: string
  readonly profile: string
  readonly verb: 'add' | 'install'
  readonly spec?: string
}): readonly string[] {
  const base = [input.dshMain, 'plugin', '--profile', input.profile, input.verb]
  return input.spec === undefined ? base : [...base, input.spec]
}

/**
 * `dsh plugin --profile <p> install` — install the PROFILE's own dependencies.
 *
 * WHY THIS IS A SEPARATE ENTRY POINT (T-304 / R20 fact F39): `dsh` does NOT install profile
 * dependencies while booting (the R12 pitfall), but `dsh plugin <args>` forwards its arguments
 * straight to pnpm, so `plugin install` does. A copied profile therefore has to run this once
 * before it can boot — and if it fails, that failure belongs to the copy, not to the
 * candidate.
 */
export function runProfileInstall(input: {
  dshMain: string
  dshHome: string
  profile: string
  timeoutMs: number
  env: NodeJS.ProcessEnv
}): InstallResult {
  return runPluginCommand({
    argv: pluginArgv({ dshMain: input.dshMain, profile: input.profile, verb: 'install' }),
    dshHome: input.dshHome,
    timeoutMs: input.timeoutMs,
    env: input.env,
  })
}

/** The one place that spawns a `dsh plugin …` child and reads its result. */
function runPluginCommand(input: {
  readonly argv: readonly string[]
  readonly dshHome: string
  readonly timeoutMs: number
  readonly env: NodeJS.ProcessEnv
}): InstallResult {
  const run = spawnSync(process.execPath, [...input.argv], {
    // R20: the operator's `~/.npmrc` must not travel into the sandbox (see `sandboxNpmEnv`).
    env: sandboxNpmEnv(input.env, input.dshHome),
    encoding: 'utf8',
    timeout: input.timeoutMs,
    killSignal: 'SIGKILL',
  })
  const text = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  const lastLine = text.split(/\r?\n/).filter((line) => line.trim() !== '').slice(-1)[0] ?? ''
  return {
    exitCode: run.status,
    detail: lastLine.slice(0, 240),
    endpoints: failureEndpoints(text),
    // T-310: the launcher's last line names no cause; this is the line that does. A passing
    // install has nothing to diagnose — publishing "Already up to date" as a diagnosis would
    // make a healthy run look like a failed one.
    diagnosis:
      run.status === 0 ? { code: null, key_line: null, source: 'none' } : installDiagnosis(text),
    authUsed: /authorization header was used/i.test(text),
    ignoredPackages: ignoredBuildPackages(text),
  }
}

/**
 * Endpoints named by a failed install, taken from the diagnostics log when the launcher
 * points at one. Pure and exported so the sanitising rules are testable without a sandbox.
 */
export function failureEndpoints(output: string): readonly string[] {
  const diagnostics = /diagnostics:\s*(.+?\.log)/.exec(output)?.[1]
  let text = output
  if (diagnostics !== undefined) {
    try {
      text = `${text}\n${readFileSync(diagnostics.trim(), 'utf8').slice(0, 64 * 1024)}`
    } catch {
      // The log is optional; the output itself may still carry the URL.
    }
  }
  const found = new Set<string>()
  for (const match of text.matchAll(/https?:\/\/[^\s'"<>)\]]+/g)) {
    // pnpm writes `http://host/pkg: error …`; trailing punctuation is not part of the URL.
    const raw = match[0].replace(/[.,;:]+$/, '')
    try {
      const url = new URL(raw)
      // Strip credentials, query and fragment: a private registry URL can carry a token.
      url.username = ''
      url.password = ''
      url.search = ''
      url.hash = ''
      found.add(url.toString())
    } catch {
      // Not a URL we can parse; do not publish a half-redacted string.
    }
    if (found.size >= 5) break
  }
  return [...found]
}

export interface HttpProbeResult {
  readonly status: number | null
  readonly detail: string
}

/**
 * Is something listening?
 *
 * `redirect: 'manual'` is not a detail: with a token the first response is a 303 plus
 * `Set-Cookie`, and `fetch` following it turns a healthy Host into a 401 (R12 pitfall).
 */
export async function probeHttp(port: number, timeoutMs: number): Promise<HttpProbeResult> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { status: response.status, detail: `HTTP ${response.status}` }
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return { status: null, detail: detail.slice(0, 240) }
  }
}

/**
 * Strip the launcher's token before any log line can reach an artifact.
 *
 * `dsh web: http://127.0.0.1:53052/?token=…` is the one line we want to keep for diagnosis,
 * and it is also the one line that must never be published. F-2 (R16) taught us that a
 * single unredacted field is enough to leak; this is that field.
 */
export function sanitizeLogLine(line: string): string {
  return line.replace(/([?&]token=)[^\s"'&]+/gi, '$1<redacted>')
}

/**
 * Ports named by a bind failure in the Host log.
 *
 * WHY: on this machine `netsh int ipv4 show excludedportrange protocol=tcp` lists
 * 53461–53560, and the plan's deterministic port landed on **53506**, so the Host's own
 * `webserver` row died with `listen EACCES`. That failure has nothing to do with the
 * candidate, and the judge needs the port number to say so (R17).
 */
export function bindFailedPorts(log: string): readonly number[] {
  const found = new Set<number>()
  for (const match of log.matchAll(/listen (?:EACCES|EADDRINUSE|EADDRNOTAVAIL|EAFNOSUPPORT)[^\n]*?:(\d{2,5})\b/g)) {
    const port = Number(match[1])
    if (Number.isInteger(port) && port > 0 && port <= 65_535) found.add(port)
  }
  return [...found].sort((left, right) => left - right)
}

/**
 * A port the OS is willing to hand out right now.
 *
 * The deterministic `basePort` in the plan is a *preference*: Windows excludes ranges
 * dynamically (Hyper-V/WSL reservations change during a session), so a hash-picked port can
 * be unbindable while a neighbouring one is fine. Binding :0 asks the OS for one it will
 * actually allow. The port is released immediately; a Host that boots a second later can
 * still lose the race, which is why the judge also recognises a bind failure on our port.
 */
export function findFreePort(): Promise<number | null> {
  return new Promise((resolvePort) => {
    const server = createServer()
    let settled = false
    const done = (port: number | null): void => {
      if (settled) return
      settled = true
      try {
        server.close()
      } catch {
        // Nothing to close.
      }
      resolvePort(port)
    }
    server.once('error', () => done(null))
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done(address !== null && typeof address === 'object' ? address.port : null)
    })
  })
}

/** Read the sample file, or `null` when it is not there (yet). BOM stripped: PowerShell writes one. */
function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  } catch {
    return null
  }
}

/** Write time of the sample, used as the honest "spawn → sample" instant (not "when we polled"). */
function mtimeMsOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

function parseSample(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Unparseable is a measurement failure, not "zero rows": keep it shaped like the hook's
    // own error payload so one code path reports both.
    return { error: { code: 'unparseable', message: 'the sample file is not valid JSON' } }
  }
}

/**
 * Can a verdict rest on this sample?
 *
 * `{error}` means the hook could not read the tree (e.g. `inactive context` while the Host
 * was still composing) and `settled: false` means rows were still moving when it gave up.
 * Both are measurement failures: the executor must report `unknown`, never `blocked`.
 *
 * DO NOT REDEFINE THIS (ADR-0008 E): the replacement window narrowed to `{error}`, but
 * "usable" still means "settled and readable". The judge and the assertions decide verdicts
 * from this predicate, so weakening it here would turn a race into a `blocked`.
 */
export function isUsableSample(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false
  const record = payload as Record<string, unknown>
  if (record['error'] !== undefined && record['error'] !== null) return false
  return record['settled'] !== false
}

/**
 * Did the hook manage to write *something we can interpret*?
 *
 * This is deliberately weaker than {@link isUsableSample}: a `settled: false` sample is a
 * real reading of a tree that was still moving (the hook spent its settle budget and then
 * wrote down what it saw), while an `{error}` payload is the hook saying it could not read at
 * all. Only the second one can be improved by Cordis re-applying the plugin, which is the
 * whole reason the replacement window exists (ADR-0008 E).
 */
export function isReadableSample(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false
  const record = payload as Record<string, unknown>
  return record['error'] === undefined || record['error'] === null
}

/**
 * Is this the hook's first, not-yet-settled write? (T-312)
 *
 * A provisional sample is readable on purpose (the phase table exists), but it explicitly says
 * `settled: false` and `provisional: true`. The executor may rest an `unknown` on it, and it
 * keeps a bounded window open for the final write. Anything that is not explicitly marked is
 * treated as final, so an older hook (no field) behaves exactly as before.
 */
export function isProvisionalSample(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false
  return (payload as Record<string, unknown>)['provisional'] === true
}

/** The settle budget the hook published with its provisional sample (T-312), or `null`. */
function settleTimeoutOf(payload: unknown): number | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const value = (payload as Record<string, unknown>)['settle_timeout_ms']
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Remove the sandbox home and report whether it is really gone. */
export function removeSandbox(directory: string): { removed: boolean; detail: string } {
  try {
    rmSync(directory, { recursive: true, force: true })
  } catch (error) {
    return { removed: false, detail: error instanceof Error ? error.message : String(error) }
  }
  return { removed: !existsSync(directory), detail: directory }
}

/**
 * Environment handed to every sandbox child.
 *
 * Credentials are dropped, not passed through: `PROJECT_RULES.md` 铁律 4 forbids injecting
 * real secrets into a probe sandbox, and a plugin that needs one must be reported as
 * unverified rather than measured with the user's key.
 */
export function scrubbedEnv(base: NodeJS.ProcessEnv, overrides: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (/(API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_AUTH)/i.test(key)) continue
    out[key] = value
  }
  return { ...out, ...overrides }
}
