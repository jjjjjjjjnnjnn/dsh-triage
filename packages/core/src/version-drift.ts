/**
 * Registry version facts: is the tag you are about to install the build you meant?
 *
 * WHY THIS FILE EXISTS (T-109 / CASE-10849, CASE-10201): `@deepseek-ai/dsh-tools`
 * published `latest = 0.0.1-rc.1` while `0.2.1-rc.x` was already on the registry.
 * A user who ran `dsh plugin add @deepseek-ai/dsh-tools` got the stale build, and
 * admission then denied it 鈥?the failure started one step earlier than anything we
 * used to look at. The same shape appears whenever a maintainer forgets to move the
 * tag after a release, which for a harness on a weekly rc cadence is common.
 *
 * SECOND JOB (T-115, syncpack's idea): the *shape* of a declared range predicts how
 * the plugin will age. An exact pin (`0.2.1-rc.2`) is denied by the very next patch
 * release; an unbounded range (`*`, `>=0.2.0`) silently admits a breaking major.
 * That is author-side advice, never a verdict on the user's machine.
 *
 * HARD RULES (enforced by tests):
 * - pure and offline: callers hand in already-fetched registry facts, nothing here
 *   touches the network;
 * - this module never decides `go` / `blocked`. Registry facts are `measured-registry`
 *   tier 鈥?they explain, they do not overrule the declaration layer;
 * - "latest is a stable build, a newer prerelease exists" is *not* drift. Calling that
 *   a defect would flag every package that ships prereleases, which is the whole
 *   harness ecosystem.
 */

import { compare, prerelease, rsort, valid, validRange } from 'semver'

/** The registry facts we consume, independent of the npm adapter's shape. */
export interface RegistryFacts {
  readonly latest: string | null
  readonly next: string | null
  readonly versions: readonly string[]
  readonly publishedAt?: Readonly<Record<string, string>>
  /**
   * Versions the author marked `deprecated`. Excluded from "newest published":
   * telling someone "0.2.1-rc.4 is newer" when the author deprecated it would be
   * advice that actively harms them, and deprecation is exactly the signal that the
   * build should not be installed.
   */
  readonly deprecated?: readonly string[]
}

/**
 * How the `latest` tag relates to what is actually published.
 *
 * - `none`: the tag points at the newest build for its channel;
 * - `latest-behind`: newer builds than `latest` exist on the same channel 鈥?the tag
 *   is stale, and installing the bare name gets you an old build;
 * - `prerelease-ahead`: `latest` is a stable build and newer *prereleases* exist.
 *   Normal, informational only;
 * - `latest-missing`: no `latest` tag at all;
 * - `latest-unpublished`: the tag names a version that is not published, so
 *   `install <name>` cannot resolve at all;
 * - `latest-deprecated`: the tag points at a build the author deprecated;
 * - `unknown`: nothing usable to compare.
 */
export type DriftStanding =
  | 'none'
  | 'latest-behind'
  | 'prerelease-ahead'
  | 'latest-missing'
  | 'latest-unpublished'
  | 'latest-deprecated'
  | 'unknown'

export interface VersionDrift {
  readonly latest: string | null
  readonly next: string | null
  /** Highest published version, prereleases included. */
  readonly newest: string | null
  /** Highest published stable version, `null` when the package only ships prereleases. */
  readonly newestStable: string | null
  /** Publish timestamp of `newest`, when the registry supplied one. */
  readonly newestPublishedAt: string | null
  readonly standing: DriftStanding
  /** Machine-stable one-liner; the localized copy lives in `messages.ts`. */
  readonly detail: string
}

const isPrerelease = (version: string): boolean => (prerelease(version)?.length ?? 0) > 0

/** Canonical comparison key: tolerates `v1.2.3`, `=1.2.3`, and surrounding spaces. */
function normalizeVersion(value: string): string {
  const trimmed = value.trim().replace(/^[=v]+/i, '')
  return valid(trimmed) ?? trimmed
}

export function judgeVersionDrift(facts: RegistryFacts): VersionDrift {
  const deprecated = new Set((facts.deprecated ?? []).map(normalizeVersion))
  const validVersions = facts.versions.filter((version) => valid(version) !== null)
  const known = validVersions.filter((version) => !deprecated.has(normalizeVersion(version)))
  const base = {
    latest: facts.latest,
    next: facts.next,
    newest: null as string | null,
    newestStable: null as string | null,
    newestPublishedAt: null as string | null,
  }
  if (known.length === 0) {
    return {
      ...base,
      standing: 'unknown',
      detail:
        validVersions.length === 0
          ? 'no published version is valid semver'
          : 'every published version is deprecated',
    }
  }

  const sorted = rsort([...known])
  const newest = sorted[0] ?? null
  const stable = sorted.find((version) => !isPrerelease(version)) ?? null
  const newestPublishedAt = newest === null ? null : (facts.publishedAt?.[newest] ?? null)
  const factsOut = { ...base, newest, newestStable: stable, newestPublishedAt }

  if (facts.latest === null) {
    return { ...factsOut, standing: 'latest-missing', detail: 'no "latest" dist-tag is published' }
  }
  if (valid(facts.latest) === null) {
    return { ...factsOut, standing: 'unknown', detail: `"latest" tag value "${facts.latest}" is not a valid version` }
  }

  // A tag pointing at a version that was never published is not "fine": `install
  // <name>` cannot resolve it at all (R10 adversary finding — the old code fell
  // through to `none` and printed "points at the newest published build").
  const published = new Set(validVersions.map((version) => normalizeVersion(version)))
  if (!published.has(normalizeVersion(facts.latest))) {
    return {
      ...factsOut,
      standing: 'latest-unpublished',
      detail: `"latest" names ${facts.latest}, which is not in the published version list`,
    }
  }
  if (deprecated.has(normalizeVersion(facts.latest))) {
    return {
      ...factsOut,
      standing: 'latest-deprecated',
      detail: `"latest" points at ${facts.latest}, which the author deprecated`,
    }
  }

  if (isPrerelease(facts.latest)) {
    // Same-channel comparison: `latest` itself is a prerelease.
    if (newest !== null && compare(newest, facts.latest) > 0) {
      return {
        ...factsOut,
        standing: 'latest-behind',
        detail: `"latest" is ${facts.latest} but ${newest} is already published`,
      }
    }
    return { ...factsOut, standing: 'none', detail: `"latest" points at the newest published build (${facts.latest})` }
  }

  // `latest` is a stable build: compare against stable builds only, then report a
  // newer prerelease separately instead of calling it drift.
  if (stable !== null && compare(stable, facts.latest) > 0) {
    return {
      ...factsOut,
      standing: 'latest-behind',
      detail: `"latest" is ${facts.latest} but ${stable} is already published`,
    }
  }
  if (newest !== null && compare(newest, facts.latest) > 0) {
    return {
      ...factsOut,
      standing: 'prerelease-ahead',
      detail: `"latest" stays on the stable build ${facts.latest}; a newer prerelease ${newest} is published`,
    }
  }
  return { ...factsOut, standing: 'none', detail: `"latest" points at the newest published build (${facts.latest})` }
}

/* ------------------------------ range shapes ------------------------------- */

/**
 * - `exact`: a single version with no operator, e.g. `0.2.1-rc.2`;
 * - `unbounded`: `*`, `x`, or a bare `>=鈥 with no upper bound 鈥?a breaking major is
 *   admitted silently;
 * - `bounded`: `^`, `~`, `>=x <y`, `1.x`, 鈥?whatever keeps an upper bound;
 * - `unusable`: empty, invalid, or a `workspace:` protocol range;
 * - `absent`: nothing declared.
 */
export type RangeShape = 'exact' | 'unbounded' | 'bounded' | 'unusable' | 'absent'

export interface RangeShapeReading {
  readonly shape: RangeShape
  readonly range: string
}

const EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function judgeRangeShape(range: unknown): RangeShapeReading {
  if (typeof range !== 'string' || range.trim() === '') {
    return { shape: 'absent', range: typeof range === 'string' ? range : '' }
  }
  const value = range.trim()
  const peeled = value.replace(/^=\s*/, '')
  if (value.startsWith('workspace:')) return { shape: 'unusable', range: value }
  if (EXACT_VERSION.test(peeled)) return { shape: 'exact', range: value }
  const normalized = validRange(peeled)
  if (normalized === null) return { shape: 'unusable', range: value }
  // Ask semver for the *expanded* range instead of pattern-matching the literal:
  // `1.x` and `1.2` look unbounded but normalise to `>=1.0.0 <2.0.0-0`. An arm that
  // is itself a complete version (`1.2.3 || 4.5.6`) is bounded by definition — it
  // cannot drift — so it must not be reported as "no upper bound" (R10 adversary
  // finding: `=1.2.3` used to fall through to `unbounded` and emit a false warn).
  const arms = normalized.split('||').map((arm) => arm.trim())
  const everyArmBounded = arms.every(
    (arm) => arm.includes('<') || EXACT_VERSION.test(arm.replace(/^=\s*/, '')),
  )
  return { shape: everyArmBounded ? 'bounded' : 'unbounded', range: value }
}
