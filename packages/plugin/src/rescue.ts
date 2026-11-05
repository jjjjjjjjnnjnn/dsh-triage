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
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
    /*
     * An official-scope bundle we cannot resolve is REPORTED, never trimmed: the likeliest cause is
     * our own resolver not understanding the layout (a non-hoisted store, a nested copy), and
     * "trim the core bundle because we could not find it" is the single most destructive thing this
     * command could do. A third-party bundle that is not installed is different: the file already
     * disagrees with the disk, and putting the line back is one `--undo` away.
     */
    const removable = origin === 'third-party' || (origin === 'unresolved' && !official)
    const detail =
      origin === 'unresolved'
        ? official
          ? 'Listed in dsh.profile.bundles but not installed under this profile, and it is an official bundle: reported only — check the install before trimming a core bundle.'
          : 'Listed in dsh.profile.bundles but not installed under this profile: trimming it makes the file match the disk.'
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
      removable,
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

/* ----------------------------------- apply ----------------------------------- */

/**
 * B 段: the one write this tool performs on a profile, and the reason it is written this way.
 *
 * - **only `dsh.profile.bundles`** changes; `dependencies` is copied verbatim, so "undo" stays an
 *   array edit instead of a reinstall (spec §3 rule 3);
 * - **backup → atomic replace → read back → journal**, in that order; a failure at any point puts
 *   the original bytes back before the error escapes;
 * - **the journal carries before/after sha256**, so `undoRescue` can refuse to overwrite a profile
 *   the user edited in the meantime instead of quietly discarding their change.
 */

export interface RescueChange {
  readonly file: string
  readonly before: string | null
  readonly after: string
  readonly backup: string | null
  readonly removed: readonly { readonly name: string; readonly at: number }[]
}

export interface RescueRun {
  readonly journal: string
  readonly backupDir: string | null
  readonly changes: readonly RescueChange[]
  readonly removed: readonly string[]
  readonly dryRun: boolean
}

export interface ApplyRescueInput {
  readonly plan: RescuePlan
  readonly profileDir: string
  readonly stamp: string
  readonly dryRun: boolean
  /**
   * Test seam, called **after** the backup exists and **before** the atomic write. Throwing here
   * is how "a failed apply must roll back" is proven without pretending to be the disk.
   */
  readonly beforeWrite?: () => void
  /**
   * Test seam, called **after** the atomic write and **before** the read-back verification. This is
   * the failure that matters: the file has already changed, so only a rollback can save it.
   */
  readonly afterWrite?: () => void
}

interface RescueJournal {
  readonly schema_version: 1
  readonly produced_by: 'packages/plugin/src/rescue.ts'
  readonly generated_at: string
  readonly profile_dir: string
  readonly backup: string
  readonly removed: readonly { readonly name: string; readonly at: number }[]
  readonly before_sha256: string
  readonly after_sha256: string
  readonly before: string
  readonly after: string
}

const MANIFEST = 'package.json'

/** Windows cannot create a directory named `10:30`, so the stamp is made filesystem-safe. */
export function safeStamp(stamp: string): string {
  return stamp.replace(/[:.]/g, '-')
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Atomic write: temp file beside the target, then rename. A crash never leaves half a file. */
function atomicWrite(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600 })
  try {
    if (existsSync(file)) statSync(file)
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

/** Serialise keeping key order (JSON.parse preserves it) and the repo's 2-space + newline shape. */
function serializeManifest(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/**
 * Take the removable entries out of `dsh.profile.bundles`.
 *
 * `dryRun` (the CLI default) writes **nothing at all** — no directory, no backup, no journal — so a
 * preview can never leave a trace (C4 still holds after B 段).
 */
export function applyRescue(input: ApplyRescueInput): RescueRun {
  const removable = input.plan.removable
  if (input.dryRun || removable.length === 0) {
    return { journal: '', backupDir: null, changes: [], removed: [], dryRun: true }
  }

  const file = join(input.profileDir, MANIFEST)
  const before = readFileSync(file, 'utf8')
  const parsed: unknown = JSON.parse(before)
  if (!isRecord(parsed)) throw new Error(`${file} is not an object; refusing to edit it`)
  const dsh = isRecord(parsed['dsh']) ? parsed['dsh'] : null
  const profile = dsh !== null && isRecord(dsh['profile']) ? dsh['profile'] : null
  if (profile === null || !Array.isArray(profile['bundles'])) {
    throw new Error(`${file} has no dsh.profile.bundles array; refusing to invent one`)
  }

  const names = new Set(removable.map((entry) => entry.name))
  const kept: string[] = []
  const removed: { name: string; at: number }[] = []
  for (const [index, entry] of (profile['bundles'] as unknown[]).entries()) {
    if (typeof entry === 'string' && names.has(entry)) {
      removed.push({ name: entry, at: index })
      continue
    }
    kept.push(entry as string)
  }
  if (removed.length === 0) {
    // The plan said there was something to trim and the file disagrees: stop rather than "succeed".
    throw new Error('the plan lists removable bundles but the manifest no longer contains them')
  }

  const nextManifest: Record<string, unknown> = { ...parsed }
  nextManifest['dsh'] = { ...dsh, profile: { ...profile, bundles: kept } }
  const after = serializeManifest(nextManifest)

  const base = safeStamp(input.stamp)
  const journalDir = join(input.profileDir, '.dsh-triage', 'rescue')
  const backupDir = join(journalDir, base)
  mkdirSync(backupDir, { recursive: true })
  const backup = join(backupDir, MANIFEST)
  copyFileSync(file, backup)

  try {
    input.beforeWrite?.()
    atomicWrite(file, after)
    input.afterWrite?.()
    // Read back: a write we cannot verify is not a write we can call done.
    const readBack = readFileSync(file, 'utf8')
    if (readBack !== after) throw new Error('the manifest did not read back as written; rolling back')
    const check = readProfileBundles(input.profileDir)
    if (!check.ok) throw new Error(`the manifest could not be re-read after writing: ${check.reason}`)
    if (check.declared.length !== kept.length) {
      throw new Error(`expected ${kept.length} bundle(s) after the write, read back ${check.declared.length}`)
    }
  } catch (error) {
    // Rollback is part of the write path, not an afterthought.
    copyFileSync(backup, file)
    throw error
  }

  const journal: RescueJournal = {
    schema_version: 1,
    produced_by: 'packages/plugin/src/rescue.ts',
    generated_at: input.stamp,
    profile_dir: input.profileDir,
    backup,
    removed,
    before_sha256: sha256(before),
    after_sha256: sha256(after),
    before,
    after,
  }
  const journalPath = join(journalDir, `${base}.json`)
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8')

  return {
    journal: journalPath,
    backupDir,
    changes: [{ file, before, after, backup, removed }],
    removed: removed.map((entry) => entry.name),
    dryRun: false,
  }
}

/**
 * Put the manifest back byte for byte.
 *
 * Refuses when the current bytes are not the ones this journal produced: someone edited the profile
 * after the rescue, and overwriting that edit would be a second, silent change (N11).
 */
export function undoRescue(journalPath: string): { readonly restored: readonly string[] } {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as RescueJournal
  if (journal.schema_version !== 1) throw new Error(`unsupported journal schema: ${String(journal.schema_version)}`)
  const file = join(journal.profile_dir, MANIFEST)
  if (!existsSync(journal.backup)) throw new Error(`backup is missing: ${journal.backup}`)
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null
  if (current === null || sha256(current) !== journal.after_sha256) {
    throw new Error(`${file} changed after this rescue was applied; refusing to overwrite it`)
  }
  copyFileSync(journal.backup, file)
  const restored = readFileSync(file, 'utf8')
  if (sha256(restored) !== journal.before_sha256) {
    throw new Error(`${file} was restored but its bytes do not match the pre-rescue manifest`)
  }
  return { restored: [file] }
}
