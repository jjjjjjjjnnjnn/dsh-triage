/**
 * "634 downloads in one day is not demand" — the shape half of `scripts/record_market_baseline.mjs`.
 *
 * WHY THIS EXISTS (2026-10-31): the weekly downloads API answered `634` for `dsh-triage`, which is thirty
 * times more than D5's `>= 20` threshold. The daily series behind that number is
 *
 *     2026-10-22 .. 2026-10-28   0 0 0 0 0 0 0
 *     2026-10-29                 634
 *     2026-10-30                 0
 *
 * Every download landed on one day, with zero before and zero after. That is a mirror / scanner crawling a
 * brand-new package, not people. Reading the weekly total as demand would have handed us a **false pass** on
 * the one gate that decides whether this product exists — the same failure this repo already paid for twice
 * ("the check never ran" reported as "your token is broken", R50; `pending` read as an answer, R51).
 *
 * So the weekly total alone is not a claim. The claim needs a shape:
 *
 *   steady              >= 2 days with downloads, and no single day holding more than 80% of the window
 *   single-day-burst    <= 1 day with downloads, or one day holding > 80% of the window
 *   no-downloads        the window exists and every day is 0
 *   unreadable          we could not read a series (not a conclusion — never "no demand")
 *
 * Plus `no-record`, which the recorder writes when the downloads API answers 404: the API has no record at
 * all. It is a different claim from `no-downloads` (a real window that sums to 0), and both are different
 * from "the tool did not run".
 *
 * The decision-gate rule (approved 2026-10-31, `audit/SIGNOFF.md` R52) is executable in
 * `judgeWeeklyDemand()`: D5's `>= 20` counts only when the shape is `steady`.
 *
 * Both functions are pure: no clock, no network, no filesystem.
 */

/** How much of a window one day may hold before the window is called a burst. */
export const BURST_PEAK_SHARE = 0.8

/** D5's weekly-download threshold (`docs/ROADMAP.md` §2). Passed explicitly by the caller, not hidden here. */
export const D5_MINIMUM_WEEK_DOWNLOADS = 20

/**
 * Classify one daily series.
 *
 * @param {Array<{ day: string, downloads: number }> | null | undefined} daily
 * @returns {{
 *   shape: 'steady' | 'single-day-burst' | 'no-downloads' | 'unreadable',
 *   days: number,
 *   days_with_downloads: number,
 *   total: number | null,
 *   peak_day: string | null,
 *   peak_downloads: number | null,
 *   peak_share: number | null,
 *   first_day: string | null,
 *   last_day: string | null,
 *   reason: string,
 * }}
 */
export function classifyDownloadShape(daily) {
  const unreadable = (reason) => ({
    shape: 'unreadable',
    days: 0,
    days_with_downloads: 0,
    total: null,
    peak_day: null,
    peak_downloads: null,
    peak_share: null,
    first_day: null,
    last_day: null,
    reason,
  })

  if (!Array.isArray(daily) || daily.length === 0) {
    return unreadable('没有日序列（下载 API 没给出按天的数据），因此不能判断形状')
  }

  const rows = []
  for (const entry of daily) {
    if (entry === null || typeof entry !== 'object') return unreadable('日序列里有一项不是对象')
    const day = typeof entry.day === 'string' ? entry.day.trim() : ''
    const downloads = entry.downloads
    if (day === '') return unreadable('日序列里有一项没有 day')
    if (typeof downloads !== 'number' || !Number.isFinite(downloads) || downloads < 0) {
      return unreadable(`日期 ${day} 的 downloads 不是非负有限数`)
    }
    rows.push({ day, downloads })
  }

  // Sorting makes the result independent of the order the API happened to return.
  rows.sort((left, right) => (left.day < right.day ? -1 : left.day > right.day ? 1 : 0))

  const total = rows.reduce((sum, row) => sum + row.downloads, 0)
  const daysWithDownloads = rows.filter((row) => row.downloads > 0).length
  let peak = rows[0]
  for (const row of rows) if (row.downloads > peak.downloads) peak = row
  const peakShare = total === 0 ? null : Number((peak.downloads / total).toFixed(4))

  const base = {
    days: rows.length,
    days_with_downloads: daysWithDownloads,
    total,
    peak_day: total === 0 ? null : peak.day,
    peak_downloads: total === 0 ? null : peak.downloads,
    peak_share: peakShare,
    first_day: rows[0].day,
    last_day: rows[rows.length - 1].day,
  }

  if (total === 0) {
    return { ...base, shape: 'no-downloads', reason: `窗口 ${base.first_day}..${base.last_day} 内每天都是 0` }
  }
  if (daysWithDownloads <= 1) {
    return {
      ...base,
      shape: 'single-day-burst',
      reason: `只有 ${daysWithDownloads} 天有下载，全部 ${total} 次都落在 ${peak.day}`,
    }
  }
  if (peakShare !== null && peakShare > BURST_PEAK_SHARE) {
    return {
      ...base,
      shape: 'single-day-burst',
      reason: `${peak.day} 一天占窗口总量的 ${(peakShare * 100).toFixed(1)}%（> ${BURST_PEAK_SHARE * 100}%）`,
    }
  }
  return {
    ...base,
    shape: 'steady',
    reason: `${daysWithDownloads}/${rows.length} 天有下载，最大单日占比 ${((peakShare ?? 0) * 100).toFixed(1)}%`,
  }
}

/**
 * Apply the approved D5 reading rule to a classified series.
 *
 * `>= minimum` weekly downloads count as demand **only** when the shape is `steady`. A burst is not a
 * smaller amount of demand; it is not evidence of demand at all.
 *
 * @param {{ shape: string, total: number | null, peak_day?: string | null, peak_share?: number | null }} shape
 * @param {{ minimum?: number }} [options]
 * @returns {{
 *   verdict: 'threshold-met' | 'below-threshold' | 'burst-not-demand' | 'no-demand-observed' | 'unmeasurable',
 *   counts_as_demand: boolean,
 *   detail: string,
 * }}
 */
export function judgeWeeklyDemand(shape, options = {}) {
  const minimum = typeof options.minimum === 'number' ? options.minimum : D5_MINIMUM_WEEK_DOWNLOADS
  const kind = String(shape?.shape ?? '')
  const total = typeof shape?.total === 'number' ? shape.total : null

  // A 404 has no series at all, so it is judged before the "total is null" guard: the reason is known.
  if (kind === 'no-record') {
    return {
      verdict: 'no-demand-observed',
      counts_as_demand: false,
      detail: '下载 API 没有这个包的记录（不等于 0 下载）',
    }
  }
  if (kind === 'unreadable' || total === null) {
    return {
      verdict: 'unmeasurable',
      counts_as_demand: false,
      detail: '没读出日序列：这不是「没有需求」，是「这次没测到」',
    }
  }
  if (kind === 'no-downloads') {
    return { verdict: 'no-demand-observed', counts_as_demand: false, detail: '窗口内每天都是 0' }
  }
  if (kind === 'single-day-burst') {
    const where = shape?.peak_day ? `（全部落在 ${shape.peak_day}）` : ''
    return {
      verdict: 'burst-not-demand',
      counts_as_demand: false,
      detail: `单日爆发${where}，按 D5 读数规则不计为需求`,
    }
  }
  if (kind !== 'steady') {
    return {
      verdict: 'unmeasurable',
      counts_as_demand: false,
      detail: `形状 "${kind}" 不是本规则认识的取值，不当作结论`,
    }
  }
  if (total >= minimum) {
    return { verdict: 'threshold-met', counts_as_demand: true, detail: `${total} ≥ ${minimum}，且形状是 steady` }
  }
  return { verdict: 'below-threshold', counts_as_demand: false, detail: `${total} < ${minimum}` }
}
