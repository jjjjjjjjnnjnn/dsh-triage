/**
 * `GET /compat-triage/upgrade?to=next|latest` — the four-bucket impact, on demand (R61 / T-818).
 *
 * WHY ON DEMAND: the summary route answers "is this profile broken" from a local scan. The upgrade
 * route answers "what would the target runtime deny", which needs the npm registry. A settings tab
 * that read the registry every time it opened would be slow, surprising, and impossible to explain.
 * So this route is **only fetched when the person clicks the button**, and it says so in the payload.
 *
 * WHAT IT REUSES: the same `loadAuditData()` scan as `/compat-triage/summary`, the same
 * `judgeUpgradeImpact` as `dsh-triage upgrade --to`, and the same `resolveDistTagTarget` as the CLI.
 * There is no second range rule here (铁律 1: the wording and the numbers are the conclusion).
 *
 * WHAT IT REFUSES: non-GET, another origin, no same-origin evidence, a tag other than the two
 * keywords, a registry that cannot be read (502, not an empty bucket list), a profile that cannot be
 * read (409), and a scan that takes longer than the 20s budget (504). An empty table would read as
 * "nothing will break", which is the one answer this route is not allowed to invent.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { auditRequestVerdict, guardInputOf, sendJson } from './host-audit-route.js'

export const UPGRADE_ROUTE_PATH = '/compat-triage/upgrade'
export const UPGRADE_TAGS = ['next', 'latest'] as const
export type UpgradeTag = (typeof UPGRADE_TAGS)[number]

export interface UpgradeRouteDeps {
  /**
   * Resolve the tag, scan the profile and judge the target. `status` is part of the answer:
   * `409` is "profile unreadable", `502` is "registry unreadable", `504` is "budget exceeded".
   */
  readonly read: (
    tag: UpgradeTag,
  ) => Promise<
    | { readonly ok: true; readonly body: unknown }
    | { readonly ok: false; readonly status: 400 | 409 | 502 | 504; readonly message: string }
  >
}

/** Parse `?to=`; only the two keyword tags are accepted, and the default is `next`. */
export function parseUpgradeTag(url: string | undefined): UpgradeTag | null {
  let requested: string | null = null
  try {
    const parsed = new URL(String(url ?? '/'), 'http://127.0.0.1')
    requested = parsed.searchParams.get('to')
  } catch {
    return null
  }
  if (requested === null || requested === '') return 'next'
  return UPGRADE_TAGS.includes(requested as UpgradeTag) ? (requested as UpgradeTag) : null
}

export function createUpgradeRouteHandler(deps: UpgradeRouteDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const verdict = auditRequestVerdict(guardInputOf(request))
    if (!verdict.ok) {
      sendJson(response, verdict.status, { error: verdict.error })
      return
    }
    const tag = parseUpgradeTag(request.url)
    if (tag === null) {
      sendJson(response, 400, { error: `--to must be one of ${UPGRADE_TAGS.join(', ')}; got ${String(request.url)}` })
      return
    }
    try {
      const loaded = await deps.read(tag)
      if (!loaded.ok) {
        sendJson(response, loaded.status, { error: loaded.message })
        return
      }
      sendJson(response, 200, loaded.body)
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
