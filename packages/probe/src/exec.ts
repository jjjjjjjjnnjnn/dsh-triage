/**
 * Probe executor (M3 / T-301): run a plan, then judge what actually happened.
 *
 * WHY THE EXECUTOR IS SPLIT FROM THE JUDGE: the runner is I/O (install, boot, http,
 * cleanup) and the judge is a pure function over the observed facts. Everything a
 * reviewer would want to argue about — "is a `null` phase a pass?", "does an HTTP 200
 * mean the UI works?" — lives in {@link judgeProbe}, which the tests can drive with
 * hand-written facts and no sandbox at all.
 *
 * CONTRACT (docs/specs/M3-probe.md):
 * - `cleanup` always runs, even when an earlier step threw;
 * - the candidate row must be identified by module name and must be unique — 0 rows and
 *   ≥2 rows are different verdicts, and neither is rounded to "fine";
 * - assertions this layer cannot measure (`namespace-diff`) are reported as `unmeasured`,
 *   never omitted and never `passed`; `client-rendered` is measured since R15, and stays
 *   `unmeasured` only when the machine has no browser (T-302);
 * - `go` means "installed + booted + served + row active (+ page mounted)". It does NOT
 *   mean "works", and it is never a security statement.
 */

import type {
  Conclusion,
  Confidence,
  EnvFingerprint,
  Evidence,
  Reason,
  Remediation,
  Verdict,
} from '@dsh-triage/core'
import { parseInventorySnapshot } from '@dsh-triage/core'
import type { InstallDiagnosis } from './host.js'
import type { BootSegments } from './host.js'
import type { ProbePlan } from './plan.js'
import type { RenderCheck } from './render.js'

/* ---------------------------------- types ---------------------------------- */

export type ProbeStepId = 'runtime' | 'profile' | 'install' | 'boot' | 'http' | 'render' | 'inventory' | 'cleanup'
export type ProbeStepStatus = 'passed' | 'failed' | 'skipped'

export interface ProbeStepRun {
  readonly id: ProbeStepId
  readonly status: ProbeStepStatus
  readonly ms: number
  /** Redacted, human-readable reason for the status. `null` on a clean pass. */
  readonly detail: string | null
  readonly exitCode: number | null
}

export interface ProbeCandidateRow {
  readonly entryId: string
  readonly moduleName: string
  readonly phase: string | null
}

export interface ProbeSampleView {
  readonly transport: string | null
  readonly entries: number
  readonly waitMs: number | null
  /** Set when the hook wrote an error payload instead of a snapshot. */
  readonly error: string | null
  /**
   * Machine-readable reason the hook could not read the tree (`inactive-context`,
   * `projection-missing`, `other`). `null` when the reading succeeded.
   */
  readonly errorCode: string | null
  /**
   * Whether the hook saw the tree stop moving before it sampled.
   *
   * `false` and `null` (older payloads) both mean "this reading cannot support `blocked`":
   * a row that is still `pending` is not a row that failed (R17 / BS-25).
   */
  readonly settled: boolean | null
  /** Attempts the hook made (1 = first read worked). */
  readonly attempts: number | null
  /** Which apply wrote this sample; >1 means Cordis re-applied the plugin (R17). */
  readonly applies: number | null
  readonly candidateRows: readonly ProbeCandidateRow[]
  /** Probe rows the hook excluded from scoring (its own instrument). */
  readonly excluded: readonly string[]
}

export interface ProbeTimings {
  readonly installMs: number | null
  readonly bootToSampleMs: number | null
  readonly httpMs: number | null
  /** Client-render segment (T-302). Never part of the 20s boot→sample budget. */
  readonly renderMs: number | null
  readonly cleanupMs: number | null
  /**
   * Where the boot step's wall time went (T-314). `null` when the boot step never ran.
   *
   * WHY IT SITS NEXT TO THE BUDGET: `bootToSampleMs` is judged; `boot step wall time` is what a
   * user actually waits for. R21 published both and could explain neither gap, so the segments
   * are recorded here where a reader can compare them without opening the host layer.
   */
  readonly bootSegments: BootSegments | null
}

export interface ProbeCleanupResult {
  readonly removed: boolean
  readonly portClosed: boolean
  readonly detail: string
}

/** One `link:`/`file:` dependency of the copied profile that points at nothing (T-304 / F40). */
export interface ProbeDanglingLink {
  readonly name: string
  readonly spec: string
  readonly target: string
}

/** What the profile-copy step observed; published verbatim so the shape of the copy survives. */
export interface ProfilePrepareOutcome {
  readonly copied: readonly string[]
  readonly missing: readonly string[]
  /**
   * `dsh plugin --profile <p> install` on the copy; `null` when it was not attempted.
   *
   * `code` is the package manager's own error code (T-310 shape). It matters here because
   * `ERR_PNPM_IGNORED_BUILDS` is a *policy* refusal: the packages installed, their build
   * scripts did not run (R19 F35 / measured again for the copy in R21). Treating that as
   * "the profile is unusable" would report `unknown` for every real profile that has a
   * native dependency.
   */
  readonly install: { readonly exitCode: number | null; readonly detail: string; readonly code?: string | null } | null
  readonly danglingLinks: readonly ProbeDanglingLink[]
  /** Which build-script policy the sandbox used (T-304); see {@link ProbeProfileCopy.pnpmPolicy}. */
  readonly pnpmPolicy?: 'source' | 'sandbox'
}

/** The copy facts as the run records them, tagged with where the declarations came from. */
export interface ProbeProfileCopy extends ProfilePrepareOutcome {
  readonly origin: string
  /** The copy's own dependencies installed, but the package manager refused their build scripts. */
  readonly buildRefused?: boolean
  /**
   * Where the sandbox's build-script policy came from: `source` (the copied profile's own
   * `pnpm-workspace.yaml`) or `sandbox` (this tool wrote `strictDepBuilds: false`).
   */
  readonly pnpmPolicy?: 'source' | 'sandbox'
}

/**
 * Readiness facts, as measured while the Host was still alive (T-306 / R17).
 *
 * `outcome` and `waited_ms` are observations: the window may end `timeout` for a settled
 * tree (a real `blocked`) or for an unsettled one (a measurement failure). Which one it is
 * is decided in {@link judgeProbe}, not here.
 */
export interface ProbeReadiness {
  readonly source: 'host-url' | 'plan-port'
  readonly port: number
  readonly outcome: 'served' | 'timeout'
  readonly waited_ms: number
  readonly window_ms: number
  readonly url_seen: boolean
}

export interface ProbeRun {
  readonly candidate: { readonly spec: string; readonly package: string }
  readonly dshMain: string
  readonly sandboxHome: string
  /** `template` or `copy:<name>` — the composition this measurement belongs to (T-304). */
  readonly profileOrigin: string
  /** The real profile the declarations were copied from; `null` for a template profile. */
  readonly profileSourceDir: string | null
  readonly port: number
  readonly runtimeVersion: string | null
  readonly steps: readonly ProbeStepRun[]
  readonly timings: ProbeTimings
  readonly sample: ProbeSampleView | null
  readonly http: { readonly status: number | null; readonly detail: string } | null
  /** Where the readiness port came from (T-306); `null` when readiness was not requested. */
  readonly readiness: ProbeReadiness | null
  /** Client-render observation (T-302); `null` when it did not run. */
  readonly render: RenderCheck | null
  /** Why the render check did not run; `null` when it ran. */
  readonly renderSkipped: string | null
  /**
   * Did the Host print its own URL? `false` with `sample === null` is a Host that never came
   * up (a real `blocked`); `true` is a Host that is serving while our instrument wrote
   * nothing (a measurement failure, R17).
   */
  readonly urlPrinted: boolean
  /** First log line (token redacted), kept so a "no sample" artifact can explain itself. */
  readonly firstLine: string | null
  /** stderr tail on a no-sample boot (token redacted): the launcher's own reason. */
  readonly errorTail: string | null
  /** Did the launcher declare `startup failed`? Then the composition never came up. */
  readonly startupFailed: boolean
  /** Ports the Host could not bind; if ours is among them the failure is the probe's. */
  readonly bindFailedPorts: readonly number[]
  /**
   * The package manager's own reason for a failed install (T-310).
   *
   * Separate from `steps[].detail` because a reason is evidence, not prose: the judge
   * branches on `code`, and the artifact publishes `key_line` verbatim.
   */
  readonly installDiagnosis: InstallDiagnosis | null
  /** Did the package manager report sending an authorization header? (`null` = not reported) */
  readonly installAuthUsed: boolean | null
  /** Packages the candidate's install left unbuilt (R21); empty = the output named none. */
  readonly installIgnoredPackages: readonly string[]
  /**
   * `true` when a build-script refusal was about the COPIED PROFILE's own dependencies rather
   * than the candidate (T-304). It is a warning, not a block: the candidate was added, and
   * blaming it for a profile it did not write would be the wrong verdict.
   */
  readonly installBuildRefusedProfileOnly: boolean
  /**
   * Did the candidate end up in the profile's `dsh.profile.bundles`? `null` = could not read.
   *
   * This is the difference between "added to the composition" and "just a dependency": the
   * launcher registers the bundle only after a successful package-manager run (R21).
   */
  readonly candidateRegistered: boolean | null
  /**
   * The copied profile's own facts (T-304); `null` when the probe used a template profile.
   *
   * WHY IT IS IN THE RUN AND NOT ONLY A STEP DETAIL: the artifact has to answer "which
   * composition was this measured in?", and a prose detail cannot be re-read by a script.
   */
  readonly profileCopy: ProbeProfileCopy | null
  readonly cleanup: ProbeCleanupResult
  readonly abortedAt: ProbeStepId | null
}

export interface ProbeTimeouts {
  readonly installMs: number
  readonly bootMs: number
  readonly httpMs: number
  readonly cleanupMs: number
}

/**
 * Install gets its own budget: a registry install is network-bound and cannot be held to
 * the 20s boot budget. `docs/specs/M3-probe.md` §4 keeps the two numbers apart on purpose.
 */
export const DEFAULT_PROBE_TIMEOUTS: ProbeTimeouts = {
  installMs: 180_000,
  bootMs: 120_000,
  httpMs: 5_000,
  cleanupMs: 10_000,
}

/* ---------------------------------- deps ---------------------------------- */

export interface RuntimeReadInput {
  readonly dshMain: string
  readonly timeoutMs: number
}

export interface InstallInput {
  readonly dshMain: string
  readonly dshHome: string
  readonly profile: string
  readonly candidate: string
  readonly timeoutMs: number
}

export interface BootInput {
  readonly plan: ProbePlan
  readonly dshMain: string
  readonly timeoutMs: number
}

/** Input for the profile-copy step (T-304); only called when the plan names a source profile. */
export interface ProfilePrepareInput {
  readonly plan: ProbePlan
  readonly dshMain: string
  readonly timeoutMs: number
}

export interface HttpInput {
  readonly port: number
  readonly timeoutMs: number
}

export interface CleanupInput {
  readonly dshHome: string
  readonly port: number
  /**
   * Ports the Host was actually seen on. T-306 reads the URL the Host printed, which can
   * differ from `--port`; cleanup must prove *both* are closed, not just the planned one.
   */
  readonly extraPorts?: readonly number[]
  readonly timeoutMs: number
}

/**
 * Every side effect the executor needs. The CLI supplies the real implementations; the
 * tests supply fakes, so timeouts, cleanup-on-failure and the "no sample" path are all
 * testable offline.
 */
export interface ProbeExecDeps {
  now(): number
  readRuntimeVersion(input: RuntimeReadInput): Promise<{ version: string | null; detail: string }>
  install(input: InstallInput): Promise<{
    exitCode: number | null
    detail: string
    endpoints?: readonly string[]
    /** T-310: what the package manager said. Absent means "not reported", never "none said". */
    diagnosis?: InstallDiagnosis
    /** R20: whether pnpm reported sending an authorization header. */
    authUsed?: boolean
    /** R21: packages installed without their build scripts (empty = not reported). */
    ignoredPackages?: readonly string[]
  }>
  /**
   * `http` is the readiness measured *before* the Host was killed. It is optional so a
   * fake can omit it; when present, the executor records it instead of probing a port
   * that no longer has a listener behind it.
   */
  bootAndSample(input: BootInput): Promise<{
    sample: unknown | null
    seconds: number
    detail: string
    http?: { status: number | null; detail: string } | null
    /** T-306: where the readiness port came from. Absent means "not reported". */
    readiness?: ProbeReadiness | null
    /** T-302: the render observation, when a browser was available. */
    render?: RenderCheck | null
    /** T-302: why the render check did not run (published verbatim). */
    renderSkipped?: string | null
    /** R17: did the launcher print its URL (i.e. is the Host demonstrably up)? */
    urlPrinted?: boolean
    /** R17: first log line, already token-redacted by the Host layer. */
    firstLine?: string | null
    /** R17: stderr tail on a no-sample boot, already token-redacted. */
    errorTail?: string | null
    /** R17: the launcher declared startup failure (no sample will follow). */
    startupFailed?: boolean
    /** R17: ports the Host could not bind (evidence that the failure is ours, not the plugin's). */
    bindFailedPorts?: readonly number[]
    /** T-314: where the boot step's wall time went. Absent means "not reported". */
    segments?: BootSegments
  }>
  probeHttp(input: HttpInput): Promise<{ status: number | null; detail: string }>
  /**
   * The bundles a profile declares right now (`dsh.profile.bundles`).
   *
   * WHY THE EXECUTOR NEEDS THIS (T-304 / R21): `dsh plugin add` writes the dependency first and
   * registers the bundle only when pnpm exits 0. Measured: with a build-script refusal the
   * dependency is in `package.json` but `bundles` is unchanged, so the candidate never mounts
   * and a naive "install exited 1, continue anyway" would produce `row-missing` — a `blocked`
   * verdict about a package the composition never saw. `null` means "could not read".
   */
  profileBundles?(input: { readonly profileDir: string }): readonly string[] | null
  /**
   * Copy the plan's source profile into the sandbox and install its dependencies (T-304).
   *
   * Optional because a template-profile probe never needs it; a plan that names a source
   * profile without a copier fails the step instead of silently measuring an empty profile.
   */
  prepareProfile?(input: ProfilePrepareInput): Promise<ProfilePrepareOutcome>
  cleanup(input: CleanupInput): Promise<ProbeCleanupResult>
}

/* -------------------------------- execution -------------------------------- */

export interface ExecuteProbeInput {
  readonly plan: ProbePlan
  readonly dshMain: string
  /** Package name the candidate installs as; the row is matched by this module name. */
  readonly candidatePackage: string
  readonly timeouts?: Partial<ProbeTimeouts>
  /** Skip the install step (used to re-probe an already prepared sandbox). */
  readonly skipInstall?: boolean
  /**
   * Skip the HTTP readiness step. A profile that does not serve a web surface must not be
   * accused of being unreachable, so the caller turns the step off and the artifact
   * reports `http-served: unmeasured` instead of a failure.
   */
  readonly skipHttp?: boolean
}

interface MutableRun {
  candidate: { spec: string; package: string }
  dshMain: string
  sandboxHome: string
  profileOrigin: string
  profileSourceDir: string | null
  port: number
  runtimeVersion: string | null
  steps: ProbeStepRun[]
  timings: { installMs: number | null; bootToSampleMs: number | null; httpMs: number | null; renderMs: number | null; cleanupMs: number | null; bootSegments: BootSegments | null }
  sample: ProbeSampleView | null
  http: { status: number | null; detail: string } | null
  readiness: ProbeReadiness | null
  render: RenderCheck | null
  renderSkipped: string | null
  urlPrinted: boolean
  firstLine: string | null
  errorTail: string | null
  startupFailed: boolean
  bindFailedPorts: readonly number[]
  installDiagnosis: InstallDiagnosis | null
  installAuthUsed: boolean | null
  installIgnoredPackages: readonly string[]
  installBuildRefusedProfileOnly: boolean
  candidateRegistered: boolean | null
  profileCopy: ProbeProfileCopy | null
  cleanup: ProbeCleanupResult
  abortedAt: ProbeStepId | null
}

export async function executeProbe(input: ExecuteProbeInput, deps: ProbeExecDeps): Promise<ProbeRun> {
  const timeouts: ProbeTimeouts = { ...DEFAULT_PROBE_TIMEOUTS, ...(input.timeouts ?? {}) }
  const run: MutableRun = {
    candidate: { spec: input.plan.candidate, package: input.candidatePackage },
    dshMain: input.dshMain,
    sandboxHome: input.plan.sandboxHome,
    profileOrigin: input.plan.profileOrigin,
    profileSourceDir: input.plan.profileSource === null ? null : input.plan.profileSource.dir,
    port: input.plan.port,
    runtimeVersion: null,
    steps: [],
    timings: { installMs: null, bootToSampleMs: null, httpMs: null, renderMs: null, cleanupMs: null, bootSegments: null },
    sample: null,
    http: null,
    readiness: null,
    render: null,
    renderSkipped: null,
    urlPrinted: false,
    firstLine: null,
    errorTail: null,
    startupFailed: false,
    bindFailedPorts: [],
    installDiagnosis: null,
    installAuthUsed: null,
    installIgnoredPackages: [],
    installBuildRefusedProfileOnly: false,
    candidateRegistered: null,
    profileCopy: null,
    cleanup: { removed: false, portClosed: false, detail: 'cleanup did not run' },
    abortedAt: null,
  }

  try {
    // The sequence is a separate function on purpose: a `return` inside this `try` would
    // be evaluated *before* `finally` ran, and the returned record would carry the
    // pre-cleanup state (a bug the first draft had).
    await runSequence(run, deps, input, timeouts)
  } finally {
    const started = deps.now()
    try {
      run.cleanup = await deps.cleanup({
        dshHome: input.plan.sandboxHome,
        port: input.plan.port,
        ...(run.readiness === null || run.readiness.port === input.plan.port ? {} : { extraPorts: [run.readiness.port] }),
        timeoutMs: timeouts.cleanupMs,
      })
    } catch (error) {
      run.cleanup = { removed: false, portClosed: false, detail: error instanceof Error ? error.message : String(error) }
    }
    run.timings.cleanupMs = deps.now() - started
    run.steps.push({
      id: 'cleanup',
      status: run.cleanup.removed && run.cleanup.portClosed ? 'passed' : 'failed',
      ms: run.timings.cleanupMs,
      detail: run.cleanup.detail,
      exitCode: null,
    })
  }

  return freeze(run)
}

/** Steps in contract order; stops at the first step that makes the rest meaningless. */
async function runSequence(
  run: MutableRun,
  deps: ProbeExecDeps,
  input: ExecuteProbeInput,
  timeouts: ProbeTimeouts,
): Promise<void> {
  await runStep(run, deps, 'runtime', async () => {
    const read = await deps.readRuntimeVersion({ dshMain: input.dshMain, timeoutMs: timeouts.httpMs })
    run.runtimeVersion = read.version
    return read.version === null
      ? { status: 'failed' as const, detail: read.detail, exitCode: null }
      : { status: 'passed' as const, detail: `runtime ${read.version}`, exitCode: null }
  })
  if (run.abortedAt !== null) return

  if (input.plan.profileSource !== null) {
    await runStep(run, deps, 'profile', async () => {
      const prepare = deps.prepareProfile
      if (prepare === undefined) {
        return { status: 'failed' as const, detail: 'the plan copies a profile but no copier was supplied', exitCode: null }
      }
      const outcome = await prepare({ plan: input.plan, dshMain: input.dshMain, timeoutMs: timeouts.installMs })
      // A build-script refusal is not a failed install: pnpm printed `+ pkg@ver`, it just did not
      // run the scripts (R19 F35, remeasured for profile copies in R21). It is recorded as its
      // own fact because it makes every later failure unattributable — see `judgeProbe`.
      const buildRefused = outcome.install?.code === 'ERR_PNPM_IGNORED_BUILDS'
      run.profileCopy = { origin: input.plan.profileOrigin, ...outcome, buildRefused }
      // A dangling `link:`/`file:` target is checked BEFORE the exit code, because F40 measured
      // that `plugin install` exits 0 in exactly that shape.
      if (outcome.danglingLinks.length > 0) {
        return {
          status: 'failed' as const,
          detail: `dangling local dependencies: ${outcome.danglingLinks.map((link) => `${link.name} (${link.spec})`).join(', ')}`,
          exitCode: outcome.install?.exitCode ?? null,
        }
      }
      if (outcome.install !== null && outcome.install.exitCode !== 0 && !buildRefused) {
        return {
          status: 'failed' as const,
          detail: `the copied profile's dependencies did not install: ${outcome.install.detail}`,
          exitCode: outcome.install.exitCode,
        }
      }
      return {
        status: 'passed' as const,
        detail: `copied ${outcome.copied.join(', ') || 'no declarations'}${
          outcome.missing.length === 0 ? '' : ` (absent: ${outcome.missing.join(', ')})`
        }${buildRefused ? ' · dependencies installed, build scripts refused by the package manager' : ' · dependencies installed'}`,
        exitCode: outcome.install?.exitCode ?? null,
      }
    })
    if (run.abortedAt !== null) return
  }

  if (input.skipInstall !== true) {
    await runStep(run, deps, 'install', async () => {
      const result = await deps.install({
        dshMain: input.dshMain,
        dshHome: input.plan.sandboxHome,
        profile: input.plan.profile,
        candidate: input.plan.candidate,
        timeoutMs: timeouts.installMs,
      })
      // Recorded before the status branch: a *passing* install can still have printed a
      // warning, and a failed one is exactly what the judge needs (T-310).
      run.installDiagnosis = result.diagnosis ?? null
      run.installAuthUsed = result.authUsed ?? null
      run.installIgnoredPackages = [...(result.ignoredPackages ?? [])]
      /**
       * A copy plan re-reports the PROFILE's unbuilt dependencies every time a candidate is
       * added, and pnpm exits 1 for it (R21 measured: the ignored list was
       * `@deepseek-ai/dsh-subprocess-local, @google/genai, koffi, node-pty, protobufjs` — the
       * candidate was not one of them).
       *
       * WHY THE EXCEPTION IS NARROW: it needs a copied profile (so a template probe keeps R19's
       * strict behaviour) AND a readable ignored list that does not name the candidate. With
       * an unreadable list we stay conservative and block.
       */
      const refused = result.diagnosis?.code === 'ERR_PNPM_IGNORED_BUILDS'
      const ignored = result.ignoredPackages ?? []
      /**
       * With the sandbox build policy in place (T-304) the same refusal exits 0 and pnpm still
       * prints which packages it did not build, so the exit code alone cannot distinguish
       * "nothing was skipped" from "five native modules were skipped".
       */
      const profileOnly =
        input.plan.profileSource !== null &&
        ignored.length > 0 &&
        !ignored.includes(input.candidatePackage) &&
        (refused || result.exitCode === 0)
      run.installBuildRefusedProfileOnly = profileOnly
      if (profileOnly) {
        // The refusal is the profile's, but the command still exited 1 — and R21 measured that
        // the launcher registers the bundle only after a clean run. So do not assume: read the
        // composition back and let the registration decide whether this is measurable.
        const bundles = deps.profileBundles?.({ profileDir: input.plan.sandboxProfileDir }) ?? null
        const registered = bundles === null ? null : bundles.includes(input.candidatePackage)
        run.candidateRegistered = registered
        const why = `${result.detail} · the refusal is about the copied profile's own dependencies (${ignored.join(', ')}), not the candidate`
        if (result.exitCode === 0) {
          // The launcher's own run succeeded, so it registered the bundle; nothing to read back.
          return { status: 'passed' as const, detail: `${why} · the launcher reported success`, exitCode: 0 }
        }
        if (registered === true) {
          return { status: 'passed' as const, detail: `${why} · the candidate is registered in the composition`, exitCode: result.exitCode }
        }
        return {
          status: 'failed' as const,
          detail: `${why} · the candidate was NOT registered in ${
            registered === null ? 'a composition that could not be read' : 'dsh.profile.bundles'
          }`,
          exitCode: result.exitCode,
        }
      }
      return result.exitCode === 0
        ? { status: 'passed' as const, detail: result.detail, exitCode: result.exitCode }
        : {
            status: 'failed' as const,
            // Naming the endpoint is the difference between "install failed" and "install
            // failed because this profile points at a registry that does not answer".
            detail:
              result.endpoints === undefined || result.endpoints.length === 0
                ? result.detail
                : `${result.detail} · tried ${result.endpoints.join(', ')}`,
            exitCode: result.exitCode,
          }
    })
    if (run.abortedAt !== null) return
  } else {
    run.steps.push({ id: 'install', status: 'skipped', ms: 0, detail: 'skipInstall', exitCode: null })
  }

  await runStep(run, deps, 'boot', async () => {
    const boot = await deps.bootAndSample({ plan: input.plan, dshMain: input.dshMain, timeoutMs: timeouts.bootMs })
    // Boot facts must be recorded BEFORE the no-sample early return (R17): "the Host printed
    // its URL but the hook wrote nothing" is the difference between a measurement failure and
    // a blocked boot, and it lives on these fields.
    if (boot.http !== undefined) run.http = boot.http
    if (boot.readiness !== undefined) run.readiness = boot.readiness
    if (boot.render !== undefined) run.render = boot.render
    if (boot.renderSkipped !== undefined) run.renderSkipped = boot.renderSkipped
    if (boot.urlPrinted !== undefined) run.urlPrinted = boot.urlPrinted
    if (boot.firstLine !== undefined) run.firstLine = boot.firstLine
    if (boot.errorTail !== undefined) run.errorTail = boot.errorTail
    if (boot.startupFailed !== undefined) run.startupFailed = boot.startupFailed
    if (boot.bindFailedPorts !== undefined) run.bindFailedPorts = [...boot.bindFailedPorts]
    // T-314: record the segmentation even on a no-sample boot — that is exactly the case whose
    // 42.7s wall time nobody could explain.
    if (boot.segments !== undefined) run.timings.bootSegments = boot.segments
    // `seconds` is the recorder's own clock (spawn → sample). `runStep` measures the same
    // interval and overwrites `bootToSampleMs`, so the 20s budget is judged on one number.
    if (boot.sample === null) return { status: 'failed' as const, detail: boot.detail, exitCode: null }
    run.sample = readSample(boot.sample, input.candidatePackage, input.plan.sandboxHome)
    // The 20s budget is spawn → sample (`boot.seconds`). The STEP's wall time also covers
    // the settle, the readiness probe and the post-kill wait, so the two numbers differ on
    // purpose and only one of them is judged (docs/specs/M3-probe.md §4).
    run.timings.bootToSampleMs = Math.round(boot.seconds * 1000)
    return { status: 'passed' as const, detail: `${boot.seconds}s to sample`, exitCode: null }
  })
  if (run.abortedAt !== null) return

  await runStep(run, deps, 'http', async () => {
    if (input.skipHttp === true) {
      return { status: 'skipped' as const, detail: 'no web surface requested (--no-http)', exitCode: null }
    }
    // A captured reading (taken before the kill) wins; otherwise probe live.
    const http = run.http ?? (await deps.probeHttp({ port: input.plan.port, timeoutMs: timeouts.httpMs }))
    run.http = http
    // 2xx / 3xx / 401 all mean "something is listening and answering". A refused
    // connection or a timeout is the only failure signal we accept.
    return http.status === null
      ? { status: 'failed' as const, detail: http.detail, exitCode: null }
      : { status: 'passed' as const, detail: `HTTP ${http.status}`, exitCode: null }
  })

  await runStep(run, deps, 'render', async () => {
    // Not a pass, not a failure: a machine without a browser simply cannot answer this.
    // The artifact keeps the assertion visible as `unmeasured` with the reason (T-302).
    if (run.render === null) {
      return { status: 'skipped' as const, detail: run.renderSkipped ?? 'render check not requested', exitCode: null }
    }
    const detail = `${run.render.state}: ${run.render.detail} (${run.render.ms}ms)`
    return {
      status: run.render.state === 'blank' ? ('failed' as const) : run.render.state === 'rendered' ? ('passed' as const) : ('skipped' as const),
      detail,
      exitCode: null,
    }
  })

  await runStep(run, deps, 'inventory', async () => {
    if (run.sample === null) return { status: 'failed' as const, detail: 'no sample', exitCode: null }
    if (run.sample.error !== null) return { status: 'failed' as const, detail: run.sample.error, exitCode: null }
    const rows = run.sample.candidateRows
    if (rows.length === 1) {
      return { status: 'passed' as const, detail: `${rows[0]?.entryId} ${rows[0]?.phase ?? 'none'}`, exitCode: null }
    }
    return { status: 'failed' as const, detail: `${rows.length} candidate row(s)`, exitCode: null }
  })
}

function freeze(run: MutableRun): ProbeRun {
  return {
    candidate: run.candidate,
    dshMain: run.dshMain,
    sandboxHome: run.sandboxHome,
    profileOrigin: run.profileOrigin,
    profileSourceDir: run.profileSourceDir,
    port: run.port,
    runtimeVersion: run.runtimeVersion,
    steps: run.steps,
    timings: run.timings,
    sample: run.sample,
    http: run.http,
    readiness: run.readiness,
    render: run.render,
    renderSkipped: run.renderSkipped,
    urlPrinted: run.urlPrinted,
    firstLine: run.firstLine,
    errorTail: run.errorTail,
    startupFailed: run.startupFailed,
    bindFailedPorts: run.bindFailedPorts,
    installDiagnosis: run.installDiagnosis,
    installAuthUsed: run.installAuthUsed,
    installIgnoredPackages: run.installIgnoredPackages,
    installBuildRefusedProfileOnly: run.installBuildRefusedProfileOnly,
    candidateRegistered: run.candidateRegistered,
    profileCopy: run.profileCopy,
    cleanup: run.cleanup,
    abortedAt: run.abortedAt,
  }
}

type StepOutcome = {
  readonly status: 'passed' | 'failed' | 'skipped'
  readonly detail: string
  readonly exitCode: number | null
}

async function runStep(
  run: MutableRun,
  deps: ProbeExecDeps,
  id: ProbeStepId,
  body: () => Promise<StepOutcome>,
): Promise<void> {
  const started = deps.now()
  let outcome: StepOutcome
  try {
    outcome = await body()
  } catch (error) {
    outcome = { status: 'failed', detail: error instanceof Error ? error.message : String(error), exitCode: null }
  }
  const step = { id, status: outcome.status, ms: deps.now() - started, detail: outcome.detail, exitCode: outcome.exitCode }
  run.steps.push(step)
  if (id === 'install') run.timings.installMs = step.ms
  if (id === 'http') run.timings.httpMs = step.ms
  // The render segment is the observation's own clock (browser spawn → settled DOM), not
  // the wall time of the step that merely reads it back.
  if (id === 'render') run.timings.renderMs = run.render?.ms ?? step.ms
  // `render` is deliberately not an aborting step: a blank page must still be reported
  // together with the row phase, because "row active but nothing rendered" is the exact
  // shape of the 白屏 case this assertion exists for.
  if (outcome.status === 'failed' && id !== 'http' && id !== 'inventory' && id !== 'cleanup' && id !== 'render') {
    run.abortedAt = id
  }
}

/* --------------------------------- sampling -------------------------------- */

/**
 * Turn the hook's payload into the only thing the judge needs.
 *
 * The hook can legitimately write `{ error }`; that is a failed measurement, not zero
 * rows. Anything unparseable must surface as an error string rather than be skipped.
 */
export function readSample(payload: unknown, candidatePackage: string, sandboxHome: string): ProbeSampleView {
  const record = isRecord(payload) ? payload : null
  const excluded = Array.isArray(record?.['excluded'])
    ? record['excluded']
        .map((item) => (isRecord(item) && typeof item['entryId'] === 'string' ? String(item['entryId']) : null))
        .filter((item): item is string => item !== null)
    : []
  const settled = typeof record?.['settled'] === 'boolean' ? Boolean(record['settled']) : null
  const attempts = attemptsOf(record)
  const applies = readNumber(record?.['applies'])

  if (record !== null && record['error'] !== undefined && record['error'] !== null) {
    const error = record['error']
    return {
      transport: null,
      entries: 0,
      waitMs: readNumber(record['wait_ms']),
      error: isRecord(error) ? String(error['message'] ?? 'hook error') : String(error),
      // Machine-readable: the judge must not parse prose to tell "could not measure" from
      // "measured and it is broken".
      errorCode: isRecord(error) && typeof error['code'] === 'string' ? error['code'] : 'other',
      settled,
      attempts,
      applies,
      candidateRows: [],
      excluded,
    }
  }

  const parsed = parseInventorySnapshot(payload, { source: sandboxHome, sampledAt: '' })
  if (!parsed.ok) {
    return {
      transport: null,
      entries: 0,
      waitMs: readNumber(record?.['wait_ms'] ?? null),
      error: parsed.error.detail,
      errorCode: 'unreadable',
      settled,
      attempts,
      applies,
      candidateRows: [],
      excluded,
    }
  }

  const candidateRows = parsed.value.entries
    .filter((entry) => isCandidateModule(entry.moduleName, candidatePackage))
    .map((entry) => ({ entryId: entry.entryId, moduleName: entry.moduleName, phase: entry.fiberPhase }))
    .sort((left, right) => left.entryId.localeCompare(right.entryId))

  return {
    transport: parsed.value.transport,
    entries: parsed.value.entries.length,
    waitMs: readNumber(record?.['wait_ms'] ?? null),
    error: null,
    errorCode: null,
    settled,
    attempts,
    applies,
    candidateRows,
    excluded,
  }
}

/**
 * `@scope/pkg/sub/path` and `file:///…/node_modules/pkg/x.js` both have to reduce to the
 * package name, because the inventory reports whatever the loader resolved.
 *
 * A `file:` URL with no `node_modules/` segment (a linked or vendored plugin) has no
 * derivable package name; this returns `''` instead of inventing one, and
 * {@link isCandidateModule} decides the match with the path evidence it does have.
 */
export function modulePackageName(moduleName: string): string {
  let text = moduleName
  if (text.startsWith('file://')) {
    try {
      text = decodeURIComponent(text)
    } catch {
      // Keep the raw text; the comparison below simply will not match.
    }
    const marker = text.lastIndexOf('node_modules/')
    if (marker === -1) return ''
    text = text.slice(marker + 'node_modules/'.length)
  }
  const parts = text.split('/').filter((part) => part !== '')
  if (parts.length === 0) return text
  if (parts[0]?.startsWith('@') === true) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : String(parts[0])
  return String(parts[0])
}

/**
 * Does this runtime row belong to the candidate?
 *
 * Exact package name first; then the path segment, so a `link:`-installed candidate (the
 * shape our own fixtures use) is still identified. Both matches are recorded as *the*
 * candidate row, and two rows still produce `unknown` — the heuristic widens what can be
 * recognised, never what can be concluded.
 */
export function isCandidateModule(moduleName: string, candidatePackage: string): boolean {
  if (candidatePackage === '') return false
  if (moduleName === candidatePackage) return true
  if (modulePackageName(moduleName) === candidatePackage) return true
  let text = moduleName
  if (text.startsWith('file://')) {
    try {
      text = decodeURIComponent(text)
    } catch {
      // Raw comparison below.
    }
  }
  const normalized = text.replaceAll('\\', '/')
  if (normalized.includes(`/node_modules/${candidatePackage}/`)) return true
  // A `link:`ed or vendored candidate resolves to a path inside its own directory, so the
  // directory segment is the only evidence left. Scoped names keep their `@scope/pkg` form.
  if (moduleName.startsWith('file://') && normalized.includes(`/${candidatePackage}/`)) return true
  return normalized.endsWith(`/${candidatePackage}`)
}

/* --------------------------------- judging --------------------------------- */

export type ProbeAssertionStatus = 'passed' | 'failed' | 'unmeasured'

export interface ProbeAssertionResult {
  readonly id: string
  readonly status: ProbeAssertionStatus
  readonly detail: string | null
}

export interface ProbeJudgement {
  readonly conclusion: Conclusion
  readonly confidence: Confidence
  readonly reasons: readonly Reason[]
  readonly evidence: readonly Evidence[]
  readonly remediation: readonly Remediation[]
  readonly missingEvidence: readonly string[]
  readonly assertions: readonly ProbeAssertionResult[]
}

export interface JudgeProbeInput {
  readonly run: ProbeRun
  readonly at: string
  /** Declared dsh range of the candidate, when known; a mismatch downgrades to `unknown`. */
  readonly declaredRange?: string | null
}

/** Phases that mean "still moving"; a row in one of these is not a row that failed. */
const TRANSIENT_PHASES = new Set(['pending', 'loading', 'unloading'])

export type MeasurementState = 'valid' | 'unsettled' | 'unreadable'

/**
 * What can this reading support? (R17 / BS-25)
 *
 * `settled: null` (older payloads without the field) is treated as usable: the probe cannot
 * retroactively fail a sample it produced before the field existed, and the hook always
 * writes it now.
 */
export function measurementState(sample: ProbeSampleView | null): MeasurementState {
  if (sample === null) return 'unreadable'
  if (sample.error !== null) return 'unreadable'
  if (sample.settled === false) return 'unsettled'
  return 'valid'
}

/** Publishable detail for `probe.tree-not-settled`: observations only, no guesses. */
function measurementDetail(run: ProbeRun): string {
  const parts: string[] = []
  const sample = run.sample
  if (sample !== null) {
    parts.push(`settled=${String(sample.settled)}`)
    parts.push(`attempts=${sample.attempts ?? 'unknown'}`)
    if (sample.errorCode !== null) parts.push(`code=${sample.errorCode}`)
    if (sample.error !== null) parts.push(sample.error.slice(0, 120))
    if (sample.candidateRows.length > 0) {
      parts.push(`rows=${sample.candidateRows.map((row) => `${row.entryId}:${row.phase ?? 'none'}`).join(',')}`)
    }
  }
  if (run.readiness !== null) {
    parts.push(`readiness=${run.readiness.outcome}(${run.readiness.waited_ms}ms/${run.readiness.window_ms}ms)`)
  }
  return parts.join(' · ')
}

export function judgeProbe(input: JudgeProbeInput): ProbeJudgement {
  const { run, at } = input
  const reasons: Reason[] = []
  const evidence: Evidence[] = []
  const remediation: Remediation[] = []
  const missingEvidence: string[] = []
  // A mutable holder: TypeScript's control-flow analysis cannot see assignments made
  // inside the `block()` closure, and a plain `let` made the later guards look dead.
  const state: { conclusion: Conclusion; level: Confidence['level'] } = { conclusion: 'go', level: 'high' }

  const block = (code: string, messageId: string, params?: Record<string, string | number>): void => {
    state.conclusion = 'blocked'
    reasons.push({ code, severity: 'block', messageId, ...(params === undefined ? {} : { params }) })
  }

  evidence.push({
    id: 'probe-runtime',
    tier: 'measured-local',
    source: run.dshMain,
    method: 'dsh --version (sandbox)',
    at,
    ...(run.runtimeVersion === null ? {} : { detail: run.runtimeVersion }),
  })

  const stepOf = (id: ProbeStepId): ProbeStepRun | undefined => run.steps.find((step) => step.id === id)

  const runtimeStep = stepOf('runtime')
  if (runtimeStep?.status !== 'passed') {
    block('probe-runtime-unavailable', 'probe.runtime-unavailable', { detail: runtimeStep?.detail ?? 'runtime not read' })
    return finishJudgement(run, { conclusion: state.conclusion, level: state.level, reasons, evidence, remediation, missingEvidence })
  }

  /**
   * The copied profile failed to become usable (T-304).
   *
   * WHY THIS RETURNS IMMEDIATELY: the candidate was never given a chance to run. Carrying on
   * would let the generic paths below turn "your own dependencies did not install" into
   * `probe.boot-timeout` or `probe.install-failed` — a `blocked` verdict about the wrong
   * package. The two reasons are separate on purpose: a dangling `link:` is a *silent*
   * success of the package manager (F40) and reads differently from a failed install.
   */
  const profileStep = stepOf('profile')
  if (profileStep !== undefined && profileStep.status === 'failed') {
    const copy = run.profileCopy
    if (copy !== null) {
      evidence.push({
        id: 'probe-profile-copy',
        tier: 'measured-local',
        source: run.profileSourceDir ?? `copy:${copy.origin}`,
        method: 'profile declaration copy + dependency install (sandbox)',
        at,
        detail: `origin=${copy.origin} copied=${copy.copied.join(',') || 'none'} missing=${copy.missing.join(',') || 'none'} install_exit=${copy.install?.exitCode ?? 'not attempted'}`,
      })
    }
    state.conclusion = 'unknown'
    state.level = 'medium'
    missingEvidence.push('missing.probe')
    const dangling = copy?.danglingLinks ?? []
    if (dangling.length > 0) {
      reasons.push({
        code: 'probe-profile-link-dangling',
        severity: 'warn',
        messageId: 'probe.profile-link-dangling',
        params: {
          links: dangling.map((link) => `${link.name} → ${link.spec}`).join(', '),
          count: dangling.length,
        },
      })
    } else {
      reasons.push({
        code: 'probe-profile-copy-unusable',
        severity: 'warn',
        messageId: 'probe.profile-copy-unusable',
        params: {
          profile: copy?.origin ?? run.profileOrigin,
          detail: (profileStep.detail ?? 'the copied profile could not be installed').slice(0, 240),
        },
      })
    }
    return finishJudgement(run, {
      conclusion: state.conclusion,
      level: state.level,
      reasons,
      evidence,
      remediation,
      missingEvidence,
    })
  }
  if (profileStep !== undefined && profileStep.status === 'passed' && run.profileCopy !== null) {
    evidence.push({
      id: 'probe-profile-copy',
      tier: 'measured-local',
      source: run.profileSourceDir ?? `copy:${run.profileCopy.origin}`,
      method: 'profile declaration copy + dependency install (sandbox)',
      at,
      detail: `origin=${run.profileCopy.origin} copied=${run.profileCopy.copied.join(',') || 'none'} missing=${run.profileCopy.missing.join(',') || 'none'} install_exit=${run.profileCopy.install?.exitCode ?? 'not attempted'}`,
    })
    /**
     * The copy's dependencies installed but their build scripts were refused (R19 F35 shape).
     *
     * WHY IT IS NOT SILENT: native modules that never got built can make a Host fail to start
     * for reasons that have nothing to do with the candidate. The caveat has to be visible in
     * every verdict it could have touched, not only in the artifacts someone reads twice.
     */
    if (run.profileCopy.buildRefused === true) {
      reasons.push({
        code: 'probe-profile-build-refused',
        severity: 'warn',
        messageId: 'probe.profile-build-refused',
        params: { detail: (run.profileCopy.install?.detail ?? 'the package manager refused to run build scripts').slice(0, 200) },
      })
    }
  }

  const installStep = stepOf('install')
  if (installStep !== undefined && installStep.status === 'failed') {
    /**
     * The package-manager refusal was about the COPIED PROFILE, and the composition was not
     * updated (T-304 / R21). Nothing here is evidence about the candidate: the install never
     * completed, so the bundle was never registered and the Host never mounted it. Reporting
     * `blocked` would blame a package for a profile it did not write.
     */
    if (run.installBuildRefusedProfileOnly) {
      state.conclusion = 'unknown'
      state.level = 'medium'
      missingEvidence.push('missing.probe')
      // One refusal, one reason: when the copy's own install already reported the same policy
      // fact, repeating it here would read like two separate findings.
      if (run.profileCopy?.buildRefused !== true) {
        reasons.push({
          code: 'probe-profile-build-refused',
          severity: 'warn',
          messageId: 'probe.profile-build-refused',
          params: {
            detail: `the package manager refused to build the copied profile's own dependencies (${run.installIgnoredPackages.join(', ')}), so the composition was not updated with the candidate`,
          },
        })
      }
      evidence.push({
        id: 'probe-install-refused-by-profile',
        tier: 'measured-local',
        source: run.candidate.spec,
        method: 'dsh plugin add (sandbox) + dsh.profile.bundles read-back',
        at,
        detail: `candidate_registered=${run.candidateRegistered === null ? 'unreadable' : String(run.candidateRegistered)} ignored=${run.installIgnoredPackages.join(',') || 'none'}`,
      })
      return finishJudgement(run, {
        conclusion: state.conclusion,
        level: state.level,
        reasons,
        evidence,
        remediation,
        missingEvidence,
      })
    }
    // T-310: name the package manager's reason, not just its exit code. Three shapes, and
    // the difference matters to the reader: a build-script refusal is a package-manager
    // policy (the plugin is fine, it just never got built), a code is a cause, and the
    // third branch is the honest "it failed and said nothing usable".
    const diagnosis = run.installDiagnosis
    const code = diagnosis?.code ?? null
    const keyLine = diagnosis?.key_line ?? null
    const spoken = keyLine === null ? 'the package manager printed no line that explains this' : keyLine
    if (diagnosis !== null && diagnosis.source !== 'none') {
      evidence.push({
        id: 'probe-install-diagnosis',
        tier: 'measured-local',
        source: run.candidate.spec,
        method: `package manager output (${diagnosis.source}, sandbox)`,
        at,
        detail: code === null ? spoken : `code=${code} · ${spoken}`,
      })
    }
    if (code === 'ERR_PNPM_IGNORED_BUILDS') {
      block('probe-install-build-refused', 'probe.install-build-refused', { code, detail: spoken })
      remediation.push({
        kind: 'report',
        messageId: 'remediation.install-build-refused',
        note: 'the package manager installed the package but refused to run its build scripts, so nothing was built; allow build scripts for this package or ask the author for a prebuilt release',
      })
    } else if (code !== null) {
      block('probe-install-failed-code', 'probe.install-failed-code', {
        exit: installStep.exitCode ?? 'unknown',
        code,
        detail: spoken,
      })
      remediation.push({ kind: 'report', messageId: 'remediation.report', note: 'report the install failure to the plugin author with the probe artifact' })
    } else {
      block('probe-install-failed', 'probe.install-failed', {
        step: 'install',
        exit: installStep.exitCode ?? 'unknown',
      })
      remediation.push({ kind: 'report', messageId: 'remediation.report', note: 'report the install failure to the plugin author with the probe artifact' })
    }
  } else if (installStep !== undefined && installStep.status === 'passed') {
    evidence.push({
      id: 'probe-install',
      tier: 'measured-local',
      source: run.candidate.spec,
      method: 'dsh plugin --profile <p> add <candidate> (sandbox)',
      at,
    })
    // The install passed but the package manager refused to build something. Name it, and name
    // whose it is: a reader must not have to guess why `go` came with a build warning (T-304).
    if (run.installBuildRefusedProfileOnly && run.profileCopy?.buildRefused !== true) {
      reasons.push({
        code: 'probe-profile-build-refused',
        severity: 'warn',
        messageId: 'probe.profile-build-refused',
        params: {
          detail: `the package manager refused to build the copied profile's own dependencies (${run.installIgnoredPackages.join(', ')}) while adding the candidate; the candidate is registered in the composition`,
        },
      })
    }
  }

  const bootStep = stepOf('boot')
  if (run.sample === null) {
    const ourPortUnbindable = run.bindFailedPorts.includes(run.port)
    if (bootStep?.status === 'failed' && ourPortUnbindable) {
      // The Host could not bind the port WE chose (EACCES/EADDRINUSE on 127.0.0.1:<plan>).
      // That is a probe-environment failure: the candidate was never given a chance (R17 —
      // this machine excludes TCP 53461-53560 and the plan's hash picked 53506).
      state.conclusion = 'unknown'
      state.level = 'medium'
      missingEvidence.push('missing.probe')
      reasons.push({
        code: 'probe-port-unavailable',
        severity: 'warn',
        messageId: 'probe.port-unavailable',
        params: { port: run.port },
      })
    } else if (bootStep?.status === 'failed' && run.urlPrinted) {
      // The Host printed its own URL, so it was up: "the hook wrote nothing" is OUR
      // instrument failing, not the candidate. N22: unknown + missing.inventory, never blocked.
      state.conclusion = 'unknown'
      state.level = 'medium'
      missingEvidence.push('missing.inventory')
      reasons.push({
        code: 'probe-instrument-silent',
        severity: 'warn',
        messageId: 'probe.tree-not-settled',
        params: {
          detail: `no inventory sample in ${Math.round((run.timings.bootToSampleMs ?? 0) / 1000)}s while the Host was serving`,
        },
      })
    } else if (state.conclusion !== 'blocked' && run.startupFailed) {
      // The launcher's own verdict, quoted rather than paraphrased: "startup failed: N
      // required plugins did not activate", plus the first line of its diagnosis.
      block('probe-startup-failed', 'probe.startup-failed', {
        detail: (run.firstLine ?? 'the Host refused to start').slice(0, 200),
      })
      remediation.push({
        kind: 'report',
        messageId: 'remediation.report',
        note: 'the sandbox Host refused to start with this candidate installed; attach the probe artifact (it carries the launcher diagnostic)',
      })
    } else if (state.conclusion !== 'blocked') {
      block('probe-boot-timeout', 'probe.boot-timeout', {
        // With no sample there is no `bootToSampleMs`; the honest number is how long the boot
        // step actually waited (R17: the first draft said "within 0s", which read as a bug).
        seconds: Math.round((bootStep?.ms ?? 0) / 1000),
      })
      remediation.push({ kind: 'report', messageId: 'remediation.report', note: 'the sandbox Host never produced a sample; attach it to the bug report' })
    }
  } else {
    evidence.push({
      id: 'probe-boot',
      tier: 'measured-local',
      source: run.candidate.spec,
      method: `boot + ${run.sample.transport ?? 'unstated transport'} inventory sample`,
      at,
      detail: `entries=${run.sample.entries} wait_ms=${run.sample.waitMs ?? 'unknown'}`,
    })
  }

  /**
   * Can the inventory reading support a `blocked` verdict? (R17 / BS-25)
   *
   * - `valid`: the hook read the tree after it stopped moving;
   * - `unsettled`: rows were still `pending`/`loading` when the budget ran out;
   * - `unreadable`: the hook could not read the tree at all (`{error}`).
   *
   * Only `valid` may attribute a failure to the candidate. The other two are measurement
   * failures and must end as `unknown` + `missing.inventory` -- that is the whole
   * "slow is not broken" separation.
   */
  const measurement = measurementState(run.sample)

  if (measurement !== 'valid' && run.sample !== null) {
    state.conclusion = 'unknown'
    state.level = 'medium'
    missingEvidence.push('missing.inventory')
    const unreadable = measurement === 'unreadable' && run.sample.errorCode !== 'inactive-context'
    reasons.push(
      unreadable
        ? {
            code: 'probe-sample-unreadable',
            severity: 'warn',
            messageId: 'probe.sample-unreadable',
            params: { detail: run.sample.error ?? 'unreadable sample' },
          }
        : {
            code: 'probe-tree-not-settled',
            severity: 'warn',
            messageId: 'probe.tree-not-settled',
            params: { detail: measurementDetail(run) },
          },
    )
  }

  const httpSkipped = stepOf('http')?.status === 'skipped'
  if (!httpSkipped) {
    if (measurement !== 'valid') {
      // The port check ran, but a silent port cannot be attributed to the candidate while
      // the tree was still composing (or could not be read). The step record keeps what the
      // probe actually observed; the verdict refuses to turn it into "does not serve".
    } else if (run.http === null || run.http.status === null) {
      if (state.conclusion !== 'blocked') {
        block('probe-http-unreachable', 'probe.http-unreachable', { port: run.port })
        remediation.push({ kind: 'report', messageId: 'remediation.report', note: 'the Host never answered on the probe port' })
      }
    } else {
      evidence.push({
        id: 'probe-http',
        tier: 'measured-local',
        source: `http://127.0.0.1:${run.readiness?.port ?? run.port}`,
        method: 'http readiness (redirect: manual)',
        at,
        detail:
          `status=${run.http.status}` +
          (run.readiness === null
            ? ''
            : ` waited=${run.readiness.waited_ms}ms window=${run.readiness.window_ms}ms url_seen=${String(run.readiness.url_seen)}`),
      })
    }
  }

  if (run.readiness !== null && run.readiness.source === 'host-url' && run.readiness.port !== run.port) {
    // The Host's own URL wins over the planned port, but the difference is evidence, not
    // noise: it means `--port` was not honoured and any later check must use both ports.
    reasons.push({
      code: 'probe-port-mismatch',
      severity: 'warn',
      messageId: 'probe.port-mismatch',
      params: { host: run.readiness.port, plan: run.port },
    })
  }

  // Client-render (T-302). A blank page blocks on its own: "HTTP answered, row active,
  // nothing on screen" is exactly BS-03, and reporting `go` for it would be the lie this
  // assertion was added to prevent.
  if (run.render !== null) {
    if (run.render.state === 'blank') {
      block('probe-render-blank', 'probe.render-blank', { detail: run.render.detail })
      remediation.push({
        kind: 'report',
        messageId: 'remediation.report',
        note: 'the page mounted nothing (white screen); attach the probe artifact and the browser console log',
      })
    } else if (run.render.state === 'inconclusive') {
      if (state.conclusion === 'go') {
        state.conclusion = 'unknown'
        state.level = 'medium'
      }
      missingEvidence.push('missing.render')
      reasons.push({ code: 'probe-render-unmeasured', severity: 'warn', messageId: 'probe.render-unmeasured', params: { detail: run.render.detail } })
    } else {
      reasons.push({ code: 'probe-render-ok', severity: 'info', messageId: 'probe.render-ok', params: { ms: run.render.ms } })
      evidence.push({
        id: 'probe-render',
        tier: 'measured-local',
        source: `http://127.0.0.1:${run.readiness?.port ?? run.port}`,
        method: 'headless Chromium + CDP DOM observation',
        at,
        detail: run.render.detail,
      })
    }
  }

  if (state.conclusion !== 'blocked' && measurement === 'valid') {
    const rows = run.sample?.candidateRows ?? []
    if (rows.length === 0) {
      block('probe-row-missing', 'probe.row-missing')
      remediation.push({
        kind: 'remove-plugin',
        messageId: 'remediation.remove-plugin',
        note: 'the candidate installed but produced no row; remove it or report the silent no-op',
      })
    } else if (rows.length > 1) {
      state.conclusion = 'unknown'
      state.level = 'medium'
      reasons.push({
        code: 'probe-row-ambiguous',
        severity: 'warn',
        messageId: 'probe.row-ambiguous',
        params: { count: rows.length, rows: rows.map((row) => row.entryId).join(', ') },
      })
      missingEvidence.push('missing.row-identity')
    } else {
      const row = rows[0]
      if (row !== undefined && row.phase !== null && TRANSIENT_PHASES.has(row.phase)) {
        // A row still moving at sample time is NOT a row that failed (N21): the phase is a
        // race, not an outcome. The settle budget is the hook's, and it already reported it.
        state.conclusion = 'unknown'
        state.level = 'medium'
        missingEvidence.push('missing.inventory')
        reasons.push({
          code: 'probe-row-unsettled',
          severity: 'warn',
          messageId: 'probe.tree-not-settled',
          params: { detail: `row ${row.entryId} is still ${row.phase}` },
        })
      } else if (row !== undefined && row.phase === 'active') {
        reasons.push({
          code: 'probe-row-active',
          severity: 'info',
          messageId: 'probe.row-active',
          params: { row: row.entryId },
        })
        if (run.http !== null && run.http.status !== null) {
          reasons.unshift({
            code: 'probe-served',
            severity: 'info',
            messageId: 'probe.served',
            params: {
              status: run.http.status,
              seconds: Math.round((run.timings.bootToSampleMs ?? 0) / 1000),
            },
          })
        }
      } else if (row !== undefined) {
        block('probe-row-inactive', 'probe.row-inactive', { row: row.entryId, phase: row.phase ?? 'none' })
        remediation.push({
          kind: 'remove-plugin',
          messageId: 'remediation.remove-plugin',
          note: 'the candidate row is declared and admitted but never runs; remove it until the author ships a fix',
        })
      }
    }
  }

  if (input.declaredRange !== undefined && input.declaredRange !== null && run.runtimeVersion !== null) {
    // Only a *stated* mismatch downgrades the reading. We never guess a range here: the
    // declaration was already judged by admission, this is the honesty check that the
    // measurement transfers to the runtime the user actually runs.
    if (rangeExcludes(input.declaredRange, run.runtimeVersion)) {
      if (state.conclusion === 'go') state.conclusion = 'unknown'
      state.level = state.level === 'high' ? 'medium' : state.level
      reasons.push({
        code: 'probe-runtime-mismatch',
        severity: 'warn',
        messageId: 'probe.runtime-mismatch',
        params: { runtime: run.runtimeVersion, range: input.declaredRange },
      })
      missingEvidence.push('missing.probe')
    }
  }

  /**
   * A copy whose build scripts were refused cannot support a `blocked` verdict.
   *
   * WHY ONLY THE BOOT STEP: `abortedAt === 'boot'` covers every shape where the composition
   * never came up (startup failed / no sample / boot timeout). Those are exactly the failures
   * an unbuilt native module can cause. A failed candidate install or a dead row is the
   * candidate's own fact and keeps its `blocked` — the downgrade must not become a blanket
   * "we are never sure".
   */
  if (
    (run.profileCopy?.buildRefused === true || run.installBuildRefusedProfileOnly) &&
    state.conclusion === 'blocked' &&
    run.abortedAt === 'boot'
  ) {
    state.conclusion = 'unknown'
    state.level = 'medium'
    missingEvidence.push('missing.probe')
    reasons.push({
      code: 'probe-profile-build-unattributable',
      severity: 'warn',
      messageId: 'probe.profile-build-refused',
      params: {
        detail: `the copy's dependencies installed without their build scripts, so the Host's failure to start cannot be attributed to the candidate (${run.firstLine ?? 'no launcher line'})`.slice(0, 240),
      },
    })
  }

  if (!run.cleanup.removed || !run.cleanup.portClosed) {
    if (state.conclusion === 'go') state.conclusion = 'risky'
    reasons.push({
      code: 'probe-cleanup-incomplete',
      severity: 'warn',
      messageId: 'probe.cleanup-incomplete',
      params: { removed: String(run.cleanup.removed), portClosed: String(run.cleanup.portClosed) },
    })
  }
  evidence.push({
    id: 'probe-cleanup',
    tier: 'measured-local',
    source: run.cleanup.detail,
    method: 'directory + port check',
    at,
  })

  return finishJudgement(run, {
    conclusion: state.conclusion,
    level: state.level,
    reasons,
    evidence,
    remediation,
    missingEvidence:
      state.conclusion === 'unknown' && missingEvidence.length === 0 ? ['missing.probe'] : missingEvidence,
  })
}

function finishJudgement(
  run: ProbeRun,
  input: {
    conclusion: Conclusion
    level: Confidence['level']
    reasons: Reason[]
    evidence: Evidence[]
    remediation: Remediation[]
    missingEvidence: string[]
  },
): ProbeJudgement {
  return {
    conclusion: input.conclusion,
    confidence: { level: input.level, basis: 'measured-local' },
    reasons: input.reasons,
    evidence: input.evidence,
    remediation: input.remediation,
    missingEvidence: input.conclusion === 'unknown' ? input.missingEvidence : [],
    assertions: probeAssertions(run),
  }
}

/** The six assertions of the contract; the ones we cannot measure stay visible. */
export function probeAssertions(run: ProbeRun): readonly ProbeAssertionResult[] {
  const step = (id: ProbeStepId): ProbeStepRun | undefined => run.steps.find((item) => item.id === id)
  const httpStep = step('http')
  const measurement = measurementState(run.sample)
  const rows = run.sample?.candidateRows ?? []
  /**
   * A copy that never became usable means the candidate was never booted (T-304). Saying
   * `failed` here would read as "the plugin failed", which is the one thing this run cannot
   * know: nothing was measured.
   *
   * The second shape is the subtler one: the copy worked, but a build-script refusal left the
   * candidate out of `dsh.profile.bundles` (R22 / F42), so the composition never contained it.
   */
  const profileUnusable = step('profile')?.status === 'failed'
  const compositionNotUpdated = run.installBuildRefusedProfileOnly && step('install')?.status === 'failed'
  const notMeasured = profileUnusable
    ? 'the copied profile could not be made usable, so the candidate was never booted'
    : compositionNotUpdated
      ? 'the package manager refused to build the copied profile’s own dependencies, so the composition was not updated and the candidate was never booted'
      : null
  return [
    {
      // `failed` is "nothing was written"; `unmeasured` is "something was written but it is
      // not a reading" (the hook's own context died). They are different facts (R17).
      id: 'boot-sampled',
      status:
        notMeasured !== null
          ? 'unmeasured'
          : run.sample === null
            ? run.urlPrinted
              ? 'unmeasured'
              : 'failed'
            : measurement === 'unreadable'
              ? 'unmeasured'
              : 'passed',
      detail:
        notMeasured ??
        (run.sample === null
          ? run.urlPrinted
            ? 'the Host was serving but the probe wrote no sample'
            : 'no sample'
          : (run.sample.error ??
            (run.sample.settled === false ? 'sampled while the tree was still moving (settled=false)' : null))),
    },
    {
      // A silent port measured while the tree was still composing is NOT a failure of the
      // candidate: it is a reading that cannot answer this question (R17 / BS-25).
      id: 'http-served',
      status:
        notMeasured !== null || httpStep?.status === 'skipped' || measurement !== 'valid'
          ? 'unmeasured'
          : run.http === null || run.http.status === null
            ? 'failed'
            : 'passed',
      detail:
        notMeasured ??
        (httpStep?.status === 'skipped'
          ? httpStep.detail
          : measurement !== 'valid'
            ? `not attributable: the inventory reading was ${measurement}`
            : (run.http?.detail ?? 'not probed')),
    },
    {
      id: 'inventory-active',
      status:
        notMeasured !== null
          ? 'unmeasured'
          : measurement !== 'valid'
            ? 'unmeasured'
            : rows.length === 1 && rows[0]?.phase === 'active'
              ? 'passed'
              : 'failed',
      detail:
        notMeasured ??
        (measurement !== 'valid'
          ? `no settled reading (${measurement})`
          : run.sample === null
            ? 'no sample'
            : `${rows.length} candidate row(s)`),
    },
    {
      id: 'cleanup-complete',
      status: run.cleanup.removed && run.cleanup.portClosed ? 'passed' : 'failed',
      detail: run.cleanup.detail,
    },
    // Not "skipped": the artifact must show whether this run answered it. `unmeasured`
    // means no browser was available (or the check could not complete), never "fine".
    {
      id: 'client-rendered',
      status:
        run.render === null
          ? 'unmeasured'
          : run.render.state === 'rendered'
            ? 'passed'
            : run.render.state === 'blank'
              ? 'failed'
              : 'unmeasured',
      detail:
        run.render === null
          ? (run.renderSkipped ?? 'render check not requested')
          : `${run.render.state}: ${run.render.detail}`,
    },
    { id: 'namespace-diff', status: 'unmeasured', detail: 'tracked as T-303; tool surface lives in agent scope (BS-21)' },
  ]
}

/** Build the contract-shaped verdict around a judgement. */
export function probeVerdict(input: {
  readonly run: ProbeRun
  readonly judgement: ProbeJudgement
  readonly env: EnvFingerprint
  readonly at: string
}): Verdict {
  const { run, judgement, env, at } = input
  return {
    schemaVersion: 1,
    subject: { name: run.candidate.package, version: null, kind: 'plugin' },
    env,
    conclusion: judgement.conclusion,
    confidence: judgement.confidence,
    reasons: judgement.reasons,
    evidence: judgement.evidence,
    remediation: judgement.remediation,
    missingEvidence: judgement.missingEvidence,
    generatedAt: at,
  }
}

/* --------------------------------- helpers -------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * How many reads the hook needed. The payload carries either the attempt trace (array) or
 * a count; both are facts, and neither is inferred from the failure text.
 */
function attemptsOf(record: Record<string, unknown> | null): number | null {
  if (record === null) return null
  const list = record['attempts']
  if (Array.isArray(list)) return list.length
  if (typeof list === 'number' && Number.isFinite(list)) return list
  const error = record['error']
  if (isRecord(error)) return readNumber(error['attempts'])
  return null
}

/**
 * Deliberately tiny range check: enough to know that the runtime is *outside* a stated
 * range, so the probe result is not advertised for a runtime it never ran on. Full
 * admission semantics live in core/admission — this is not a second implementation.
 */
function rangeExcludes(range: string, runtime: string): boolean {
  const text = range.trim()
  if (text === '' || text === '*' || text.toLowerCase() === 'any') return false
  const versions = [runtime, runtime.replace(/^v/, '')]
  if (versions.some((version) => text.includes(version))) return false
  // Only the exact-pin shape can be judged without a semver engine here.
  const exact = /^=?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(text)
  if (exact !== null) return versions.every((version) => version !== exact[1])
  return false
}
