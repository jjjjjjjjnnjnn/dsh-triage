/**
 * Client-render check (M3 / T-302): "HTTP answered" is not "a screen appeared" (BS-03).
 *
 * WHY THIS FILE EXISTS: R14 shipped the probe with `client-rendered: unmeasured` because
 * the executor had no way to look at the page. R15 measured the fact that a headless
 * Chromium can read a real Host's DOM over CDP (see `docs/specs/M3-probe.md` F13–F16), so
 * the assertion becomes measurable instead of staying decorative.
 *
 * WHAT IS JUDGED: whether the page mounted something visible. NOT whether the plugin
 * works, not whether the content is correct, and never whether the code is safe.
 *
 * The browser is optional on purpose: `findBrowser` returns `null` on a machine without
 * one, and the caller must report `unmeasured` rather than pretending a page rendered.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/* ------------------------------- host URL --------------------------------- */

export interface HostUrl {
  /** Full URL including the local session token; never publish this. */
  readonly url: string
  readonly port: number
}

/**
 * The launcher prints exactly one line like
 * `dsh web: http://127.0.0.1:53997/?token=…` (measured, M3-probe F10/F16).
 *
 * The LAST match wins: a Host that restarted prints twice, and the live one is the newer.
 */
export function extractHostUrl(stdout: string): HostUrl | null {
  const pattern = /https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/\?token=[A-Za-z0-9_-]+/g
  let match: RegExpExecArray | null = null
  let last: RegExpExecArray | null = null
  while ((match = pattern.exec(stdout)) !== null) last = match
  if (last === null) return null
  const port = Number(last[1])
  if (!Number.isInteger(port) || port <= 0) return null
  return { url: last[0], port }
}

/* -------------------------------- signals --------------------------------- */

export interface RenderSignals {
  readonly title: string
  readonly readyState: string
  readonly bodyChildren: number
  readonly rootId: string | null
  readonly rootChildren: number
  /** Visible text length after whitespace collapsing. */
  readonly textLength: number
  readonly htmlBytes: number
}

/**
 * 20 characters is deliberately low: a loading spinner with a label already exceeds it,
 * so the threshold separates "mount produced something" from "empty shell", not "good UI".
 */
export const MIN_VISIBLE_TEXT = 20

/**
 * How long to keep looking before accepting whatever the page shows. A mounted-but-still-
 * hydrating app keeps growing; a white screen stays white. Both stop mattering at these
 * limits, which are wall-clock caps, not conclusions.
 */
const BLANK_SETTLE_MS = 3_000
const RENDER_SETTLE_MS = 6_000

export type RenderState = 'rendered' | 'blank' | 'inconclusive'

export interface RenderJudgement {
  readonly state: RenderState
  /** Short machine-ish reason, safe to publish (no URL, no token, no page content). */
  readonly detail: string
}

/**
 * Pure judgement over one DOM observation.
 *
 * `inconclusive` is not a soft pass: it means the observation cannot answer the question
 * (nothing read, or the document was still loading when we stopped).
 */
export function judgeRender(signals: RenderSignals | null): RenderJudgement {
  if (signals === null) return { state: 'inconclusive', detail: 'no DOM observation' }
  if (signals.htmlBytes <= 0) return { state: 'inconclusive', detail: 'the browser read an empty document' }
  if (signals.readyState === 'loading') return { state: 'inconclusive', detail: 'document still loading' }
  const rootOk = signals.rootId === null ? signals.bodyChildren >= 1 : signals.rootChildren >= 1
  const settled = signals.readyState === 'complete' ? '' : `, readyState=${signals.readyState}`
  if (signals.textLength >= MIN_VISIBLE_TEXT && rootOk) {
    return { state: 'rendered', detail: `mount root with ${signals.rootChildren} child(ren), ${signals.textLength} visible chars${settled}` }
  }
  if (signals.textLength === 0) return { state: 'blank', detail: 'no visible text and no mounted children' }
  return {
    state: 'blank',
    detail: rootOk ? `only ${signals.textLength} visible chars` : `mount point "${signals.rootId ?? 'body'}" has no children`,
  }
}

/* -------------------------------- browser --------------------------------- */

export interface BrowserLookup {
  /** Explicit path (CLI `--browser`); used verbatim when it exists. */
  readonly explicit?: string | null
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  /** Injected for tests; defaults to `fs.existsSync`. */
  readonly exists?: (path: string) => boolean
}

/**
 * Find a Chromium-family browser, or `null`.
 *
 * A `null` result is a first-class answer: the artifact then says `unmeasured` with the
 * reason, instead of accusing a plugin because the probe machine has no browser.
 */
export function findBrowser(input: BrowserLookup = {}): string | null {
  const exists = input.exists ?? existsSync
  const explicit = (input.explicit ?? '').trim()
  if (explicit !== '') return exists(explicit) ? explicit : null
  const env = input.env ?? process.env
  const fromEnv = (env['DSH_TRIAGE_BROWSER'] ?? '').trim()
  if (fromEnv !== '') return exists(fromEnv) ? fromEnv : null
  const platform = input.platform ?? process.platform
  const candidates =
    platform === 'win32'
      ? [
          join(env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
          join(env['PROGRAMFILES'] ?? 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
          join(env['PROGRAMFILES'] ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
          join(env['LOCALAPPDATA'] ?? join(homedir(), 'AppData/Local'), 'Google/Chrome/Application/chrome.exe'),
        ]
      : platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return null
}

/* ------------------------------- execution -------------------------------- */

export interface RenderCheck {
  readonly state: RenderState
  readonly detail: string
  readonly ms: number
  readonly signals: RenderSignals | null
}

export interface RenderUrlInput {
  readonly browser: string
  readonly url: string
  /** Directory to keep the throwaway browser profile in. */
  readonly scratchRoot: string
  readonly timeoutMs?: number
  readonly pollMs?: number
  /** Injected for tests: replaces the spawn call. */
  readonly spawnImpl?: typeof spawn
}

const EMPTY_SIGNALS_EXPRESSION = `JSON.stringify({
  title: document.title || '',
  readyState: document.readyState || '',
  bodyChildren: document.body ? document.body.children.length : 0,
  rootId: (() => { const el = document.querySelector('#root, #app'); return el ? el.id : null })(),
  rootChildren: (() => { const el = document.querySelector('#root, #app'); return el ? el.children.length : 0 })(),
  textLength: (document.body && document.body.innerText ? document.body.innerText : '').replace(/\\s+/g, ' ').trim().length,
  htmlBytes: document.documentElement ? document.documentElement.outerHTML.length : 0
})`

/**
 * Launch the browser headless, navigate to `url`, and poll the DOM until it answers.
 *
 * WHY CDP AND NOT `--dump-dom`: measured in R15 — Edge 146 and Chrome 154 on this machine
 * return an empty stdout and hang for the full 60s with `--dump-dom` (and `--screenshot`
 * fails too), while the same binaries answer `Runtime.evaluate` over CDP in ~1s.
 */
export async function renderUrl(input: RenderUrlInput): Promise<RenderCheck> {
  const timeoutMs = input.timeoutMs ?? 15_000
  const pollMs = input.pollMs ?? 300
  const spawnImpl = input.spawnImpl ?? spawn
  mkdirSync(input.scratchRoot, { recursive: true })
  const profileDir = mkdtempSync(join(input.scratchRoot, 'triage-render-'))
  const started = Date.now()
  let child: ReturnType<typeof spawn> | null = null
  let socket: MinimalSocket | null = null
  try {
    child = spawnImpl(
      input.browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--mute-audio',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )
    const cdpPort = await waitForDevToolsPort(profileDir, Math.min(timeoutMs, 20_000))
    if (cdpPort === null) return { state: 'inconclusive', detail: 'the browser never opened a debugging port', ms: Date.now() - started, signals: null }
    const page = await firstPageTarget(cdpPort)
    if (page === null) return { state: 'inconclusive', detail: 'the browser exposed no page target', ms: Date.now() - started, signals: null }

    socket = await connect(page.webSocketDebuggerUrl)
    let id = 0
    const pending = new Map<number, (message: CdpMessage) => void>()
    socket.onMessage((text) => {
      const message = safeParse(text)
      if (message === null) return
      const messageId = typeof message['id'] === 'number' ? message['id'] : null
      if (messageId !== null) {
        const resolve = pending.get(messageId)
        if (resolve !== undefined) {
          pending.delete(messageId)
          resolve(message as CdpMessage)
        }
      }
    })
    const send = (method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> =>
      new Promise((resolve) => {
        const messageId = ++id
        pending.set(messageId, resolve)
        socket?.send(JSON.stringify({ id: messageId, method, params }))
      })

    await send('Page.enable')
    await send('Page.navigate', { url: input.url })

    let signals: RenderSignals | null = null
    let judgement: RenderJudgement = { state: 'inconclusive', detail: 'no observation yet' }
    // Poll until the document has settled. Stopping at the first non-empty paint would
    // report a loading skeleton as "rendered": the first real measurement read 24 chars at
    // readyState=interactive, while the loaded app shows ~320 chars (R15 spike F14).
    while (Date.now() - started < timeoutMs) {
      await delay(pollMs)
      const evaluated = await send('Runtime.evaluate', { expression: EMPTY_SIGNALS_EXPRESSION, returnByValue: true })
      const value = readString(evaluated.result, 'result', 'value')
      if (value === null) continue
      signals = parseSignals(value)
      judgement = judgeRender(signals)
      const elapsed = Date.now() - started
      const parsed = signals
      if (judgement.state === 'rendered' && parsed !== null && parsed.readyState === 'complete') break
      if (judgement.state === 'blank' && elapsed >= BLANK_SETTLE_MS) break
      if (elapsed >= RENDER_SETTLE_MS) break
    }
    if (judgement.state === 'inconclusive' && Date.now() - started >= timeoutMs && signals !== null) {
      judgement = { state: 'inconclusive', detail: `no terminal DOM within ${timeoutMs}ms` }
    }
    return { state: judgement.state, detail: judgement.detail, ms: Date.now() - started, signals }
  } catch (error) {
    return {
      state: 'inconclusive',
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      ms: Date.now() - started,
      signals: null,
    }
  } finally {
    try {
      socket?.close()
    } catch {
      // Already closed.
    }
    if (child !== null) killBrowser(child)
    rmSync(profileDir, { recursive: true, force: true })
  }
}

/** Kill the browser tree: on Windows the launcher keeps helper processes alive. */
export function killBrowser(child: ReturnType<typeof spawn>): void {
  try {
    child.kill()
  } catch {
    // Already gone.
  }
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { encoding: 'utf8' })
  }
}

/* --------------------------------- helpers -------------------------------- */

interface CdpMessage {
  readonly id?: number
  readonly result?: unknown
}

interface MinimalSocket {
  send(data: string): void
  close(): void
  onMessage(listener: (data: string) => void): void
}

interface WebSocketLike {
  send(data: string): void
  close(): void
  addEventListener(type: string, listener: (event: { data?: unknown }) => void, options?: { once?: boolean }): void
}

/**
 * Node 22 ships a global `WebSocket`; the cast keeps this package free of DOM/undici type
 * dependencies (the same reason the gates avoid third-party modules).
 */
async function connect(url: string): Promise<MinimalSocket> {
  const Ctor = (globalThis as unknown as { WebSocket?: new (target: string) => WebSocketLike }).WebSocket
  if (Ctor === undefined) throw new Error('this Node runtime has no global WebSocket')
  const socket = new Ctor(url)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('the CDP socket failed to open')), { once: true })
  })
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    onMessage: (listener) =>
      socket.addEventListener('message', (event) => listener(String(event.data ?? ''))),
  }
}

async function waitForDevToolsPort(profileDir: string, timeoutMs: number): Promise<number | null> {
  const portFile = join(profileDir, 'DevToolsActivePort')
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (existsSync(portFile)) {
      try {
        const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0])
        if (Number.isInteger(port) && port > 0) return port
      } catch {
        // The file can be observed while it is being written; retry.
      }
    }
    await delay(100)
  }
  return null
}

async function firstPageTarget(port: number): Promise<{ webSocketDebuggerUrl: string } | null> {
  try {
    const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>
    const page = list.find((target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string')
    return page === undefined ? null : { webSocketDebuggerUrl: String(page.webSocketDebuggerUrl) }
  } catch {
    return null
  }
}

function parseSignals(value: string): RenderSignals | null {
  const parsed = safeParse(value)
  if (parsed === null) return null
  const text = typeof parsed['textLength'] === 'number' ? parsed['textLength'] : 0
  return {
    title: typeof parsed['title'] === 'string' ? parsed['title'] : '',
    readyState: typeof parsed['readyState'] === 'string' ? parsed['readyState'] : '',
    bodyChildren: typeof parsed['bodyChildren'] === 'number' ? parsed['bodyChildren'] : 0,
    rootId: typeof parsed['rootId'] === 'string' ? parsed['rootId'] : null,
    rootChildren: typeof parsed['rootChildren'] === 'number' ? parsed['rootChildren'] : 0,
    textLength: text,
    htmlBytes: typeof parsed['htmlBytes'] === 'number' ? parsed['htmlBytes'] : 0,
  }
}

function readString(root: unknown, ...path: string[]): string | null {
  let cursor: unknown = root
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return null
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return typeof cursor === 'string' ? cursor : null
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Default scratch root for render profiles (never the repo, never the user's home). */
export function renderScratchRoot(): string {
  return join(tmpdir(), 'dsh-triage-render')
}
