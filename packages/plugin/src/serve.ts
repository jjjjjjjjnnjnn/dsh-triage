/**
 * `dsh-triage serve` — the local control panel (M4 / `docs/specs/M4-surface.md` §2).
 *
 * WHAT IT IS: a read-only window onto the evidence this repo already produces. It lists
 * `data/results/*.json`, shows the conclusion and the reasons behind it, and links the
 * artifact + its `.sha256`. It deliberately does NOT re-judge anything: a panel that
 * invents conclusions would be a second engine with its own drift.
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
 * - artifact names are validated and served from a listing (no path traversal).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

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
   * `null`/absent means `/api/audit` answers **501** — never a 200 with an empty list,
   * because "not enabled" and "nothing to report" must not look alike.
   */
  readonly audit?: (() => Promise<AuditSnapshot>) | null
}

/**
 * One `audit` run, in the two shapes the panel can display.
 *
 * The payload is the exact object `dsh-triage audit --json` prints, so the panel and the CLI
 * cannot disagree without someone editing the engine (T-406's acceptance rule).
 */
export type AuditSnapshot =
  | { readonly ok: true; readonly payload: Record<string, unknown> }
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
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
    payload = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
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

function readString(value: Record<string, unknown> | null, path: readonly string[]): string | null {
  let cursor: unknown = value
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return null
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return typeof cursor === 'string' && cursor !== '' ? cursor : null
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
    audit: options.audit ?? null,
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
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'",
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
    const path = join(context.resultsDir, name)
    if (!existsSync(path) || statSync(path).size > MAX_ARTIFACT_BYTES) {
      sendJson(response, 404, { error: 'artifact not found (or larger than 2MB)' })
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

  if (url.pathname === '/api/audit') {
    if (context.audit === null) {
      // 501, not 200 with an empty ledger: "the route is off" is information the user needs.
      sendJson(response, 501, { error: 'audit is not enabled; restart the panel with `dsh-triage serve --audit`' })
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
 * The page is intentionally plain: one table, a detail pane, no framework, no remote
 * assets. Everything it shows comes from `/api/artifacts` and `/api/artifact`.
 */
export function renderPanelHtml(locale: 'en' | 'zh'): string {
  const copy =
    locale === 'zh'
      ? {
          title: '分诊台 · 证据面板',
          lede: '只读：这里显示的是 data/results 里已有的产物，不重新判定任何东西。',
          refresh: '刷新',
          empty: '没有找到产物。用 --results <目录> 指向别的位置，或先跑一次 record_* 脚本。',
          name: '产物',
          kind: '类型',
          subject: '对象',
          conclusion: '结论',
          at: '生成时间',
          hash: 'sha256',
          pick: '点一行看详情',
          readOnly: '只读模式',
          composition: '当前组合（audit，与 CLI 同一个引擎）',
          compositionOff: '未启用 /api/audit：用 `dsh-triage serve --audit` 重启面板才显示当前组合',
          compositionFailed: '读不到当前组合',
        }
      : {
          title: 'Triage · evidence panel',
          lede: 'Read-only: this lists artifacts already in data/results. It does not re-judge anything.',
          refresh: 'Refresh',
          empty: 'No artifacts found. Point --results at another directory, or run a record_* script first.',
          name: 'Artifact',
          kind: 'Kind',
          subject: 'Subject',
          conclusion: 'Conclusion',
          at: 'Generated',
          hash: 'sha256',
          pick: 'Pick a row to see the payload',
          readOnly: 'read-only',
          composition: 'Current composition (audit, same engine as the CLI)',
          compositionOff: '/api/audit is not enabled: restart with `dsh-triage serve --audit` to see the current composition',
          compositionFailed: 'the composition could not be read',
        }
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${copy.title}</title>
<style>
  :root { color-scheme: light dark; --line:#8884; --muted:#888; }
  body { font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; margin:0; padding:24px; max-width:1200px; }
  h1 { font-size:18px; margin:0 0 6px; }
  p.lede { color:var(--muted); margin:0 0 18px; }
  .bar { display:flex; gap:12px; align-items:center; margin-bottom:12px; }
  .badge { border:1px solid var(--line); border-radius:999px; padding:2px 10px; color:var(--muted); font-size:12px; }
  table { border-collapse:collapse; width:100%; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:12px; color:var(--muted); font-weight:600; }
  tbody tr { cursor:pointer; } tbody tr:hover { background:#8881; }
  code { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; }
  #detail { margin-top:18px; }
  #composition { border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin-bottom:14px; }
  #composition h2 { font-size:13px; margin:0 0 6px; color:var(--muted); }
  pre { background:#8881; padding:12px; border-radius:8px; overflow:auto; max-height:60vh; }
  .ok { color:#2b8a3e; } .bad { color:#c92a2a; } .warn { color:#e8590c; } .unknown { color:#868e96; }
</style></head>
<body>
  <h1>${copy.title}</h1>
  <p class="lede">${copy.lede}</p>
  <section id="composition">
    <h2>${copy.composition}</h2>
    <div id="composition-body" class="badge" data-off="${copy.compositionOff}" data-failed="${copy.compositionFailed}">…</div>
  </section>
  <div class="bar">
    <button id="refresh">${copy.refresh}</button>
    <span class="badge" id="mode">${copy.readOnly}</span>
    <span class="badge" id="count"></span>
  </div>
  <table>
    <thead><tr>
      <th>${copy.name}</th><th>${copy.kind}</th><th>${copy.subject}</th>
      <th>${copy.conclusion}</th><th>${copy.at}</th><th>${copy.hash}</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div id="detail"><p class="lede">${copy.pick}</p></div>
<script>
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tone = (c) => ({go:'ok', blocked:'bad', risky:'warn', unknown:'unknown', rendered:'ok', blank:'bad'}[c] ?? '');
async function load() {
  const response = await fetch('/api/artifacts');
  const data = await response.json();
  document.getElementById('count').textContent = data.count + ' artifacts';
  document.getElementById('mode').textContent = data.readOnly ? ${JSON.stringify(copy.readOnly)} : 'actions enabled';
  const rows = document.getElementById('rows');
  rows.innerHTML = '';
  if (data.count === 0) {
    rows.innerHTML = '<tr><td colspan="6">' + ${JSON.stringify(copy.empty)} + '</td></tr>';
    return;
  }
  for (const item of data.artifacts) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><code>' + esc(item.name) + '</code></td><td>' + esc(item.kind) + '</td><td>' + esc(item.subject) +
      '</td><td class="' + tone(item.conclusion) + '">' + esc(item.conclusion) + '</td><td>' + esc(item.generated_at) +
      '</td><td><code>' + esc((item.sha256 ?? '').slice(0, 12)) + '</code></td>';
    tr.onclick = () => show(item.name);
    rows.appendChild(tr);
  }
}
async function show(name) {
  const response = await fetch('/api/artifact?name=' + encodeURIComponent(name));
  const data = await response.json();
  document.getElementById('detail').innerHTML =
    '<h1>' + esc(name) + '</h1><p class="lede"><code>' + esc(data.sha256 ?? 'no .sha256') + '</code></p><pre>' +
    esc(JSON.stringify(data.payload ?? data, null, 2)) + '</pre>';
}
document.getElementById('refresh').onclick = load;
/**
 * T-406: the current composition, straight from /api/audit.
 *
 * Three answers are kept apart on purpose: disabled (501), unreadable (409 + message), and a
 * real ledger. Collapsing them would let a broken profile look like a clean one.
 */
async function loadAudit() {
  const body = document.getElementById('composition-body');
  let response;
  try {
    response = await fetch('/api/audit');
  } catch (error) {
    body.textContent = body.dataset.failed + ': ' + error.message;
    return;
  }
  if (response.status === 501) { body.textContent = body.dataset.off; return; }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    body.textContent = body.dataset.failed + ': ' + (detail.error ?? response.status);
    return;
  }
  const data = await response.json();
  const verdicts = data.row_verdicts ?? [];
  const counts = {};
  for (const verdict of verdicts) counts[verdict.conclusion] = (counts[verdict.conclusion] ?? 0) + 1;
  const parts = [
    'dsh ' + ((data.env ?? {}).dsh ?? 'unknown'),
    'profile ' + ((data.env ?? {}).profile ?? 'unknown'),
    verdicts.length + ' rows',
  ];
  for (const key of ['blocked', 'risky', 'unknown', 'go']) if (counts[key]) parts.push(key + ' ' + counts[key]);
  parts.push('collisions ' + ((data.collisions ?? []).length));
  body.textContent = parts.join(' · ');
}
load();
loadAudit();
</script>
</body></html>`
}
