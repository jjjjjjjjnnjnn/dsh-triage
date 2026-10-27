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
import type { ProbePlan } from './plan.js'
import type { RenderCheck } from './render.js'

/* ---------------------------------- types ---------------------------------- */

export type ProbeStepId = 'runtime' | 'install' | 'boot' | 'http' | 'render' | 'inventory' | 'cleanup'
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
}

export interface ProbeCleanupResult {
  readonly removed: boolean
  readonly portClosed: boolean
  readonly detail: string
}

export interface ProbeRun {
  readonly candidate: { readonly spec: string; readonly package: string }
  readonly dshMain: string
  readonly sandboxHome: string
  readonly port: number
  readonly runtimeVersion: string | null
  readonly steps: readonly ProbeStepRun[]
  readonly timings: ProbeTimings
  readonly sample: ProbeSampleView | null
  readonly http: { readonly status: number | null; readonly detail: string } | null
  /** Where the readiness port came from (T-306); `null` when readiness was not requested. */
  readonly readiness: { readonly source: 'host-url' | 'plan-port'; readonly port: number } | null
  /** Client-render observation (T-302); `null` when it did not run. */
  readonly render: RenderCheck | null
  /** Why the render check did not run; `null` when it ran. */
  readonly renderSkipped: string | null
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
  install(input: InstallInput): Promise<{ exitCode: number | null; detail: string }>
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
    readiness?: { source: 'host-url' | 'plan-port'; port: number } | null
    /** T-302: the render observation, when a browser was available. */
    render?: RenderCheck | null
    /** T-302: why the render check did not run (published verbatim). */
    renderSkipped?: string | null
  }>
  probeHttp(input: HttpInput): Promise<{ status: number | null; detail: string }>
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
  port: number
  runtimeVersion: string | null
  steps: ProbeStepRun[]
  timings: { installMs: number | null; bootToSampleMs: number | null; httpMs: number | null; renderMs: number | null; cleanupMs: number | null }
  sample: ProbeSampleView | null
  http: { status: number | null; detail: string } | null
  readiness: { source: 'host-url' | 'plan-port'; port: number } | null
  render: RenderCheck | null
  renderSkipped: string | null
  cleanup: ProbeCleanupResult
  abortedAt: ProbeStepId | null
}

export async function executeProbe(input: ExecuteProbeInput, deps: ProbeExecDeps): Promise<ProbeRun> {
  const timeouts: ProbeTimeouts = { ...DEFAULT_PROBE_TIMEOUTS, ...(input.timeouts ?? {}) }
  const run: MutableRun = {
    candidate: { spec: input.plan.candidate, package: input.candidatePackage },
    dshMain: input.dshMain,
    sandboxHome: input.plan.sandboxHome,
    port: input.plan.port,
    runtimeVersion: null,
    steps: [],
    timings: { installMs: null, bootToSampleMs: null, httpMs: null, renderMs: null, cleanupMs: null },
    sample: null,
    http: null,
    readiness: null,
    render: null,
    renderSkipped: null,
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

  if (input.skipInstall !== true) {
    await runStep(run, deps, 'install', async () => {
      const result = await deps.install({
        dshMain: input.dshMain,
        dshHome: input.plan.sandboxHome,
        profile: input.plan.profile,
        candidate: input.plan.candidate,
        timeoutMs: timeouts.installMs,
      })
      return result.exitCode === 0
        ? { status: 'passed' as const, detail: result.detail, exitCode: result.exitCode }
        : { status: 'failed' as const, detail: result.detail, exitCode: result.exitCode }
    })
    if (run.abortedAt !== null) return
  } else {
    run.steps.push({ id: 'install', status: 'skipped', ms: 0, detail: 'skipInstall', exitCode: null })
  }

  await runStep(run, deps, 'boot', async () => {
    const boot = await deps.bootAndSample({ plan: input.plan, dshMain: input.dshMain, timeoutMs: timeouts.bootMs })
    // `seconds` is the recorder's own clock (spawn → sample). `runStep` measures the same
    // interval and overwrites `bootToSampleMs`, so the 20s budget is judged on one number.
    if (boot.sample === null) return { status: 'failed' as const, detail: boot.detail, exitCode: null }
    run.sample = readSample(boot.sample, input.candidatePackage, input.plan.sandboxHome)
    // The 20s budget is spawn → sample (`boot.seconds`). The STEP's wall time also covers
    // the settle, the readiness probe and the post-kill wait, so the two numbers differ on
    // purpose and only one of them is judged (docs/specs/M3-probe.md §4).
    run.timings.bootToSampleMs = Math.round(boot.seconds * 1000)
    // Readiness was taken while the Host was alive; keep it for the http step.
    if (boot.http !== undefined) run.http = boot.http
    if (boot.readiness !== undefined) run.readiness = boot.readiness
    if (boot.render !== undefined) run.render = boot.render
    if (boot.renderSkipped !== undefined) run.renderSkipped = boot.renderSkipped
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
    port: run.port,
    runtimeVersion: run.runtimeVersion,
    steps: run.steps,
    timings: run.timings,
    sample: run.sample,
    http: run.http,
    readiness: run.readiness,
    render: run.render,
    renderSkipped: run.renderSkipped,
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

  if (record !== null && record['error'] !== undefined && record['error'] !== null) {
    const error = record['error']
    return {
      transport: null,
      entries: 0,
      waitMs: readNumber(record['wait_ms']),
      error: isRecord(error) ? String(error['message'] ?? 'hook error') : String(error),
      candidateRows: [],
      excluded,
    }
  }

  const parsed = parseInventorySnapshot(payload, { source: sandboxHome, sampledAt: '' })
  if (!parsed.ok) {
    return { transport: null, entries: 0, waitMs: readNumber(record?.['wait_ms'] ?? null), error: parsed.error.detail, candidateRows: [], excluded }
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

  const installStep = stepOf('install')
  if (installStep !== undefined && installStep.status === 'failed') {
    block('probe-install-failed', 'probe.install-failed', {
      step: 'install',
      exit: installStep.exitCode ?? 'unknown',
    })
    remediation.push({ kind: 'report', messageId: 'remediation.report', note: 'report the install failure to the plugin author with the probe artifact' })
  } else if (installStep !== undefined && installStep.status === 'passed') {
    evidence.push({
      id: 'probe-install',
      tier: 'measured-local',
      source: run.candidate.spec,
      method: 'dsh plugin --profile <p> add <candidate> (sandbox)',
      at,
    })
  }

  const bootStep = stepOf('boot')
  if (run.sample === null) {
    if (state.conclusion !== 'blocked') {
      block('probe-boot-timeout', 'probe.boot-timeout', {
        seconds: Math.round((run.timings.bootToSampleMs ?? 0) / 100) / 10,
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

  const httpSkipped = stepOf('http')?.status === 'skipped'
  if (!httpSkipped) {
    if (run.http === null || run.http.status === null) {
      if (state.conclusion !== 'blocked') {
        block('probe-http-unreachable', 'probe.http-unreachable', { port: run.port })
        remediation.push({ kind: 'report', messageId: 'remediation.report', note: 'the Host never answered on the probe port' })
      }
    } else {
      evidence.push({
        id: 'probe-http',
        tier: 'measured-local',
        source: `http://127.0.0.1:${run.port}`,
        method: 'http readiness (redirect: manual)',
        at,
        detail: `status=${run.http.status}`,
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

  if (state.conclusion !== 'blocked') {
    if (run.sample?.error !== null && run.sample?.error !== undefined) {
      state.conclusion = 'unknown'
      state.level = 'medium'
      reasons.push({ code: 'probe-sample-unreadable', severity: 'warn', messageId: 'probe.sample-unreadable', params: { detail: run.sample.error } })
      missingEvidence.push('missing.inventory')
    } else {
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
        if (row !== undefined && row.phase === 'active') {
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
  return [
    { id: 'boot-sampled', status: run.sample === null || run.sample.error !== null ? 'failed' : 'passed', detail: run.sample?.error ?? (run.sample === null ? 'no sample' : null) },
    {
      id: 'http-served',
      status:
        httpStep?.status === 'skipped'
          ? 'unmeasured'
          : run.http === null || run.http.status === null
            ? 'failed'
            : 'passed',
      detail: httpStep?.status === 'skipped' ? httpStep.detail : (run.http?.detail ?? 'not probed'),
    },
    {
      id: 'inventory-active',
      status:
        run.sample === null || run.sample.error !== null
          ? 'failed'
          : run.sample.candidateRows.length === 1 && run.sample.candidateRows[0]?.phase === 'active'
            ? 'passed'
            : 'failed',
      detail: run.sample === null ? 'no sample' : `${run.sample.candidateRows.length} candidate row(s)`,
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
