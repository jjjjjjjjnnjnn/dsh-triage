/**
 * Types for `scripts/lib/dist-tags.mjs`, which the release unit test imports directly.
 *
 * WHY A HAND-WRITTEN DECLARATION: gate/record scripts are plain `.mjs` (zero dependencies, runnable
 * without a build), while `tsconfig.tests.json` type-checks every test. Saying `any` here would hide the
 * shape that matters — `latest` may be `null` per package, and `problems` is what the release reads.
 */

export const PUBLISHED_PACKAGES: string[]

export interface PackumentTags {
  /** Optional on purpose: a nameless packument is a defect the verdict must report, not a type error. */
  name?: string
  unreachable?: boolean
  distTags?: Record<string, string> | null
  versions?: string[] | null
}

export interface DistTagProblem {
  name: string
  tag: string
  version: string
}

export interface DistTagVerdict {
  ok: boolean
  expectedVersion: string
  latest: Record<string, string | null>
  unreachable: string[]
  dangling: DistTagProblem[]
  extraTags: DistTagProblem[]
  problems: string[]
  tagsAgree: boolean
  detail: string
}

export function judgeDistTags(input: { expectedVersion: string, packages: PackumentTags[] }): DistTagVerdict
