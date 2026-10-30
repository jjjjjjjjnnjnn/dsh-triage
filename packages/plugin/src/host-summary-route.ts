/**
 * `GET /compat-triage/summary` — the one-screen answer, for the settings tab (R51).
 *
 * WHY A SECOND ROUTE INSTEAD OF A SIBLING KEY ON `/compat-triage/audit`: that route's contract is
 * "this payload is exactly what `dsh-triage audit --json` prints", and the tab's `same-source` check
 * relies on it. Adding a field there would quietly weaken a promise that has real evidence behind it.
 * The summary is a *different projection of the same scan*, so it gets its own path and its own
 * promise: **the numbers here are the numbers the CLI prints**, built by `buildProfileSummary()` —
 * the same function `serve`'s `/api/summary` and `dsh-triage status` call.
 *
 * WHAT THIS ROUTE MAY SAY: `{ env, summary: { zh, en }, ms }`. Two locales because the browser half
 * cannot call our host code and must not translate judgement language itself (铁律 1: the wording of
 * a conclusion is part of the conclusion). Picking which one to show is presentation; producing them
 * is not.
 *
 * WHAT IT REFUSES: identical to the audit route — non-GET verbs, another origin, and browser calls
 * that present no same-origin evidence at all. Sharing `auditRequestVerdict()` is deliberate: two
 * routes that guard themselves slightly differently is how one of them ends up open.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { auditRequestVerdict, sendJson } from './host-audit-route.js'

/** The route path. Fixed and unparameterised, like the audit route. */
export const SUMMARY_ROUTE_PATH = '/compat-triage/summary'

/** Injected so tests drive the route without a real profile or a real Host. */
export interface SummaryRouteDeps {
  /**
   * One scan, projected. `{ok:false}` must stay a 409 with the reader's own sentence: "not readable"
   * and "nothing to report" must never look alike (T-406).
   */
  readonly read: () => Promise<{ ok: true; body: unknown } | { ok: false; message: string }>
}

/** Build the route handler. It owns the response and never throws into the server. */
export function createSummaryRouteHandler(deps: SummaryRouteDeps) {
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
        sendJson(response, 409, { error: loaded.message })
        return
      }
      sendJson(response, 200, loaded.body)
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
