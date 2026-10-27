/**
 * Duplicate installed copies (M2-a): the same package name resolved at two
 * different versions under one profile.
 *
 * WHY THIS EXISTS: Maven's `dependencyConvergence` rule, `pip check` and
 * `npm explain` all converge on the same insight — "the package is installed" is
 * not the question; "one name, two physical copies, two identities" is. The
 * source-level reply in discussion #10364 describes the silent variant for DSH:
 * a version-compatible old copy passes every admission check, the host boots, and
 * then every tool call dies because two copies evaluated the scheduler module
 * separately (`TOOL_RUNTIME_SCHEDULER` identity split).
 *
 * The report in #10364 is the fatal variant (the copy is old enough to be denied,
 * which we already catch). This module covers the silent variant, and it borrows
 * Maven's presentation: a duplicate is only actionable when it names **both**
 * paths and versions.
 *
 * Pure: the scan lives in `packages/plugin/src/load.ts`, the judgement lives here.
 */

import { compare } from 'semver'
import type { EnvFingerprint, Reason, Remediation, Verdict } from './types.js'

export interface CopyLocation {
  /** Where the copy sits, e.g. `profiles/<profile>/node_modules/x`. */
  readonly path: string
  readonly version: string | null
  /** `profile` = the profile's own node_modules, `shared` = profiles/node_modules, `nested` = inside another package. */
  readonly scope: 'profile' | 'shared' | 'nested'
  /** True when the copy is a symlink/junction (`link:`, pnpm isolated linker). */
  readonly linked?: boolean
}

export interface DuplicateCopy {
  readonly name: string
  readonly copies: readonly CopyLocation[]
  /** `different-versions` is the dangerous one; identical versions are the normal pnpm picture. */
  readonly kind: 'different-versions' | 'same-version'
}

export interface DuplicateCopyInput {
  readonly env: EnvFingerprint
  readonly duplicates: readonly DuplicateCopy[]
  readonly generatedAt: string
}

/**
 * Turn duplicate copies into verdicts.
 *
 * Only **different versions** produce a verdict: pnpm materialises the same
 * version in both roots by hard link, which is not a finding and would drown the
 * signal. Same-version duplicates are dropped here rather than in the scanner so
 * the rule is testable.
 */
export function verdictsFromDuplicateCopies(input: DuplicateCopyInput): readonly Verdict[] {
  const out: Verdict[] = []
  for (const duplicate of [...input.duplicates].sort((left, right) => left.name.localeCompare(right.name))) {
    // Never trust the caller's classification: recompute from the copies. A single
    // copy is not a duplicate, and one version in two roots is the normal pnpm
    // picture (hard link), so neither may become a finding. An unknown version is
    // not evidence of a *different* version either.
    if (duplicate.copies.length < 2) continue
    const known = [
      ...new Set(duplicate.copies.map((copy) => copy.version).filter((version): version is string => version !== null)),
    ]
    if (known.length < 2) continue
    const versions = [...known].sort(byVersion)
    const unknownCopies = duplicate.copies.filter((copy) => copy.version === null).length
    const reason: Reason = {
      code: 'collision-duplicate-copy',
      severity: 'warn',
      messageId: 'collision.duplicate-copy',
      params: {
        name: duplicate.name,
        versions: versions.join(' vs '),
        paths: duplicate.copies.map((copy) => `${copy.scope}:${copy.path}`).join(' | '),
      },
    }
    const remediation: Remediation[] = [
      {
        kind: 'pin-version',
        messageId: 'remediation.duplicate-copy',
        params: { name: duplicate.name, versions: versions.join(' vs ') },
        note: `keep one copy of "${duplicate.name}" in the profile (the copies are at ${duplicate.copies
          .map((copy) => `${copy.scope}:${copy.version ?? 'unknown'}`)
          .join(', ')}); a delegating plugin should declare it under peerDependencies instead of dependencies${unknownCopies > 0 ? `; ${unknownCopies} copy has no readable version, so the pair is reported from the known ones only` : ''}`,
      },
      {
        kind: 'report',
        messageId: 'remediation.report',
        note: 'two physical copies of one module can evaluate its module-level state twice (identity split), which fails only at call time',
      },
    ]
    out.push({
      schemaVersion: 1,
      subject: { name: duplicate.name, version: versions[versions.length - 1] ?? null, kind: 'plugin' },
      env: input.env,
      // `risky`, not `blocked`: the host may boot and work for a while. Claiming
      // blocked here would be a false positive on the common pnpm layout.
      conclusion: 'risky',
      confidence: { level: 'high', basis: 'scanned' },
      reasons: [reason],
      evidence: duplicate.copies.map((copy, index) => ({
        id: `copy-${index + 1}`,
        tier: 'scanned' as const,
        source: copy.path,
        method: 'node_modules-scan',
        at: input.generatedAt,
        detail: `${copy.scope} copy @ ${copy.version ?? 'unknown'}`,
      })),
      remediation,
      missingEvidence: [],
      generatedAt: input.generatedAt,
    })
  }
  return out
}

/** Numeric-semver ordering so `0.10.0` sorts above `0.9.0`; unparsable tags fall back to string order. */
function byVersion(left: string, right: string): number {
  try {
    return compare(left, right)
  } catch {
    return left.localeCompare(right)
  }
}
