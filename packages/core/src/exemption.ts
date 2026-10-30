/**
 * Profile version exemptions (`compatibility.json`).
 *
 * Upstream 0.2.x lets a profile record "this exact plugin version may run on this exact DSH
 * version" in `<profile>/compatibility.json`, and the loader honours it at boot. Our audit had
 * never read that file, so a profile with an active exemption was reported as `blocked` while the
 * real loader admitted it — the tool was wrong about the one thing it exists to answer.
 *
 * The format is not documented anywhere in the plugin manifest; it is the shape
 * `@deepseek-ai/dsh-app-boot#setProfileVersionExemption` writes:
 *
 *   { "<pkg>@<exact version>": ["<exact dsh version>", ...] }
 *
 * Unreadable or unparsable means "authorizes nothing" **and** "must not be rewritten", because
 * rewriting would discard whatever the user actually has in there.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const PROFILE_COMPATIBILITY_FILENAME = 'compatibility.json'

export interface ProfileExemptions {
  /** Accepted exact `name@version` keys mapped to the DSH versions they were granted for. */
  readonly exemptions: Readonly<Record<string, readonly string[]>>
  /** False when the file exists but could not be parsed; writing would lose the user's content. */
  readonly rewritable: boolean
  /** Human-readable problems; empty when the file was absent or fully valid. */
  readonly warnings: readonly string[]
}

/** Canonical exact SemVer — the same rule upstream applies before granting anything. */
export function isExactVersion(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
}

/** `name@version`, with the version exact. Returns null instead of guessing. */
export function parseExemptionKey(value: string): { name: string; version: string } | null {
  const at = value.lastIndexOf('@')
  if (at <= 0) return null
  const name = value.slice(0, at)
  const version = value.slice(at + 1)
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) return null
  if (!isExactVersion(version)) return null
  return { name, version }
}

export function readProfileExemptions(profileDir: string): ProfileExemptions {
  const file = join(profileDir, PROFILE_COMPATIBILITY_FILENAME)
  if (!existsSync(file)) return { exemptions: {}, rewritable: true, warnings: [] }
  const unreadable = (reason: string): ProfileExemptions => ({
    exemptions: {},
    rewritable: false,
    warnings: [`${file} ${reason}; treating the profile as having no exemptions`],
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return unreadable(`cannot be read (${error instanceof Error ? error.message : String(error)})`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return unreadable('does not contain an object of exemptions')
  }
  const out: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (parseExemptionKey(key) === null) return unreadable(`has a key that is not name@exact-version: ${key}`)
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !isExactVersion(entry))) {
      return unreadable(`has a non-exact runtime version for ${key}`)
    }
    out[key] = value as string[]
  }
  return { exemptions: out, rewritable: true, warnings: [] }
}

/** Is this exact plugin version exempted for this exact runtime? Never a range comparison. */
export function isExempted(
  exemptions: Readonly<Record<string, readonly string[]>>,
  name: string,
  version: string | null,
  runtime: string | null,
): boolean {
  if (version === null || runtime === null) return false
  const granted = exemptions[`${name}@${version}`]
  return granted !== undefined && granted.includes(runtime)
}
