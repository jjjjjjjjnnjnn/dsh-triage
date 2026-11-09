/**
 * `GET /compat-triage/audit` — the read-only Remote the settings tab needs (T-401 ②, R33).
 *
 * WHY A ROUTE AND NOT A TYPERT REMOTE: both were measured on a real Host (R33,
 * `data/results/spike-typert-*` / `spike-route-*`). A third-party hand-written `./typert` manifest
 * IS accepted by `ctx.typert` (the endpoint appeared in the registry), but the browser half could not
 * reach it: `ctx.remote` exposes no third-party namespace, and declaring `remote.<ns>` in a
 * hand-written classic-script client made that module disappear. The route channel — the Host's own
 * `ctx.webServer.register` — worked end to end with the same no-bundler client.
 *
 * WHAT THIS ROUTE MAY SAY: exactly the payload `dsh-triage audit --json` prints. It is built by the
 * same `loadAuditData()` + `auditJsonPayload()` the CLI and the local panel use, so the tab cannot
 * drift from the CLI. It adds no judgement, no scoring and no recommendation.
 *
 * WHAT IT REFUSES: non-GET verbs, requests from another origin, and — deliberately — browser requests
 * that present no same-origin evidence at all. A tab asking for this route always sends
 * `Sec-Fetch-Site`, so refusing the silent case costs the honest caller nothing and denies the
 * page that was reached from somewhere else.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** The route path. Fixed, unparameterised: there is nothing to address but "this Host". */
export const AUDIT_ROUTE_PATH = '/compat-triage/audit'

/** Injected so tests drive the route without a real profile or a real Host. */
export interface AuditRouteDeps {
  /**
   * The same loader the CLI calls. Returning `{ ok: false }` must stay a 409 with the same sentence:
   * "not readable" and "nothing to report" must never look alike (T-406).
   */
  readonly read: () => Promise<{ ok: true; payload: unknown } | { ok: false; message: string }>
}

/**
 * The marker the settings tab sends (M10).
 *
 * WHY IT EXISTS: DSH Desktop renders the tab at `dsh-app://app` and forwards its fetches through
 * `forwardWebRequest()`, which deletes `host`, `origin`, `cookie` and `sec-fetch-site` before the
 * request reaches the Host. With both signals gone this guard could not tell a legitimate tab from
 * a silent socket, so it refused the one caller it was written for (measured 2026-11-09: 403 bare,
 * 200 with an explicit same-origin `Origin`).
 *
 * WHAT IT IS NOT: authentication. It is a caller label. What it buys is that a cross-site page
 * cannot send it without a CORS preflight, and this route never answers `OPTIONS` — so the browser
 * drops the request before it is ever made. Local non-browser processes were never in the threat
 * model (they can read the profile directly). See `docs/specs/M10-desktop-bridge.md`.
 */
export const CLIENT_MARKER_HEADER = 'x-dsh-triage-client'
export const CLIENT_MARKER_VALUE = 'settings-tab'

/** What a request has to look like. Exported so the rules can be asserted without a socket. */
export function auditRequestVerdict(input: {
  readonly method: string | undefined
  readonly origin: string | undefined
  readonly secFetchSite: string | undefined
  readonly host: string | undefined
  /** Value of {@link CLIENT_MARKER_HEADER}, when the caller sent one. */
  readonly clientMarker?: string | undefined
}): { ok: true } | { ok: false; status: number; error: string } {
  if (input.method !== 'GET' && input.method !== 'HEAD') {
    return { ok: false, status: 405, error: 'only GET is allowed' }
  }
  if (input.origin !== undefined && input.origin !== '') {
    // Same-origin is the only case that can be checked exactly: the browser states both sides.
    const expected = input.host === undefined ? null : [`http://${input.host}`, `https://${input.host}`]
    if (expected === null || !expected.includes(input.origin)) {
      return { ok: false, status: 403, error: 'cross-origin request refused' }
    }
    return { ok: true }
  }
  if (input.secFetchSite !== undefined && input.secFetchSite !== '') {
    // A browser that stated where it came from is taken at its word, and the marker has no say
    // here: if `Sec-Fetch-Site` survived, this is not the desktop bridge's stripped request.
    if (input.secFetchSite === 'same-origin') return { ok: true }
    return input.secFetchSite === 'cross-site'
      ? { ok: false, status: 403, error: 'cross-origin request refused' }
      : { ok: false, status: 403, error: 'request carries no same-origin evidence' }
  }
  // Both signals were stripped — the desktop bridge's shape. Only the labelled caller is served.
  if (input.clientMarker === CLIENT_MARKER_VALUE) return { ok: true }
  return { ok: false, status: 403, error: 'request carries no same-origin evidence' }
}

/**
 * Read the guard's input from a real request.
 *
 * One extraction, shared by all three routes: three copies of "which header means what" is how one
 * route ends up guarded slightly differently from its siblings.
 */
export function guardInputOf(request: IncomingMessage): Parameters<typeof auditRequestVerdict>[0] {
  const header = (name: string): string | undefined => {
    const value = request.headers[name]
    return typeof value === 'string' ? value : undefined
  }
  return {
    method: request.method,
    origin: header('origin'),
    secFetchSite: header('sec-fetch-site'),
    host: header('host'),
    clientMarker: header(CLIENT_MARKER_HEADER),
  }
}

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = `${JSON.stringify(payload)}\n`
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    // Evidence must not be cached by a browser: a stale verdict is worse than no verdict.
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** Build the route handler. It owns the response and never throws into the server. */
export function createAuditRouteHandler(deps: AuditRouteDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const verdict = auditRequestVerdict(guardInputOf(request))
    if (!verdict.ok) {
      sendJson(response, verdict.status, { error: verdict.error })
      return
    }
    try {
      const loaded = await deps.read()
      if (!loaded.ok) {
        // Same sentence the CLI prints for an unreadable profile; never an empty ledger.
        sendJson(response, 409, { error: loaded.message })
        return
      }
      sendJson(response, 200, loaded.payload)
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
