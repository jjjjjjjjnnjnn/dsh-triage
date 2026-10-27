/**
 * Host I/O for the probe: the four side effects, in one place.
 *
 * WHY ONE PLACE: R12/R13 shipped two recorders that each booted the same sandbox Host.
 * They were merged into one helper because two copies of "write overlay → spawn → wait for
 * the sample → kill the tree" drift silently until one of them samples a different moment
 * than the other. The M3 executor would have been the third copy, so the machinery lives
 * here and `scripts/lib/live.mjs` re-exports it.
 *
 * NOTHING HERE JUDGES ANYTHING. Failure is returned as data; `packages/probe/src/exec.ts`
 * decides what it means.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractHostUrl, renderUrl, type HostUrl, type RenderCheck } from './render.js'

/* -------------------------------- overlay --------------------------------- */

export interface ExtraPatchEntry {
  readonly id: string
  readonly name?: string
  readonly disabled?: boolean
}

export interface BootSampleOptions {
  readonly dshMain: string
  readonly dshHome: string
  readonly profile: string
  readonly profileDir: string
  /** Path to the inventory hook that will be copied beside the overlay. */
  readonly hookSource: string
  readonly scratchRoot: string
  readonly config?: Readonly<Record<string, unknown>>
  readonly extraPatch?: readonly ExtraPatchEntry[]
  readonly timeoutMs?: number
  /** Base environment for the child; callers pass a scrubbed one. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
  /**
   * Arguments passed through to the profile's app (they must come after the launcher
   * flags). The probe uses `--port <p> --no-open`: the port makes the readiness check
   * predictable, and `--no-open` stops a probe from launching the user's browser.
   */
  readonly appArgs?: readonly string[]
  /**
   * Port to probe for readiness BEFORE the process tree is killed.
   *
   * This ordering is the whole point: the sample arrives while the Host is alive, and the
   * first version killed it first, so every HTTP check hit a dead port (measured in R14).
   */
  readonly readinessPort?: number
  /** How long to wait for the port after the sample lands. */
  readonly readinessTimeoutMs?: number
  /** Settle time between the sample and the readiness probe, so a binding server is seen. */
  readonly settleMs?: number
  /**
   * Client-render check (T-302). `browser` comes from {@link findBrowser}; when the caller
   * has no browser, it passes `null` and the run reports the reason instead of a verdict.
   *
   * The check must run while the Host is alive — the page is served by this very process.
   */
  readonly render?: {
    readonly browser: string | null
    readonly timeoutMs?: number
  }
}

export interface HostReadiness {
  /**
   * Where the port came from. `host-url` is the launcher's own `dsh web: http://…` line
   * (T-306); `plan-port` is the fallback when that line never appeared.
   */
  readonly source: 'host-url' | 'plan-port'
  readonly port: number
}

export interface HostObservation {
  readonly status: 'sampled' | 'no-sample'
  readonly seconds: number
  readonly log_sha256: string
  readonly first_line: string
  readonly error_tail: string | null
}

export interface BootSampleResult {
  readonly payload: unknown | null
  readonly host: HostObservation
  readonly error: string | null
  /** Readiness measured while the Host was still alive; `null` when not requested. */
  readonly http: { readonly status: number | null; readonly detail: string } | null
  /** Where the readiness port came from (T-306); `null` when readiness was not requested. */
  readonly readiness: HostReadiness | null
  /** Client-render result; `null` when it was skipped (see {@link BootSampleResult.renderSkipped}). */
  readonly render: RenderCheck | null
  /** Why the render check did not run, in publishable words; `null` when it did run. */
  readonly renderSkipped: string | null
}

/**
 * Boot the Host with a one-entry launcher overlay that mounts `hookSource`, wait for the
 * hook to write its sample, then kill the whole process tree.
 */
export async function bootAndSampleHost(options: BootSampleOptions): Promise<BootSampleResult> {
  const {
    dshMain,
    dshHome,
    profile,
    profileDir,
    hookSource,
    scratchRoot,
    config = {},
    extraPatch = [],
    timeoutMs = 180_000,
    env = process.env,
    appArgs = [],
    readinessPort,
    readinessTimeoutMs = 5_000,
    settleMs = 1_000,
  } = options
  mkdirSync(scratchRoot, { recursive: true })
  const probeDir = mkdtempSync(join(scratchRoot, 'triage-live-'))
  const samplePath = join(probeDir, 'sample.json')
  const patchPath = join(probeDir, 'overlay.patch.yml')
  const hookPath = join(probeDir, 'inventory-hook.mjs')
  let child: ChildProcess | null = null
  try {
    copyFileSync(hookSource, hookPath)
    const configLines = [
      `        out: '${samplePath.replaceAll('\\', '/')}'`,
      `        resolveFrom: '${profileDir.replaceAll('\\', '/')}'`,
      `        profile: '${profile}'`,
      ...Object.entries(config).map(([key, value]) => `        ${key}: ${JSON.stringify(value)}`),
    ]
    writeFileSync(
      patchPath,
      [
        '- insert:',
        '    - id: triage-inventory-probe',
        "      name: './inventory-hook.mjs'",
        '      config:',
        ...configLines,
        // Experiment overlays come after the probe so a row the probe targets is already
        // composed when the overlay patches it (the launcher applies them in order).
        ...extraPatch.flatMap((entry) => [
          `- id: ${entry.id}`,
          ...(entry.name === undefined ? [] : [`  name: '${entry.name}'`]),
          ...(entry.disabled === undefined ? [] : [`  disabled: ${entry.disabled}`]),
        ]),
        '',
      ].join('\n'),
      'utf8',
    )

    const started = Date.now()
    child = spawn(process.execPath, [dshMain, '--profile', profile, '--patch', patchPath, ...appArgs], {
      env: { ...env, DSH_HOME: dshHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    while (Date.now() - started < timeoutMs && !existsSync(samplePath)) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    }
    const collected = existsSync(samplePath)
    const seconds = Math.round((Date.now() - started) / 100) / 10
    let http: { status: number | null; detail: string } | null = null
    let readiness: HostReadiness | null = null
    let render: RenderCheck | null = null
    let renderSkipped: string | null = null
    if (collected) {
      // Probe while the Host is alive. A server that binds a moment after the tree
      // settles is normal, so this retries instead of sampling one instant.
      await new Promise((resolveWait) => setTimeout(resolveWait, settleMs))
      // T-306: the launcher prints its own URL with the token. That line is the readiness
      // criterion; `--port` is only a fallback for a Host that never prints one.
      const hostUrl =
        readinessPort === undefined && options.render === undefined ? null : await waitForHostUrl(() => stdout, 3_000)
      const effectivePort = hostUrl?.port ?? readinessPort
      if (effectivePort !== undefined) {
        readiness = { source: hostUrl === null ? 'plan-port' : 'host-url', port: effectivePort }
        const readinessStarted = Date.now()
        for (;;) {
          http = await probeHttp(effectivePort, Math.min(readinessTimeoutMs, 2_000))
          if (http.status !== null) break
          if (Date.now() - readinessStarted >= readinessTimeoutMs) break
          await new Promise((resolveWait) => setTimeout(resolveWait, 500))
        }
      }
      if (options.render !== undefined) {
        if (options.render.browser === null) {
          renderSkipped = 'no Chromium-family browser was found on this machine (pass --browser or DSH_TRIAGE_BROWSER)'
        } else if (hostUrl === null) {
          renderSkipped = 'the Host printed no http://127.0.0.1:<port>/?token=… line, so there was nothing to render'
        } else {
          // Still inside the Host's lifetime: the page is served by this process.
          render = await renderUrl({
            browser: options.render.browser,
            url: hostUrl.url,
            scratchRoot,
            ...(options.render.timeoutMs === undefined ? {} : { timeoutMs: options.render.timeoutMs }),
          })
        }
      }
    }
    killTree(child)
    await new Promise((resolveWait) => setTimeout(resolveWait, 1200))

    const host: HostObservation = {
      status: collected ? 'sampled' : 'no-sample',
      seconds,
      log_sha256: sha256Of(`${stdout}\n${stderr}`),
      first_line: (stderr.trimEnd().split(/\r?\n/)[0] ?? stdout.trimEnd().split(/\r?\n/)[0] ?? '').slice(0, 240),
      // Kept short and only on failure: a blocked boot must explain itself, but a healthy
      // one should not carry a log into a publishable artifact.
      error_tail: collected ? null : stderr.trimEnd().slice(-1500),
    }
    if (!collected) return { payload: null, host, error: 'the hook wrote nothing within the timeout', http, readiness, render, renderSkipped }
    const payload: unknown = JSON.parse(readFileSync(samplePath, 'utf8').replace(/^\uFEFF/, ''))
    return { payload, host, error: null, http, readiness, render, renderSkipped }
  } finally {
    if (child !== null) killTree(child)
    rmSync(probeDir, { recursive: true, force: true })
  }
}

/** On Windows the Host keeps helper processes alive; kill the tree, not the parent. */
export function killTree(child: ChildProcess): void {
  try {
    child.kill()
  } catch {
    // Already gone.
  }
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { encoding: 'utf8' })
  }
}

/** Deterministic digest used in artifacts instead of storing logs. */
export function sha256Of(text: string): string {
  return createHash('sha256').update(String(text)).digest('hex')
}

/** The dsh CLI entry inside an install directory, or '' when it is not there. */
export function dshMainOf(installDir: string): string {
  return installDir === '' ? '' : join(installDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/* --------------------------------- steps ---------------------------------- */

export interface RuntimeReadResult {
  readonly version: string | null
  readonly detail: string
}

/** `dsh --version`; the version string is the only thing we take from it. */
export function readRuntimeVersion(input: { dshMain: string; timeoutMs: number; env: NodeJS.ProcessEnv }): RuntimeReadResult {
  const run = spawnSync(process.execPath, [input.dshMain, '--version'], {
    env: input.env,
    encoding: 'utf8',
    timeout: input.timeoutMs,
    killSignal: 'SIGKILL',
  })
  const text = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  const match = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(text)
  if (run.status !== 0 || match === null) {
    return { version: null, detail: text === '' ? `dsh --version exited ${run.status ?? 'null'}` : text.slice(0, 240) }
  }
  return { version: match[0], detail: match[0] }
}

export interface InstallResult {
  readonly exitCode: number | null
  readonly detail: string
}

/**
 * `dsh plugin --profile <p> add <spec>` forwards to pnpm inside the profile.
 *
 * The candidate is installed into the SANDBOX home only; the caller passes the env, and
 * that env must already be scrubbed (see `scrubbedEnv`).
 */
export function runInstall(input: {
  dshMain: string
  dshHome: string
  profile: string
  candidate: string
  timeoutMs: number
  env: NodeJS.ProcessEnv
}): InstallResult {
  const argv = [input.dshMain, 'plugin', '--profile', input.profile, 'add', input.candidate]
  const run = spawnSync(process.execPath, argv, {
    env: input.env,
    encoding: 'utf8',
    timeout: input.timeoutMs,
    killSignal: 'SIGKILL',
  })
  const text = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  const lastLine = text.split(/\r?\n/).filter((line) => line.trim() !== '').slice(-1)[0] ?? ''
  return { exitCode: run.status, detail: lastLine.slice(0, 240) }
}

export interface HttpProbeResult {
  readonly status: number | null
  readonly detail: string
}

/**
 * Is something listening?
 *
 * `redirect: 'manual'` is not a detail: with a token the first response is a 303 plus
 * `Set-Cookie`, and `fetch` following it turns a healthy Host into a 401 (R12 pitfall).
 */
export async function probeHttp(port: number, timeoutMs: number): Promise<HttpProbeResult> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { status: response.status, detail: `HTTP ${response.status}` }
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return { status: null, detail: detail.slice(0, 240) }
  }
}

/** Poll the captured stdout for the launcher's own URL line (T-306). */
export async function waitForHostUrl(readStdout: () => string, timeoutMs: number): Promise<HostUrl | null> {
  const started = Date.now()
  for (;;) {
    const found = extractHostUrl(readStdout())
    if (found !== null) return found
    if (Date.now() - started >= timeoutMs) return null
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
}

/** Remove the sandbox home and report whether it is really gone. */
export function removeSandbox(directory: string): { removed: boolean; detail: string } {
  try {
    rmSync(directory, { recursive: true, force: true })
  } catch (error) {
    return { removed: false, detail: error instanceof Error ? error.message : String(error) }
  }
  return { removed: !existsSync(directory), detail: directory }
}

/**
 * Environment handed to every sandbox child.
 *
 * Credentials are dropped, not passed through: `PROJECT_RULES.md` 铁律 4 forbids injecting
 * real secrets into a probe sandbox, and a plugin that needs one must be reported as
 * unverified rather than measured with the user's key.
 */
export function scrubbedEnv(base: NodeJS.ProcessEnv, overrides: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (/(API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_AUTH)/i.test(key)) continue
    out[key] = value
  }
  return { ...out, ...overrides }
}
