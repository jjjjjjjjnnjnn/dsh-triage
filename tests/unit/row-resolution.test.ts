import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { loadEnv } from '../../packages/core/dist/env.js'
import { declarerDirOf, nodeModulesSearchPath, resolveRows } from '../../packages/plugin/dist/load.js'

/*
 * M13 · WHICH COPY OF A ROW'S MODULE IS THE ONE THE LOADER LOADS?
 *
 * The answer used to be "whatever `<root>/<name>/package.json` the three flat roots turn up". On a real
 * pnpm `isolated` profile that is the profile's DIRECT dependencies only, so 188 of 190 rows on the
 * sandbox `record_client_serve` builds were reported as "not installed under this profile" while the
 * running Host was loading every one of them — `BS-61`'s CLI half (see docs/specs/M13-row-resolution.md).
 *
 * The controls below are the pair that makes the fix safe rather than merely green:
 *   N1/N2 — a row that lives ONLY in `.pnpm` must resolve to the copy its DECLARER pins, not to the
 *           convenience symlink beside it (which is one symlink per NAME and can point at another version);
 *   N3    — a row the flat roots already answer must keep its exact version (M11-N9 depends on this);
 *   N4    — a module nobody installed stays null;
 *   N5    — an unreadable declarer directory stays a miss instead of borrowing another layer.
 */

const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const pkg = (name: string, version: string): unknown => ({ name, version })

const profileManifest = (bundles: readonly string[], dependencies: readonly string[] = []): unknown => ({
  name: 'dsh-profile-test',
  private: true,
  dependencies: Object.fromEntries(dependencies.map((name) => [name, '1.0.0'])),
  dsh: { profile: { bundles } },
})

function sandbox(profile = 'web'): { root: string; home: string; profileDir: string; nodeModules: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-rows-'))
  const home = join(root, 'home')
  const profileDir = join(home, 'profiles', profile)
  const nodeModules = join(profileDir, 'node_modules')
  mkdirSync(nodeModules, { recursive: true })
  writeJson(join(profileDir, 'package.json'), profileManifest([]))
  return { root, home, profileDir, nodeModules }
}

/**
 * pnpm's isolated layout for one installed package: the real tree lives in `.pnpm/<key>/node_modules`,
 * and the top level holds a symlink (or, on this Windows box, a directory junction) to it.
 */
function isolatedPackage(
  nodeModules: string,
  name: string,
  version: string,
  options: { readonly link: boolean } = { link: true },
): { readonly storeDir: string; readonly realDir: string } {
  const key = name.startsWith('@') ? name.replace('/', '+') : name
  const storeDir = join(nodeModules, '.pnpm', `${key}@${version}`, 'node_modules')
  const realDir = join(storeDir, ...name.split('/'))
  writeJson(join(realDir, 'package.json'), pkg(name, version))
  if (options.link) {
    const linkPath = join(nodeModules, ...name.split('/'))
    mkdirSync(dirname(linkPath), { recursive: true })
    try {
      symlinkSync(realDir, linkPath, 'junction')
    } catch {
      // A machine without symlink rights is not a reason to fail the rule: the test only needs the
      // store copy to exist, and N2 still distinguishes the two copies by their version.
    }
  }
  return { storeDir, realDir }
}

const loaded = async (input: Parameters<typeof loadEnv>[0]) => {
  const result = await loadEnv(input)
  assert.equal(result.ok, true, `loadEnv must succeed: ${JSON.stringify(result)}`)
  return result.ok ? result.value : (undefined as never)
}

/**
 * A DEPENDENCY of an isolated package: it sits beside that package inside the same store `node_modules`.
 * This is where pnpm puts it, and it is the copy Node hands to the package's own imports.
 */
function writeStoreSibling(storeDir: string, name: string, version: string): string {
  const dir = join(storeDir, ...name.split('/'))
  writeJson(join(dir, 'package.json'), pkg(name, version))
  return dir
}

test('M13-N1: a row that exists only under .pnpm is found through the bundle that declared it', async () => {
  const { home, profileDir, nodeModules } = sandbox()
  // The bundle declares the rows; its real tree lives in the store, and its DEPENDENCIES are hardlinked
  // as siblings inside that same `node_modules` (that is how pnpm `isolated` installs them).
  const layer = isolatedPackage(nodeModules, '@deepseek-ai/dsh-base', '0.2.1-rc.4')
  const storeOnly = writeStoreSibling(layer.storeDir, '@deepseek-ai/dsh-plugin-manager', '0.2.1-rc.4')
  assert.ok(storeOnly.startsWith(join(nodeModules, '.pnpm')), 'the fixture must not also link it at the top')
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-base']))

  const env = await loaded({ dshHome: home, profile: 'web' })
  const layers = [{ name: '@deepseek-ai/dsh-base', dir: join(nodeModules, '@deepseek-ai', 'dsh-base') }]

  const withoutContext = await resolveRows(env, [
    { rowId: 'plugin-manager', module: '@deepseek-ai/dsh-plugin-manager', source: 'bundle:@deepseek-ai/dsh-base' },
  ])
  assert.equal(withoutContext[0]?.version, null, 'the flat roots cannot see an isolated store, so this is the defect')

  const withContext = await resolveRows(
    env,
    [{ rowId: 'plugin-manager', module: '@deepseek-ai/dsh-plugin-manager', source: 'bundle:@deepseek-ai/dsh-base' }],
    { layers },
  )
  assert.equal(withContext[0]?.version, '0.2.1-rc.4', 'the declarer owns this module, so it must be found')
  assert.notEqual(withContext[0]?.manifest, null, 'admission needs the manifest, not just a version string')
  assert.ok(storeOnly.includes('.pnpm'), 'fixture sanity: it really is an isolated store')
})

test('M13-N2: the copy the declarer pins wins over the convenience symlink of the same name', async () => {
  const { home, profileDir, nodeModules } = sandbox()
  // Two versions of one name. `.pnpm/node_modules/<name>` (pnpm's convenience layer) reaches version 1 —
  // which is exactly what "just add the store root to moduleRoots()" would have answered — while the
  // declaring bundle hangs on the copy at version 2.
  const layer = isolatedPackage(nodeModules, '@deepseek-ai/dsh-base', '0.2.1-rc.4')
  // 1.0.0 exists in the store and is reachable ONLY through the convenience layer — it is deliberately
  // NOT linked at the top level, so the flat lookup cannot answer and the fallback is what runs.
  const older = isolatedPackage(nodeModules, '@deepseek-ai/dsh-llm', '1.0.0', { link: false })
  const wanted = writeStoreSibling(layer.storeDir, '@deepseek-ai/dsh-llm', '2.0.0')
  const convenience = join(nodeModules, '.pnpm', 'node_modules')
  mkdirSync(join(convenience, '@deepseek-ai'), { recursive: true })
  try {
    symlinkSync(
      join(nodeModules, '.pnpm', '@deepseek-ai+dsh-llm@1.0.0', 'node_modules', '@deepseek-ai', 'dsh-llm'),
      join(convenience, '@deepseek-ai', 'dsh-llm'),
      'junction',
    )
  } catch {
    // Without link rights this control keeps its point through the version assertion below.
  }
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-base']))

  const env = await loaded({ dshHome: home, profile: 'web' })
  const rows = await resolveRows(
    env,
    [{ rowId: 'llm', module: '@deepseek-ai/dsh-llm', source: 'bundle:@deepseek-ai/dsh-base' }],
    { layers: [{ name: '@deepseek-ai/dsh-base', dir: join(nodeModules, '@deepseek-ai', 'dsh-base') }] },
  )
  assert.equal(rows[0]?.version, '2.0.0', 'the declarer pins 2; the convenience symlink is not a source of truth')
  assert.ok(wanted.includes('dsh-llm'), 'fixture sanity: the sibling copy exists in the declarer store')
  assert.ok(older.storeDir.includes('@deepseek-ai+dsh-llm@1.0.0'), 'fixture sanity: 1.0.0 is the copy the convenience layer points at')
  assert.ok(layer.realDir.endsWith('dsh-base'), 'fixture sanity: the layer exists')
})

test('M13-N3: a row the flat roots already answer keeps its exact version (M13-C2, "add only")', async () => {
  const { home, profileDir, nodeModules } = sandbox()
  // Flat root answers 1.0.0; the declarer hangs on 9.9.9. The flat answer must win, because today's
  // answers carry M11-N9 and the golden fixtures behind them.
  writeJson(join(nodeModules, 'shared-lib', 'package.json'), pkg('shared-lib', '1.0.0'))
  isolatedPackage(nodeModules, '@deepseek-ai/dsh-base', '0.2.1-rc.4')
  const declarerCopy = join(nodeModules, '.pnpm', '@deepseek-ai+dsh-base@0.2.1-rc.4', 'node_modules', 'shared-lib')
  writeJson(join(declarerCopy, 'package.json'), pkg('shared-lib', '9.9.9'))
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-base']))

  const env = await loaded({ dshHome: home, profile: 'web' })
  const rows = await resolveRows(
    env,
    [{ rowId: 'shared', module: 'shared-lib', source: 'bundle:@deepseek-ai/dsh-base' }],
    { layers: [{ name: '@deepseek-ai/dsh-base', dir: join(nodeModules, '@deepseek-ai', 'dsh-base') }] },
  )
  assert.equal(rows[0]?.version, '1.0.0', 'the flat root answered first, so the declarer must not be consulted')
})

test('M13-N4: a module nobody installed stays null — the fallback guesses nothing', async () => {
  const { home, profileDir, nodeModules } = sandbox()
  isolatedPackage(nodeModules, '@deepseek-ai/dsh-base', '0.2.1-rc.4')
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-base']))

  const env = await loaded({ dshHome: home, profile: 'web' })
  const rows = await resolveRows(
    env,
    [{ rowId: 'ghost', module: '@deepseek-ai/dsh-nobody-installed-this', source: 'bundle:@deepseek-ai/dsh-base' }],
    { layers: [{ name: '@deepseek-ai/dsh-base', dir: join(nodeModules, '@deepseek-ai', 'dsh-base') }] },
  )
  assert.equal(rows[0]?.version, null)
  assert.equal(rows[0]?.manifest, null)
})

test('M13-N5: an unreadable declarer directory is a miss, never another layer\'s answer', async () => {
  const { home, profileDir, nodeModules } = sandbox()
  // The layer is listed in the profile but its directory does not exist (a half-installed profile).
  writeJson(join(nodeModules, 'only-in-flat', 'package.json'), pkg('only-in-flat', '1.0.0'))
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-missing-bundle']))

  const env = await loaded({ dshHome: home, profile: 'web' })
  const rows = await resolveRows(
    env,
    [{ rowId: 'orphan', module: 'only-in-flat', source: 'bundle:@deepseek-ai/dsh-missing-bundle' }],
    { layers: [{ name: '@deepseek-ai/dsh-missing-bundle', dir: join(nodeModules, '@deepseek-ai', 'dsh-missing-bundle') }] },
  )
  assert.equal(rows[0]?.version, '1.0.0', 'the flat root already answered, and a dead declarer must not veto it')

  const unseen = await resolveRows(env, [
    { rowId: 'orphan', module: 'only-in-flat', source: 'bundle:@deepseek-ai/dsh-missing-bundle' },
  ])
  assert.equal(unseen[0]?.version, '1.0.0', 'without a context the old behaviour is untouched')
})

test('M13-C4: a source label maps to the layer that wrote it, and the profile patch to no layer', () => {
  const layers = [
    { name: '@deepseek-ai/dsh-base', dir: '/layers/base' },
    { name: '@deepseek-ai/dsh-web-app', dir: '/layers/web-app' },
  ]
  assert.equal(declarerDirOf('bundle:@deepseek-ai/dsh-base', layers), '/layers/base')
  assert.equal(declarerDirOf('bundle:@deepseek-ai/dsh-web-app/./presets/standard.patch.yml', layers), '/layers/web-app')
  assert.equal(declarerDirOf('patch:profile', layers), null, 'a profile-declared row belongs to no bundle')
  assert.equal(declarerDirOf('patch:home', layers), null)
  // Longest prefix wins: a bundle named as the prefix of another must not swallow the longer one.
  const nested = [...layers, { name: '@deepseek-ai/dsh-web-app/extra', dir: '/layers/nested' }]
  assert.equal(declarerDirOf('bundle:@deepseek-ai/dsh-web-app/extra', nested), '/layers/nested')
  assert.equal(declarerDirOf('bundle:@deepseek-ai/dsh-nothing', layers), null)
})

test('M13-C1: the search path is Node\'s own, not a hard-coded list', () => {
  const parts = nodeModulesSearchPath(join('/a', 'b', 'c'))
  assert.equal(parts.length, 3, 'one node_modules per ancestor level')
  assert.ok(parts[0]?.endsWith(join('a', 'b', 'c', 'node_modules')), 'start at the starting directory')
  assert.ok(parts[2]?.endsWith(join('a', 'node_modules')), 'walk up to the filesystem root')
  // Levels that are already `node_modules` are skipped, exactly as Node documents.
  const insideStore = nodeModulesSearchPath(join('/a', 'node_modules', 'b'))
  assert.equal(insideStore.length, 2)
  assert.ok(insideStore.every((part) => !part.includes(join('node_modules', 'node_modules'))))
})
