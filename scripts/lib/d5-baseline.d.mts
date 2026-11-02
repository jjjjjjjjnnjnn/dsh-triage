/**
 * Types for `scripts/lib/d5-baseline.mjs` (R72).
 *
 * WHY HAND-WRITTEN: recorders are plain `.mjs`, while `tsconfig.tests.json` type-checks the tests. The whole
 * point of this module is that `kind` has exactly three values, so a test must not be able to compare it
 * against `any`.
 */

export const BASELINE_KINDS: string[]

export type BaselineKind = 'measured' | 'recompute' | 'unproven'

export interface PickedBaseline {
  file: string
  kind: BaselineKind
  at: string | null
}

export function pickBaselineArtifact(entries: unknown): PickedBaseline | null
