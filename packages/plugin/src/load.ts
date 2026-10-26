/**
 * Composition loader: reads the profile's declared layer stack into plain data.
 *
 * This is the app-edge IO boundary. The engine (`@dsh-triage/core`) stays pure;
 * everything that touches the disk lives here or in `env.ts`.
 *
 * Resolution order matches a real profile: the profile's own `node_modules`
 * first, then the shared `profiles/node_modules` (pnpm `nodeLinker: hoisted`).
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { EnvFingerprint, RowDeclaration, RowTarget } from '@dsh-triage/core'

export interface BundleLayer {
  readonly name: string
  /** Raw package.json, passed to the admission engine as-is. */
  readonly manifest: unknown
  readonly version: string | null
  readonly dir: string
  readonly patchPath: string | null
  readonly patchText: string | null
}

export interface CompositionEntry {
  readonly name: string
  readonly version: string | null
  readonly dir: string
  readonly manifest: unknown
}

export interface PatchFile {
  readonly path: string
  readonly text: string | null
}

export interface Composition {
  /** Bundle layers, in `dsh.profile.bundles` order. */
  readonly layers: readonly BundleLayer[]
  /** The profile's own patch layer (`<profile>/cordis.patch.yml`). */
  readonly profilePatch: PatchFile
  /** The home-level patch layer (`$DSH_HOME/cordis.patch.yml`). */
  readonly homePatch: PatchFile
  /** Non-fatal problems, reported verbatim so the user can fix the tree. */
  readonly errors: readonly string[]
}

export async function loadComposition(env: EnvFingerprint, dshHome: string): Promise<Composition> {
  const errors: string[] = []
  const { layers } = await loadBundleLayers(env, dshHome, errors)
  return {
    layers,
    profilePatch: {
      path: join(env.profileDir, 'cordis.patch.yml'),
      text: await readTextOrNull(join(env.profileDir, 'cordis.patch.yml')),
    },
    homePatch: {
      path: join(dshHome, 'cordis.patch.yml'),
      text: await readTextOrNull(join(dshHome, 'cordis.patch.yml')),
    },
    errors,
  }
}

export async function loadBundleLayers(
  env: EnvFingerprint,
  dshHome: string,
  errors: string[] = [],
): Promise<{ readonly layers: readonly BundleLayer[] }> {
  const roots = [join(env.profileDir, 'node_modules'), join(dshHome, 'profiles', 'node_modules')]
  const layers: BundleLayer[] = []

  for (const name of env.bundles) {
    const dir = await resolvePackageDir(name, roots)
    if (dir === null) {
      errors.push(`bundle ${name} is listed in dsh.profile.bundles but not installed under the profile`)
      continue
    }
    const manifestText = await readTextOrNull(join(dir, 'package.json'))
    if (manifestText === null) {
      errors.push(`bundle ${name} has no readable package.json at ${dir}`)
      continue
    }
    let manifest: unknown
    try {
      manifest = JSON.parse(manifestText)
    } catch (error) {
      errors.push(`bundle ${name} package.json is invalid JSON: ${describe(error)}`)
      continue
    }
    const patchRelative = readBundlePatchPath(manifest)
    const patchPath = patchRelative === null ? null : join(dir, patchRelative)
    layers.push({
      name,
      manifest,
      version: readVersion(manifest),
      dir,
      patchPath,
      patchText: patchPath === null ? null : await readTextOrNull(patchPath),
    })
    if (patchPath !== null && layers[layers.length - 1]?.patchText === null) {
      errors.push(`bundle ${name} declares patch ${patchRelative} but the file is not readable`)
    }
  }

  return { layers }
}

/** Read `package.json#dsh.bundle.patch`, the marker that makes a package a profile layer. */
export function readBundlePatchPath(manifest: unknown): string | null {
  if (manifest === null || typeof manifest !== 'object') return null
  const dsh = (manifest as Record<string, unknown>)['dsh']
  if (dsh === null || typeof dsh !== 'object') return null
  const bundle = (dsh as Record<string, unknown>)['bundle']
  if (bundle === null || typeof bundle !== 'object') return null
  const patch = (bundle as Record<string, unknown>)['patch']
  return typeof patch === 'string' ? patch : null
}

export function readVersion(manifest: unknown): string | null {
  if (manifest === null || typeof manifest !== 'object') return null
  const version = (manifest as Record<string, unknown>)['version']
  return typeof version === 'string' ? version : null
}

export async function loadPatchText(path: string): Promise<string | null> {
  return readTextOrNull(path)
}

async function resolvePackageDir(name: string, roots: readonly string[]): Promise<string | null> {
  for (const root of roots) {
    const dir = join(root, ...name.split('/'))
    const manifest = await readTextOrNull(join(dir, 'package.json'))
    if (manifest !== null) return dir
  }
  return null
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/* --------------------------- row-level attribution --------------------------- */

/**
 * Resolve each row's module to the `package.json` that a real import would use:
 * the profile's own `node_modules` first, then the shared `profiles/node_modules`
 * (pnpm `nodeLinker: hoisted`). A miss stays a miss — we never guess a version,
 * because a guessed version would turn "unknown" into a confident answer.
 */
export async function resolveRows(
  env: EnvFingerprint,
  targets: readonly RowTarget[],
): Promise<readonly RowDeclaration[]> {
  // `profileDir` is `<dshHome>/profiles/<name>`, so the shared pnpm root that a
  // profile actually resolves through is its *parent* `node_modules`.
  const sharedModules = join(dirname(env.profileDir), 'node_modules')
  const roots = [join(env.profileDir, 'node_modules'), sharedModules]
  const cache = new Map<string, { manifest: unknown; version: string | null } | null>()
  const out: RowDeclaration[] = []

  for (const target of targets) {
    const cached = cache.get(target.module)
    const resolved = cached === undefined ? await resolveModuleManifest(env.profileDir, target.module, roots) : cached
    cache.set(target.module, resolved)
    out.push({
      rowId: target.rowId,
      module: target.module,
      source: target.source,
      manifest: resolved === null ? null : resolved.manifest,
      version: resolved === null ? null : resolved.version,
    })
  }
  return out
}

async function resolveModuleManifest(
  profileDir: string,
  specifier: string,
  roots: readonly string[],
): Promise<{ manifest: unknown; version: string | null } | null> {
  const dirs: string[] = []
  if (specifier.startsWith('.') || resolve(specifier) === specifier) {
    // Relative/absolute rows point inside the profile tree; walk up to the
    // nearest manifest, mirroring how the loader resolves a local module. The
    // profile root is excluded on purpose: its own `package.json` is the
    // consumer manifest, not the row's package, and judging the row against it
    // would silently pass a plugin that declares nothing.
    let current = resolve(profileDir, specifier)
    for (let depth = 0; depth < 8; depth += 1) {
      if (current === resolve(profileDir)) break
      dirs.push(current)
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  } else {
    const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0] ?? specifier
    // A bare specifier with no package name (e.g. an absolute POSIX path seen on
    // Windows) must not resolve to the node_modules root itself.
    if (packageName.trim() === '' || packageName === '@') return null
    for (const root of roots) dirs.push(join(root, ...packageName.split('/')))
  }

  for (const dir of dirs) {
    const text = await readTextOrNull(join(dir, 'package.json'))
    if (text === null) continue
    try {
      const manifest: unknown = JSON.parse(text)
      return { manifest, version: readVersion(manifest) }
    } catch {
      return null
    }
  }
  return null
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
