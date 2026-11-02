#!/usr/bin/env node
/**
 * "A stranger's first minute on the published package" — the four commands someone actually types,
 * run against the package the registry serves (R65).
 *
 * WHY THIS EXISTS: `record_publish` proves the tarball installs and that `dist/cli.js --help` exits 0.
 * `record_upgrade_entry` proves the card works from the repo. Neither answers the question the release
 * is for: *does the thing a new user runs do what the front door promises?* Between them there is room
 * for a broken `status`, a crash on the default profile, or a card that only works when cwd is the repo.
 *
 * WHAT IT RUNS (all read-only; nothing is written to any DSH home):
 *   1. `dsh-triage --help`                       → exit 0, prints usage
 *   2. `dsh-triage` (no arguments = status)      → exit 0, prints a first-screen conclusion
 *   3. `dsh-triage audit`                        → exit 0, prints the summary, not just a header
 *   4. `dsh-triage upgrade --to next --card`     → exit 0, prints a card with the declaration-layer boundary
 *
 * WHAT IT DOES NOT CLAIM: that the numbers are right for the reader's machine (step 4 reads THIS machine's
 * profile and says so in the card), that the Host loads the bundle (`record_client_serve`), or that the
 * install path works without network (`record_publish` covers the anonymous case).
 *
 *   node scripts/record_usability_smoke.mjs --stamp 2026-11-02T19:00:00.000Z
 *
 * Exit codes: 0 every step behaved · 1 a step did not · 2 bad usage
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
if (stamp === null) {
  process.stderr.write('usage: node scripts/record_usability_smoke.mjs --stamp <ISO> [--version X.Y.Z]\n')
  process.exit(2)
}
const pluginManifest = JSON.parse(readFileSync(abs('packages/plugin/package.json'), 'utf8'))
const version = String(argOf('--version', pluginManifest.version))
const outDir = pathFor(String(argOf('--out', 'data/results')))
const registry = String(argOf('--registry', 'https://registry.npmjs.org')).replace(/\/+$/, '')

const scratchRoot = join(tmpdir(), 'dsh-triage-usability', `run-${Date.now().toString(36)}`)
const projectDir = join(scratchRoot, 'project')

const redactRoots = [scratchRoot, tmpdir(), homedir(), abs('.')]
const clean = (value) => {
  let text = String(value ?? '')
  for (const prefix of redactRoots) {
    if (prefix === '') continue
    for (const variant of [prefix, prefix.replaceAll('\\', '/'), prefix.replaceAll('/', '\\')]) {
      text = text.split(variant).join('<path>')
    }
  }
  return text
}

const checks = []
const check = (id, ok, detail, extra = {}) => {
  checks.push({ id, ok: Boolean(ok), detail: clean(detail), ...extra })
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

async function npm(args, options) {
  if (process.platform === 'win32') {
    const line = ['npm', ...args].map((part) => (part.includes(' ') ? `"${part}"` : part)).join(' ')
    return await run(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', line], options)
  }
  return await run('npm', args, options)
}

async function main() {
  rmSync(scratchRoot, { recursive: true, force: true })
  mkdirSync(projectDir, { recursive: true })
  const emptyNpmrc = join(scratchRoot, 'empty-npmrc')
  writeFileSync(emptyNpmrc, '', 'utf8')
  const env = {
    ...process.env,
    // Anonymous on purpose: the claim is about a stranger, not about an operator's token.
    npm_config_userconfig: emptyNpmrc,
    npm_config_registry: registry,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    NO_COLOR: '1',
  }

  await npm(['init', '-y'], { cwd: projectDir, env, timeoutMs: 120_000 })
  const install = await npm(['install', `dsh-triage@${version}`, '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: projectDir,
    env,
    timeoutMs: 900_000,
  })
  check(
    'install',
    install.code === 0,
    install.code === 0 ? `npm install dsh-triage@${version} exit 0` : `exit ${String(install.code)}: ${`${install.stdout}${install.stderr}`.trim().slice(0, 200)}`,
  )

  const cli = join(projectDir, 'node_modules', 'dsh-triage', 'dist', 'cli.js')
  if (!existsSync(cli)) {
    check('cli-present', false, 'dist/cli.js is missing from the installed package')
  } else {
    check('cli-present', true, 'dist/cli.js exists in the installed package')

    /*
     * Every command below runs with cwd = the scratch project, NOT the repository. That is the part the
     * repo-side recordings cannot check: a CLI that only works from its own checkout is broken for users.
     */
    const call = async (args, timeoutMs = 300_000) => await run(process.execPath, [cli, ...args], { cwd: projectDir, env, timeoutMs })

    const help = await call(['--help'], 120_000)
    check(
      'help',
      help.code === 0 && /Usage|用法/.test(help.stdout),
      `exit ${String(help.code)} · ${help.stdout.split('\n')[0] ?? ''}`,
      { lines: clean(help.stdout).split('\n').length },
    )

    const status = await call([])
    const statusLines = status.stdout.split('\n')
    check(
      'status-no-arguments',
      status.code === 0 && statusLines.length >= 6 && /profile|配置/.test(status.stdout),
      `exit ${String(status.code)} · ${statusLines.length} line(s) · ${statusLines[0] ?? ''}`,
      { lines: statusLines.length },
    )

    const audit = await call(['audit'])
    check(
      'audit-summary',
      audit.code === 0 && audit.stdout.split('\n').length >= 6,
      `exit ${String(audit.code)} · ${audit.stdout.split('\n').length} line(s) · ${audit.stdout.split('\n')[0] ?? ''}`,
      { lines: audit.stdout.split('\n').length },
    )

    const card = await call(['upgrade', '--to', 'next', '--card'], 600_000)
    const cardText = card.stdout
    // The boundary sentence is the product's promise; a card without it is a sales pitch.
    const boundary = /不是运行期实测|声明层|declaration layer|not a runtime measurement/i.test(cardText)
    const buckets = /会被拒|会变好|判不了|would-be-denied|cannot tell/.test(cardText)
    check(
      'upgrade-card',
      card.code === 0 && boundary && buckets,
      `exit ${String(card.code)} · boundary=${boundary ? 'yes' : 'no'} · buckets=${buckets ? 'yes' : 'no'} · ${cardText.split('\n').find((line) => line.startsWith('# ')) ?? cardText.split('\n')[0] ?? ''}`,
      { lines: cardText.split('\n').length },
    )
  }

  const failed = checks.filter((entry) => entry.ok === false)
  const payload = {
    schema_version: 1,
    produced_by: 'scripts/record_usability_smoke.mjs',
    generated_at: stamp,
    subject: { package: 'dsh-triage', version, registry, anonymous: true },
    environment: { platform: process.platform, node: process.versions.node, cwd: '<a scratch project, not the repository>' },
    checks,
    ok: failed.length === 0,
    limits: [
      'the last command reads THIS machine\'s default DSH profile, so the card\'s numbers describe this machine and nobody else\'s',
      'this proves the four commands a new user types: it does not prove the Host loads the bundle (record_client_serve) nor the probe path (record_probe)',
      'the install is anonymous, but the network path is whatever this machine has — a proxy that hides failures is not covered',
      'exit codes and output shape are asserted, not the wording of every sentence',
    ],
  }

  const fileName = `usability-${stamp.replaceAll(':', '-')}.json`
  const target = join(outDir, fileName)
  mkdirSync(outDir, { recursive: true })
  if (existsSync(target)) {
    process.stderr.write(`refusing to overwrite existing evidence: ${fileName}\n`)
    process.exitCode = 2
    return
  }
  const text = `${JSON.stringify(payload, null, 2)}\n`
  writeFileSync(target, text, 'utf8')
  writeFileSync(`${target}.sha256`, sha256(text), 'utf8')
  rmSync(scratchRoot, { recursive: true, force: true })

  for (const entry of checks) process.stdout.write(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.id} — ${entry.detail}\n`)
  // Print the path that was actually written. The watcher had this exact bug in R64 (hard-coded
  // `data/results` while honouring `--out`), and it was copied here before being noticed (R65).
  const root = abs('.')
  const display = target.startsWith(root) ? target.slice(root.length + 1).replaceAll('\\', '/') : target
  process.stdout.write(`ssot ${display} sha256=${sha256(text).slice(0, 12)}…\n`)
  process.exitCode = failed.length === 0 ? 0 : 1
}

await main()
