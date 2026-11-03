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
 * WHAT IT DOES NOT PROVE (stated here so nobody over-reads the artifact): that the tab's CONTENT
 * matches the CLI. That needs a host-side read-only Remote, which is a separate decision (R33
 * spike, `docs/adr/0010`). Visibility is asserted since R33: after opening Settings the probe looks
 * for the tab label in the DOM (`visible` step), and reports the controls it saw instead of guessing
 * a selector when it cannot find the entry.
 *
 *   node scripts/record_client_serve.mjs --dsh-main <bin.js> --install <dir> --stamp 2026-10-28T18:00:00.000Z
 *
 * Exit codes: 0 artifact written · 1 the Host did not serve the bundle, or the tab registered but never
 * rendered in the settings page · 2 bad usage.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { findBrowser } from '../packages/probe/dist/render.js'
import { SANDBOX_PNPM_WORKSPACE, buildWorkspaceBundle, sandboxProfileManifest } from './lib/bundle.mjs'
import { abs, isoStamp } from './lib/kit.mjs'
import { cpuTimes, describeConditions } from './lib/load-sample.mjs'
import { compareUpgradeBuckets, controlNames, describeNoAnswer, judgeTabView, judgeUpgradeView, pickControl, tabMatch as matchTab } from './lib/ui-probe.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))

/*
 * R70 (the other half of BS-54): record what the machine was doing. R68's distribution has a 2.4s p90 tail
 * and no way to attribute it, because artifacts recorded results and not conditions. CPU deltas around the
 * whole run are coarse (one number per multi-minute run) but they turn "unknown" into "the machine was X%
 * busy", which is the difference between a mystery and a hypothesis.
 *
 * Module-level on purpose: `finish()` builds the payload and cannot see `main()`'s locals — the first version
 * of this recorded a ReferenceError instead of a condition block (R70, found by running it).
 */
const conditionsBefore = cpuTimes()
const runStartedAt = new Date().toISOString()
const dshMain = pathFor(String(argOf('--dsh-main', '')))
const installDir = pathFor(String(argOf('--install', '')))
const outDir = pathFor(argOf('--out', 'data/results'))
const bootTimeoutMs = Number(argOf('--boot-timeout-ms', '120000'))
const label = String(argOf('--label', 'client-serve')).replace(/[^a-zA-Z0-9._-]+/g, '-')
/** `--lang en` makes the browser claim English, which is how the en half of the tab is witnessed. */
const uiLang = String(argOf('--lang', '')).toLowerCase()
/**
 * `--screenshot <file>` captures the screen the tab actually rendered (R54). The Show Your Plugins
 * category requires screenshots, and a mock-up would be a picture of something nobody can install:
 * this one is taken from the same real Host + real browser as `visible`/`summary-visible`.
 */
const screenshotRequest = argOf('--screenshot', null)
/**
 * `--upgrade-wait-ms <n>` is the PROBE's patience, not the product's budget: the route keeps its own
 * 10s registry cap and 20s scan budget. It exists so a negative control can reproduce R61 exactly —
 * give up after 300ms and the step must say `unmeasured` ("we stopped asking"), never `failed`.
 */
const upgradeWaitMs = Number(argOf('--upgrade-wait-ms', '30000'))
if (!Number.isFinite(upgradeWaitMs) || upgradeWaitMs < 0) {
  // A NaN budget would silently turn the loop's 200-attempt ceiling into a ~100s wait, which reads
  // like a hang; refuse the value instead of guessing what was meant.
  process.stderr.write(`--upgrade-wait-ms must be a non-negative number of milliseconds (got "${String(argOf('--upgrade-wait-ms', ''))}")\n`)
  process.exit(2)
}
/** `--fixture-range` / `--break-after-install` stage a row that is fine at install and denied afterwards. */
const fixtureRange = argOf('--fixture-range', null)
const breakAfterInstall = argOf('--break-after-install', null)
/*
 * R70: `--dsh-main` used to default to `pathFor('')`, which is the REPO ROOT — and `existsSync(<dir>)` passes,
 * so a run without the flag got `node <repo> plugin install` → "Cannot find module '<repo>'", recorded as
 * `install: failed`. That is the same family as R50's "the check never ran but reported a 401": a missing
 * configuration produced a red that looks like the product's fault. Require an explicit file now.
 */
if (stamp === null || argOf('--dsh-main', null) === null || !existsSync(dshMain) || !statSync(dshMain).isFile()) {
  process.stderr.write(
    'usage: node scripts/record_client_serve.mjs --dsh-main <bin.js> --install <dir> --stamp <iso>\n' +
      `  --dsh-main must be the launcher FILE (e.g. sandbox/upstream/0.2.1-rc.4/install/node_modules/@deepseek-ai/dsh/lib/bin.js)\n` +
      `  got: ${dshMain}\n`,
  )
  process.exit(2)
}

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

const record = (id, status, detail, extra = {}) => {
  steps.push({ id, status, detail: clean(detail), ...extra })
  /*
   * Progress goes to stderr only with `--verbose`: a real run spends minutes inside install/boot and
   * silence makes a stuck run undiagnosable, but stderr is not evidence AND PowerShell treats native
   * stderr writes as errors, which would make a successful run look failed to a wrapper (R33 met it).
   */
  if (verbose) process.stderr.write(`  ${id}: ${status}\n`)
}
const verbose = argv.includes('--verbose')
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** Copy the four workspace packages and point the plugin's deps at their local copies. */
function buildBundle() {
  return buildWorkspaceBundle({ targetRoot: bundleRoot, pathFor })
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
  const manifest = sandboxProfileManifest({ bundleDir: bundle.dir, runtimeVersion: '0.2.1-rc.4', name: 'dsh-profile-client-serve' })
  /*
   * EXTRA BUNDLES (R51, BS-47): a profile whose rows are ALL fine cannot show the tab's "will break"
   * screen, so that screen had unit tests only. `--extra-bundle <dir>` stages a fixture bundle into
   * the profile (dependency + `dsh.profile.bundles`), which is how a denied row gets onto the page
   * without touching the machine's real DSH home.
   */
  const extraBundles = []
  for (const source of String(argOf('--extra-bundle', '') ?? '').split(',').map((value) => value.trim()).filter((value) => value !== '')) {
    const staged = join(profileDir, `.extra-${basename(source)}`)
    cpSync(pathFor(source), staged, { recursive: true })
    const extraManifestPath = join(staged, 'package.json')
    const extraManifest = JSON.parse(readFileSync(extraManifestPath, 'utf8'))
    /*
     * A ROW THAT BECOMES DENIED AFTER INSTALL (R51, BS-47): upstream refuses to install a bundle
     * whose range excludes the runtime, so "it was fine yesterday" cannot be reproduced by
     * installing a broken bundle. `--fixture-range` installs a compatible claim; then
     * `--break-after-install` rewrites the installed manifest, which is what a plugin update (or a
     * hand-edited profile) does to a row that used to pass. It is NOT the same thing as the runtime
     * moving — the report says which one was simulated.
     */
    if (fixtureRange !== null) {
      extraManifest.engines = { ...(extraManifest.engines ?? {}), dsh: String(fixtureRange) }
      writeFileSync(extraManifestPath, `${JSON.stringify(extraManifest, null, 2)}\n`, 'utf8')
    }
    const extraName = String(extraManifest.name ?? '')
    if (extraName === '') throw new Error(`${source}/package.json has no name`)
    manifest.dependencies[extraName] = `file:${staged.replaceAll('\\', '/')}`
    manifest.dsh.profile.bundles.push(extraName)
    extraBundles.push({ name: extraName, version: String(extraManifest.version ?? '0.0.0'), engines: extraManifest.engines ?? null, staged })
  }
  if (extraBundles.length > 0) record('extra-bundles', 'passed', `staged ${extraBundles.length} fixture bundle(s) into the profile`, {
    // `staged` is deliberately NOT recorded: it is an absolute sandbox path, and `results-privacy`
    // (rightly) refuses any home-shaped path in an artifact. R51's first six runs leaked it here.
    bundles: extraBundles.map((entry) => ({ name: entry.name, version: entry.version, engines: entry.engines })),
  })
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n', 'utf8')
  /*
   * The same policy T-304 uses (`ADR-0007`): the launcher's install refuses unapproved build
   * scripts for the PROFILE's own native packages (measured here: dsh-subprocess-local, @google/
   * genai, koffi, node-pty, protobufjs). `strictDepBuilds: false` only turns that error into a
   * warning — it approves and runs nothing.
   */
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), SANDBOX_PNPM_WORKSPACE, 'utf8')
  const env = {
    ...process.env,
    DSH_HOME: home,
    // Never inherit an npm credential (rule 4): the sandbox gets an empty user config.
    npm_config_userconfig: join(root, 'empty-npmrc'),
  }
  writeFileSync(join(root, 'empty-npmrc'), '', 'utf8')

  /*
   * STAGING A DENIED ROW (R51, BS-47) — measured, not assumed: the launcher REFUSES TO INSTALL a
   * bundle whose `engines.dsh` excludes the runtime (it rolled the profile back and told the
   * operator to grant an exact-version exemption). So the only honest way to photograph the tab's
   * "will break" screen is to grant the exemption, install, then REVOKE it — which is also a real
   * state a user reaches when an exemption is withdrawn or the runtime moves.
   */
  if (extraBundles.length > 0) {
    let granted = 'not attempted'
    for (const extra of extraBundles) {
      const grant = await run(
        process.execPath,
        [dshMain, 'plugin', '--profile', 'web', 'allow-version', `${extra.name}@${extra.version}`, '--dsh-version', '0.2.1-rc.4', '--accept-risk'],
        { cwd: home, env, timeoutMs: 120_000 },
      )
      granted = grant.code === 0 ? 'granted' : `failed (exit ${grant.code}): ${clean(grant.stderr).slice(-300)}`
      if (grant.code !== 0) break
    }
    record('exempt-grant', granted === 'granted' ? 'passed' : 'failed', granted, { bundles: extraBundles.map((entry) => `${entry.name}@${entry.version}`) })
    if (granted !== 'granted') return await finish({ served: false, reason: 'exemption could not be granted' })
  }

  const installed = await run(process.execPath, [dshMain, 'plugin', '--profile', 'web', 'install'], { cwd: home, env, timeoutMs: 600_000 })
  const installDetail = clean(`${installed.stdout}\n${installed.stderr}`).trim().slice(-800)
  if (installed.code !== 0) {
    record('install', 'failed', installDetail || `exit ${installed.code}`)
    return await finish({ served: false, reason: 'install failed' })
  }
  record('install', 'passed', installDetail.split('\n').slice(-3).join(' · ') || 'exit 0')

  if (extraBundles.length > 0) {
    const exemptions = join(profileDir, 'compatibility.json')
    const existed = existsSync(exemptions)
    if (existed) rmSync(exemptions, { force: true })
    record('exempt-revoke', existed ? 'passed' : 'unmeasured', existed
      ? 'removed the exemption file, so the staged row is judged on its declaration again (the tab should now show a "will break" row)'
      : 'the launcher installed without writing an exemption file, so there was nothing to revoke')
  }

  if (breakAfterInstall !== null && extraBundles.length > 0) {
    // What a plugin update does: the same row, a narrower claim. The installed copy is what the
    // audit reads, so both the staged source and the installed copy are rewritten.
    /*
     * `--break-only <name>` (R55): a mixed demo needs ONE denied row next to a collision, so the
     * rewrite has to be scoped. Without it every staged fixture would become denied and the
     * collision would never be seen — the demo would be four copies of the same problem.
     */
    const breakOnly = argOf('--break-only', null)
    const targets = breakOnly === null ? extraBundles : extraBundles.filter((entry) => entry.name === String(breakOnly))
    if (breakOnly !== null && targets.length === 0) {
      throw new Error(`--break-only "${String(breakOnly)}" matches none of: ${extraBundles.map((entry) => entry.name).join(', ')}`)
    }
    const rewritten = []
    for (const extra of targets) {
      const candidates = [
        join(extra.staged, 'package.json'),
        join(profileDir, 'node_modules', ...extra.name.split('/'), 'package.json'),
        join(profileDir, 'node_modules', '.pnpm', 'node_modules', ...extra.name.split('/'), 'package.json'),
      ]
      for (const file of candidates) {
        if (!existsSync(file)) continue
        const manifest = JSON.parse(readFileSync(file, 'utf8'))
        if (String(manifest.name ?? '') !== extra.name) continue
        manifest.engines = { ...(manifest.engines ?? {}), dsh: String(breakAfterInstall) }
        writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
        rewritten.push(clean(file).replace(/^.*?profiles/, '<profile>'))
      }
    }
    record('break-after-install', rewritten.length > 0 ? 'passed' : 'failed', rewritten.length > 0
      ? `rewrote ${rewritten.length} installed manifest(s) so ${targets.map((entry) => entry.name).join(', ')} now declares engines.dsh ${String(breakAfterInstall)} — a row that passed at install time and is denied afterwards`
      : 'could not find the installed manifest to rewrite, so nothing was made to break', { files: rewritten, targets: targets.map((entry) => entry.name) })
  }

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
    /*
     * T-818 DIRECT ROUTE PROBE: ask the route from Node before the browser does. This separates
     * "the route is not registered or its handler hangs" from "the click did not reach the route",
     * which the DOM probe alone cannot tell apart.
     */
    const upgradeDirect = await (async () => {
      const started = Date.now()
      try {
        const response = await fetch(`${base.replace(/\/+$/, '')}/compat-triage/summary?upgrade=1`, {
          headers: { cookie: page.cookie, accept: 'application/json', 'sec-fetch-site': 'same-origin' },
          signal: AbortSignal.timeout(30_000),
        })
        const text = await response.text()
        return { status: response.status, ms: Date.now() - started, body: text.slice(0, 400) }
      } catch (error) {
        return { status: null, ms: Date.now() - started, error: String(error && error.message ? error.message : error) }
      }
    })()
    record(
      'upgrade-route',
      upgradeDirect.status === 200 ? 'passed' : 'failed',
      upgradeDirect.status === null
        ? `GET /compat-triage/summary?upgrade=1 did not answer in ${upgradeDirect.ms}ms: ${String(upgradeDirect.error)}`
        : `GET /compat-triage/summary?upgrade=1 -> ${upgradeDirect.status} in ${upgradeDirect.ms}ms`,
      {
        /*
         * R62: this used to be `...upgradeDirect`, whose own `status` (200) overwrote the step's
         * `status` ('passed') — the artifact then carried `"status": 200` where every gate and reader
         * expects one of passed/failed/unmeasured. The HTTP number is the evidence, not the verdict.
         */
        http_status: upgradeDirect.status,
        ms: upgradeDirect.ms,
        error: upgradeDirect.error ?? null,
        body: upgradeDirect.body ?? null,
      },
    )
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
    let visibleStatus = 'unmeasured'
    if (browser === null) {
      record('mount', 'unmeasured', 'no browser found: the tab registration was not observed')
      record('visible', 'unmeasured', 'no browser found: the settings page was never opened')
      record('screenshot', 'unmeasured', 'no browser found: there was no screen to photograph')
    } else {
      const screenshotTarget =
        screenshotRequest === null
          ? null
          : isAbsolute(String(screenshotRequest))
            ? String(screenshotRequest)
            : resolve(abs('.'), String(screenshotRequest))
      const observed = await observePage(browser, `${base}`, page.cookie, screenshotTarget)
      const mount = observed.marker
      record('mount', mount.registered === true ? 'passed' : mount.registered === false ? 'failed' : 'unmeasured', mount.detail, {
        browser: basename(browser),
        registered: mount.registered,
        slot: mount.slot ?? null,
        tab_id: mount.tab_id ?? null,
        reason: mount.reason ?? null,
      })
      visibleStatus = observed.visible.status
      record('visible', observed.visible.status, observed.visible.detail, observed.visible.evidence)
      /*
       * SCREENSHOT (R54): the file is a deliverable (the upstream plugin category requires one), so its
       * size and sha256 go into the artifact — a screenshot that is not pinned to a run is decoration.
       */
      if (screenshotRequest === null) {
        record('screenshot', 'unmeasured', 'no --screenshot was passed, so no image is claimed by this run', {})
      } else if (observed.screenshot?.path) {
        record('screenshot', 'passed', `captured the same screen as summary-visible: ${observed.screenshot.path} (${observed.screenshot.bytes} bytes)`, observed.screenshot)
      } else {
        record('screenshot', 'failed', `the browser did not return an image: ${String(observed.screenshot?.error ?? 'no image')}`, {})
      }
      /*
       * SUMMARY VISIBLE (R51): the tab must render the ANSWER, not merely exist. The DOM probe
       * reports which view it rendered and how many issue rows it showed; the counts line is what
       * the same-source step below compares with the CLI.
       */
      const tabProbe = observed.visible.evidence?.tab_probe ?? null
      // Older artifacts carry no `tab_judged`; the rule is cheap to re-derive from the same probe.
      const tabJudged = observed.visible.evidence?.tab_judged ?? judgeTabView(tabProbe)
      if (browser === null || tabProbe === null) {
        record('summary-visible', 'unmeasured', 'the tab body was never probed (see the visible step)', {})
      } else if (tabJudged.decided !== true && tabJudged.state === 'pending') {
        /*
         * R62: the loop now waits out `pending` instead of stopping on it, so reaching here means the
         * fetch really had not answered after the full wait. That is `unmeasured` — "we never got an
         * answer" — not a claim that the tab is broken.
         */
        record(
          'summary-visible',
          'unmeasured',
          describeNoAnswer(String(tabJudged.state), Number(observed.visible.evidence?.tab_ms ?? 0)),
          { tab_probe: tabProbe, tab_judged: tabJudged },
        )
      } else if (tabJudged.state === 'failed') {
        record(
          'summary-visible',
          'failed',
          `the tab rendered a degraded view (${String(tabProbe.kind)}) instead of the answer — on a readable profile that is a defect, not a degradation`,
          tabProbe,
        )
      } else if (tabJudged.state !== 'answer') {
        // The tab mounted but nothing triage-shaped ever appeared: that is a defect, not a wait.
        record('summary-visible', 'failed', 'the tab mounted but no triage view appeared in the DOM', tabProbe)
      } else {
        record(
          'summary-visible',
          'passed',
          `the tab rendered the summary: tone ${String(tabProbe.tone)}, ${String(tabProbe.issues)} issue row(s) on screen, ${String(tabProbe.copy_fix_buttons ?? 0)} copy-fix button(s)`,
          tabProbe,
        )
      }
      /*
       * UPGRADE VISIBLE (T-818): a second screen, opened by a click. `unmeasured` when there was no
       * button to click; `failed` when the click produced no bucket table; `passed` only when the
       * four buckets are in the DOM.
       */
      const upgradeSeen = observed.visible.evidence?.upgrade_probe ?? null
      const upgradeJudged = upgradeSeen?.judged ?? null
      if (upgradeSeen === null) {
        record('upgrade-visible', 'unmeasured', 'the upgrade screen was not opened (see summary-visible)', {})
      } else if (upgradeJudged === null || upgradeJudged.decided !== true) {
        /*
         * R62: "we stopped asking" is not "the screen is broken". The R61 artifact called this
         * `failed` after ~500ms of waiting on a route that answered in 815ms; `unmeasured` plus the
         * wait length is the honest reading, and the sentence says so out loud.
         */
        record(
          'upgrade-visible',
          'unmeasured',
          describeNoAnswer(String(upgradeJudged?.state ?? 'absent'), Number(upgradeSeen.waited_ms ?? 0)),
          upgradeSeen,
        )
      } else if (upgradeJudged.state !== 'answer') {
        record('upgrade-visible', 'failed', upgradeJudged.reason, upgradeSeen)
      } else {
        record(
          'upgrade-visible',
          'passed',
          `the upgrade screen rendered ${Array.isArray(upgradeSeen.probe?.counts) ? upgradeSeen.probe.counts.length : 0} bucket row(s) in ${Number(upgradeSeen.waited_ms ?? 0)}ms`,
          upgradeSeen,
        )
      }
      /*
       * USER ANSWER (R51 user test): does the screen answer the three questions a stranger has —
       * will it break / which row / what do I type? Checked structurally, not by reading prose:
       * a rendered conclusion sentence, at least one named row (or an explicit "nothing needs you"),
       * and a copy-pasteable command. `ms` is how long the wait was between click and answer.
       */
      if (browser === null || tabProbe === null || tabProbe.present !== true) {
        record('user-answer', 'unmeasured', 'no tab body was captured, so the three questions were not put to it', {})
      } else {
        const tabText = String(tabProbe.text ?? '')
        const answers = {
          conclusion: typeof tabProbe.tone === 'string' && tabProbe.tone !== '',
          which_row: Number(tabProbe.issues ?? 0) > 0 || /没有需要你动手|Nothing here needs your hands/.test(tabText),
          what_to_type: tabText.includes('dsh-triage'),
        }
        const all = answers.conclusion && answers.which_row && answers.what_to_type
        record(
          'user-answer',
          all ? 'passed' : 'failed',
          `${all ? 'the first screen answers' : 'the first screen does not answer'} will-it-break / which-row / what-to-type ` +
            `(${Object.entries(answers).map(([key, value]) => `${key}:${value ? 'yes' : 'no'}`).join(' · ')}) · answered in ${String(observed.visible.evidence?.tab_ms ?? '?')}ms`,
          { answers, ms_to_answer: observed.visible.evidence?.tab_ms ?? null, text_chars: tabText.length },
        )
      }

      /*
       * ENGLISH SCREEN (R51, BS-47): the en dictionary existed in the bundle but no one had seen it
       * on screen. `--lang en` makes the browser (and therefore the Host) claim English; this step
       * reads the rendered text and says whether the English sentences are what a user gets.
       */
      const tabText = String(tabProbe?.text ?? '')
      const looksEnglish = /will this setup break|What needs you|Next step|cannot tell/i.test(tabText)
      if (uiLang === 'en') {
        record('english-screen', tabProbe?.present === true && looksEnglish ? 'passed' : 'failed', tabProbe?.present === true && looksEnglish
          ? 'the tab rendered its English dictionary (same code path, en sentences)'
          : `asked for English but the tab text is not English: ${tabText.slice(0, 120)}`)
      } else {
        record('english-screen', 'unmeasured', 'no --lang en was passed, so the English screen is not claimed by this run')
      }
      /*
       * CLIPBOARD (R51, BS-47): the button existing is not the same claim as the command reaching
       * the clipboard. The probe clicked it with a real mouse event and read the clipboard back.
       */
      const clipboard = observed.visible.evidence?.clipboard ?? null
      record('clipboard-copy', clipboard?.status ?? 'unmeasured', clipboard?.detail ?? 'no clipboard probe ran', clipboard?.evidence ?? {})

      /*
       * SAME SOURCE (T-401 ②, R33): the tab's numbers must be the CLI's numbers for the SAME home and
       * profile — otherwise "the panel shows the CLI's conclusions" is just a sentence. The comparison
       * runs the real CLI against the sandbox the Host just served.
       */
      const fromTab = observed.visible.evidence?.marker_after_tab?.data ?? null
      /*
       * `--cli-home` exists ONLY for the negative control: pointing the CLI at a different home must
       * produce a disagreement, which proves the comparison is real and not a tautology.
       */
      const cli = await readCliAudit(pathFor(String(argOf('--cli-home', home))), String(argOf('--cli-profile', 'web')), env)
      if (fromTab === null || fromTab.counts === null || fromTab.counts === undefined || cli === null || cli.error !== undefined) {
        record('same-source', 'unmeasured', 'the tab published no counts or the CLI could not read the same profile', {
          tab_data: fromTab,
          cli_error: cli === null ? 'cli audit produced no payload' : (cli.error ?? null),
        })
      } else {
        /*
         * The summary's `denied` bucket is `blocked` + `risky`, so the comparison uses the CLI's
         * blocked count only when the CLI reports no risky rows; otherwise the honest comparison is
         * "the four numbers the CLI itself would print". R51 keeps that mapping explicit and file-
         * local: two different definitions of "will break" is how the tab and the CLI drift apart.
         */
        const same =
          fromTab.counts.rows === cli.declared &&
          fromTab.counts.judged === cli.judged &&
          fromTab.counts.go === cli.verdicts.go &&
          fromTab.counts.denied === cli.verdicts.blocked + cli.verdicts.risky &&
          fromTab.counts.unknown === cli.verdicts.unknown
        record(
          'same-source',
          same ? 'passed' : 'failed',
          same
            ? `the tab and the CLI agree on this profile: ${cli.declared} declared rows (${cli.rows} resolved), ${cli.verdicts.go} go / ${cli.verdicts.blocked + cli.verdicts.risky} will break / ${cli.verdicts.unknown} unknown`
            : 'the tab and the CLI disagree on the same profile',
          { tab_data: fromTab, cli_data: cli, tab_dom_counts: tabProbe?.counts_text ?? null },
        )
      }
      /*
       * UPGRADE SAME SOURCE (T-818): the four buckets on screen must be the CLI's four buckets for
       * the same target. The route and the CLI share `judgeUpgradeImpact`; this step proves it.
       */
      const upgradeProbe = observed.visible.evidence?.upgrade_probe?.probe ?? null
      const upgradeJudgement = observed.visible.evidence?.upgrade_probe?.judged ?? null
      /*
       * `evaluate()` parses JSON, so the marker is already an OBJECT here — the old code ran it through
       * `JSON.parse(String(marker))`, i.e. `JSON.parse('[object Object]')`, which threw and produced
       * `null`. That is why `upgrade-same-source` could never pass, even when the screen was perfect
       * (R62: the run that first rendered four buckets still said "no target to compare").
       */
      const rawMarker = observed.visible.evidence?.upgrade_probe?.marker ?? null
      let upgradeMarker = null
      if (rawMarker !== null && typeof rawMarker === 'object') {
        upgradeMarker = rawMarker
      } else if (typeof rawMarker === 'string' && rawMarker !== '') {
        try {
          upgradeMarker = JSON.parse(rawMarker)
        } catch {
          upgradeMarker = null
        }
      }
      if (upgradeJudgement === null || upgradeJudgement.state !== 'answer' || !Array.isArray(upgradeProbe?.counts) || upgradeMarker === null || typeof upgradeMarker.target !== 'string') {
        record(
          'upgrade-same-source',
          'unmeasured',
          upgradeJudgement === null || upgradeJudgement.state !== 'answer'
            ? `there was no four-bucket answer to compare (screen was "${String(upgradeJudgement?.state ?? 'not opened')}")`
            : 'the screen rendered but published no target version, so there is nothing to compare against',
          {},
        )
      } else {
        const cliUpgrade = await readCliUpgrade(pathFor(String(argOf('--cli-home', home))), String(argOf('--cli-profile', 'web')), upgradeMarker.target, env)
        if (cliUpgrade === null || cliUpgrade.error !== undefined || cliUpgrade.counts === null) {
          record('upgrade-same-source', 'unmeasured', 'the CLI could not judge the same target', { cli_error: cliUpgrade?.error ?? null })
        } else {
          /*
           * The comparison itself is a pure function (R62): "the four numbers on screen are the four
           * numbers the CLI prints" is a claim that can be decided without a browser, so it is pinned
           * by unit tests instead of living inline where only a full run could exercise it.
           */
          const comparison = compareUpgradeBuckets(upgradeProbe.counts, cliUpgrade.counts)
          const disagreeing = comparison.pairs.filter((pair) => !pair.agree)
          record(
            'upgrade-same-source',
            comparison.same ? 'passed' : 'failed',
            comparison.same
              ? `the tab and the CLI agree on ${upgradeMarker.target}: ${cliUpgrade.counts.would_be_denied} denied / ${cliUpgrade.counts.cannot_tell} cannot tell / ${cliUpgrade.counts.improved} improved / ${cliUpgrade.counts.likely_fine} likely fine`
              : `the tab and the CLI disagree on ${upgradeMarker.target}: ${disagreeing
                  .map((pair) => `${pair.bucket} tab=${String(pair.tab)} cli=${String(pair.cli)}`)
                  .join(' · ')}`,
            { comparison },
          )
        }
      }
    }
    return await finish({ served: asset.status === 200 && hasLoader && declaresId, composed_url: listed, tab_visible: visibleStatus }, output)
  } finally {
    await killTree(host.pid)
  }
}

/**
 * Ask the real page two DIFFERENT questions in ONE browser launch (T-401: R31 mount, R33 visible).
 *
 *   mount   — did the client runner call our `apply`, and did the settings slot accept the tab?
 *             (the bundle publishes `window.__dshTriage` for exactly this question)
 *   visible — after opening Settings, does the tab actually appear in the DOM? (R33)
 *
 * WHY ONE LAUNCH: the marker is published when the page loads, but the tab only renders once the
 * settings page mounts that slot, so both answers belong to the same page instance. Two launches
 * would double the boot cost and could observe two different configurations.
 *
 * WHY IT REPORTS ITS SEARCH: the settings DOM is not ours, and guessing a selector would turn a
 * wrong guess into a red light (or worse, into a green one). So the probe records the controls the
 * page actually offered, then clicks what it found; a miss is a readable "here is what the page
 * showed", never "my selector did not match".
 */
async function observePage(browser, pageUrl, cookie, screenshotTarget = null) {
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
    /*
     * R75 (T-813): a browser that does not exit on its own must not keep this process alive.
     * Chromium shuts down when its last page target goes away; Firefox does not, and because the
     * child inherited piped stdio, node stayed alive after the artifact was written — the Firefox
     * witness run hung for 15 minutes and was killed by an outside timeout instead of reporting
     * `unmeasured`. `stdio: 'ignore'` + `unref()` means "we speak CDP over a socket, so the pipes
     * are not evidence", and the run can end as soon as its work is done.
     */
    { windowsHide: true, stdio: 'ignore' },
  )
  chrome.unref()
  const nothingObserved = (detail, evidence = {}) => ({
    marker: { registered: null, detail },
    visible: { status: 'unmeasured', detail, evidence },
  })
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
    if (port === null) return nothingObserved('browser never exposed a debugging port')
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const target = Array.isArray(targets) ? targets.find((entry) => entry.type === 'page') : null
    if (target === null || target === undefined) return nothingObserved('no page target in the browser')
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
        /*
         * A closed socket never answers and never errors: without this timer the probe would wait
         * forever and the whole run would hang after a successful boot (R33 hit exactly that).
         */
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectPromise(new Error(`CDP ${method} timed out`))
        }, 20_000)
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer)
            resolvePromise(value)
          },
          reject: (error) => {
            clearTimeout(timer)
            rejectPromise(error)
          },
        })
        socket.send(JSON.stringify({ id, method, params }))
      })
    await new Promise((resolvePromise, rejectPromise) => {
      socket.addEventListener('open', () => resolvePromise(undefined), { once: true })
      socket.addEventListener('error', () => rejectPromise(new Error('cdp socket error')), { once: true })
    })
    await send('Page.enable')
    await send('Network.enable')
    /*
     * LANGUAGE (R51, BS-47): the tab picks its sentences from the Host's locale binding, and the
     * Host follows the browser's language. `--lang en` makes the browser claim English so the en
     * half of the dictionary is actually seen on screen instead of merely existing in the bundle.
     */
    if (uiLang === 'en') {
      await send('Emulation.setLocaleOverride', { locale: 'en-US' }).catch(() => undefined)
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: "Object.defineProperty(navigator, 'language', { get: () => 'en-US' }); Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });",
      })
      await send('Network.setExtraHTTPHeaders', { headers: { 'accept-language': 'en-US,en;q=0.9' } })
    }
    for (const pair of cookie.split(';')) {
      const [name, ...rest] = pair.trim().split('=')
      const value = rest.join('=')
      if (name === '' || value === '') continue
      await send('Network.setCookie', { name, value, url: pageUrl })
    }
    await send('Page.navigate', { url: pageUrl })
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      const value = result?.result?.value
      if (typeof value !== 'string') return value === undefined ? null : value
      try {
        return JSON.parse(value)
      } catch {
        /*
         * R62: a plain string is a reading, not a parse failure. Returning `null` here silently
         * deleted the page-side upgrade probe's answer (`direct: null` in the R61 artifact) — the
         * same "a check that did not run must not look like a result" mistake, in the harness.
         */
        return value
      }
    }
    let marker = null
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await pause(800)
      const value = await evaluate('JSON.stringify(window.__dshTriage || null)')
      if (value !== null && typeof value === 'object') {
        marker = value
        break
      }
    }
    let observed
    if (marker === null) {
      observed = {
        marker: { registered: null, detail: 'the page never published window.__dshTriage (bundle not executed?)' },
        visible: {
          status: 'unmeasured',
          detail: 'the page never published window.__dshTriage, so the settings UI was not probed',
          evidence: { page_url: clean(pageUrl) },
        },
      }
    } else {
      const mount = {
        registered: marker.registered === true,
        slot: typeof marker.slot === 'string' ? marker.slot : null,
        tab_id: typeof marker.id === 'string' ? marker.id : null,
        reason: typeof marker.reason === 'string' ? marker.reason : null,
        detail:
          marker.registered === true
            ? 'the client runner called apply and the settings slot accepted the tab'
            : `refused: ${String(marker.reason)}`,
      }
      observed = { marker: mount, visible: await probeVisibility(evaluate, mount, send).catch((error) => ({
        status: 'unmeasured',
        detail: `the visibility probe failed before it could answer: ${String(error && error.message ? error.message : error)}`,
        evidence: { tab_registered: mount.registered === true },
      })) }
    }
    /*
     * SCREENSHOT (R54): only after the visibility probe finished, because the picture has to show the
     * answer — a settings page screenshot taken before the tab opened would be a picture of an empty
     * shell. Failure to capture is reported, never silently skipped: a missing image is a missing
     * deliverable for the post, not a cosmetic detail.
     */
    let screenshot = null
    if (screenshotTarget !== null) {
      try {
        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
        /*
         * SETTLE THE SCREENSHOT (R54): the setting-up clicks leave a hover menu open — the first
         * real-profile shot had the app's "browse more plugins / create your plugin" menu floating
         * over the sidebar, which reads as a broken UI in a screenshot that is supposed to show a
         * working one. Clicking the tab body (not a control) dismisses the menu; Escape would close
         * the whole settings dialog, and clicking the dialog's top edge did exactly that on the
         * first attempt. The pointer then leaves the sidebar so no hover menu can reopen.
         */
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 250, button: 'left', clickCount: 1 })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 250, button: 'left', clickCount: 1 })
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1200, y: 150 })
        await pause(500)
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        const bytes = Buffer.from(String(shot?.data ?? ''), 'base64')
        if (bytes.length === 0) throw new Error('the browser returned an empty image')
        mkdirSync(dirname(screenshotTarget), { recursive: true })
        writeFileSync(screenshotTarget, bytes)
        screenshot = {
          path: relative(abs('.'), screenshotTarget).split('\\').join('/'),
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        }
      } catch (error) {
        screenshot = { error: String(error && error.message ? error.message : error) }
      }
    }
    // Close only after BOTH questions are answered: the visibility probe drives the same page.
    socket.close()
    return { ...observed, screenshot }
  } finally {
    await killTree(chrome.pid)
  }
}

/**
 * The labels our own tab registers (`client.js`: locale key `tab`), used only to look them up.
 * `--expect-tab-label` overrides them, which is how the negative control proves this assertion can
 * fail: same page, same hops, a label that is deliberately absent (R33).
 */
const TAB_LABELS = (() => {
  const override = argOf('--expect-tab-label', null)
  return override === null ? ['分诊台', 'Triage'] : [String(override)]
})()
/** Names a Host has used for the settings entry, in the two locales it ships. Matched, never assumed. */
const SETTINGS_NAMES = ['settings', '设置', '偏好设置', 'preferences', 'preference']
/** Menus that can hide the settings entry when the chrome does not show it directly. */
const MENU_NAMES = ['更多', 'more', '账号菜单', 'account menu', '账户菜单', 'menu']
/** First-run overlays: dismissed by name, and only when the page says it is one. */
const INTRO_NAMES = ['继续', 'continue', '知道了', 'got it', '开始使用', 'get started', '关闭', 'close']
/**
 * The settings section that OWNS `settings.plugins.tab`. Upstream labels it 内置插件 / "Built-in
 * plugins" — the bare word 插件 is the plugin manager in the app chrome, a different surface.
 */
const PLUGIN_SECTION_NAMES = ['内置插件', 'built-in plugins', '插件', 'plugins']
/**
 * Counts and issue rows are read structurally (R55): the tab renders tables now, so a probe that
 * scrapes one sentence would report a run-on string ("行219有判定184…") and, worse, could not tell
 * a table row from a paragraph. `data-count-label` / `data-count-value` make the pairs explicit;
 * `[data-triage-issues]` rows are counted as `tbody tr` with `li` kept as a fallback for older
 * bundles.
 */
const TAB_PROBE_EXPRESSION = `(() => {
  const el = document.querySelector('[data-triage-tab]')
  if (!el) return JSON.stringify({ present: false })
  const countsEl = el.querySelector('[data-triage-counts]')
  const tone = el.querySelector('[data-triage-tone]')
  const countRows = countsEl ? Array.from(countsEl.querySelectorAll('[data-count-label]')).map((label) => {
    const key = label.getAttribute('data-count-label')
    const value = el.querySelector('[data-count-value="' + key + '"]')
    return { key: key, label: String(label.textContent || '').trim(), value: value ? String(value.textContent || '').trim() : null }
  }) : []
  const countsText = countRows.length > 0
    ? countRows.map((row) => row.label + ' ' + String(row.value)).join(' · ')
    : (countsEl ? String(countsEl.textContent || '') : null)
  const issueRows = el.querySelectorAll('[data-triage-issues] tbody tr').length
  const legacyRows = el.querySelectorAll('[data-triage-issues] li').length
  return JSON.stringify({
    present: true,
    mode: el.getAttribute('data-triage-tab'),
    kind: el.getAttribute('data-triage-kind'),
    tone: tone === null ? null : tone.getAttribute('data-triage-tone'),
    counts_text: countsText,
    count_rows: countRows,
    issues: issueRows + legacyRows,
    copy_fix_buttons: el.querySelectorAll('[data-copy-fix]').length,
    text: String(el.innerText || '').slice(0, 4000),
  })
})()`

/** T-818: click the on-demand upgrade button inside the already-open tab. */
const UPGRADE_CLICK_EXPRESSION = `(() => {
  const button = document.querySelector('[data-triage-action="upgrade"]')
  if (!button) return JSON.stringify({ clicked: false, reason: 'no upgrade button' })
  button.click()
  return JSON.stringify({ clicked: true })
})()`

/**
 * T-818: read the four buckets, or say which *kind* of not-answer is on screen.
 *
 * The view is named, not inferred from "is there an error element": the loading sentence is rendered
 * by the failure view, so `error === true` was true while the answer was still on the wire (R61 read
 * that as "the page fetch is pending"). A stale bundle that still renders `kind="loading"` inside
 * `upgrade-error` is mapped back to `loading` here, so the served 0.3.1 client cannot recreate the bug.
 */
const UPGRADE_PROBE_EXPRESSION = `(() => {
  const answer = document.querySelector('[data-triage-tab="upgrade"]')
  const loading = document.querySelector('[data-triage-tab="upgrade-loading"]')
  const failed = document.querySelector('[data-triage-tab="upgrade-error"]')
  const screen = answer || loading || failed
  if (!screen) return JSON.stringify({ view: null })
  const kind = screen.getAttribute('data-triage-kind')
  const view = answer ? 'answer' : loading ? 'loading' : (kind === 'loading' || kind === 'pending' ? 'loading' : 'error')
  if (view !== 'answer') return JSON.stringify({ view, kind })
  const counts = Array.from(answer.querySelectorAll('[data-upgrade-count]')).map((node) => ({
    bucket: node.getAttribute('data-upgrade-bucket'),
    count: Number(node.getAttribute('data-upgrade-count')),
  }))
  return JSON.stringify({ view, kind, counts, text: String(answer.innerText || '').slice(0, 4000) })
})()`


/**
 * Click into Settings and look for our tab. Three outcomes, and only one of them is a claim:
 * `passed` = the label was in the DOM after the click; `failed` = the settings UI opened and the
 * label was not there; `unmeasured` = the page never offered a settings entry (we report what it did
 * offer instead of inventing a selector).
 */
async function probeVisibility(evaluate, mount, send) {
  const evidence = { tab_registered: mount.registered === true, hops: [] }
  if (mount.registered !== true) {
    return {
      status: 'unmeasured',
      detail: 'the tab never registered, so there is nothing to look for yet (fix mount first)',
      evidence,
    }
  }
  let snapshot = await waitForInteractivePage(evaluate)
  if (snapshot === null) {
    return { status: 'unmeasured', detail: 'the page rendered no controls in time; the settings UI was never reachable', evidence }
  }
  evidence.page_url = clean(snapshot.url)
  evidence.controls_before = controlNames(snapshot).slice(0, 40)
  evidence.text_head = clean(snapshot.text).slice(0, 200)

  /** Click one recorded control, wait for the UI to settle, and hand back the new snapshot. */
  const hop = async (action, control) => {
    const clicked = await evaluate(clickExpression(control.name))
    evidence.hops.push({ action, name: control.name, clicked: clicked?.ok === true })
    await pause(900)
    return (await evaluate(SNAPSHOT_EXPRESSION)) ?? snapshot
  }

  /*
   * A first-run overlay is what a real Host shows here (measured R33): the "preview notice" dialog
   * covered the chrome and no settings entry was among the controls. Dismissing it is part of
   * reaching the settings page — recorded as a hop, never assumed.
   */
  const intro = pickControl(snapshot.controls, INTRO_NAMES)
  if (intro !== null && /预览版|preview|beta|试用/i.test(snapshot.text)) {
    snapshot = await hop('dismiss-intro', intro)
    evidence.intro_dismissed = intro.name
  } else if (/预览版说明|preview notice|欢迎使用/i.test(snapshot.text)) {
    // Say it out loud instead of clicking blindly through an overlay that is still up.
    evidence.intro_still_showing = true
  }

  // Settings: directly when the chrome offers it, otherwise behind one menu (More / account menu).
  let settings = pickControl(snapshot.controls, SETTINGS_NAMES)
  if (settings === null) {
    for (const menuName of MENU_NAMES) {
      const menu = pickControl(snapshot.controls, [menuName])
      if (menu === null) continue
      snapshot = await hop(`open-menu:${menuName}`, menu)
      settings = pickControl(snapshot.controls, SETTINGS_NAMES)
      if (settings !== null) break
    }
  }
  if (settings === null) {
    return {
      status: 'unmeasured',
      detail: 'no settings entry was reachable after dismissing the intro and trying the menus',
      evidence: { ...evidence, controls_after: controlNames(snapshot).slice(0, 60) },
    }
  }
  evidence.settings_entry = settings.name
  snapshot = await hop('open-settings', settings)

  let match = matchTab(snapshot, TAB_LABELS)
  if (match === null) {
    /*
     * Second hop inside settings. The slot's owning section is labelled by ITS OWN dictionary, not by
     * the slot name: upstream registers `settings.section` id `plugins` with label 内置插件 /
     * "Built-in plugins" (verified in its client.js, and measured again here in R33). The chrome
     * button named 插件 opens the plugin MANAGER, a different surface with no `settings.plugins.tab`.
     *
     * R51 (English run): in English BOTH surfaces are labelled "Plugins", and the chrome one comes
     * first in DOM order — so clicking "the first match" opened the manager and the tab was never
     * reachable. Try every candidate in turn and stop at the first one that reveals the tab; a
     * single guess here is exactly the "wrong guess becomes a red light" shape this probe avoids.
     */
    const candidates = []
    let remaining = [...snapshot.controls]
    for (;;) {
      const hit = pickControl(remaining, PLUGIN_SECTION_NAMES)
      if (hit === null) break
      candidates.push(hit)
      remaining = remaining.filter((control) => control !== hit)
    }
    for (const candidate of candidates) {
      snapshot = await hop(`open-plugin-settings-section:${candidate.name}`, candidate)
      match = matchTab(snapshot, TAB_LABELS)
      if (match !== null) {
        evidence.plugin_section = candidate.name
        break
      }
      // Not this one: get back to the settings list before trying the next candidate.
      const back = pickControl(snapshot.controls, SETTINGS_NAMES)
      if (back !== null) snapshot = await hop('back-to-settings', back)
    }
  }
  evidence.controls_after = controlNames(snapshot).slice(0, 60)
  if (match !== null) {
    /*
     * A label is not the same claim as a rendered tab: click the tab we just found and ask the DOM
     * what it rendered. R51 changed the question from "does the body mention a command" to "is this
     * the SUMMARY view, with a counts line filled from the payload" — a tab that renders an error
     * is a different claim from one that renders an answer, and both must be told apart from
     * "nothing rendered at all".
     */
    const tab = pickControl(snapshot.controls, [match])
    let body = 'unmeasured'
    let probe = null
    if (tab !== null) {
      // Time-to-answer: how long a person waits between clicking our tab and reading a conclusion.
      const openedAt = Date.now()
      snapshot = await hop('open-tab', tab)
      // The tab fills in asynchronously; wait until the DOM carries a decided view, or say it never did.
      // `pending` is a real state (the fetch has not answered yet) and must not be read as a verdict.
      // The rule lives in `judgeTabView` (R62): R51 paid for this once, R61 paid again.
      let judged = judgeTabView(null)
      for (let attempt = 0; attempt < 16; attempt += 1) {
        probe = await evaluate(TAB_PROBE_EXPRESSION)
        judged = judgeTabView(probe)
        if (judged.decided) break
        await pause(500)
      }
      evidence.tab_ms = Date.now() - openedAt
      evidence.tab_probe = probe
      evidence.tab_judged = judged
      /*
       * T-818: the upgrade screen is a SECOND question, asked by clicking the on-demand button. The
       * tab must not have read npm before this point; the click is the only thing that does.
       */
      if (judged.state === 'answer') {
        const clicked = await evaluate(UPGRADE_CLICK_EXPRESSION)
        const upgradeStarted = Date.now()
        let upgradeProbe = null
        let upgradeJudged = judgeUpgradeView(null)
        /*
         * The ceiling is the probe's patience (`--upgrade-wait-ms`, 30s by default); the route answers
         * in ~1s on this machine. What matters is the rule at the end — running out of patience is
         * `unmeasured` (we stopped asking), never `failed` (the screen is broken). R61 confused the
         * two by breaking at ~500ms on a screen that answered at ~1000ms.
         */
        for (let attempt = 0; attempt < 200; attempt += 1) {
          upgradeProbe = await evaluate(UPGRADE_PROBE_EXPRESSION)
          upgradeJudged = judgeUpgradeView(upgradeProbe)
          if (upgradeJudged.decided) break
          if (Date.now() - upgradeStarted >= upgradeWaitMs) break
          await pause(500)
        }
        const upgradeWaitedMs = Date.now() - upgradeStarted
        const upgradeMarker = await evaluate('JSON.stringify((window.__dshTriage && window.__dshTriage.upgrade) || null)')
        /*
         * DIAGNOSTIC (T-818): ask the same URL from the PAGE, with the page's own CSP/cookies. If this
         * resolves while the component is still loading, the served client is stale; if it times out,
         * the route is blocking the browser rather than the Node probe.
         *
         * R62: this used to resolve to a bare string, which `evaluate()` fed through `JSON.parse` and
         * turned into `null` — so the one measurement that could answer "is the browser blocked"
         * recorded nothing at all. It returns JSON now, and `evaluate()` no longer swallows strings.
         */
        const directFromPage = await evaluate(`Promise.race([
          fetch('/compat-triage/summary?upgrade=1', { credentials: 'include', headers: { accept: 'application/json' } })
            .then((r) => r.text().then((t) => ({ status: r.status, body: t.slice(0, 160) })))
            .catch((e) => ({ status: null, error: String((e && e.message) || e) })),
          new Promise((r) => setTimeout(() => r({ status: 'timeout' }), 15000)),
        ]).then((value) => JSON.stringify(value))`)
        evidence.upgrade_probe = {
          clicked,
          probe: upgradeProbe,
          judged: upgradeJudged,
          waited_ms: upgradeWaitedMs,
          marker: upgradeMarker,
          direct: directFromPage,
        }
      }
      body = judged.state === 'answer' ? 'passed' : judged.state === 'failed' ? 'degraded' : judged.state
      evidence.tab_body = body
      /*
       * A REAL CLICK ON THE COPY BUTTON (R51, BS-47): the button existing is not the same claim as
       * the clipboard receiving the command. This grants clipboard permission, clicks the button
       * with a real mouse event at its measured centre, and reads the clipboard back — comparing it
       * with the `fix` string the route published for that same row.
       */
      evidence.clipboard = { status: 'unmeasured', detail: 'no copy button rendered (the engine produced no command for these rows)', evidence: {} }
      if (probe !== null && Number(probe.copy_fix_buttons ?? 0) > 0) {
        try {
          const origin = new URL(snapshot.url || 'http://127.0.0.1').origin
          await send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
          await send('Page.bringToFront')
          // Scroll first, measure AFTER the animation settles: measuring during a smooth scroll is
          // how the zh run clicked a coordinate the button had already left (R51).
          await evaluate(`(() => {
            const el = document.querySelector('[data-copy-fix]')
            if (el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
            return JSON.stringify({ ok: el !== null })
          })()`)
          await pause(350)
          const spot = await evaluate(`(() => {
            const el = document.querySelector('[data-copy-fix]')
            if (!el) return JSON.stringify({ ok: false, reason: 'no button' })
            const rect = el.getBoundingClientRect()
            const x = Math.round(rect.left + rect.width / 2)
            const y = Math.round(rect.top + rect.height / 2)
            const hit = document.elementFromPoint(x, y)
            return JSON.stringify({
              ok: true,
              x,
              y,
              id: el.getAttribute('data-copy-fix'),
              on_button: hit !== null && hit.closest('[data-copy-fix]') !== null,
              hit: hit === null ? 'none' : String(hit.tagName),
            })
          })()`)
          if (spot === null || spot.ok !== true) throw new Error('the copy button reported no rectangle')
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spot.x, y: spot.y })
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 })
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 })
          await pause(300)
          // Read what the page itself reported about the write, then read the clipboard back: the
          // two together separate "the button never tried" from "the browser refused".
          let reported = await evaluate(`JSON.stringify((window.__dshTriage && window.__dshTriage.clipboard) || null)`)
          let method = 'mouse'
          if (reported === null) {
            /*
             * A real mouse event that reaches the button but produces no handler call is a hit-test
             * problem we have not explained (zh run, R51: `on_button: true`, no clipboard write).
             * Falling back to the element's own click() answers the question a user actually cares
             * about — "does the button do its job" — and the artifact records WHICH method worked,
             * so nobody can read `dom-click` as "a real click was proven".
             */
            method = 'dom-click'
            await evaluate(`(() => {
              const el = document.querySelector('[data-copy-fix]')
              if (el) el.click()
              return JSON.stringify({ clicked: el !== null })
            })()`)
            await pause(300)
            reported = await evaluate(`JSON.stringify((window.__dshTriage && window.__dshTriage.clipboard) || null)`)
          }
          const expected = await evaluate(`fetch('/compat-triage/summary', { credentials: 'include' }).then((r) => r.json()).then((payload) => {
            const pick = (summary) => (summary && Array.isArray(summary.issues) ? summary.issues.find((issue) => issue && issue.id === ${JSON.stringify(spot.id)}) : null)
            const hit = pick(payload.summary && payload.summary.en) || pick(payload.summary && payload.summary.zh)
            return JSON.stringify({ fix: hit && typeof hit.fix === 'string' ? hit.fix : null })
          }).catch(() => JSON.stringify({ fix: null }))`)
          const clipboard = await evaluate(`navigator.clipboard.readText().then((text) => JSON.stringify({ text })).catch((error) => JSON.stringify({ error: String(error && error.message ? error.message : error) }))`)
          const wanted = expected && typeof expected.fix === 'string' ? expected.fix : null
          const got = clipboard && typeof clipboard.text === 'string' ? clipboard.text : null
          const same = wanted !== null && got !== null && got.trim() === wanted.trim()
          evidence.clipboard = {
            status: wanted === null ? 'unmeasured' : same ? 'passed' : 'failed',
            detail:
              wanted === null
                ? `the route published no fix command for ${spot.id}, so there was nothing to copy`
                : same
                  ? `clicking the copy button put the engine's own command on the clipboard (${wanted})`
                  : `clipboard does not hold the published command (wanted ${JSON.stringify(wanted)}, got ${JSON.stringify(got ?? (clipboard && clipboard.error))})`,
            evidence: { button_id: spot.id, wanted, got, method, on_button: spot.on_button ?? null, page_reported: reported ?? null, clipboard_error: clipboard && clipboard.error ? String(clipboard.error) : null },
          }
        } catch (error) {
          evidence.clipboard = {
            status: 'unmeasured',
            detail: `the clipboard click could not be driven: ${String(error && error.message ? error.message : error)}`,
            evidence: {},
          }
        }
      }
      // The tab also publishes what it showed, so the numbers can be compared with the CLI's.
      let markerAfter = null
      for (let attempt = 0; attempt < 12; attempt += 1) {
        markerAfter = await evaluate('JSON.stringify(window.__dshTriage || null)')
        if (markerAfter !== null && markerAfter.data !== undefined) break
        await pause(400)
      }
      evidence.marker_after_tab = markerAfter
    }
    return {
      /*
       * R62: `pending` used to fall through to `passed` here, and its detail claimed "the summary view"
       * was on screen while the tab was still showing 正在加载诊断数据… — the same overclaim that made
       * R61's artifact unreadable, one step earlier. A wait is `unmeasured`, never `passed`.
       */
      status: body === 'failed' ? 'failed' : body === 'degraded' || body === 'pending' || body === 'loading' ? 'unmeasured' : 'passed',
      detail:
        body === 'failed'
          ? `the tab label ${JSON.stringify(match)} appeared, but clicking it rendered no tab body`
          : body === 'degraded'
            ? `the settings page rendered ${JSON.stringify(match)}, but the tab showed a degraded view (${String(evidence.tab_probe?.kind ?? 'unknown')}) instead of the summary`
            : body === 'pending' || body === 'loading'
              ? describeNoAnswer(String(body), Number(evidence.tab_ms ?? 0))
              : `the settings page rendered ${JSON.stringify(match)} and the summary view (${String(evidence.tab_probe?.tone ?? 'unknown')} · ${String(evidence.tab_probe?.issues ?? 0)} issue(s) shown)`,
      evidence: { ...evidence, tab_match: match },
    }
  }
  return {
    status: 'failed',
    detail: 'the settings page opened but our tab label never appeared in the DOM',
    evidence: { ...evidence, text_head: clean(snapshot.text).slice(0, 400) },
  }
}

/**
 * Wait for a page that actually rendered controls (the SPA paints after the marker is published) AND
 * has stopped changing: R33's second run sampled the shell one frame before the first-run overlay
 * painted, so the intro was never dismissed and every later click landed on a modal.
 */
async function waitForInteractivePage(evaluate) {
  let last = null
  let previousKey = null
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const snapshot = await evaluate(SNAPSHOT_EXPRESSION)
    if (snapshot !== null && Array.isArray(snapshot.controls) && snapshot.controls.length >= 3) {
      const key = `${snapshot.controls.length}|${String(snapshot.text).length}`
      if (key === previousKey) return snapshot
      previousKey = key
      last = snapshot
    }
    await pause(700)
  }
  return last
}

/** Exact match first, then prefix: "Settings" must not be satisfied by "Settings and more" first. */
const pause = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

/** Structure of the page as the probe sees it: address, visible text, and every named control. */
const SNAPSHOT_EXPRESSION = `(() => {
  const normalize = (value) => String(value === null || value === undefined ? '' : value).replace(/\\s+/g, ' ').trim()
  const labelOf = (element) => normalize(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent)
  const nodes = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="button"], [role="menuitem"], [role="option"], [aria-label], [data-testid], [title]'))
  const seen = Object.create(null)
  const controls = []
  for (const element of nodes) {
    const name = labelOf(element).slice(0, 80)
    if (name === '') continue
    const key = element.tagName + '|' + (element.getAttribute('role') || '') + '|' + name
    if (seen[key] === true) continue
    seen[key] = true
    controls.push({ tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || '', name: name })
    if (controls.length >= 120) break
  }
  return JSON.stringify({
    url: String(location.href),
    text: normalize(document.body && document.body.innerText).slice(0, 1200),
    controls: controls,
  })
})()`

/** Click the control whose accessible name is exactly `name` (as recorded by the snapshot). */
const clickExpression = (name) => `(() => {
  const normalize = (value) => String(value === null || value === undefined ? '' : value).replace(/\\s+/g, ' ').trim()
  const labelOf = (element) => normalize(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent)
  const target = ${JSON.stringify(String(name))}
  const nodes = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="button"], [role="menuitem"], [role="option"], [aria-label], [data-testid], [title]'))
  for (const element of nodes) {
    if (labelOf(element) !== target) continue
    element.click()
    return JSON.stringify({ ok: true, tag: element.tagName.toLowerCase() })
  }
  return JSON.stringify({ ok: false })
})()`

/**
 * Run the real CLI against the same sandbox profile and return the numbers it reports.
 * `null` means the CLI itself could not read the profile — an honest `unmeasured`, not a mismatch.
 */
async function readCliAudit(home, profile, env) {
  const cli = pathFor('packages/plugin/dist/cli.js')
  const result = await run(process.execPath, [cli, 'audit', '--json', '--dsh-home', home, '--profile', profile], {
    cwd: abs('.'),
    env,
    timeoutMs: 180_000,
  })
  if (result.code !== 0 && result.code !== 1) {
    // Keep the reason: "the CLI refused" and "the numbers differ" are different findings.
    return { error: { exit: result.code, stderr: clean(result.stderr).slice(-400) } }
  }
  try {
    const payload = JSON.parse(result.stdout)
    // `risky` is counted apart from `blocked` because the summary folds them into one bucket
    // ("will break"), and a fold that happens in two places must be checked in one place.
    const verdicts = { go: 0, blocked: 0, risky: 0, unknown: 0 }
    for (const verdict of Array.isArray(payload.row_verdicts) ? payload.row_verdicts : []) {
      const conclusion = verdict && verdict.conclusion
      if (conclusion === 'go') verdicts.go += 1
      else if (conclusion === 'blocked') verdicts.blocked += 1
      else if (conclusion === 'risky') verdicts.risky += 1
      else verdicts.unknown += 1
    }
    /*
     * TWO DIFFERENT "ROWS" EXIST, AND THE FIRST RUN OF THIS STEPS (R51) CONFUSED THEM:
     *   payload.claims[].entries  — every declared loader row (what `status` calls 行 / rows)
     *   payload.rows              — rows that resolved to a target after composition (a subset)
     * The summary counts the first, because that is the denominator a user expects. Comparing it
     * against the second made a correct tab look like a liar (219 vs 192). Both are reported now.
     */
    const declared = (Array.isArray(payload.claims) ? payload.claims : []).reduce(
      (total, group) => total + (Array.isArray(group?.entries) ? group.entries.length : 0),
      0,
    )
    return {
      rows: Array.isArray(payload.rows) ? payload.rows.length : null,
      declared: declared > 0 ? declared : null,
      judged: Array.isArray(payload.row_verdicts) ? payload.row_verdicts.length : null,
      verdicts,
    }
  } catch {
    return null
  }
}

/** T-818: run the real CLI `upgrade --to <target> --json` against the same sandbox profile. */
async function readCliUpgrade(home, profile, target, env) {
  const cli = pathFor('packages/plugin/dist/cli.js')
  const result = await run(process.execPath, [cli, 'upgrade', '--to', target, '--json', '--dsh-home', home, '--profile', profile], {
    cwd: abs('.'),
    env,
    timeoutMs: 180_000,
  })
  if (result.code !== 0) return { error: { exit: result.code, stderr: clean(result.stderr).slice(-400) } }
  try {
    const payload = JSON.parse(result.stdout)
    const counts = payload.counts ?? payload.impact?.counts ?? null
    if (counts === null) return { error: { parse: 'no counts in the upgrade payload' } }
    return { counts, target: payload.target ?? payload.impact?.target ?? target }
  } catch (error) {
    return { error: { parse: String(error) } }
  }
}

/** Follow the one-shot token 303 into the boot document and keep the cookie for later requests. */
async function fetchPage(base, tokenUrl, cookie = '') {  let current = cookie
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

async function finish(outcome, hostLog = '') {
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
    /** R70: what the machine was doing — the reading R68's tail had no way to explain. */
    conditions: describeConditions({ before: conditionsBefore, after: cpuTimes(), startedAt: runStartedAt, endedAt: new Date().toISOString() }),
    sandbox: { home: clean(home), profile: 'web', bundle: 'file:packages/* (workspace rewritten)' },
    steps,
    // The Host's own words: a route that never mounted or refused must be diagnosable from the artifact.
    host_log: clean(hostLog)
      .replace(/\?token=[A-Za-z0-9._~-]+/g, '?token=<redacted>')
      .split('\n')
      .filter((line) => line.trim() !== '' && !/^\s*Progress:/.test(line))
      .slice(-60),
    limits: [
      'the workspace packages are installed from local directories with their workspace deps rewritten to file: — no registry and no credentials are involved',
      'this proves the Host serves /plugins/dsh-triage/client.js and that the settings page renders the tab label; it does not prove the tab content matches the CLI (that needs a host-side read-only Remote)',
      'the visibility assertion looks for the tab label after opening the settings UI in a headless browser; it is not a visual regression test, and an unmeasured result means the entry was not reachable, not that the tab is missing',
      /*
       * R75 (T-813): `served` and the exit code are the two fields a machine reader will use, and
       * neither says anything about a browser. The Firefox witness run proved why this needs saying:
       * `outcome.served: true` plus exit 0 looked like "Firefox opened the panel" while every
       * browser-side step was `unmeasured`.
       */
      'outcome.served is a HOST fact (the composed asset answered 200, exposed the loader and our id) and says nothing about any browser: with --browser <path>, a browser-side step that is unmeasured means the browser was never successfully asked. The exit code is 0 when served is true and tab_visible is not failed, so exit 0 means "this run finished", not "a browser witnessed the tab"',
      'one sandbox runtime (0.2.1-rc.4) on one Windows machine',
    ],
  }
  const text = `${JSON.stringify(payload, null, 2)}\n`
  mkdirSync(outDir, { recursive: true })
  const target = join(outDir, `${label}-${stamp.replaceAll(':', '-')}.json`)
  writeFileSync(target, text, 'utf8')
  writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')
  const relative = target.replaceAll('\\', '/').split('/data/results/').pop()
  process.stdout.write(`${outcome.served ? 'served' : 'NOT served'} · ${basename(target)} · ${steps.map((step) => `${step.id}:${step.status}`).join(' ')}\n`)
  process.stdout.write(`  ${relative}\n`)
  // `unmeasured` is not a failure (no browser / unreachable settings UI); a tab that registered but
  // never rendered is, because that is exactly the regression this step exists to catch (R33).
  process.exitCode = outcome.served && outcome.tab_visible !== 'failed' ? 0 : 1
}

await main()
