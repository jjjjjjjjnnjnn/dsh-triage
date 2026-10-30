/**
 * `dsh-triage serve` — the local panel (M4 / `docs/specs/M4-surface.md` §2).
 *
 * WHAT IT IS (R49): the first screen is the answer — is this profile broken, which row, what
 * do I type. `GET /api/summary` carries that projection; the ledger and the `data/results`
 * artifacts live behind two tabs. Before R49 the first screen was a table of artifact names,
 * which is the repo's evidence discipline, not the user's question.
 *
 * It deliberately does NOT re-judge anything: `summary` is built by the same module the CLI
 * uses, from the same `loadAuditData()` object. A panel that invented conclusions would be a
 * second engine with its own drift.
 *
 * WHY ZERO DEPENDENCIES: same discipline as the gates (`docs/adr/0003`). A panel that
 * needs a build step or a framework is a panel that breaks when someone reinstalls.
 *
 * SAFETY (all enforced here, not in the UI):
 * - binds 127.0.0.1 only;
 * - a random token is required on every request (query once, then a cookie);
 * - `POST` is refused unless the caller started the process with `--allow-execute`, and
 *   even then this version only answers 501 — running a probe from a browser is a later
 *   step, not a happy accident;
 * - artifact names are validated and served from a listing (no path traversal);
 * - every value the page renders is escaped; the page ships no remote assets (CSP below).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { ProfileSummary } from './summary.js'

export interface ServeOptions {
  /** Directory holding `*.json` + `.sha256` evidence files. */
  readonly resultsDir: string
  /** Bind address; defaults to 127.0.0.1 and is not meant to be changed. */
  readonly host?: string
  /** 0 picks a free port (tests use this). */
  readonly port?: number
  /** Locale for the tiny bit of chrome copy on the page. */
  readonly locale?: 'en' | 'zh'
  /** Reserved for M4-a: allow `POST /api/probe` to actually run a probe. */
  readonly allowExecute?: boolean
  /**
   * T-406: the current composition, as the `audit` engine sees it.
   *
   * Injected rather than imported on purpose: the panel stays a *display* layer, and
   * "which home, which profile, which stamp" is the CLI's decision, not the server's.
   * `null`/absent means `/api/summary` and `/api/audit` answer **501** — never a 200 with an
   * empty list, because "not enabled" and "nothing to report" must not look alike.
   */
  readonly audit?: (() => Promise<AuditSnapshot>) | null
}

/**
 * One `audit` run, in the shapes the panel displays.
 *
 * `payload` is the exact object `dsh-triage audit --json` prints. `summary` is the projection
 * the CLI's first screen prints. Both come from the *same* `loadAuditData()` call — a caller
 * that supplies only one of them would let the panel and the CLI disagree, so both are
 * required (T-406's acceptance rule, R49).
 */
export type AuditSnapshot =
  | {
      readonly ok: true
      readonly payload: Record<string, unknown>
      readonly summary: ProfileSummary
    }
  | { readonly ok: false; readonly message: string }

export interface ArtifactSummary {
  readonly name: string
  readonly kind: string
  readonly generated_at: string | null
  readonly conclusion: string | null
  readonly subject: string | null
  readonly sha256: string | null
  readonly bytes: number
}

export interface PanelServer {
  readonly server: Server
  readonly token: string
  /** URL a human can open; includes the one-time token. */
  readonly url: string
  readonly port: number
}

const TOKEN_COOKIE = 'triage_token'
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024

/* -------------------------------- artifacts -------------------------------- */

/** Map a file name to the small vocabulary the panel understands. */
export function artifactKind(name: string): string {
  const base = name.replace(/\.json$/, '')
  const prefix = base.split('-')[0] ?? ''
  return prefix === '' ? 'artifact' : prefix
}

/**
 * Read one artifact's headline fields WITHOUT trusting its shape.
 *
 * Every field is optional: an artifact that predates a schema still shows up as a row
 * instead of crashing the panel (the SSOT is append-only, so old shapes stay forever).
 */
export function summarizeArtifact(resultsDir: string, name: string): ArtifactSummary {
  const path = join(resultsDir, name)
  let bytes = 0
  try {
    bytes = statSync(path).size
  } catch {
    bytes = 0
  }
  let payload: Record<string, unknown> | null = null
  try {
    // Same 2MB ceiling as the detail route: a stray multi-hundred-MB file in the results
    // directory must not be read into memory just because the listing refreshed.
    if (bytes <= MAX_ARTIFACT_BYTES) {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
      payload = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
    }
  } catch {
    payload = null
  }
  // Recorders name their outcome differently: `passed` (smoke/card), `ok` (gates),
  // `expectation_met` (cases). Reading only one of them made two thirds of the listing say
  // "no conclusion" for artifacts that do state one.
  const flag = ['passed', 'ok', 'expectation_met']
    .map((key) => payload?.[key])
    .find((value) => typeof value === 'boolean')
  const conclusion =
    readString(payload, ['conclusion']) ??
    (typeof flag === 'boolean' ? (flag ? 'passed' : 'failed') : null) ??
    readString(payload, ['judged', 'state']) ??
    readString(payload, ['render', 'status']) ??
    readString(payload, ['render', 'state'])
  const subject =
    readString(payload, ['candidate', 'package']) ??
    readString(payload, ['subject', 'name']) ??
    readString(payload, ['sample', 'kind'])
  return {
    name,
    kind: artifactKind(name),
    generated_at: readString(payload, ['generated_at']),
    conclusion,
    subject,
    sha256: readSha256File(`${path}.sha256`),
    bytes,
  }
}

/** Every `*.json` in the results directory, newest first. Read-only by construction. */
export function listArtifacts(resultsDir: string): ArtifactSummary[] {
  if (!existsSync(resultsDir)) return []
  return readdirSync(resultsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 500)
    .map((name) => summarizeArtifact(resultsDir, name))
}

function readSha256File(path: string): string | null {
  try {
    const text = readFileSync(path, 'utf8').trim()
    return /^[0-9a-f]{64}$/.test(text) ? text : null
  } catch {
    return null
  }
}

/**
 * Resolve an artifact name to a real path inside `resultsDir`, or `null`.
 *
 * The name regex already refuses separators and `..`; this is the second lock. A symlink or
 * NTFS junction planted inside the results directory must not become a read anywhere else on
 * disk, and a file over the 2MB ceiling is refused before it is opened.
 */
export function resolveArtifact(resultsDir: string, name: string): string | null {
  const path = join(resultsDir, name)
  try {
    if (!existsSync(path) || statSync(path).size > MAX_ARTIFACT_BYTES) return null
    const root = realpathSync(resultsDir)
    const real = realpathSync(path)
    const rel = relative(root, real)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
    return real
  } catch {
    return null
  }
}

function readString(value: Record<string, unknown> | null, path: readonly string[]): string | null {
  let cursor: unknown = value
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return null
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return typeof cursor === 'string' && cursor !== '' ? cursor : null
}

/** The four fields the first screen prints above the verdict. Never the profile directory. */
export interface EnvHeadline {
  readonly dsh: string | null
  readonly profile: string | null
  readonly platform: string | null
  readonly arch: string | null
}

function readEnvHeadline(payload: Record<string, unknown>): EnvHeadline {
  const env = typeof payload['env'] === 'object' && payload['env'] !== null ? (payload['env'] as Record<string, unknown>) : null
  return {
    dsh: readString(env, ['dsh']),
    profile: readString(env, ['profile']),
    platform: readString(env, ['platform']),
    arch: readString(env, ['arch']),
  }
}

/* --------------------------------- server ---------------------------------- */

export function createPanelServer(options: ServeOptions): PanelServer {
  const token = randomBytes(18).toString('base64url')
  const allowExecute = options.allowExecute === true
  const context: HandlerContext = {
    resultsDir: options.resultsDir,
    token,
    allowExecute,
    locale: options.locale ?? 'zh',
    // One scan at a time: a profile read is fs-bound and synchronous, so ten tabs refreshing
    // together would otherwise queue ten full scans on the event loop. Concurrent callers
    // share the in-flight scan; the next request after it settles starts a fresh one (no TTL,
    // no stale verdict).
    audit: options.audit == null ? null : singleFlight(options.audit),
  }

  const server = createServer((request, response) => {
    // `handle` is async since T-406 (the audit route reads a profile); a rejected promise
    // must become a 500, not an unhandled rejection that kills the panel.
    handle(request, response, context).catch((error: unknown) => {
      if (response.headersSent) {
        response.end()
        return
      }
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })

  // Port 0 is resolved on listen; the URL is filled in by `startPanel`.
  return { server, token, url: '', port: options.port ?? 0 }
}

export async function startPanel(options: ServeOptions): Promise<PanelServer> {
  const panel = createPanelServer(options)
  await new Promise<void>((resolve, reject) => {
    panel.server.once('error', reject)
    panel.server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve())
  })
  const address = panel.server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { ...panel, port, url: `http://127.0.0.1:${port}/?token=${panel.token}` }
}

interface HandlerContext {
  readonly resultsDir: string
  readonly token: string
  readonly allowExecute: boolean
  readonly locale: 'en' | 'zh'
  readonly audit: (() => Promise<AuditSnapshot>) | null
}

async function handle(request: IncomingMessage, response: ServerResponse, context: HandlerContext): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')

  // A panel that answers a browser on any other origin is a CSRF gadget; refuse loudly.
  const origin = request.headers.origin
  if (typeof origin === 'string' && origin !== '' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    sendJson(response, 403, { error: 'cross-origin request refused' })
    return
  }

  const presented = url.searchParams.get('token') ?? readCookie(request.headers.cookie, TOKEN_COOKIE)
  if (!sameToken(presented, context.token)) {
    sendJson(response, 401, { error: 'missing or invalid token; open the URL printed by `dsh-triage serve`' })
    return
  }

  if (request.method === 'POST') {
    // Running a probe from a browser is a deliberate later step (`--allow-execute` is only
    // the gate, the action itself is not implemented yet). Never a silent 200.
    sendJson(response, context.allowExecute ? 501 : 403, {
      error: context.allowExecute
        ? 'running a probe from the panel is not implemented yet; use `dsh-triage probe --execute`'
        : 'the panel is read-only; restart it with --allow-execute to enable actions',
    })
    return
  }
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: `method ${request.method ?? 'unknown'} not allowed` })
    return
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      // No remote assets: the panel has to work offline and on a locked-down machine.
      // `connect-src 'self'` is load-bearing: without it `default-src 'none'` also blocks the
      // page's own `fetch()` calls, and the panel renders an empty shell (found by actually
      // opening it in a browser, R49 — the smoke script had never used one).
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; connect-src 'self'",
      'cache-control': 'no-store',
      'set-cookie': `${TOKEN_COOKIE}=${context.token}; HttpOnly; SameSite=Strict; Path=/`,
    })
    response.end(renderPanelHtml(context.locale))
    return
  }

  if (url.pathname === '/api/artifacts') {
    const artifacts = listArtifacts(context.resultsDir)
    sendJson(response, 200, {
      resultsDir: context.resultsDir,
      readOnly: !context.allowExecute,
      count: artifacts.length,
      byKind: artifacts.reduce<Record<string, number>>((out, item) => {
        out[item.kind] = (out[item.kind] ?? 0) + 1
        return out
      }, {}),
      artifacts,
    })
    return
  }

  if (url.pathname === '/api/artifact') {
    const name = url.searchParams.get('name') ?? ''
    // Names come from a listing, and the shape is checked before touching the disk: no
    // separators, no `..`, no absolute paths, `.json` only.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(name) || name.includes('..')) {
      sendJson(response, 400, { error: 'artifact name must be a plain *.json file name' })
      return
    }
    const path = resolveArtifact(context.resultsDir, name)
    if (path === null) {
      sendJson(response, 404, { error: 'artifact not found, larger than 2MB, or outside the results directory' })
      return
    }
    let payload: unknown
    try {
      payload = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
    } catch {
      sendJson(response, 422, { error: 'artifact is not valid JSON' })
      return
    }
    sendJson(response, 200, { name, sha256: readSha256File(`${path}.sha256`), payload })
    return
  }

  if (url.pathname === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      readOnly: !context.allowExecute,
      resultsDir: context.resultsDir,
      audit: context.audit !== null,
    })
    return
  }

  if (url.pathname === '/api/summary') {
    if (context.audit === null) {
      // The panel was started with `--no-audit`. Say which switch brings it back; never
      // render "0 rows" for a profile nobody read.
      sendJson(response, 501, { error: 'the panel was started with --no-audit; drop the flag to read the current profile' })
      return
    }
    const started = Date.now()
    const snapshot = await context.audit()
    const ms = Date.now() - started
    if (!snapshot.ok) {
      sendJson(response, 409, { error: snapshot.message }, { 'x-triage-audit-ms': String(ms) })
      return
    }
    // One scan, two shapes: the answer and the env it was measured on. The page renders the
    // answer; `env` is here so the first screen can say *which* profile it is talking about.
    sendJson(
      response,
      200,
      { summary: snapshot.summary, env: readEnvHeadline(snapshot.payload), ms },
      { 'x-triage-audit-ms': String(ms) },
    )
    return
  }

  if (url.pathname === '/api/audit') {
    if (context.audit === null) {
      // 501, not 200 with an empty ledger: "the route is off" is information the user needs.
      sendJson(response, 501, { error: 'audit is off (the panel was started with --no-audit); drop the flag to read the current profile' })
      return
    }
    // Measured 2026-10-28 on a 156-row real profile: 376–690ms, synchronously (the scan is
    // fs-bound and runs on the server's event loop, so one request blocks the panel for its
    // duration). Publishing the number on the response is the difference between "the panel
    // felt slow" and "this request took 412ms" (R20 follow-up to T-406).
    const started = Date.now()
    const snapshot = await context.audit()
    const ms = Date.now() - started
    if (!snapshot.ok) {
      // Same sentence the CLI would print on stderr, and a status that is not 200: a profile
      // that cannot be read must never render as "no findings".
      sendJson(response, 409, { error: snapshot.message }, { 'x-triage-audit-ms': String(ms) })
      return
    }
    sendJson(response, 200, snapshot.payload, { 'x-triage-audit-ms': String(ms) })
    return
  }

  sendJson(response, 404, { error: `no route ${url.pathname}` })
}

/* --------------------------------- helpers --------------------------------- */

/**
 * Share one in-flight scan between concurrent requests.
 *
 * Deliberately has no TTL: once the scan settles the next caller re-reads the profile, so the
 * panel never shows a verdict older than the last click. This only prevents *pile-up*, not
 * staleness.
 */
function singleFlight(run: () => Promise<AuditSnapshot>): () => Promise<AuditSnapshot> {
  let inFlight: Promise<AuditSnapshot> | null = null
  return () => {
    if (inFlight !== null) return inFlight
    const started = run()
    inFlight = started
    const clear = (): void => {
      inFlight = null
    }
    started.then(clear, clear)
    return started
  }
}

function sameToken(presented: string | null, expected: string): boolean {
  if (presented === null) return false
  const left = Buffer.from(presented)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=') || null
  }
  return null
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = `${JSON.stringify(body, null, 2)}\n`
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  response.end(text)
}

/** Deterministic digest helper used by the smoke recorder. */
export function sha256OfText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * The page (R50): three layers, nothing else.
 *
 *   status  — one sentence and one number, the width of the text, no boxes;
 *   issues  — the rows that need a decision, one line each;
 *   commands — the exact strings to type, one click each.
 *
 * Everything the answer rests on (the artifact ledger and the raw `audit --json`
 * payload) stays one Tab away instead of competing with it. The detail level is a real
 * switch, not a matter of taste: `simple` hides the ledger entirely and says every issue
 * in everyday words; `advanced` keeps the ledger, the six counters and audit's own wording.
 *
 * No framework, no remote assets, no inline event handlers: everything is built from the two
 * JSON routes and escaped on the way in (see `esc` below). `data-copy` buttons carry the exact
 * command text, so "what do I type" is one click instead of a transcription.
 */
export function renderPanelHtml(locale: 'en' | 'zh'): string {
  const copy = panelCopy(locale)
  // The copy is static, but `<` is escaped anyway: a future string must never be able to
  // close the `<script>` block it is injected into.
  const copyJson = JSON.stringify(copy).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="${locale}" data-theme="auto"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${copy.title}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg:#fcfcfc; --fg:#1b1b1b; --muted:#6f7278; --line:#e4e4e4; --soft:#f3f3f3;
    --ok:#0f7a52; --warn:#95591a; --bad:#b42318;
  }
  @media (prefers-color-scheme: dark) {
    :root[data-theme="auto"] {
      --bg:#151516; --fg:#e8e8e8; --muted:#8d9096; --line:#2b2b2c; --soft:#1e1e1f;
      --ok:#4fbf8b; --warn:#d3a04a; --bad:#e07a72;
    }
  }
  :root[data-theme="dark"] {
    --bg:#151516; --fg:#e8e8e8; --muted:#8d9096; --line:#2b2b2c; --soft:#1e1e1f;
    --ok:#4fbf8b; --warn:#d3a04a; --bad:#e07a72;
  }
  :root[data-theme="light"] { color-scheme:light; }
  :root[data-theme="dark"] { color-scheme:dark; }
  * { box-sizing:border-box; }
  html,body { margin:0; }
  body {
    background:var(--bg); color:var(--fg); min-height:100vh;
    font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  h1,h2,h3 { margin:0; font-weight:600; }
  code,pre,.mono,input,select { font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; }
  button { font:inherit; color:inherit; background:none; border:none; padding:0; cursor:pointer; }
  :focus-visible { outline:1.5px solid var(--fg); outline-offset:2px; }
  .grow { flex:1; }
  .hint { color:var(--muted); font-size:11.5px; }

  /* ---------------------------------- bar ---------------------------------- */
  .bar {
    position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:14px; flex-wrap:wrap;
    padding:0 24px; min-height:52px; background:var(--bg); border-bottom:1px solid var(--line);
  }
  .brand { font-weight:650; letter-spacing:.01em; }
  .brand span { margin-left:7px; color:var(--muted); font-size:11px; font-weight:500; letter-spacing:.1em; text-transform:uppercase; }
  .env { display:flex; gap:14px; flex-wrap:wrap; color:var(--muted); font-size:12px; }
  .env .mono { font-size:11.5px; }
  .env b { font-weight:500; color:var(--fg); }
  .seg { display:flex; border:1px solid var(--line); border-radius:4px; overflow:hidden; }
  .seg button { padding:4px 11px; font-size:12.5px; color:var(--muted); }
  .seg button + button { border-left:1px solid var(--line); }
  .seg button[aria-pressed="true"] { background:var(--soft); color:var(--fg); font-weight:600; }
  .btn { border:1px solid var(--line); border-radius:4px; padding:4px 11px; font-size:12.5px; background:var(--bg); }
  .btn:hover { background:var(--soft); }
  .btn.primary { background:var(--fg); color:var(--bg); border-color:var(--fg); }
  .btn.primary:hover { opacity:.86; }
  .btn.tiny { padding:2px 8px; font-size:12px; }
  .btn.quiet { border-color:transparent; color:var(--muted); padding:2px 6px; }
  .btn.quiet:hover { color:var(--fg); background:var(--soft); }

  main { max-width:900px; margin:0 auto; padding:0 24px 120px; }

  /* --------------------------------- status -------------------------------- */
  .status { padding:26px 0 22px; border-bottom:1px solid var(--line); }
  .status-line { display:flex; align-items:center; gap:10px; }
  .sig { width:8px; height:8px; border-radius:2px; background:var(--muted); flex:0 0 auto; }
  .status.ok .sig { background:var(--ok); }
  .status.attention .sig { background:var(--warn); }
  .status.broken .sig { background:var(--bad); }
  .status h1 { font-size:17px; line-height:1.5; font-weight:600; letter-spacing:-.01em; overflow-wrap:anywhere; }
  .figure { margin-left:auto; display:flex; align-items:baseline; gap:5px; flex:0 0 auto; }
  .figure b { font-size:22px; font-weight:600; line-height:1; font-variant-numeric:tabular-nums; }
  .figure span { color:var(--muted); font-size:11.5px; }
  .meta { margin:8px 0 0; color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
  .actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:16px; }
  .actions:empty { display:none; }
  .actions .note { color:var(--muted); font-size:12px; }
  .actions .note .mono { font-size:11.5px; }

  /* --------------------------- six counters (advanced) --------------------- */
  .counts { display:flex; flex-wrap:wrap; align-items:baseline; margin-top:18px; padding-top:12px; border-top:1px solid var(--line); }
  .count { display:inline-flex; align-items:baseline; gap:5px; padding:1px 0; font-size:12px; color:var(--muted); border-radius:3px; }
  .count + .count { margin-left:16px; padding-left:16px; border-left:1px solid var(--line); }
  .count b { font-size:13px; font-weight:600; color:var(--fg); font-variant-numeric:tabular-nums; }
  .count.bad b { color:var(--bad); }
  .count.warn b { color:var(--warn); }
  .count.ok b { color:var(--ok); }
  .count.static { cursor:default; }
  .count[data-filter]:hover { color:var(--fg); }
  .count[aria-pressed="true"] { color:var(--fg); background:var(--soft); padding-left:6px; padding-right:6px; }
  .count[aria-pressed="true"] b { text-decoration:underline; text-underline-offset:3px; }

  /* --------------------------------- blocks -------------------------------- */
  .block { margin-top:28px; }
  .block-head { display:flex; align-items:baseline; gap:10px; margin-bottom:4px; }
  .block-head h2 { font-size:12px; font-weight:600; letter-spacing:.06em; color:var(--muted); }
  .block-head .num { font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .list > :first-child { border-top:none; }
  .empty { padding:14px 0; color:var(--muted); font-size:12.5px; }

  .issue { display:flex; align-items:flex-start; gap:12px; padding:11px 0; border-top:1px solid var(--line); }
  .kbadge { flex:0 0 46px; font-size:11.5px; line-height:1.7; color:var(--muted); }
  .kbadge.bad { color:var(--bad); }
  .kbadge.warn { color:var(--warn); }
  .itext { flex:1; min-width:0; }
  .iid { display:block; font-size:12.5px; font-weight:550; overflow-wrap:anywhere; }
  .iline { display:block; margin-top:2px; color:var(--muted); font-size:12.5px; overflow-wrap:anywhere; }
  .issue .btn { flex:0 0 auto; margin-top:1px; }
  .more { padding:10px 0 0; color:var(--muted); font-size:12px; }

  .cmd { display:flex; align-items:center; gap:12px; padding:9px 0; border-top:1px solid var(--line); }
  .clabel { flex:0 0 116px; color:var(--muted); font-size:12px; }
  .cmd code { flex:1; min-width:0; overflow:auto; white-space:nowrap; font-size:12.5px; }

  /* ---------------------------------- tabs --------------------------------- */
  .tabs { display:flex; align-items:center; gap:18px; margin:34px 0 14px; border-bottom:1px solid var(--line); }
  .tabs button { padding:8px 0; margin-bottom:-1px; font-size:12.5px; color:var(--muted); border-bottom:2px solid transparent; }
  .tabs button[aria-selected="true"] { color:var(--fg); border-bottom-color:var(--fg); }
  .tabs .num { margin-left:6px; font-size:11.5px; color:var(--muted); font-variant-numeric:tabular-nums; }

  .toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
  .toolbar input[type="search"] {
    flex:1 1 240px; min-width:160px; padding:6px 9px; font-size:12.5px;
    border:1px solid var(--line); border-radius:4px; background:var(--bg); color:inherit;
  }
  .toolbar select {
    padding:6px 8px; font-size:12.5px; max-width:190px;
    border:1px solid var(--line); border-radius:4px; background:var(--bg); color:inherit;
  }

  /* --------------------------------- table --------------------------------- */
  .table-wrap { border:1px solid var(--line); border-radius:4px; overflow:auto; max-height:60vh; }
  table { border-collapse:separate; border-spacing:0; width:100%; table-layout:fixed; }
  thead th {
    position:sticky; top:0; z-index:1; padding:8px 10px; text-align:left; white-space:nowrap;
    font-size:11.5px; font-weight:600; color:var(--muted); background:var(--bg); border-bottom:1px solid var(--line);
  }
  thead th[data-sort] { cursor:pointer; user-select:none; }
  thead th[data-sort]:hover { color:var(--fg); }
  thead th .arrow { margin-left:4px; font-size:9px; opacity:.6; }
  tbody td { padding:7px 10px; vertical-align:top; font-size:12.5px; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }
  tbody td.name { word-break:break-all; }
  tbody tr:last-child td { border-bottom:none; }
  tbody tr { cursor:pointer; }
  tbody tr:hover td { background:var(--soft); }
  tbody tr:focus-visible { outline:1.5px solid var(--fg); outline-offset:-2px; }
  tbody .empty { padding:22px 10px; }
  th:nth-child(1),td:nth-child(1) { width:36%; }
  th:nth-child(2),td:nth-child(2) { width:9%; }
  th:nth-child(3),td:nth-child(3) { width:13%; }
  th:nth-child(4),td:nth-child(4) { width:8%; }
  th:nth-child(5),td:nth-child(5) { width:18%; font-variant-numeric:tabular-nums; }
  th:nth-child(6),td:nth-child(6) { width:16%; }
  .tag { font-size:11.5px; font-weight:600; }
  .tag.ok { color:var(--ok); }
  .tag.bad { color:var(--bad); }
  .tag.warn { color:var(--warn); }
  .tag.muted { color:var(--muted); }

  /* ---------------------------------- raw ---------------------------------- */
  pre { margin:0; }
  #tab-raw pre, #drawer-body {
    padding:12px; font-size:12px; line-height:1.55; overflow:auto; max-height:62vh;
    white-space:pre-wrap; overflow-wrap:anywhere;
    border:1px solid var(--line); border-radius:4px;
  }

  /* -------------------------------- drawer --------------------------------- */
  #drawer {
    position:fixed; top:0; right:0; height:100%; width:min(540px,100vw); z-index:40;
    display:flex; flex-direction:column; gap:10px; padding:14px 18px 18px;
    background:var(--bg); border-left:1px solid var(--line);
  }
  #drawer[hidden] { display:none; }
  #drawer header { display:flex; align-items:center; gap:10px; }
  #drawer h3 { flex:1; min-width:0; font-size:12.5px; font-weight:600; overflow-wrap:anywhere; }
  .drawer-actions { display:flex; gap:8px; flex-wrap:wrap; }
  #drawer-body { flex:1; min-height:0; max-height:none; }
  #scrim { position:fixed; inset:0; z-index:30; background:#00000026; }
  #scrim[hidden] { display:none; }

  .toast {
    position:fixed; left:24px; bottom:20px; z-index:50; padding:5px 12px; border-radius:3px;
    background:var(--fg); color:var(--bg); font-size:12.5px;
    opacity:0; pointer-events:none; transition:opacity .14s;
  }
  .toast.on { opacity:1; }

  /* ------------------------------ view switch ------------------------------ */
  body[data-view="advanced"] .only-simple { display:none !important; }
  body[data-view="simple"] .only-advanced { display:none !important; }
  body[data-view="simple"] #counts,
  body[data-view="simple"] nav.tabs,
  body[data-view="simple"] #tab-evidence,
  body[data-view="simple"] #tab-raw { display:none !important; }
  @media (max-width:640px) {
    .figure { margin-left:0; }
    .status-line { flex-wrap:wrap; }
    .clabel { flex-basis:100%; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
</style></head>
<body data-view="simple">

<header class="bar">
  <span class="brand">${copy.brand}<span>triage</span></span>
  <span class="env">
    <span class="mono" id="pill-dsh">dsh …</span>
    <span class="mono" id="pill-profile">profile …</span>
    <span id="pill-mode">${copy.readOnly}</span>
  </span>
  <span class="grow"></span>
  <div class="seg" role="group" aria-label="${copy.viewLabel}">
    <button id="view-simple" aria-pressed="true">${copy.viewSimple}</button>
    <button id="view-advanced" aria-pressed="false">${copy.viewAdvanced}</button>
  </div>
  <button class="btn" id="theme" title="${copy.themeTitle}" aria-label="${copy.themeTitle}">${copy.themes.auto}</button>
  <button class="btn primary" id="refresh" title="${copy.refreshTitle}">${copy.refresh}</button>
</header>

<main>
  <section class="status pending" id="hero" aria-live="polite">
    <div class="status-line">
      <span class="sig" aria-hidden="true"></span>
      <h1 id="headline">${copy.loading}</h1>
      <span class="figure only-simple"><b id="figure-value">—</b><span id="figure-unit">${copy.figureOk}</span></span>
    </div>
    <p class="meta" id="sub">${copy.loadingSub}</p>
    <div class="actions" id="hero-actions"></div>
    <div class="counts" id="counts"></div>
  </section>

  <section class="block">
    <div class="block-head">
      <h2>${copy.issues}</h2>
      <span class="num" id="issues-count"></span>
      <span class="grow"></span>
      <button class="btn quiet" id="issues-more" hidden>${copy.showAll}</button>
    </div>
    <div class="list" id="issues"></div>
  </section>

  <section class="block">
    <div class="block-head">
      <h2>${copy.next}</h2>
      <span class="grow"></span>
      <button class="btn quiet" id="copy-report">${copy.copyReport}</button>
    </div>
    <div class="list" id="next"></div>
  </section>

  <nav class="tabs" role="tablist">
    <button role="tab" data-tab="evidence" aria-selected="false">${copy.evidence}<span class="num" id="ev-count"></span></button>
    <button role="tab" data-tab="raw" aria-selected="false">${copy.raw}</button>
    <span class="grow"></span>
    <span class="hint" id="kbd-hint"></span>
  </nav>

  <section id="tab-evidence" hidden>
    <div class="toolbar">
      <input id="search" type="search" placeholder="${copy.searchPlaceholder}" aria-label="${copy.searchPlaceholder}">
      <select id="kind" aria-label="${copy.allKinds}"><option value="">${copy.allKinds}</option></select>
      <select id="conclusion" aria-label="${copy.allConclusions}"><option value="">${copy.allConclusions}</option></select>
      <span class="grow"></span>
      <span class="hint" id="ev-shown"></span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th data-sort="name">${copy.name}<span class="arrow"></span></th>
          <th data-sort="kind">${copy.kind}<span class="arrow"></span></th>
          <th data-sort="subject">${copy.subject}<span class="arrow"></span></th>
          <th data-sort="conclusion">${copy.conclusion}<span class="arrow"></span></th>
          <th data-sort="generated_at">${copy.at}<span class="arrow"></span></th>
          <th>${copy.hash}</th>
        </tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </section>

  <section id="tab-raw" hidden><pre id="raw">…</pre></section>
</main>

<aside id="drawer" hidden aria-hidden="true" tabindex="-1">
  <header><h3 id="drawer-title"></h3><button class="btn" id="drawer-close">${copy.close}</button></header>
  <div class="drawer-actions" id="drawer-actions"></div>
  <pre id="drawer-body"></pre>
</aside>
<div id="scrim" hidden></div>
<div class="toast" id="toast" role="status"></div>

<script>
const COPY = ${copyJson};
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = (id) => document.getElementById(id);
const NUM = (n) => (typeof n === 'number' ? n.toLocaleString() : '—');
const TONE = { go:'ok', passed:'ok', rendered:'ok', blocked:'bad', failed:'bad', blank:'bad', risky:'warn', unknown:'muted' };
const KIND_TONE = { denied:'bad', collision:'bad', duplicate:'warn', unknown:'muted', unreadable:'bad' };

const state = { summary: null, env: {}, ms: null, view: 'simple', artifacts: [], issueFilter: null, showAll: false, query: '', kind: '', conclusion: '', sort: { key: 'generated_at', dir: 'desc' }, evidenceLoaded: false, rawLoaded: false, drawerName: null };

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 1500);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (ignored) { ok = false; }
    area.remove();
    return ok;
  }
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-copy]');
  if (target === null) return;
  const ok = await copyText(target.getAttribute('data-copy'));
  toast(ok ? COPY.copied : COPY.copyFailed);
});

/* ------------------------------- theme ---------------------------------- */
const THEME_ORDER = ['auto', 'light', 'dark'];
function applyTheme(value) {
  const next = THEME_ORDER.indexOf(value) >= 0 ? value : 'auto';
  document.documentElement.setAttribute('data-theme', next);
  $('theme').textContent = COPY.themes[next] || next;
  try { localStorage.setItem('triage-theme', next); } catch (e) {}
}
function cycleTheme() {
  const now = document.documentElement.getAttribute('data-theme') || 'auto';
  applyTheme(THEME_ORDER[(THEME_ORDER.indexOf(now) + 1) % THEME_ORDER.length]);
}
let initialTheme = 'auto';
try {
  const savedTheme = localStorage.getItem('triage-theme');
  if (savedTheme) initialTheme = savedTheme;
} catch (e) {}
applyTheme(initialTheme);

/* ------------------------------ summary ---------------------------------- */
function envLine() {
  const parts = [];
  const s = state.summary;
  if (state.env.dsh) parts.push('dsh ' + state.env.dsh);
  if (state.env.profile) parts.push('profile ' + state.env.profile);
  if (state.env.platform) parts.push(state.env.platform + '/' + (state.env.arch || '?'));
  if (state.ms !== null) parts.push(COPY.checked.replace('{ms}', String(state.ms)));
  if (s && s.counts && s.counts.rows > s.counts.judged) {
    const template = state.view === 'simple' ? COPY.unjudgedSimple : COPY.unjudged;
    parts.push(template.replace('{n}', NUM(s.counts.rows - s.counts.judged)));
  }
  return parts.join(' · ');
}

/** The number next to the one-line verdict: the same thing the sentence counts. */
function headlineFigure(summary) {
  const c = summary.counts;
  if (summary.tone === 'broken') return { value: c.denied + c.collisions, unit: COPY.figureBroken };
  if (summary.tone === 'attention') return { value: c.unknown + c.duplicateCopies + c.errors, unit: COPY.figurePending };
  return { value: 0, unit: COPY.figureOk };
}

function count(label, value, tone, filter) {
  const cls = 'count' + (tone ? ' ' + tone : '');
  if (filter === null) {
    return '<span class="' + cls + ' static"><b>' + esc(NUM(value)) + '</b>' + esc(label) + '</span>';
  }
  const pressed = state.issueFilter === filter;
  return '<button class="' + cls + '" data-filter="' + esc(filter) + '" aria-pressed="' + String(pressed) + '">' +
    '<b>' + esc(NUM(value)) + '</b>' + esc(label) + '</button>';
}

function renderSummary() {
  const s = state.summary;
  const hero = $('hero');
  hero.className = 'status ' + s.tone;
  // Simple view says the same thing without jargon; advanced keeps the wording audit prints.
  $('headline').textContent = state.view === 'simple' ? s.plain : s.headline;
  const figure = headlineFigure(s);
  $('figure-value').textContent = NUM(figure.value);
  $('figure-unit').textContent = figure.unit;
  $('copy-report').hidden = false;
  $('sub').textContent = envLine();
  renderHeroAction();
  $('pill-dsh').innerHTML = 'dsh <b>' + esc(state.env.dsh || COPY.unknownValue) + '</b>';
  $('pill-profile').innerHTML = 'profile <b>' + esc(state.env.profile || COPY.unknownValue) + '</b>';
  const c = s.counts;
  $('counts').innerHTML =
    count(COPY.chips.rows, c.rows, '', null) +
    count(COPY.chips.judged, c.judged, '', null) +
    count(COPY.chips.go, c.go, c.go > 0 ? 'ok' : '', 'go') +
    count(COPY.chips.denied, c.denied, c.denied > 0 ? 'bad' : '', 'denied') +
    count(COPY.chips.unknown, c.unknown, c.unknown > 0 ? 'warn' : '', 'unknown') +
    count(COPY.chips.collisions, c.collisions, c.collisions > 0 ? 'bad' : '', 'collision');
  renderIssues();
  renderNext();
}

/** One obvious next action, chosen from the verdict itself. Nothing is executed for the user. */
function renderHeroAction() {
  const s = state.summary;
  const box = $('hero-actions');
  if (!s || !s.issues) { box.innerHTML = ''; return; }
  const fixable = s.issues.find((issue) => issue.fix !== null && issue.fix !== '');
  if (fixable) {
    box.innerHTML = '<button class="btn primary" data-copy="' + esc(fixable.fix) + '">' + esc(COPY.actionFix) + '</button>' +
      '<span class="note"><span class="mono">' + esc(fixable.id) + '</span> · ' + esc(COPY.actionFixHint) + '</span>';
    return;
  }
  box.innerHTML = '<button class="btn primary" data-copy="' + esc(reportText()) + '">' + esc(COPY.actionCopy) + '</button>' +
    '<span class="note">' + esc(COPY.actionCopyHint) + '</span>';
}

function issuesMatching() {
  const s = state.summary;
  if (!s) return [];
  const filter = state.issueFilter;
  if (filter === null) return s.issues.slice();
  const kinds = filter === 'duplicate' ? ['duplicate', 'unreadable'] : [filter];
  return s.issues.filter((issue) => kinds.indexOf(issue.kind) >= 0);
}

function renderIssues() {
  const s = state.summary;
  const box = $('issues');
  const all = issuesMatching();
  const filtered = state.issueFilter !== null;
  const list = filtered || state.showAll ? all : all.slice(0, 12);
  const total = filtered ? all.length : all.length + (s.more || 0);
  $('issues-count').textContent = total === 0 ? '' : String(total);
  $('issues-more').hidden = filtered || state.showAll || all.length <= 12;
  if (list.length === 0) {
    box.innerHTML = '<div class="empty">' + esc(filtered ? COPY.noFiltered : COPY.noIssues) + '</div>';
    return;
  }
  box.innerHTML = list.map((issue) => {
    const tone = KIND_TONE[issue.kind] || 'muted';
    const label = COPY.kindLabels[issue.kind] || issue.kind;
    const fix = issue.fix === null || issue.fix === ''
      ? ''
      : '<button class="btn tiny" data-copy="' + esc(issue.fix) + '" title="' + esc(issue.fix) + '">' + esc(COPY.copy) + '</button>';
    return '<div class="issue"><span class="kbadge ' + tone + '">' + esc(label) + '</span>' +
      '<div class="itext"><span class="iid mono">' + esc(issue.id) + '</span>' +
      '<span class="iline only-simple">' + esc(issue.plain) + '</span>' +
      '<span class="iline only-advanced">' + esc(issue.line) + '</span></div>' +
      fix + '</div>';
  }).join('') +
    (filtered ? '' : s.more > 0 ? '<div class="more">' + esc(COPY.more.replace('{n}', String(s.more))) + '</div>' : '');
}

function renderNext() {
  const steps = state.summary ? state.summary.next.filter((step) => step.command !== 'dsh-triage serve') : [];
  $('next').innerHTML = steps.length === 0
    ? '<div class="empty">' + esc(COPY.noNext) + '</div>'
    : steps.map((step) =>
      '<div class="cmd"><span class="clabel">' + esc(step.label) + '</span><code>' + esc(step.command) + '</code>' +
      '<button class="btn tiny" data-copy="' + esc(step.command) + '">' + esc(COPY.copy) + '</button></div>').join('');
}

function reportText() {
  const s = state.summary;
  if (!s) return '';
  const c = s.counts;
  const lines = [envLine(), COPY.reportTitle + ' ' + s.headline,
    '  ' + [COPY.chips.rows + ' ' + NUM(c.rows), COPY.chips.judged + ' ' + NUM(c.judged),
      COPY.chips.go + ' ' + NUM(c.go), COPY.chips.denied + ' ' + NUM(c.denied),
      COPY.chips.unknown + ' ' + NUM(c.unknown), COPY.chips.collisions + ' ' + NUM(c.collisions)].join(' · ')];
  if (c.rows > c.judged) lines.push('  ' + COPY.unjudged.replace('{n}', NUM(c.rows - c.judged)));
  if (s.issues.length) {
    lines.push('', COPY.issues + ':');
    for (const issue of s.issues) lines.push('  ' + issue.id + ' — ' + issue.line + (issue.fix ? '  [' + issue.fix + ']' : ''));
    if (s.more > 0) lines.push('  ' + COPY.more.replace('{n}', String(s.more)));
  }
  if (s.next.length) {
    lines.push('', COPY.next + ':');
    for (const step of s.next) lines.push('  ' + step.command + '   ' + step.label);
  }
  return lines.join('\\n');
}

/** Reset the first screen to a state that is not a verdict (off, unreadable, still loading). */
function resetHero(tone, sentence, meta) {
  state.summary = null;
  $('hero').className = 'status ' + tone;
  $('headline').textContent = sentence;
  $('sub').textContent = meta || '';
  $('figure-value').textContent = '';
  $('figure-unit').textContent = '';
  $('hero-actions').innerHTML = '';
  $('counts').innerHTML = '';
  $('issues-count').textContent = '';
  $('issues-more').hidden = true;
  $('copy-report').hidden = true;
  $('next').innerHTML = '<div class="empty">' + esc(COPY.noNext) + '</div>';
}

async function loadSummary() {
  let response;
  try { response = await fetch('/api/summary'); }
  catch (error) {
    resetHero('broken', COPY.failed + ': ' + error.message, '');
    return;
  }
  if (response.status === 501) {
    resetHero('pending', COPY.off, '');
    $('issues').innerHTML = '<div class="empty">' + esc(COPY.offIssues) + '</div>';
    $('pill-mode').textContent = COPY.readOnly;
    return;
  }
  let body;
  try { body = await response.json(); } catch (error) { body = {}; }
  if (!response.ok) {
    resetHero('broken', COPY.failed + ': ' + (body.error || response.status), '');
    $('issues').innerHTML = '<div class="empty">' + esc(COPY.failed) + '</div>';
    return;
  }
  state.summary = body.summary;
  state.env = body.env || {};
  state.ms = typeof body.ms === 'number' ? body.ms : null;
  renderSummary();
}

/* ------------------------------ evidence --------------------------------- */
function fillSelects() {
  const kinds = {};
  const conclusions = {};
  for (const item of state.artifacts) {
    kinds[item.kind] = (kinds[item.kind] || 0) + 1;
    const key = item.conclusion == null ? '∅' : item.conclusion;
    conclusions[key] = (conclusions[key] || 0) + 1;
  }
  const kindSel = $('kind');
  const keepKind = state.kind;
  kindSel.innerHTML = '<option value="">' + esc(COPY.allKinds) + '</option>' +
    Object.keys(kinds).sort().map((k) => '<option value="' + esc(k) + '">' + esc(k) + ' (' + kinds[k] + ')</option>').join('');
  kindSel.value = keepKind;
  const conSel = $('conclusion');
  const keepCon = state.conclusion;
  conSel.innerHTML = '<option value="">' + esc(COPY.allConclusions) + '</option>' +
    Object.keys(conclusions).sort().map((k) => '<option value="' + esc(k) + '">' + esc(COPY.conclusions[k] || k) + ' (' + conclusions[k] + ')</option>').join('');
  conSel.value = keepCon;
}

function visibleArtifacts() {
  const q = state.query.trim().toLowerCase();
  const out = state.artifacts.filter((item) => {
    if (state.kind && item.kind !== state.kind) return false;
    const con = item.conclusion == null ? '∅' : item.conclusion;
    if (state.conclusion && con !== state.conclusion) return false;
    if (!q) return true;
    return (item.name + ' ' + item.kind + ' ' + (item.subject || '') + ' ' + con).toLowerCase().indexOf(q) >= 0;
  });
  const key = state.sort.key;
  const dir = state.sort.dir === 'asc' ? 1 : -1;
  out.sort((a, b) => {
    const av = a[key] == null ? '' : String(a[key]);
    const bv = b[key] == null ? '' : String(b[key]);
    if (av === bv) return a.name < b.name ? -1 : 1;
    return av < bv ? -dir : dir;
  });
  return out;
}

/** The table shows one line per stamp; the full ISO value stays in the cell's title. */
function shortStamp(value) {
  if (!value) return '';
  return String(value).replace('T', ' ').replace(/\\.\\d+Z?$/, '').replace(/Z$/, '');
}

function renderRows() {
  const rows = visibleArtifacts();
  const tbody = $('rows');
  $('ev-shown').textContent = state.artifacts.length === 0 ? '' :
    COPY.shown.replace('{shown}', String(rows.length)).replace('{total}', String(state.artifacts.length));
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty">' +
      esc(state.artifacts.length === 0 ? COPY.empty : COPY.shown.replace('{shown}', '0').replace('{total}', String(state.artifacts.length))) +
      '</div></td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((item) => {
    const tone = TONE[item.conclusion] || 'muted';
    const label = item.conclusion == null ? COPY.noPayload : (COPY.conclusions[item.conclusion] || item.conclusion);
    return '<tr tabindex="0" data-name="' + esc(item.name) + '" title="' + esc(NUM(item.bytes) + ' bytes') + '">' +
      '<td class="mono name">' + esc(item.name) + '</td>' +
      '<td>' + esc(item.kind) + '</td>' +
      '<td>' + esc(item.subject || '') + '</td>' +
      '<td><span class="tag ' + tone + '">' + esc(label) + '</span></td>' +
      '<td class="mono" title="' + esc(item.generated_at || '') + '">' + esc(shortStamp(item.generated_at)) + '</td>' +
      '<td class="mono">' + esc((item.sha256 || '').slice(0, 12)) + '</td></tr>';
  }).join('');
  for (const th of document.querySelectorAll('thead th[data-sort]')) {
    const arrow = th.querySelector('.arrow');
    if (arrow) arrow.textContent = th.getAttribute('data-sort') === state.sort.key ? (state.sort.dir === 'asc' ? '▲' : '▼') : '';
  }
}

async function loadEvidence(force) {
  if (state.evidenceLoaded && !force) return;
  const response = await fetch('/api/artifacts');
  const data = await response.json();
  state.artifacts = data.artifacts || [];
  state.evidenceLoaded = true;
  $('pill-mode').textContent = data.readOnly ? COPY.readOnly : COPY.actionsEnabled;
  $('ev-count').textContent = String(data.count == null ? state.artifacts.length : data.count);
  fillSelects();
  renderRows();
}

async function openDrawer(name) {
  state.drawerName = name;
  $('drawer-title').textContent = name;
  $('drawer-body').textContent = COPY.picking;
  $('drawer-actions').innerHTML = '';
  $('drawer').hidden = false;
  $('drawer').setAttribute('aria-hidden', 'false');
  $('scrim').hidden = false;
  $('drawer').focus();
  let data = null;
  try {
    const response = await fetch('/api/artifact?name=' + encodeURIComponent(name));
    const body = await response.json();
    if (!response.ok) { $('drawer-body').textContent = COPY.artifactFailed + ': ' + (body.error || response.status); return; }
    data = body;
  } catch (error) {
    $('drawer-body').textContent = COPY.artifactFailed + ': ' + error.message;
    return;
  }
  const sha = data.sha256 || '';
  const payload = data.payload == null ? null : data.payload;
  const text = payload == null ? (data.error || COPY.noPayload) : JSON.stringify(payload, null, 2);
  $('drawer-actions').innerHTML =
    '<button class="btn tiny" data-copy="' + esc(name) + '">' + esc(COPY.copyName) + '</button>' +
    (sha ? '<button class="btn tiny" data-copy="' + esc(sha) + '">' + esc(COPY.copySha) + '</button>' : '') +
    (payload == null ? '' : '<button class="btn tiny" data-copy="' + esc(text) + '">' + esc(COPY.copyJson) + '</button>');
  $('drawer-body').textContent = text;
}

function closeDrawer() {
  state.drawerName = null;
  $('drawer').hidden = true;
  $('drawer').setAttribute('aria-hidden', 'true');
  $('scrim').hidden = true;
}

async function loadRaw() {
  const response = await fetch('/api/audit');
  if (!response.ok) {
    let detail = {};
    try { detail = await response.json(); } catch (e) {}
    $('raw').textContent = COPY.failed + ': ' + (detail.error || response.status);
    return;
  }
  const data = await response.json();
  $('raw').textContent = JSON.stringify(data, null, 2);
  state.rawLoaded = true;
}

/* -------------------------------- tabs ----------------------------------- */
function selectTab(name, updateHash) {
  for (const button of document.querySelectorAll('nav.tabs button')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === name));
  }
  $('tab-evidence').hidden = name !== 'evidence';
  $('tab-raw').hidden = name !== 'raw';
  if (name === 'evidence' && !state.evidenceLoaded) loadEvidence(false);
  if (name === 'raw' && !state.rawLoaded) loadRaw();
  if (updateHash !== false && location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}

/* ------------------------------- events ---------------------------------- */
document.addEventListener('click', (event) => {
  const chip = event.target.closest('.count[data-filter]');
  if (chip !== null) {
    const filter = chip.getAttribute('data-filter');
    state.issueFilter = state.issueFilter === filter ? null : filter;
    if (state.summary) renderSummary();
    return;
  }
  const row = event.target.closest('tbody tr[data-name]');
  if (row !== null) openDrawer(row.getAttribute('data-name'));
});
document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (event.key === 'Escape') {
    if (state.drawerName !== null) { closeDrawer(); return; }
    if (typing) document.activeElement.blur();
    return;
  }
  if (typing) {
    if (event.key === 'Enter' && document.activeElement.id === 'search') { renderRows(); }
    return;
  }
  if (event.key === '/') { event.preventDefault(); applyView('advanced'); selectTab('evidence'); $('search').focus(); return; }
  if (event.key === 'r' || event.key === 'R') { refresh(); return; }
  if (event.key === 'l' || event.key === 'L') { cycleTheme(); return; }
  if (event.key === '?') { toast(COPY.kbdHint); return; }
  if (event.key === '1') { applyView('advanced'); selectTab('evidence'); return; }
  if (event.key === '2') { applyView('advanced'); selectTab('raw'); return; }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const row = document.activeElement;
  if (row && row.matches && row.matches('tbody tr[data-name]')) openDrawer(row.getAttribute('data-name'));
});

function applyView(view) {
  state.view = view;
  document.body.setAttribute('data-view', view);
  $('view-simple').setAttribute('aria-pressed', String(view === 'simple'));
  $('view-advanced').setAttribute('aria-pressed', String(view === 'advanced'));
  try { localStorage.setItem('triage-view', view); } catch (e) {}
  if (state.summary) renderSummary();
  if (view === 'advanced') {
    // The detailed view without a tab open is a tab bar with nothing under it; open the
    // ledger, but do not rewrite a deep link the user followed to get here.
    if ($('tab-evidence').hidden && $('tab-raw').hidden) selectTab('evidence', false);
    else if (!state.evidenceLoaded) loadEvidence(false);
  }
}
$('view-simple').onclick = () => applyView('simple');
$('view-advanced').onclick = () => applyView('advanced');

$('theme').onclick = cycleTheme;
$('refresh').onclick = () => refresh();
$('drawer-close').onclick = closeDrawer;
$('scrim').onclick = closeDrawer;
$('issues-more').onclick = () => { state.issueFilter = null; state.showAll = true; renderIssues(); };
$('copy-report').onclick = async () => toast((await copyText(reportText())) ? COPY.copied : COPY.copyFailed);
$('search').oninput = () => { state.query = $('search').value; renderRows(); };
$('kind').onchange = () => { state.kind = $('kind').value; renderRows(); };
$('conclusion').onchange = () => { state.conclusion = $('conclusion').value; renderRows(); };
for (const th of document.querySelectorAll('thead th[data-sort]')) {
  th.onclick = () => {
    const key = th.getAttribute('data-sort');
    state.sort = state.sort.key === key
      ? { key: key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key: key, dir: key === 'generated_at' ? 'desc' : 'asc' };
    renderRows();
  };
}
for (const button of document.querySelectorAll('nav.tabs button')) {
  button.onclick = () => selectTab(button.dataset.tab);
}

function refresh() {
  loadSummary();
  if (state.evidenceLoaded) loadEvidence(true);
  if (state.rawLoaded) loadRaw();
}

$('kbd-hint').textContent = COPY.kbdHint;
// A link can carry the view, the theme and an artifact (see #theme= / #artifact= below), and
// combinations with an ampersand, for screenshots and docs. A deep link overrides the saved
// preferences without overwriting them, so "open it the way I had it" never sticks.
try {
  const savedView = localStorage.getItem('triage-view');
  if (savedView === 'advanced' || savedView === 'simple') applyView(savedView);
} catch (e) {}
const deepLinks = location.hash.replace(/^#/, '').split('&').map((part) => '#' + part);
for (const link of deepLinks) {
  if (link.indexOf('#theme=') === 0) { applyTheme(link.slice('#theme='.length)); continue; }
  if (link.indexOf('#artifact=') === 0) {
    applyView('advanced');
    selectTab('evidence');
    openDrawer(decodeURIComponent(link.slice('#artifact='.length)));
    continue;
  }
  if (link === '#advanced' || link === '#simple') { applyView(link.slice(1)); continue; }
  if (link === '#evidence' || link === '#raw') { selectTab(link.slice(1)); }
}
loadSummary();
</script>
</body></html>`
}

interface PanelCopy {
  readonly title: string
  readonly brand: string
  readonly readOnly: string
  readonly actionsEnabled: string
  readonly refresh: string
  readonly refreshTitle: string
  readonly themeTitle: string
  readonly themes: Readonly<Record<string, string>>
  readonly loading: string
  readonly loadingSub: string
  readonly issues: string
  readonly next: string
  readonly showAll: string
  readonly copyReport: string
  readonly evidence: string
  readonly raw: string
  readonly name: string
  readonly kind: string
  readonly subject: string
  readonly conclusion: string
  readonly at: string
  readonly hash: string
  readonly empty: string
  readonly noIssues: string
  readonly noFiltered: string
  readonly noNext: string
  readonly more: string
  readonly copy: string
  readonly copied: string
  readonly copyFailed: string
  readonly off: string
  readonly offIssues: string
  readonly failed: string
  readonly unknownValue: string
  readonly unjudged: string
  readonly searchPlaceholder: string
  readonly allKinds: string
  readonly allConclusions: string
  readonly shown: string
  readonly picking: string
  readonly noPayload: string
  readonly close: string
  readonly copyName: string
  readonly copySha: string
  readonly copyJson: string
  readonly artifactFailed: string
  readonly reportTitle: string
  readonly kbdHint: string
  readonly viewLabel: string
  readonly viewSimple: string
  readonly viewAdvanced: string
  readonly actionFix: string
  readonly actionFixHint: string
  readonly actionCopy: string
  readonly actionCopyHint: string
  readonly figureBroken: string
  readonly figurePending: string
  readonly figureOk: string
  readonly checked: string
  readonly unjudgedSimple: string
  readonly conclusions: Readonly<Record<string, string>>
  readonly chips: Readonly<Record<string, string>>
  readonly kindLabels: Readonly<Record<string, string>>
}

function panelCopy(locale: 'en' | 'zh'): PanelCopy {
  if (locale === 'en') {
    return {
      title: 'Triage · evidence panel',
      brand: 'Triage',
      readOnly: 'read-only',
      actionsEnabled: 'actions enabled',
      refresh: 'Re-check',
      refreshTitle: 'Read the profile again (r)',
      themeTitle: 'Theme: auto → light → dark (l)',
      themes: { auto: 'auto', light: 'light', dark: 'dark' },
      loading: 'Reading the profile',
      loadingSub: '',
      issues: 'Issues',
      next: 'Commands',
      showAll: 'Show all',
      copyReport: 'Copy all',
      evidence: 'Artifacts',
      raw: 'Raw JSON',
      name: 'Artifact',
      kind: 'Kind',
      subject: 'Subject',
      conclusion: 'Conclusion',
      at: 'Generated',
      hash: 'sha256',
      empty: 'No artifacts here. Point --results at another directory, or run a record_* script first.',
      noIssues: 'Nothing in this composition needs a decision.',
      noFiltered: 'No issue of this kind.',
      noNext: 'No command to run.',
      more: '{n} more not shown (the summary is capped; dsh-triage audit --json has all of them)',
      copy: 'Copy',
      copied: 'Copied',
      copyFailed: 'Press Ctrl+C',
      off: 'Started with --no-audit: this panel does not read the profile. Drop the flag to see the verdict.',
      offIssues: 'not read (--no-audit)',
      failed: 'the profile could not be read',
      unknownValue: 'unknown',
      unjudged: 'the other {n} rows declare no DSH range at all',
      searchPlaceholder: 'Search name / kind / subject',
      allKinds: 'All kinds',
      allConclusions: 'Any conclusion',
      shown: '{shown} of {total}',
      picking: 'loading…',
      noPayload: 'no conclusion',
      close: 'Close',
      copyName: 'Copy name',
      copySha: 'Copy sha256',
      copyJson: 'Copy JSON',
      artifactFailed: 'could not read this artifact',
      reportTitle: 'Verdict',
      kbdHint: '/ search · r re-check · l theme · Esc close',
      viewLabel: 'Detail level',
      viewSimple: 'Simple',
      viewAdvanced: 'Detailed',
      actionFix: 'Copy the fix command',
      actionFixHint: 'paste it into a terminal',
      actionCopy: 'Copy the result',
      actionCopyHint: 'for an issue or a chat',
      figureBroken: 'to fix',
      figurePending: 'to check',
      figureOk: 'issues',
      checked: 'checked in {ms} ms',
      unjudgedSimple: '{n} more plugins never say which versions they support, so they cannot be judged',
      conclusions: { go: 'go', passed: 'passed', rendered: 'rendered', blocked: 'blocked', failed: 'failed', blank: 'blank', risky: 'risky', unknown: 'cannot tell', '∅': 'no conclusion' },
      chips: { rows: 'rows', judged: 'judged', go: 'go', denied: 'denied', unknown: 'cannot tell', collisions: 'collisions' },
      kindLabels: { denied: 'denied', collision: 'collision', duplicate: 'duplicate', unknown: 'unknown', unreadable: 'unreadable' },
    }
  }
  return {
    title: '分诊台 · 证据面板',
    brand: '分诊台',
    readOnly: '只读',
    actionsEnabled: '可执行',
    refresh: '重新检查',
    refreshTitle: '重新读取当前 profile（r）',
    themeTitle: '主题：自动 → 浅色 → 深色（l）',
    themes: { auto: '自动', light: '浅色', dark: '深色' },
    loading: '正在读取 profile',
    loadingSub: '',
    issues: '问题',
    next: '命令',
    showAll: '显示全部',
    copyReport: '复制全文',
    evidence: '产物',
    raw: '原始 JSON',
    name: '产物',
    kind: '类型',
    subject: '对象',
    conclusion: '结论',
    at: '时间',
    hash: 'sha256',
    empty: '这里没有产物。用 --results <目录> 指向别处，或先跑一次 record_* 脚本。',
    noIssues: '这套组合里没有要处理的行。',
    noFiltered: '这一类里没有要处理的行。',
    noNext: '没有要跑的命令。',
    more: '另有 {n} 条没显示（摘要只列前几条，全量见 dsh-triage audit --json）',
    copy: '复制',
    copied: '已复制',
    copyFailed: '复制失败，请手动选中',
    off: '面板以 --no-audit 启动，不读取当前 profile。去掉该参数就能看到结论。',
    offIssues: '未读取（--no-audit）',
    failed: '读不到当前 profile',
    unknownValue: '未知',
    unjudged: '其余 {n} 行不声明任何 DSH 区间',
    searchPlaceholder: '搜索产物名 / 类型 / 对象',
    allKinds: '全部类型',
    allConclusions: '全部结论',
    shown: '显示 {shown} / {total}',
    picking: '读取中…',
    noPayload: '无结论',
    close: '关闭',
    copyName: '复制名称',
    copySha: '复制 sha256',
    copyJson: '复制 JSON',
    artifactFailed: '读不到这份产物',
    reportTitle: '结论',
    kbdHint: '/ 搜索 · r 重新检查 · l 主题 · Esc 关闭',
    viewLabel: '详细程度',
    viewSimple: '简单',
    viewAdvanced: '详细',
    actionFix: '复制修复命令',
    actionFixHint: '粘贴到终端执行',
    actionCopy: '复制这份结果',
    actionCopyHint: '贴到 issue 或聊天里',
    figureBroken: '处会坏',
    figurePending: '处待确认',
    figureOk: '处问题',
    checked: '检查用时 {ms} 毫秒',
    unjudgedSimple: '另外 {n} 个插件没声明支持的版本，判不了',
    conclusions: { go: '正常', passed: '通过', rendered: '渲染正常', blocked: '被拒', failed: '失败', blank: '白屏', risky: '有风险', unknown: '判不了', '∅': '无结论' },
    chips: { rows: '行', judged: '有判定', go: '正常', denied: '被拒', unknown: '判不了', collisions: '冲突' },
    kindLabels: { denied: '被拒', collision: '冲突', duplicate: '重复', unknown: '判不了', unreadable: '读不到' },
  }
}
