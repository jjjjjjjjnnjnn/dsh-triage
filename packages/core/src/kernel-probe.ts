/**
 * R101: probing the desktop shell's `app.asar` for the kernel version (M14-C1 / C4 / C5).
 *
 * WHY A SEPARATE MODULE: `env.ts` is the only file in `core` that touches the filesystem, and M14 adds a
 * different kind of read (a single 213 MB image, parsed by `asar.ts`). Keeping the "which copy do we
 * believe" decision in one small pure-ish function is what makes N1–N7 testable without a desktop install.
 *
 * ORDER (M14-C1): an explicit path wins (`DSH_TRIAGE_ASAR` is only for tests/probes), then the two
 * documented desktop locations, then "not found". Nothing is guessed; `runtime.json` is read only to
 * record a disagreement (M14-C5), never as a version source.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { asarKernelPackages, asarReadManifest, parseAsarArchive } from './asar.js'
import type { KernelProbe } from './types.js'

export interface KernelProbeInput {
  /** Explicit archive path; tests use this, production picks it up from the desktop layout. */
  readonly asarPath?: string | null
  /** `~/.dsh`, already resolved by the caller. */
  readonly dshHome?: string
  /** Skip the filesystem walk entirely (tests, and callers that must stay hermetically offline). */
  readonly disabled?: boolean
}

export interface KernelProbeResult {
  readonly probe: KernelProbe
  /** Manifest of `@deepseek-ai/dsh` from the archive, or `null`. */
  readonly manifest: Record<string, unknown> | null
  /** Every `@deepseek-ai/*` manifest in the kernel scope; empty when the archive was not read (M14-C3). */
  readonly packages: ReadonlyMap<string, Record<string, unknown>>
}

const NONE: KernelProbeResult = {
  probe: { state: 'absent', path: null, detail: null, runtimeJsonVersion: null, disagrees: false },
  manifest: null,
  packages: new Map(),
}

/** The two real desktop locations, plus the env override that tests and probes use. */
function candidatePaths(input: KernelProbeInput): string[] {
  const explicit = (input.asarPath ?? '').trim()
  if (explicit !== '') return [explicit]
  const fromEnv = (process.env['DSH_TRIAGE_ASAR'] ?? '').trim()
  if (fromEnv !== '') return [fromEnv]

  const paths: string[] = []
  const programFiles = process.env['LOCALAPPDATA'] ?? ''
  if (programFiles !== '') {
    paths.push(join(programFiles, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'))
  }
  const programFilesX86 = process.env['PROGRAMFILES'] ?? ''
  if (programFilesX86 !== '') {
    paths.push(join(programFilesX86, 'DeepSeek Harness', 'resources', 'app.asar'))
  }
  return paths
}

/** `desktopVersion` out of `~/.dsh/dsh-runtimes/<name>/runtime.json`, recorded only (M14-C5). */
function readRuntimeJsonVersion(dshHome: string | undefined): string | null {
  if (dshHome === undefined || dshHome === '') return null
  const root = join(dshHome, 'dsh-runtimes')
  if (!existsSync(root)) return null
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return null
  }
  for (const entry of entries) {
    const file = join(root, entry, 'runtime.json')
    if (!existsSync(file)) continue
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (parsed !== null && typeof parsed === 'object') {
        const version = (parsed as Record<string, unknown>)['desktopVersion']
        if (typeof version === 'string' && version.trim() !== '') return version.trim()
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Read the kernel's manifests out of the desktop archive.
 *
 * SCOPING (added after the first attempt broke eight existing tests): the probe only looks at this machine's
 * desktop shell when the profile being judged lives under the DEFAULT home. A caller that points `DSH_HOME`
 * at a fixture (every peer test, the probe sandbox, a CI run) must not have its answer changed by an archive
 * that has nothing to do with that profile — otherwise "the runtime is 0.2.2-rc.1" becomes true of a temp
 * directory holding fake packages. Callers that DO want the archive on a custom home pass `asarPath` or set
 * `DSH_TRIAGE_ASAR`.
 *
 * A present-but-broken archive is `unreadable`, never "absent" — the distinction matters because
 * `unreadable` means "we know there is a kernel and we could not see it", which is a worse honest answer
 * than silently falling back (M14-C4/N5).
 */
export function probeKernelArchive(input: KernelProbeInput = {}): KernelProbeResult {
  if (input.disabled === true) return NONE

  const runtimeJsonVersion = readRuntimeJsonVersion(input.dshHome)
  const candidates = candidatePaths(input)
  /*
   * SCOPING (see SCOPING above): default-path discovery only applies to a REAL desktop install. Two
   * signals must both say so:
   *   1. nobody overrode the home (`$DSH_HOME` unset) — every fixture and CI run pins it, and
   *      `os.homedir()` itself follows `$USERPROFILE`, so comparing paths is not enough;
   *   2. the resolved home is the account's own `~/.dsh`.
   * `disagrees` below uses the same rule for `runtime.json`.
   */
  const explicit = (input.asarPath ?? '').trim() !== '' || (process.env['DSH_TRIAGE_ASAR'] ?? '').trim() !== ''
  const homeOverridden = (process.env['DSH_HOME'] ?? '').trim() !== ''
  const isAccountHome =
    input.dshHome === undefined ||
    input.dshHome === '' ||
    resolve(input.dshHome).toLowerCase() === resolve(join(homedir(), '.dsh')).toLowerCase()
  if (!explicit && (homeOverridden || !isAccountHome)) {
    return {
      probe: {
        state: 'absent',
        path: null,
        detail: 'the home is not this account\'s default, so the desktop archive is not probed',
        runtimeJsonVersion,
        disagrees: false,
      },
      manifest: null,
      packages: new Map(),
    }
  }
  const existing = candidates.find((path) => existsSync(path))
  if (existing === undefined) {
    return {
      probe: { state: 'absent', path: null, detail: null, runtimeJsonVersion, disagrees: false },
      manifest: null,
      packages: new Map(),
    }
  }

  let buffer: Buffer
  try {
    buffer = readFileSync(existing)
  } catch (error) {
    return {
      probe: {
        state: 'unreadable',
        path: existing,
        detail: error instanceof Error ? error.message : String(error),
        runtimeJsonVersion,
        disagrees: false,
      },
      manifest: null,
      packages: new Map(),
    }
  }

  const parsed = parseAsarArchive(buffer)
  if ('code' in parsed) {
    return {
      probe: { state: 'unreadable', path: existing, detail: `${parsed.code}: ${parsed.detail}`, runtimeJsonVersion, disagrees: false },
      manifest: null,
      packages: new Map(),
    }
  }

  const manifest = asarReadManifest(parsed, ['dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'])
  if (manifest === null) {
    return {
      probe: { state: 'unreadable', path: existing, detail: 'no dsh package.json inside the archive', runtimeJsonVersion, disagrees: false },
      manifest: null,
      packages: new Map(),
    }
  }

  const version = typeof manifest['version'] === 'string' ? manifest['version'].trim() : ''
  const packages = asarKernelPackages(parsed)
  return {
    probe: {
      state: 'read',
      path: existing,
      detail: null,
      runtimeJsonVersion,
      // Both are kept, neither is chosen (M14-C5/N7).
      disagrees: runtimeJsonVersion !== null && version !== '' && runtimeJsonVersion !== version,
    },
    manifest,
    packages,
  }
}

/** The archive's parent directory, for messages that must name where we looked. */
export function asarDirectoryOf(path: string): string {
  return dirname(path)
}
