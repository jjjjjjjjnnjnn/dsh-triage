/**
 * "Can the D5 window still be measured, day by day?" (R76)
 *
 * WHY THIS FILE EXISTS: `docs/HANDOFF.md` (and `AGENTS.md`, `INDEX.md`) said the second baseline had to
 * run "before 11-08", with the reason "npm's `last-week` is a rolling 7 days, so afterwards the window's
 * first 7 days are permanently missing". Measured against the two live artifacts in `data/results/`, that
 * sentence is wrong in two ways:
 *
 *   - the rolling window publishes with a **1–2 day lag**, not 0 (`10-31` run → `10-23..10-29`; `11-03T06:22` run
 *     → `10-26..11-01`; `11-03T15:11` run → `10-27..11-02`), and
 *   - a single run does not have to cover all 7 days: **consecutive runs ≤7 days apart** cover the window
 *     with no hole (`11-03` gives up to `11-01`; a run on `11-10` gives `11-02..11-08` — continuous).
 *
 * So the real deadline is a *computed* number, and a number a human has to remember is exactly the failure
 * mode this repository already paid for once (`T-839`: the release watcher that only looked at its own
 * `--out` directory). This module turns it into arithmetic; `scripts/d5_window_status.mjs` is the surface.
 *
 * THE RULE (day granularity, UTC):
 *   - a baseline artifact publishes the 7 UTC days `[run - (lag+6), run - lag]`;
 *   - window day `D` can therefore be collected on run days `R ∈ [D+lag, D+lag+6]`;
 *   - `R` before that: the day is not published yet (`upcoming`); after it: `lost`, permanently;
 *   - only a baseline that **proves a live collection** (`kind: 'measured'`) counts as coverage — the same
 *     discipline as `pickBaselineArtifact` (R72): a recompute re-derives a window, it does not prove anyone
 *     looked at it.
 *
 * WHAT IT DOES NOT DO: it does not judge D5 (that is `scripts/lib/d5-score.mjs`, three frozen thresholds),
 * it does not read the network, and it does not claim the *verdict's* download number is a union — the
 * verdict reads ONE baseline (see the `limits` block in the recorder). Coverage answers a narrower
 * question: "if the window closed tomorrow, could I still say what the daily series looked like?"
 */

/** The rolling window npm's `last-week` publishes. Frozen: it is a property of the registry, not of us. */
export const ROLLING_WINDOW_DAYS = 7

/**
 * Days between "today" and the last day a `last-week` reading covers.
 *
 * MEASURED, NOT ASSUMED — and it is **not one number**: three reads on 2026-11-03 disagree.
 *   - `2026-10-31T06:40` → window `..10-29` (2 days)
 *   - `2026-11-03T06:22` → window `..11-01` (2 days)
 *   - `2026-11-03T15:11` → window `..11-02` (**1 day**, same civil day as the 06:22 run)
 * So the registry publishes the previous day at some point during the day. The default stays at **2**
 * because it is the *conservative* choice: it makes every deadline one day earlier than the optimistic
 * one, and a deadline that is one day early costs a second look while a deadline one day late costs a
 * window day forever. `scripts/d5_window_status.mjs` records the observed values next to each run
 * (`inputs.lag_observed`) so this constant is never the only witness.
 */
export const DEFAULT_LAG_DAYS = 2

const DAY_MS = 24 * 60 * 60 * 1000
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * `YYYY-MM-DD` → UTC day index, or null when the value is not a real civil date.
 *
 * The round trip is deliberate (R66's lesson): `Date.UTC(2026, 1, 30)` rolls to March 2 and returns a
 * perfectly finite number, so a typo in a window bound would silently move the window by days.
 *
 * @param {unknown} text
 * @returns {number | null}
 */
export function dayToNumber(text) {
  const match = DAY.exec(String(text ?? ''))
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1000) return null
  const ms = Date.UTC(year, month - 1, day)
  if (Number.isNaN(ms)) return null
  const back = new Date(ms)
  if (back.getUTCFullYear() !== year || back.getUTCMonth() + 1 !== month || back.getUTCDate() !== day) return null
  return Math.floor(ms / DAY_MS)
}

/**
 * @param {number} day
 * @returns {string} `YYYY-MM-DD`
 */
export function numberToDay(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/**
 * @param {{
 *   windowStart?: unknown,
 *   windowEnd?: unknown,
 *   today?: unknown,
 *   lagDays?: unknown,
 *   urgentWithinDays?: unknown,
 *   baselines?: unknown,
 * }} input
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   window?: { from: string, to: string, days: number },
 *   lag_days?: number,
 *   today?: string,
 *   covered?: string[],
 *   missing?: { day: string, first_collectible: string, last_collectible: string, state: 'collect-now' | 'upcoming' | 'lost' }[],
 *   used?: { file: string, from: string, to: string }[],
 *   ignored?: { file: string, reason: string }[],
 *   counts?: { covered: number, missing: number, collectible_now: number, upcoming: number, lost: number },
 *   next_run_by?: string | null,
 *   days_until_next_run?: number | null,
 *   verdict?: 'complete' | 'collect-now' | 'not-yet' | 'lost',
 *   urgent?: boolean,
 * }}
 */
export function judgeWindowCoverage(input) {
  const source = input === null || typeof input !== 'object' ? {} : input

  const start = dayToNumber(source.windowStart)
  const end = dayToNumber(source.windowEnd)
  const today = dayToNumber(source.today)
  if (start === null) return { ok: false, reason: 'window-start-unreadable' }
  if (end === null) return { ok: false, reason: 'window-end-unreadable' }
  if (end < start) return { ok: false, reason: 'window-inverted' }
  if (today === null) return { ok: false, reason: 'today-unreadable' }

  const rawLag = source.lagDays === undefined || source.lagDays === null ? DEFAULT_LAG_DAYS : Number(source.lagDays)
  if (!Number.isInteger(rawLag) || rawLag < 0 || rawLag > ROLLING_WINDOW_DAYS - 1) {
    return { ok: false, reason: 'lag-days-invalid' }
  }
  const rawUrgent =
    source.urgentWithinDays === undefined || source.urgentWithinDays === null ? 1 : Number(source.urgentWithinDays)
  if (!Number.isInteger(rawUrgent) || rawUrgent < 0) return { ok: false, reason: 'urgent-window-invalid' }

  const used = []
  const ignored = []
  const coveredSet = new Set()
  const entries = Array.isArray(source.baselines) ? source.baselines : []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const file = typeof entry.file === 'string' && entry.file.length > 0 ? entry.file : '(unnamed)'
    // `measured` is the only origin that proves somebody collected those days live (R72 / T-841).
    if (entry.kind !== 'measured') {
      ignored.push({ file, reason: entry.kind === 'recompute' ? 'recompute-does-not-prove-collection' : 'origin-unproven' })
      continue
    }
    const from = dayToNumber(entry.from)
    const to = dayToNumber(entry.to)
    if (from === null || to === null) {
      ignored.push({ file, reason: 'window-unreadable' })
      continue
    }
    if (to < from) {
      ignored.push({ file, reason: 'window-inverted' })
      continue
    }
    used.push({ file, from: numberToDay(from), to: numberToDay(to), days_in_window: Math.max(0, Math.min(to, end) - Math.max(from, start) + 1) })
    const lo = Math.max(from, start)
    const hi = Math.min(to, end)
    for (let day = lo; day <= hi; day += 1) coveredSet.add(day)
  }

  const coveredDays = [...coveredSet].sort((a, b) => a - b)
  const missing = []
  let collectibleNow = 0
  let upcoming = 0
  let lost = 0
  let nextRunBy = null
  for (let day = start; day <= end; day += 1) {
    if (coveredSet.has(day)) continue
    // Window day D appears in the rolling window of a run on R iff R ∈ [D+lag, D+lag+6].
    const firstCollectible = day + rawLag
    const lastCollectible = day + rawLag + (ROLLING_WINDOW_DAYS - 1)
    const state = lastCollectible < today ? 'lost' : firstCollectible > today ? 'upcoming' : 'collect-now'
    if (state === 'lost') lost += 1
    else {
      if (state === 'collect-now') collectibleNow += 1
      else upcoming += 1
      // The soonest-expiring day sets the deadline for the next run; ties keep the earliest day.
      if (nextRunBy === null || lastCollectible < nextRunBy) nextRunBy = lastCollectible
    }
    missing.push({
      day: numberToDay(day),
      first_collectible: numberToDay(firstCollectible),
      last_collectible: numberToDay(lastCollectible),
      state,
    })
  }

  const verdict =
    lost > 0 ? 'lost' : missing.length === 0 ? 'complete' : collectibleNow > 0 ? 'collect-now' : 'not-yet'
  const daysUntilNextRun = nextRunBy === null ? null : nextRunBy - today

  return {
    ok: true,
    window: { from: numberToDay(start), to: numberToDay(end), days: end - start + 1 },
    lag_days: rawLag,
    today: numberToDay(today),
    covered: coveredDays.map(numberToDay),
    missing,
    used,
    ignored,
    counts: {
      covered: coveredDays.length,
      missing: missing.length,
      collectible_now: collectibleNow,
      upcoming,
      lost,
    },
    next_run_by: nextRunBy === null ? null : numberToDay(nextRunBy),
    days_until_next_run: daysUntilNextRun,
    verdict,
    /*
     * `urgent` is the only thing a timer needs: false while there is slack, true once the soonest-expiring
     * window day is within `urgentWithinDays` of slipping out of the rolling window (or already has).
     * `lost` is always urgent — nothing can be collected for that day any more.
     */
    urgent: verdict === 'lost' || (daysUntilNextRun !== null && daysUntilNextRun <= rawUrgent),
  }
}
