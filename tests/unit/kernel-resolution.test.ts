import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { loadEnv, resolveKernelAnchor } from '../../packages/core/dist/env.js'
import { loadBundleLayers, moduleRoots, resolveRows } from '../../packages/plugin/dist/load.js'
import { runtimeLabel } from '../../packages/plugin/dist/summary.js'

/*
 * M11 · where does "the DSH version" come from?
 *
 * Measured on the maintainer's own machine (2026-11-09): the desktop Host runs from
 * `…/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js`, and the
 * kernel next to it is `0.2.2-rc.1`. `loadEnv()` instead read `~/.dsh/profiles/node_modules`,
 * a stale shared copy at `0.1.0-rc.6`. Every plugin whose `engines.dsh` said `>=0.2.x` was then
 * reported BLOCKED — nine confident, wrong answers on the one screen that exists to be right.
 *
 * This file builds the two real layouts on disk (desktop asar shape, npm-global shape) and pins
 * both directions: the kernel must win where it exists, and a genuinely missing bundle must keep
 * warning where it does not. N5/N6 are the pair; either one alone would ship a lie.
 */

const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const writeText = (path: string, value: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

const pkg = (name: string, version: string, patch?: string): unknown => ({
  name,
  version,
  ...(patch === undefined ? {} : { dsh: { bundle: { patch: './cordis.patch.yml' } } }),
})

const profileManifest = (bundles: readonly string[], dependencies: readonly string[] = []): unknown => ({
  name: 'dsh-profile-test',
  private: true,
  dependencies: Object.fromEntries(dependencies.map((name) => [name, '1.0.0'])),
  dsh: { profile: { bundles } },
})

/** A fresh sandbox: `<tmp>/kernel` (the runtime) and `<tmp>/home/profiles/<profile>` (the home). */
function sandbox(profile = 'desktop'): { root: string; home: string; profileDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-kernel-'))
  const home = join(root, 'home')
  const profileDir = join(home, 'profiles', profile)
  mkdirSync(profileDir, { recursive: true })
  return { root, home, profileDir }
}

/** The desktop shape: a `dsh` package with a sibling `dsh-desktop-host` (argv[1] lands in lib/). */
function desktopLayout(root: string, version = '0.2.2-rc.1'): string {
  const nodeModules = join(root, 'kernel', 'node_modules')
  writeJson(join(nodeModules, '@deepseek-ai', 'dsh', 'package.json'), pkg('@deepseek-ai/dsh', version))
  const entry = join(nodeModules, '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
  writeText(entry, '// desktop host entry\n')
  return entry
}

/** The npm-global shape from issue #1: the kernel's own deps hang under `<dsh>/node_modules`. */
function npmGlobalLayout(root: string, version = '0.2.2-rc.1'): string {
  const dshDir = join(root, 'prefix', 'lib', 'node_modules', '@deepseek-ai', 'dsh')
  writeJson(join(dshDir, 'package.json'), pkg('@deepseek-ai/dsh', version))
  const entry = join(dshDir, 'lib', 'bin.js')
  writeText(entry, '// dsh cli\n')
  return entry
}

const shared = (home: string) => join(home, 'profiles', 'node_modules')

const loaded = async (input: Parameters<typeof loadEnv>[0]) => {
  const result = await loadEnv(input)
  assert.equal(result.ok, true, `loadEnv must succeed: ${JSON.stringify(result)}`)
  return result.ok ? result.value : (undefined as never)
}

/* ── the anchor ────────────────────────────────────────────────────────────── */

test('N1: the running kernel outranks a stale shared copy, and the stale number never surfaces', async () => {
  const { root, home, profileDir } = sandbox()
  const entry = desktopLayout(root)
  writeJson(join(shared(home), '@deepseek-ai', 'dsh', 'package.json'), pkg('@deepseek-ai/dsh', '0.1.0-rc.6'))
  writeJson(join(profileDir, 'package.json'), profileManifest([]))

  const env = await loaded({ dshHome: home, profile: 'desktop', anchorEntry: entry })
  assert.equal(env.dsh, '0.2.2-rc.1')
  assert.equal(env.dshSource, 'kernel')
  assert.equal(
    JSON.stringify(env).includes('0.1.0-rc.6'),
    false,
    'the stale copy must not appear anywhere in the fingerprint',
  )
})

test('N2: with no kernel the old path still answers — but says it is inferred', async () => {
  const { home, profileDir } = sandbox()
  writeJson(join(shared(home), '@deepseek-ai', 'dsh', 'package.json'), pkg('@deepseek-ai/dsh', '0.1.0-rc.6'))
  writeJson(join(profileDir, 'package.json'), profileManifest([]))

  const env = await loaded({ dshHome: home, profile: 'desktop', anchorEntry: null })
  assert.equal(env.dsh, '0.1.0-rc.6')
  assert.equal(env.dshSource, 'inferred')
  assert.deepEqual(env.kernelRoots, [], 'an inferred anchor must not claim to have found kernel roots')
})

test('N3: nothing readable is "unresolved", never a made-up number and never a throw', async () => {
  const { home, profileDir } = sandbox()
  writeJson(join(profileDir, 'package.json'), profileManifest([]))

  const env = await loaded({ dshHome: home, profile: 'desktop', anchorEntry: null })
  assert.equal(env.dsh, null)
  assert.equal(env.dshSource, 'unresolved')
  assert.equal(runtimeLabel(env), 'unknown')
})

test('C2: the runtime line and the installed row cannot disagree', async () => {
  const { root, home, profileDir } = sandbox()
  const entry = desktopLayout(root)
  writeJson(join(shared(home), '@deepseek-ai', 'dsh', 'package.json'), pkg('@deepseek-ai/dsh', '0.1.0-rc.6'))
  writeJson(join(profileDir, 'package.json'), profileManifest([], ['@deepseek-ai/dsh']))

  const env = await loaded({ dshHome: home, profile: 'desktop', anchorEntry: entry })
  const rows = env.installed.filter((row) => row.name === '@deepseek-ai/dsh')
  assert.equal(rows.length, 1, 'one package, one row')
  assert.equal(rows[0]?.version, env.dsh, 'the fingerprint may not report two versions of one runtime')
})

test('N4: a matching kernel and shared copy produce no duplicate row and no phantom conflict', async () => {
  const { root, home, profileDir } = sandbox()
  const entry = desktopLayout(root, '0.2.2-rc.1')
  writeJson(join(shared(home), '@deepseek-ai', 'dsh', 'package.json'), pkg('@deepseek-ai/dsh', '0.2.2-rc.1'))
  writeJson(join(profileDir, 'package.json'), profileManifest([], ['@deepseek-ai/dsh']))

  const env = await loaded({ dshHome: home, profile: 'desktop', anchorEntry: entry })
  assert.equal(env.installed.filter((row) => row.name === '@deepseek-ai/dsh').length, 1)
  assert.equal(env.dshSource, 'kernel')
})

test('the anchor is a bounded upward walk, and it names what it saw', async () => {
  const { root } = sandbox()
  const entry = desktopLayout(root)
  const anchor = await resolveKernelAnchor({ anchorEntry: entry })
  assert.equal(anchor.source, 'kernel')
  assert.ok(anchor.nodeModules !== null && anchor.nodeModules.endsWith(join('kernel', 'node_modules')))
  assert.ok(anchor.dshDir !== null && anchor.dshDir.endsWith(join('@deepseek-ai', 'dsh')))
  assert.equal(anchor.via, entry)

  assert.deepEqual(await resolveKernelAnchor({ anchorEntry: 'not-a-path' }), {
    nodeModules: null,
    dshDir: null,
    source: 'unresolved',
    via: null,
  })
})

/* ── the bundle roots (issue #1) ───────────────────────────────────────────── */

test('N5: kernel-provided bundles are found, and they say where they came from', async () => {
  const { root, home, profileDir } = sandbox()
  const entry = desktopLayout(root)
  const kernelModules = join(root, 'kernel', 'node_modules')
  writeJson(join(kernelModules, '@deepseek-ai', 'dsh-base', 'package.json'), pkg('@deepseek-ai/dsh-base', '0.2.2-rc.1'))
  writeJson(join(profileDir, 'node_modules', 'dsh-triage', 'package.json'), pkg('dsh-triage', '0.3.4'))
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-base', 'dsh-triage']))

  const env = await loaded({ dshHome: home, profile: 'desktop', anchorEntry: entry })
  const errors: string[] = []
  const { layers } = await loadBundleLayers(env, home, errors)

  assert.deepEqual(errors, [], 'a kernel-provided bundle is not "missing"')
  assert.deepEqual(
    layers.map((layer) => [layer.name, layer.provenance]),
    [
      ['@deepseek-ai/dsh-base', 'kernel'],
      ['dsh-triage', 'profile'],
    ],
  )
})

test("N8: the issue reporter's layout — the kernel's own node_modules — is searched too", async () => {
  const { root, home, profileDir } = sandbox('web')
  const entry = npmGlobalLayout(root)
  const dshDir = join(root, 'prefix', 'lib', 'node_modules', '@deepseek-ai', 'dsh')
  writeJson(join(dshDir, 'node_modules', '@deepseek-ai', 'dsh-base', 'package.json'), pkg('@deepseek-ai/dsh-base', '0.2.2-rc.1'))
  writeJson(join(dshDir, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'package.json'), pkg('@deepseek-ai/dsh-web-app', '0.2.2-rc.1'))
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']))

  const env = await loaded({ dshHome: home, profile: 'web', anchorEntry: entry })
  assert.equal(env.dsh, '0.2.2-rc.1')
  const errors: string[] = []
  const { layers } = await loadBundleLayers(env, home, errors)

  assert.deepEqual(errors, [], 'issue #1 reported exactly these two as false warnings')
  assert.deepEqual(layers.map((layer) => layer.provenance), ['kernel', 'kernel'])
})

test('N6: a bundle that really is absent keeps warning — the new roots swallow nothing', async () => {
  const { root, home, profileDir } = sandbox()
  const entry = desktopLayout(root)
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-experimental-forge-bundle']))

  const env = await loaded({ dshHome: home, profile: 'desktop', anchorEntry: entry })
  const errors: string[] = []
  const { layers } = await loadBundleLayers(env, home, errors)

  assert.equal(layers.length, 0)
  assert.equal(errors.length, 1)
  assert.match(errors[0] ?? '', /no copy was found in the profile, the shared layer, or the kernel/)
  assert.doesNotMatch(errors[0] ?? '', /not installed under the profile/)
})

test('N7: a kernel bundle is read from the kernel copy, not the stale shared one beside it', async () => {
  const { root, home, profileDir } = sandbox()
  const entry = desktopLayout(root)
  const kernelModules = join(root, 'kernel', 'node_modules')
  writeJson(
    join(kernelModules, '@deepseek-ai', 'dsh-web-app', 'package.json'),
    pkg('@deepseek-ai/dsh-web-app', '0.2.2-rc.1', './cordis.patch.yml'),
  )
  writeText(join(kernelModules, '@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml'), 'kernel-patch\n')
  writeJson(
    join(shared(home), '@deepseek-ai', 'dsh-web-app', 'package.json'),
    pkg('@deepseek-ai/dsh-web-app', '0.1.0-rc.6', './cordis.patch.yml'),
  )
  writeText(join(shared(home), '@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml'), 'shared-patch\n')
  writeJson(join(profileDir, 'package.json'), profileManifest(['@deepseek-ai/dsh-web-app']))

  const env = await loaded({ dshHome: home, profile: 'desktop', anchorEntry: entry })
  const { layers } = await loadBundleLayers(env, home, [])
  assert.equal(layers.length, 1)
  assert.equal(layers[0]?.version, '0.2.2-rc.1')
  assert.equal(layers[0]?.provenance, 'kernel')
  assert.equal(layers[0]?.patchText, 'kernel-patch\n', 'a stale shared copy must not supply the layer')
})

/* ── rows resolve through the same roots ───────────────────────────────────── */

test('N9: a row is resolved through the same roots too — the kernel copy answers, not the stale one', async () => {
  const { root, home, profileDir } = sandbox()
  const entry = desktopLayout(root)
  const kernelModules = join(root, 'kernel', 'node_modules')
  writeJson(join(kernelModules, '@deepseek-ai', 'dsh-agent', 'package.json'), pkg('@deepseek-ai/dsh-agent', '0.2.2-rc.1'))
  writeJson(join(shared(home), '@deepseek-ai', 'dsh-agent', 'package.json'), pkg('@deepseek-ai/dsh-agent', '0.1.0-rc.6'))
  writeJson(join(profileDir, 'node_modules', 'dsh-triage', 'package.json'), pkg('dsh-triage', '0.3.5'))
  writeJson(join(profileDir, 'package.json'), profileManifest(['dsh-triage']))

  const env = await loaded({ dshHome: home, profile: 'desktop', anchorEntry: entry })
  assert.deepEqual(moduleRoots(env).map((entry) => entry.provenance), ['kernel', 'kernel', 'profile', 'shared'])

  const rows = await resolveRows(env, [
    { rowId: 'r1', module: '@deepseek-ai/dsh-agent', source: 'dsh-triage' },
    { rowId: 'r2', module: '@deepseek-ai/dsh-irrelevant', source: 'dsh-triage' },
  ])
  assert.equal(rows[0]?.version, '0.2.2-rc.1', 'a kernel package must be judged at the version the kernel ships')
  assert.equal(rows[1]?.version, null, 'an unresolved row stays null rather than borrowing a version')
})


test('N10: an entry that resolves through the profile or shared cache is still "inferred"', async () => {
  const { home, profileDir } = sandbox()
  writeJson(join(shared(home), '@deepseek-ai', 'dsh', 'package.json'), pkg('@deepseek-ai/dsh', '0.1.0-rc.6'))
  // The installed CLI really lives here, so the upward walk from it lands on the shared cache.
  const entry = join(profileDir, 'node_modules', 'dsh-triage', 'dist', 'cli.js')
  writeText(entry, '// cli\n')
  writeJson(join(profileDir, 'package.json'), profileManifest([]))

  const anchor = await resolveKernelAnchor({
    anchorEntry: entry,
    profileNodeModules: join(profileDir, 'node_modules'),
    sharedNodeModules: shared(home),
  })
  assert.equal(anchor.source, 'inferred', 'a cache is never a kernel, however the walk reached it')

  const env = await loaded({ dshHome: home, profile: 'desktop', anchorEntry: entry })
  assert.equal(runtimeLabel(env), '0.1.0-rc.6 (inferred)', 'the CLI must not claim a measurement it did not make')
})

test('C6: the version is printed with the source that produced it', () => {
  assert.equal(runtimeLabel({ dsh: '0.2.2-rc.1', dshSource: 'kernel' }), '0.2.2-rc.1 (kernel)')
  assert.equal(runtimeLabel({ dsh: '0.1.0-rc.6', dshSource: 'inferred' }), '0.1.0-rc.6 (inferred)')
  assert.equal(runtimeLabel({ dsh: '0.1.0-rc.6' }), '0.1.0-rc.6', 'an unlabelled fingerprint keeps its old rendering')
  assert.equal(runtimeLabel({ dsh: null }), 'unknown')
})

/* ── the frozen surface ────────────────────────────────────────────────────── */

test('C8: the admission engine and the gold set are outside this change', () => {
  // A guard on the guard: if someone edits the comparison while chasing this bug, this fails.
  const admission = readFileSync(new URL('../../packages/core/src/admission.ts', import.meta.url), 'utf8')
  assert.ok(admission.includes('satisfies'), 'admission.ts still compares ranges through semver.satisfies')
  const gold = JSON.parse(readFileSync(new URL('../../data/gold/admission-cases.json', import.meta.url), 'utf8')) as {
    schema_version?: unknown
  }
  assert.ok(gold.schema_version !== undefined, 'the gold set still parses as data')
})
