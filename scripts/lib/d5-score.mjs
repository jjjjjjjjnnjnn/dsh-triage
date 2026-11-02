/**
 * The three numbers D5 is allowed to count, and nothing else (R54).
 *
 * WHY A PURE FUNCTION AND A WRITTEN SPEC: D5 is the only product judgement this project has
 * (`docs/ROADMAP.md` §2). On 2026-10-31 we learned the hard way that a number can mean the
 * opposite of what it looks like — 634 weekly downloads that all landed on one day — and the fix
 * was to write the reading rule down *before* looking at the data (`scripts/lib/download-shape.mjs`).
 * `reactions` and `external_references` have exactly the same trap: our own pull requests look like
 * "someone mentioned us", and an unreadable response looks like a zero.
 *
 * So: the thresholds are frozen elsewhere (R47), the *reading* is frozen here, and the function is
 * total — every combination of (post?, window, readings) has one answer, listed in the spec table.
 *
 * NOTHING IN HERE TOUCHES THE NETWORK OR THE CLOCK: `now` and the readings are arguments, which is
 * what makes the fixtures round-trip possible.
 */

import { parseInstant } from './posting.mjs'

/** Frozen by R47. Changing any of these is a criteria change, not a code change. */
export const D5_THRESHOLDS = Object.freeze({ reactions: 10, external_references: 1, weekly_downloads: 20 })

/** The window runs from the moment the post went up, not from a release date. */
export const D5_WINDOW_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

/** A reading is either a number we saw, or an explicit statement that we could not read it. */
function reading(value, state) {
  return { value: state === 'measured' ? value : null, state }
}

/**
 * @param {{ postedOn?: unknown, now?: unknown }} input
 * @returns {{ posted_on: string|null, ends_at: string|null, closed: boolean, days_left: number|null }}
 */
export function windowOf({ postedOn, now }) {
  /*
   * R67 (T-836): `Date.parse` accepts strings that are not instants — it ROLLS `2026-02-30` into March 2
   * and returns a perfectly finite epoch, so a typo would move the 14-day window by two days without a
   * word. `parseInstant` round-trips the civil fields and refuses those. An unreadable start still yields
   * `posted_on: null` (which `judgeD5` reports as `no-post`); that label is imprecise for "the date was
   * garbage", but the CLI refuses such input before it gets here, and this stays a last line of defence.
   */
  const start = typeof postedOn === 'string' ? parseInstant(postedOn) : null
  const at = typeof now === 'string' ? Date.parse(now) : Number.NaN
  if (start === null || Number.isNaN(at)) {
    return { posted_on: null, ends_at: null, closed: false, days_left: null }
  }
  const end = start.epochMs + D5_WINDOW_DAYS * DAY_MS
  return {
    posted_on: new Date(start.epochMs).toISOString(),
    ends_at: new Date(end).toISOString(),
    closed: at >= end,
    days_left: Math.max(0, Math.ceil((end - at) / DAY_MS)),
  }
}

/**
 * @param {{
 *   post?: { url?: unknown, number?: unknown, author?: unknown } | null,
 *   postedOn?: unknown,
 *   now?: unknown,
 *   readings?: {
 *     reactions?: { value?: unknown, state?: unknown },
 *     externalReferences?: { value?: unknown, entries?: unknown[], state?: unknown },
 *     weeklyDownloads?: { value?: unknown, shape?: unknown, state?: unknown },
 *   },
 * }} input
 */
export function judgeD5({ post = null, postedOn = null, now, readings = {} }) {
  const window = windowOf({ postedOn, now })
  const postUrl = typeof post?.url === 'string' && post.url !== '' ? post.url : null

  const reactionsState = readings.reactions?.state === 'unreadable' ? 'unreadable' : 'measured'
  const referencesState = readings.externalReferences?.state === 'unreadable' ? 'unreadable' : 'measured'
  const downloadsState = readings.weeklyDownloads?.state === 'unreadable' ? 'unreadable' : 'measured'

  const reactions = reading(Number(readings.reactions?.value ?? 0), reactionsState)
  const references = reading(Number(readings.externalReferences?.value ?? 0), referencesState)
  const shape = typeof readings.weeklyDownloads?.shape === 'string' ? readings.weeklyDownloads.shape : 'unreadable'
  const downloads = {
    ...reading(Number(readings.weeklyDownloads?.value ?? 0), downloadsState),
    shape,
  }

  /*
   * `steady` is part of "the number exists", not a separate warning: a burst is exactly the case
   * where the value is large and the meaning is empty (R52, `BS-48`).
   */
  const numbers = {
    reactions: {
      ...reactions,
      threshold: D5_THRESHOLDS.reactions,
      met: reactionsState === 'measured' && reactions.value >= D5_THRESHOLDS.reactions,
    },
    external_references: {
      ...references,
      threshold: D5_THRESHOLDS.external_references,
      entries: Array.isArray(readings.externalReferences?.entries) ? readings.externalReferences.entries : [],
      met: referencesState === 'measured' && references.value >= D5_THRESHOLDS.external_references,
    },
    weekly_downloads: {
      ...downloads,
      threshold: D5_THRESHOLDS.weekly_downloads,
      met:
        downloadsState === 'measured' &&
        shape === 'steady' &&
        downloads.value >= D5_THRESHOLDS.weekly_downloads,
    },
  }

  /* The order below is the spec's table, in order. Reordering it changes a verdict. */
  if (postUrl === null) {
    // Nothing was posted: there is no window and no sample. `no-post` is the honest answer here.
    return { verdict: 'no-post', counts_as_demand: false, window, numbers, post: null, reason: null }
  }
  if (window.posted_on === null) {
    /*
     * R70 (spec §3, signed): a post URL exists, so "nothing was posted" would be a false statement. What we
     * cannot read is the *date* the window starts from — and "could not read" is `unmeasurable`, never a
     * verdict about the product. Before this, a post with an unreadable `posted_on` came out as `no-post`,
     * i.e. the tool claimed nobody had posted while holding the post's URL.
     */
    return {
      verdict: 'unmeasurable',
      counts_as_demand: false,
      window,
      numbers,
      post: { url: postUrl, number: Number(post?.number ?? 0), author: String(post?.author ?? '') },
      reason: 'window-start-unreadable',
    }
  }
  if (reactionsState === 'unreadable' || referencesState === 'unreadable' || downloadsState === 'unreadable') {
    return {
      verdict: 'unmeasurable',
      counts_as_demand: false,
      window,
      numbers,
      post: { url: postUrl, number: Number(post?.number ?? 0), author: String(post?.author ?? '') },
      reason: 'number-unreadable',
    }
  }
  const allMet = numbers.reactions.met && numbers.external_references.met && numbers.weekly_downloads.met
  const verdict = allMet ? 'pass' : window.closed ? 'fail' : 'pending'
  return {
    verdict,
    counts_as_demand: allMet,
    window,
    numbers,
    post: { url: postUrl, number: Number(post?.number ?? 0), author: String(post?.author ?? '') },
    reason: null,
  }
}

/**
 * Which of our own links must never count as an external reference (spec §1).
 * Kept as data, so the recorder and the tests cannot disagree about the exclusion list.
 */
export const SELF_REFERENCES = Object.freeze({
  login: 'jjjjjjjjnnjnn',
  repository: 'github.com/jjjjjjjjnnjnn/dsh-triage',
  ownPulls: Object.freeze([
    'github.com/zhu1090093659/dsh-community-plugins/pull/65',
    'github.com/awesome-deepseekharness/awesome-deepseek-harness/pull/193',
    'github.com/walkinglabs/awesome-deepseek-harness-plugins/pull/140',
  ]),
})

/**
 * @param {{ url: string, author: string, repository?: string|null }} candidate
 * @param {{ login: string, repository: string, ownPulls: readonly string[] }} self
 */
export function isExternalReference(candidate, self = SELF_REFERENCES) {
  const url = String(candidate?.url ?? '').toLowerCase()
  const author = String(candidate?.author ?? '').toLowerCase()
  const repository = String(candidate?.repository ?? '').toLowerCase()
  if (url === '') return false
  if (author !== '' && author === self.login.toLowerCase()) return false
  if (self.ownPulls.some((pull) => url.includes(pull.toLowerCase()))) return false
  if (repository === self.repository.replace('github.com/', '').toLowerCase()) return false
  return true
}
