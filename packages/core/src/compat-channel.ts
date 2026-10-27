/**
 * `dsh.compatibility` — the declaration channel we did not read (BS-13 / T-108).
 *
 * WHY THIS FILE EXISTS (CASE-7590): the case was scored as a miss because neither
 * plugin declares an `@deepseek-ai/dsh*` peer range. The R6 adversary pass showed
 * "declares nothing" was too strong: `@xmanrui/dsh-im` carries
 *
 *     "dsh": { "compatibility": { "dsh": "0.1.7-alpha.1",
 *              "dshReleases": { "0.1.7-alpha.1": "compatible" } } }
 *
 * while the profile runs `0.1.7-alpha.2`. The information was in the manifest all
 * along; the engine only ever looked at `engines.dsh` and peers.
 *
 * HARD RULE (tier discipline): this channel never decides admission. It is
 * `declared`-tier **secondary** evidence that gets listed next to the admission
 * conclusion. It can never produce `blocked` on its own, and it can never upgrade
 * an `unknown` to `go` — the author's self-declaration is not a measurement.
 *
 * Parsing is defensive: unknown shapes degrade to `null` (no channel), never to a
 * guess. `evaluateRange` is reused from `admission.ts` so that prerelease and
 * empty/invalid-range semantics stay byte-identical with the admission engine.
 */

import { valid } from 'semver'

import { evaluateRange } from './admission.js'

/** One author-published per-release statement (`dsh.compatibility.dshReleases`). */
export interface CompatRelease {
  readonly version: string
  readonly status: string
}

/** The parsed channel, flattened enough to be rendered without guessing. */
export interface CompatChannel {
  /** One-line summary a user can act on, e.g. `dsh 0.1.7-alpha.1`. */
  readonly claim: string
  /** `dsh.compatibility.dsh`, verbatim (may be a version or a range). */
  readonly pinned: string | null
  /** `dsh.compatibility.dshReleases`, sorted by version. */
  readonly releases: readonly CompatRelease[]
  /** `dsh.compatibility.profiles`, sorted. */
  readonly profiles: readonly string[]
}

/**
 * Compare keys the way an author would write them, not byte-for-byte.
 *
 * WHY (R9 adversary finding): `dshReleases` is a hand-written object in someone's
 * package.json, so `v0.1.7-alpha.2` or `" 0.1.7-alpha.2 "` happen. A byte compare
 * missed the entry, fell through to a broader `dsh: "*"` statement, and reported a
 * *match* for a build the author had explicitly marked incompatible — the one
 * direction this channel must never get wrong.
 */
function normalizeVersion(value: string): string {
  const trimmed = value.trim().replace(/^[=v]+/i, '')
  return valid(trimmed) ?? trimmed
}

/** What the author's own channel says about the running build. */
export type CompatStanding = 'match' | 'mismatch' | 'unknown'

export interface CompatReading {
  readonly channel: CompatChannel
  readonly standing: CompatStanding
}

/** Release statuses that mean "the author says this build is fine". */
const COMPATIBLE_STATUS = new Set(['compatible', 'ok', 'supported', 'yes', 'true'])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Parse `dsh.compatibility` out of a plugin manifest.
 *
 * Returns `null` when the manifest says nothing in this channel — the absence is
 * reported as "no secondary evidence", never as "compatible".
 */
export function readCompatChannel(manifest: unknown): CompatChannel | null {
  const dsh = asRecord(asRecord(manifest)?.['dsh'])
  const compatibility = asRecord(dsh?.['compatibility'])
  if (compatibility === null) return null

  const rawPinned = compatibility['dsh']
  const pinned = typeof rawPinned === 'string' && rawPinned.trim() !== '' ? rawPinned.trim() : null

  const releases: CompatRelease[] = []
  const rawReleases = asRecord(compatibility['dshReleases'])
  if (rawReleases !== null) {
    for (const [version, value] of Object.entries(rawReleases)) {
      if (typeof value === 'string' && value.trim() !== '') {
        releases.push({ version, status: value.trim() })
      }
    }
    releases.sort((a, b) => a.version.localeCompare(b.version))
  }

  const profiles: string[] = []
  const rawProfiles = compatibility['profiles']
  if (Array.isArray(rawProfiles)) {
    for (const value of rawProfiles) {
      if (typeof value === 'string' && value.trim() !== '') profiles.push(value.trim())
    }
    profiles.sort((a, b) => a.localeCompare(b))
  }

  if (pinned === null && releases.length === 0 && profiles.length === 0) return null

  return { claim: claimOf(pinned, releases, profiles), pinned, releases, profiles }
}

function claimOf(pinned: string | null, releases: readonly CompatRelease[], profiles: readonly string[]): string {
  if (pinned !== null) return `dsh ${pinned}`
  if (releases.length > 0) {
    return `dshReleases ${releases.map((release) => `${release.version}: ${release.status}`).join(', ')}`
  }
  return `profiles ${profiles.join(', ')}`
}

/**
 * Judge the channel against the running build.
 *
 * Order of authority inside the channel: an exact `dshReleases` entry for this
 * runtime beats the broader `dsh` statement; `profiles` alone can never judge a
 * version, so it stays `unknown`.
 */
export function judgeCompatChannel(manifest: unknown, runtime: string | null): CompatReading | null {
  const channel = readCompatChannel(manifest)
  if (channel === null) return null
  if (runtime === null || runtime.trim() === '') return { channel, standing: 'unknown' }

  const wanted = normalizeVersion(runtime)
  const exact = channel.releases.find((release) => normalizeVersion(release.version) === wanted)
  if (exact !== undefined) {
    const status = exact.status.toLowerCase()
    const compatible = COMPATIBLE_STATUS.has(status)
    // Anything the author wrote that is not a known "yes" is not a "yes": the
    // conservative reading is exactly what keeps this channel from ever blocking.
    return { channel, standing: compatible ? 'match' : 'mismatch' }
  }

  if (channel.pinned !== null) {
    const evaluated = evaluateRange(channel.pinned, runtime)
    return { channel, standing: evaluated.satisfied ? 'match' : 'mismatch' }
  }

  return { channel, standing: 'unknown' }
}
