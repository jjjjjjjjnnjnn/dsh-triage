/**
 * "How long does the first screen actually take?" — a distribution, not a point (R68, closes `BS-54`).
 *
 * WHY: `BS-54` recorded **one** observation of 9510ms for the settings-tab summary and said, correctly,
 * that one number supports no claim. Meanwhile 25 observations were already sitting in
 * `data/results/client-serve-*.json`, unread. The rule this file encodes is the same one the repo applies
 * to probe matrices (`scripts/stability_report.mjs`): a single observation is not a distribution, and a
 * p90 from five points is noise dressed as a percentile.
 *
 * WHAT IS MEASURED, AND WHAT IS NOT:
 *   - `tab_ms` is the **stranger's wait**: from the settings navigation to the summary being on screen. It
 *     contains browser navigation and clicks, not just our engine — so it must never be quoted as
 *     "the engine takes 0.9s".
 *   - route timings (e.g. `upgrade-route.ms`) are the engine side, measured on the server. They are a
 *     different series and are never merged with `tab_ms`.
 *   - a run whose step is `unmeasured` contributes nothing: no value is not a zero.
 */

/** Percentiles by nearest rank, so the number is an observed value and not an interpolation. */
export function summarize(values) {
  const clean = (Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right)
  if (clean.length === 0) return { n: 0, min: null, median: null, p90: null, max: null, provisory: true }

  const rank = (fraction) => clean[Math.min(clean.length - 1, Math.max(0, Math.ceil(fraction * clean.length) - 1))]
  const middle = clean.length % 2 === 1 ? clean[(clean.length - 1) / 2] : (clean[clean.length / 2 - 1] + clean[clean.length / 2]) / 2
  return {
    n: clean.length,
    min: clean[0],
    median: middle,
    p90: rank(0.9),
    max: clean[clean.length - 1],
    /** Below ten observations a p90 is one or two runs wearing a statistical costume. */
    provisory: clean.length < 10,
  }
}

/**
 * @param {{
 *   series: Array<{ id: string, kind: 'browser' | 'engine', group: string, values: Array<{ ms: unknown, at?: string | null, source: string }> }>,
 * }} input
 * @returns {{
 *   ok: boolean,
 *   series: Array<{ id: string, kind: string, group: string, n: number, min: number|null, median: number|null, p90: number|null, max: number|null, provisory: boolean, slowest: Array<{ ms: number, at: string|null, source: string }> }>,
 *   problems: string[],
 * }}
 */
export function judgeLatency(input) {
  const series = Array.isArray(input?.series) ? input.series : []
  const problems = []
  const out = []

  for (const item of series) {
    const id = String(item?.id ?? '?')
    const clean = (Array.isArray(item?.values) ? item.values : [])
      .filter((value) => typeof value?.ms === 'number' && Number.isFinite(value.ms) && value.ms >= 0)
      .map((value) => ({ ms: value.ms, at: typeof value.at === 'string' ? value.at : null, source: String(value.source ?? '') }))
      .sort((left, right) => left.ms - right.ms)

    if (clean.length === 0) problems.push(`${id}: no observation at all — that is "not measured", never "fast"`)
    else if (clean.length === 1) problems.push(`${id}: a single observation is not a distribution (this is exactly what BS-54 was about)`)

    const summary = summarize(clean.map((value) => value.ms))
    out.push({
      id,
      kind: String(item?.kind ?? 'browser'),
      group: String(item?.group ?? 'unspecified'),
      ...summary,
      // The slow tail is the interesting part, so it is carried verbatim rather than summarised away.
      slowest: clean.slice(-3).reverse(),
    })
  }

  if (series.length === 0) problems.push('no series was read — this report would be vacuous')

  return { ok: problems.length === 0, series: out, problems }
}
