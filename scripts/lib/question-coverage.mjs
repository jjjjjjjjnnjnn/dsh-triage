/**
 * The coverage arithmetic for `docs/specs/question-coverage.md` (R59).
 *
 * WHY THIS IS A PURE MODULE: the number this computes goes on the README's first screen, and the
 * two ways to fake it are (a) choosing the denominator after seeing the data, and (b) counting
 * "declares nothing" as an answer. Both are made structural here instead of left to prose:
 *
 *   - the headline denominator is the number of Q&A threads, always (this file takes no override);
 *   - the headline numerator is exactly `names-a-denial + rules-out-declaration`;
 *   - a tier that is not one of the six throws instead of being bucketed somewhere convenient.
 *
 * No function in this file reads the filesystem, the network, a clock, or the environment.
 */

import { createHash } from 'node:crypto'

import { SIGNALS } from './discussion-triage.mjs'

/** The seven mutually exclusive tiers, in headline order (spec §5, amended in R59-S1). */
export const TIERS = Object.freeze([
  'names-a-denial',
  'rules-out-declaration',
  'declares-nothing',
  'upstream-only',
  'probe-unreadable',
  'needs-their-profile',
  'not-relevant',
])

/** Only these two are "we produced a declaration-layer answer" (spec §6). */
export const HEADLINE_TIERS = Object.freeze(['names-a-denial', 'rules-out-declaration'])

/** `@deepseek-ai/*` ships with the app; its npm `latest` is often a stale monorepo tag. */
const UPSTREAM_PREFIX = '@deepseek-ai/'

export function isUpstreamPackage(name) {
  return typeof name === 'string' && name.toLowerCase().startsWith(UPSTREAM_PREFIX)
}

/**
 * A probe that may enter the headline. Upstream packages only count when the thread pinned the
 * version (then we judge the build the reporter had, R57's #8202 rule); otherwise the denial is
 * usually the app's own stale npm tag, not a package the user installed (spec §5 amendment).
 */
export function isActionableProbe(probe) {
  if (probe?.state !== 'measured') return false
  return !isUpstreamPackage(probe?.package) || probe?.version_source === 'thread-pinned'
}

const TIER_SET = new Set(TIERS)

/**
 * One thread -> one tier. Precedence is the spec's, and it is deliberately not additive: a thread
 * with one denied package and one admitted package is `names-a-denial`, because the denial is the
 * actionable half.
 *
 * @param {{ layer?: string, probes?: Array<{ state?: string, package?: string, version_source?: string, admission_status?: string }> }} [thread]
 * @returns {string}
 */
export function tierOfThread(thread = {}) {
  const layer = String(thread.layer ?? 'unknown')
  const probes = Array.isArray(thread.probes) ? thread.probes : []
  const measured = probes.filter((probe) => probe?.state === 'measured')
  const actionable = measured.filter(isActionableProbe)

  if (actionable.some((probe) => probe?.admission_status === 'denied')) return 'names-a-denial'
  if (actionable.some((probe) => probe?.admission_status === 'admitted')) return 'rules-out-declaration'
  if (actionable.length > 0) return 'declares-nothing'
  if (measured.length > 0) return 'upstream-only'
  if (probes.length > 0) return 'probe-unreadable'
  if (layer === 'unknown') return 'not-relevant'
  return 'needs-their-profile'
}

/**
 * Wilson score interval, the same implementation `d2_report.mjs` and `d4_report.mjs` use. Kept in
 * one place here so the README's interval and the artifact's interval cannot disagree.
 *
 * @param {number} successes
 * @param {number} total
 * @returns {[number, number] | null} null when there is no denominator (never "0% ± nothing")
 */
export function wilson95(successes, total) {
  if (total === 0) return null
  const z = 1.96
  const p = successes / total
  const denominator = 1 + (z * z) / total
  const centre = p + (z * z) / (2 * total)
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))
  return [Math.max(0, (centre - spread) / denominator), Math.min(1, (centre + spread) / denominator)].map(
    (value) => Math.round(value * 1000) / 1000,
  )
}

/**
 * A count, its denominator, the ratio and the interval. Refuses a numerator larger than the
 * denominator: a miscount must fail here, not print "103%".
 *
 * @param {number} successes
 * @param {number} total
 * @returns {{ count: number, denominator: number, ratio: number | null, wilson95: [number, number] | null }}
 */
export function shareOf(successes, total) {
  if (!Number.isInteger(successes) || successes < 0) throw new RangeError(`successes must be a non-negative integer, got ${successes}`)
  if (!Number.isInteger(total) || total < 0) throw new RangeError(`total must be a non-negative integer, got ${total}`)
  if (successes > total) throw new RangeError(`a numerator (${successes}) cannot exceed its denominator (${total})`)
  return {
    count: successes,
    denominator: total,
    ratio: total === 0 ? null : successes / total,
    wilson95: wilson95(successes, total),
  }
}

/**
 * The whole per-population arithmetic. `rows` are the thread rows (with `layer`, `verdict`, and
 * either a pre-computed `tier` or `probes`).
 *
 * @param {Array<{ layer?: string, verdict?: string, tier?: string, probes?: unknown[] }>} rows
 * @returns {{
 *   threads: number,
 *   relevant: number,
 *   decidable: number,
 *   by_layer: Record<string, number>,
 *   by_verdict: Record<string, number>,
 *   tiers: Record<string, number>,
 *   headline: ReturnType<typeof shareOf>,
 *   tier_shares: Array<{ tier: string } & ReturnType<typeof shareOf>>,
 *   sensitivity: { relevant: ReturnType<typeof shareOf>, decidable: ReturnType<typeof shareOf> },
 * }}
 */
export function coverageOf(rows) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array')

  const byLayer = Object.fromEntries(['admission', 'upgrade', 'composition', 'runtime', 'unknown'].map((layer) => [layer, 0]))
  const byVerdict = Object.fromEntries(
    ['answerable', 'partially-answerable', 'needs-their-profile', 'not-ours'].map((verdict) => [verdict, 0]),
  )
  const tiers = Object.fromEntries(TIERS.map((tier) => [tier, 0]))

  for (const row of rows) {
    const layer = String(row?.layer ?? 'unknown')
    const verdict = String(row?.verdict ?? 'not-ours')
    if (!(layer in byLayer)) throw new RangeError(`unknown layer "${layer}" in row`)
    if (!(verdict in byVerdict)) throw new RangeError(`unknown verdict "${verdict}" in row`)
    byLayer[layer] += 1
    byVerdict[verdict] += 1

    const tier = row?.tier === undefined ? tierOfThread(row) : String(row.tier)
    if (!TIER_SET.has(tier)) throw new RangeError(`unknown tier "${tier}" in row`)
    tiers[tier] += 1
  }

  const threads = rows.length
  const relevant = threads - tiers['not-relevant']
  const decidable = relevant - tiers['probe-unreadable']
  if (decidable < 0) throw new RangeError('decidable threads cannot be negative: probe-unreadable must be a subset of relevant')

  const numerator = tiers['names-a-denial'] + tiers['rules-out-declaration']

  return {
    threads,
    relevant,
    decidable,
    by_layer: byLayer,
    by_verdict: byVerdict,
    tiers,
    // The headline denominator is the population, never a subset: `probe-unreadable` stays in it.
    headline: shareOf(numerator, threads),
    tier_shares: TIERS.map((tier) => ({ tier, ...shareOf(tiers[tier], threads) })),
    // Context only (spec §6): these are recorded in the artifact and the report, never in the README headline.
    sensitivity: {
      relevant: shareOf(numerator, relevant),
      decidable: shareOf(numerator, decidable),
    },
  }
}

/**
 * The sample a human/agent reviews: deterministic, content-blind, and reproducible from the seed.
 * `sha256("<seed>:<number>")` ascending means adding a new thread does not reshuffle the old list.
 *
 * @param {number[]} numbers
 * @param {{ seed?: number, size?: number }} [options]
 * @returns {number[]}
 */
export function manualReviewSample(numbers, { seed = 20261102, size = 20 } = {}) {
  if (!Number.isInteger(seed) || seed < 0) throw new RangeError(`seed must be a non-negative integer, got ${seed}`)
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`size must be a positive integer, got ${size}`)
  const unique = [...new Set(numbers.map(Number).filter((value) => Number.isInteger(value) && value > 0))].sort((left, right) => left - right)
  return unique
    .map((number) => ({ number, key: createHash('sha256').update(`${seed}:${number}`).digest('hex') }))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : left.number - right.number))
    .slice(0, size)
    .map((entry) => entry.number)
}

/**
 * Compare the classifier with a reviewer. Agreement is exact on both fields (spec §8); a review for
 * a thread that is not in the sample throws instead of being dropped, because dropping is how an
 * error rate improves without anyone learning anything.
 *
 * @param {Array<{ number: number, layer: string, verdict: string }>} rows
 * @param {Array<{ number: number, layer: string, verdict: string, why?: string }>} reviews
 * @returns {{
 *   total: number,
 *   agree: number,
 *   agreement: number | null,
 *   disagreements: Array<{ number: number, classifier: { layer: string, verdict: string }, reviewer: { layer: string, verdict: string }, why: string | null }>,
 * }}
 */
export function reviewAgreement(rows, reviews) {
  if (!Array.isArray(rows) || !Array.isArray(reviews)) throw new TypeError('rows and reviews must be arrays')
  const byNumber = new Map(rows.map((row) => [Number(row.number), row]))
  if (byNumber.size !== rows.length) throw new RangeError('rows contain duplicate thread numbers')

  const disagreements = []
  let agree = 0
  for (const review of reviews) {
    const number = Number(review?.number)
    const row = byNumber.get(number)
    if (row === undefined) throw new RangeError(`review for #${number} is not in the sample`)
    const same = String(row.layer) === String(review.layer) && String(row.verdict) === String(review.verdict)
    if (same) agree += 1
    else {
      disagreements.push({
        number,
        classifier: { layer: String(row.layer), verdict: String(row.verdict) },
        reviewer: { layer: String(review.layer), verdict: String(review.verdict) },
        why: typeof review.why === 'string' && review.why.trim() !== '' ? review.why.trim() : null,
      })
    }
  }

  return {
    total: reviews.length,
    agree,
    agreement: reviews.length === 0 ? null : agree / reviews.length,
    disagreements,
  }
}

/**
 * `M != N` is an incomplete census, not a small sample (spec §2). A pilot is exempt because it is
 * explicitly labelled a pilot and never cited as evidence.
 *
 * @param {{ total_count?: unknown, fetched?: unknown, pilot?: unknown }} sample
 * @returns {{ ok: boolean, total: number, fetched: number, detail: string }}
 */
export function assertComplete(sample = {}) {
  const total = Number(sample.total_count)
  const fetched = Number(sample.fetched)
  const pilot = sample.pilot === true
  if (!Number.isInteger(total) || total < 0) return { ok: false, total, fetched, detail: `total_count is not a count: ${String(sample.total_count)}` }
  if (!Number.isInteger(fetched) || fetched < 0) return { ok: false, total, fetched, detail: `fetched is not a count: ${String(sample.fetched)}` }
  if (pilot) return { ok: fetched > 0, total, fetched, detail: `pilot sample: ${fetched} of ${total} (never cited as evidence)` }
  if (fetched !== total) return { ok: false, total, fetched, detail: `fetched ${fetched} != total ${total}: an incomplete census is not a ratio` }
  return { ok: true, total, fetched, detail: `${fetched} of ${total} read` }
}

/** Percent with one decimal; `null` stays `null` so the caller can print an explicit dash. */
export function formatPercent(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : null
}

/**
 * Redact home-shaped paths from a title before it enters `data/results`.
 *
 * WHY: discussions quote logs, and `gate_governance` refuses any `/home/<name>/` or `C:\Users\<name>`
 * in the SSOT. The third replace also catches the false positive that made this necessary: a UI bug
 * title saying `方向键/Home/End/Enter` matches `/\/home\/[a-z0-9._-]+\//i` case-insensitively. The
 * replacement contains `<`, which the gate's class `[a-z0-9._-]` does not match.
 */
export function scrubHomePaths(value) {
  return String(value ?? '')
    .replace(/[A-Za-z]:\\\\Users\\\\[^\\\s]+/g, 'C:\\\\Users\\\\<user>')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, 'C:\\Users\\<user>')
    .replace(/\/home\/[A-Za-z0-9._-]+\//gi, '/home/<user>/')
    .replace(/\/Users\/[A-Za-z0-9._-]+\//g, '/Users/<user>/')
    .replace(/[A-Za-z]-Users-[A-Za-z0-9._-]{2,}/g, 'C-Users-<user>')
}

/** `10.8–14.0%`; the README and `check_listing` both use this, so the string cannot drift. */
export function formatInterval(interval) {
  if (!Array.isArray(interval) || interval.length !== 2) return null
  const [low, high] = interval
  if (typeof low !== 'number' || typeof high !== 'number') return null
  return `${(low * 100).toFixed(1)}–${(high * 100).toFixed(1)}%`
}

/**
 * Why the classifier said what it said, for the General projection (which does not keep full text).
 * A few characters around each matched signal is enough for a reviewer to audit the layer choice.
 *
 * @param {string} text
 * @param {number} [limit]
 * @returns {Array<{ layer: string, snippet: string }>}
 */
export function signalSnippets(text, limit = 3) {
  const source = String(text ?? '')
  const out = []
  const seen = new Set()
  for (const [layer, pattern] of SIGNALS) {
    const match = pattern.exec(source)
    if (match === null || match.index === undefined) continue
    const start = Math.max(0, match.index - 60)
    const snippet = source.slice(start, match.index + 120).replace(/\s+/g, ' ').trim()
    if (snippet === '' || seen.has(snippet)) continue
    seen.add(snippet)
    out.push({ layer, snippet })
    if (out.length >= limit) break
  }
  return out
}
