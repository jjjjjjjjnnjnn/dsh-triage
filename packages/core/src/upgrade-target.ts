/**
 * Resolve `--to next` / `--to latest` before the judgement (`T-806`, `docs/specs/M6-upgrade-day.md` C9).
 *
 * WHY THIS IS A SEPARATE PURE MODULE
 * ----------------------------------
 * Two things must stay true no matter who calls it:
 *
 *   1. **Only `next` and `latest` mean "ask the registry".** Every other string is either an
 *      exact version (judged fully offline) or a usage error. A typo like `--to canary` must not
 *      silently turn into a network read, and it must not turn into a finding either.
 *   2. **The resolved version is the registry's own string, verbatim.** `semver.valid('v0.3.0')`
 *      happily returns `0.3.0`; normalising here would mean the card says `0.3.0` while the
 *      registry published `v0.3.0`, which is exactly the kind of quiet rewrite this project
 *      refuses to do. A tag whose value is not already an exact version string is a refusal
 *      (`tag-not-exact`), never a normalisation.
 *
 * The caller does the I/O (one `fetchPackument('@deepseek-ai/dsh')`) and hands the raw
 * `dist-tags` object in. Nothing in this file reads the network, the clock or the environment.
 */

import { valid } from 'semver'

/** The two keywords that are allowed to touch the registry. Case-insensitive on input. */
export const DIST_TAG_TARGETS = ['next', 'latest'] as const

export type DistTagTarget = (typeof DIST_TAG_TARGETS)[number]

/** The package whose `dist-tags` define "the next dsh". */
export const DIST_TAG_PACKAGE = '@deepseek-ai/dsh'

/**
 * Which keyword was asked for, if any.
 *
 * Returns `null` for an exact version (the caller keeps going fully offline) and for anything
 * else (the caller reports a usage error). Whitespace is trimmed; case is ignored.
 */
export function distTagTargetOf(requested: string): DistTagTarget | null {
  const normalized = requested.trim().toLowerCase()
  for (const tag of DIST_TAG_TARGETS) if (normalized === tag) return tag
  return null
}

export type DistTagResolution =
  | { readonly ok: true; readonly tag: DistTagTarget; readonly version: string }
  | { readonly ok: false; readonly code: 'not-a-tag'; readonly detail: string }
  | { readonly ok: false; readonly code: 'tag-missing'; readonly detail: string }
  | { readonly ok: false; readonly code: 'tag-not-exact'; readonly detail: string }

/**
 * `dist-tags` -> the exact version the tag names, or a refusal that says which one and why.
 *
 * `tag-missing` lists the tags that *are* published: "there is no `next`" is a different
 * sentence from "the registry is unreachable", and the user's next action differs.
 */
export function resolveDistTagTarget(input: {
  readonly requested: string
  readonly distTags: Readonly<Record<string, string>>
}): DistTagResolution {
  const tag = distTagTargetOf(input.requested)
  if (tag === null) {
    return {
      ok: false,
      code: 'not-a-tag',
      detail: `"${input.requested.trim()}" is not a dist-tag target; only ${DIST_TAG_TARGETS.join(' / ')} are resolved from the registry`,
    }
  }
  const value = input.distTags[tag]
  if (typeof value !== 'string' || value.trim() === '') {
    const known = Object.keys(input.distTags).sort().join(', ')
    return {
      ok: false,
      code: 'tag-missing',
      detail:
        known === ''
          ? `${DIST_TAG_PACKAGE} publishes no dist-tags at all, so "${tag}" cannot be resolved`
          : `${DIST_TAG_PACKAGE} publishes no "${tag}" dist-tag (it has: ${known})`,
    }
  }
  const trimmed = value.trim()
  // Verbatim, not normalised: `valid('v1.2.3')` returns `1.2.3`, and that rewrite is not ours to make.
  if (valid(trimmed) !== trimmed) {
    return {
      ok: false,
      code: 'tag-not-exact',
      detail: `dist-tag "${tag}" points at "${value}", which is not an exact version string (ranges and normalised forms are refused)`,
    }
  }
  return { ok: true, tag, version: trimmed }
}
