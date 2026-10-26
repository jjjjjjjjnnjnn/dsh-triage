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
  /** Why this remediation is suggested. Rendered verbatim. */
  readonly note: string
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
