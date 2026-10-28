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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
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
  /**
   * Readiness window used when the sample itself says the tree was still moving
   * (`settled: false`) or the projection could not be read at all.
   *
   * WHY A SEPARATE WINDOW (R17 / BS-25): "the tree has not finished composing" and "the
   * plugin is broken" used to produce the same `blocked` verdict. A settled tree keeps the
   * 5s budget (unchanged threshold); an unsettled one gets a longer, configurable window
   * that can only ever produce `unknown` (the judge enforces that, not this layer).
   */
  readonly unsettledReadinessMs?: number
  /**
   * How long a first sample may be replaced before we accept it.
   *
   * Cordis re-applies a plugin when its injected services come back, so an `{error}`
   * payload written by a task whose context died can be superseded by a healthy sample
   * from the new apply (measured in R17). We wait for that, bounded.
   */
  readonly sampleReplaceWindowMs?: number
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
  /** Did the window end with an answer? (`served` and `timeout` are facts, not verdicts.) */
  readonly outcome: 'served' | 'timeout'
  /** How long the window actually waited. Recorded so "we waited N s" survives review. */
  readonly waited_ms: number
  /** The budget this run used: settled trees keep 5s, unsettled ones get the long window. */
  readonly window_ms: number
  /** Did the launcher ever print its own `?token=` URL? */
  readonly url_seen: boolean
}

export interface HostObservation {
  readonly status: 'sampled' | 'no-sample'
  readonly seconds: number
  readonly log_sha256: string
  readonly first_line: string
  readonly error_tail: string | null
  /**
   * Did the launcher ever print its own `http://127.0.0.1:<port>/?token=…` line?
   *
   * WHY IT IS A SEPARATE FACT (R17): when the hook writes nothing, "the Host is up and our
   * instrument never ran" and "the Host never came up" produce the same empty file. The URL
   * line is the only evidence that separates them, and only the first is a measurement
   * failure (the second is a real `blocked`).
   */
  readonly url_printed: boolean
  /** Did the launcher declare startup failure? Then no sample will ever arrive (R17). */
  readonly startup_failed: boolean
  /** Ports the Host log says it could not bind (`listen EACCES: … 127.0.0.1:53506`). */
  readonly bind_failed_ports: readonly number[]
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
    unsettledReadinessMs = 20_000,
    sampleReplaceWindowMs = unsettledReadinessMs,
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

    /**
     * Wait for a sample we can actually judge from.
     *
     * A file appearing is not enough (R17): the hook can write `{error}` when its context
     * died mid-compose, and Cordis re-applies the plugin once the services are back — the
     * next apply overwrites the same file with a healthy sample. So we keep the best sample
     * we have and wait, bounded, for a better one instead of freezing the first write.
     */
    let payload: unknown = null
    let sampleText: string | null = null
    let firstSampleAtMs: number | null = null
    let sampleWrittenAtMs: number | null = null
    for (;;) {
      const text = readTextOrNull(samplePath)
      if (text !== null && text !== sampleText) {
        sampleText = text
        payload = parseSample(text)
        firstSampleAtMs ??= Date.now()
        sampleWrittenAtMs = mtimeMsOf(samplePath)
      }
      const accept = isUsableSample(payload) || Date.now() - started >= timeoutMs
      const replacedEnough = firstSampleAtMs !== null && Date.now() - firstSampleAtMs >= sampleReplaceWindowMs
      // `dsh: startup failed: …` is the launcher's own verdict: no sample will follow, and
      // waiting the whole boot timeout for one costs two minutes per broken candidate (R17).
      const startupFailed = `${stdout}\n${stderr}`.includes('startup failed')
      if (accept || replacedEnough || startupFailed) break
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
    const collected = payload !== null
    const seconds = Math.round(((sampleWrittenAtMs ?? Date.now()) - started) / 100) / 10
    let http: { status: number | null; detail: string } | null = null
    let readiness: HostReadiness | null = null
    let render: RenderCheck | null = null
    let renderSkipped: string | null = null
    let hostUrl: HostUrl | null = null
    if (collected) {
      // Probe while the Host is alive. A server that binds a moment after the tree
      // settles is normal, so this retries instead of sampling one instant.
      await new Promise((resolveWait) => setTimeout(resolveWait, settleMs))
      // One window, two sources (R17): the launcher's own token URL and the planned port
      // are polled together, because waiting for the URL first (the R15 order) missed a URL
      // that appeared a moment later and then judged the fallback port.
      const unsettled = !isUsableSample(payload)
      const windowMs = unsettled ? unsettledReadinessMs : readinessTimeoutMs
      if (readinessPort !== undefined || options.render !== undefined) {
        const readinessStarted = Date.now()
        for (;;) {
          if (hostUrl === null) hostUrl = extractHostUrl(stdout)
          const port = hostUrl?.port ?? readinessPort
          if (port !== undefined) {
            http = await probeHttp(port, Math.min(2_000, windowMs))
            if (http.status !== null) break
          }
          if (Date.now() - readinessStarted >= windowMs) break
          await new Promise((resolveWait) => setTimeout(resolveWait, 250))
        }
        const port = hostUrl?.port ?? readinessPort
        if (port !== undefined) {
          readiness = {
            source: hostUrl === null ? 'plan-port' : 'host-url',
            port,
            outcome: http?.status === null || http === null ? 'timeout' : 'served',
            waited_ms: Date.now() - readinessStarted,
            window_ms: windowMs,
            url_seen: hostUrl !== null,
          }
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
            // Keep the throwaway browser profile inside this run's scratch dir, so a killed
            // probe cannot leave a browser profile behind under the shared temp root.
            scratchRoot: probeDir,
            ...(options.render.timeoutMs === undefined ? {} : { timeoutMs: options.render.timeoutMs }),
          })
        }
      }
    }
    killTree(child)
    await new Promise((resolveWait) => setTimeout(resolveWait, 1200))

    const stderrLine = stderr.trimEnd().split(/\r?\n/)[0] ?? ''
    const stdoutLine = stdout.trimEnd().split(/\r?\n/)[0] ?? ''
    const host: HostObservation = {
      status: collected ? 'sampled' : 'no-sample',
      seconds,
      log_sha256: sha256Of(`${stdout}\n${stderr}`),
      // Stderr first, stdout as the real fallback: a healthy `dsh web` prints its URL on
      // stdout, so `?? ` on an always-string value would have hidden it (R15 review finding).
      first_line: sanitizeLogLine(stderrLine !== '' ? stderrLine : stdoutLine).slice(0, 240),
      // Kept short and only on failure: a blocked boot must explain itself, but a healthy
      // one should not carry a log into a publishable artifact. BOTH streams: the launcher
      // prints its own startup diagnostic on stdout (R17).
      error_tail: collected ? null : sanitizeLogLine(`${stdout}\n${stderr}`.trimEnd()).slice(-1500),
      url_printed: extractHostUrl(stdout) !== null,
      startup_failed: `${stdout}\n${stderr}`.includes('startup failed'),
      bind_failed_ports: bindFailedPorts(`${stdout}\n${stderr}`),
    }
    if (!collected) return { payload: null, host, error: 'the hook wrote nothing within the timeout', http, readiness, render, renderSkipped }
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
  /**
   * Registry endpoints the package manager actually tried when the install failed.
   *
   * WHY: T-305b's whole point is "name the source". The launcher only prints the path of a
   * diagnostics log, so the endpoint lives inside that file. We extract URLs, strip
   * credentials/query/fragment, and publish at most a few — never the log itself.
   */
  readonly endpoints?: readonly string[]
  /** The package manager's own reason, when it said one (T-310). */
  readonly diagnosis: InstallDiagnosis
  /**
   * Did pnpm report sending an authorization header? (R20)
   *
   * WHY THIS IS A FIELD AND NOT A COMMENT: the sandbox inherits `$HOME`, so pnpm reads the
   * operator's `~/.npmrc` and — measured 2/2 with a 404 — sends their token to the registry.
   * {@link sandboxNpmEnv} redirects the user config into the sandbox, and this flag makes the
   * fix visible in every artifact instead of being a claim in a doc.
   */
  readonly authUsed: boolean
}

/**
 * Environment for a child that may run pnpm, with the operator's npm user config redirected.
 *
 * WHY: `scrubbedEnv` drops secret-looking env vars, but credentials also live in `~/.npmrc`,
 * which pnpm reads on its own. Measured in R20: a failing install printed
 * `An authorization header was used: Bearer npm_[hidden]` until `npm_config_userconfig`
 * pointed at an empty file inside the sandbox. We do not read that file (铁律 4) — we simply
 * stop inheriting it.
 *
 * The PROFILE's own `.npmrc` is untouched, so T-305b (a profile-level registry that must be
 * unreachable) still works: pnpm reads project config separately from user config.
 */
export function sandboxNpmEnv(env: NodeJS.ProcessEnv, dshHome: string): NodeJS.ProcessEnv {
  const userconfig = join(dshHome, 'probe-user-npmrc')
  try {
    if (!existsSync(userconfig)) writeFileSync(userconfig, '', 'utf8')
  } catch {
    // If the sandbox cannot take the file, the env still points at a path that will not
    // resolve — pnpm then behaves as "no user config", which is the safe side of this.
  }
  // Both spellings on purpose: pnpm reads the lower-case one, npm-compatible tools the upper.
  return { ...env, npm_config_userconfig: userconfig, NPM_CONFIG_USERCONFIG: userconfig }
}

/**
 * What the package manager said, not just that it said no (T-310).
 *
 * WHY THIS IS NOT `detail`: `detail` is the launcher's last line
 * (`dsh: plugin command failed; diagnostics: …`), which carries no cause at all. Measured in
 * R19: the diagnostics log for a pnpm failure contains exactly one line
 * (`Command failed with exit code 1: pnpm add …`), while the real code
 * (`ERR_PNPM_IGNORED_BUILDS`) is printed on the launcher's **stderr**. So the extraction
 * reads both, prefers the launcher, and says which one it used.
 */
export interface InstallDiagnosis {
  /** `ERR_PNPM_*` (or any `ERR_*`) code, or `null` when the output carries none. */
  readonly code: string | null
  /** One sanitised line that explains the failure, or `null` when there was nothing to read. */
  readonly key_line: string | null
  /** Where the reading came from — a claim about provenance, not a guess. */
  readonly source: 'launcher' | 'diagnostics-log' | 'none'
}

const ERROR_CODE = /\bERR_[A-Z0-9_]{2,}\b/

/** One line of package-manager output, stripped of decoration, URLs' secrets and length. */
export function sanitizeDiagnosisLine(line: string): string {
  const stripped = line
    // ANSI colour, then the box-drawing/arrow prefixes pnpm puts on `×`/`╰─▶` lines.
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/^[\s>×✖✗╰├│└─▶›—·•]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
  // A private registry URL can carry credentials in the userinfo part …
  const noUserInfo = stripped.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1')
  // … or a token in the query string. Neither ever belongs in an artifact.
  const noQuery = noUserInfo.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1')
  return sanitizeLogLine(noQuery).slice(0, 240)
}

/** Does this line say anything beyond its label? (`Error:` alone does not.) */
function substantive(text: string): boolean {
  return text.replace(/[^A-Za-z0-9]/g, '').length >= 8
}

/**
 * The line that explains `code`.
 *
 * pnpm splits a failure across lines: `Error: ERR_PNPM_IGNORED_BUILDS` names the code, and
 * the very next lines carry the cause (`Ignored build scripts: …`). Publishing only the code
 * line would leave the reader with the same dead end as an exit code (R19 measured this).
 * So: use the code line when it explains itself, otherwise the first explanatory line below
 * it — never the harness's own `dsh: …` line and never a `help:`/`hint:` line, which are
 * pointers, not causes.
 */
function explanationFor(text: string, code: string): string | null {
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((line) => line.includes(code))
  if (index === -1) return null
  const raw = lines[index]
  if (raw === undefined) return null
  const codeLine = sanitizeDiagnosisLine(raw)
  if (substantive(codeLine.replace(code, ''))) return codeLine
  for (const line of lines.slice(index + 1, index + 9)) {
    const clean = sanitizeDiagnosisLine(line)
    if (clean === '') continue
    // `dsh: plugin command failed; diagnostics: <path>` is the launcher talking about itself:
    // it names no cause, and taking it would hide the package manager's own sentence (R19:
    // the missing-package run published exactly that line before this filter existed).
    if (/^dsh:/i.test(clean)) continue
    if (/^(help|hint|note|usage)\s*:/i.test(clean)) continue
    // Either pnpm's `label: detail` shape, or a plain sentence worth reading.
    if (/^[a-z][a-z ]{0,24}:\s*\S/i.test(clean) || clean.replace(/[^A-Za-z0-9]/g, '').length >= 20) return clean
  }
  return codeLine === '' ? null : codeLine
}

/** First line that reads like an error, else the first line that says anything at all. */
function firstErrorLine(text: string): string | null {
  const lines = text.split(/\r?\n/).map(sanitizeDiagnosisLine).filter((line) => line !== '')
  const loud = lines.find((line) => /\b(error|failed|cannot|unable|refused|denied|ignored)\b/i.test(line))
  return loud ?? lines[0] ?? null
}

/**
 * Pure core of {@link installDiagnosis}: no filesystem, so every rule is testable.
 *
 * Order matters and is measured, not assumed: the launcher's own output wins, because the
 * diagnostics log is a *summary* that drops the code (R19 fact F34).
 */
export function diagnosisFromText(input: { launcher: string; log?: string | null }): InstallDiagnosis {
  const launcher = input.launcher
  const log = input.log ?? null
  const launcherCode = ERROR_CODE.exec(launcher)?.[0] ?? null
  const logCode = log === null ? null : (ERROR_CODE.exec(log)?.[0] ?? null)
  const code = launcherCode ?? logCode
  if (code !== null) {
    const fromLauncher = launcherCode !== null
    const text = fromLauncher ? launcher : (log ?? '')
    return {
      code,
      key_line: explanationFor(text, code) ?? firstErrorLine(text),
      source: fromLauncher ? 'launcher' : 'diagnostics-log',
    }
  }
  const keyLine = firstErrorLine(launcher) ?? (log === null ? null : firstErrorLine(log))
  return {
    code: null,
    key_line: keyLine,
    source: keyLine === null ? 'none' : log !== null && firstErrorLine(launcher) === null ? 'diagnostics-log' : 'launcher',
  }
}

/**
 * Extract the failure reason from a launcher run, reading its diagnostics log when named.
 *
 * The log is capped at 64KB and read through the same guard as {@link failureEndpoints}: a
 * missing log is normal (the install may fail before one is written).
 */
export function installDiagnosis(output: string): InstallDiagnosis {
  const named = /diagnostics:\s*(.+?\.log)/.exec(output)?.[1]
  let log: string | null = null
  if (named !== undefined) {
    try {
      log = readFileSync(named.trim(), 'utf8').slice(0, 64 * 1024)
    } catch {
      log = null
    }
  }
  return diagnosisFromText({ launcher: output, log })
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
    // R20: the operator's `~/.npmrc` must not travel into the sandbox (see `sandboxNpmEnv`).
    env: sandboxNpmEnv(input.env, input.dshHome),
    encoding: 'utf8',
    timeout: input.timeoutMs,
    killSignal: 'SIGKILL',
  })
  const text = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  const lastLine = text.split(/\r?\n/).filter((line) => line.trim() !== '').slice(-1)[0] ?? ''
  return {
    exitCode: run.status,
    detail: lastLine.slice(0, 240),
    endpoints: failureEndpoints(text),
    // T-310: the launcher's last line names no cause; this is the line that does. A passing
    // install has nothing to diagnose — publishing "Already up to date" as a diagnosis would
    // make a healthy run look like a failed one.
    diagnosis:
      run.status === 0 ? { code: null, key_line: null, source: 'none' } : installDiagnosis(text),
    authUsed: /authorization header was used/i.test(text),
  }
}

/**
 * Endpoints named by a failed install, taken from the diagnostics log when the launcher
 * points at one. Pure and exported so the sanitising rules are testable without a sandbox.
 */
export function failureEndpoints(output: string): readonly string[] {
  const diagnostics = /diagnostics:\s*(.+?\.log)/.exec(output)?.[1]
  let text = output
  if (diagnostics !== undefined) {
    try {
      text = `${text}\n${readFileSync(diagnostics.trim(), 'utf8').slice(0, 64 * 1024)}`
    } catch {
      // The log is optional; the output itself may still carry the URL.
    }
  }
  const found = new Set<string>()
  for (const match of text.matchAll(/https?:\/\/[^\s'"<>)\]]+/g)) {
    // pnpm writes `http://host/pkg: error …`; trailing punctuation is not part of the URL.
    const raw = match[0].replace(/[.,;:]+$/, '')
    try {
      const url = new URL(raw)
      // Strip credentials, query and fragment: a private registry URL can carry a token.
      url.username = ''
      url.password = ''
      url.search = ''
      url.hash = ''
      found.add(url.toString())
    } catch {
      // Not a URL we can parse; do not publish a half-redacted string.
    }
    if (found.size >= 5) break
  }
  return [...found]
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

/**
 * Strip the launcher's token before any log line can reach an artifact.
 *
 * `dsh web: http://127.0.0.1:53052/?token=…` is the one line we want to keep for diagnosis,
 * and it is also the one line that must never be published. F-2 (R16) taught us that a
 * single unredacted field is enough to leak; this is that field.
 */
export function sanitizeLogLine(line: string): string {
  return line.replace(/([?&]token=)[^\s"'&]+/gi, '$1<redacted>')
}

/**
 * Ports named by a bind failure in the Host log.
 *
 * WHY: on this machine `netsh int ipv4 show excludedportrange protocol=tcp` lists
 * 53461–53560, and the plan's deterministic port landed on **53506**, so the Host's own
 * `webserver` row died with `listen EACCES`. That failure has nothing to do with the
 * candidate, and the judge needs the port number to say so (R17).
 */
export function bindFailedPorts(log: string): readonly number[] {
  const found = new Set<number>()
  for (const match of log.matchAll(/listen (?:EACCES|EADDRINUSE|EADDRNOTAVAIL|EAFNOSUPPORT)[^\n]*?:(\d{2,5})\b/g)) {
    const port = Number(match[1])
    if (Number.isInteger(port) && port > 0 && port <= 65_535) found.add(port)
  }
  return [...found].sort((left, right) => left - right)
}

/**
 * A port the OS is willing to hand out right now.
 *
 * The deterministic `basePort` in the plan is a *preference*: Windows excludes ranges
 * dynamically (Hyper-V/WSL reservations change during a session), so a hash-picked port can
 * be unbindable while a neighbouring one is fine. Binding :0 asks the OS for one it will
 * actually allow. The port is released immediately; a Host that boots a second later can
 * still lose the race, which is why the judge also recognises a bind failure on our port.
 */
export function findFreePort(): Promise<number | null> {
  return new Promise((resolvePort) => {
    const server = createServer()
    let settled = false
    const done = (port: number | null): void => {
      if (settled) return
      settled = true
      try {
        server.close()
      } catch {
        // Nothing to close.
      }
      resolvePort(port)
    }
    server.once('error', () => done(null))
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done(address !== null && typeof address === 'object' ? address.port : null)
    })
  })
}

/** Read the sample file, or `null` when it is not there (yet). BOM stripped: PowerShell writes one. */
function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  } catch {
    return null
  }
}

/** Write time of the sample, used as the honest "spawn → sample" instant (not "when we polled"). */
function mtimeMsOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

function parseSample(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Unparseable is a measurement failure, not "zero rows": keep it shaped like the hook's
    // own error payload so one code path reports both.
    return { error: { code: 'unparseable', message: 'the sample file is not valid JSON' } }
  }
}

/**
 * Can a verdict rest on this sample?
 *
 * `{error}` means the hook could not read the tree (e.g. `inactive context` while the Host
 * was still composing) and `settled: false` means rows were still moving when it gave up.
 * Both are measurement failures: the executor must report `unknown`, never `blocked`.
 */
export function isUsableSample(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false
  const record = payload as Record<string, unknown>
  if (record['error'] !== undefined && record['error'] !== null) return false
  return record['settled'] !== false
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
