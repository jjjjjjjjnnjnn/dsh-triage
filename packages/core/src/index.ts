/**
 * Public surface of `@dsh-triage/core`.
 *
 * Everything exported here is stable API: the plugin, the CLI, the probe and the
 * (future) index-source generator consume it. Keep the surface small and typed;
 * add new capabilities as new modules, not by widening existing signatures.
 */

export type {
  Conclusion,
  Confidence,
  EnvFingerprint,
  Evidence,
  EvidenceTier,
  InstalledPackage,
  Reason,
  ReasonSeverity,
  Remediation,
  RemediationKind,
  Verdict,
  VerdictSubject,
} from './types.js'
export { CONCLUSION_VALUES } from './types.js'

export type { CoreError, CoreErrorCode, Result } from './result.js'
export { err, ok } from './result.js'

export type {
  AdmissionMode,
  AdmissionResult,
  AdmissionStatus,
  Requirement,
  RequirementFailure,
} from './admission.js'
export { evaluateAdmission, evaluateRange, isAdmissionPeer, readEnginesDsh } from './admission.js'

export type { LoadEnvInput, ProfileManifest } from './env.js'
export { defaultDshHome, loadEnv, parseProfileManifest, profileDirOf, resolveProfileDir } from './env.js'

export type { EntryClaim, EntryCollision, PresetDeclaration, RowTarget } from './ledger.js'
export {
  extractEntryClaims,
  extractPresetDeclarations,
  findEntryIdCollisions,
  groupClaimsBySource,
  parsePatchYaml,
  rowTargets,
} from './ledger.js'

export type { AdmissionVerdictInput, CollisionVerdictInput, RowAdmissionInput, RowDeclaration } from './verdict.js'
export type { InstallOrigin } from './verdict.js'
export {
  conclusionRank,
  mergeVerdicts,
  renderVerdict,
  verdictFromAdmission,
  verdictsFromCollisions,
  verdictsFromRowAdmission,
} from './verdict.js'

export type { CopyLocation, DuplicateCopy, DuplicateCopyInput } from './duplicates.js'
export { verdictsFromDuplicateCopies } from './duplicates.js'

export type { CompatChannel, CompatReading, CompatRelease, CompatStanding } from './compat-channel.js'
export { judgeCompatChannel, readCompatChannel } from './compat-channel.js'
export type { ProfileExemptions } from './exemption.js'
export {
  PROFILE_COMPATIBILITY_FILENAME,
  isExactVersion as isExactExemptionVersion,
  isExempted,
  parseExemptionKey,
  readProfileExemptions,
} from './exemption.js'

export type { DriftStanding, RangeShape, RangeShapeReading, RegistryFacts, VersionDrift } from './version-drift.js'
export { judgeRangeShape, judgeVersionDrift } from './version-drift.js'

export type {
  DeclaredRow,
  FiberPhase,
  InventoryEntry,
  InventoryMeta,
  InventoryPreset,
  InventoryPresetRow,
  InventorySnapshot,
  InventoryTransport,
  InventoryVerdictInput,
  PhaseConclusion,
} from './inventory.js'
export {
  FIBER_PHASES,
  INVENTORY_TRANSPORTS,
  compareInventory,
  evidenceMethod,
  findPresetDivergence,
  indexRuntimeIds,
  isFiberPhase,
  parseInventorySnapshot,
  phaseConclusion,
  resolveRuntimeId,
  verdictsFromInventory,
} from './inventory.js'

export type { Locale, MessageCatalog } from './messages.js'
export { catalogFor, format } from './messages.js'

export type {
  LocalPrior,
  OutcomeArch,
  OutcomeKey,
  OutcomeLineRejection,
  OutcomeLineResult,
  OutcomeOs,
  OutcomeProbe,
  OutcomeProfileKind,
  OutcomeRecord,
  OutcomeRejection,
  OutcomeSanitizeResult,
  OutcomeSource,
  TimingBucket,
} from './outcome.js'
export {
  EVIDENCE_TIER_VALUES,
  MAX_OUTCOME_BYTES,
  OUTCOME_ARCH_VALUES,
  OUTCOME_OS_VALUES,
  OUTCOME_PROFILE_KIND_VALUES,
  OUTCOME_SOURCE_VALUES,
  TIMING_BUCKET_VALUES,
  assertOutcomeLine,
  computeLocalPrior,
  isCompleteOutcomeKey,
  outcomeKeyOf,
  sameOutcomeKey,
  sanitizeOutcome,
} from './outcome.js'

export type { CapabilityDiff, CapabilityMeta, CapabilitySnapshot, CapabilityTool } from './capabilities.js'
export { diffCapabilities, parseCapabilitySnapshot } from './capabilities.js'

export type {
  UpgradeBucket,
  UpgradeBundleInput,
  UpgradeCause,
  UpgradeCounts,
  UpgradeImpact,
  UpgradeImpactInput,
  UpgradeJudgement,
  UpgradeRegistryFact,
  UpgradeRegistryFailure,
  UpgradeRegistryNote,
  UpgradeRelation,
  UpgradeStanding,
  UpgradeStandingStatus,
  UpgradeUnit,
} from './upgrade.js'
export {
  UPGRADE_BUCKETS,
  compareUnits,
  hasNewDenials,
  judgeUpgradeImpact,
  registryFactFor,
  renderUpgradeImpact,
  upgradeTargetProblem,
} from './upgrade.js'
export { MAX_UNITS_PER_BUCKET, renderUpgradeCard, scrubCardText, type UpgradeCardOptions } from './upgrade-card.js'
export {
  DIST_TAG_PACKAGE,
  DIST_TAG_TARGETS,
  distTagTargetOf,
  resolveDistTagTarget,
  type DistTagResolution,
  type DistTagTarget,
} from './upgrade-target.js'

export { redactEnv, redactPath, redactVerdict } from './redact.js'
