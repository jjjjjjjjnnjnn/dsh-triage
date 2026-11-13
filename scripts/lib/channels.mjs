/**
 * "Which channels did we actually publish on, and does any of them feed D5?" (R73)
 *
 * WHY THIS EXISTS: distribution grew from one discussion to four channels (GitHub, X, two subreddits)
 * between R56 and R73. Only the GitHub one was machine-checked (`docs/distribution/T-810/registry.json`);
 * the rest lived in prose tables. Two failure modes follow:
 *
 *   1. **a dead or mistyped link** — the R57 lesson ("cites a missing artifact") applied to URLs. Prose
 *      tables are not read by anything, so a typo survives until a human clicks it;
 *   2. **promotion quietly becoming evidence** — the tempting move on 2026-11-15 is "we posted in four
 *      places, surely that counts". It does not: `docs/specs/D5-measurement.md` §1 counts reactions on
 *      **one** discussion, external references found by **GitHub search**, and weekly downloads from a
 *      baseline. A Reddit upvote is none of those. This module makes that a checked field instead of a
 *      paragraph someone can forget (`why_not_counted`).
 *
 * WHAT IT DOES NOT DO: it never fetches a URL. Reachability was checked by hand once (`HTTP 200` on
 * 2026-11-02) and the reddit pages could not be read from this machine at all (403), which is why every entry
 * has to state its own `evidence` level instead of assuming "posted" means "verified".
 */

import { parseInstant } from './posting.mjs'

/** The lanes this project publishes in. A URL on any other host cannot be recorded as one of ours. */
export const CHANNEL_PLATFORMS = Object.freeze({
  'github-discussion': /^https:\/\/github\.com\/[^/]+\/[^/]+\/discussions\/\d+$/,
  /*
   * A submission into somebody else's list is a pull request, not a discussion: `awesome-dsh-plugin`
   * takes one file per plugin via PR (R104). Keeping it in its own lane means "we have a PR open" can
   * never be read as "we posted in a discussion", which matters because only the latter can feed D5.
   */
  'github-pull': /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/,
  x: /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/,
  reddit: /^https:\/\/(?:www\.)?reddit\.com\/r\/[A-Za-z0-9_]+\/comments\/[A-Za-z0-9]+(?:\/[^?#]*)?\/?$/,
})

/**
 * How solid the "it is live" claim is. `measured` = we read it back from the platform's own API;
 * `declared-url-reachable` = a HEAD request answered 200 but the page content could not be read;
 * `declared` = a human says so and nothing on this machine can check it.
 */
export const CHANNEL_EVIDENCE = Object.freeze(['measured', 'declared-url-reachable', 'declared'])

/**
 * @param {{
 *   channels: unknown,
 *   now: string | number | Date,
 *   registryUrl?: string | null,
 *   registryPostedOn?: string | null,
 * }} input
 * @returns {{ ok: boolean, problems: string[], counted: string | null }}
 */
export function judgeChannels(input) {
  const problems = []
  const channels = Array.isArray(input?.channels) ? input.channels : []
  if (channels.length === 0) return { ok: false, problems: ['the channel ledger lists nothing'], counted: null }

  const rawNow = input?.now
  const nowMs =
    typeof rawNow === 'number' ? rawNow : rawNow instanceof Date ? rawNow.getTime() : Date.parse(String(rawNow ?? ''))

  const seenIds = new Set()
  const seenUrls = new Set()
  const counted = []

  for (const channel of channels) {
    if (channel === null || typeof channel !== 'object' || Array.isArray(channel)) {
      problems.push('a channel entry is not an object')
      continue
    }
    const id = String(channel.id ?? '')
    if (id.length === 0) problems.push('a channel entry has no id')
    else if (seenIds.has(id)) problems.push(`duplicate channel id "${id}"`)
    seenIds.add(id)

    const platform = String(channel.platform ?? '')
    const pattern = CHANNEL_PLATFORMS[platform]
    const url = String(channel.url ?? '')
    if (pattern === undefined) {
      problems.push(`${id || '<no id>'}: unknown platform "${platform}" (expected ${Object.keys(CHANNEL_PLATFORMS).join(' / ')})`)
    } else if (!pattern.test(url)) {
      // Printed as a pair, because "the URL is wrong" and "the platform is wrong" need different fixes.
      problems.push(`${id || '<no id>'}: url does not look like a ${platform} link (got "${url}")`)
    }
    if (seenUrls.has(url)) problems.push(`duplicate url recorded twice: ${url}`)
    seenUrls.add(url)

    if (!CHANNEL_EVIDENCE.includes(String(channel.evidence))) {
      problems.push(`${id || '<no id>'}: evidence must be one of ${CHANNEL_EVIDENCE.join(' / ')} (got "${String(channel.evidence)}")`)
    }

    if (channel.d5_counts === true) {
      counted.push({ id, url })
      /*
       * A date is required *because* D5 derives a 14-day window from it (`D5-measurement.md` §2). R64 paid for
       * this: a timestamp written without a zone moved the deadline by seven hours and nobody could see it.
       */
      const instant = parseInstant(channel.posted_on)
      if (instant === null) {
        problems.push(`${id}: d5_counts requires a real ISO instant in posted_on (got ${JSON.stringify(channel.posted_on ?? null)})`)
      } else if (!Number.isFinite(nowMs)) {
        problems.push(`${id}: the reference time is unreadable, so "is it in the future" cannot be answered`)
      } else if (instant.epochMs > nowMs) {
        problems.push(`${id}: posted_on is in the future (${String(channel.posted_on)})`)
      }
      if (typeof input?.registryUrl === 'string' && input.registryUrl.length > 0 && url !== input.registryUrl) {
        problems.push(`${id}: the counted channel is ${url}, but the D5 registry names ${input.registryUrl} — one of them is wrong`)
      }
      if (typeof input?.registryPostedOn === 'string' && input.registryPostedOn.length > 0) {
        const registryInstant = parseInstant(input.registryPostedOn)
        if (registryInstant === null) {
          problems.push('the D5 registry posted_on is not a real instant, so the counted channel cannot be cross-checked')
        } else if (instant !== null && instant.epochMs !== registryInstant.epochMs) {
          problems.push(`${id}: posted_on and the D5 registry disagree by ${Math.abs(instant.epochMs - registryInstant.epochMs)}ms`)
        }
      }
    } else if (channel.d5_counts === false) {
      // The honest-by-construction field: not counting is allowed, being silent about why is not.
      if (typeof channel.why_not_counted !== 'string' || channel.why_not_counted.trim().length < 12) {
        problems.push(`${id || '<no id>'}: d5_counts=false needs a why_not_counted sentence (this is how promotion stops looking like evidence)`)
      }
    } else {
      problems.push(`${id || '<no id>'}: d5_counts must be true or false (got ${JSON.stringify(channel.d5_counts ?? null)})`)
    }
  }

  /*
   * Exactly one channel feeds D5: the spec counts one discussion's reactions. Two counted channels would
   * mean someone added a number to the verdict that the frozen spec does not allow.
   */
  if (counted.length !== 1) {
    problems.push(`exactly one channel may have d5_counts=true (found ${counted.length}${counted.length > 0 ? `: ${counted.map((entry) => entry.id).join(', ')}` : ''})`)
  }

  return { ok: problems.length === 0, problems, counted: counted.length === 1 ? counted[0].id : null }
}
