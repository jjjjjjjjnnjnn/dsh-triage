import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { AUDIT_ROUTE_PATH, auditRequestVerdict, createAuditRouteHandler } from '../../packages/plugin/dist/host-audit-route.js'
import { resolveProfileFromBaseUrl } from '../../packages/plugin/dist/host.js'

/*
 * The tab's numbers come from this route, so its refusal rules are part of the claim (T-401 ②, R33).
 * Every case below is a request the Host can actually receive; none of them needs a socket.
 */

/** Minimal response double: records status, headers and body. */
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

test('the route refuses everything except a same-origin read', () => {
  assert.deepEqual(auditRequestVerdict({ method: 'GET', origin: undefined, secFetchSite: 'same-origin', host: '127.0.0.1:1' }), { ok: true })
  assert.deepEqual(auditRequestVerdict({ method: 'HEAD', origin: undefined, secFetchSite: 'same-origin', host: '127.0.0.1:1' }), { ok: true })
  // Browser statements: Origin must be the very host being asked.
  assert.deepEqual(auditRequestVerdict({ method: 'GET', origin: 'http://127.0.0.1:1', secFetchSite: 'same-origin', host: '127.0.0.1:1' }), { ok: true })
  const cross = auditRequestVerdict({ method: 'GET', origin: 'http://evil.example', secFetchSite: 'cross-site', host: '127.0.0.1:1' })
  assert.equal(cross.ok, false)
  assert.equal(cross.ok === false && cross.status, 403)
  // No Origin and no same-origin evidence: refuse rather than serve "probably fine" bytes.
  const silent = auditRequestVerdict({ method: 'GET', origin: undefined, secFetchSite: undefined, host: '127.0.0.1:1' })
  assert.equal(silent.ok, false)
  assert.equal(silent.ok === false && silent.status, 403)
  const post = auditRequestVerdict({ method: 'POST', origin: undefined, secFetchSite: 'same-origin', host: '127.0.0.1:1' })
  assert.equal(post.ok, false)
  assert.equal(post.ok === false && post.status, 405)
})

test('an unreadable profile is a 409 with the sentence, never an empty ledger', async () => {
  const handler = createAuditRouteHandler({ read: async () => ({ ok: false, message: 'profile-not-found — no such profile' }) })
  const response = fakeResponse()
  await handler(get({ 'sec-fetch-site': 'same-origin' }), response as never)
  assert.equal(response.record.status, 409)
  assert.match(response.record.body, /profile-not-found/)
  assert.equal(response.record.headers['cache-control'], 'no-store', 'a stale verdict is worse than none')
})

test('a readable profile is served as the CLI payload, unchanged', async () => {
  const payload = { schema_version: 1, command: 'audit', rows: [{ row_id: 'a' }], row_verdicts: [{ row_id: 'a', conclusion: 'go' }] }
  const handler = createAuditRouteHandler({ read: async () => ({ ok: true, payload }) })
  const response = fakeResponse()
  await handler(get({ 'sec-fetch-site': 'same-origin' }), response as never)
  assert.equal(response.record.status, 200)
  assert.deepEqual(JSON.parse(response.record.body), payload, 'the route may not reshape the payload')
})

test('a throwing reader becomes a 500 instead of killing the Host', async () => {
  const handler = createAuditRouteHandler({
    read: async () => {
      throw new Error('disk on fire')
    },
  })
  const response = fakeResponse()
  await handler(get({ 'sec-fetch-site': 'same-origin' }), response as never)
  assert.equal(response.record.status, 500)
  assert.match(response.record.body, /disk on fire/)
})

test('a cross-origin request never reaches the reader', async () => {
  let reads = 0
  const handler = createAuditRouteHandler({
    read: async () => {
      reads += 1
      return { ok: true, payload: {} }
    },
  })
  const response = fakeResponse()
  await handler(get({ origin: 'http://evil.example', host: '127.0.0.1:1' }), response as never)
  assert.equal(response.record.status, 403)
  assert.equal(reads, 0, 'refuse before reading the profile')
})

test('the profile is read from the loader anchor, not from a guessed default', () => {
  const fileAnchor = pathToFileURL('C:/dsh-home/profiles/web/cordis.yml')
  const fromFile = resolveProfileFromBaseUrl(fileAnchor)
  assert.ok(fromFile !== null)
  assert.equal(fromFile.profile, 'web')
  assert.match(String(fromFile.dshHome).replaceAll('\\', '/'), /dsh-home$/)

  // This Cordis version hands a plugin the profile DIRECTORY, with or without a trailing slash.
  const dirAnchor = pathToFileURL('C:/dsh-home/profiles/web/')
  const fromDir = resolveProfileFromBaseUrl(dirAnchor)
  assert.ok(fromDir !== null)
  assert.equal(fromDir.profile, 'web')
  assert.equal(fromDir.dshHome.replaceAll('\\', '/').endsWith('dsh-home'), true)

  // A base URL that is not `<home>/profiles/<name>` says nothing about the profile: return null.
  assert.equal(resolveProfileFromBaseUrl(pathToFileURL('C:/elsewhere/cordis.yml')), null)
  assert.equal(resolveProfileFromBaseUrl(undefined), null)
})

test('the route path is the one the client asks for', () => {
  assert.equal(AUDIT_ROUTE_PATH, '/compat-triage/audit')
})
