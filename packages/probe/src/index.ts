/**
 * Public surface of `@dsh-triage/probe`.
 *
 * `plan` builds the isolation proof (pure data, dry-run printing is already useful);
 * `exec` runs it and judges what happened. The executor never runs unless the caller
 * passes `--execute`, and it never accepts a plan that overlaps the real DSH home.
 */

export type {
  ProbeAssertion,
  ProbePlan,
  ProbePlanError,
  ProbePlanErrorCode,
  ProbePlanInput,
  ProbeProfileSource,
  ProbeStep,
} from './plan.js'
export { PROFILE_DECLARATION_FILES, buildProbePlan, validateProbePlan } from './plan.js'

export {
  applySandboxBuildPolicy,
  copiedFilesPresent,
  copyProfileDeclarations,
  danglingLocalDependencies,
  localDependencyTargets,
  readProfileManifest,
} from './profile-copy.js'
export type { LocalDependencyTarget, ProfileCopyResult } from './profile-copy.js'

export {
  bootAndSampleHost,
  dshMainOf,
  diagnosisFromText,
  failureEndpoints,
  bindFailedPorts,
  findFreePort,
  ignoredBuildPackages,
  installDiagnosis,
  isReadableSample,
  isUsableSample,
  killTree,
  pluginArgv,
  probeHttp,
  readRuntimeVersion,
  removeSandbox,
  runInstall,
  runProfileInstall,
  sandboxNpmEnv,
  sanitizeDiagnosisLine,
  sanitizeLogLine,
  scrubbedEnv,
  sha256Of,
} from './host.js'
export type {
  BootSampleOptions,
  BootSampleResult,
  BootSegments,
  ExtraPatchEntry,
  HostObservation,
  HostReadiness,
  HttpProbeResult,
  InstallDiagnosis,
  InstallResult,
  RuntimeReadResult,
  SampleReplacement,
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
  ProbeDanglingLink,
  ProbeExecDeps,
  ProbeJudgement,
  ProbeProfileCopy,
  ProbeRun,
  ProbeSampleView,
  ProbeStepId,
  ProbeStepRun,
  ProbeStepStatus,
  ProbeTimeouts,
  ProbeTimings,
  ProfilePrepareInput,
  ProfilePrepareOutcome,
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
