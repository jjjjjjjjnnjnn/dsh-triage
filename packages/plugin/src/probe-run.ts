/**
 * Real (Node) dependencies for the probe executor, plus candidate identification.
 *
 * Kept out of `cli.ts` so the command stays readable, and out of `@dsh-triage/probe` so
 * the engine package stays free of "where does the hook live in this install" questions.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InstallResult, ProbeExecDeps, RuntimeReadResult } from '@dsh-triage/probe'
import {
  bootAndSampleHost,
  probeHttp,
  readRuntimeVersion,
  removeSandbox,
  runInstall,
  scrubbedEnv,
} from '@dsh-triage/probe'

/**
 * The inventory hook ships inside `@dsh-triage/probe`.
 *
 * Resolved through the package entry instead of a hard-coded repo path: the CLI has to
 * work when installed from npm, where `scripts/` does not exist.
 */
export function probeHookSource(): string {
  const entry = fileURLToPath(import.meta.resolve('@dsh-triage/probe'))
  return join(dirname(entry), '..', 'hooks', 'inventory-hook.mjs')
}

export interface RealProbeDepsOptions {
  readonly scratchRoot?: string
  readonly hookSource?: string
  readonly baseEnv?: NodeJS.ProcessEnv
}

export function realProbeDeps(options: RealProbeDepsOptions = {}): ProbeExecDeps {
  const hookSource = options.hookSource ?? probeHookSource()
  const scratchRoot = options.scratchRoot ?? join(tmpdir(), 'dsh-triage-probe')
  const baseEnv = options.baseEnv ?? process.env
  return {
    now: () => Date.now(),
    readRuntimeVersion: async ({ dshMain, timeoutMs }): Promise<RuntimeReadResult> =>
      readRuntimeVersion({ dshMain, timeoutMs, env: scrubbedEnv(baseEnv, {}) }),
    install: async ({ dshMain, dshHome, profile, candidate, timeoutMs }): Promise<InstallResult> =>
      runInstall({
        dshMain,
        dshHome,
        profile,
        candidate,
        timeoutMs,
        env: scrubbedEnv(baseEnv, { DSH_HOME: dshHome }),
      }),
    bootAndSample: async ({ plan, dshMain, timeoutMs }) => {
      const boot = await bootAndSampleHost({
        dshMain,
        dshHome: plan.sandboxHome,
        profile: plan.profile,
        profileDir: plan.sandboxProfileDir,
        hookSource,
        scratchRoot,
        timeoutMs,
        env: scrubbedEnv(baseEnv, { DSH_HOME: plan.sandboxHome }),
        // Measured in R14: `--port` is forwarded to the app, and without `--no-open` a
        // probe would launch the user's browser. Both belong to the probe, not the plugin.
        appArgs: ['--port', String(plan.port), '--no-open'],
        readinessPort: plan.port,
      })
      return {
        sample: boot.payload,
        seconds: boot.host.seconds,
        detail: boot.error ?? `sampled in ${boot.host.seconds}s (${boot.host.status})`,
        http: boot.http,
      }
    },
    probeHttp: async ({ port, timeoutMs }) => probeHttp(port, timeoutMs),
    cleanup: async ({ dshHome, port, timeoutMs }) => {
      const removed = removeSandbox(dshHome)
      // "The directory is gone" is not "the process is gone": on Windows the Host keeps
      // helper processes alive, so the port is the second half of the proof (R12 pitfall).
      const after = await probeHttp(port, Math.min(timeoutMs, 2000))
      return {
        removed: removed.removed,
        portClosed: after.status === null,
        detail: `${removed.removed ? 'sandbox removed' : 'sandbox left behind'} · port ${
          after.status === null ? 'closed' : `still answering ${after.status}`
        }`,
      }
    },
  }
}

/**
 * Which package does this candidate install as?
 *
 * The row is matched by module name, so this has to be right before anything runs — a
 * guess here would turn "we could not identify it" into "the plugin does nothing".
 * Returns `null` rather than a guess; the CLI refuses to execute in that case.
 */
export function candidatePackageName(spec: string): string | null {
  const trimmed = spec.trim()
  if (trimmed === '') return null
  if (looksLikePath(trimmed)) {
    const directory = trimmed.startsWith('file:') ? fileURLToPath(trimmed) : resolve(trimmed)
    const manifestPath = join(directory, 'package.json')
    if (!existsSync(manifestPath)) return null
    try {
      const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))
      if (manifest === null || typeof manifest !== 'object') return null
      const name = (manifest as Record<string, unknown>)['name']
      return typeof name === 'string' && name !== '' ? name : null
    } catch {
      return null
    }
  }
  return packageNameOfNpmSpec(trimmed)
}

/** `@scope/name@1.2.3` → `@scope/name`; `name@next` → `name`; `name` → `name`. */
export function packageNameOfNpmSpec(spec: string): string | null {
  const trimmed = spec.trim()
  if (trimmed === '') return null
  const start = trimmed.startsWith('@') ? 1 : 0
  const at = trimmed.indexOf('@', start)
  const name = at === -1 ? trimmed : trimmed.slice(0, at)
  return name === '' ? null : name
}

function looksLikePath(spec: string): boolean {
  if (spec.startsWith('file:')) return true
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('\\')) return true
  if (/^[A-Za-z]:[\\/]/.test(spec)) return true
  if (spec.endsWith('.tgz') || spec.endsWith('.tar.gz')) return true
  // `./x` is covered above; a bare name containing a separator is still a path.
  return spec.includes('/') && !spec.startsWith('@')
}

/** Scratch root used for probe boots; kept under the OS temp dir, never inside `~/.dsh`. */
export function probeScratchRoot(): string {
  return join(tmpdir(), 'dsh-triage-probe')
}

/** The user's real DSH home, used only to prove the sandbox is disjoint from it. */
export function realDshHomeOf(override: string | null): string {
  if (override !== null) return isAbsolute(override) ? override : resolve(override)
  const fromEnv = process.env['DSH_HOME']
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  return join(homedir(), '.dsh')
}

/** Best-effort bundle list of the sandbox profile, for the verdict's env fingerprint. */
export function sandboxBundles(profileDir: string): readonly string[] {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))
    if (manifest === null || typeof manifest !== 'object') return []
    const dsh = (manifest as Record<string, unknown>)['dsh']
    if (dsh === null || typeof dsh !== 'object') return []
    const profile = (dsh as Record<string, unknown>)['profile']
    if (profile === null || typeof profile !== 'object') return []
    const bundles = (profile as Record<string, unknown>)['bundles']
    return Array.isArray(bundles) ? bundles.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** Sandbox profile directory (kept here so the CLI and the recorder agree). */
export function sandboxProfileDir(sandboxHome: string, profile: string): string {
  return join(sandboxHome, 'profiles', profile)
}

/**
 * Absolute path for path-like candidates.
 *
 * `dsh plugin --profile <p> add <spec>` runs pnpm *inside the profile directory*, so a
 * repo-relative path would be resolved against the sandbox profile and fail with a
 * confusing "not found". Registry specs are passed through unchanged.
 */
export function normalizeCandidateSpec(spec: string): string {
  const trimmed = spec.trim()
  if (!looksLikePath(trimmed)) return trimmed
  if (trimmed.startsWith('file:')) return trimmed
  return isAbsolute(trimmed) ? trimmed : resolve(trimmed)
}

/** Display name of a candidate spec (used in artifact filenames and text output). */
export function candidateSlug(spec: string): string {
  return basename(resolve(spec))
}
