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
import type { InstallResult, ProbeExecDeps, ProfilePrepareOutcome, RuntimeReadResult } from '@dsh-triage/probe'
import {
  PROFILE_DECLARATION_FILES,
  applySandboxBuildPolicy,
  bootAndSampleHost,
  copyProfileDeclarations,
  danglingLocalDependencies,
  findBrowser,
  localDependencyTargets,
  probeHttp,
  readProfileManifest,
  readNodeLayout,
  readRuntimeVersion,
  removeSandbox,
  runInstall,
  runProfileInstall,
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
  /**
   * Explicit browser path. `undefined` means "look one up" (env var + usual install
   * locations); `null` means "do not run the render check" (T-302 reports unmeasured).
   */
  readonly browser?: string | null
  /** Budget for the render check; it is a separate segment, never the boot budget. */
  readonly renderTimeoutMs?: number
  /**
   * Readiness budget for a settled tree (R17). Defaults to the 5s in `host.ts`, which is the
   * documented threshold; changing it here does not change the judge.
   */
  readonly readinessTimeoutMs?: number
  /**
   * Readiness window for a tree that was still moving when the sample was taken (R17). A run
   * that ends inside this window can only ever be judged `unknown`.
   */
  readonly unsettledReadinessMs?: number
  /**
   * Extra config for the inventory hook (T-316).
   *
   * WHY THIS EXISTS: the hook's own knobs (`resolveFrom`, `retryMs`, `timeoutMs`) decide
   * *whether* it can read the tree. The `{error}` recovery path (ADR-0008 E keeps it) could
   * only be exercised by faking the launcher until a run could point the hook at a tree it
   * cannot project from. This is a diagnostic knob: it changes what the instrument measures,
   * never the verdict, so anything produced with it must say so in its artifact.
   */
  readonly hookConfig?: Readonly<Record<string, unknown>>
}

export function realProbeDeps(options: RealProbeDepsOptions = {}): ProbeExecDeps {
  const hookSource = options.hookSource ?? probeHookSource()
  const scratchRoot = options.scratchRoot ?? join(tmpdir(), 'dsh-triage-probe')
  const baseEnv = options.baseEnv ?? process.env
  const browser = options.browser === undefined ? findBrowser({ env: baseEnv }) : options.browser
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
        // T-316: diagnostic hook knobs (see `RealProbeDepsOptions.hookConfig`). Absent for a
        // normal run, so the overlay is byte-identical to what has always been produced.
        ...(options.hookConfig === undefined ? {} : { config: options.hookConfig }),
        // Measured in R14: `--port` is forwarded to the app, and without `--no-open` a
        // probe would launch the user's browser. Both belong to the probe, not the plugin.
        appArgs: ['--port', String(plan.port), '--no-open'],
        readinessPort: plan.port,
        ...(options.readinessTimeoutMs === undefined ? {} : { readinessTimeoutMs: options.readinessTimeoutMs }),
        ...(options.unsettledReadinessMs === undefined ? {} : { unsettledReadinessMs: options.unsettledReadinessMs }),
        // T-302: the DOM check needs the Host's own token URL, so it runs inside the
        // same alive window as the readiness probe.
        render: { browser, ...(options.renderTimeoutMs === undefined ? {} : { timeoutMs: options.renderTimeoutMs }) },
      })
      return {
        sample: boot.payload,
        seconds: boot.host.seconds,
        // T-312: the first sample is what the budget judges; the final one is what the verdict
        // may rest on. Both travel so neither can be silently swapped for the other.
        finalSeconds: boot.finalSeconds,
        detail:
          boot.error === null
            ? `sampled in ${boot.host.seconds}s (${boot.host.status})`
            : // A no-sample run has to explain itself: without this line the artifact cannot
              // tell "the Host was up and our instrument stayed silent" from "nothing started".
              `${boot.error} · url_printed=${String(boot.host.url_printed)} · first line: ${boot.host.first_line}`,
        http: boot.http,
        readiness: boot.readiness,
        render: boot.render,
        renderSkipped: boot.renderSkipped,
        urlPrinted: boot.host.url_printed,
        firstLine: boot.host.first_line,
        errorTail: boot.host.error_tail,
        startupFailed: boot.host.startup_failed,
        bindFailedPorts: boot.host.bind_failed_ports,
        // T-314: the boot step's wall clock, split where it actually went.
        segments: boot.segments,
        // ADR-0008 E: whether a replacement window was opened at all, and why it ended.
        replacement: boot.replacement,
        // R37: our own scratch failures must reach the judge; otherwise "no sample" reads as
        // "the Host never came up" and a plugin gets blamed for a Windows file lock.
        setupError: boot.setupError ?? null,
        scratchCleanupError: boot.scratchCleanupError ?? null,
      }
    },
    probeHttp: async ({ port, timeoutMs }) => probeHttp(port, timeoutMs),
    // R21: read the composition back, so "the candidate joined it" is a measurement.
    profileBundles: ({ profileDir }) => sandboxBundles(profileDir),
    // T-315 residual (R30): the layout is a measurement now, not an inference.
    readNodeLayout: ({ dir }) => readNodeLayout(dir),
    /**
     * T-304: make the sandbox profile out of the user's own declarations, then install what
     * those declarations ask for. Three facts come back, and the executor judges them:
     * which files were copied, which were absent, and whether the copy can actually run.
     */
    prepareProfile: async ({ plan, dshMain, timeoutMs }): Promise<ProfilePrepareOutcome> => {
      const source = plan.profileSource
      if (source === null) throw new Error('prepareProfile called for a plan without a profile source')
      const copy = copyProfileDeclarations({
        sourceDir: source.dir,
        targetDir: plan.sandboxProfileDir,
        files: PROFILE_DECLARATION_FILES,
      })
      // Stop pnpm from failing over an approval policy it will not act on anyway (see
      // `applySandboxBuildPolicy`). Done before any install so both installs benefit.
      const pnpmPolicy = applySandboxBuildPolicy({ targetDir: plan.sandboxProfileDir, copiedFiles: copy.copied })
      // F40: stat every `link:`/`file:` target BEFORE trusting the install's exit code, because
      // `plugin install` exits 0 while creating a link to a directory that is not there.
      const manifest = readProfileManifest(plan.sandboxProfileDir)
      const danglingLinks = danglingLocalDependencies(localDependencyTargets(manifest, plan.sandboxProfileDir))
      const installed = runProfileInstall({
        dshMain,
        dshHome: plan.sandboxHome,
        profile: plan.profile,
        timeoutMs,
        env: scrubbedEnv(baseEnv, { DSH_HOME: plan.sandboxHome }),
      })
      return {
        copied: copy.copied,
        missing: copy.missing,
        // The code travels so the executor can tell a build-script refusal (packages installed)
        // from a genuine failure to install the copy's dependencies.
        install: { exitCode: installed.exitCode, detail: installed.detail, code: installed.diagnosis.code },
        danglingLinks: danglingLinks.map((link) => ({ name: link.name, spec: link.spec, target: link.target })),
        pnpmPolicy,
      }
    },
    cleanup: async ({ dshHome, port, extraPorts, timeoutMs }) => {
      const removed = removeSandbox(dshHome)
      // "The directory is gone" is not "the process is gone": on Windows the Host keeps
      // helper processes alive, so the port is the second half of the proof (R12 pitfall).
      // T-306 adds a second port when the Host printed a different one than `--port`.
      const ports = [port, ...(extraPorts ?? [])]
      const readings = await Promise.all(ports.map((each) => probeHttp(each, Math.min(timeoutMs, 2000))))
      const stillAnswering = readings
        .map((reading, index) => ({ port: ports[index], status: reading.status }))
        .filter((entry) => entry.status !== null)
      const portClosed = stillAnswering.length === 0
      return {
        removed: removed.removed,
        portClosed,
        detail: `${removed.removed ? 'sandbox removed' : 'sandbox left behind'} · port ${
          portClosed ? 'closed' : `still answering ${stillAnswering.map((entry) => `${entry.port}:${entry.status}`).join(', ')}`
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
