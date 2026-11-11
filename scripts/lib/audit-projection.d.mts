/**
 * Types for `scripts/lib/audit-projection.mjs` (R94).
 *
 * WHY A HAND-WRITTEN DECLARATION: the recorder is plain `.mjs` so it runs without a build, while
 * `tsconfig.tests.json` type-checks the test that pins the projection. Without it the import would
 * collapse to `any` and the one distinction that matters — `surface: false` versus "not stated" —
 * would stop being checked at the call site.
 */

export interface DuplicateCopyLike {
  scope: string
  path: string
  version: string | null
}

export interface DuplicateLike {
  name: string
  kind: string
  surface?: boolean
  copies: readonly DuplicateCopyLike[]
}

export interface ProjectedDuplicate {
  name: string
  kind: string
  surface: boolean | null
  copies: DuplicateCopyLike[]
}

export interface DuplicateSummary {
  groups: number
  findings: number
  downgraded: number
  unstated_surface: number
  different_versions: number
}

export function projectDuplicate(duplicate: Partial<DuplicateLike>): ProjectedDuplicate

export function summariseDuplicates(input: { groups: readonly DuplicateLike[], findings: number }): DuplicateSummary
