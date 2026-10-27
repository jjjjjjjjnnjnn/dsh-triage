/**
 * Composition loader: reads the profile's declared layer stack into plain data.
 *
 * This is the app-edge IO boundary. The engine (`@dsh-triage/core`) stays pure;
 * everything that touches the disk lives here or in `env.ts`.
 *
 * Resolution order matches a real profile: the profile's own `node_modules`
 * first, then the shared `profiles/node_modules` (pnpm `nodeLinker: hoisted`).
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { CopyLocation, DuplicateCopy, EnvFingerprint, InstallOrigin, RowDeclaration, RowTarget } from '@dsh-triage/core'

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

  const declarers = await findDeclarers(env, new Set(targets.map((target) => target.module)))

  for (const target of targets) {
    const cached = cache.get(target.module)
    const resolved = cached === undefined ? await resolveModuleManifest(env.profileDir, target.module, roots) : cached
    cache.set(target.module, resolved)
    const declaredBy = declarers.get(target.module)
    out.push({
      rowId: target.rowId,
      module: target.module,
      source: target.source,
      manifest: resolved === null ? null : resolved.manifest,
      version: resolved === null ? null : resolved.version,
      ...(declaredBy === undefined ? {} : { declaredBy }),
    })
  }
  return out
}

/* ---------------------------- install provenance ---------------------------- */

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
type DependencyField = (typeof DEPENDENCY_FIELDS)[number]

interface InstalledManifest {
  readonly name: string
  /** Path relative to the DSH home, so nothing absolute can leak into SSOT. */
  readonly relativePath: string
  readonly dir: string
  readonly manifest: Record<string, unknown>
}

/**
 * Which installed packages declare `modules` under a dependency field?
 *
 * This is the `npm explain` idea ("why is this package here?") applied to the
 * shadowing cases: the useful sentence is not "the row is denied" but "the copy is
 * here because dsh-pdf lists it under dependencies".
 */
export async function findDeclarers(
  env: EnvFingerprint,
  modules: ReadonlySet<string>,
): Promise<ReadonlyMap<string, readonly InstallOrigin[]>> {
  const out = new Map<string, InstallOrigin[]>()
  if (modules.size === 0) return out

  const profileManifest = await readManifestRecord(env.profileDir)
  const installed = [
    ...(profileManifest === null
      ? []
      : [{ name: String(profileManifest['name'] ?? '(profile)'), version: readVersion(profileManifest), manifest: profileManifest }]),
    ...(await listInstalledPackages(join(env.profileDir, 'node_modules'))),
    ...(await listInstalledPackages(join(dirname(env.profileDir), 'node_modules'))),
  ]

  for (const pkg of installed) {
    for (const field of DEPENDENCY_FIELDS) {
      const declared = pkg.manifest[field]
      if (declared === null || typeof declared !== 'object') continue
      for (const module of Object.keys(declared as Record<string, unknown>)) {
        if (!modules.has(module)) continue
        const bucket = out.get(module) ?? []
        if (!bucket.some((origin) => origin.name === pkg.name && origin.field === field)) {
          bucket.push({ name: pkg.name, version: readVersion(pkg.manifest), field })
        }
        out.set(module, bucket)
      }
    }
  }

  for (const bucket of out.values()) {
    bucket.sort((left, right) => left.name.localeCompare(right.name) || left.field.localeCompare(right.field))
  }
  return out
}

/**
 * Same package name, different versions, two physical copies (Maven
 * `dependencyConvergence` for a single module tree).
 *
 * Only **different versions** are reported: pnpm hard-links one version into both
 * roots, and flagging that would bury the real finding. Paths are relative to the
 * DSH home on purpose — verdicts land in publishable SSOT.
 */
export async function findDuplicateCopies(env: EnvFingerprint): Promise<readonly DuplicateCopy[]> {
  const sharedModules = join(dirname(env.profileDir), 'node_modules')
  const copies = new Map<string, CopyLocation[]>()

  const add = (pkg: InstalledManifest, scope: CopyLocation['scope']): void => {
    const bucket = copies.get(pkg.name) ?? []
    bucket.push({ path: pkg.relativePath, version: readVersion(pkg.manifest), scope })
    copies.set(pkg.name, bucket)
  }

  for (const pkg of await listInstalledPackages(join(env.profileDir, 'node_modules'))) add(pkg, 'profile')
  for (const pkg of await listInstalledPackages(sharedModules)) add(pkg, 'shared')

  // One level of nesting is where the interesting failure lives: a plugin's own
  // dependency copy. Deeper trees are pnpm's business, not a diagnosis.
  for (const pkg of await listInstalledPackages(join(env.profileDir, 'node_modules'))) {
    for (const nested of await listInstalledPackages(join(pkg.dir, 'node_modules'))) {
      if (!copies.has(nested.name)) continue
      add(nested, 'nested')
    }
  }

  const duplicates: DuplicateCopy[] = []
  for (const [name, list] of [...copies.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (list.length < 2) continue
    const versions = new Set(list.map((copy) => copy.version ?? 'unknown'))
    duplicates.push({
      name,
      copies: [...list].sort((left, right) => left.path.localeCompare(right.path)),
      kind: versions.size > 1 ? 'different-versions' : 'same-version',
    })
  }
  return duplicates
}

async function listInstalledPackages(root: string): Promise<readonly InstalledManifest[]> {
  let entries: readonly { name: string; isDirectory(): boolean }[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: InstalledManifest[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      const scopeDir = join(root, entry.name)
      let scoped: readonly { name: string; isDirectory(): boolean }[]
      try {
        scoped = await readdir(scopeDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const child of scoped) {
        if (!child.isDirectory()) continue
        const pkg = await readInstalled(join(scopeDir, child.name), `${entry.name}/${child.name}`, root)
        if (pkg !== null) out.push(pkg)
      }
      continue
    }
    const pkg = await readInstalled(join(root, entry.name), entry.name, root)
    if (pkg !== null) out.push(pkg)
  }
  return out
}

async function readInstalled(dir: string, name: string, root: string): Promise<InstalledManifest | null> {
  const manifest = await readManifestRecord(dir)
  if (manifest === null) return null
  const declaredName = typeof manifest['name'] === 'string' && manifest['name'] !== '' ? manifest['name'] : name
  // Relative to the DSH home (`<dshHome>/profiles/<p>/...`), so the path in SSOT
  // never contains a user name.
  const relative = relativeFromProfiles(root, declaredName)
  return { name: declaredName, relativePath: relative, dir, manifest }
}

function relativeFromProfiles(root: string, name: string): string {
  // `root` is always `<dshHome>/profiles/node_modules` or `<dshHome>/profiles/<p>/node_modules`.
  const parts = root.split(/[\\/]/)
  const profilesIndex = parts.lastIndexOf('profiles')
  const tail = profilesIndex === -1 ? [] : parts.slice(profilesIndex)
  return [...tail, ...name.split('/')].join('/')
}

async function readManifestRecord(dir: string): Promise<Record<string, unknown> | null> {
  const text = await readTextOrNull(join(dir, 'package.json'))
  if (text === null) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
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
