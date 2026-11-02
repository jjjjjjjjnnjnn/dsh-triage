/**
 * "Is this post recorded honestly?" — the rule behind `check_listing`'s `posted-drafts-carry-a-date`.
 *
 * HISTORY (why this file exists at all): the rule has been wrong three times in four rounds, and every
 * time the mistake was in the *matcher*, never in the idea.
 *
 *   - R56: "posted_url must be a discussion URL" → an X post could not be recorded, so the registry
 *     stayed `draft` while the post was live.
 *   - R64: "the domain must match the platform the channel names", but the timestamp had to end in `Z` →
 *     `2026-11-02T18:36:00+01:00`, the spelling a human on this UTC+1 machine types first, was refused
 *     with the message "is not timezone-qualified" — which was simply false.
 *   - R65: an independent adversary went at it and found that a *nonexistent* instant sailed through:
 *     `2026-02-30T12:00:00Z` and `2026-13-01T00:00:00Z` both returned `ok: true, problems: []`, because
 *     the regex only counted digits and `Date.parse` silently *rolls* Feb 30 into Mar 2 (and returns
 *     `NaN` for month 13, which the future-check then read as "not in the future"). A one-character typo
 *     passed with zero signals — the same shape this repo keeps paying for.
 *
 * WHAT IT NOW DOES:
 *   1. the URL must be on exactly one platform this check can verify (discussion / issue / X), and the
 *      channel must name that platform. Naming *several* platforms is allowed as prose as long as the URL
 *      is one of them — "X thread, not an issue" is a natural sentence, and treating it as ambiguity
 *      (this rule's first cut) blocked true records. What stays forbidden is the silent case: a channel
 *      that names no verifiable platform, or a URL on a platform the channel never mentions;
 *   2. `posted_on` must be **written** as an ISO-8601 instant with an explicit zone, and that instant must
 *      **exist**: the civil fields have to survive a round trip through the epoch (so Feb 30, month 13,
 *      `99:99:99`, leap second `:60` and offsets like `+99:00` are refused), and it must not be in the
 *      future. Shape and existence are reported separately, because saying "does not exist" about a real
 *      instant in an unaccepted format is the same false-reason bug this rule was fixed for twice.
 *
 * WHAT IT STILL DOES NOT DO: it never fetches the URL (a 404 and a live post look identical here), it does
 * not check prose, and it says nothing about whether one entry records *all* the places a draft was posted
 * (one entry = one post = one URL; that is why two platform names are refused instead of resolved).
 */

/**
 * Strict ISO-8601 instant: date, time, optional fractional seconds, explicit zone.
 * Kept as a pattern for the shape only — `parseInstant` is what decides whether the value is real.
 */
export const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

const INSTANT_PARTS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:(Z)|([+-])(\d{2}):(\d{2}))$/

/**
 * Turn a string into an epoch **only if that instant exists**.
 *
 * The round trip is the whole point: `Date.UTC(2026, 1, 30)` happily returns March 2, and
 * `Date.UTC(2026, 12, 1)` returns January 2027 — so a regex that counts digits cannot tell a typo from a
 * date. Comparing the civil fields after the trip does.
 *
 * @param {unknown} text
 * @returns {{ epochMs: number, canonical: string } | null} null when the value is not a real instant
 */
export function parseInstant(text) {
  const match = INSTANT_PARTS.exec(String(text ?? ''))
  if (match === null) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, , sign, offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const millis = fractionText === undefined ? 0 : Number(String(fractionText).padEnd(3, '0'))
  const offsetHours = offsetHourText === undefined ? 0 : Number(offsetHourText)
  const offsetMinutes = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText)

  // A zone offset is ±23:59 at most; "+99:00" is not a timezone, it is a typo.
  if (offsetHours > 23 || offsetMinutes > 59) return null
  // Years below 100 are read as 19xx by `Date.UTC`, which would make every round trip fail anyway; say no
  // explicitly so the reason is "not a plausible instant", not "does not round trip".
  if (year < 1000) return null

  const wall = Date.UTC(year, month - 1, day, hour, minute, second, millis)
  if (Number.isNaN(wall)) return null

  // If the civil fields did not survive, the value named a date or a time that does not exist.
  const back = new Date(wall)
  const sameFields =
    back.getUTCFullYear() === year &&
    back.getUTCMonth() + 1 === month &&
    back.getUTCDate() === day &&
    back.getUTCHours() === hour &&
    back.getUTCMinutes() === minute &&
    back.getUTCSeconds() === second
  if (!sameFields) return null

  const zoneMinutes = sign === undefined ? 0 : (sign === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes)
  const epochMs = wall - zoneMinutes * 60_000
  return { epochMs, canonical: new Date(epochMs).toISOString() }
}

/**
 * The platforms this project actually publishes on. `channel` is the word an entry must contain for the
 * platform to be claimed; `match` is what its URL must look like.
 *
 * The X token is deliberately a *word*: `V2EX` must not be read as "X" (its `X` is preceded by a letter).
 */
export const POSTING_PLATFORMS = [
  {
    id: 'github-discussion',
    channel: /discussion/i,
    match: /^https:\/\/github\.com\/[^/]+\/[^/]+\/discussions\/\d+(?:[#?].*)?$/,
  },
  {
    id: 'github-issue',
    channel: /issue/i,
    match: /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(?:[#?].*)?$/,
  },
  {
    id: 'x',
    channel: /(?:^|[^A-Za-z])x(?:[^A-Za-z]|$)|twitter/i,
    match: /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+(?:\?.*)?$/,
  },
]

/**
 * @param {{ channel?: unknown, url?: unknown, postedOn?: unknown, now: string | number | Date }} input
 * @returns {{
 *   ok: boolean,
 *   platform: string | null,
 *   problems: string[],
 *   posted_at: string | null,
 * }}
 */
export function judgePosting(input) {
  const channel = String(input?.channel ?? '')
  const url = String(input?.url ?? '')
  const postedOn = String(input?.postedOn ?? '')
  const rawNow = input?.now

  const claimed = POSTING_PLATFORMS.filter((platform) => platform.channel.test(channel))
  // Which platform(s) the URL itself is on. This — not the words in `channel` — decides whether the
  // record is coherent: "X thread, not an issue" mentions two platforms to *exclude* one, and treating
  // that as ambiguity (R66's first cut) blocked a true record (R66 adversary, N-2).
  const matched = POSTING_PLATFORMS.filter((platform) => platform.match.test(url))
  const problems = []

  if (matched.length === 0) {
    problems.push(`posted_url is not on a platform this check can verify (got "${url}") — expected a discussion, an issue, or an X/Twitter status link`)
  } else if (matched.length > 1) {
    problems.push(`posted_url matches more than one platform (${matched.map((platform) => platform.id).join(', ')}), so this record is ambiguous`)
  } else if (claimed.length === 0) {
    // Named explicitly so the fix is "say which platform", not "fight the regex".
    problems.push(`the channel names no platform this check can verify ("${channel}") — name discussion / issue / X`)
  } else if (!claimed.some((platform) => platform.id === matched[0].id)) {
    const only = matched[0]
    problems.push(`posted_url is on ${only.id}, but the channel names ${claimed.map((platform) => platform.id).join(', ')} — one of them must be ${only.id}`)
  }

  const instant = parseInstant(postedOn)
  if (!ISO_INSTANT.test(postedOn)) {
    // Shape first, existence second: saying "does not exist" about `…T18:36:00.1234Z` (a real instant in a
    // format we do not accept) is the same false-reason bug R64 was fixed for (R66 adversary, N-3).
    problems.push(`posted_on is not written as an ISO-8601 instant with an explicit zone (got "${postedOn}") — use YYYY-MM-DDTHH:MM:SS[.sss](Z|+hh:mm)`)
  } else if (instant === null) {
    // One sentence for "the date is not real" and "it is outside what this checker accepts": both are
    // refusals, and claiming the first when the second is true would be another false reason.
    problems.push(
      `posted_on names an instant this checker cannot accept (got "${postedOn}") — either the date does not exist, or it is outside the supported range (years 1000–9999, hours 00–23, no leap second)`,
    )
  } else {
    const nowMs =
      typeof rawNow === 'number'
        ? rawNow
        : rawNow instanceof Date
          ? rawNow.getTime()
          : Date.parse(String(rawNow ?? ''))
    if (!Number.isFinite(nowMs)) {
      problems.push('the reference time is unreadable, so "is it in the future" cannot be answered')
    } else if (instant.epochMs > nowMs) {
      problems.push(`posted_on is in the future (${postedOn})`)
    }
  }

  return {
    ok: problems.length === 0,
    platform: matched.length === 1 ? matched[0].id : null,
    problems,
    posted_at: instant === null ? null : instant.canonical,
  }
}
