/**
 * Types for `scripts/lib/posting.mjs`, which the copy-checker unit test imports directly.
 *
 * WHY A HAND-WRITTEN DECLARATION: the rule lives in plain `.mjs` (runnable without a build) while
 * `tsconfig.tests.json` type-checks the tests. `problems` is the output the release relies on, so it must
 * not collapse to `any`.
 */

export const ISO_INSTANT: RegExp

export interface PostingPlatform {
  id: string
  channel: RegExp
  match: RegExp
}

export const POSTING_PLATFORMS: PostingPlatform[]

export function judgePosting(input: {
  channel?: unknown,
  url?: unknown,
  postedOn?: unknown,
  now: string | Date,
}): { ok: boolean, platform: string | null, problems: string[] }
