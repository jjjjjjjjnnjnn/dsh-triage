/**
 * Shared vocabulary for the judgment layer.
 *
 * INVARIANTS (do not break):
 * - Every conclusion value is one of {@link CONCLUSION_VALUES}; never invent a fifth.
 * - Every {@link Verdict} carries at least one {@link Evidence}; `unknown` requires
 *   `missingEvidence` to be non-empty (see `verdict.ts`).
 * - No type in this module may reference `fs`, network clients, or DSH internals:
 *   this file must stay importable in a browser bundle.
 */

/** Where a piece of evidence came from, ordered from weakest to strongest. */
export type EvidenceTier =
  | 'inferred'
  | 'declared'
  | 'scanned'
  | 'measured-registry'
  | 'measured-local'

/** Single source of truth for the four possible conclusions. */
export const CONCLUSION_VALUES = ['go', 'risky', 'blocked', 'unknown'] as const

/** `go` = likely fine, `risky` = installable but with known caveats, `blocked` = will not work as-is, `unknown` = not enough evidence. */
export type Conclusion = (typeof CONCLUSION_VALUES)[number]

/** Severity of a single reason. `block` forces conclusion `blocked`. */
export type ReasonSeverity = 'block' | 'warn' | 'info'

/** Evidence backing a reason. `at` is an ISO timestamp supplied by the caller, never `Date.now()` inside the engine. */
export interface Evidence {
  readonly id: string
  readonly tier: EvidenceTier
  /** Human-readable origin, e.g. `npm:dsh-cost-meter@1.9.41` or `local:/Users/x/.dsh`. */
  readonly source: string
  /** How the fact was obtained, e.g. `declared-range`, `profile-scan`, `boot-probe`. */
  readonly method: string
  /** ISO-8601 timestamp of when the fact was obtained. */
  readonly at: string
  readonly detail?: string
}

/** Actionable next step. `kind` is a closed set so UIs never have to parse prose. */
export type RemediationKind =
  | 'pin-version'
  | 'upgrade-dsh'
  | 'downgrade-dsh'
  | 'allow-version'
  | 'disable-entry'
  | 'remove-plugin'
  | 'probe'
  | 'report'

export interface Remediation {
  readonly kind: RemediationKind
  /** Exact command the user can copy, when one exists. */
  readonly command?: string
  /** Machine-stable English summary (also the fallback when no catalogue id is set). */
  readonly note: string
  /** Catalogue id for localized rendering; required for user-facing surfaces. */
  readonly messageId?: string
  /** Interpolation values for {@link messageId}. */
  readonly params?: Readonly<Record<string, string | number>>
}

export interface Reason {
  /** Stable machine code, e.g. `admission-denied-engines`. Used for tests and i18n lookup. */
  readonly code: string
  readonly severity: ReasonSeverity
  /** Stable template id resolved by the renderer; never put user-facing prose here. */
  readonly messageId: string
  /** Values interpolated into the localized template. */
  readonly params?: Readonly<Record<string, string | number>>
}

/**
 * Where the runtime version came from (M11, extended by M14).
 *
 * `kernel-asar` = read out of the desktop shell's `app.asar` (R101/M14): the Host loads that copy, so it
 * is the runtime that is actually executing even when nothing Electron is in this process. `kernel` =
 * resolved from the package the running Host was started from. `inferred` = read from a profile or
 * shared `node_modules` copy, which may be a stale cache. `unresolved` = nothing readable, so `dsh` is
 * `null`.
 */
export type DshSource = 'kernel-asar' | 'kernel' | 'inferred' | 'unresolved'

/**
 * What the asar probe saw (M14-C4/C5). Present only when a probe ran; a hand-built fingerprint has no
 * `kernelProbe` and renders exactly as before.
 */
export interface KernelProbe {
  /** `read` = a manifest answered; `absent` = no archive at that path; `unreadable` = present but broken. */
  readonly state: 'read' | 'absent' | 'unreadable'
  readonly path: string | null
  readonly detail: string | null
  /**
   * `desktopVersion` from the shell's own `runtime.json` under `dsh-runtimes`. Recorded but never used as
   * a version source (M14-C5).
   */
  readonly runtimeJsonVersion: string | null
  /** True when the runtime manifest and the archive disagree — both are kept, neither is chosen. */
  readonly disagrees: boolean
}

/** Environment the verdict was computed for. Answers "on whose machine?". */
export interface EnvFingerprint {
  /** DSH runtime version, e.g. `0.2.1-rc.2`; `null` when it cannot be determined. */
  readonly dsh: string | null
  readonly node: string
  readonly platform: string
  readonly arch: string
  /** Profile name, e.g. `web`. */
  readonly profile: string
  /** Absolute profile directory this fingerprint was read from. */
  readonly profileDir: string
  /** Bundle layer order as declared in the profile manifest. */
  readonly bundles: readonly string[]
  /** Resolved installed versions for `@deepseek-ai/*` packages, sorted by name. */
  readonly installed: readonly InstalledPackage[]
  /**
   * Provenance of `dsh` (M11). Optional so hand-built fingerprints keep working; an absent value
   * means "not stated", which renders exactly like the old output.
   */
  readonly dshSource?: DshSource
  /**
   * `node_modules` directories that belong to the running kernel, in resolution order (M11).
   * Kernel-provided bundles live here, not under the profile; see `docs/specs/M11-kernel-resolution.md`.
   */
  readonly kernelRoots?: readonly string[]
  /**
   * How the kernel probe went (M14). Absent on hand-built fingerprints, which keeps every existing
   * caller byte-identical.
   */
  readonly kernelProbe?: KernelProbe
  /**
   * `@deepseek-ai/*` manifests read out of the same archive the version came from (M14-C3).
   *
   * Present ONLY when `dshSource === 'kernel-asar'`: the spec forbids judging rows against a version from
   * one source and manifests from another (RECON §4: that mix reported 125 false denials). A `Map` is not
   * JSON, so callers must treat this as an in-memory hand-off, not something to serialize.
   */
  readonly kernelManifests?: ReadonlyMap<string, Record<string, unknown>>
}

export interface InstalledPackage {
  readonly name: string
  readonly version: string | null
}

export interface Verdict {
  readonly schemaVersion: 1
  readonly subject: VerdictSubject
  readonly env: EnvFingerprint
  readonly conclusion: Conclusion
  readonly confidence: Confidence
  readonly reasons: readonly Reason[]
  readonly evidence: readonly Evidence[]
  readonly remediation: readonly Remediation[]
  /** Non-empty only when `conclusion === 'unknown'`: what evidence would resolve it. */
  readonly missingEvidence: readonly string[]
  /** ISO-8601 timestamp supplied by the caller. */
  readonly generatedAt: string
}

export interface VerdictSubject {
  readonly name: string
  readonly version: string | null
  readonly kind: 'plugin' | 'entry' | 'set'
}

/**
 * Confidence is a coarse bucketed explanation, not a fake precise score.
 * `basis` names the strongest evidence tier the verdict actually rests on.
 */
export interface Confidence {
  readonly level: 'low' | 'medium' | 'high'
  readonly basis: EvidenceTier
}
