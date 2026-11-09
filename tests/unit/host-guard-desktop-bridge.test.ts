import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  CLIENT_MARKER_HEADER,
  CLIENT_MARKER_VALUE,
  auditRequestVerdict,
  createAuditRouteHandler,
} from '../../packages/plugin/dist/host-audit-route.js'
import { createSummaryRouteHandler } from '../../packages/plugin/dist/host-summary-route.js'
import { UPGRADE_ROUTE_PATH, createUpgradeRouteHandler } from '../../packages/plugin/dist/host-upgrade-route.js'

/*
 * M10 · the desktop bridge carries no same-origin evidence.
 *
 * DSH Desktop renders the tab at `dsh-app://app` and forwards its fetches through
 * `forwardWebRequest()`, which DELETES `host`, `origin`, `cookie` and `sec-fetch-site` before the
 * request reaches the Host (measured 2026-11-09: the same GET answered 403 bare and 200 with an
 * explicit same-origin `Origin`). Every guard in this repository therefore refused the one caller
 * it was written for, and the settings tab showed "读取失败 · 403" to a human who had installed the
 * plugin to read an answer.
 *
 * The fix is a marker header, and the point of this file is to prove it is a widening that stays
 * narrow. N1 (no marker, no evidence) and N10 (marker, three routes) are the two eyes: N10 alone
 * would be a hole anybody could read through; N1 alone would leave the desktop tab broken.
 */

function fakeResponse() {
  const record = { status: 0, headers: {} as Record<string, string>, body: '' }
  return {
    record,
    writeHead: (status: number, headers: Record<string, string>) => {
      record.status = status
      record.headers = headers
    },
    end: (body: string) => {
      record.body = body
    },
  }
}

const BRIDGED = { [CLIENT_MARKER_HEADER]: CLIENT_MARKER_VALUE }
const HOST = '127.0.0.1:57654'

const verdict = (input: Partial<Parameters<typeof auditRequestVerdict>[0]> = {}) =>
  auditRequestVerdict({ method: 'GET', origin: undefined, secFetchSite: undefined, host: HOST, ...input })

/* ── the pure rule ─────────────────────────────────────────────────────────── */

test('the marker names exactly one caller, and both ends read it from the same constant', () => {
  assert.equal(CLIENT_MARKER_HEADER, 'x-dsh-triage-client')
  assert.equal(CLIENT_MARKER_VALUE, 'settings-tab')
  // C5: the browser half must carry the SAME string; a rename on one side is a silent 403.
  const client = readFileSync(new URL('../../packages/plugin/client.js', import.meta.url), 'utf8')
  assert.ok(client.includes(CLIENT_MARKER_HEADER), 'client.js must send the marker header')
  assert.ok(client.includes(CLIENT_MARKER_VALUE), 'client.js must send the marker value')
  // …and it must send it on BOTH reads (summary and the on-demand upgrade), not just declare it.
  const sends = client.split('[CLIENT_MARKER_HEADER]: CLIENT_MARKER_VALUE').length - 1
  assert.equal(sends, 2, 'both fetch calls the tab makes must carry the marker — one is a silent 403')
})

test('N10: the bridged shape (no Origin, no Sec-Fetch-Site, marker) is served', () => {
  assert.deepEqual(verdict({ clientMarker: CLIENT_MARKER_VALUE }), { ok: true })
})

test('N1: without the marker the old refusal stands, word for word', () => {
  const bare = verdict()
  assert.equal(bare.ok, false)
  assert.equal(bare.ok === false && bare.status, 403)
  assert.equal(bare.ok === false && bare.error, 'request carries no same-origin evidence')
})

test('N2: a foreign Origin is refused even when the marker rides along', () => {
  const crossed = verdict({ origin: 'https://evil.example', clientMarker: CLIENT_MARKER_VALUE })
  assert.equal(crossed.ok, false)
  assert.equal(crossed.ok === false && crossed.status, 403)
  assert.equal(crossed.ok === false && crossed.error, 'cross-origin request refused')
})

test('N3/N4: the two standard shapes are untouched by the new branch', () => {
  assert.deepEqual(verdict({ origin: `http://${HOST}` }), { ok: true })
  assert.deepEqual(verdict({ origin: `https://${HOST}` }), { ok: true })
  assert.deepEqual(verdict({ secFetchSite: 'same-origin' }), { ok: true })
  // …and still refused when they are wrong, marker or not.
  assert.equal(verdict({ origin: 'http://evil.example' }).ok, false)
  assert.equal(verdict({ secFetchSite: 'same-site' }).ok, false)
})

test('N5: the new branch cannot widen the verb', () => {
  const post = verdict({ method: 'POST', clientMarker: CLIENT_MARKER_VALUE })
  assert.equal(post.ok, false)
  assert.equal(post.ok === false && post.status, 405)
  const del = verdict({ method: 'DELETE', clientMarker: CLIENT_MARKER_VALUE })
  assert.equal(del.ok === false && del.status, 405)
})

test('N6/N7: the marker is matched exactly — no prefix, no case folding of the value', () => {
  for (const wrong of ['', 'settings-tab-v2', 'curl', 'settings-tab ']) {
    assert.equal(verdict({ clientMarker: wrong }).ok, false, `value ${JSON.stringify(wrong)} must not pass`)
  }
})

test('N8: a present Sec-Fetch-Site outranks the marker, so ⑤ and ⑥ stay two cases', () => {
  const crossed = verdict({ secFetchSite: 'cross-site', clientMarker: CLIENT_MARKER_VALUE })
  assert.equal(crossed.ok, false)
  assert.equal(crossed.ok === false && crossed.status, 403)
  assert.equal(
    crossed.ok === false && crossed.error,
    'cross-origin request refused',
    'a stated cross-site request must be reported as cross-origin, not as "no evidence"',
  )
  // `none` is a top-level navigation, not a cross-site call: the sentence must not accuse it.
  const none = verdict({ secFetchSite: 'none', clientMarker: CLIENT_MARKER_VALUE })
  assert.equal(none.ok, false)
  assert.equal(none.ok === false && none.error, 'request carries no same-origin evidence')
})

/* ── the three routes share the guard ──────────────────────────────────────── */

interface RouteCase {
  readonly name: string
  readonly handler: (reads: { count: number }) => (request: never, response: never) => Promise<void>
  readonly request: (headers: Record<string, string>, method: string) => never
}

const routes: readonly RouteCase[] = [
  {
    name: 'audit',
    handler: (reads) =>
      createAuditRouteHandler({
        read: async () => {
          reads.count += 1
          return { ok: true, payload: { route: 'audit' } }
        },
      }) as never,
    request: (headers, method) => ({ method, headers }) as never,
  },
  {
    name: 'summary',
    handler: (reads) =>
      createSummaryRouteHandler({
        read: async () => {
          reads.count += 1
          return { ok: true, body: { summary: null } }
        },
      }) as never,
    request: (headers, method) => ({ method, headers }) as never,
  },
  {
    name: 'upgrade',
    handler: (reads) =>
      createUpgradeRouteHandler({
        read: async () => {
          reads.count += 1
          return { ok: true, body: {} }
        },
      }) as never,
    request: (headers, method) => ({ method, url: UPGRADE_ROUTE_PATH, headers }) as never,
  },
]

test('N9: every route still refuses the bare request, before touching the profile', async () => {
  for (const route of routes) {
    const reads = { count: 0 }
    const response = fakeResponse()
    await route.handler(reads)(route.request({}, 'GET'), response as never)
    assert.equal(response.record.status, 403, `${route.name} must refuse a bridged-less bare request`)
    assert.equal(reads.count, 0, `${route.name} must refuse before reading the profile`)
  }
})

test('N10: every route serves the bridged request — one guard, three routes', async () => {
  for (const route of routes) {
    const reads = { count: 0 }
    const response = fakeResponse()
    await route.handler(reads)(route.request(BRIDGED, 'GET'), response as never)
    assert.equal(response.record.status, 200, `${route.name} must serve the desktop bridge`)
    assert.equal(reads.count, 1, `${route.name} must reach the reader exactly once`)
  }
})

test('N5 (routes): the marker never turns a write into a read', async () => {
  for (const route of routes) {
    const reads = { count: 0 }
    const response = fakeResponse()
    await route.handler(reads)(route.request(BRIDGED, 'POST'), response as never)
    assert.equal(response.record.status, 405, `${route.name} must refuse POST`)
    assert.equal(reads.count, 0, `${route.name} must not read on a refused verb`)
  }
})
