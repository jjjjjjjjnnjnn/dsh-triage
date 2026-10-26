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
export { evaluateAdmission, evaluateRange, isAdmissionPeer, readDshPeerRequirements, readEnginesDsh } from './admission.js'

export type { LoadEnvInput, ProfileManifest } from './env.js'
export { defaultDshHome, loadEnv, parseProfileManifest, profileDirOf, resolveProfileDir } from './env.js'

export type { EntryClaim, EntryCollision } from './ledger.js'
export { extractEntryClaims, findEntryIdCollisions, groupClaimsBySource, parsePatchYaml } from './ledger.js'

export type { AdmissionVerdictInput, CollisionVerdictInput } from './verdict.js'
export {
  conclusionRank,
  mergeVerdicts,
  renderVerdict,
  verdictFromAdmission,
  verdictsFromCollisions,
} from './verdict.js'

export type { Locale, MessageCatalog } from './messages.js'
export { catalogFor, format } from './messages.js'
