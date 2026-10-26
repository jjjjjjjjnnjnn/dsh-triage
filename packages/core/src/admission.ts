/**
 * Mirrors DeepSeek Harness admission semantics.
 *
 * SOURCE OF TRUTH (do not "improve" these rules from memory):
 * `@deepseek-ai/dsh-app-boot@0.2.1-rc.2/README.md` — "Before a profile imports a
 * plugin, DSH checks its declared DSH requirement against the single runtime
 * version returned by `getDshRuntimeVersion()`":
 *
 *  1. `engines.dsh` present  -> that range alone decides, peers are ignored.
 *  2. otherwise              -> every peer range on `@deepseek-ai/dsh` and
 *                               `@deepseek-ai/dsh-*` must match (AND).
 *  3. prereleases participate in range matching.
 *  4. empty / invalid ranges (and `workspace:` in `engines.dsh`) are incompatible.
 *  5. no declaration at all  -> no constraint.
 *
 * Parity is locked by `data/gold/admission-cases.json` and enforced by
 * `scripts/gate_admission_parity.mjs`. Change the rules there first.
 */

import { satisfies, validRange } from 'semver'

/** Why a declared range did not hold. Stable codes, safe to switch on. */
export type RequirementFailure =
  | 'empty-range'
  | 'invalid-range'
  | 'workspace-protocol'
  | 'unsatisfied'
  | 'malformed-manifest'

export interface Requirement {
  /** `dsh` for `engines.dsh`, otherwise the peer package name. */
  readonly key: string
  readonly range: string
  readonly satisfied: boolean
  readonly failure: RequirementFailure | null
}

export type AdmissionStatus = 'admitted' | 'denied' | 'unconstrained' | 'indeterminate'

export type AdmissionMode = 'engines' | 'peers' | 'none'

export interface AdmissionResult {
  readonly status: AdmissionStatus
  readonly mode: AdmissionMode
  /** Every requirement that was actually evaluated (empty for `none`). */
  readonly requirements: readonly Requirement[]
  /** Subset of `requirements` with `satisfied === false`. */
  readonly unmet: readonly Requirement[]
  /** Set when the runtime version is unknown, making admission unknowable. */
  readonly indeterminateReason: string | null
}

const DSH_PEER_PREFIX = '@deepseek-ai/dsh-'
const DSH_PEER_EXACT = '@deepseek-ai/dsh'

/** True for the peer package names that participate in admission. */
export function isAdmissionPeer(key: string): boolean {
  return key === DSH_PEER_EXACT || key.startsWith(DSH_PEER_PREFIX)
}

interface EvaluatedRange {
  readonly satisfied: boolean
  readonly failure: RequirementFailure | null
}

/**
 * Evaluate one declared range against one runtime version.
 * Never throws: invalid input becomes a `satisfied: false` verdict.
 */
export function evaluateRange(range: unknown, runtime: string): EvaluatedRange {
  if (typeof range !== 'string') {
    return { satisfied: false, failure: 'malformed-manifest' }
  }
  const trimmed = range.trim()
  // semver treats '' as '*', but DSH treats an empty requirement as incompatible.
  if (trimmed === '') {
    return { satisfied: false, failure: 'empty-range' }
  }
  if (trimmed.startsWith('workspace:')) {
    return { satisfied: false, failure: 'workspace-protocol' }
  }
  if (validRange(trimmed, { includePrerelease: true }) === null) {
    return { satisfied: false, failure: 'invalid-range' }
  }
  return { satisfied: satisfies(runtime, trimmed, { includePrerelease: true }), failure: null }
}

interface EnginesReading {
  readonly kind: 'absent' | 'malformed' | 'range'
  readonly value: string
}

/** Read `engines.dsh` with the same tolerance as the upstream manifest reader. */
export function readEnginesDsh(manifest: unknown): EnginesReading {
  if (manifest === null || typeof manifest !== 'object') {
    return { kind: 'malformed', value: '' }
  }
  const engines = (manifest as { engines?: unknown }).engines
  if (engines === undefined) {
    return { kind: 'absent', value: '' }
  }
  if (engines === null || typeof engines !== 'object') {
    return { kind: 'malformed', value: '' }
  }
  const dsh = (engines as { dsh?: unknown }).dsh
  if (dsh === undefined) {
    return { kind: 'absent', value: '' }
  }
  if (typeof dsh !== 'string') {
    return { kind: 'malformed', value: '' }
  }
  return { kind: 'range', value: dsh }
}

/** Peer package names that participate in admission, in stable key order. */
function peerRequirements(manifest: unknown): readonly { key: string; range: string }[] {
  if (manifest === null || typeof manifest !== 'object') {
    return []
  }
  const peers = (manifest as { peerDependencies?: unknown }).peerDependencies
  if (peers === null || typeof peers !== 'object') {
    return []
  }
  return Object.entries(peers as Record<string, unknown>)
    .filter(([key]) => isAdmissionPeer(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, range: typeof value === 'string' ? value : String(value) }))
}

/**
 * Compute the admission decision for one plugin manifest on one runtime.
 *
 * Deterministic and side-effect free: same inputs always produce the same output,
 * with requirements in stable order so stdout can be diffed.
 */
export function evaluateAdmission(manifest: unknown, runtime: string | null): AdmissionResult {
  if (runtime === null || runtime.trim() === '') {
    return {
      status: 'indeterminate',
      mode: 'none',
      requirements: [],
      unmet: [],
      indeterminateReason: 'runtime-version-unknown',
    }
  }

  const engines = readEnginesDsh(manifest)

  if (engines.kind === 'malformed') {
    const requirement: Requirement = {
      key: 'dsh',
      range: '<malformed>',
      satisfied: false,
      failure: 'malformed-manifest',
    }
    return {
      status: 'denied',
      mode: 'engines',
      requirements: [requirement],
      unmet: [requirement],
      indeterminateReason: null,
    }
  }

  if (engines.kind === 'range') {
    const evaluated = evaluateRange(engines.value, runtime)
    const requirement: Requirement = {
      key: 'dsh',
      range: engines.value,
      satisfied: evaluated.satisfied,
      failure: evaluated.failure,
    }
    return {
      status: evaluated.satisfied ? 'admitted' : 'denied',
      mode: 'engines',
      requirements: [requirement],
      unmet: evaluated.satisfied ? [] : [requirement],
      indeterminateReason: null,
    }
  }

  const peerKeys = peerRequirements(manifest)
  if (peerKeys.length === 0) {
    return {
      status: 'unconstrained',
      mode: 'none',
      requirements: [],
      unmet: [],
      indeterminateReason: null,
    }
  }

  const requirements = peerKeys.map(({ key, range }): Requirement => {
    const evaluated = evaluateRange(range, runtime)
    return { key, range, satisfied: evaluated.satisfied, failure: evaluated.failure }
  })
  const unmet = requirements.filter((requirement) => !requirement.satisfied)
  return {
    status: unmet.length === 0 ? 'admitted' : 'denied',
    mode: 'peers',
    requirements,
    unmet,
    indeterminateReason: null,
  }
}
