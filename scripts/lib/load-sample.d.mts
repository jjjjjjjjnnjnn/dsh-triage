/** Types for `scripts/lib/load-sample.mjs` (imported directly by its unit test). */

export function cpuTimes(): { idle: number, total: number }

export function busyPercent(
  before: { idle?: number, total?: number } | null,
  after: { idle?: number, total?: number } | null,
): number | null

export function describeConditions(input: {
  before: { idle: number, total: number },
  after: { idle: number, total: number },
  startedAt: string,
  endedAt: string,
}): {
  cpu: { source: string, cores: number, observed_busy_percent: number | null, loadavg_usable: boolean },
  window: { started_at: string, ended_at: string },
  limits: string[],
}
