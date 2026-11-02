/**
 * "Is this post recorded honestly?" — the rule behind `check_listing`'s `posted-drafts-carry-a-date`,
 * extracted so it can be unit-tested instead of only exercised end to end (R65).
 *
 * WHY IT MOVED: the rule has been wrong twice in three rounds, and both times the mistake was in the
 * *matcher*, not in the idea:
 *
 *   - R56 wrote "posted_url must be a discussion URL". Distribution later moved to X, and an X post could
 *     not be recorded at all — the registry stayed `draft` while the post was live (a ledger that
 *     disagrees with reality is worse than a missing assertion).
 *   - R64 widened it to "the domain must match the platform the channel names", but required the
 *     timestamp to end in `Z`. A perfectly valid `2026-11-02T18:36:00+01:00` was rejected with a message
 *     claiming it "is not timezone-qualified" — which is simply false, and this machine runs at UTC+1, so
 *     that form is the one a human here will type first.
 *
 * WHAT IT ENFORCES NOW:
 *   1. the channel must name a platform this check can verify (discussion / issue / X) — otherwise the
 *      rule is vacuous for that entry, and a vacuous rule reading as "passed" is the recurring bug here;
 *   2. `posted_url` must be on THAT platform;
 *   3. `posted_on` must be an ISO-8601 instant with an explicit zone (`Z` or `±hh:mm`) and not in the
 *      future. A bare `2026-11-02` is refused: `Date.parse` reads it as UTC midnight, so it moves a
 *      14-day window by up to a day.
 *
 * WHAT IT DOES NOT DO: it never fetches the URL (a 404 and a working post look the same here), and it
 * says nothing about whether the post is any good.
 */

/** `+hh:mm` is as explicit as `Z`; both name an instant. A bare date does not. */
export const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * The platforms this project actually publishes on. `channel` is the word an entry must contain for the
 * platform to be claimed; `match` is what its URL must look like.
 *
 * The X token is deliberately a *word*: `V2EX` must not be read as "X" (its `X` is preceded by a letter),
 * which is the kind of false positive that would reject a channel we do want to support.
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
 * @param {{ channel?: unknown, url?: unknown, postedOn?: unknown, now: string | Date }} input
 * @returns {{ ok: boolean, platform: string | null, problems: string[] }}
 */
export function judgePosting(input) {
  const channel = String(input?.channel ?? '')
  const url = String(input?.url ?? '')
  const postedOn = String(input?.postedOn ?? '')
  const nowMs = input?.now instanceof Date ? input.now.getTime() : Date.parse(String(input?.now ?? ''))

  const claimed = POSTING_PLATFORMS.find((platform) => platform.channel.test(channel)) ?? null
  const problems = []

  if (claimed === null) {
    // Named explicitly so the reader knows the fix is "say which platform", not "fight the regex".
    problems.push(`the channel names no platform this check can verify ("${channel}") — name discussion / issue / X`)
  } else if (!claimed.match.test(url)) {
    problems.push(`posted_url is not a ${claimed.id} URL (got "${url}")`)
  }

  if (!ISO_INSTANT.test(postedOn)) {
    problems.push(`posted_on is not an ISO-8601 instant with an explicit zone (got "${postedOn}") — use Z or ±hh:mm`)
  } else if (Number.isNaN(nowMs)) {
    problems.push('the reference time is unreadable, so "is it in the future" cannot be answered')
  } else if (Date.parse(postedOn) > nowMs) {
    problems.push(`posted_on is in the future (${postedOn})`)
  }

  return { ok: problems.length === 0, platform: claimed?.id ?? null, problems }
}
