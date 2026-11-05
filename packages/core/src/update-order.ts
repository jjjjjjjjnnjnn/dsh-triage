/**
 * Publish order versus semver order — "is the version the manager would offer actually newer?"
 *
 * WHY THIS FILE EXISTS (T-861, discussion #12209): `@deepseek-ai/dsh-plugin-manager` decides what
 * counts as an update with `semver.gt(version, installed)` and never looks at publish time. When a
 * package renumbers its line downward (`0.12.x` → `0.2.0`), every surviving `0.12.x` build sorts
 * higher than the installed `0.2.6`, so the manager offers older code as an update. If that build's
 * `engines.dsh` is refused by the running runtime, the bundle is skipped at boot — the user clicks
 * "update" and ends up with no plugin.
 *
 * WHAT THIS ADDS: the missing half of the comparison. `admission` answers "would this build be
 * refused?"; this answers "is this build older than what I have?".
 *
 * HARD RULES (locked by tests, see docs/specs/M9-downgrade-trap.md):
 * - **pure and offline**: callers hand in registry facts, nothing here touches the network;
 * - **evidence only**: this never decides `go` / `blocked`, and never rewrites a row's conclusion;
 * - **three states, never two**: `trap` / `no-candidate` / `unmeasured` are separate answers.
 *   "Could not read the publish times" must not look like "no trap", which is the exact mistake
 *   R83 had to retract in public;
 * - **`latest-lags` is not a trap**: a `latest` tag below the highest published version is a
 *   channel fact (prerelease lines, abandoned tags). It is reported separately so the two are
 *   never merged into one sentence.
 */

import { compare, prerelease, valid } from 'semver'
import type { RegistryFacts } from './version-drift.js'

export type UpdateOrderVerdict = 'trap' | 'no-trap' | 'no-candidate' | 'unmeasured'

export interface UpdateOrderCandidate {
  readonly version: string
  readonly publishedAt: string
  /** Positive: the candidate was published **before** the installed version. */
  readonly daysOlder: number
}

export interface UpdateOrder {
  readonly verdict: UpdateOrderVerdict
  readonly installed: string
  readonly installedPublishedAt: string | null
  /** The highest version above `installed`; `null` when there is none or the answer is unmeasured. */
  readonly candidate: UpdateOrderCandidate | null
  /**
   * `dist-tags.latest` points below the highest published version. A channel fact, not a trap —
   * "latest is behind" is normal for prerelease lines and is already what `version-drift` reports.
   */
  readonly latestLags: boolean
  /** Machine-stable one-liner (English). The CLI renders its own text from the fields. */
  readonly detail: string
}

const DAY_MS = 86_400_000

const isPrerelease = (version: string): boolean => (prerelease(version)?.length ?? 0) > 0

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function newestOf(versions: readonly string[]): string | null {
  let newest: string | null = null
  for (const version of versions) {
    if (valid(version) === null) continue
    if (newest === null || compare(version, newest) > 0) newest = version
  }
  return newest
}

/**
 * Judge one installed package against its registry facts.
 *
 * `installed` must be an exact published version: comparing against a range or a tag would mean
 * guessing what is on disk, and a wrong "trap" would be worse than no answer.
 */
export function judgeUpdateOrder(facts: RegistryFacts, installed: string): UpdateOrder {
  const times = facts.publishedAt ?? {}
  const latestLags = (() => {
    if (facts.latest === null || valid(facts.latest) === null) return false
    const newest = newestOf(facts.versions)
    return newest !== null && compare(newest, facts.latest) > 0
  })()

  const unmeasured = (detail: string): UpdateOrder => ({
    verdict: 'unmeasured',
    installed,
    installedPublishedAt: times[installed] ?? null,
    candidate: null,
    latestLags,
    detail,
  })

  if (valid(installed) === null) {
    return unmeasured(`"${installed}" is not an exact version, so publish order cannot be compared`)
  }
  const installedPublishedAt = times[installed]
  if (installedPublishedAt === undefined) {
    return unmeasured('the registry has no publish time for the installed version')
  }

  const above = facts.versions.filter((version) => valid(version) !== null && compare(version, installed) > 0)
  if (above.length === 0) {
    return {
      verdict: 'no-candidate',
      installed,
      installedPublishedAt,
      candidate: null,
      latestLags,
      detail: 'no published version has a higher semver than the installed one',
    }
  }

  const highest = newestOf(above) as string
  const candidatePublishedAt = times[highest]
  if (candidatePublishedAt === undefined) {
    return unmeasured(`the registry has no publish time for ${highest}`)
  }

  const installedAt = Date.parse(installedPublishedAt)
  const candidateAt = Date.parse(candidatePublishedAt)
  if (Number.isNaN(installedAt) || Number.isNaN(candidateAt)) {
    return unmeasured('a publish time could not be parsed as an instant')
  }

  const daysOlder = round1((installedAt - candidateAt) / DAY_MS)
  const candidate: UpdateOrderCandidate = { version: highest, publishedAt: candidatePublishedAt, daysOlder }
  const prereleaseNote = isPrerelease(highest) ? ' (prerelease)' : ''
  return {
    verdict: daysOlder > 0 ? 'trap' : 'no-trap',
    installed,
    installedPublishedAt,
    candidate,
    latestLags,
    detail:
      daysOlder > 0
        ? `a semver-only comparison would offer ${highest}${prereleaseNote}, published ${String(daysOlder)} day(s) before the installed ${installed}`
        : `the highest semver above ${installed} was published later, so semver order and publish order agree`,
  }
}
