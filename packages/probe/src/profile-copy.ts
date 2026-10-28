/**
 * Copying a real profile into a sandbox, and checking the copy is actually usable (T-304).
 *
 * WHY A COPY AND NOT A MOUNT: the whole point of the probe is to answer "would this run
 * alongside *my* bundles?" without touching the user's `~/.dsh`. R20 measured that copying
 * four declaration files is enough to boot the same composition (F38), so the sandbox gets a
 * *copy* — the real profile is only ever read.
 *
 * WHAT IS DELIBERATELY NOT COPIED:
 * - `node_modules/`: rebuilt by the package manager inside the sandbox (F39);
 * - `.plugin-manager/`: logs and install scratch, never declarations;
 * - `.npmrc`: it can carry a registry token, and 铁律 4 forbids moving credentials;
 * - anything else the profile happens to contain. A copy that silently drags the user's
 *   secrets or megabytes of cache into a probe artifact is exactly the failure this list
 *   prevents.
 *
 * F40, the reason {@link danglingLocalDependencies} exists: `{"x":"link:./not-here"}` makes
 * `dsh plugin install` exit **0** while creating a link to nothing. Without a stat, that
 * "successful" install would become evidence for a composition that cannot work.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export interface ProfileCopyResult {
  /** Declarations that were copied, in whitelist order. */
  readonly copied: readonly string[]
  /** Whitelist entries the source profile does not have (normal: `pnpm-workspace.yaml` is optional). */
  readonly missing: readonly string[]
}

/**
 * Copy `files` from `sourceDir` into `targetDir`, creating the target.
 *
 * Only the names passed in are considered, and only as plain files: this function is given
 * the whitelist by its caller, so an unexpected entry in a profile manifest cannot widen it.
 */
export function copyProfileDeclarations(input: {
  readonly sourceDir: string
  readonly targetDir: string
  readonly files: readonly string[]
}): ProfileCopyResult {
  mkdirSync(input.targetDir, { recursive: true })
  const copied: string[] = []
  const missing: string[] = []
  for (const file of input.files) {
    const source = join(input.sourceDir, file)
    if (!isFile(source)) {
      missing.push(file)
      continue
    }
    copyFileSync(source, join(input.targetDir, file))
    copied.push(file)
  }
  return { copied, missing }
}

/** One `link:`/`file:` dependency of a profile manifest, resolved against the profile dir. */
export interface LocalDependencyTarget {
  readonly name: string
  /** The literal spec, e.g. `link:./not-here`. */
  readonly spec: string
  /** Which dependency field carried it (`dependencies` / `devDependencies` / `optionalDependencies`). */
  readonly field: string
  /** Absolute path the spec points at, as resolved inside the profile. */
  readonly target: string
}

/** The manifest's dependency fields that a package manager actually installs. */
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const

/**
 * Local (non-registry) dependency targets declared by a profile manifest.
 *
 * `workspace:` and `npm:` are not local paths and are skipped: the first is resolved by the
 * workspace file, the second aliases a registry package. Only `link:` and `file:` name a
 * path this machine has to have.
 */
export function localDependencyTargets(manifest: unknown, profileDir: string): readonly LocalDependencyTarget[] {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return []
  const record = manifest as Record<string, unknown>
  const found: LocalDependencyTarget[] = []
  for (const field of DEPENDENCY_FIELDS) {
    const block = record[field]
    if (block === null || typeof block !== 'object' || Array.isArray(block)) continue
    for (const [name, value] of Object.entries(block as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      const spec = value.trim()
      const prefix = spec.startsWith('link:') ? 'link:' : spec.startsWith('file:') ? 'file:' : null
      if (prefix === null) continue
      const raw = spec.slice(prefix.length).trim()
      if (raw === '') continue
      found.push({ name, spec, field, target: isAbsolute(raw) ? resolve(raw) : resolve(profileDir, raw) })
    }
  }
  return found
}

/** The subset of {@link LocalDependencyTarget} that points at something which is not there. */
export function danglingLocalDependencies(
  targets: readonly LocalDependencyTarget[],
): readonly LocalDependencyTarget[] {
  return targets.filter((target) => !targetExists(target.target))
}

/** Read a profile manifest; `null` when it is absent or unparseable (the caller reports it). */
export function readProfileManifest(profileDir: string): unknown {
  const path = join(profileDir, 'package.json')
  if (!isFile(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** A broken symlink must count as missing, so `statSync` (which follows links) decides. */
function targetExists(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

/** Was the copy actually written? Used by the executor as a second proof after `copyFileSync`. */
export function copiedFilesPresent(input: {
  readonly targetDir: string
  readonly files: readonly string[]
}): readonly string[] {
  return input.files.filter((file) => existsSync(join(input.targetDir, file)))
}

/**
 * The file name whose content decides whether pnpm treats unapproved builds as fatal.
 *
 * `pnpm-workspace.yaml` is pnpm 10+/11+'s project settings file, and it is also one of the four
 * declaration files a profile is made of (F38), so it is the right place — and the only place
 * that does not overwrite something the user wrote.
 */
const WORKSPACE_FILE = 'pnpm-workspace.yaml'

/**
 * Stop the package manager from FAILING over unapproved build scripts, without approving any.
 *
 * WHY THIS IS NOT A GATE BEING LOWERED (measured R21): with a copied real profile,
 * `dsh plugin install` exits 1 with `ERR_PNPM_IGNORED_BUILDS` even though every package
 * installed — and the launcher then skips registering bundles, so the candidate never joins
 * the composition and the probe can only say "no row". Setting `strictDepBuilds: false` makes
 * the same run exit **0**, register the bundle, and still run **no** third-party build script
 * (measured: `onlyBuiltDependencies` stays empty; `Ignored build scripts: …` is still printed).
 *
 * It is applied only when the source profile brought no workspace file of its own: a user's file
 * is never overwritten, and if theirs refuses builds the probe reports `unknown` honestly.
 */
export function applySandboxBuildPolicy(input: {
  readonly targetDir: string
  readonly copiedFiles: readonly string[]
}): 'source' | 'sandbox' {
  if (input.copiedFiles.includes(WORKSPACE_FILE)) return 'source'
  writeFileSync(
    join(input.targetDir, WORKSPACE_FILE),
    ['# written by dsh-triage probe (T-304): do not fail the install over unapproved builds.', '# No build script is approved or executed: onlyBuiltDependencies stays empty.', 'strictDepBuilds: false', ''].join('\n'),
    'utf8',
  )
  return 'sandbox'
}
