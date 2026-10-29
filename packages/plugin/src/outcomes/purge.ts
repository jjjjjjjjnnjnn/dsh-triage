/**
 * `outcomes --purge` and `outcomes --status` (spec §11).
 *
 * THE ONLY DELETION PATH IN THE PRODUCT, AND ITS RULES:
 *   - it works whether or not recording is enabled: deleting must never require opting in;
 *   - it never creates anything. Purging a store that does not exist is a no-op with exit 0,
 *     not an implicit mkdir (control N5);
 *   - it enumerates the directory and deletes what this tool owns, so a file added in a
 *     later version is deleted too; anything NOT owned is left alone and listed in
 *     `remaining[]` (control N6 asserts the list is empty when we are the only writer);
 *   - its output never contains a record, a package name or a path: this is the text most
 *     likely to be pasted into an issue (control N13);
 *   - twice in a row is fine: the second run reports `noop: true` and `deleted_records: 0`.
 *
 * No network client is imported here, and none may ever be (spec §12).
 */

import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import {
  errorCodeOf,
  readOutcomeConfig,
  resolveStoreRoot,
  STORE_OWNED_FILES,
  type OutcomeMode,
} from './config.js'
import { readOutcomeRecords } from './store.js'

export interface PurgeReport {
  readonly schema_version: 1
  readonly purge: {
    readonly noop: boolean
    readonly deleted_records: number
    readonly deleted_files: readonly string[]
    /** Lines that were already unreadable; they are deleted with the file, never repaired. */
    readonly rejected_lines_dropped: number
    readonly directory_removed: boolean
    /** Entries we do not own, as basenames only. Empty means nothing of ours (or theirs) is left. */
    readonly remaining: readonly string[]
  }
  readonly store_root_exists: boolean
  readonly at: string
}

export type PurgeResult = { readonly ok: true; readonly report: PurgeReport } | { readonly ok: false; readonly detail: string }

export interface StatusReport {
  readonly schema_version: 1
  readonly mode: OutcomeMode
  readonly records: number
  readonly rejected_lines: number
  readonly oldest_at: string | null
  readonly newest_at: string | null
  readonly store_root_exists: boolean
}

const isOwned = (name: string): boolean => STORE_OWNED_FILES.includes(name)

/**
 * Delete the store.
 *
 * `directory_removed` means "the directory is not there any more", which is true both when we
 * removed it and when it never existed - the invariant triple (§11) is
 * `remaining == []` + `directory_removed == true` + `store_root_exists == false`, and `noop`
 * is what tells the two cases apart.
 */
export function purgeOutcomes(options: {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly platform?: string
  readonly at: string
}): PurgeResult {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const located = resolveStoreRoot(env, platform)
  // An unresolvable store location is indistinguishable from "nothing of ours is there".
  if (!located.ok) {
    return {
      ok: true,
      report: {
        schema_version: 1,
        purge: {
          noop: true,
          deleted_records: 0,
          deleted_files: [],
          rejected_lines_dropped: 0,
          directory_removed: true,
          remaining: [],
        },
        store_root_exists: false,
        at: options.at,
      },
    }
  }
  const root = located.root
  if (!existsSync(root)) {
    return {
      ok: true,
      report: {
        schema_version: 1,
        purge: {
          noop: true,
          deleted_records: 0,
          deleted_files: [],
          rejected_lines_dropped: 0,
          directory_removed: true,
          remaining: [],
        },
        store_root_exists: false,
        at: options.at,
      },
    }
  }

  try {
    const read = readOutcomeRecords(root)
    const deletedFiles: string[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !isOwned(entry.name)) continue
      unlinkSync(join(root, entry.name))
      deletedFiles.push(entry.name)
    }

    const remaining = readdirSync(root, { withFileTypes: true })
      .map((entry) => entry.name)
      .sort()
    let directoryRemoved = false
    if (remaining.length === 0) {
      rmdirSync(root)
      directoryRemoved = true
    }

    return {
      ok: true,
      report: {
        schema_version: 1,
        purge: {
          noop: false,
          deleted_records: read.records.length,
          // Basenames only: this object is the most pasteable thing we print (§11).
          deleted_files: deletedFiles.sort(),
          rejected_lines_dropped: read.rejected,
          directory_removed: directoryRemoved,
          remaining,
        },
        store_root_exists: existsSync(root),
        at: options.at,
      },
    }
  } catch (error) {
    // A permission problem is a failure (exit 1), not a silent "gone".
    return { ok: false, detail: errorCodeOf(error) }
  }
}

/** `outcomes --status`: how many records exist, and how many lines were unreadable. */
export function outcomeStatus(options: {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly platform?: string
}): StatusReport {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const reading = readOutcomeConfig(env, platform)
  if (reading.root === null) {
    return {
      schema_version: 1,
      mode: reading.mode,
      records: 0,
      rejected_lines: 0,
      oldest_at: null,
      newest_at: null,
      store_root_exists: false,
    }
  }
  const read = readOutcomeRecords(reading.root)
  const timestamps = read.records.map((record) => record.at).sort()
  return {
    schema_version: 1,
    mode: reading.mode,
    // Only validated lines count as records; bad lines are reported separately so they never
    // inflate the number the user reads as "how much did you keep about me".
    records: read.records.length,
    rejected_lines: read.rejected,
    oldest_at: timestamps[0] ?? null,
    newest_at: timestamps.at(-1) ?? null,
    store_root_exists: existsSync(reading.root),
  }
}

/** Text rendering of a purge, with no record content, no package name and no path (§11). */
export function renderPurge(report: PurgeReport): string {
  const files = report.purge.deleted_files.length
  const records = report.purge.deleted_records
  const head = report.purge.noop
    ? 'purged  0 outcome records · 0 files · nothing was there'
    : `purged  ${records} outcome record${records === 1 ? '' : 's'} · ${files} file${files === 1 ? '' : 's'} · ${
        report.purge.directory_removed ? 'directory removed' : 'directory kept'
      }`
  /*
   * The count, not the names: `remaining[]` in `--json` lists the basenames because the spec
   * asks for it, but the human text stays a count so that a paste into an issue cannot carry
   * a file name the user chose (control N13 is stricter than "no paths").
   */
  const kept = report.purge.remaining.length
  const store =
    report.store_root_exists || kept > 0
      ? `store    kept (${kept} file${kept === 1 ? '' : 's'} not ours)`
      : 'store    absent'
  return `${head}\n${store}\n`
}

/** Text rendering of a status line. Counts only. */
export function renderStatus(report: StatusReport): string {
  const window = report.oldest_at === null ? '' : ` · ${report.oldest_at} … ${report.newest_at}`
  return `outcomes ${report.mode} · ${report.records} record(s) · ${report.rejected_lines} unreadable line(s)${window}\n`
}
