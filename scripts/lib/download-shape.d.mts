/** Types for `scripts/lib/download-shape.mjs`. */

export declare const BURST_PEAK_SHARE: number
export declare const D5_MINIMUM_WEEK_DOWNLOADS: number

export type DownloadShape = 'steady' | 'single-day-burst' | 'no-downloads' | 'unreadable'

export interface ClassifiedShape {
  shape: DownloadShape
  days: number
  days_with_downloads: number
  total: number | null
  peak_day: string | null
  peak_downloads: number | null
  peak_share: number | null
  first_day: string | null
  last_day: string | null
  reason: string
}

export declare function classifyDownloadShape(
  daily: Array<{ day: string; downloads: number }> | null | undefined,
): ClassifiedShape

export type DemandVerdict =
  | 'threshold-met'
  | 'below-threshold'
  | 'burst-not-demand'
  | 'no-demand-observed'
  | 'unmeasurable'

export interface DemandJudgement {
  verdict: DemandVerdict
  counts_as_demand: boolean
  detail: string
}

export declare function judgeWeeklyDemand(
  shape: { shape: string; total: number | null; peak_day?: string | null; peak_share?: number | null },
  options?: { minimum?: number },
): DemandJudgement
