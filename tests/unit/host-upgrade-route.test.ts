import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  UPGRADE_ROUTE_PATH,
  createUpgradeRouteHandler,
  parseUpgradeTag,
} from '../../packages/plugin/dist/host-upgrade-route.js'

/*
 * T-818: the four-bucket route. The property that matters most is the same one the summary route
 * has: a failed read must never be served in the shape of a clean result. A zero-filled bucket table
 * reads as "nothing will break", and this route is not allowed to invent that.
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

const get = (url = UPGRADE_ROUTE_PATH, headers: Record<string, string> = {}) => ({ method: 'GET', url, headers }) as never
const sameOrigin = { 'sec-fetch-site': 'same-origin' }

test('the path is fixed and the only parameter is the two keyword tags', () => {
  assert.equal(UPGRADE_ROUTE_PATH, '/compat-triage/upgrade')
  assert.equal(parseUpgradeTag(UPGRADE_ROUTE_PATH), 'next', 'no tag means next')
  assert.equal(parseUpgradeTag(`${UPGRADE_ROUTE_PATH}?to=latest`), 'latest')
  assert.equal(parseUpgradeTag(`${UPGRADE_ROUTE_PATH}?to=next`), 'next')
  assert.equal(parseUpgradeTag(`${UPGRADE_ROUTE_PATH}?to=canary`), null, 'an arbitrary version is refused')
})

test('a readable registry is served as the host payload, unchanged', async () => {
  const body = {
    target: { tag: 'next', version: '0.2.1-rc.5', relation: 'newer' },
    profile: 'web',
    current: '0.2.1-rc.4',
    counts: { bundles: 2, rows: 190, would_be_denied: 119, cannot_tell: 73, improved: 0, likely_fine: 0, total: 192 },
    buckets: [
      { bucket: 'would-be-denied', count: 119 },
      { bucket: 'cannot-tell', count: 73 },
      { bucket: 'improved', count: 0 },
      { bucket: 'likely-fine', count: 0 },
    ],
    units: [],
    more: 0,
    registry: { consulted: false, facts: 0, failures: [] },
    ms: 42,
    limits: ['declaration layer only'],
  }
  const handler = createUpgradeRouteHandler({ read: async () => ({ ok: true, body }) })
  const response = fakeResponse()
  await handler(get(UPGRADE_ROUTE_PATH, sameOrigin), response as never)
  assert.equal(response.record.status, 200)
  assert.deepEqual(JSON.parse(response.record.body), body, 'the route may not reshape the impact')
  assert.equal(response.record.headers['cache-control'], 'no-store')
})

test('a registry or profile that cannot be read keeps its own status and adds no buckets', async () => {
  for (const [status, message] of [
    [409, 'profile-not-found — no such profile'],
    [502, 'registry unavailable: network-error'],
    [504, 'the scan took 21000ms, over the 20s budget'],
  ] as const) {
    const handler = createUpgradeRouteHandler({ read: async () => ({ ok: false, status, message }) })
    const response = fakeResponse()
    await handler(get(UPGRADE_ROUTE_PATH, sameOrigin), response as never)
    assert.equal(response.record.status, status)
    assert.match(response.record.body, new RegExp(message.slice(0, 12)))
    assert.equal(response.record.body.includes('"counts"'), false, 'no counts may ride along with an error')
  }
})

test('an arbitrary tag is a 400 and the reader is never called', async () => {
  let called = false
  const handler = createUpgradeRouteHandler({
    read: async () => {
      called = true
      return { ok: true, body: {} }
    },
  })
  const response = fakeResponse()
  await handler(get(`${UPGRADE_ROUTE_PATH}?to=0.2.1-rc.5`, sameOrigin), response as never)
  assert.equal(response.record.status, 400)
  assert.equal(called, false)
})

test('the guard is the audit route guard: no same-origin evidence, no answer', async () => {
  const handler = createUpgradeRouteHandler({ read: async () => ({ ok: true, body: {} }) })
  const silent = fakeResponse()
  await handler(get(), silent as never)
  assert.equal(silent.record.status, 403)
  const post = fakeResponse()
  await handler({ method: 'POST', url: UPGRADE_ROUTE_PATH, headers: sameOrigin } as never, post as never)
  assert.equal(post.record.status, 405)
})
