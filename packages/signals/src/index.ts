/**
 * Public surface of `@dsh-triage/signals`.
 *
 * Every adapter is (a) network-injected, (b) tier-tagged, (c) explicitly
 * attributable. No adapter is allowed to produce a `measured-local` tier: only
 * `packages/probe` can, because only probe runs on this machine.
 */

export type { FetchLike, NpmAdapterOptions, NpmPackument, NpmVersionManifest, SignalError, SignalErrorCode } from './npm.js'
export { encodePackageName, fetchPackument, npmEvidence, parsePackument } from './npm.js'

export type { DshSoOptions, InstallVerification, InstallVerificationState } from './dshso.js'
export { dshSoEvidence, fetchInstallVerification, projectInstallVerification } from './dshso.js'

export type { DiscoverOptions, LocalArtifact, LocalArtifactKind } from './local.js'
export { discoverLocalArtifacts } from './local.js'
