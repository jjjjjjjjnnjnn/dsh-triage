/**
 * Types for `scripts/lib/next-release.mjs`, which the watcher test imports directly.
 *
 * WHY A HAND-WRITTEN DECLARATION: gate/record scripts are plain `.mjs` (zero dependencies, runnable
 * without a build), while `tsconfig.tests.json` type-checks every test. The one distinction this check
 * turns on is `unmeasured` vs `unchanged`, so `current.ok` must not collapse to `any`.
 */

export const NEXT_RELEASE_STATES: string[]

export interface PreviousObservation {
  version: string
  at: string | null
}

export interface CurrentReading {
  ok: boolean
  version?: string | null
  detail?: string | null
}

export interface NextChangeVerdict {
  state: 'baseline' | 'changed' | 'unchanged' | 'unmeasured'
  changed: boolean
  writesArtifact: boolean
  from: string | null
  to: string | null
  detail: string
}

export function judgeNextChange(input: {
  previous: PreviousObservation | null,
  current: CurrentReading,
}): NextChangeVerdict

/**
 * Picks the most recent observation a watcher run can see (R71). The watcher needs this to read a
 * baseline from a directory other than its `--out` — otherwise a CI run, which starts from a fresh
 * checkout, would report `baseline` on every run and could never report `changed`.
 *
 * Entries with an unparseable `at` are ignored, not treated as newest or oldest.
 */
export function pickNewestObservation(candidates: unknown): PreviousObservation | null
