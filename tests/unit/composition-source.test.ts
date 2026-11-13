/**
 * R102 · M16: the composition layer must come from the same archive as the runtime version.
 *
 * WHY THIS FILE EXISTS: R101 fixed the VERSION and the kernel manifests (M14), and the CLI stopped
 * reporting 8 false denials. It still reported ONE, and that one was a phantom: the shared cache ships
 * `dsh-base@0.1.0-rc.6`, whose patch names `@deepseek-ai/dsh-llm-deepseek`, while the running
 * `dsh-base@0.2.2-rc.1` names `@deepseek-ai/dsh-llm-deepseek-api-key`. Same row id, two modules →
 * `conflicting-definitions`. The settings page (inside the Host, reading the kernel) said 0.
 *
 * Every case below is a negative control from `docs/specs/M16-composition-source.md`. The pair that
 * matters: N1 (the archive answers) and N2/N3 (the disk keeps answering where the archive cannot).
 * Either one alone ships a lie.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { extractEntryClaims, findEntryIdCollisions, parsePatchYaml } from '../../packages/core/dist/ledger.js'
import { loadEnv } from '../../packages/core/dist/env.js'
import { loadBundleLayers } from '../../packages/plugin/dist/load.js'

/**
 * Build a nested asar image (dirs are `files` maps). Offsets are relative to the data section, which
 * starts after the 16-byte prefix and the JSON directory, 4-byte aligned — Chromium's layout.
 */
function buildNested(files: Record<string, string>): Buffer {
  const tree: Record<string, unknown> = {}
  const contents: Buffer[] = []
  let offset = 0
  for (const [path, content] of Object.entries(files)) {
    const bytes = Buffer.from(content, 'utf8')
    const parts = path.split('/')
    let node = tree
    for (const part of parts.slice(0, -1)) {
      node[part] = node[part] ?? { files: {} }
      node = (node[part] as { files: Record<string, unknown> }).files
    }
    node[parts[parts.length - 1] as string] = { size: bytes.length, offset: String(offset) }
    contents.push(bytes)
    offset += bytes.length
  }
  const jsonStart = 16
  const json = Buffer.from(JSON.stringify({ files: tree }), 'utf8')
  const dataStart = Math.ceil((jsonStart + json.length) / 4) * 4
  const head = Buffer.alloc(dataStart)
  head.writeUInt32LE(4, 0)
  head.writeUInt32LE(json.length, 12)
  json.copy(head, jsonStart)
  return Buffer.concat([head, ...contents])
}

const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const writeText = (path: string, value: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

/** One row per bundle, plus a profile patch row — enough to produce (or not produce) a collision. */
const patchWith = (id: string, name: string): string =>
  ['- id: settings', '  name: "@deepseek-ai/dsh-settings"', `- id: ${id}`, `  name: "${name}"`, ''].join('\n')

function sandbox(): { root: string; home: string; profileDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-m16-'))
  const home = join(root, 'home')
  const profileDir = join(home, 'profiles', 'desktop')
  mkdirSync(profileDir, { recursive: true })
  return { root, home, profileDir }
}

const bundleManifest = (name: string, version: string, patch = './cordis.patch.yml'): unknown => ({
  name,
  version,
  dsh: { bundle: { patch } },
})

const profileManifest = (bundles: readonly string[], deps: readonly string[] = []): unknown => ({
  name: 'dsh-profile-test',
  private: true,
  dependencies: Object.fromEntries(deps.map((name) => [name, '1.0.0'])),
  dsh: { profile: { bundles } },
})

const shared = (home: string) => join(home, 'profiles', 'node_modules')

async function envFor(home: string, asarPath: string | null) {
  const result = await loadEnv({ dshHome: home, profile: 'desktop', ...(asarPath === null ? {} : { asarPath }) })
  assert.equal(result.ok, true, `loadEnv must succeed: ${JSON.stringify(result)}`)
  return result.ok ? result.value : (undefined as never)
}

const claimsOf = (texts: readonly (string | null)[], source: string) => {
  const out = []
  for (const text of texts) {
    if (text === null) continue
    const parsed = parsePatchYaml(text)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) continue
    out.push(...extractEntryClaims(parsed.value, source))
  }
  return out
}

test('N1: the archive patch wins, so the row that only differed in the stale cache stops colliding', async () => {
  const { home, profileDir } = sandbox()
  const asarPath = join(home, 'app.asar')
  // What the running kernel says: `-api-key`.
  writeFileSync(
    asarPath,
    buildNested({
      'dsh/node_modules/@deepseek-ai/dsh/package.json': JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }),
      'dsh/node_modules/@deepseek-ai/dsh-base/package.json': JSON.stringify(bundleManifest('@deepseek-ai/dsh-base', '0.2.2-rc.1')),
      'dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml': patchWith('llm-deepseek', '@deepseek-ai/dsh-llm-deepseek-api-key'),
    }),
  )
  // What the stale shared cache says: the old module name (this is the phantom's other half).
  writeJson(join(shared(home), '@deepseek-ai', 'dsh-base', 'package.json'), bundleManifest('@deepseek-ai/dsh-base', '0.1.0-rc.6'))
  writeText(join(shared(home), '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'), patchWith('llm-deepseek', '@deepseek-ai/dsh-llm-deepseek'))
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-base'], ['@deepseek-ai/dsh']))
  // The profile patch names the same module the kernel does.
  writeText(join(profileDir, 'cordis.patch.yml'), patchWith('llm-deepseek', '@deepseek-ai/dsh-llm-deepseek-api-key'))

  const env = await envFor(home, asarPath)
  assert.equal(env.dshSource, 'kernel-asar', 'the archive must be the version source (M14-C1)')
  const errors: string[] = []
  const { layers } = await loadBundleLayers(env, home, errors)
  assert.deepEqual(errors, [], 'reading the archive is not a problem to report')
  const base = layers.find((layer) => layer.name === '@deepseek-ai/dsh-base')
  assert.ok(base !== undefined)
  assert.equal(base.version, '0.2.2-rc.1', 'the layer itself must be the archive copy (M16-C1)')
  assert.equal(base.provenance, 'kernel')
  assert.equal(base.patchFiles[0]?.text, patchWith('llm-deepseek', '@deepseek-ai/dsh-llm-deepseek-api-key'))

  const claims = [...claimsOf(layers.map((layer) => layer.patchText), 'bundle:@deepseek-ai/dsh-base'), ...claimsOf([readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')], 'patch:profile')]
  const collisions = findEntryIdCollisions(claims)
  assert.deepEqual(
    collisions.map((collision) => collision.id),
    [],
    'the archive and the profile patch name the same module, so there is nothing to collide (M16-N1)',
  )
})

test('N2: the archive is only consulted when the runtime version came from it', async () => {
  const { home, profileDir, root } = sandbox()
  const asarPath = join(root, 'app.asar')
  // An archive that WOULD answer — the question here is whether it is allowed to.
  writeFileSync(
    asarPath,
    buildNested({
      'dsh/node_modules/@deepseek-ai/dsh/package.json': JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9' }),
      'dsh/node_modules/@deepseek-ai/dsh-base/package.json': JSON.stringify(bundleManifest('@deepseek-ai/dsh-base', '9.9.9')),
      'dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml': patchWith('llm-deepseek', '@deepseek-ai/dsh-llm-deepseek-api-key'),
    }),
  )
  writeJson(join(shared(home), '@deepseek-ai', 'dsh-base', 'package.json'), bundleManifest('@deepseek-ai/dsh-base', '0.1.0-rc.6'))
  writeText(join(shared(home), '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'), patchWith('llm-deepseek', '@deepseek-ai/dsh-llm-deepseek'))
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-base']))

  /*
   * A hand-built fingerprint: the probe DID read an archive, but the version did not come from it
   * (a caller that mixed the two). M16-C2 says the composition must follow the version source, so the
   * disk copy is the answer — and no "9.9.9" may leak into a layer. This is the case that pins the
   * `dshSource` gate: in production the two facts always agree, so only a synthetic caller can test it.
   */
  const env = {
    dsh: '0.1.0-rc.6',
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    profile: 'desktop',
    profileDir,
    bundles: ['@deepseek-ai/dsh-base'],
    installed: [],
    dshSource: 'kernel' as const,
    kernelProbe: { state: 'read' as const, path: asarPath, detail: null, runtimeJsonVersion: null, disagrees: false },
  }
  const { layers } = await loadBundleLayers(env, home, [])
  assert.equal(layers[0]?.version, '0.1.0-rc.6', 'no version from the archive may be used here')
  assert.equal(layers[0]?.patchText, patchWith('llm-deepseek', '@deepseek-ai/dsh-llm-deepseek'))
  assert.equal(
    JSON.stringify(layers[0]?.manifest).includes('9.9.9'),
    false,
    'the archive manifest must not be mixed into a layer whose version came from disk (M16-C2)',
  )
})

test('N3: a bundle the archive does not ship is read from disk, with its own provenance', async () => {
  const { home, profileDir } = sandbox()
  const asarPath = join(home, 'app.asar')
  writeFileSync(
    asarPath,
    buildNested({
      'dsh/node_modules/@deepseek-ai/dsh/package.json': JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }),
    }),
  )
  writeJson(join(profileDir, 'node_modules', 'dsh-remedy', 'package.json'), bundleManifest('dsh-remedy', '0.3.6'))
  writeText(join(profileDir, 'node_modules', 'dsh-remedy', 'cordis.patch.yml'), patchWith('remedy', 'dsh-remedy'))
  writeJson(join(profileDir, 'package.json'), profileManifest(['dsh-remedy']))

  const env = await envFor(home, asarPath)
  const { layers } = await loadBundleLayers(env, home, [])
  assert.equal(layers.length, 1)
  assert.equal(layers[0]?.provenance, 'profile', 'a third-party bundle is not host-provided')
  assert.equal(layers[0]?.version, '0.3.6')
})

test('N4: a patch the archive does not contain is reported, never filled in from the cache (M16-C3)', async () => {
  const { home, profileDir } = sandbox()
  const asarPath = join(home, 'app.asar')
  writeFileSync(
    asarPath,
    buildNested({
      'dsh/node_modules/@deepseek-ai/dsh/package.json': JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }),
      // The manifest is in the archive, the file it declares is not.
      'dsh/node_modules/@deepseek-ai/dsh-base/package.json': JSON.stringify(bundleManifest('@deepseek-ai/dsh-base', '0.2.2-rc.1', './presets/odd.patch.yml')),
    }),
  )
  writeJson(join(shared(home), '@deepseek-ai', 'dsh-base', 'package.json'), bundleManifest('@deepseek-ai/dsh-base', '0.1.0-rc.6'))
  writeText(join(shared(home), '@deepseek-ai', 'dsh-base', 'presets', 'odd.patch.yml'), patchWith('llm-deepseek', '@deepseek-ai/dsh-llm-deepseek'))
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-base'], ['@deepseek-ai/dsh']))

  const env = await envFor(home, asarPath)
  const errors: string[] = []
  const { layers } = await loadBundleLayers(env, home, errors)
  assert.equal(layers[0]?.version, '0.2.2-rc.1', 'the archive answered, so its manifest is the one used')
  assert.equal(layers[0]?.patchText, null, 'the missing file stays missing')
  assert.equal(layers[0]?.patchFiles[0]?.text, null, 'and it is NOT the cached file with the same name')
  assert.match(errors.join(' '), /does not contain it/)
})

test('N5: an unreadable archive falls back to the old composition, and says so through the probe', async () => {
  const { home, profileDir } = sandbox()
  const asarPath = join(home, 'app.asar')
  writeFileSync(asarPath, buildNested({ 'x': 'y' }).subarray(0, 20))
  writeJson(join(shared(home), '@deepseek-ai', 'dsh', 'package.json'), { name: '@deepseek-ai/dsh', version: '0.1.0-rc.6' })
  writeJson(join(shared(home), '@deepseek-ai', 'dsh-base', 'package.json'), bundleManifest('@deepseek-ai/dsh-base', '0.1.0-rc.6'))
  writeText(join(shared(home), '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'), patchWith('llm-deepseek', '@deepseek-ai/dsh-llm-deepseek'))
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-base'], ['@deepseek-ai/dsh']))

  const env = await envFor(home, asarPath)
  assert.equal(env.kernelProbe?.state, 'unreadable', 'a broken archive is not a silent fallback (M14-C4)')
  assert.equal(env.dshSource, 'inferred')
  const { layers } = await loadBundleLayers(env, home, [])
  assert.equal(layers[0]?.version, '0.1.0-rc.6', 'the disk composition is still what answers')
})

test('N6: on this machine the CLI and the settings route agree on collisions', async (t) => {
  const home = `${process.env['USERPROFILE'] ?? process.env['HOME']}/.dsh`
  /*
   * R106: ON A CLEAN RUNNER THERE IS NO PROFILE, AND THAT USED TO BE A FAILURE.
   *
   * `envFor` asserts that `loadEnv` succeeds, so the "not evidence either way" guard below was
   * unreachable: every machine that is not the maintainer's went red at this test. All three public
   * CI jobs (node 22 / node 24 / windows) failed on it from 2026-11-12 (`run 43315617523`), while
   * `pnpm run verify` stayed green here. A test that needs THIS machine's home must say so and stop —
   * "could not look" is not "agrees" (the same rule the project applies to `unmeasured` everywhere else).
   */
  const result = await loadEnv({ dshHome: home, profile: 'desktop' })
  if (result.ok === false) {
    t.skip(`no desktop profile under ${home} (${result.error.code}): nothing to compare on this machine`)
    return
  }
  const env = result.value
  if (env.dshSource !== 'kernel-asar') {
    t.skip('no desktop archive on this machine: the two sides cannot be compared')
    return
  }
  const { layers } = await loadBundleLayers(env, home, [])
  const claims = layers.flatMap((layer) =>
    claimsOf(
      layer.patchFiles.map((file) => file.text),
      layer.patchFiles.length > 1 ? `bundle:${layer.name}/${layer.patchFiles[0]?.relative ?? ''}` : `bundle:${layer.name}`,
    ),
  )
  const profilePatch = readFileSync(join(home, 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8')
  const collisions = findEntryIdCollisions([...claims, ...claimsOf([profilePatch], 'patch:profile')])
  assert.deepEqual(collisions.map((collision) => collision.id), [], 'the real desktop profile has no entry-id collision')
  // The one bundle whose manifest and patch the archive ships must have answered from the archive.
  const base = layers.find((layer) => layer.name === '@deepseek-ai/dsh-base')
  assert.equal(base?.version, '0.2.2-rc.1')
  assert.equal(base?.patchText !== null, true)
})
