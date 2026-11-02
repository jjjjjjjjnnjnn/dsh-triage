/** Types for `scripts/lib/d5-score.mjs`. */

export declare const D5_THRESHOLDS: Readonly<{ reactions: number; external_references: number; weekly_downloads: number }>
export declare const D5_WINDOW_DAYS: number

export type ReadingState = 'measured' | 'unreadable'
export type D5Verdict = 'pass' | 'fail' | 'pending' | 'unmeasurable' | 'no-post'

export interface D5Window {
  posted_on: string | null
  ends_at: string | null
  closed: boolean
  days_left: number | null
}

export interface D5Number {
  value: number | null
  state: ReadingState
  threshold: number
  met: boolean
  shape?: string
  entries?: D5ReferenceEntry[]
}

export interface D5ReferenceEntry {
  url: string
  author: string
  kind?: string
  title?: string | null
}

export interface D5Evidence {
  verdict: D5Verdict
  counts_as_demand: boolean
  window: D5Window
  numbers: {
    reactions: D5Number
    external_references: D5Number
    weekly_downloads: D5Number
  }
  post: { url: string; number: number; author: string } | null
  /**
   * Why `unmeasurable` (R70): `window-start-unreadable` when a post exists but its date cannot be read,
   * `number-unreadable` when one of the three sources failed. Null for every other verdict.
   */
  reason: 'window-start-unreadable' | 'number-unreadable' | null
}

export declare function windowOf(input: { postedOn?: unknown; now?: unknown }): D5Window

export declare function judgeD5(input: {
  post?: { url?: unknown; number?: unknown; author?: unknown } | null
  postedOn?: unknown
  now?: unknown
  readings?: {
    reactions?: { value?: unknown; state?: unknown }
    externalReferences?: { value?: unknown; entries?: unknown[]; state?: unknown }
    weeklyDownloads?: { value?: unknown; shape?: unknown; state?: unknown }
  }
}): D5Evidence

export declare const SELF_REFERENCES: Readonly<{
  login: string
  repository: string
  ownPulls: readonly string[]
}>

export declare function isExternalReference(
  candidate: { url: string; author: string; repository?: string | null },
  self?: typeof SELF_REFERENCES,
): boolean
