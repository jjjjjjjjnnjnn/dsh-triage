/**
 * Types for `scripts/lib/reply-spec.mjs` (R94).
 *
 * WHY A HAND-WRITTEN DECLARATION: the recorder is plain `.mjs`, while the test that pins this
 * parsing is type-checked. Without it the import collapses to `any` and the one distinction that
 * matters — a refused spec versus a parsed one — would stop being checked at the call site.
 */

export type ReplySpec =
  | { ok: true; owner: string; repo: string; number: number; commentId: string }
  | { ok: false; detail: string }

export function parseReplySpec(declared: string, url: string): ReplySpec
