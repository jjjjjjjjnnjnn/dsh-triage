/**
 * Autofix (M7).
 *
 * The product's job used to stop at "here is what is wrong". This module is the part that
 * actually changes the profile — so it is written the way a tool that edits someone's install
 * has to be:
 *
 * - **plan first, always**: `planFixes()` is pure (no disk, no network) and returns data, so the
 *   CLI, the panel and the tests all read the same plan;
 * - **only one write exists today**: an exact-version exemption in the profile's
 *   `compatibility.json`, in the *same format upstream writes* (2-space JSON, sorted keys, one
 *   trailing newline, `0600`), and only when the installed runtime actually reads that file —
 *   `runtimeSupportsExemptions()` proves it by finding the implementation, not by hoping;
 * - **every write is undoable**: the previous bytes are copied next to the journal before the
 *   atomic replace, and `undoFix()` restores them byte-for-byte;
 * - **it refuses more than it does**: a version that is not canonical SemVer, a package whose
 *   install shape we do not know, a compatibility file we did not write and cannot parse — all
 *   refused with a reason. Widening a plugin's own `engines.dsh` (the fastest "fix" and a lie to
 *   the loader) is deliberately absent; see `docs/specs/M7-autofix.md` §1 C.
 */

import { isExactExemptionVersion as coreIsExactVersion } from '@dsh-triage/core'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AuditData } from './audit-data.js'
import { readProfileExemptions as readCompatibilityFile } from '@dsh-triage/core'

export type FixAction = 'exemption' | 'pin'

export type FixStatus =
  | 'ready'
  | 'unsupported-runtime'
  | 'unknown-version'
  | 'unknown-install-shape'
  | 'no-compatible-version'

export interface FixItem {
  /** The row (or package) this addresses — the same id the summary shows. */
  readonly id: string
  readonly action: FixAction
  readonly status: FixStatus
  /** One sentence for a human; never a code. */
  readonly detail: string
  /** `name@version`, exactly as the exemption key must be, or null when unknown. */
  readonly packageVersion: string | null
  /** What a human would otherwise type, when there is such a command. */
  readonly command: string | null
}

export interface FixPlan {
  readonly profileDir: string
  readonly runtime: string | null
  /** Whether the installed runtime reads `compatibility.json` at all. */
  readonly exemptionSupport: boolean
  readonly items: readonly FixItem[]
  /** How many items a `--apply` would actually change. */
  readonly applicable: number
}

/* ------------------------------- detection -------------------------------- */

/**
 * Does this profile's runtime read `compatibility.json`?
 *
 * Proven by the implementation being present, not by the version number: 0.2.x ships
 * `@deepseek-ai/dsh-app-boot` with `setProfileVersionExemption`, 0.1.0-rc.6 ships nothing of the
 * kind (checked by searching every installed `@deepseek-ai` package). A version comparison would
 * be a guess; a missing implementation is a fact.
 */
export function runtimeSupportsExemptions(profileDir: string): boolean {
  const roots = [join(profileDir, 'node_modules'), join(dirname(profileDir), 'node_modules')]
  for (const root of roots) {
    const boot = join(root, '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
    if (!existsSync(boot)) continue
    try {
      const text = readFileSync(boot, 'utf8')
      if (text.includes('compatibility.json') && text.includes('setProfileVersionExemption')) return true
    } catch {
      // An unreadable runtime is treated as "does not support", never as "supports".
    }
  }
  return false
}

/* --------------------------------- plan ----------------------------------- */

/**
 * Build the plan. Pure: the same `AuditData` yields the same plan, with no clock and no I/O.
 *
 * `installable` is the set of package names the profile lists in `dependencies` — the only
 * packages whose install shape we can honestly claim to know. Everything else is planned as
 * "you have to do this by hand", with the reason stated.
 */
export function planFixes(
  data: AuditData,
  options: { readonly exemptionSupport: boolean; readonly installable?: readonly string[] | null },
): FixPlan {
  const runtime = data.env.dsh
  const installable = options.installable === undefined || options.installable === null ? [] : options.installable
  const items: FixItem[] = []

  for (const verdict of data.rowVerdicts) {
    if (verdict.conclusion !== 'blocked' && verdict.conclusion !== 'risky') continue
    const name = verdict.subject.name
    const version = verdict.subject.version
    const packageVersion = version === null ? null : `${name}@${version}`
    const allowCommand =
      verdict.remediation.find((entry) => entry.kind === 'allow-version')?.command ??
      (runtime === null ? null : `dsh plugin --profile ${data.env.profile} allow-version ${packageVersion ?? name} --dsh-version ${runtime} --accept-risk`)

    if (options.exemptionSupport) {
      items.push({
        id: name,
        action: 'exemption',
        status: version === null ? 'unknown-version' : runtime === null ? 'unknown-version' : 'ready',
        detail:
          version === null || runtime === null
            ? 'The exact package version or the runtime version is unknown, so an exemption cannot name it.'
            : `Record an exemption for ${packageVersion} on dsh ${runtime}. This bypasses the declaration only — behaviour is still unproven.`,
        packageVersion: version === null ? null : packageVersion,
        command: allowCommand,
      })
      continue
    }

    const canInstall = installable.includes(name)
    items.push({
      id: name,
      action: 'pin',
      status: version === null ? 'unknown-version' : canInstall ? 'no-compatible-version' : 'unknown-install-shape',
      detail:
        version === null
          ? 'The installed version could not be read, so there is nothing to pin.'
          : canInstall
            ? 'This runtime does not read exemptions, so the only real fix is a plugin version that declares support for it. No such version was resolved.'
            : `${name} is not in the profile's dependencies, so this tool does not know how it was installed.`,
      packageVersion: version === null ? null : packageVersion,
      command: allowCommand,
    })
  }

  return {
    profileDir: data.env.profileDir,
    runtime,
    exemptionSupport: options.exemptionSupport,
    items,
    applicable: items.filter((item) => item.status === 'ready').length,
  }
}

/* --------------------------------- apply ---------------------------------- */

export interface FixChange {
  readonly action: FixAction
  readonly packageVersion: string
  readonly runtime: string
  readonly file: string
  readonly before: string | null
  readonly after: string
  readonly backup: string
}

export interface FixRun {
  readonly journal: string
  readonly changes: readonly FixChange[]
  readonly skipped: readonly { readonly id: string; readonly reason: string }[]
  /** True when nothing was written (dry run, or nothing ready). */
  readonly dryRun: boolean
}

interface Journal {
  readonly schema_version: 1
  readonly produced_by: 'packages/plugin/src/fix.ts'
  readonly generated_at: string
  readonly profile_dir: string
  readonly backup_dir: string
  readonly changes: readonly {
    readonly file: string
    readonly backup: string
    readonly before: string | null
    readonly after: string
  }[]
}

const COMPAT_FILE = 'compatibility.json'

/** A filesystem-safe form of an ISO stamp: Windows cannot create a directory named "10:30". */
export function safeStamp(stamp: string): string {
  return stamp.replace(/:/g, '-')
}

/** Refuse anything that is not a canonical exact SemVer — the rule lives in core, not here. */
export const isExactVersion = coreIsExactVersion

/** `name@version` where the version is exact. Throws otherwise; never guesses. */
export function parsePackageVersion(value: string): { name: string; version: string } {
  const at = value.lastIndexOf('@')
  if (at <= 0) throw new Error(`exemption keys are name@version; got "${value}"`)
  const name = value.slice(0, at)
  const version = value.slice(at + 1)
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error(`not an npm package name: "${name}"`)
  if (!isExactVersion(version)) throw new Error(`not an exact version: "${version}"`)
  return { name, version }
}

/**
 * Write the exemption and prove it: backup → atomic replace → read back.
 *
 * `dryRun` is the default at the CLI, and it writes **nothing at all** (not even a backup), so a
 * preview can never leave a trace.
 */
export function applyExemptionFixes(
  plan: FixPlan,
  options: { readonly stamp: string; readonly dryRun: boolean },
): FixRun {
  const ready = plan.items.filter((item) => item.status === 'ready' && item.packageVersion !== null)
  const skipped = plan.items
    .filter((item) => item.status !== 'ready')
    .map((item) => ({ id: item.id, reason: item.status }))
  if (options.dryRun || ready.length === 0) {
    return { journal: '', changes: [], skipped, dryRun: true }
  }
  if (plan.runtime === null) throw new Error('the runtime version is unknown; an exemption must name an exact runtime')

  const file = join(plan.profileDir, COMPAT_FILE)
  const current = readCompatibilityFile(plan.profileDir)
  if (!current.rewritable) {
    throw new Error(`${file} was not written by this tool and cannot be parsed; refusing to rewrite it (fix it by hand first)`)
  }

  const journalDir = join(plan.profileDir, '.dsh-triage', 'journal')
  mkdirSync(journalDir, { recursive: true })
  const base = safeStamp(options.stamp)
  let runName = base
  for (let n = 2; existsSync(join(journalDir, `${runName}.json`)); n += 1) runName = `${base}-${n}`
  const dir = join(plan.profileDir, '.dsh-triage', 'backups', runName)
  mkdirSync(dir, { recursive: true })
  const changes: FixChange[] = []
  const next: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(current.exemptions)) next[key] = [...value]

  for (const item of ready) {
    const packageVersion = item.packageVersion as string
    parsePackageVersion(packageVersion)
    const versions = next[packageVersion] ?? []
    const merged = [...new Set([...versions, plan.runtime])].sort()
    next[packageVersion] = merged
    changes.push({
      action: 'exemption',
      packageVersion,
      runtime: plan.runtime,
      file,
      before: existsSync(file) ? readFileSync(file, 'utf8') : null,
      after: serialize(next),
      backup: '',
    })
  }

  const before = existsSync(file) ? readFileSync(file, 'utf8') : null
  const backupPath = join(dir, COMPAT_FILE)
  if (before !== null) copyFileSync(file, backupPath)
  atomicWrite(file, serialize(next))

  const after = readFileSync(file, 'utf8')
  const verified = readCompatibilityFile(plan.profileDir)
  if (!verified.rewritable) throw new Error(`${file} could not be read back after writing; the profile may need manual repair`)

  const journalPath = join(journalDir, `${runName}.json`)
  const journal: Journal = {
    schema_version: 1,
    produced_by: 'packages/plugin/src/fix.ts',
    generated_at: options.stamp,
    profile_dir: plan.profileDir,
    backup_dir: dir,
    changes: changes.map((change) => ({
      file: change.file,
      backup: join(dir, COMPAT_FILE),
      before: change.before,
      after: change.after,
    })),
  }
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8')
  return {
    journal: journalPath,
    changes: changes.map((change) => ({ ...change, after, backup: join(dir, COMPAT_FILE) })),
    skipped,
    dryRun: false,
  }
}

/** Put every file back exactly as it was. Unknown/edited files are refused, not overwritten. */
export function undoFix(journalPath: string): { readonly restored: readonly string[] } {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal
  if (journal.schema_version !== 1) throw new Error(`unsupported journal schema: ${String(journal.schema_version)}`)
  const restored: string[] = []
  for (const change of journal.changes) {
    if (change.before === null) {
      if (existsSync(change.file)) rmSync(change.file, { force: true })
      restored.push(change.file)
      continue
    }
    if (!existsSync(change.backup)) throw new Error(`backup is missing: ${change.backup}`)
    const current = existsSync(change.file) ? readFileSync(change.file, 'utf8') : null
    if (current !== change.after) {
      throw new Error(`${change.file} changed after this journal was written; refusing to overwrite it`)
    }
    copyFileSync(change.backup, change.file)
    restored.push(change.file)
  }
  return { restored }
}

/** Kept for callers and tests: the parser itself lives in core (`readProfileExemptions`). */
export function readCompatibility(profileDir: string): {
  readonly exemptions: Readonly<Record<string, readonly string[]>>
  readonly rewritable: boolean
} {
  const reading = readCompatibilityFile(profileDir)
  return { exemptions: reading.exemptions, rewritable: reading.rewritable }
}

/* -------------------------------- helpers --------------------------------- */

function serialize(exemptions: Record<string, readonly string[]>): string {
  const sorted: Record<string, string[]> = {}
  for (const key of Object.keys(exemptions).sort()) sorted[key] = [...(exemptions[key] ?? [])]
  return `${JSON.stringify(sorted, undefined, 2)}\n`
}

/** Temp file in the same directory, then rename: a crash never leaves a half-written file. */
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

/** Package names the profile lists as its own dependencies — the only install shapes we know. */
export function readProfileDependencies(profileDir: string): readonly string[] {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]
  } catch {
    return []
  }
}
