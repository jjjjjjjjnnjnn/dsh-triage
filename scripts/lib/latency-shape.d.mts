/** Types for `scripts/lib/latency-shape.mjs` (imported directly by its unit test). */

export interface LatencySummary {
  n: number
  min: number | null
  median: number | null
  p90: number | null
  max: number | null
  provisory: boolean
}

export interface LatencySample {
  ms: unknown
  at?: string | null
  source: string
}

export interface LatencySeriesInput {
  id: string
  kind: 'browser' | 'engine'
  group: string
  values: LatencySample[]
}

export interface LatencySeriesVerdict extends LatencySummary {
  id: string
  kind: string
  group: string
  slowest: Array<{ ms: number, at: string | null, source: string }>
}

export function summarize(values: unknown[]): LatencySummary

export function judgeLatency(input: { series: LatencySeriesInput[] }): {
  ok: boolean
  series: LatencySeriesVerdict[]
  problems: string[]
}
