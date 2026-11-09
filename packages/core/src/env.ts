/**
 * Environment fingerprint: "on whose machine is this verdict true?"
 *
 * Boundary rules:
 * - This module is the ONLY place in `core` that touches the filesystem.
 * - Reads are strictly limited to profile manifests and `package.json` files.
 *   Credentials, session logs and settings are never read (see COMPLIANCE.md §2).
 * - Every failure is returned as a {@link CoreError}; nothing throws.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CoreError, Result } from './result.js'
import { err, ok } from './result.js'
import type { DshSource, EnvFingerprint, InstalledPackage } from './types.js'

export interface LoadEnvInput {
  /** `$DSH_HOME`, defaults to `~/.dsh`. */
  readonly dshHome?: string
  /** Profile name, defaults to `web`. */
  readonly profile?: string
  /** Injected for determinism in tests. */
  readonly nodeVersion?: string
  readonly platform?: string
  readonly arch?: string
  /**
   * Entry point of the process that is asking (`process.argv[1]` by default). The kernel anchor is
   * resolved by walking up from here, so a plugin running inside a Host finds the runtime that is
   * actually executing instead of a stale copy under the profile. Pass `null` to skip the walk.
   * See `docs/specs/M11-kernel-resolution.md`.
   */
  readonly anchorEntry?: string | null
}

export interface ProfileManifest {
  readonly name: string | null
  readonly dependencies: readonly string[]
  readonly bundles: readonly string[]
}

const DEFAULT_PROFILE = 'web'

/** Resolve `$DSH_HOME` the same way DSH does, without importing DSH. */
export function defaultDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['DSH_HOME']
  if (configured !== undefined && configured.trim() !== '') return configured
  return join(homedir(), '.dsh')
}

export function resolveProfileDir(dshHome: string, profile: string): string {
  return join(dshHome, 'profiles', profile)
}

/**
 * Where the runtime actually is (M11).
 *
 * `nodeModules` is the `node_modules` that holds `@deepseek-ai/dsh`; `dshDir` is that package's own
 * directory. Both matter, because the two real layouts put the kernel's sibling packages in
 * different places: the desktop build hoists them next to `@deepseek-ai/dsh`
 * (`…/dsh/node_modules/@deepseek-ai/dsh-base`), while an npm-global install nests them under the
 * package (`…/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base`, issue #1).
 */
export interface KernelAnchor {
  readonly nodeModules: string | null
  readonly dshDir: string | null
  readonly source: DshSource
  readonly via: string | null
}

const UNRESOLVED_ANCHOR: KernelAnchor = { nodeModules: null, dshDir: null, source: 'unresolved', via: null }

/** A guard against a pathological path, not a heuristic: 40 levels is far past any real layout. */
const MAX_ANCHOR_DEPTH = 40

/**
 * Bundle roots the kernel provides, in the order Node itself would search them: the `dsh` package's
 * own `node_modules` first (issue #1's layout), then the directory that holds `@deepseek-ai/dsh`
 * (the desktop build's layout).
 */
export function kernelAnchorRoots(anchor: KernelAnchor): readonly string[] {
  const roots: string[] = []
  if (anchor.dshDir !== null) roots.push(join(anchor.dshDir, 'node_modules'))
  if (anchor.nodeModules !== null && !roots.includes(anchor.nodeModules)) roots.push(anchor.nodeModules)
  return roots
}

async function hasDshPackage(nodeModules: string): Promise<boolean> {
  const reading = await readPackageJson(join(nodeModules, '@deepseek-ai', 'dsh'))
  return reading.ok && reading.value.version !== null
}

/**
 * Resolve the running kernel.
 *
 * Order: the entry point's ancestor chain (`kernel`), then the profile's own `node_modules`, then
 * the shared `profiles/node_modules` (both `inferred`). Nothing readable is `unresolved` — we never
 * substitute a plausible number for a version we could not see.
 */
export async function resolveKernelAnchor(
  input: {
    readonly anchorEntry?: string | null
    readonly profileNodeModules?: string
    readonly sharedNodeModules?: string
  } = {},
): Promise<KernelAnchor> {
  /*
   * A path that resolves through the profile or the shared cache is NOT the kernel, even when the
   * entry-point walk lands on it. The installed CLI lives at
   * `<home>/profiles/<name>/node_modules/dsh-triage/dist/cli.js`, so walking up from it finds
   * `<home>/profiles/node_modules` — the stale cache. Calling that `kernel` would print
   * `0.1.0-rc.6 (kernel)`, which is a worse lie than `(inferred)`: it would claim the measurement
   * that the whole fix exists to make.
   */
  const known = new Set(
    [input.profileNodeModules, input.sharedNodeModules]
      .filter((value): value is string => typeof value === 'string' && value !== '')
      .map((value) => value.replace(/[\\/]+$/, '').toLowerCase()),
  )
  const isCache = (nodeModules: string): boolean => known.has(nodeModules.replace(/[\\/]+$/, '').toLowerCase())

  const entry = input.anchorEntry === undefined ? process.argv[1] : input.anchorEntry
  if (typeof entry === 'string' && entry !== '') {
    let dir = dirname(entry)
    for (let depth = 0; depth < MAX_ANCHOR_DEPTH; depth += 1) {
      const nodeModules = join(dir, 'node_modules')
      if (await hasDshPackage(nodeModules)) {
        return {
          nodeModules,
          dshDir: join(nodeModules, '@deepseek-ai', 'dsh'),
          source: isCache(nodeModules) ? 'inferred' : 'kernel',
          via: entry,
        }
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  for (const nodeModules of [input.profileNodeModules, input.sharedNodeModules]) {
    if (nodeModules === undefined) continue
    if (await hasDshPackage(nodeModules)) {
      return { nodeModules, dshDir: join(nodeModules, '@deepseek-ai', 'dsh'), source: 'inferred', via: nodeModules }
    }
  }
  return UNRESOLVED_ANCHOR
}

/** Pure parser: profile manifest -> the three fields this project cares about. */
export function parseProfileManifest(raw: unknown): Result<ProfileManifest, CoreError> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return err({ code: 'manifest-invalid', detail: 'profile package.json is not an object' })
  }
  const record = raw as Record<string, unknown>
  const name = typeof record['name'] === 'string' ? record['name'] : null

  const dependenciesRaw = record['dependencies']
  const dependencies =
    dependenciesRaw !== null && typeof dependenciesRaw === 'object' && !Array.isArray(dependenciesRaw)
      ? Object.keys(dependenciesRaw as Record<string, unknown>).sort((a, b) => a.localeCompare(b))
      : []

  const dsh = record['dsh']
  const profile = dsh !== null && typeof dsh === 'object' ? (dsh as Record<string, unknown>)['profile'] : undefined
  const bundlesRaw = profile !== null && typeof profile === 'object' ? (profile as Record<string, unknown>)['bundles'] : undefined
  const bundles = Array.isArray(bundlesRaw)
    ? bundlesRaw.filter((entry): entry is string => typeof entry === 'string')
    : []

  return ok({ name, dependencies, bundles })
}

interface PackageJsonReading {
  readonly version: string | null
}

async function readPackageJson(dir: string): Promise<Result<PackageJsonReading, CoreError>> {
  const file = join(dir, 'package.json')
  try {
    const text = await readFile(file, 'utf8')
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') {
      return err({ code: 'manifest-invalid', detail: 'package.json is not an object', path: file })
    }
    const version = (parsed as Record<string, unknown>)['version']
    return ok({ version: typeof version === 'string' ? version : null })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return err({ code: 'manifest-missing', detail: 'package.json not found', path: file })
    return err({ code: 'io-error', detail: describeError(error), path: file })
  }
}

/**
 * Load the fingerprint for one profile.
 *
 * Resolution order for the DSH runtime version (M11, `docs/specs/M11-kernel-resolution.md`):
 * the running kernel first (via the entry-point anchor), then the profile's own `node_modules`,
 * then the shared `profiles/node_modules` (pnpm `nodeLinker: hoisted`). Whichever answered is
 * recorded in `dshSource`, because a cached 0.1.0-rc.6 and a running 0.2.2-rc.1 are different facts.
 */
export async function loadEnv(input: LoadEnvInput = {}): Promise<Result<EnvFingerprint, CoreError>> {
  const dshHome = input.dshHome ?? defaultDshHome()
  const profile = input.profile ?? DEFAULT_PROFILE
  const profileDir = resolveProfileDir(dshHome, profile)

  let manifestText: string
  try {
    manifestText = await readFile(join(profileDir, 'package.json'), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return err({ code: 'profile-not-found', detail: `no profile manifest under ${profileDir}`, path: profileDir })
    }
    return err({ code: 'io-error', detail: describeError(error), path: profileDir })
  }

  let parsedManifest: unknown
  try {
    parsedManifest = JSON.parse(manifestText)
  } catch (error) {
    return err({ code: 'manifest-invalid', detail: describeError(error), path: join(profileDir, 'package.json') })
  }

  const manifest = parseProfileManifest(parsedManifest)
  if (!manifest.ok) return manifest

  const sharedNodeModules = join(dshHome, 'profiles', 'node_modules')
  const profileNodeModules = join(profileDir, 'node_modules')

  /*
   * M11: the version has to come from the runtime that is executing, not from whichever copy of
   * `@deepseek-ai/dsh` happens to sit under the profile. On the maintainer's machine those two
   * disagreed by a minor version (0.1.0-rc.6 cached vs 0.2.2-rc.1 running) and every `engines.dsh
   * >=0.2.x` plugin was reported BLOCKED, confidently and wrongly.
   */
  const anchor = await resolveKernelAnchor({
    anchorEntry: input.anchorEntry,
    profileNodeModules,
    sharedNodeModules,
  })
  /*
   * Only a `kernel` anchor yields kernel roots. An `inferred` anchor points at the profile or the
   * shared layer, which are already searched below — calling those "kernel" would let the
   * diagnostic claim a bundle was host-provided when it was really just a cached copy.
   */
  const kernelRoots = anchor.source === 'kernel' ? kernelAnchorRoots(anchor) : []
  const paths = [...kernelRoots, profileNodeModules, sharedNodeModules]

  const runtime = await readRuntimeVersion(paths)
  const installed = await readInstalledVersions(manifest.value, paths)

  return ok({
    dsh: runtime,
    node: input.nodeVersion ?? process.versions.node,
    platform: input.platform ?? process.platform,
    arch: input.arch ?? process.arch,
    profile,
    profileDir,
    bundles: manifest.value.bundles,
    installed,
    dshSource: runtime === null ? 'unresolved' : anchor.source,
    kernelRoots,
  })
}

async function readRuntimeVersion(nodeModulesCandidates: readonly string[]): Promise<string | null> {
  for (const nodeModules of nodeModulesCandidates) {
    const reading = await readPackageJson(join(nodeModules, '@deepseek-ai', 'dsh'))
    if (reading.ok && reading.value.version !== null) return reading.value.version
  }
  return null
}

async function readInstalledVersions(
  manifest: ProfileManifest,
  nodeModulesCandidates: readonly string[],
): Promise<readonly InstalledPackage[]> {
  const names = [...new Set([...manifest.dependencies, ...manifest.bundles])].sort((a, b) => a.localeCompare(b))
  const result: InstalledPackage[] = []
  for (const name of names) {
    result.push({ name, version: await resolveVersion(name, nodeModulesCandidates) })
  }
  for (const core of CORE_PACKAGES) {
    if (result.some((entry) => entry.name === core)) continue
    result.push({ name: core, version: await resolveVersion(core, nodeModulesCandidates) })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/** The one core package whose version is the runtime; kept explicit for clarity. */
const CORE_PACKAGES = ['@deepseek-ai/dsh'] as const

async function resolveVersion(name: string, nodeModulesCandidates: readonly string[]): Promise<string | null> {
  for (const nodeModules of nodeModulesCandidates) {
    const reading = await readPackageJson(join(nodeModules, ...name.split('/')))
    if (reading.ok && reading.value.version !== null) return reading.value.version
  }
  return null
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Convenience for callers that already know the directory (tests, probe sandboxes). */
export function profileDirOf(profileDir: string): { readonly profileDir: string; readonly dshHome: string } {
  return { profileDir, dshHome: dirname(dirname(profileDir)) }
}
