/**
 * Result type used by every fallible boundary in this package.
 *
 * WHY: core functions that touch the filesystem must never throw at call sites —
 * AI maintainers and the CLI both benefit from exhaustive handling. Pure
 * predicates return plain values instead; the split is documented in
 * `docs/08-conventions.md` §4.
 */

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

/** Stable error codes: never rename without updating `messages.ts` and tests. */
export type CoreErrorCode =
  | 'profile-not-found'
  | 'manifest-invalid'
  | 'manifest-missing'
  | 'patch-invalid'
  | 'inventory-invalid'
  | 'runtime-version-unknown'
  | 'io-error'

export interface CoreError {
  readonly code: CoreErrorCode
  /** Diagnostic detail for logs; never shown to end users as-is. */
  readonly detail: string
  /** Optional path that caused the failure. */
  readonly path?: string
}
