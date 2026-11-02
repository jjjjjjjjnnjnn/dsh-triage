/** Types for `scripts/lib/question-coverage.mjs`. */

export type CoverageTier =
  | 'names-a-denial'
  | 'rules-out-declaration'
  | 'declares-nothing'
  | 'upstream-only'
  | 'probe-unreadable'
  | 'needs-their-profile'
  | 'not-relevant'

export interface CoverageProbe {
  state?: string
  package?: string
  version_source?: string
  admission_status?: string
  detail?: string
}

export interface CoverageRow {
  number?: number
  layer?: string
  verdict?: string
  tier?: CoverageTier
  probes?: CoverageProbe[]
}

export interface Share {
  count: number
  denominator: number
  ratio: number | null
  wilson95: [number, number] | null
}

export declare const TIERS: readonly CoverageTier[]
export declare const HEADLINE_TIERS: readonly string[]

export declare function tierOfThread(thread?: { layer?: string; probes?: CoverageProbe[] }): CoverageTier

export declare function isUpstreamPackage(name: unknown): boolean

export declare function isActionableProbe(probe: CoverageProbe): boolean

export declare function wilson95(successes: number, total: number): [number, number] | null

export declare function shareOf(successes: number, total: number): Share

export declare function coverageOf(rows: CoverageRow[]): {
  threads: number
  relevant: number
  decidable: number
  by_layer: Record<string, number>
  by_verdict: Record<string, number>
  tiers: Record<CoverageTier, number>
  headline: Share
  tier_shares: Array<{ tier: CoverageTier } & Share>
  sensitivity: { relevant: Share; decidable: Share }
}

export declare function manualReviewSample(numbers: number[], options?: { seed?: number; size?: number }): number[]

export declare function reviewAgreement(
  rows: CoverageRow[],
  reviews: Array<{ number: number; layer: string; verdict: string; why?: string }>,
): {
  total: number
  agree: number
  agreement: number | null
  disagreements: Array<{
    number: number
    classifier: { layer: string; verdict: string }
    reviewer: { layer: string; verdict: string }
    why: string | null
  }>
}

export declare function assertComplete(sample?: { total_count?: unknown; fetched?: unknown; pilot?: unknown }): {
  ok: boolean
  total: number
  fetched: number
  detail: string
}

export declare function formatPercent(value: unknown): string | null

export declare function formatInterval(interval: unknown): string | null

export declare function scrubHomePaths(value: unknown): string

export declare function signalSnippets(text: string, limit?: number): Array<{ layer: string; snippet: string }>
