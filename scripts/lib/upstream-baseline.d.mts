/**
 * Types for `scripts/lib/upstream-baseline.mjs` (R99).
 *
 * WHY A HAND-WRITTEN DECLARATION: the library is plain `.mjs` so recorders run without a build while
 * `tsconfig.tests.json` type-checks the test that pins this judgement. Without it the import would be
 * `any`, and the one thing this judgement must never do — pass a line that names a different version —
 * would stop being checked at the call site.
 */

export interface TagClaims {
  latest: string | null
  next: string | null
}

export interface TagClaimVerdict {
  ok: boolean
  claims: TagClaims
  problems: string[]
  detail: string
}

export function readTagClaims(line: unknown): TagClaims

export function judgeTagClaims(input: {
  line: unknown,
  expected: { latest: string, next: string },
}): TagClaimVerdict
