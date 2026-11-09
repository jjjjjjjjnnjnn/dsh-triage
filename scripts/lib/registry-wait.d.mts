/**
 * Types for `scripts/lib/registry-wait.mjs`, which the retry-policy unit test imports directly.
 *
 * WHY A HAND-WRITTEN DECLARATION: gate/record scripts are plain `.mjs` (zero dependencies, runnable
 * without a build), while `tsconfig.tests.json` type-checks every test — and an untyped boolean here
 * is exactly where "retry the wrong thing" would hide.
 */

export const PROPAGATION_PATTERNS: RegExp[]
export const DEFAULT_REGISTRY_WAIT_MS: number
export const RETRY_INTERVAL_MS: number
export const MAX_ATTEMPTS: number

export interface InstallAttempt {
  code: number | null
  output?: string | null
}

export interface RetryState extends InstallAttempt {
  elapsedMs: number
  budgetMs: number
  attempt: number
}

export function looksLikePropagationLag(attempt: InstallAttempt | null | undefined): boolean

export function shouldRetryInstall(state: RetryState | null | undefined): boolean

/** R91: the read side had no wait of its own; this is the decision it was missing. */
export interface VisibilityState {
  visible: boolean
  elapsedMs: number
  budgetMs: number
  attempt: number
}

export function shouldRetryVisibility(state: VisibilityState | null | undefined): boolean

export function describeVisibilityWait(state: {
  attempts: number
  waitedMs: number
  settled?: boolean
}): string

export function describePropagationWait(state: {
  attempts: number
  waitedMs: number
  settled?: boolean
}): string
