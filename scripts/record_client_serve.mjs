#!/usr/bin/env node
/**
 * Does a real Host actually SERVE our browser half? (T-401, R31)
 *
 * WHY THIS SCRIPT EXISTS: the client bundle passes 9 vm-based contract tests, but "the Host
 * discovers `package.json#dsh.client` and serves `/plugins/dsh-triage/client.js`" is a different
 * claim, and it is the one a user pays for. This script installs the workspace packages into a
 * throwaway DSH home as `file:` dependencies (no registry, no credentials), boots the Host once,
 * asks for the asset, and writes what came back.
 *
 * WHAT IT DOES NOT PROVE (stated here so nobody over-reads the artifact): that the tab is VISIBLE
 * in the settings page, or that its content matches the CLI. Those need a UI assertion and a
 * host-side read-only Remote; this script only answers "served or not, and with what bytes".
 *
 *   node scripts/record_client_serve.mjs --dsh-main <bin.js> --install <dir> --stamp 2026-10-28T18:00:00.000Z
 *
 * Exit codes: 0 artifact written · 1 the Host did not serve the bundle · 2 bad usage.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { findBrowser } from '../packages/probe/dist/render.js'
import { abs, isoStamp } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
const dshMain = pathFor(String(argOf('--dsh-main', '')))
const installDir = pathFor(String(argOf('--install', '')))
const outDir = pathFor(argOf('--out', 'data/results'))
const bootTimeoutMs = Number(argOf('--boot-timeout-ms', '120000'))
const label = String(argOf('--label', 'client-serve')).replace(/[^a-zA-Z0-9._-]+/g, '-')
if (stamp === null || !existsSync(dshMain)) {
  process.stderr.write('usage: node scripts/record_client_serve.mjs --dsh-main <bin.js> --install <dir> --stamp <iso>\n')
  process.exit(2)
}

const WORKSPACE_PACKAGES = [
  ['core', 'packages/core', '@dsh-triage/core'],
  ['probe', 'packages/probe', '@dsh-triage/probe'],
  ['signals', 'packages/signals', '@dsh-triage/signals'],
  ['plugin', 'packages/plugin', 'dsh-triage'],
]

const root = join(tmpdir(), 'dsh-triage-client', `${label}-${Date.now().toString(36)}`)
const home = join(root, 'home')
const profileDir = join(home, 'profiles', 'web')
/** Inside the profile on purpose: `file:` deps outside the workspace root are not resolvable. */
const bundleRoot = join(profileDir, '.client-bundle')
const steps = []
let hostPid
const redactions = [abs('.'), homedir(), tmpdir()]
const clean = (value) => {
  let text = String(value ?? '')
  for (const root_ of redactions) {
    for (const variant of [root_, root_.replaceAll('\\', '/')]) text = text.split(variant).join(root_ === abs('.') ? '<repo>' : '~')
  }
  return text
}

const record = (id, status, detail, extra = {}) => steps.push({ id, status, detail: clean(detail), ...extra })
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** Copy the four workspace packages and point the plugin's deps at their local copies. */
function buildBundle() {
  mkdirSync(bundleRoot, { recursive: true })
  const names = []
  for (const [dirName, source, packageName] of WORKSPACE_PACKAGES) {
    const target = join(bundleRoot, dirName)
    cpSync(pathFor(source), target, {
      recursive: true,
      filter: (from) => !/[\\/](node_modules|src|lib)[\\/]/.test(from) && !from.endsWith('.ts'),
    })
    names.push({ dirName, packageName })
  }
  /*
   * EVERY copy has to lose its `workspace:` protocols, not just the plugin: core/probe/signals
   * depend on each other the same way, and pnpm refuses with "Cannot resolve package from
   * workspace" the moment one of them survives (R31 hit exactly that twice).
   */
  const rewrittenByPackage = {}
  for (const { dirName } of names) {
    const manifestPath = join(bundleRoot, dirName, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const rewritten = {}
    for (const [key, value] of Object.entries(manifest.dependencies ?? {})) {
      const match = names.find((entry) => entry.packageName === key)
      rewritten[key] = match === undefined ? value : `file:../${match.dirName}`
    }
    manifest.dependencies = rewritten
    // Dev dependencies are not part of what a user installs, and they carry workspace protocols.
    delete manifest.devDependencies
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    rewrittenByPackage[dirName] = rewritten
  }
  return { dir: join(bundleRoot, 'plugin'), dependencies: rewrittenByPackage.plugin ?? {} }
}

function run(command, args, options) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, options.timeoutMs ?? 300_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
  })
}

async function main() {
  const bundle = buildBundle()
  record('bundle', 'passed', `${Object.keys(bundle.dependencies).length} workspace deps rewritten to file:`, {
    dependencies: bundle.dependencies,
  })

  // A profile that asks for the bundle. The launcher owns the dependencies; we only declare them.
  // The three `@deepseek-ai/dsh*` packages are the same ones the sandbox profile already runs —
  // without a base + web app the Host has nothing to serve and never prints a URL (R31 tried).
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'dsh-profile-client-serve',
        private: true,
        dependencies: {
          '@deepseek-ai/dsh': '0.2.1-rc.4',
          '@deepseek-ai/dsh-base': '0.2.1-rc.4',
          '@deepseek-ai/dsh-web-app': '0.2.1-rc.4',
          'dsh-triage': `file:${bundle.dir.replaceAll('\\', '/')}`,
        },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-triage'] } },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n', 'utf8')
  /*
   * The same policy T-304 uses (`ADR-0007`): the launcher's install refuses unapproved build
   * scripts for the PROFILE's own native packages (measured here: dsh-subprocess-local, @google/
   * genai, koffi, node-pty, protobufjs). `strictDepBuilds: false` only turns that error into a
   * warning — it approves and runs nothing.
   */
  writeFileSync(
    join(profileDir, 'pnpm-workspace.yaml'),
    ['# written by dsh-triage record_client_serve (R31): do not fail the install over unapproved builds.', 'strictDepBuilds: false', ''].join('\n'),
    'utf8',
  )
  const env = {
    ...process.env,
    DSH_HOME: home,
    // Never inherit an npm credential (rule 4): the sandbox gets an empty user config.
    npm_config_userconfig: join(root, 'empty-npmrc'),
  }
  writeFileSync(join(root, 'empty-npmrc'), '', 'utf8')

  const installed = await run(process.execPath, [dshMain, 'plugin', '--profile', 'web', 'install'], { cwd: home, env, timeoutMs: 600_000 })
  const installDetail = clean(`${installed.stdout}\n${installed.stderr}`).trim().slice(-800)
  if (installed.code !== 0) {
    record('install', 'failed', installDetail || `exit ${installed.code}`)
    return await finish({ served: false, reason: 'install failed' })
  }
  record('install', 'passed', installDetail.split('\n').slice(-3).join(' · ') || 'exit 0')

  const port = Number(argOf('--port', '0'))
  const host = spawn(process.execPath, [dshMain, '--profile', 'web', '--port', String(port), '--no-open'], {
    cwd: home,
    env,
    windowsHide: true,
  })
  hostPid = host.pid
  let output = ''
  host.stdout?.on('data', (chunk) => {
    output += String(chunk)
  })
  host.stderr?.on('data', (chunk) => {
    output += String(chunk)
  })
  const url = await new Promise((resolvePromise) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const match = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=[A-Za-z0-9._~-]+/.exec(output) ?? /http:\/\/127\.0\.0\.1:(\d+)/.exec(output)
      if (match !== null) {
        clearInterval(timer)
        resolvePromise(match[0])
        return
      }
      if (Date.now() - started > bootTimeoutMs) {
        clearInterval(timer)
        resolvePromise(null)
      }
    }, 200)
  })
  try {
    if (url === null) {
      record('boot', 'failed', clean(output).slice(-400) || 'no URL printed')
      return await finish({ served: false, reason: 'host did not print a URL' })
    }
    const base = url.replace(/\?.*$/, '')
    record('boot', 'passed', `host printed ${base}`)

    /*
     * The graph, not a guessed URL (R31 got this wrong twice): `dsh-client-modules` serves a
     * client bundle only at its composed URL, which carries a `?rev=` hash
     * (`/plugins/??<id>/client.js&rev=…`). A bare `/plugins/<pkg>/client.js` is 404 even for the
     * Host's own bundles. The boot HTML lists every composed client module, so that list is the
     * evidence that the Host discovered our `dsh.client` at all.
     */
    const page = await fetchPage(base, url)
    if (page.status !== 200) {
      record('page', 'failed', `GET / -> ${page.status} (expected the boot document)`)
      return await finish({ served: false, reason: 'boot document not readable' })
    }
    const listed = extractClientModule(page.text, 'dsh-triage')
    record(
      'graph',
      listed === null ? 'failed' : 'passed',
      listed === null
        ? 'the boot document does not compose dsh-triage/client.js — the Host did not discover our dsh.client'
        : `composed as ${listed.slice(0, 120)}${listed.length > 120 ? '…' : ''}`,
      {
        html_bytes: page.text.length,
        client_module_listed: listed !== null,
        composed_url: listed === null ? null : clean(listed),
      },
    )
    if (listed === null) return await finish({ served: false, reason: 'client module not composed' })

    const asset = await fetchPage(`${base}`, `${base}${listed.replace(/^\//, '')}`, page.cookie)
    const body = asset.text
    const hasLoader = body.includes('__ModuleLoader__.load')
    const declaresId = /id:\s*['"]dsh-triage['"]/.test(body)
    const hasTab = body.includes('settings.plugins.tab')
    record(
      'client',
      asset.status === 200 && hasLoader && declaresId ? 'passed' : 'failed',
      `GET ${listed.slice(0, 60)}… -> ${asset.status} · ${body.length}B · loader=${hasLoader} · id=${declaresId} · tab=${hasTab}`,
      {
        status: asset.status,
        bytes: body.length,
        sha256: body.length === 0 ? null : sha256(body),
        has_loader: hasLoader,
        declares_id: declaresId,
        mentions_tab_slot: hasTab,
        content_type: asset.contentType,
      },
    )
    /*
     * Serving the bundle proves discovery; it does not prove the client runner ever called our
     * `apply`. The bundle publishes `window.__dshTriage` for exactly that question, so ask a real
     * browser — and record `null` (unmeasured) when no browser is available, never a guess.
     */
    const browser = findBrowser({ explicit: argOf('--browser', null) })
    if (browser === null) {
      record('mount', 'unmeasured', 'no browser found: the tab registration was not observed')
    } else {
      const mount = await checkMount(browser, `${base}`, page.cookie)
      record('mount', mount.registered === true ? 'passed' : mount.registered === false ? 'failed' : 'unmeasured', mount.detail, {
        browser: basename(browser),
        registered: mount.registered,
        slot: mount.slot ?? null,
        tab_id: mount.tab_id ?? null,
        reason: mount.reason ?? null,
      })
    }
    return await finish({ served: asset.status === 200 && hasLoader && declaresId, composed_url: listed })
  } finally {
    await killTree(host.pid)
  }
}

/** Follow the one-shot token 303 into the boot document and keep the cookie for later requests. */
/**
 * Ask the real page whether our tab registered (T-401, R31).
 *
 * WHY: serving `/plugins/...` proves discovery. It does not prove the client runner ever called our
 * `apply`. The bundle publishes `window.__dshTriage` for exactly this question, so the check reads
 * it over CDP instead of inferring anything from the DOM.
 */
async function checkMount(browser, pageUrl, cookie) {
  const userDataDir = join(root, 'cdp-user-data')
  mkdirSync(userDataDir, { recursive: true })
  const chrome = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { windowsHide: true },
  )
  try {
    const portFile = join(userDataDir, 'DevToolsActivePort')
    const port = await new Promise((resolvePromise) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (existsSync(portFile)) {
          const first = readFileSync(portFile, 'utf8').split('\n')[0] ?? ''
          clearInterval(timer)
          resolvePromise(Number(first))
          return
        }
        if (Date.now() - started > 20_000) {
          clearInterval(timer)
          resolvePromise(null)
        }
      }, 100)
    })
    if (port === null) return { registered: null, detail: 'browser never exposed a debugging port' }
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const target = Array.isArray(targets) ? targets.find((entry) => entry.type === 'page') : null
    if (target === null || target === undefined) return { registered: null, detail: 'no page target in the browser' }
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    const pending = new Map()
    let nextId = 1
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      const waiter = pending.get(message.id)
      if (waiter === undefined) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    })
    const send = (method, params = {}) =>
      new Promise((resolvePromise, rejectPromise) => {
        const id = nextId++
        pending.set(id, { resolve: resolvePromise, reject: rejectPromise })
        socket.send(JSON.stringify({ id, method, params }))
      })
    await new Promise((resolvePromise, rejectPromise) => {
      socket.addEventListener('open', () => resolvePromise(undefined), { once: true })
      socket.addEventListener('error', () => rejectPromise(new Error('cdp socket error')), { once: true })
    })
    await send('Page.enable')
    await send('Network.enable')
    for (const pair of cookie.split(';')) {
      const [name, ...rest] = pair.trim().split('=')
      const value = rest.join('=')
      if (name === '' || value === '') continue
      await send('Network.setCookie', { name, value, url: pageUrl })
    }
    await send('Page.navigate', { url: pageUrl })
    let marker = null
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 800))
      const evaluated = await send('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__dshTriage || null)',
        returnByValue: true,
      })
      const value = evaluated?.result?.value
      if (typeof value === 'string' && value !== 'null') {
        marker = JSON.parse(value)
        break
      }
    }
    socket.close()
    if (marker === null) {
      return { registered: null, detail: 'the page never published window.__dshTriage (bundle not executed?)' }
    }
    return {
      registered: marker.registered === true,
      slot: typeof marker.slot === 'string' ? marker.slot : null,
      tab_id: typeof marker.id === 'string' ? marker.id : null,
      reason: typeof marker.reason === 'string' ? marker.reason : null,
      detail:
        marker.registered === true
          ? 'the client runner called apply and the settings slot accepted the tab'
          : `refused: ${String(marker.reason)}`,
    }
  } finally {
    await killTree(chrome.pid)
  }
}

async function fetchPage(base, tokenUrl, cookie = '') {
  let current = cookie
  if (current === '') {
    const first = await fetch(tokenUrl, { redirect: 'manual' })
    current = (first.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ')
    const location = first.headers.get('location')
    if (location === null) {
      return { status: first.status, text: '', contentType: null, cookie: current }
    }
    const next = await fetch(`${base}${location.replace(/^\.?\//, '')}`, { headers: { cookie: current, accept: 'text/html' }, redirect: 'manual' })
    return { status: next.status, text: next.status === 200 ? await next.text() : '', contentType: next.headers.get('content-type'), cookie: current }
  }
  const response = await fetch(tokenUrl, { headers: { cookie: current }, redirect: 'manual' })
  return { status: response.status, text: response.status === 200 ? await response.text() : '', contentType: response.headers.get('content-type'), cookie: current }
}

/** Pull our package's composed bundle URL out of the boot document, or null when absent. */
function extractClientModule(html, packageName) {
  const refs = [...html.matchAll(/["']([^"']*plugins\/[^"']+)["']/g)].map((match) => match[1].replaceAll('&amp;', '&'))
  for (const ref of refs) {
    if (!ref.includes(packageName)) continue
    return ref.startsWith('/') ? ref : `/${ref}`
  }
  return null
}

async function killTree(pid) {  if (pid === undefined) return
  await new Promise((resolvePromise) => {
    const child = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    child.on('close', () => resolvePromise())
    child.on('error', () => resolvePromise())
  })
}

async function finish(outcome) {
  /*
   * Kill the Host BEFORE removing the sandbox: while it runs it holds the install's files, and
   * R31's retry loop was chasing a lock that could never clear (cleanup failed on every run).
   */
  await killTree(hostPid)
  /*
   * Windows also keeps the install's hardlinks locked for a moment after the tree exits, so a
   * single `rmSync` still fails with EPERM. Retry, then say so: a sandbox left behind in %TEMP%
   * is not a silent pass.
   */
  let removed = false
  let lastError = null
  /*
   * Async, not a busy wait: the handles are released by the OS after the killed Host tree exits,
   * and blocking the event loop during that window was why R31's first retries still failed.
   */
  for (let attempt = 0; attempt < 10 && !removed; attempt += 1) {
    try {
      rmSync(root, { recursive: true, force: true })
      removed = true
    } catch (error) {
      lastError = error
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    }
  }
  record('cleanup', removed ? 'passed' : 'failed', removed ? 'sandbox removed' : `leaked: ${String(lastError)}`, { removed })
  const payload = {
    schema_version: 1,
    produced_by: 'scripts/record_client_serve.mjs',
    generated_at: stamp,
    label,
    outcome,
    sandbox: { home: clean(home), profile: 'web', bundle: 'file:packages/* (workspace rewritten)' },
    steps,
    limits: [
      'the workspace packages are installed from local directories with their workspace deps rewritten to file: — no registry and no credentials are involved',
      'this proves the Host serves /plugins/dsh-triage/client.js; it does not prove the tab is visible or that its content matches the CLI (that needs a UI assertion and a host-side read-only Remote)',
      'one sandbox runtime (0.2.1-rc.4) on one Windows machine',
    ],
  }
  const text = `${JSON.stringify(payload, null, 2)}\n`
  mkdirSync(outDir, { recursive: true })
  const target = join(outDir, `client-serve-${stamp.replaceAll(':', '-')}.json`)
  writeFileSync(target, text, 'utf8')
  writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')
  const relative = target.replaceAll('\\', '/').split('/data/results/').pop()
  process.stdout.write(`${outcome.served ? 'served' : 'NOT served'} · ${basename(target)} · ${steps.map((step) => `${step.id}:${step.status}`).join(' ')}\n`)
  process.stdout.write(`  ${relative}\n`)
  process.exitCode = outcome.served ? 0 : 1
}

await main()
