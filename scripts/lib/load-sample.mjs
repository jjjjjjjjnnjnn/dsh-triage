/**
 * "What was the machine doing while we measured?" — the half of `BS-54` that a distribution cannot answer (R70).
 *
 * WHY: R68 turned 25 first-screen readings into a distribution (real runs: median 921ms, p90 2439ms, max
 * 5557ms) and stopped there, correctly: four slow runs spread over two afternoons cannot be attributed
 * without knowing what else the machine was doing. The artifacts recorded the *result* and nothing about
 * the *conditions*, so the only honest sentence was "the tail is unexplained".
 *
 * WHAT THIS SAMPLES: cumulative CPU times from `os.cpus()` at the start and end of a run. `os.loadavg()` is
 * always 0 on Windows (R37 paid for that lesson), so it would be a fake reading; deltas of cumulative times
 * are real on every platform.
 *
 * WHAT IT IS NOT: memory, disk or network pressure; other users' processes are invisible; and a single
 * number over a multi-minute run cannot say *when* the load peaked. It narrows the tail's explanation from
 * "unknown" to "the machine was ~X% busy", and nothing more.
 */

import { cpus } from 'node:os'

/** Cumulative idle/total milliseconds across all cores. */
export function cpuTimes() {
  let idle = 0
  let total = 0
  for (const core of cpus()) {
    const times = core.times
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total }
}

/**
 * @param {{ idle: number, total: number }} before
 * @param {{ idle: number, total: number }} after
 * @returns {number | null} percent busy, one decimal; null when the window is unusable
 */
export function busyPercent(before, after) {
  if (typeof before?.total !== 'number' || typeof after?.total !== 'number') return null
  if (typeof before?.idle !== 'number' || typeof after?.idle !== 'number') return null
  const totalDelta = after.total - before.total
  const idleDelta = after.idle - before.idle
  // A zero or negative delta means the sample window was too short to read; null is the honest answer.
  if (!(totalDelta > 0) || idleDelta < 0 || idleDelta > totalDelta) return null
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10
}

/**
 * A condition block a recorder can embed and a reader can compare across runs.
 *
 * @param {{ before: { idle: number, total: number }, after: { idle: number, total: number }, startedAt: string, endedAt: string }} input
 */
export function describeConditions(input) {
  const cores = cpus().length
  return {
    cpu: {
      source: 'os.cpus() cumulative times, delta over the run',
      cores,
      observed_busy_percent: busyPercent(input?.before, input?.after),
      /** `loadavg` is a Windows no-op; recorded so nobody tries to use it again. */
      loadavg_usable: process.platform !== 'win32',
    },
    window: {
      started_at: String(input?.startedAt ?? ''),
      ended_at: String(input?.endedAt ?? ''),
    },
    limits: [
      'CPU only: memory, disk and network pressure are not sampled',
      'other users and other processes are invisible to this reading',
      'one number over a multi-minute run cannot say when the load peaked',
    ],
  }
}
