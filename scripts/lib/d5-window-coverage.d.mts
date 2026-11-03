/**
 * Types for `scripts/lib/d5-window-coverage.mjs` (R76).
 *
 * WHY HAND-WRITTEN: the recorder and the lib are plain `.mjs`, while `tsconfig.tests.json` type-checks the
 * tests. `state` and `verdict` are the whole contract (a `collect-now` read as `lost` would send someone to
 * re-collect a day that is still reachable), so a test must not be able to compare them against `any`.
 */

export const ROLLING_WINDOW_DAYS: number

export const DEFAULT_LAG_DAYS: number

export type DayState = 'collect-now' | 'upcoming' | 'lost'

export type CoverageVerdict = 'complete' | 'collect-now' | 'not-yet' | 'lost'

export interface MissingDay {
  day: string
  first_collectible: string
  last_collectible: string
  state: DayState
}

export interface CoverageCounts {
  covered: number
  missing: number
  collectible_now: number
  upcoming: number
  lost: number
}

export interface WindowCoverageResult {
  ok: boolean
  reason?: string
  window?: { from: string, to: string, days: number }
  lag_days?: number
  today?: string
  covered?: string[]
  missing?: MissingDay[]
  used?: { file: string, from: string, to: string, days_in_window: number }[]
  ignored?: { file: string, reason: string }[]
  counts?: CoverageCounts
  next_run_by?: string | null
  days_until_next_run?: number | null
  verdict?: CoverageVerdict
  urgent?: boolean
}

export function dayToNumber(text: unknown): number | null

export function numberToDay(day: number): string

export function judgeWindowCoverage(input: unknown): WindowCoverageResult
