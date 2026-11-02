/**
 * Types for `scripts/lib/discussion-state.mjs`, which the reply-gate test and
 * `scripts/record_discussion_state.mjs` both import.
 *
 * WHY HAND-WRITTEN: gate/record scripts are plain `.mjs` (runnable without a build), while
 * `tsconfig.tests.json` type-checks every test. Without this declaration `judgeReplyGate` returns `any`
 * and a test could assert against a typo'd state name.
 */

export const REPLY_GATES: string[]

export type ReplyGate = 'open' | 'answered' | 'closed' | 'unreadable'

export function judgeReplyGate(thread: unknown): ReplyGate
