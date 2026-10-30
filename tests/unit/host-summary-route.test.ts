import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SUMMARY_ROUTE_PATH, createSummaryRouteHandler } from '../../packages/plugin/dist/host-summary-route.js'

/*
 * The settings tab shows whatever this route answers, so its refusals and its failure sentences are
 * part of the claim (R51). Every case below is a request the Host can actually receive; none needs a
 * socket.
 *
 * The property that matters most: a failure must never be served in the shape of a clean result.
 * Before R51 the tab rendered zero-counts for a route that had answered nothing at all, which reads
 * exactly like "your profile is fine".
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

const get = (headers: Record<string, string> = {}) => ({ method: 'GET', headers }) as never

const sameOrigin = { 'sec-fetch-site': 'same-origin' }

test('the path is fixed and unparameterised, like the audit route', () => {
  assert.equal(SUMMARY_ROUTE_PATH, '/compat-triage/summary')
  assert.ok(!SUMMARY_ROUTE_PATH.includes('?'), 'nothing to address but "this Host"')
})

test('a readable profile is served as one scan in both locales', async () => {
  const body = {
    env: { dsh: '0.2.1-rc.4', profile: 'web', platform: 'win32', arch: 'x64' },
    summary: {
      zh: { tone: 'ok', headline: '没问题', plain: '这套装能跑。', counts: { rows: 1 }, issues: [], more: 0, next: [] },
      en: { tone: 'ok', headline: 'fine', plain: 'This setup runs.', counts: { rows: 1 }, issues: [], more: 0, next: [] },
    },
    ms: 41,
  }
  const handler = createSummaryRouteHandler({ read: async () => ({ ok: true, body }) })
  const response = fakeResponse()
  await handler(get(sameOrigin), response as never)
  assert.equal(response.record.status, 200)
  assert.deepEqual(JSON.parse(response.record.body), body, 'the route may not reshape the projection')
  assert.equal(response.record.headers['cache-control'], 'no-store', 'a stale conclusion is worse than none')
})

test('an unreadable profile is a 409 with the reader sentence, never a zero-count summary', async () => {
  const handler = createSummaryRouteHandler({ read: async () => ({ ok: false, message: 'profile-not-found — no such profile' }) })
  const response = fakeResponse()
  await handler(get(sameOrigin), response as never)
  assert.equal(response.record.status, 409)
  assert.match(response.record.body, /profile-not-found/)
  assert.equal(response.record.body.includes('summary'), false, 'no summary field may ride along with the error')
})

test('a throwing reader becomes a 500 instead of killing the Host', async () => {
  const handler = createSummaryRouteHandler({
    read: async () => {
      throw new Error('disk on fire')
    },
  })
  const response = fakeResponse()
  await handler(get(sameOrigin), response as never)
  assert.equal(response.record.status, 500)
  assert.match(response.record.body, /disk on fire/)
})

test('the guard is the audit route guard: no Origin, no same-origin evidence, no answer', async () => {
  const handler = createSummaryRouteHandler({ read: async () => ({ ok: true, body: { summary: null } }) })

  const silent = fakeResponse()
  await handler(get(), silent as never)
  assert.equal(silent.record.status, 403)

  const cross = fakeResponse()
  await handler(get({ origin: 'http://evil.example', 'sec-fetch-site': 'cross-site', host: '127.0.0.1:1' }), cross as never)
  assert.equal(cross.record.status, 403)

  const post = fakeResponse()
  await handler({ method: 'POST', headers: sameOrigin } as never, post as never)
  assert.equal(post.record.status, 405, 'a read-only route accepts reads only')
})
