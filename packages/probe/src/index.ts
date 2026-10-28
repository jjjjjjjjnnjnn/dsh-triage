/**
 * Public surface of `@dsh-triage/probe`.
 *
 * `plan` builds the isolation proof (pure data, dry-run printing is already useful);
 * `exec` runs it and judges what happened. The executor never runs unless the caller
 * passes `--execute`, and it never accepts a plan that overlaps the real DSH home.
 */

export type { ProbeAssertion, ProbePlan, ProbePlanError, ProbePlanErrorCode, ProbePlanInput, ProbeStep } from './plan.js'
export { buildProbePlan, validateProbePlan } from './plan.js'

export {
  bootAndSampleHost,
  dshMainOf,
  diagnosisFromText,
  failureEndpoints,
  bindFailedPorts,
  findFreePort,
  installDiagnosis,
  isUsableSample,
  killTree,
  probeHttp,
  readRuntimeVersion,
  removeSandbox,
  runInstall,
  sanitizeDiagnosisLine,
  sanitizeLogLine,
  scrubbedEnv,
  sha256Of,
} from './host.js'
export type {
  BootSampleOptions,
  BootSampleResult,
  ExtraPatchEntry,
  HostObservation,
  HostReadiness,
  HttpProbeResult,
  InstallDiagnosis,
  InstallResult,
  RuntimeReadResult,
} from './host.js'

export {
  MIN_VISIBLE_TEXT,
  extractHostUrl,
  findBrowser,
  judgeRender,
  killBrowser,
  renderScratchRoot,
  renderUrl,
} from './render.js'
export type {
  BrowserLookup,
  HostUrl,
  RenderCheck,
  RenderJudgement,
  RenderSignals,
  RenderState,
  RenderUrlInput,
} from './render.js'

export type {
  BootInput,
  CleanupInput,
  ExecuteProbeInput,
  HttpInput,
  InstallInput,
  JudgeProbeInput,
  ProbeAssertionResult,
  ProbeAssertionStatus,
  ProbeCandidateRow,
  ProbeCleanupResult,
  ProbeExecDeps,
  ProbeJudgement,
  ProbeRun,
  ProbeSampleView,
  ProbeStepId,
  ProbeStepRun,
  ProbeStepStatus,
  ProbeTimeouts,
  ProbeTimings,
  RuntimeReadInput,
} from './exec.js'
export {
  DEFAULT_PROBE_TIMEOUTS,
  executeProbe,
  isCandidateModule,
  judgeProbe,
  modulePackageName,
  probeAssertions,
  probeVerdict,
  readSample,
} from './exec.js'
