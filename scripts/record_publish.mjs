#!/usr/bin/env node
/**
 * Did the release actually land, and can a stranger install it? (R40)
 *
 * WHY THIS EXISTS: `npm publish` prints `+ dsh-triage@0.1.0` and exits 0, and that
 * says nothing about the two things a user pays for:
 *
 *   1. the bytes on the registry are the bytes we validated locally (a publish that
 *      silently re-packs a different tree is a different release);
 *   2. a fresh machine with NO npm credentials can install it and run the CLI --
 *      which is exactly what failed for 90 seconds on 2026-10-29, because
 *      `dsh-triage@0.1.0` depended on `@dsh-triage/{core,signals,probe}@0.1.0`
 *      before those three were readable (registry staging makes a fresh scoped
 *      package 404 for a while even after a successful publish).
 *
 * The install check runs with `npm_config_userconfig` pointed at an empty file, so
 * an "operator token helped it along" outcome is impossible: the claim is anonymous
 * installability, and that is what gets tested.
 *
 *   node scripts/record_publish.mjs --stamp 2026-10-29T01:40:00.000Z \
 *     --tarball-dir <dir with pnpm-packed .tgz files>
 *
 * Exit codes: 0 every claim passed · 1 a claim failed · 2 bad usage
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
const registry = String(argOf('--registry', 'https://registry.npmjs.org')).replace(/\/+$/, '')
const version = String(argOf('--version', '0.1.0'))
const rootPackage = 'dsh-triage'
const packages = ['@dsh-triage/core', '@dsh-triage/signals', '@dsh-triage/probe', rootPackage]
const tarballDir = argv.includes('--tarball-dir') ? pathFor(String(argOf('--tarball-dir', ''))) : null
const outDir = pathFor(String(argOf('--out', 'data/results')))
const verbose = argv.includes('--verbose')

if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-10-29T01:40:00.000Z\n`)
  process.exit(2)
}

const scratchRoot = join(tmpdir(), 'dsh-triage-publish', `verify-${Date.now().toString(36)}`)
const projectDir = join(scratchRoot, 'project')
const clean = (value) => {
  let text = String(value ?? '')
  for (const prefix of [scratchRoot, tmpdir()]) {
    for (const variant of [prefix, prefix.replaceAll('\\', '/')]) text = text.split(variant).join('<tmp>')
  }
  return text
}
const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) return { ok: false, status: response.status, value: null }
  return { ok: true, status: response.status, value: await response.json() }
}
const sha512Of = (buffer) => `sha512-${createHash('sha512').update(buffer).digest('base64')}`
const sha1Of = (buffer) => createHash('sha1').update(buffer).digest('hex')

const checks = []
const check = (id, ok, detail, extra = {}) => {
  checks.push({ id, ok: Boolean(ok), detail: clean(detail), ...extra })
  if (verbose) process.stderr.write(`  ${id}: ${ok ? 'ok' : 'FAILED'}\n`)
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 300_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
  })
}

/** npm cannot be spawned directly on Windows (EINVAL), so go through ComSpec. */
async function npm(args, options) {
  if (process.platform === 'win32') {
    const command = `${['npm', ...args].map((part) => (part.includes(' ') ? `"${part}"` : part)).join(' ')}`
    return await run(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', command], options)
  }
  return await run('npm', args, options)
}

async function main() {
  const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true })
  const gitStatus = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', windowsHide: true })

  /*
   * THE ROOT PACKAGE'S VERSION IS NOT EVERY PACKAGE'S VERSION (R41). The first 0.1.1 run
   * failed its own dependency checks because the three internal packages stayed at 0.1.0
   * while only `dsh-triage` moved: a documentation release does not need to republish
   * `@dsh-triage/core`. The expected version of a dependency is the one the root manifest
   * declares -- not a global `--version` applied to everything.
   */
  const rootEncoded = rootPackage.replace('/', '%2f')
  const rootPackument = await fetchJson(`${registry}/${rootEncoded}`)
  const rootManifest = rootPackument.ok ? (rootPackument.value.versions?.[version] ?? null) : null
  if (rootManifest === null) {
    check('root-manifest', false, `${rootPackage}@${version} is not on the registry`)
  }
  const declaredDependencies = rootManifest?.dependencies ?? {}
  const expectedVersionOf = (name) => (name === rootPackage ? version : (declaredDependencies[name] ?? version))

  const published = []
  for (const name of packages) {
    const expected = expectedVersionOf(name)
    const encoded = name.replace('/', '%2f')
    const packument = await fetchJson(`${registry}/${encoded}`)
    if (!packument.ok) {
      published.push({ name, ok: false, status: packument.status, detail: 'the registry does not serve this package' })
      check(`registry:${name}`, false, `HTTP ${packument.status}`)
      continue
    }
    const all = packument.value.versions ?? {}
    const manifest = all[expected]
    const latest = packument.value['dist-tags']?.latest ?? null
    if (manifest === undefined) {
      published.push({ name, ok: false, status: 200, detail: `version ${expected} is not published`, latest })
      check(`version:${name}`, false, `${expected} absent (latest=${String(latest)})`)
      continue
    }

    const dependencies = manifest.dependencies ?? {}
    const workspaceLeft = Object.entries(dependencies).filter(([, spec]) => String(spec).startsWith('workspace:'))
    check(
      `rewritten:${name}`,
      workspaceLeft.length === 0,
      workspaceLeft.length === 0 ? 'no workspace: protocol on the registry' : workspaceLeft.map(([key]) => key).join(', '),
    )
    check(`latest:${name}`, latest === expected, `latest=${String(latest)}`)

    const entry = {
      name,
      ok: true,
      version: expected,
      latest,
      published_at: packument.value.time?.[expected] ?? null,
      integrity: manifest.dist?.integrity ?? null,
      shasum: manifest.dist?.shasum ?? null,
      file_count: manifest.dist?.fileCount ?? null,
      unpacked_size: manifest.dist?.unpackedSize ?? null,
      dependencies,
      engines: manifest.engines ?? null,
      dist_tags: packument.value['dist-tags'] ?? null,
      local_tarball: null,
    }

    if (tarballDir !== null) {
      const expectedFile = `${name.replace('@', '').replace('/', '-')}-${expected}.tgz`
      const candidate = join(tarballDir, expectedFile)
      if (existsSync(candidate)) {
        const buffer = readFileSync(candidate)
        const localIntegrity = sha512Of(buffer)
        const localShasum = sha1Of(buffer)
        entry.local_tarball = {
          file: expectedFile,
          sha512: localIntegrity,
          sha1: localShasum,
          matches_registry: localIntegrity === entry.integrity,
        }
        check(
          `bytes:${name}`,
          localIntegrity === entry.integrity,
          localIntegrity === entry.integrity
            ? `local tarball is byte-identical to the registry copy (${localShasum.slice(0, 12)}…)`
            : `local ${localIntegrity.slice(0, 20)}… != registry ${String(entry.integrity).slice(0, 20)}…`,
        )
      } else {
        check(`bytes:${name}`, false, `${candidate} is missing, so the registry bytes are unverified`)
      }
    }

    published.push(entry)
  }

  /* ------------------------- anonymous install on a clean tree ------------------------- */
  rmSync(scratchRoot, { recursive: true, force: true })
  mkdirSync(projectDir, { recursive: true })
  const emptyNpmrc = join(scratchRoot, 'empty-npmrc')
  writeFileSync(emptyNpmrc, '', 'utf8')
  // No operator token can help here: the user config is an empty file.
  const env = {
    ...process.env,
    npm_config_userconfig: emptyNpmrc,
    npm_config_registry: registry,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    NO_COLOR: '1',
  }

  const init = await npm(['init', '-y'], { cwd: projectDir, env, timeoutMs: 120_000 })
  check('scratch-init', init.code === 0, `npm init -y exit ${String(init.code)}`)

  const install = await npm(['install', `${rootPackage}@${version}`, '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: projectDir,
    env,
    timeoutMs: 600_000,
  })
  const installTail = `${install.stdout}\n${install.stderr}`.trim().split('\n').slice(-3).join(' · ')
  check('anonymous-install', install.code === 0, `npm install ${rootPackage}@${version} exit ${String(install.code)} · ${installTail}`)

  const moduleDir = join(projectDir, 'node_modules', rootPackage)
  check('installed-tree', existsSync(moduleDir), existsSync(moduleDir) ? 'node_modules/dsh-triage exists' : 'the package is absent after install')

  const dependencyTrees = []
  for (const name of packages.slice(0, 3)) {
    const manifestPath = join(projectDir, 'node_modules', ...name.split('/'), 'package.json')
    const present = existsSync(manifestPath)
    let installedVersion = null
    if (present) {
      try {
        installedVersion = JSON.parse(readFileSync(manifestPath, 'utf8')).version ?? null
      } catch {
        installedVersion = null
      }
    }
    dependencyTrees.push({ name, present, version: installedVersion, expected: expectedVersionOf(name) })
    check(
      `dependency:${name}`,
      present && installedVersion === expectedVersionOf(name),
      `${name}@${String(installedVersion)} (declared ${String(expectedVersionOf(name))})`,
    )
  }

  let cli = { code: null, stdout: '', stderr: '' }
  if (existsSync(join(moduleDir, 'dist', 'cli.js'))) {
    cli = await run(process.execPath, [join(moduleDir, 'dist', 'cli.js'), '--help'], {
      cwd: projectDir,
      env,
      timeoutMs: 120_000,
    })
    const commands = cli.stdout.split('\n').filter((line) => line.includes('dsh-triage ')).length
    check(
      'cli-runs',
      cli.code === 0 && cli.stdout.includes('Usage'),
      `exit ${String(cli.code)} · ${commands} command line(s) · ${cli.stdout.split('\n')[0] ?? ''}`,
    )
  } else {
    check('cli-runs', false, 'dist/cli.js is missing from the installed package')
  }

  const imported = await run(
    process.execPath,
    ['--input-type=module', '--eval', `import('${rootPackage}').then((m) => console.log(Object.keys(m).sort().join(',')))`],
    { cwd: projectDir, env, timeoutMs: 120_000 },
  )
  const exported = imported.stdout.trim()
  check('module-resolves', imported.code === 0 && exported.length > 0, `import('${rootPackage}') → ${exported || imported.stderr.trim().slice(0, 120)}`)

  const failed = checks.filter((entry) => entry.ok === false)
  const payload = {
    schema_version: 1,
    produced_by: 'scripts/record_publish.mjs',
    generated_at: stamp,
    release: {
      package: rootPackage,
      version,
      git_head: String(gitHead.stdout ?? '').trim() || null,
      git_dirty: String(gitStatus.stdout ?? '').trim().length > 0,
    },
    registry: { url: registry, tier: 'measured-registry', fetched_at: stamp },
    published,
    install: {
      anonymous: true,
      // Stated as a field because it is the whole point: no operator token was available.
      npm_config_userconfig: '<empty file under the scratch dir>',
      command: `npm install ${rootPackage}@${version}`,
      exit_code: install.code,
      tail: clean(installTail),
      dependency_trees: dependencyTrees,
      cli: {
        exit_code: cli.code,
        first_lines: clean(cli.stdout.split('\n').slice(0, 3).join('\n')),
        commands: clean(cli.stdout.split('\n').filter((line) => line.includes('dsh-triage ')).join('\n')),
      },
      module_exports: exported || null,
      scratch: clean(scratchRoot),
    },
    checks,
    ok: failed.length === 0,
    limits: [
      'this proves the registry accepts the package and an anonymous npm install runs the CLI; it does not prove the DSH Host loads the bundle (that needs `probe` / `record_client_serve`)',
      'the three scoped packages are implementation detail published so the plugin resolves; their own behaviour is covered by the repository tests, not by this artifact',
      'a registry can serve different bytes to different regions; the integrity check compares against the copy fetched here, at this timestamp',
    ],
  }

  const fileName = `publish-${stamp.replaceAll(':', '-')}.json`
  const target = join(outDir, fileName)
  mkdirSync(outDir, { recursive: true })
  const text = `${JSON.stringify(payload, null, 2)}\n`
  writeFileSync(target, text, 'utf8')
  writeFileSync(`${target}.sha256`, sha256(text), 'utf8')
  rmSync(scratchRoot, { recursive: true, force: true })

  for (const entry of checks) process.stdout.write(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.id} — ${entry.detail}\n`)
  process.stdout.write(`ssot ${clean(target)} sha256=${sha256(text).slice(0, 12)}…\n`)
  process.exit(failed.length === 0 ? 0 : 1)
}

await main()
