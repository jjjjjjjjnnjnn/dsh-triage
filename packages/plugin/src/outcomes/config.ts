/**
 * Where the local outcome store lives, and whether it is switched on (spec §7 / §8).
 *
 * THREE RULES THIS FILE EXISTS FOR:
 *   1. **default off** means nothing is created - not the directory, not the file, not an
 *      mtime. `readOutcomeConfig` therefore only ever *reads*, and a missing store is not an
 *      error (control N1 / N5).
 *   2. **fail closed**: an empty/relative `%LOCALAPPDATA%`, an unreadable `config.json`, or an
 *      `outcomes` value outside the enum all mean `off`. A broken config is never "on"
 *      (control N10).
 *   3. **no environment variable turns recording on.** The only switches are the config file
 *      and an explicit per-command flag; `%LOCALAPPDATA%` decides *where* the store is, not
 *      *whether* we write. An env-driven opt-in would explain "why did it start recording?"
 *      only to whoever happens to see the CI log.
 *
 * No network client is imported here, and none may ever be (spec §12, gate `outcome-privacy`).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'

export type OutcomeMode = 'off' | 'local'

/** The directory name under the platform's local data dir. Never under `~/.dsh` (§8). */
export const STORE_DIR_NAME = 'dsh-triage'

export const CONFIG_FILE = 'config.json'
export const OUTCOMES_FILE = 'outcomes.jsonl'
/** Scratch name for the atomic replace. Deleted by `outcomes --purge` like any owned file. */
export const CONFIG_TMP_FILE = 'config.json.tmp'

/**
 * Every file this tool may create inside the store.
 *
 * WHY A LIST AND NOT A HARD-CODED DELETE ORDER: purge enumerates the directory and deletes
 * what it owns, so "a file we forgot to delete" is impossible as long as the writer and this
 * list change together - and anything NOT in this list is reported in `remaining[]` instead
 * of being destroyed (the user may have put their own notes there, §11).
 */
export const STORE_OWNED_FILES: readonly string[] = [CONFIG_FILE, CONFIG_TMP_FILE, OUTCOMES_FILE]

export type StoreLocationProblem = 'no-local-data-dir' | 'relative-local-data-dir' | 'unavailable'

export type StoreLocation =
  | { readonly ok: true; readonly root: string }
  | { readonly ok: false; readonly problem: StoreLocationProblem; readonly detail: string }

export interface OutcomeConfigReading {
  readonly mode: OutcomeMode
  /** Where the mode came from. `flag` and `config` are explicit; `default` is "off, silently". */
  readonly source: 'flag' | 'config' | 'default' | 'invalid-config' | 'no-store'
  readonly root: string | null
  /** Human-readable, path-free problems. Empty when nothing is wrong. */
  readonly problems: readonly string[]
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/**
 * Resolve the store root for the given platform.
 *
 * win32 uses `%LOCALAPPDATA%` and NOT `%APPDATA%`: roaming profiles sync to a domain server,
 * which would put a second copy of the user's outcome log somewhere we do not control.
 */
export function resolveStoreRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
): StoreLocation {
  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA']
    if (!isNonEmptyString(localAppData)) {
      return { ok: false, problem: 'no-local-data-dir', detail: 'LOCALAPPDATA is empty' }
    }
    if (!isAbsolute(localAppData)) {
      return { ok: false, problem: 'relative-local-data-dir', detail: 'LOCALAPPDATA is not an absolute path' }
    }
    return { ok: true, root: join(localAppData, STORE_DIR_NAME) }
  }

  const xdg = env['XDG_DATA_HOME']
  if (isNonEmptyString(xdg)) {
    if (!isAbsolute(xdg)) {
      return { ok: false, problem: 'relative-local-data-dir', detail: 'XDG_DATA_HOME is not an absolute path' }
    }
    return { ok: true, root: join(xdg, STORE_DIR_NAME) }
  }
  const home = env['HOME']
  if (!isNonEmptyString(home)) {
    return { ok: false, problem: 'no-local-data-dir', detail: 'HOME is empty' }
  }
  if (!isAbsolute(home)) {
    return { ok: false, problem: 'relative-local-data-dir', detail: 'HOME is not an absolute path' }
  }
  return { ok: true, root: join(home, '.local', 'share', STORE_DIR_NAME) }
}

export function configPathOf(root: string): string {
  return join(root, CONFIG_FILE)
}

export function outcomesPathOf(root: string): string {
  return join(root, OUTCOMES_FILE)
}

/**
 * Read the opt-in switch. Never throws, never creates anything.
 *
 * `problems` is empty in the normal "no config file yet, therefore off" case, because a
 * default-off run must not print anything at all (control N1). It carries a line only when
 * the user's environment or config is actually broken (control N10).
 */
export function readOutcomeConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
): OutcomeConfigReading {
  const located = resolveStoreRoot(env, platform)
  if (!located.ok) {
    return { mode: 'off', source: 'no-store', root: null, problems: [located.detail] }
  }
  const path = configPathOf(located.root)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    // No config file (or no permission to read it) ⇒ off. Deliberately silent: "off by
    // default" is the normal state, not a problem to report on every command.
    return { mode: 'off', source: 'default', root: located.root, problems: [] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return { mode: 'off', source: 'invalid-config', root: located.root, problems: [`${CONFIG_FILE} is not valid JSON`] }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { mode: 'off', source: 'invalid-config', root: located.root, problems: [`${CONFIG_FILE} is not a JSON object`] }
  }
  const record = parsed as Record<string, unknown>
  const unknownKeys = Object.keys(record).filter((key) => !['schema_version', 'outcomes'].includes(key))
  if (unknownKeys.length > 0) {
    return {
      mode: 'off',
      source: 'invalid-config',
      root: located.root,
      problems: [`${CONFIG_FILE} has an unknown field (${unknownKeys[0]})`],
    }
  }
  if (record['schema_version'] !== 1) {
    return { mode: 'off', source: 'invalid-config', root: located.root, problems: [`${CONFIG_FILE} has an unsupported schema_version`] }
  }
  const value = record['outcomes']
  if (value !== 'off' && value !== 'local') {
    return { mode: 'off', source: 'invalid-config', root: located.root, problems: [`${CONFIG_FILE} has an outcomes value outside {off, local}`] }
  }
  return { mode: value, source: 'config', root: located.root, problems: [] }
}

/**
 * The effective mode: command-line flag > `config.json` > default `off` (§7).
 *
 * The flag is per-invocation only; nothing here writes.
 */
export function effectiveOutcomeMode(options: {
  readonly flag: OutcomeMode | null
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly platform?: string
}): OutcomeConfigReading {
  const reading = readOutcomeConfig(options.env ?? process.env, options.platform ?? process.platform)
  if (options.flag === null) return reading
  return { ...reading, mode: options.flag, source: 'flag' }
}

export type ConfigWriteResult = { readonly ok: true; readonly changed: boolean; readonly root: string } | { readonly ok: false; readonly detail: string }

/**
 * Write the switch atomically (temp file + rename).
 *
 * Idempotent on purpose: re-enabling an already-enabled store does not rewrite the file, so
 * its mtime stays put (spec §7: "已开会再写一次同样的内容"). This is also what makes
 * `--enable && --disable` a no-op pair for anything that watches the file.
 */
export function writeOutcomeMode(
  mode: OutcomeMode,
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
): ConfigWriteResult {
  const located = resolveStoreRoot(env, platform)
  if (!located.ok) return { ok: false, detail: located.detail }
  const path = configPathOf(located.root)
  const payload = { schema_version: 1, outcomes: mode } as const
  const text = `${JSON.stringify(payload)}\n`
  try {
    if (existsSync(path) && readFileSync(path, 'utf8') === text) {
      return { ok: true, changed: false, root: located.root }
    }
    mkdirSync(located.root, { recursive: true })
    const tmp = join(located.root, CONFIG_TMP_FILE)
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path)
    return { ok: true, changed: true, root: located.root }
  } catch (error) {
    return { ok: false, detail: errorCodeOf(error) }
  }
}

/** `EPERM` / `ENOSPC` / ... - a code, never a path (the message carries the path). */
export function errorCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') return code
  }
  return 'unknown-error'
}
