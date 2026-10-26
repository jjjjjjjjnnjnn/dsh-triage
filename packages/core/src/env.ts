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
import type { EnvFingerprint, InstalledPackage } from './types.js'

export interface LoadEnvInput {
  /** `$DSH_HOME`, defaults to `~/.dsh`. */
  readonly dshHome?: string
  /** Profile name, defaults to `web`. */
  readonly profile?: string
  /** Injected for determinism in tests. */
  readonly nodeVersion?: string
  readonly platform?: string
  readonly arch?: string
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
 * Resolution order for the DSH runtime version mirrors how a profile actually
 * resolves imports: the profile's own `node_modules` first, then the shared
 * `profiles/node_modules` (pnpm `nodeLinker: hoisted`).
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

  const runtime = await readRuntimeVersion([profileNodeModules, sharedNodeModules])
  const installed = await readInstalledVersions(manifest.value, [profileNodeModules, sharedNodeModules])

  return ok({
    dsh: runtime,
    node: input.nodeVersion ?? process.versions.node,
    platform: input.platform ?? process.platform,
    arch: input.arch ?? process.arch,
    profile,
    profileDir,
    bundles: manifest.value.bundles,
    installed,
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
