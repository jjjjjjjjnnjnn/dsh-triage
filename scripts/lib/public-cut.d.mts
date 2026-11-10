/**
 * Types for `scripts/lib/public-cut.mjs`.
 *
 * WHY HAND-WRITTEN: the judgement is plain `.mjs` (zero dependencies, so the gate can always run) while the
 * test that pins it is type-checked. Without this file the test import resolves to `any` and stops being
 * checked — and the one thing worth pinning here is that "could not read" and "does not match" are different
 * answers, which is the difference between a verdict and a typo.
 */

export type PublicCutInput = {
  headSubtreeTree?: unknown
  head?: unknown
  publicTree?: unknown
  publicHead?: unknown
  matchingCommit?: unknown
  commitsBehind?: unknown
  ref?: unknown
  rootTree?: unknown
}

export type PublicCutStatus = 'in-sync' | 'behind' | 'drift' | 'unmeasured'

export type PublicCutVerdict = {
  status: PublicCutStatus
  problems: string[]
}

/**
 * `in-sync` when the public tree is HEAD's subtree; `behind` when it is an older container commit's subtree
 * (the ordinary state between a round's commits and its push); `drift` when it matches no container commit
 * (including the wrong push that carries the container ROOT); `unmeasured` when a git object id could not be
 * read — never `in-sync`.
 */
export declare function judgePublicCut(input: PublicCutInput): PublicCutVerdict

export declare function isObjectId(value: unknown): boolean
