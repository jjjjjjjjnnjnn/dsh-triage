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
  const conclusion =
    readString(payload, ['conclusion']) ??
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
    off: copy.compositionOff,
    failed: copy.compositionFailed,
    artifacts: copy.artifactCount,
    readOnly: copy.readOnly,
    actions: copy.actionsEnabled,
    chips: copy.chips,
    unjudged: copy.unjudged,
  }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${copy.title}</title>
<style>
  :root { color-scheme: light dark; --line:#8883; --muted:#8a8a8a; --ok:#2b8a3e; --bad:#c92a2a; --warn:#e8590c; }
  * { box-sizing: border-box; }
  body { font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; margin:0; padding:20px 24px 48px; max-width:1080px; }
  header { display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap; }
  header h1 { font-size:15px; margin:0; }
  .grow { flex:1; }
  .badge { border:1px solid var(--line); border-radius:999px; padding:1px 9px; color:var(--muted); font-size:12px; white-space:nowrap; }
  button { font:inherit; border:1px solid var(--line); background:transparent; color:inherit; border-radius:8px; padding:5px 12px; cursor:pointer; }
  button:hover { background:#8881; }
  .hero { border:1px solid var(--line); border-left-width:6px; border-radius:12px; padding:16px 18px; margin-bottom:18px; }
  .hero.ok { border-left-color:var(--ok); }
  .hero.attention { border-left-color:var(--warn); }
  .hero.broken { border-left-color:var(--bad); }
  .hero.pending { border-left-color:var(--line); }
  .hero h2 { font-size:19px; margin:0 0 6px; line-height:1.35; }
  .hero p { margin:0; color:var(--muted); overflow-wrap:anywhere; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
  .chip { border:1px solid var(--line); border-radius:10px; padding:6px 10px; min-width:82px; }
  .chip b { display:block; font-size:18px; line-height:1.2; font-variant-numeric:tabular-nums; }
  .chip span { color:var(--muted); font-size:12px; }
  .chip.bad b { color:var(--bad); } .chip.warn b { color:var(--warn); }
  section { margin-bottom:20px; }
  h3 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 10px; }
  .card { border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin-bottom:8px; display:flex; gap:10px; align-items:flex-start; }
  .card .mark { font-weight:700; line-height:1.4; }
  .card .mark.bad { color:var(--bad); } .card .mark.warn { color:var(--warn); } .card .mark.muted { color:var(--muted); }
  .card .body { flex:1; min-width:0; }
  .card .id { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:13px; overflow-wrap:anywhere; }
  .card .line { color:var(--muted); margin-top:2px; overflow-wrap:anywhere; }
  .card button { font-size:12px; padding:3px 9px; }
  .steps { display:flex; flex-direction:column; gap:8px; }
  .step { display:flex; gap:10px; align-items:center; }
  .step code { flex:1; background:#8881; border-radius:6px; padding:6px 10px; overflow:auto; }
  .step .label { color:var(--muted); font-size:12px; min-width:170px; }
  nav.tabs { display:flex; gap:8px; border-bottom:1px solid var(--line); margin:26px 0 12px; }
  nav.tabs button { border:none; border-bottom:2px solid transparent; border-radius:0; padding:8px 10px; color:var(--muted); }
  nav.tabs button[aria-selected="true"] { color:inherit; border-bottom-color:currentColor; font-weight:600; }
  table { border-collapse:collapse; width:100%; table-layout:fixed; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; overflow-wrap:anywhere; }
  th:nth-child(1),td:nth-child(1) { width:32%; }
  th:nth-child(2),td:nth-child(2) { width:7%; }
  th:nth-child(3),td:nth-child(3) { width:15%; }
  th:nth-child(4),td:nth-child(4) { width:9%; }
  th:nth-child(5),td:nth-child(5) { width:19%; font-variant-numeric:tabular-nums; }
  th:nth-child(6),td:nth-child(6) { width:18%; }
  th { font-size:12px; color:var(--muted); font-weight:600; }
  tbody tr { cursor:pointer; } tbody tr:hover { background:#8881; }
  code { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; }
  pre { background:#8881; padding:12px; border-radius:8px; overflow:auto; max-height:60vh; }
  .muted { color:var(--muted); }
  .ok { color:var(--ok); } .bad { color:var(--bad); } .warn { color:var(--warn); }
</style></head>
<body>
<header>
  <h1>${copy.title}</h1>
  <span class="badge" id="mode">${copy.readOnly}</span>
  <span class="badge" id="env">…</span>
  <span class="grow"></span>
  <button id="refresh">${copy.refresh}</button>
</header>

<section class="hero pending" id="hero">
  <h2 id="headline">${copy.loading}</h2>
  <p id="sub">${copy.loadingSub}</p>
  <div class="chips" id="chips"></div>
</section>

<section id="issues-section" hidden>
  <h3>${copy.issues}</h3>
  <div id="issues"></div>
</section>

<section id="next-section" hidden>
  <h3>${copy.next}</h3>
  <div class="steps" id="next"></div>
</section>

<nav class="tabs" role="tablist">
  <button role="tab" data-tab="evidence" aria-selected="false">${copy.evidence}</button>
  <button role="tab" data-tab="raw" aria-selected="false">${copy.raw}</button>
</nav>
<p class="muted" id="tab-hint">${copy.tabHint}</p>
<section id="tab-evidence" hidden>
  <div class="bar"><span class="badge" id="count">…</span><span class="badge" id="results-dir"></span></div>
  <table>
    <thead><tr>
      <th>${copy.name}</th><th>${copy.kind}</th><th>${copy.subject}</th>
      <th>${copy.conclusion}</th><th>${copy.at}</th><th>${copy.hash}</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div id="detail"><p class="muted">${copy.pick}</p></div>
</section>
<section id="tab-raw" hidden><pre id="raw">…</pre></section>
<script>
const COPY = ${copyJson};
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = (id) => document.getElementById(id);
const MARK = { denied: '✗', collision: '✗', duplicate: '!', unknown: '?', unreadable: '!' };
const MARK_CLASS = { denied: 'bad', collision: 'bad', duplicate: 'warn', unknown: 'muted', unreadable: 'warn' };

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (ignored) { ok = false; }
    area.remove();
    return ok;
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (button === null) return;
  const ok = await copyText(button.getAttribute('data-copy'));
  const label = button.textContent;
  button.textContent = ok ? COPY.copied : COPY.copyFailed;
  setTimeout(() => { button.textContent = label; }, 1200);
});

function envLine(env, summary) {
  const parts = [];
  parts.push('dsh ' + (env.dsh ?? 'unknown'));
  parts.push('profile ' + (env.profile ?? 'unknown'));
  if (env.platform) parts.push(env.platform + '/' + (env.arch ?? '?'));
  if (summary.counts.rows > summary.counts.judged) {
    parts.push(COPY.unjudged.replace('{n}', summary.counts.rows - summary.counts.judged));
  }
  return parts.join(' · ');
}

function renderSummary(summary, env) {
  const hero = $('hero');
  hero.className = 'hero ' + summary.tone;
  $('headline').textContent = summary.headline;
  $('sub').textContent = envLine(env, summary);
  $('env').textContent = 'dsh ' + (env.dsh ?? 'unknown') + ' · ' + (env.profile ?? 'unknown');

  const chips = [
    ['rows', summary.counts.rows, ''],
    ['judged', summary.counts.judged, ''],
    ['go', summary.counts.go, ''],
    ['denied', summary.counts.denied, summary.counts.denied > 0 ? 'bad' : ''],
    ['unknown', summary.counts.unknown, summary.counts.unknown > 0 ? 'warn' : ''],
    ['collisions', summary.counts.collisions, summary.counts.collisions > 0 ? 'bad' : ''],
  ];
  $('chips').innerHTML = chips.map(([key, value, tone]) =>
    '<div class="chip ' + tone + '"><b>' + esc(value) + '</b><span>' + esc(COPY.chips[key]) + '</span></div>').join('');

  const issues = $('issues');
  $('issues-section').hidden = summary.issues.length === 0 && summary.more === 0;
  if (summary.issues.length === 0) {
    issues.innerHTML = '<p class="muted">' + esc(COPY.noIssues) + '</p>';
  } else {
    issues.innerHTML = summary.issues.map((issue) => {
      const mark = '<span class="mark ' + (MARK_CLASS[issue.kind] ?? 'muted') + '">' + esc(MARK[issue.kind] ?? '?') + '</span>';
      const fix = issue.fix === null
        ? ''
        : '<button data-copy="' + esc(issue.fix) + '" title="' + esc(issue.fix) + '">' + esc(COPY.copy) + '</button>';
      return '<div class="card">' + mark +
        '<div class="body"><div class="id">' + esc(issue.id) + '</div><div class="line">' + esc(issue.line) + '</div></div>' +
        fix + '</div>';
    }).join('');
    if (summary.more > 0) {
      issues.innerHTML += '<p class="muted">' + esc(summary.more + ' ' + COPY.more) + '</p>';
    }
  }

  $('next-section').hidden = summary.next.length === 0;
  // The panel is the surface you are already on: telling you to open it is noise.
  const steps = summary.next.filter((step) => step.command !== 'dsh-triage serve');
  $('next').innerHTML = steps.map((step) =>
    '<div class="step"><span class="label">' + esc(step.label) + '</span><code>' + esc(step.command) + '</code>' +
    '<button data-copy="' + esc(step.command) + '">' + esc(COPY.copy) + '</button></div>').join('');
}

async function loadSummary() {
  let response;
  try {
    response = await fetch('/api/summary');
  } catch (error) {
    $('hero').className = 'hero broken';
    $('headline').textContent = COPY.failed + ': ' + error.message;
    return;
  }
  if (response.status === 501) {
    $('hero').className = 'hero pending';
    $('headline').textContent = COPY.off;
    $('sub').textContent = '';
    return;
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    $('hero').className = 'hero broken';
    $('headline').textContent = COPY.failed + ': ' + (detail.error ?? response.status);
    return;
  }
  const body = await response.json();
  renderSummary(body.summary, body.env ?? {});
}

let evidenceLoaded = false;
async function loadEvidence() {
  const response = await fetch('/api/artifacts');
  const data = await response.json();
  $('mode').textContent = data.readOnly ? COPY.readOnly : COPY.actions;
  $('count').textContent = data.count + ' ' + COPY.artifacts;
  $('results-dir').textContent = data.resultsDir;
  const rows = $('rows');
  rows.innerHTML = '';
  if (data.count === 0) {
    rows.innerHTML = '<tr><td colspan="6">' + esc(COPY.empty) + '</td></tr>';
    return;
  }
  for (const item of data.artifacts) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><code>' + esc(item.name) + '</code></td><td>' + esc(item.kind) + '</td><td>' + esc(item.subject) +
      '</td><td class="' + esc(tone(item.conclusion)) + '">' + esc(item.conclusion) + '</td><td>' + esc(item.generated_at) +
      '</td><td><code>' + esc((item.sha256 ?? '').slice(0, 12)) + '</code></td>';
    tr.onclick = () => show(item.name);
    rows.appendChild(tr);
  }
  evidenceLoaded = true;
}

const tone = (c) => ({go:'ok', blocked:'bad', risky:'warn', unknown:'muted', rendered:'ok', blank:'bad'}[c] ?? '');

async function show(name) {
  const response = await fetch('/api/artifact?name=' + encodeURIComponent(name));
  const data = await response.json();
  $('detail').innerHTML =
    '<h3>' + esc(name) + '</h3><p class="muted"><code>' + esc(data.sha256 ?? 'no .sha256') + '</code></p><pre>' +
    esc(JSON.stringify(data.payload ?? data, null, 2)) + '</pre>';
}

let rawLoaded = false;
async function loadRaw() {
  const response = await fetch('/api/audit');
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    $('raw').textContent = COPY.failed + ': ' + (detail.error ?? response.status);
    return;
  }
  const data = await response.json();
  $('raw').textContent = JSON.stringify(data, null, 2);
  rawLoaded = true;
}

function selectTab(name) {
  for (const button of document.querySelectorAll('nav.tabs button')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === name));
  }
  $('tab-hint').hidden = name !== '';
  $('tab-evidence').hidden = name !== 'evidence';
  $('tab-raw').hidden = name !== 'raw';
  if (name === 'evidence' && !evidenceLoaded) loadEvidence();
  if (name === 'raw' && !rawLoaded) loadRaw();
}

for (const button of document.querySelectorAll('nav.tabs button')) {
  button.onclick = () => selectTab(button.dataset.tab);
}
$('refresh').onclick = () => { loadSummary(); if (evidenceLoaded) loadEvidence(); if (rawLoaded) loadRaw(); };
loadSummary();
// Deep links: the panel can be opened straight onto the evidence tab when that is what the
// person came for (the CLI prints the plain URL, but a link is a link).
if (location.hash === '#evidence' || location.hash === '#raw') selectTab(location.hash.slice(1));
</script>
</body></html>`
}

interface PanelCopy {
  readonly title: string
  readonly readOnly: string
  readonly actionsEnabled: string
  readonly refresh: string
  readonly loading: string
  readonly loadingSub: string
  readonly issues: string
  readonly next: string
  readonly evidence: string
  readonly raw: string
  readonly tabHint: string
  readonly name: string
  readonly kind: string
  readonly subject: string
  readonly conclusion: string
  readonly at: string
  readonly hash: string
  readonly pick: string
  readonly empty: string
  readonly noIssues: string
  readonly more: string
  readonly copy: string
  readonly copied: string
  readonly copyFailed: string
  readonly noFix: string
  readonly artifactCount: string
  readonly compositionOff: string
  readonly compositionFailed: string
  readonly unjudged: string
  readonly chips: Readonly<Record<string, string>>
}

function panelCopy(locale: 'en' | 'zh'): PanelCopy {
  if (locale === 'en') {
    return {
      title: 'Triage · evidence panel',
      readOnly: 'read-only',
      actionsEnabled: 'actions enabled',
      refresh: 'Re-check',
      loading: 'Reading the current profile…',
      loadingSub: 'one scan of the installed set; nothing is re-judged here',
      issues: 'What to look at',
      next: 'Next',
      evidence: 'Evidence (data/results)',
      raw: 'Raw JSON (audit --json)',
      tabHint: 'The verdict above rests on these: pick a tab to see the artifacts or the full payload.',
      name: 'Artifact',
      kind: 'Kind',
      subject: 'Subject',
      conclusion: 'Conclusion',
      at: 'Generated',
      hash: 'sha256',
      pick: 'Pick a row to see the payload',
      empty: 'No artifacts found. Point --results at another directory, or run a record_* script first.',
      noIssues: 'Nothing to act on in this composition.',
      more: 'more (the summary is capped; `audit --json` has the full list)',
      copy: 'Copy',
      copied: 'Copied',
      copyFailed: 'Press Ctrl+C',
      noFix: 'no command',
      artifactCount: 'artifacts',
      compositionOff: 'The panel was started with --no-audit: it does not read the current profile. Drop the flag to see the verdict.',
      compositionFailed: 'the profile could not be read',
      unjudged: '{n} rows declare no DSH range at all',
      chips: { rows: 'rows', judged: 'judged', go: 'go', denied: 'denied', unknown: 'cannot tell', collisions: 'collisions' },
    }
  }
  return {
    title: '分诊台 · 证据面板',
    readOnly: '只读',
    actionsEnabled: '已允许操作',
    refresh: '重新检查',
    loading: '正在读取当前 profile…',
    loadingSub: '扫一遍已装集合；这里不重新判定任何东西',
    issues: '要看的地方',
    next: '下一步',
    evidence: '证据（data/results）',
    raw: '原始 JSON（audit --json）',
    tabHint: '上面的结论就建立在这些东西上：点页签看产物或完整 payload。',
    name: '产物',
    kind: '类型',
    subject: '对象',
    conclusion: '结论',
    at: '生成时间',
    hash: 'sha256',
    pick: '点一行看详情',
    empty: '没有找到产物。用 --results <目录> 指向别的位置，或先跑一次 record_* 脚本。',
    noIssues: '这套组合没有要处理的行。',
    more: '条未显示（摘要只列前几条，全量用 `audit --json`）',
    copy: '复制',
    copied: '已复制',
    copyFailed: '请按 Ctrl+C',
    noFix: '没有命令',
    artifactCount: '个产物',
    compositionOff: '面板以 --no-audit 启动：不读取当前 profile。去掉该参数即可看到结论。',
    compositionFailed: '读不到当前 profile',
    unjudged: '其余 {n} 行不声明任何 DSH 区间',
    chips: { rows: '行', judged: '有判定', go: '正常', denied: '被拒', unknown: '判不了', collisions: '冲突' },
  }
}
