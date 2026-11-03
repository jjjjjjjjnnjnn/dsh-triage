import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AUDIT_REUSE_MS, panelAuthority, startPanel } from '../../packages/plugin/dist/serve.js'
import { judgeHost } from '../../packages/plugin/dist/host-allow.js'
import type { AuditSnapshot } from '../../packages/plugin/dist/serve.js'

/*
 * Two rules that only exist at the HTTP layer, tested where they are enforced.
 *
 * ADR-0014 (T-811): a request must carry a Host that matches the bound address. `fetch()` always
 * sends the URL's host, so the hostile cases need `node:http` and an explicit header — a test
 * written with `fetch` could not express the attack at all.
 *
 * ADR-0015 (T-814): the reuse window is on the SHARED scan. The panel's refresh button reads
 * `/api/summary`, so a cache that only covered `/api/audit` would pass its own test and change
 * nothing about the thing it was supposed to fix — hence the cross-route assertion below.
 */

/** One GET with an explicit Host header (fetch cannot be asked to lie about it). */
function get(port: number, path: string, host: string): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, body, headers: response.headers as Record<string, string> }),
      )
    })
    req.on('error', reject)
    req.end()
  })
}

const summary = {
  tone: 'ok' as const,
  headline: 'nothing will break',
  plain: 'nothing to fix',
  counts: { rows: 1, judged: 1, go: 1, denied: 0, unknown: 0, collisions: 0, duplicateCopies: 0, errors: 0 },
  issues: [],
  more: 0,
  next: [],
}

const snapshot = (): AuditSnapshot => ({
  ok: true,
  payload: { schema_version: 1, command: 'audit', rows: [] },
  summary,
})

const emptyDir = (): string => mkdtempSync(join(tmpdir(), 'triage-serve-host-'))

test('ADR-0014: the printed link is a URL the Host rule accepts and a browser can parse', () => {
  /*
   * Three shapes the first implementation got wrong (independent reviewer, R75): an IPv6 literal
   * without brackets, a `--allow-host` that already carries its own port (ssh -L / reverse proxy),
   * and the wildcard bind. Every value below must survive `new URL()` AND be accepted by the rule.
   */
  const cases: Array<[string | undefined, readonly string[] | undefined, number, string]> = [
    [undefined, undefined, 5555, '127.0.0.1:5555'],
    ['127.0.0.1', undefined, 5555, '127.0.0.1:5555'],
    ['::1', undefined, 5555, '[::1]:5555'],
    ['0.0.0.0', ['panel.local'], 5555, 'panel.local:5555'],
    ['0.0.0.0', ['panel.local:8080'], 5555, 'panel.local:8080'],
    ['127.0.0.1', ['localhost:8080'], 5555, 'localhost:8080'],
  ]
  for (const [host, allowHosts, port, expected] of cases) {
    const authority = panelAuthority(host, allowHosts, port)
    assert.equal(authority, expected, `authority for host=${String(host)} allow=${String(allowHosts)}`)
    const url = new URL(`http://${authority}/?token=x`)
    assert.equal(url.host, expected, 'the printed authority must survive URL parsing unchanged')
    assert.equal(
      judgeHost({ host: expected, boundHost: host, port, allowHosts }).ok,
      true,
      `the printed link must also pass the Host rule (${authority})`,
    )
  }
})

test('ADR-0014: the panel answers its own address and refuses every other Host', async () => {
  const dir = emptyDir()
  const panel = await startPanel({ resultsDir: dir, audit: async () => snapshot() })
  try {
    const ok = await get(panel.port, `/?token=${panel.token}`, `127.0.0.1:${panel.port}`)
    assert.equal(ok.status, 200, 'the default binding keeps working with no configuration')

    for (const host of [`evil.com:${panel.port}`, `127.0.0.1.evil.com:${panel.port}`, `127.0.0.1:${panel.port + 1}`]) {
      const refused = await get(panel.port, `/?token=${panel.token}`, host)
      assert.equal(refused.status, 421, `${host} must be refused with 421, not served`)
      assert.match(refused.body, /is not the address this panel is bound to/, 'the refusal says what is wrong')
      assert.match(refused.body, /127\.0\.0\.1/, 'and quotes the address it does accept')
    }
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ADR-0014: --allow-host is the only way a second name gets in', async () => {
  const dir = emptyDir()
  const panel = await startPanel({ resultsDir: dir, allowHosts: ['panel.local'], audit: async () => snapshot() })
  try {
    const allowed = await get(panel.port, `/?token=${panel.token}`, `panel.local:${panel.port}`)
    assert.equal(allowed.status, 200)
    const stillRefused = await get(panel.port, `/?token=${panel.token}`, `other.local:${panel.port}`)
    assert.equal(stillRefused.status, 421, 'adding one name does not open the door for the rest')
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ADR-0015: one scan per second, shared by /api/summary and /api/audit', async () => {
  const dir = emptyDir()
  let scans = 0
  const panel = await startPanel({
    resultsDir: dir,
    audit: async () => {
      scans += 1
      return snapshot()
    },
  })
  try {
    const first = await get(panel.port, `/api/summary?token=${panel.token}`, `127.0.0.1:${panel.port}`)
    assert.equal(first.status, 200)
    assert.equal(scans, 1)
    assert.equal((JSON.parse(first.body) as { reused: boolean }).reused, false, 'the first answer is a real scan')

    const second = await get(panel.port, `/api/summary?token=${panel.token}`, `127.0.0.1:${panel.port}`)
    const secondBody = JSON.parse(second.body) as { reused: boolean; age_ms: number }
    assert.equal(scans, 1, 'a second click inside the window must not scan again')
    assert.equal(secondBody.reused, true)
    assert.ok(secondBody.age_ms >= 0 && secondBody.age_ms <= AUDIT_REUSE_MS, `age_ms must be inside the window, got ${secondBody.age_ms}`)

    /*
     * THE ASSERTION THIS ADR EXISTS FOR: the window is shared. If someone later moves the cache
     * onto /api/audit alone, the two lines above stay green and this one goes red.
     */
    const auditRoute = await get(panel.port, `/api/audit?token=${panel.token}`, `127.0.0.1:${panel.port}`)
    assert.equal(scans, 1, '/api/audit must reuse the same scan, not start its own')
    // `/api/audit` carries the metadata in headers: its body must stay byte-identical to
    // `dsh-triage audit --json` (R19), so it cannot grow fields of its own.
    assert.equal(auditRoute.headers['x-triage-audit-reused'], '1')

    // Outside the window a fresh scan happens: the reuse is a rate limit, not a stale verdict.
    await new Promise((resolve) => setTimeout(resolve, AUDIT_REUSE_MS + 100))
    const third = await get(panel.port, `/api/summary?token=${panel.token}`, `127.0.0.1:${panel.port}`)
    assert.equal(scans, 2, 'after the window the panel scans again')
    assert.equal((JSON.parse(third.body) as { reused: boolean }).reused, false)
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ADR-0015: a failed scan is retried, never replayed from the window', async () => {
  const dir = emptyDir()
  let scans = 0
  const panel = await startPanel({
    resultsDir: dir,
    audit: async () => {
      scans += 1
      return { ok: false, message: 'profile-not-found' }
    },
  })
  try {
    const first = await get(panel.port, `/api/summary?token=${panel.token}`, `127.0.0.1:${panel.port}`)
    const second = await get(panel.port, `/api/summary?token=${panel.token}`, `127.0.0.1:${panel.port}`)
    assert.equal(first.status, 409)
    assert.equal(second.status, 409)
    assert.equal(scans, 2, 'a failure must be retried; caching it would replay "could not read" as an answer')
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})
