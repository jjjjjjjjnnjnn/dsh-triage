/**
 * Composition loader: reads the profile's declared layer stack into plain data.
 *
 * This is the app-edge IO boundary. The engine (`@dsh-triage/core`) stays pure;
 * everything that touches the disk lives here or in `env.ts`.
 *
 * Resolution order matches a real profile: the profile's own `node_modules`
 * first, then the shared `profiles/node_modules` (pnpm `nodeLinker: hoisted`).
 */

import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import {
  asarReadFile,
  asarReadManifest,
  openAsar,
} from '@dsh-triage/core'
import type {
  AsarArchive,
  CopyLocation,
  DuplicateCopy,
  EnvFingerprint,
  InstallOrigin,
  RowDeclaration,
  RowTarget,
} from '@dsh-triage/core'

export interface BundleLayer {
  readonly name: string
  /** Raw package.json, passed to the admission engine as-is. */
  readonly manifest: unknown
  readonly version: string | null
  readonly dir: string
  /**
   * Which root supplied this layer (M11). A kernel-provided bundle is not a user plugin and must
   * not be reported as "not installed"; the provenance is what lets the diagnostic say so.
   *
   * M16: a bundle read out of the desktop archive is `kernel` too — it is the copy the Host is
   * running, and the three existing values stay the only values (M16-C5).
   */
  readonly provenance: 'kernel' | 'profile' | 'shared'
  /**
   * Every patch file the bundle declares, in `dsh.bundle.patch` order.
   *
   * WHY THIS IS A LIST: upstream allows `patch` to be one file *or* an ordered list,
   * and the shipped `dsh-web-app` uses the list form (its own layer plus four
   * `presets/*.patch.yml` compositions). Reading only the string form silently
   * dropped that whole bundle on a real sandbox: 96 rows vanished from the static
   * composition and every one of them looked "running but undeclared".
   */
  readonly patchFiles: readonly BundlePatchFile[]
  /** First tree-scope patch file, for callers that only want one path. */
  readonly patchPath: string | null
  readonly patchText: string | null
}

/** A patch file a bundle declares, and which composition it belongs to. */
export interface BundlePatchFile {
  /** Path as written in `package.json`. */
  readonly relative: string
  readonly path: string
  /**
   * `tree` files compose the loader tree; `preset` files compose an agent preset
   * and are *not* part of that tree (their rows never become loader entries).
   */
  readonly scope: 'tree' | 'preset'
  readonly text: string | null
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

/**
 * Every `node_modules` a profile resolves through, in the order Node would search them (M11).
 *
 * Kernel roots first: a stale shared copy of a kernel package must never answer for the kernel
 * (N7), and a row that names `@deepseek-ai/dsh-agent@0.1.0-rc.6` while the kernel ships
 * `0.2.2-rc.1` produces a denial about a package nobody installed. `loadBundleLayers()` and
 * `resolveRows()` share this one list on purpose — two lists is how the layer and the row end up
 * describing different versions of the same package.
 */
export function moduleRoots(
  env: EnvFingerprint,
): readonly { readonly root: string; readonly provenance: BundleLayer['provenance'] }[] {
  const roots: Array<{ root: string; provenance: BundleLayer['provenance'] }> = []
  const add = (root: string | undefined, provenance: BundleLayer['provenance']): void => {
    if (root === undefined || root === '') return
    if (roots.some((entry) => entry.root === root)) return
    roots.push({ root, provenance })
  }
  for (const root of env.kernelRoots ?? []) add(root, 'kernel')
  add(join(env.profileDir, 'node_modules'), 'profile')
  // `profileDir` is `<dshHome>/profiles/<name>`, so the shared pnpm root a profile actually
  // resolves through is its *parent* `node_modules`.
  add(join(dirname(env.profileDir), 'node_modules'), 'shared')
  return roots
}

export async function loadBundleLayers(
  env: EnvFingerprint,
  dshHome: string,
  errors: string[] = [],
): Promise<{ readonly layers: readonly BundleLayer[] }> {
  /*
   * M11 / issue #1: the kernel ships `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` as
   * bundles, and they are not under the profile. Searching only the profile made the Host's own
   * layers look "not installed" — a warning about a package that is demonstrably running.
   */
  const roots = moduleRoots(env)
  /*
   * M16-C1: on a desktop install the VERSION and the kernel manifests already come from `app.asar`
   * (M14). The patches did not, and that is what made the CLI judge a different composition than the
   * Host: the shared cache still ships `dsh-base@0.1.0-rc.6`, whose `llm-deepseek` row names
   * `@deepseek-ai/dsh-llm-deepseek` while the running `dsh-base@0.2.2-rc.1` names
   * `@deepseek-ai/dsh-llm-deepseek-api-key`. Same row id, two modules, one phantom collision
   * (`audit/RECON_2026-11-12_composition-source.md`).
   *
   * The archive is consulted FIRST for any bundle it contains; a bundle it does not contain is read
   * from disk exactly as before (M16-C2/N3). No path is synthesized: `dir` stays a real directory so
   * row-level resolution keeps working.
   */
  const archive = kernelArchiveOf(env)

  const layers: BundleLayer[] = []

  for (const name of env.bundles) {
    const fromArchive = archive === null ? null : readBundleFromArchive(archive, name, errors)
    if (fromArchive !== null) {
      layers.push(fromArchive)
      continue
    }
    const found = await resolvePackageDir(name, roots)
    if (found === null) {
      // The old sentence said "under the profile"; once the kernel is searched that is no longer true.
      errors.push(
        `bundle ${name} is listed in dsh.profile.bundles but no copy was found in the profile, the shared layer, or the kernel`,
      )
      continue
    }
    const { dir, provenance } = found
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
    const relatives = readBundlePatchPaths(manifest)
    if (relatives.length === 0 && declaresBundlePatch(manifest)) {
      errors.push(`bundle ${name} declares a dsh.bundle.patch that is neither a string nor a list of strings`)
      continue
    }
    const patchFiles: BundlePatchFile[] = []
    for (const relative of relatives) {
      const path = join(dir, relative)
      const text = await readTextOrNull(path)
      if (text === null) errors.push(`bundle ${name} declares patch ${relative} but the file is not readable`)
      patchFiles.push({ relative, path, scope: patchScopeOf(relative), text })
    }
    const firstTree = patchFiles.find((file) => file.scope === 'tree') ?? null
    layers.push({
      name,
      manifest,
      version: readVersion(manifest),
      dir,
      provenance,
      patchFiles,
      patchPath: firstTree?.path ?? null,
      patchText: firstTree?.text ?? null,
    })
  }

  return { layers }
}

/* ---------------------- M16: the kernel's own bundle patches ---------------------- */

/**
 * The archive M14 already read, or `null`.
 *
 * WHY THIS IS NOT A PATH WALK: `env.kernelProbe` records where the archive was and whether it was
 * readable. If it was, this function opens the same file; if it was `absent` / `unreadable`, the
 * whole M16 branch is skipped and the old behaviour is preserved byte for byte (M16-C2/N5). The
 * archive path is never guessed from `kernelRoots` — those are directories, and treating one of them
 * as an archive would turn "not found" into a different wrong answer.
 */
function kernelArchiveOf(env: EnvFingerprint): AsarArchive | null {
  if (env.dshSource !== 'kernel-asar') return null
  const probe = env.kernelProbe
  if (probe === undefined || probe.state !== 'read' || probe.path === null) return null
  const opened = openAsar(probe.path)
  return 'code' in opened ? null : opened
}

/** `dsh/node_modules/<bundle>/…` — the archive's own layout for kernel packages. */
function archiveBundlePath(name: string): readonly string[] {
  return ['dsh', 'node_modules', ...name.split('/')]
}

/** Normalise a patch path written in a manifest (`./x.yml`, `x.yml`, `a/b.yml`). */
function archivePatchPath(relative: string): readonly string[] {
  return relative
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.')
}

/**
 * Read one bundle out of the archive, or `null` when it is not there.
 *
 * C3 (same source) is enforced by construction: the manifest and every patch file come from this one
 * archive. A declared patch that the archive does not contain becomes `text: null` plus a readable
 * error — it is **never** filled in from the disk copy (M16-C3/N4). `dir` is deliberately left `''`:
 * there is no real directory for this layer, and inventing one would make `resolveFromDeclarer`
 * search a path that cannot exist.
 */
function readBundleFromArchive(archive: AsarArchive, name: string, errors: string[]): BundleLayer | null {
  const base = archiveBundlePath(name)
  const manifest = asarReadManifest(archive, [...base, 'package.json'])
  if (manifest === null) return null
  const relatives = readBundlePatchPaths(manifest)
  if (relatives.length === 0 && declaresBundlePatch(manifest)) {
    // The archive has a manifest whose `dsh.bundle.patch` is malformed: say so instead of shipping a
    // quietly thinner tree, then fall through to the disk copy (which will report the same problem).
    errors.push(`bundle ${name} says dsh.bundle.patch is neither a string nor a list of strings (inside the desktop archive)`)
    return null
  }
  const patchFiles: BundlePatchFile[] = []
  for (const relative of relatives) {
    const bytes = asarReadFile(archive, [...base, ...archivePatchPath(relative)])
    const text = bytes === null ? null : bytes.toString('utf8')
    if (text === null) {
      errors.push(`bundle ${name} declares patch ${relative} but the desktop archive does not contain it`)
    }
    patchFiles.push({ relative, path: '', scope: patchScopeOf(relative), text })
  }
  const firstTree = patchFiles.find((file) => file.scope === 'tree') ?? null
  return {
    name,
    manifest,
    version: readVersion(manifest),
    dir: '',
    provenance: 'kernel',
    patchFiles,
    patchPath: firstTree?.path ?? null,
    patchText: firstTree?.text ?? null,
  }
}

/** The composition a patch file belongs to. Upstream ships preset files under `presets/`. */
export function patchScopeOf(relative: string): 'tree' | 'preset' {
  return relative.replaceAll('\\', '/').split('/').includes('presets') ? 'preset' : 'tree'
}

function declaresBundlePatch(manifest: unknown): boolean {
  if (manifest === null || typeof manifest !== 'object') return false
  const dsh = (manifest as Record<string, unknown>)['dsh']
  if (dsh === null || typeof dsh !== 'object') return false
  const bundle = (dsh as Record<string, unknown>)['bundle']
  if (bundle === null || typeof bundle !== 'object') return false
  return (bundle as Record<string, unknown>)['patch'] !== undefined
}

/**
 * Read `package.json#dsh.bundle.patch` as an ordered list.
 *
 * Returns an empty list when the package declares no patch at all *and* when the
 * field is malformed — the caller distinguishes the two via `declaresBundlePatch`,
 * so a typo becomes a reported error instead of a silently thinner tree.
 */
export function readBundlePatchPaths(manifest: unknown): readonly string[] {
  if (manifest === null || typeof manifest !== 'object') return []
  const dsh = (manifest as Record<string, unknown>)['dsh']
  if (dsh === null || typeof dsh !== 'object') return []
  const bundle = (dsh as Record<string, unknown>)['bundle']
  if (bundle === null || typeof bundle !== 'object') return []
  const patch = (bundle as Record<string, unknown>)['patch']
  if (typeof patch === 'string') return patch === '' ? [] : [patch]
  if (!Array.isArray(patch)) return []
  const paths: string[] = []
  for (const item of patch) {
    if (typeof item !== 'string' || item === '') return []
    paths.push(item)
  }
  return paths
}

/** Read `package.json#dsh.bundle.patch`, the marker that makes a package a profile layer. */
export function readBundlePatchPath(manifest: unknown): string | null {
  return readBundlePatchPaths(manifest)[0] ?? null
}

export function readVersion(manifest: unknown): string | null {
  if (manifest === null || typeof manifest !== 'object') return null
  const version = (manifest as Record<string, unknown>)['version']
  return typeof version === 'string' ? version : null
}

export async function loadPatchText(path: string): Promise<string | null> {
  return readTextOrNull(path)
}

async function resolvePackageDir(
  name: string,
  roots: readonly { readonly root: string; readonly provenance: BundleLayer['provenance'] }[],
): Promise<{ readonly dir: string; readonly provenance: BundleLayer['provenance'] } | null> {
  for (const { root, provenance } of roots) {
    const dir = join(root, ...name.split('/'))
    const manifest = await readTextOrNull(join(dir, 'package.json'))
    if (manifest !== null) return { dir, provenance }
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

/** A layer the caller already loaded, which is all the fallback needs to name a declarer. */
export interface RowResolutionContext {
  /**
   * `dsh.profile.bundles` layers as `loadComposition()` read them.
   *
   * WHY THE CALLER PASSES THEM: a row's `source` is a human label (`bundle:<name>`,
   * `bundle:<name>/<file>`, `patch:profile`), and turning a label into a path by parsing the string is
   * how a longest-prefix miss silently falls back to the profile directory (measured R95: doing that
   * made "resolve from the declaring bundle" look identical to the broken flat lookup).
   */
  readonly layers: readonly Pick<BundleLayer, 'name' | 'dir'>[]
}

/**
 * Which loaded layer declared this row? `null` means "the profile or the home patch did" — those
 * rows belong to no bundle, so the caller resolves them from the profile directory.
 *
 * Longest prefix wins on purpose: `@deepseek-ai/dsh-base` is a prefix of no other layer today, but
 * `dsh-web-app` and a future `dsh-web-app/extra` would both match `bundle:dsh-web-app/…`, and the
 * more specific layer is the one that actually wrote that file.
 */
export function declarerDirOf(
  source: string,
  layers: readonly Pick<BundleLayer, 'name' | 'dir'>[],
): string | null {
  if (!source.startsWith('bundle:')) return null
  const rest = source.slice('bundle:'.length)
  let best: Pick<BundleLayer, 'name' | 'dir'> | null = null
  for (const layer of layers) {
    if (rest !== layer.name && !rest.startsWith(`${layer.name}/`)) continue
    if (best === null || layer.name.length > best.name.length) best = layer
  }
  /*
   * M16: a layer read out of the desktop archive carries `dir: ''` — there is no directory on disk to
   * search from. Returning `null` keeps the caller's old fallback (`env.profileDir`) instead of handing
   * `realpath('')` a path that cannot exist.
   */
  return best === null || best.dir === '' ? null : best.dir
}

/**
 * Node's own `NODE_MODULES_PATHS(START)`, as the Node docs state it: walk up from the starting
 * directory, append `node_modules` at every level, and skip levels that are already `node_modules`.
 *
 * WHY NOT `createRequire().resolve()`: admission only needs `package.json`, while Node's resolver
 * also demands a loadable entry (and honours `exports`, which can refuse a subpath that has a
 * manifest). A pure function of the path is the same search order without those extra refusals, and
 * it can be pinned by unit tests instead of by whichever Node build happens to run.
 */
export function nodeModulesSearchPath(fromDir: string): readonly string[] {
  const parts = fromDir.split(sep)
  const dirs: string[] = []
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index] === 'node_modules') continue
    const prefix = parts.slice(0, index + 1).join(sep)
    if (prefix === '') continue
    dirs.push(join(prefix, 'node_modules'))
  }
  return dirs
}

/**
 * Resolve each row's module to the `package.json` that a real import would use.
 *
 * M13 (R95): a flat root list is not enough. pnpm's default `isolated` layout keeps the whole tree
 * under `node_modules/.pnpm/<pkg>@<ver>/node_modules/`, so `<root>/<name>/package.json` finds only the
 * profile's DIRECT dependencies — measured on a sandbox built the way `record_client_serve` builds one:
 * **2 of 190 rows** resolved, and the other 188 were reported as "not installed under this profile"
 * while the running Host loaded every one of them. That is `BS-61`'s CLI half.
 *
 * ORDER (M13-C2): the flat roots run first and keep every answer they already give — `M11-N9` ("a
 * kernel copy outranks a stale shared copy") survives untouched. Only a row the flat lookup cannot
 * find is retried, from the directory of the bundle that declared it, following Node's search path
 * (M13-C1). A miss on both stays a miss: no version is ever guessed.
 */
export async function resolveRows(
  env: EnvFingerprint,
  targets: readonly RowTarget[],
  context?: RowResolutionContext,
): Promise<readonly RowDeclaration[]> {
  // `profileDir` is `<dshHome>/profiles/<name>`, so the shared pnpm root that a
  // profile actually resolves through is its *parent* `node_modules`.
  const roots = moduleRoots(env).map((entry) => entry.root)
  const flatCache = new Map<string, ResolvedManifest | null>()
  /** Keyed by module + the declarer's real directory: the same name can answer differently per bundle. */
  const declarerCache = new Map<string, ResolvedManifest | null>()
  const out: RowDeclaration[] = []

  const declarers = await findDeclarers(env, new Set(targets.map((target) => target.module)))

  /*
   * M14-C3 (同源): when the runtime version came out of the desktop archive, the kernel's OWN packages
   * must be judged against the manifests from that same archive. Mixing a `0.2.2-rc.1` runtime with
   * `0.1.0-rc.6` cached manifests turns every kernel package into a false denial (RECON §4: 125 of them).
   *
   * Scope is deliberately narrow: this only applies to `@deepseek-ai/*` names the archive knows about.
   * Third-party plugins (dsh-remedy, dshmarket, …) keep the old resolution — their manifests really do
   * live under the profile, and pretending otherwise would invent a second failure mode (M14-N3).
   */
  const kernelManifests = env.dshSource === 'kernel-asar' ? env.kernelManifests : undefined

  for (const target of targets) {
    const fromKernel = kernelManifests?.get(target.module)
    if (fromKernel !== undefined) {
      const declaredBy = declarers.get(target.module)
      out.push({
        rowId: target.rowId,
        module: target.module,
        source: target.source,
        manifest: fromKernel,
        version: typeof fromKernel['version'] === 'string' ? fromKernel['version'] : null,
        ...(declaredBy === undefined ? {} : { declaredBy }),
      })
      continue
    }

    /*
     * M14-C3 (同源): a kernel-scope package the archive does NOT ship has a manifest on disk from the OLD
     * runtime (peers pinned `^0.1.0-rc.6`). Judging it against `0.2.2-rc.1` reports a denial about a shape
     * nobody installed; calling it "not installed" is also false. It is *unverifiable*, so it is `unknown`
     * with that word attached (R101 measured 9 of these on the maintainer's machine).
     *
     * Scoped to `@deepseek-ai/*` only, and only when the version itself came from the archive — otherwise a
     * genuine dead row in a fixture would be softened into `unknown` (that regression was caught by
     * `tests/e2e/cli.test.ts` CASE-11080 on the first attempt).
     */
    const kernelScoped = kernelManifests !== undefined && target.module.startsWith('@deepseek-ai/')
    if (kernelScoped) {
      const declaredBy = declarers.get(target.module)
      out.push({
        rowId: target.rowId,
        module: target.module,
        source: target.source,
        manifest: null,
        version: null,
        unverifiable: true,
        ...(declaredBy === undefined ? {} : { declaredBy }),
      })
      continue
    }

    let resolved = flatCache.get(target.module)
    if (resolved === undefined) {
      resolved = await resolveModuleManifest(env.profileDir, target.module, roots)
      flatCache.set(target.module, resolved)
    }
    if (resolved === null && context !== undefined) {
      resolved = await resolveFromDeclarer(env, target, context, declarerCache)
    }
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

/** One row, resolved from the bundle that declared it. Never throws: an unreadable declarer is a miss. */
async function resolveFromDeclarer(
  env: EnvFingerprint,
  target: RowTarget,
  context: RowResolutionContext,
  cache: Map<string, ResolvedManifest | null>,
): Promise<ResolvedManifest | null> {
  const declared = declarerDirOf(target.source, context.layers)
  const start = declared ?? env.profileDir
  /*
   * SYMLINKS ARE THE POINT: under pnpm `isolated` a layer directory is a symlink into
   * `.pnpm/<pkg>@<ver>/node_modules/<pkg>`, and Node resolves through the real path (default
   * `--preserve-symlinks=false`). Searching from the symlink path reaches nothing; searching from the
   * real path lands on the very tree the loader uses — measured: 2 → 190 rows resolved, 0 rows changed.
   */
  let real = start
  try {
    real = await realpath(start)
  } catch {
    // An unreadable declarer directory stays a miss (M13-N5); we never substitute another layer.
  }
  const isRelative = target.module.startsWith('.') || isAbsolute(target.module)
  if (!isRelative) {
    const key = `${target.module}\u0000${real}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const found = await resolveModuleManifest(real, target.module, nodeModulesSearchPath(real))
    cache.set(key, found)
    return found
  }
  return await resolveModuleManifest(real, target.module, [])
}

/* ---------------------------- install provenance ---------------------------- */

/**
 * Fields that actually materialise a copy on disk.
 *
 * `peerDependencies` never installs anything, so it is not an origin: naming it
 * would tell the user to edit the one field that is already correct. A
 * *dependency's* `devDependencies` are not installed either — only the profile's
 * own devDependencies are.
 */
const INSTALL_FIELDS = ['dependencies', 'optionalDependencies'] as const
const PROFILE_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
type InstallField = (typeof PROFILE_FIELDS)[number]

interface InstalledManifest {
  readonly name: string
  /** Path relative to the DSH home, so nothing absolute can leak into SSOT. */
  readonly relativePath: string
  readonly dir: string
  readonly manifest: Record<string, unknown>
  /** True when the path is a symlink/junction (pnpm `isolated`, `link:`). */
  readonly linked: boolean
}

/**
 * Which installed packages declare `modules` under a field that installs them?
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
  const declarers: { name: string; manifest: Record<string, unknown>; fields: readonly InstallField[] }[] = []
  if (profileManifest !== null) {
    declarers.push({
      name: String(profileManifest['name'] ?? '(profile)'),
      manifest: profileManifest,
      fields: PROFILE_FIELDS,
    })
  }
  const installed = [
    ...(await listInstalledPackages(join(env.profileDir, 'node_modules'))),
    ...(await listInstalledPackages(join(dirname(env.profileDir), 'node_modules'))),
  ]
  for (const pkg of installed) declarers.push({ name: pkg.name, manifest: pkg.manifest, fields: INSTALL_FIELDS })

  for (const declarer of declarers) {
    for (const field of declarer.fields) {
      const declared = declarer.manifest[field]
      if (declared === null || typeof declared !== 'object') continue
      for (const module of Object.keys(declared as Record<string, unknown>)) {
        if (!modules.has(module)) continue
        const bucket = out.get(module) ?? []
        if (!bucket.some((origin) => origin.name === declarer.name && origin.field === field)) {
          bucket.push({ name: declarer.name, version: readVersion(declarer.manifest), field })
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
 * Same package name, two physical copies at two *known, different* versions
 * (Maven `dependencyConvergence` for a single module tree).
 *
 * Rules learned the hard way (R8 adversary pass):
 * - an unknown version is **not** evidence of a different version;
 * - nested copies count even when the name is absent from the root: two plugins
 *   each bundling their own copy is exactly the identity-split case;
 * - symlinked entries (`link:`, pnpm isolated) are followed, because a linked copy
 *   is still a second copy at runtime;
 * - the same version in two roots is the normal pnpm picture (hard link) and stays
 *   silent.
 *
 * Paths are relative to the DSH home on purpose — verdicts land in publishable SSOT.
 */
export async function findDuplicateCopies(env: EnvFingerprint): Promise<readonly DuplicateCopy[]> {
  const sharedModules = join(dirname(env.profileDir), 'node_modules')
  const bundles = new Set(env.bundles)
  const copies = new Map<string, CopyLocation[]>()

  const add = (pkg: InstalledManifest, scope: CopyLocation['scope']): void => {
    const bucket = copies.get(pkg.name) ?? []
    bucket.push({
      path: pkg.relativePath,
      version: readVersion(pkg.manifest),
      scope,
      ...(pkg.linked ? { linked: true } : {}),
    })
    copies.set(pkg.name, bucket)
  }

  for (const pkg of await listInstalledPackages(join(env.profileDir, 'node_modules'))) add(pkg, 'profile')
  for (const pkg of await listInstalledPackages(sharedModules)) add(pkg, 'shared')

  // One level of nesting is where the interesting failure lives: a plugin's own
  // dependency copy. Deeper trees are pnpm's business, not a diagnosis.
  for (const pkg of await listInstalledPackages(join(env.profileDir, 'node_modules'))) {
    for (const nested of await listInstalledPackages(join(pkg.dir, 'node_modules'))) add(nested, 'nested')
  }

  const duplicates: DuplicateCopy[] = []
  for (const [name, list] of [...copies.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (list.length < 2) continue
    const known = [...new Set(list.map((copy) => copy.version).filter((version): version is string => version !== null))]
    if (known.length < 2) continue
    duplicates.push({
      name,
      copies: [...list].sort((left, right) => left.path.localeCompare(right.path)),
      kind: 'different-versions',
      /*
       * T-866 / R92: measured on a real machine, 13 of 13 duplicates were plain libraries
       * (`@babel/runtime`, `semver`, `ws`, …) and not one was a bundle or a harness package. They
       * stay in the scan (the count is real) but they are not findings: two patch versions of a
       * transitive dependency is what a hoisted node_modules looks like everywhere.
       */
      surface: canSurfaceInDsh(name, bundles),
    })
  }
  return duplicates
}

/**
 * Can a second copy of this package actually collide inside DSH?
 *
 * Yes for the profile's own bundles (their entry ids are what the loader composes) and for the
 * harness's `@deepseek-ai/dsh*` packages (a second copy of those is the identity-split failure in
 * discussion #10364). No for anything else: DSH never resolves an arbitrary library by name.
 */
function canSurfaceInDsh(name: string, bundles: ReadonlySet<string>): boolean {
  if (bundles.has(name)) return true
  return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
}

async function listInstalledPackages(root: string): Promise<readonly InstalledManifest[]> {
  let entries: readonly { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: InstalledManifest[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    // `Dirent.isDirectory()` is false for a symlinked package directory, which is
    // how `link:` and pnpm's isolated linker appear. Follow the link instead of
    // pretending the package does not exist.
    const linked = entry.isSymbolicLink()
    if (!entry.isDirectory() && !linked) continue
    if (linked && !(await isDirectory(join(root, entry.name)))) continue
    if (entry.name.startsWith('@')) {
      const scopeDir = join(root, entry.name)
      let scoped: readonly { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }[]
      try {
        scoped = await readdir(scopeDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const child of scoped) {
        const childLinked = child.isSymbolicLink()
        if (!child.isDirectory() && !childLinked) continue
        if (childLinked && !(await isDirectory(join(scopeDir, child.name)))) continue
        const pkg = await readInstalled(join(scopeDir, child.name), `${entry.name}/${child.name}`, root, childLinked)
        if (pkg !== null) out.push(pkg)
      }
      continue
    }
    const pkg = await readInstalled(join(root, entry.name), entry.name, root, linked)
    if (pkg !== null) out.push(pkg)
  }
  return out
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

async function readInstalled(dir: string, name: string, root: string, linked: boolean): Promise<InstalledManifest | null> {
  const manifest = await readManifestRecord(dir)
  if (manifest === null) return null
  const declaredName = typeof manifest['name'] === 'string' && manifest['name'] !== '' ? manifest['name'] : name
  return { name: declaredName, relativePath: relativeFromProfiles(root, declaredName), dir, manifest, linked }
}

function relativeFromProfiles(root: string, name: string): string {
  // `root` is always `<dshHome>/profiles/node_modules` or
  // `<dshHome>/profiles/<p>/node_modules` (or a nested `node_modules` below it).
  const parts = root.split(/[\\/]/)
  const profilesIndex = parts.lastIndexOf('profiles')
  const tailParts = profilesIndex === -1 ? [] : parts.slice(profilesIndex)
  return [...tailParts, ...name.split('/')].join('/')
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

/** What a resolved row needs: the raw manifest (admission reads it) plus the version it states. */
type ResolvedManifest = { manifest: unknown; version: string | null }

async function resolveModuleManifest(
  profileDir: string,
  specifier: string,
  roots: readonly string[],
): Promise<ResolvedManifest | null> {
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
