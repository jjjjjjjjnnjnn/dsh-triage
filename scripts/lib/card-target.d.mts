/**
 * Types for `scripts/lib/card-target.mjs` (R94).
 *
 * WHY A HAND-WRITTEN DECLARATION: the recorders are plain `.mjs` so they run without a build, while
 * `tsconfig.tests.json` type-checks the test that pins this judgement. Without this the import would
 * collapse to `any`, and the one thing this judgement must never do — pass a title that names a
 * different version — would no longer be type-checked at the call site.
 */

export interface CardTitleVerdict {
  ok: boolean
  expected: string
  detail: string
}

export function judgeCardTitle(input: {
  title: string,
  keyword: string,
  resolved: string | null,
}): CardTitleVerdict
