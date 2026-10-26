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

export type { EntryClaim, EntryCollision, RowTarget } from './ledger.js'
export { extractEntryClaims, findEntryIdCollisions, groupClaimsBySource, parsePatchYaml, rowTargets } from './ledger.js'

export type { AdmissionVerdictInput, CollisionVerdictInput, RowAdmissionInput, RowDeclaration } from './verdict.js'
export {
  conclusionRank,
  mergeVerdicts,
  renderVerdict,
  verdictFromAdmission,
  verdictsFromCollisions,
  verdictsFromRowAdmission,
} from './verdict.js'

export type {
  DeclaredRow,
  FiberPhase,
  InventoryEntry,
  InventoryMeta,
  InventorySnapshot,
  InventoryVerdictInput,
  PhaseConclusion,
} from './inventory.js'
export {
  FIBER_PHASES,
  compareInventory,
  isFiberPhase,
  parseInventorySnapshot,
  phaseConclusion,
  verdictsFromInventory,
} from './inventory.js'

export type { Locale, MessageCatalog } from './messages.js'
export { catalogFor, format } from './messages.js'

export { redactEnv, redactPath, redactVerdict } from './redact.js'
