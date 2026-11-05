/**
 * Rescue (M8) — "the host will not start, what is the smallest reversible thing I can try?"
 *
 * WHY THIS MODULE EXISTS: every other command in this package reads the profile and answers a
 * question. This one is the first that is *about* changing it, and the project's rule for that is
 * the same one `fix` follows: **the plan is the product, the write is a separate permission**.
 *
 * WHAT IT ANSWERS (A 段, this build): which entries of `dsh.profile.bundles` are third-party, which
 * ones are listed but not installed, and what a rescue would trim. Nothing is written.
 *
 * WHAT IT REFUSES TO SAY: that trimming them makes the host start. That is a runtime question and
 * only `probe --execute` can answer it; the CLI says so in the same breath (spec C5).
 *
 * THREE ORIGINS, NEVER TWO: `unresolved` is not a flavour of `third-party`. The first means the
 * file and the disk disagree; the second means the package is not ours. Merging them lets one
 * sentence ("you have 3 third-party bundles") describe two different failures.
 *
 * PURE / IMPURE SPLIT: `classifyBundles()` takes everything as input and touches nothing, so the
 * plan is reproducible byte for byte (C1). `readProfileBundles()` is the only function that reads
 * disk, and it reads exactly one file: `<profile>/package.json`.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type BundleOrigin = 'official' | 'third-party' | 'unresolved'

export interface DeclaredBundle {
  readonly name: string
  /** Verbatim value from the profile's `dependencies`, or `null` when it is not listed there. */
  readonly spec: string | null
}

export interface InstalledReading {
  readonly name: string
  readonly version: string | null
}

export interface RescueEntry {
  readonly name: string
  readonly spec: string | null
  readonly version: string | null
  readonly origin: BundleOrigin
  /** Whether a rescue would take it out of `dsh.profile.bundles`. */
  readonly removable: boolean
  /** One sentence for a human. Never a code, never a claim about booting. */
  readonly detail: string
  /** How to put it back: its index in the declared list plus the verbatim entry. */
  readonly restore: {
    readonly at: number
    readonly entry: string
  }
}

export interface RescuePlan {
  /** C7: this is read off the profile (`scanned`), never `declared`. */
  readonly evidence: 'scanned'
  readonly profile: string
  /** sha256 of the manifest **as read**. If it changes, something wrote (C4). */
  readonly manifestSha256: string
  /** Every declared bundle, in declared order. */
  readonly bundles: readonly RescueEntry[]
  readonly removable: readonly RescueEntry[]
  readonly thirdParty: number
  readonly unresolved: number
  readonly empty: boolean
  /** `absent` and `empty` are different facts and get different sentences (C6 / N6). */
  readonly field: 'present' | 'empty' | 'absent'
}

/* ------------------------------- classification ------------------------------- */

/**
 * A dependency value that points at this disk instead of a registry.
 *
 * `workspace:` is included because a workspace bundle is the user's code even when the name is
 * scoped `@deepseek-ai/...` — the scope says who named it, the spec says where it came from.
 */
const LOCAL_SPEC = /^(?:link:|file:|workspace:|portal:|\.{0,2}[\\/]|[A-Za-z]:[\\/])/

const OFFICIAL_SCOPE = '@deepseek-ai/'

export interface ClassifyInput {
  readonly profile: string
  readonly declared: readonly DeclaredBundle[]
  readonly installed: readonly InstalledReading[]
  readonly manifestSha256: string
  readonly field?: 'present' | 'empty' | 'absent'
}

/**
 * Pure: the whole answer is a function of the four inputs. No clock, no network, no disk.
 *
 * Order of the rules matters and is the only judgement in this function:
 *   1. not installed on disk  -> `unresolved` (the file and the disk disagree; that is not "third-party")
 *   2. local install shape    -> `third-party` (your code, whatever the scope says)
 *   3. official scope         -> `official`
 *   4. anything else          -> `third-party`
 */
export function classifyBundles(input: ClassifyInput): RescuePlan {
  const versions = new Map(input.installed.map((reading) => [reading.name, reading.version] as const))
  const bundles = input.declared.map((declared, index): RescueEntry => {
    const version = versions.get(declared.name) ?? null
    const local = declared.spec !== null && LOCAL_SPEC.test(declared.spec)
    const official = declared.name.startsWith(OFFICIAL_SCOPE) && !local

    const origin: BundleOrigin = version === null ? 'unresolved' : official ? 'official' : 'third-party'
    const detail =
      origin === 'unresolved'
        ? 'Listed in dsh.profile.bundles but not installed under this profile: trimming it makes the file match the disk.'
        : origin === 'official'
          ? 'Official bundle: outside what a rescue would trim.'
          : local
            ? 'Installed from a local path, so it is your own code: reversible to trim, and the first thing to try when the host will not start.'
            : 'Third-party bundle: reversible to trim, and the first thing to try when the host will not start.'

    return {
      name: declared.name,
      spec: declared.spec,
      version,
      origin,
      removable: origin !== 'official',
      detail,
      restore: { at: index, entry: declared.name },
    }
  })

  const field = input.field ?? (bundles.length === 0 ? 'empty' : 'present')
  return {
    evidence: 'scanned',
    profile: input.profile,
    manifestSha256: input.manifestSha256,
    bundles,
    removable: bundles.filter((entry) => entry.removable),
    thirdParty: bundles.filter((entry) => entry.origin === 'third-party').length,
    unresolved: bundles.filter((entry) => entry.origin === 'unresolved').length,
    empty: bundles.length === 0,
    field,
  }
}

/* ---------------------------------- reading ---------------------------------- */

export type ProfileBundlesReading =
  | {
      readonly ok: true
      readonly declared: readonly DeclaredBundle[]
      readonly manifestSha256: string
      readonly field: 'present' | 'empty' | 'absent'
    }
  | { readonly ok: false; readonly reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read exactly one file: `<profile>/package.json`.
 *
 * Returns `ok:false` (never throws) so the CLI can report "cannot read the profile" as a distinct
 * outcome from "nothing to trim" — the two are different answers and only one of them is good news.
 */
export function readProfileBundles(profileDir: string): ProfileBundlesReading {
  const file = join(profileDir, 'package.json')
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { ok: false, reason: `cannot read the profile manifest at ${file}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: `the profile manifest at ${file} is not valid JSON` }
  }
  if (!isRecord(parsed)) return { ok: false, reason: `the profile manifest at ${file} is not an object` }

  const dependencies = isRecord(parsed['dependencies']) ? (parsed['dependencies'] as Record<string, unknown>) : {}
  const dsh = isRecord(parsed['dsh']) ? parsed['dsh'] : {}
  const profile = isRecord(dsh['profile']) ? dsh['profile'] : {}
  const raw = profile['bundles']

  const manifestSha256 = createHash('sha256').update(text).digest('hex')
  if (!Array.isArray(raw)) {
    return { ok: true, declared: [], manifestSha256, field: 'absent' }
  }

  const declared: DeclaredBundle[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const spec = dependencies[entry]
    declared.push({ name: entry, spec: typeof spec === 'string' ? spec : null })
  }
  return { ok: true, declared, manifestSha256, field: declared.length === 0 ? 'empty' : 'present' }
}
