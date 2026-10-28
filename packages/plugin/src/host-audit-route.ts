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

/** What a request has to look like. Exported so the rules can be asserted without a socket. */
export function auditRequestVerdict(input: {
  readonly method: string | undefined
  readonly origin: string | undefined
  readonly secFetchSite: string | undefined
  readonly host: string | undefined
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
  if (input.secFetchSite === 'same-origin') return { ok: true }
  // No Origin and no same-origin hint: a browser tab always sends one of them. Refuse rather than
  // serve because "it was probably fine".
  return { ok: false, status: 403, error: 'request carries no same-origin evidence' }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
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
    const verdict = auditRequestVerdict({
      method: request.method,
      origin: typeof request.headers.origin === 'string' ? request.headers.origin : undefined,
      secFetchSite: typeof request.headers['sec-fetch-site'] === 'string' ? request.headers['sec-fetch-site'] : undefined,
      host: typeof request.headers.host === 'string' ? request.headers.host : undefined,
    })
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
