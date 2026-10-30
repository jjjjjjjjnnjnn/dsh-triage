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
 * The page, R49: the answer first, the evidence behind tabs.
 *
 * One screen answers the only three questions a person opens this for — is it broken, which
 * row, what do I type. The artifact table and the raw `audit --json` payload are still here,
 * one click away, because they are what the answer rests on; they are no longer the answer.
 *
 * No framework, no remote assets, no inline event handlers: everything is built from the two
 * JSON routes and escaped on the way in (see `esc` below). `data-copy` buttons carry the exact
 * command text, so "what do I type" is one click instead of a transcription.
 */
export function renderPanelHtml(locale: 'en' | 'zh'): string {
  const copy = panelCopy(locale)
  // The copy is static, but `<` is escaped anyway: a future string must never be able to
  // close the `<script>` block it is injected into.
  const copyJson = JSON.stringify({
    copied: copy.copied,
    copyFailed: copy.copyFailed,
    copy: copy.copy,
    empty: copy.empty,
    noIssues: copy.noIssues,
    more: copy.more,
    off: copy.off,
    failed: copy.failed,
    artifacts: copy.artifactCount,
    readOnly: copy.readOnly,
    actions: copy.actionsEnabled,
    chips: copy.chips,
    unjudged: copy.unjudged,
    shown: copy.shown,
    all: copy.all,
    picking: copy.picking,
    noPayload: copy.noPayload,
    reportTitle: copy.reportTitle,
    issuesTitle: copy.issues,
    nextTitle: copy.next,
    copyName: copy.copyName,
    copySha: copy.copySha,
    copyJson: copy.copyJson,
    artifactFailed: copy.artifactFailed,
    conclusions: copy.conclusions,
    kbdHint: copy.kbdHint,
    allKinds: copy.allKinds,
    allConclusions: copy.allConclusions,
  }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="${locale}" data-theme="auto"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${copy.title}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg:#fbfbfd; --fg:#18181b; --muted:#6b7280; --line:#e4e4e7; --panel:#ffffff; --soft:#f4f4f5;
    --ok:#12805c; --warn:#b45309; --bad:#b42318; --accent:#2563eb; --shadow:0 1px 2px #0000000d, 0 8px 24px #0000000a;
  }
  @media (prefers-color-scheme: dark) {
    :root[data-theme="auto"] {
      --bg:#0f1012; --fg:#e7e7ea; --muted:#9a9aa3; --line:#27272a; --panel:#17181b; --soft:#1f2023;
      --ok:#3ddc97; --warn:#f0b429; --bad:#ff6b6b; --accent:#7aa2ff; --shadow:0 1px 2px #00000066, 0 8px 24px #0000004d;
    }
  }
  :root[data-theme="dark"] {
    --bg:#0f1012; --fg:#e7e7ea; --muted:#9a9aa3; --line:#27272a; --panel:#17181b; --soft:#1f2023;
    --ok:#3ddc97; --warn:#f0b429; --bad:#ff6b6b; --accent:#7aa2ff; --shadow:0 1px 2px #00000066, 0 8px 24px #0000004d;
  }
  * { box-sizing:border-box; }
  html,body { margin:0; }
  html { background:var(--bg); min-height:100%; }
  :root[data-theme="light"] { color-scheme:light; }
  :root[data-theme="dark"] { color-scheme:dark; }
  body {
    background:var(--bg); color:var(--fg); min-height:100vh;
    font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  code, .mono, pre, input, select { font-family:ui-monospace,SFMono-Regular,"SF Mono",Consolas,"Liberation Mono",monospace; }
  button { font:inherit; color:inherit; cursor:pointer; }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:6px; }

  .top {
    position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:12px; flex-wrap:wrap;
    padding:12px 22px; background:color-mix(in oklab, var(--bg) 86%, transparent);
    backdrop-filter:blur(10px); border-bottom:1px solid var(--line);
  }
  .brand { display:flex; align-items:baseline; gap:8px; font-weight:650; letter-spacing:.01em; }
  .brand .mark { font-size:16px; color:var(--accent); }
  .brand .sub { color:var(--muted); font-weight:500; font-size:12px; letter-spacing:.06em; text-transform:uppercase; }
  .env { display:flex; gap:6px; flex-wrap:wrap; }
  .pill {
    border:1px solid var(--line); background:var(--soft); border-radius:999px;
    padding:2px 9px; font-size:12px; color:var(--muted); white-space:nowrap;
  }
  .pill b { color:var(--fg); font-weight:600; }
  .grow { flex:1; }
  .btn { border:1px solid var(--line); background:var(--panel); border-radius:9px; padding:6px 12px; }
  .btn:hover { background:var(--soft); }
  .btn.primary { background:var(--fg); color:var(--bg); border-color:var(--fg); font-weight:600; }
  .btn.primary:hover { opacity:.88; }
  .btn.icon { padding:6px 9px; line-height:1; }
  .btn.tiny { padding:3px 9px; font-size:12px; }
  .btn.ghost { border-color:transparent; background:transparent; color:var(--accent); padding:3px 6px; }
  .btn.ghost:hover { background:var(--soft); }

  main { max-width:1180px; margin:0 auto; padding:20px 22px 96px; }

  .hero {
    border:1px solid var(--line); background:var(--panel); border-radius:14px; padding:18px 20px;
    box-shadow:var(--shadow); position:relative; overflow:hidden;
  }
  .hero::before { content:""; position:absolute; inset:0 auto 0 0; width:5px; background:var(--muted); }
  .hero.ok::before { background:var(--ok); }
  .hero.attention::before { background:var(--warn); }
  .hero.broken::before { background:var(--bad); }
  .hero.pending::before { background:var(--line); }
  .hero-head { display:flex; align-items:flex-start; gap:10px; }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--muted); flex:0 0 auto; margin-top:7px; }
  .hero.ok .dot { background:var(--ok); }
  .hero.attention .dot { background:var(--warn); }
  .hero.broken .dot { background:var(--bad); }
  .hero h1 { font-size:20px; line-height:1.35; margin:0; font-weight:680; letter-spacing:-.01em; }
  .hero .sub { margin:6px 0 0 19px; color:var(--muted); font-size:13px; overflow-wrap:anywhere; }
  .counts { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:8px; margin-top:16px; }
  .stat {
    border:1px solid var(--line); background:var(--bg); border-radius:10px; padding:8px 10px; text-align:left;
    display:flex; flex-direction:column; gap:1px;
  }
  .stat b { font-size:19px; font-weight:650; font-variant-numeric:tabular-nums; line-height:1.2; }
  .stat span { color:var(--muted); font-size:11.5px; }
  .stat[aria-pressed="true"] { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent) inset; }
  .stat.bad b { color:var(--bad); } .stat.warn b { color:var(--warn); } .stat.ok b { color:var(--ok); }
  .stat:disabled { cursor:default; opacity:.6; }

  .grid { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(0,1fr); gap:16px; margin-top:16px; }
  @media (max-width:900px) { .grid { grid-template-columns:1fr; } .counts { grid-template-columns:repeat(3,minmax(0,1fr)); } }
  .panel { border:1px solid var(--line); background:var(--panel); border-radius:14px; box-shadow:var(--shadow); overflow:hidden; }
  .panel-head { display:flex; align-items:center; gap:8px; padding:12px 16px; border-bottom:1px solid var(--line); }
  .panel-head h2 { font-size:13px; margin:0; font-weight:650; letter-spacing:.02em; }
  .panel-head .count { color:var(--muted); font-weight:500; }
  .panel-body { padding:12px 14px; display:flex; flex-direction:column; gap:8px; }

  .issue { display:flex; gap:10px; align-items:flex-start; border:1px solid var(--line); border-radius:10px; padding:10px 12px; background:var(--bg); }
  .issue .badge { flex:0 0 auto; font-size:11px; font-weight:700; border-radius:6px; padding:1px 6px; margin-top:1px; }
  .issue.bad .badge { color:var(--bad); background:color-mix(in oklab, var(--bad) 14%, transparent); }
  .issue.warn .badge { color:var(--warn); background:color-mix(in oklab, var(--warn) 16%, transparent); }
  .issue.muted .badge { color:var(--muted); background:var(--soft); }
  .issue .id { font-size:13px; font-weight:600; overflow-wrap:anywhere; }
  .issue .line { color:var(--muted); font-size:12.5px; margin-top:2px; overflow-wrap:anywhere; }
  .issue .body { flex:1; min-width:0; }
  .issue .acts { display:flex; gap:6px; flex:0 0 auto; }

  .step { display:flex; align-items:center; gap:8px; }
  .step .label { color:var(--muted); font-size:12px; flex:0 0 auto; min-width:96px; }
  .step code {
    flex:1; min-width:0; background:var(--soft); border-radius:7px; padding:6px 9px; font-size:12.5px;
    overflow:auto; white-space:nowrap;
  }

  .tabs { display:flex; gap:4px; align-items:center; margin:20px 0 12px; border-bottom:1px solid var(--line); }
  .tabs button {
    border:none; background:transparent; padding:9px 12px; color:var(--muted); font-weight:600; font-size:13px;
    border-bottom:2px solid transparent; margin-bottom:-1px;
  }
  .tabs button[aria-selected="true"] { color:var(--fg); border-bottom-color:var(--fg); }
  .tabs .count { color:var(--muted); font-weight:500; }

  .toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
  .toolbar input[type="search"] {
    flex:1 1 220px; min-width:160px; padding:7px 10px; border-radius:9px;
    border:1px solid var(--line); background:var(--panel); color:inherit; font-size:13px;
  }
  .toolbar select {
    padding:7px 9px; border-radius:9px; border:1px solid var(--line);
    background:var(--panel); color:inherit; font-size:13px; max-width:190px;
  }
  .hint { color:var(--muted); font-size:12px; }

  .table-wrap { border:1px solid var(--line); border-radius:12px; background:var(--panel); overflow:auto; max-height:62vh; box-shadow:var(--shadow); }
  table { border-collapse:separate; border-spacing:0; width:100%; table-layout:fixed; }
  thead th {
    position:sticky; top:0; z-index:1; text-align:left; font-size:11.5px; letter-spacing:.04em; text-transform:uppercase;
    color:var(--muted); font-weight:650; background:var(--panel); border-bottom:1px solid var(--line);
    padding:9px 10px; white-space:nowrap;
  }
  thead th[data-sort] { cursor:pointer; user-select:none; }
  thead th[data-sort]:hover { color:var(--fg); }
  thead th .arrow { opacity:.45; margin-left:3px; font-size:10px; }
  tbody td { padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; overflow-wrap:anywhere; font-size:12.5px; }
  tbody tr:last-child td { border-bottom:none; }
  tbody tr { cursor:pointer; }
  tbody tr:hover td { background:var(--soft); }
  tbody tr:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  th:nth-child(1),td:nth-child(1) { width:32%; }
  th:nth-child(2),td:nth-child(2) { width:8%; }
  th:nth-child(3),td:nth-child(3) { width:15%; }
  th:nth-child(4),td:nth-child(4) { width:9%; }
  th:nth-child(5),td:nth-child(5) { width:19%; font-variant-numeric:tabular-nums; }
  th:nth-child(6),td:nth-child(6) { width:17%; }
  .tag { display:inline-block; border-radius:6px; padding:0 6px; font-size:11.5px; font-weight:650; }
  .tag.ok { color:var(--ok); background:color-mix(in oklab, var(--ok) 13%, transparent); }
  .tag.bad { color:var(--bad); background:color-mix(in oklab, var(--bad) 13%, transparent); }
  .tag.warn { color:var(--warn); background:color-mix(in oklab, var(--warn) 16%, transparent); }
  .tag.muted { color:var(--muted); background:var(--soft); }
  .empty { padding:26px 16px; text-align:center; color:var(--muted); }

  pre { margin:0; }
  #tab-raw pre, #drawer-body {
    background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px;
    overflow:auto; font-size:12px; line-height:1.5; max-height:64vh; white-space:pre-wrap; overflow-wrap:anywhere;
  }

  #drawer {
    position:fixed; top:0; right:0; height:100%; width:min(560px,100vw); z-index:40;
    background:var(--bg); border-left:1px solid var(--line); box-shadow:-12px 0 40px #0000001f;
    display:flex; flex-direction:column; gap:10px; padding:14px 16px 18px;
  }
  #drawer[hidden] { display:none; }
  #drawer header { display:flex; align-items:flex-start; gap:8px; }
  #drawer h3 { margin:0; font-size:13.5px; font-weight:650; overflow-wrap:anywhere; flex:1; }
  #drawer .drawer-actions { display:flex; gap:6px; flex-wrap:wrap; }
  #drawer-body { flex:1; max-height:none; }
  #scrim { position:fixed; inset:0; z-index:30; background:#00000059; }
  #scrim[hidden] { display:none; }

  .kbd {
    border:1px solid var(--line); border-bottom-width:2px; border-radius:5px; padding:0 5px;
    font-size:11px; color:var(--muted); background:var(--panel);
  }
  .toast {
    position:fixed; left:50%; bottom:24px; transform:translateX(-50%) translateY(8px);
    background:var(--fg); color:var(--bg); padding:7px 14px; border-radius:999px; font-size:12.5px;
    opacity:0; pointer-events:none; transition:opacity .16s, transform .16s; z-index:50;
  }
  .toast.on { opacity:1; transform:translateX(-50%) translateY(0); }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
</style></head>
<body>

<header class="top">
  <div class="brand"><span class="mark">◑</span><span>${copy.brand}</span><span class="sub">triage</span></div>
  <div class="env">
    <span class="pill mono" id="pill-dsh">dsh …</span>
    <span class="pill mono" id="pill-profile">…</span>
    <span class="pill" id="pill-mode">${copy.readOnly}</span>
  </div>
  <span class="grow"></span>
  <button class="btn icon" id="theme" title="${copy.themeTitle}" aria-label="${copy.themeTitle}">◐</button>
  <button class="btn primary" id="refresh" title="${copy.refreshTitle}">${copy.refresh}</button>
</header>

<main>
  <section class="hero pending" id="hero" aria-live="polite">
    <div class="hero-head"><span class="dot"></span><h1 id="headline">${copy.loading}</h1></div>
    <p class="sub" id="sub">${copy.loadingSub}</p>
    <div class="counts" id="counts"></div>
  </section>

  <div class="grid">
    <section class="panel" id="issues-panel">
      <div class="panel-head">
        <h2>${copy.issues}</h2>
        <span class="count" id="issues-count"></span>
        <span class="grow"></span>
        <button class="btn ghost" id="issues-more" hidden>${copy.showAll}</button>
      </div>
      <div class="panel-body" id="issues"></div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>${copy.next}</h2>
        <span class="grow"></span>
        <button class="btn ghost" id="copy-report">${copy.copyReport}</button>
      </div>
      <div class="panel-body" id="next"></div>
    </section>
  </div>

  <nav class="tabs" role="tablist">
    <button role="tab" data-tab="evidence" aria-selected="false">${copy.evidence} <span class="count" id="ev-count"></span></button>
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
  <header><h3 id="drawer-title"></h3><button class="btn icon" id="drawer-close" aria-label="${copy.close}">✕</button></header>
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
const MARK = { denied: ['✗','bad'], collision: ['✗','bad'], duplicate: ['!','warn'], unknown: ['?','muted'], unreadable: ['!','warn'] };
const TONE = { go:'ok', passed:'ok', rendered:'ok', blocked:'bad', failed:'bad', blank:'bad', risky:'warn', unknown:'muted' };

const state = { summary: null, env: {}, artifacts: [], issueFilter: null, query: '', kind: '', conclusion: '', sort: { key: 'generated_at', dir: 'desc' }, evidenceLoaded: false, rawLoaded: false, drawerName: null };

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
function applyTheme(value) {
  document.documentElement.setAttribute('data-theme', value);
  try { localStorage.setItem('triage-theme', value); } catch (e) {}
}
function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const now = document.documentElement.getAttribute('data-theme') || 'auto';
  applyTheme(order[(order.indexOf(now) + 1) % order.length]);
}
try {
  const saved = localStorage.getItem('triage-theme');
  if (saved) applyTheme(saved);
} catch (e) {}

/* ------------------------------ summary ---------------------------------- */
function envLine() {
  const parts = [];
  const s = state.summary;
  if (state.env.dsh) parts.push('dsh ' + state.env.dsh);
  if (state.env.profile) parts.push('profile ' + state.env.profile);
  if (state.env.platform) parts.push(state.env.platform + '/' + (state.env.arch || '?'));
  if (s && s.counts && s.counts.rows > s.counts.judged) {
    parts.push(COPY.unjudged.replace('{n}', NUM(s.counts.rows - s.counts.judged)));
  }
  return parts.join(' · ');
}

function stat(key, label, value, tone, filter) {
  const pressable = filter !== null && value > 0;
  const pressed = filter !== null && state.issueFilter === filter;
  return '<button class="stat ' + (tone || '') + '" ' + (pressable ? 'data-filter="' + esc(filter) + '"' : 'disabled') +
    ' aria-pressed="' + String(pressed) + '"><b>' + esc(NUM(value)) + '</b><span>' + esc(label) + '</span></button>';
}

function renderSummary() {
  const s = state.summary;
  const hero = $('hero');
  hero.className = 'hero ' + s.tone;
  $('headline').textContent = s.headline;
  $('sub').textContent = envLine();
  $('pill-dsh').innerHTML = 'dsh <b>' + esc(state.env.dsh || 'unknown') + '</b>';
  $('pill-profile').innerHTML = 'profile <b>' + esc(state.env.profile || 'unknown') + '</b>';
  const c = s.counts;
  $('counts').innerHTML =
    stat('rows', COPY.chips.rows, c.rows, '', null) +
    stat('judged', COPY.chips.judged, c.judged, '', null) +
    stat('go', COPY.chips.go, c.go, c.go > 0 ? 'ok' : '', 'go') +
    stat('denied', COPY.chips.denied, c.denied, c.denied > 0 ? 'bad' : '', 'denied') +
    stat('unknown', COPY.chips.unknown, c.unknown, c.unknown > 0 ? 'warn' : '', 'unknown') +
    stat('collisions', COPY.chips.collisions, c.collisions, c.collisions > 0 ? 'bad' : '', 'collision');
  renderIssues();
  renderNext();
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
  const list = filtered ? all : all.slice(0, 12);
  $('issues-count').textContent = String(all.length);
  $('issues-more').hidden = filtered || all.length <= list.length;
  if (list.length === 0) {
    box.innerHTML = '<div class="empty">' + esc(COPY.noIssues) + '</div>';
    return;
  }
  box.innerHTML = list.map((issue) => {
    const mark = MARK[issue.kind] || ['?', 'muted'];
    const fix = issue.fix === null
      ? ''
      : '<button class="btn tiny" data-copy="' + esc(issue.fix) + '" title="' + esc(issue.fix) + '">' + esc(COPY.copy) + '</button>';
    return '<div class="issue ' + mark[1] + '"><span class="badge">' + esc(mark[0]) + '</span>' +
      '<div class="body"><div class="id">' + esc(issue.id) + '</div><div class="line">' + esc(issue.line) + '</div></div>' +
      (fix ? '<div class="acts">' + fix + '</div>' : '') + '</div>';
  }).join('') +
    (filtered ? '' : s.more > 0 ? '<div class="hint">' + esc(s.more + ' ' + COPY.more) + '</div>' : '');
}

function renderNext() {
  const shown = state.summary ? state.summary.next.filter((step) => step.command !== 'dsh-triage serve') : [];
  $('next').innerHTML = shown.map((step) =>
    '<div class="step"><span class="label">' + esc(step.label) + '</span><code>' + esc(step.command) + '</code>' +
    '<button class="btn tiny" data-copy="' + esc(step.command) + '">' + esc(COPY.copy) + '</button></div>').join('');
}

function reportText() {
  const s = state.summary;
  if (!s) return '';
  const lines = [envLine(), COPY.reportTitle + ' ' + s.headline,
    '  ' + [COPY.chips.rows + ' ' + NUM(s.counts.rows), COPY.chips.judged + ' ' + NUM(s.counts.judged),
      COPY.chips.go + ' ' + NUM(s.counts.go), COPY.chips.denied + ' ' + NUM(s.counts.denied),
      COPY.chips.unknown + ' ' + NUM(s.counts.unknown), COPY.chips.collisions + ' ' + NUM(s.counts.collisions)].join(' · ')];
  if (s.counts.rows > s.counts.judged) lines.push('  ' + COPY.unjudged.replace('{n}', NUM(s.counts.rows - s.counts.judged)));
  if (s.issues.length) {
    lines.push('', COPY.issuesTitle + ':');
    for (const issue of s.issues) lines.push('  ' + issue.id + ' — ' + issue.line + (issue.fix ? '  [' + issue.fix + ']' : ''));
    if (s.more > 0) lines.push('  … ' + s.more + ' ' + COPY.more);
  }
  if (s.next.length) {
    lines.push('', COPY.nextTitle + ':');
    for (const step of s.next) lines.push('  ' + step.command + '   ' + step.label);
  }
  return lines.join('\\n');
}

async function loadSummary() {
  let response;
  try { response = await fetch('/api/summary'); }
  catch (error) {
    $('hero').className = 'hero broken';
    $('headline').textContent = COPY.failed + ': ' + error.message;
    return;
  }
  if (response.status === 501) {
    $('hero').className = 'hero pending';
    $('headline').textContent = COPY.off;
    $('sub').textContent = '';
    $('counts').innerHTML = '';
    $('issues').innerHTML = '<div class="empty">' + esc(COPY.off) + '</div>';
    $('next').innerHTML = '';
    $('pill-mode').textContent = COPY.readOnly;
    return;
  }
  let body;
  try { body = await response.json(); } catch (error) { body = {}; }
  if (!response.ok) {
    $('hero').className = 'hero broken';
    $('headline').textContent = COPY.failed + ': ' + (body.error || response.status);
    return;
  }
  state.summary = body.summary;
  state.env = body.env || {};
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

function renderRows() {
  const rows = visibleArtifacts();
  const tbody = $('rows');
  $('ev-shown').textContent = state.artifacts.length === 0 ? '' :
    COPY.shown.replace('{shown}', String(rows.length)).replace('{total}', String(state.artifacts.length));
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty">' + esc(state.artifacts.length === 0 ? COPY.empty : COPY.shown.replace('{shown}', '0').replace('{total}', String(state.artifacts.length))) + '</div></td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((item) => {
    const tone = TONE[item.conclusion] || 'muted';
    const label = item.conclusion == null ? COPY.noPayload : (COPY.conclusions[item.conclusion] || item.conclusion);
    return '<tr tabindex="0" data-name="' + esc(item.name) + '" title="' + esc(NUM(item.bytes) + ' bytes') + '">' +
      '<td class="mono">' + esc(item.name) + '</td>' +
      '<td>' + esc(item.kind) + '</td>' +
      '<td>' + esc(item.subject || '') + '</td>' +
      '<td><span class="tag ' + tone + '">' + esc(label) + '</span></td>' +
      '<td class="mono">' + esc(item.generated_at || '') + '</td>' +
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
  $('pill-mode').textContent = data.readOnly ? COPY.readOnly : COPY.actions;
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
function selectTab(name) {
  for (const button of document.querySelectorAll('nav.tabs button')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === name));
  }
  $('tab-evidence').hidden = name !== 'evidence';
  $('tab-raw').hidden = name !== 'raw';
  if (name === 'evidence' && !state.evidenceLoaded) loadEvidence(false);
  if (name === 'raw' && !state.rawLoaded) loadRaw();
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}

/* ------------------------------- events ---------------------------------- */
document.addEventListener('click', (event) => {
  const chip = event.target.closest('.stat[data-filter]');
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
  if (event.key === '/') { event.preventDefault(); selectTab('evidence'); $('search').focus(); return; }
  if (event.key === 'r' || event.key === 'R') { refresh(); return; }
  if (event.key === 'l' || event.key === 'L') { cycleTheme(); return; }
  if (event.key === '?') { toast(COPY.kbdHint); return; }
  if (event.key === '1') { selectTab('evidence'); return; }
  if (event.key === '2') { selectTab('raw'); return; }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const row = document.activeElement;
  if (row && row.matches && row.matches('tbody tr[data-name]')) openDrawer(row.getAttribute('data-name'));
});

$('theme').onclick = cycleTheme;
$('refresh').onclick = () => refresh();
$('drawer-close').onclick = closeDrawer;
$('scrim').onclick = closeDrawer;
$('issues-more').onclick = () => { state.issueFilter = null; renderIssues(); };
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
// A link can carry the theme: screenshots, docs, and "open it the way I had it" all work
// without touching the saved preference.
if (location.hash.indexOf('#theme=') === 0) applyTheme(location.hash.slice('#theme='.length));
if (/^#(evidence|raw)$/.test(location.hash)) selectTab(location.hash.slice(1));
if (location.hash.indexOf('#artifact=') === 0) {
  const wanted = decodeURIComponent(location.hash.slice('#artifact='.length));
  selectTab('evidence');
  openDrawer(wanted);
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
  readonly more: string
  readonly copy: string
  readonly copied: string
  readonly copyFailed: string
  readonly artifactCount: string
  readonly off: string
  readonly failed: string
  readonly unjudged: string
  readonly searchPlaceholder: string
  readonly allKinds: string
  readonly allConclusions: string
  readonly shown: string
  readonly shownEmpty: string
  readonly all: string
  readonly picking: string
  readonly noPayload: string
  readonly close: string
  readonly copyName: string
  readonly copySha: string
  readonly copyJson: string
  readonly artifactFailed: string
  readonly reportTitle: string
  readonly kbdHint: string
  readonly conclusions: Readonly<Record<string, string>>
  readonly chips: Readonly<Record<string, string>>
}

function panelCopy(locale: 'en' | 'zh'): PanelCopy {
  if (locale === 'en') {
    return {
      title: 'Triage · evidence panel',
      brand: 'Triage',
      readOnly: 'read-only',
      actionsEnabled: 'actions enabled',
      refresh: 'Re-check',
      refreshTitle: 'Re-read the profile (r)',
      themeTitle: 'Theme: auto → light → dark (l)',
      loading: 'Reading the current profile…',
      loadingSub: 'one scan of the installed set; nothing is re-judged here',
      issues: 'What to look at',
      next: 'Next',
      showAll: 'Show all',
      copyReport: 'Copy this verdict',
      evidence: 'Artifacts',
      raw: 'Raw JSON',
      name: 'Artifact',
      kind: 'Kind',
      subject: 'Subject',
      conclusion: 'Conclusion',
      at: 'Generated',
      hash: 'sha256',
      empty: 'No artifacts found. Point --results at another directory, or run a record_* script first.',
      noIssues: 'Nothing to act on in this composition.',
      more: 'more (the summary is capped; `audit --json` has the full list)',
      copy: 'Copy',
      copied: 'Copied',
      copyFailed: 'Press Ctrl+C',
      artifactCount: 'artifacts',
      off: 'The panel was started with --no-audit: it does not read the current profile. Drop the flag to see the verdict.',
      failed: 'the profile could not be read',
      unjudged: '{n} more rows declare no DSH range at all',
      searchPlaceholder: 'Search name / kind / subject…',
      allKinds: 'All kinds',
      allConclusions: 'Any conclusion',
      shown: '{shown} of {total}',
      shownEmpty: 'nothing matches these filters',
      all: 'All',
      picking: 'loading…',
      noPayload: 'no conclusion',
      close: 'Close',
      copyName: 'Copy name',
      copySha: 'Copy sha256',
      copyJson: 'Copy JSON',
      artifactFailed: 'could not read this artifact',
      reportTitle: 'Verdict',
      kbdHint: '/ search · r re-check · l theme · Esc close',
      conclusions: { go: 'go', passed: 'passed', rendered: 'rendered', blocked: 'blocked', failed: 'failed', blank: 'blank', risky: 'risky', unknown: 'cannot tell', '∅': 'no conclusion' },
      chips: { rows: 'rows', judged: 'judged', go: 'go', denied: 'denied', unknown: 'cannot tell', collisions: 'collisions' },
    }
  }
  return {
    title: '分诊台 · 证据面板',
    brand: '分诊台',
    readOnly: '只读',
    actionsEnabled: '已允许操作',
    refresh: '重新检查',
    refreshTitle: '重新读取当前 profile（r）',
    themeTitle: '主题：跟随系统 → 浅色 → 深色（l）',
    loading: '正在读取当前 profile…',
    loadingSub: '扫一遍已装集合；这里不重新判定任何东西',
    issues: '要看的地方',
    next: '下一步',
    showAll: '显示全部',
    copyReport: '复制这段结论',
    evidence: '证据',
    raw: '原始 JSON',
    name: '产物',
    kind: '类型',
    subject: '对象',
    conclusion: '结论',
    at: '生成时间',
    hash: 'sha256',
    empty: '没有找到产物。用 --results <目录> 指向别的位置，或先跑一次 record_* 脚本。',
    noIssues: '这套组合没有要处理的行。',
    more: '条未显示（摘要只列前几条，全量用 `audit --json`）',
    copy: '复制',
    copied: '已复制',
    copyFailed: '请按 Ctrl+C',
    artifactCount: '个产物',
    off: '面板以 --no-audit 启动：不读取当前 profile。去掉该参数即可看到结论。',
    failed: '读不到当前 profile',
    unjudged: '其余 {n} 行不声明任何 DSH 区间',
    searchPlaceholder: '搜索产物名 / 类型 / 对象…',
    allKinds: '全部类型',
    allConclusions: '全部结论',
    shown: '显示 {shown} / {total}',
    shownEmpty: '没有匹配的产物',
    all: '全部',
    picking: '读取中…',
    noPayload: '没有结论',
    close: '关闭',
    copyName: '复制名称',
    copySha: '复制 sha256',
    copyJson: '复制 JSON',
    artifactFailed: '读不到这份产物',
    reportTitle: '结论',
    kbdHint: '/ 搜索 · r 重新检查 · l 主题 · Esc 关闭',
    conclusions: { go: '正常', passed: '通过', rendered: '渲染正常', blocked: '被拒', failed: '失败', blank: '白屏', risky: '有风险', unknown: '判不了', '∅': '无结论' },
    chips: { rows: '行', judged: '有判定', go: '正常', denied: '被拒', unknown: '判不了', collisions: '冲突' },
  }
}
