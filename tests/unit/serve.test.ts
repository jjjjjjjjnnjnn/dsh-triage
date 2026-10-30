import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { listArtifacts, renderPanelHtml, startPanel, summarizeArtifact } from '../../packages/plugin/dist/serve.js'
import type { ProfileSummary } from '../../packages/plugin/dist/summary.js'

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'triage-serve-'))
  const blank = JSON.stringify({
    schema_version: 1,
    produced_by: 'scripts/record_render_fixture.mjs',
    generated_at: '2026-10-27T14:02:15.000Z',
    sample: { kind: 'render-control', mode: 'blank' },
    render: { state: 'blank', detail: 'mount point "root" has no children' },
  })
  const probe = JSON.stringify({
    schema_version: 1,
    produced_by: 'scripts/record_probe.mjs',
    generated_at: '2026-10-27T12:59:01.000Z',
    candidate: { package: 'dsh-plugin-model-proxy', kind: 'registry' },
    conclusion: 'go',
    timings: { bootToSampleMs: 7700 },
  })
  writeFileSync(join(dir, 'render-fixture-blank-2026-10-27T14-02-15.000Z.json'), blank, 'utf8')
  writeFileSync(
    join(dir, 'render-fixture-blank-2026-10-27T14-02-15.000Z.json.sha256'),
    `${createHash('sha256').update(blank).digest('hex')}\n`,
    'utf8',
  )
  writeFileSync(join(dir, 'probe-registry-ok-2026-10-27T12-59-01.000Z.json'), probe, 'utf8')
  return dir
}

/* -------------------------------- listing --------------------------------- */

test('the panel lists artifacts newest-first and reads their headline fields', () => {
  const dir = fixtureDir()
  try {
    const listed = listArtifacts(dir)
    assert.equal(listed.length, 2)
    assert.equal(listed[0]?.name.startsWith('render-fixture-blank'), true, 'sorted descending')
    const probe = listed.find((item) => item.kind === 'probe')
    assert.equal(probe?.conclusion, 'go')
    assert.equal(probe?.subject, 'dsh-plugin-model-proxy')
    const render = listed.find((item) => item.kind === 'render')
    assert.equal(render?.conclusion, 'blank', 'render artifacts have no conclusion; the state is the headline')
    assert.equal(render?.sha256?.length, 64, 'the .sha256 file is the panel\'s proof')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreadable or unknown artifact does not crash the listing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triage-serve-'))
  try {
    writeFileSync(join(dir, 'broken.json'), '{ not json', 'utf8')
    const listed = listArtifacts(dir)
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.conclusion, null)
    assert.equal(listed[0]?.generated_at, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an artifact name is only ever a name', () => {
  const dir = fixtureDir()
  try {
    // summarizeArtifact is the only reader; the HTTP layer rejects these before calling it.
    assert.equal(summarizeArtifact(dir, 'missing.json').generated_at, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* --------------------------------- server --------------------------------- */

test('the panel is read-only, token-gated and refuses cross-origin calls', async () => {
  const dir = fixtureDir()
  const panel = await startPanel({ resultsDir: dir, locale: 'zh' })
  try {
    assert.match(panel.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=/)

    const anonymous = await fetch(`http://127.0.0.1:${panel.port}/`, { redirect: 'manual' })
    assert.equal(anonymous.status, 401, 'no token, no panel')

    const page = await fetch(panel.url)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type') ?? '', /text\/html/)
    assert.match(await page.text(), /证据面板/)
    assert.match(page.headers.get('set-cookie') ?? '', /HttpOnly/, 'the cookie must not be readable by scripts')

    const list = await fetch(`http://127.0.0.1:${panel.port}/api/artifacts?token=${panel.token}`)
    const body = (await list.json()) as { count: number; readOnly: boolean; byKind: Record<string, number> }
    assert.equal(body.count, 2)
    assert.equal(body.readOnly, true)
    assert.equal(body.byKind['render'], 1)

    const detail = await fetch(`http://127.0.0.1:${panel.port}/api/artifact?token=${panel.token}&name=probe-registry-ok-2026-10-27T12-59-01.000Z.json`)
    assert.equal(detail.status, 200)
    const payload = (await detail.json()) as { payload: { conclusion: string } }
    assert.equal(payload.payload.conclusion, 'go')

    const traversal = await fetch(`http://127.0.0.1:${panel.port}/api/artifact?token=${panel.token}&name=..%2Fpackage.json`)
    assert.equal(traversal.status, 400, 'a path is not an artifact name')

    const crossOrigin = await fetch(`http://127.0.0.1:${panel.port}/api/artifacts?token=${panel.token}`, {
      headers: { origin: 'http://evil.example' },
    })
    assert.equal(crossOrigin.status, 403)

    const post = await fetch(`http://127.0.0.1:${panel.port}/api/probe?token=${panel.token}`, { method: 'POST' })
    assert.equal(post.status, 403, 'read-only by default')

    const unknown = await fetch(`http://127.0.0.1:${panel.port}/nope?token=${panel.token}`)
    assert.equal(unknown.status, 404)
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--allow-execute opens the gate but actions stay unimplemented (501, not 200)', async () => {
  const dir = fixtureDir()
  const panel = await startPanel({ resultsDir: dir, allowExecute: true })
  try {
    const post = await fetch(`http://127.0.0.1:${panel.port}/api/probe?token=${panel.token}`, { method: 'POST' })
    assert.equal(post.status, 501)
    const body = (await post.json()) as { error: string }
    assert.match(body.error, /not implemented/)
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ----------------------------- the audit route (T-406) --------------------- */

/** The shape `buildProfileSummary()` produces; the panel must not re-derive any of it. */
function summaryFixture(): ProfileSummary {
  return {
    tone: 'attention',
    headline: 'nothing is denied, but 1 thing has no evidence either way',
    plain: 'Nothing is broken, but 1 thing we could not judge.',
    counts: { rows: 3, judged: 1, go: 0, denied: 0, unknown: 1, collisions: 0, duplicateCopies: 0, errors: 0 },
    issues: [{ id: 'hmr', kind: 'unknown', line: 'no dsh range declared', plain: 'It never says which versions it supports.', fix: null }],
    more: 0,
    next: [{ label: 'row-by-row attribution', command: 'dsh-triage why' }],
  }
}

test('the panel is started without a loader (--no-audit): 501, never an empty ledger', async () => {
  const dir = fixtureDir()
  const panel = await startPanel({ resultsDir: dir })
  try {
    const off = await fetch(`http://127.0.0.1:${panel.port}/api/audit?token=${panel.token}`)
    assert.equal(off.status, 501)
    const body = (await off.json()) as { error: string }
    assert.match(body.error, /--no-audit/, 'the answer has to name the switch that turns it back on')

    const summaryOff = await fetch(`http://127.0.0.1:${panel.port}/api/summary?token=${panel.token}`)
    assert.equal(summaryOff.status, 501, 'the verdict route is off for the same reason as the ledger')

    const health = await fetch(`http://127.0.0.1:${panel.port}/api/health?token=${panel.token}`)
    assert.equal(((await health.json()) as { audit: boolean }).audit, false)

    const anonymous = await fetch(`http://127.0.0.1:${panel.port}/api/audit`, { redirect: 'manual' })
    assert.equal(anonymous.status, 401, 'the audit route inherits the token gate')
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('/api/audit returns the payload it was given, not a re-derivation', async () => {
  const dir = fixtureDir()
  const payload = { schema_version: 1, command: 'audit', row_verdicts: [{ conclusion: 'blocked' }], collisions: [] }
  const panel = await startPanel({ resultsDir: dir, audit: async () => ({ ok: true, payload, summary: summaryFixture() }) })
  try {
    const response = await fetch(`http://127.0.0.1:${panel.port}/api/audit?token=${panel.token}`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), payload, 'byte-for-byte what the loader produced')
    // R20: the cost of the scan is published, so "the panel felt slow" has a number.
    assert.match(response.headers.get('x-triage-audit-ms') ?? '', /^\d+$/)

    const crossOrigin = await fetch(`http://127.0.0.1:${panel.port}/api/audit?token=${panel.token}`, {
      headers: { origin: 'http://evil.example' },
    })
    assert.equal(crossOrigin.status, 403)
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('/api/summary answers the first screen: the injected summary plus the env it was measured on', async () => {
  const dir = fixtureDir()
  const payload = { schema_version: 1, command: 'audit', env: { dsh: '0.1.0-rc.6', profile: 'web', platform: 'win32', arch: 'x64', profileDir: '~/x' } }
  const summary = summaryFixture()
  let calls = 0
  const panel = await startPanel({
    resultsDir: dir,
    audit: async () => {
      calls += 1
      return { ok: true, payload, summary }
    },
  })
  try {
    const response = await fetch(`http://127.0.0.1:${panel.port}/api/summary?token=${panel.token}`)
    assert.equal(response.status, 200)
    const body = (await response.json()) as {
      summary: typeof summary
      env: Record<string, string | null>
      ms: number
    }
    assert.deepEqual(body.summary, summary, 'the panel renders the summary it was handed')
    assert.equal(body.env.dsh, '0.1.0-rc.6')
    assert.equal(body.env.profile, 'web')
    assert.equal('profileDir' in body.env, false, 'the first screen never needs the profile directory')
    assert.equal(calls, 1, 'one request, one scan')
    assert.match(response.headers.get('x-triage-audit-ms') ?? '', /^\d+$/)
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a slow audit is measured, not silently absorbed', async () => {
  const dir = fixtureDir()
  const panel = await startPanel({
    resultsDir: dir,
    audit: async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
      return { ok: false, message: 'cannot read the profile: profile-not-found — nope' }
    },
  })
  try {
    const response = await fetch(`http://127.0.0.1:${panel.port}/api/audit?token=${panel.token}`)
    assert.equal(response.status, 409)
    const ms = Number(response.headers.get('x-triage-audit-ms'))
    assert.ok(ms >= 100, `the failure path carries its own duration too (got ${String(ms)}ms)`)
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreadable profile is 409 with the CLI sentence, not a clean 200', async () => {
  const dir = fixtureDir()
  const panel = await startPanel({
    resultsDir: dir,
    audit: async () => ({ ok: false, message: 'cannot read the profile: profile-not-found — nope' }),
  })
  try {
    const response = await fetch(`http://127.0.0.1:${panel.port}/api/audit?token=${panel.token}`)
    assert.equal(response.status, 409)
    assert.match(((await response.json()) as { error: string }).error, /profile-not-found/)
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a loader that throws is a 500, and the panel keeps serving', async () => {
  const dir = fixtureDir()
  const panel = await startPanel({
    resultsDir: dir,
    audit: async () => {
      throw new Error('boom')
    },
  })
  try {
    const response = await fetch(`http://127.0.0.1:${panel.port}/api/audit?token=${panel.token}`)
    assert.equal(response.status, 500)
    const health = await fetch(`http://127.0.0.1:${panel.port}/api/health?token=${panel.token}`)
    assert.equal(health.status, 200, 'one bad route must not kill the server')
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the page ships no remote assets, in both locales', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderPanelHtml(locale)
    assert.doesNotMatch(html, /src="https?:/, 'offline first: no remote script or image')
    assert.match(html, /<meta charset="utf-8">/)
  }
  assert.match(renderPanelHtml('en'), /Triage · evidence panel/)
  assert.match(renderPanelHtml('zh'), /分诊台 · 证据面板/)
})

test('the CSP lets the page call its own API (the bug R49 found by opening a browser)', async () => {
  const dir = fixtureDir()
  const panel = await startPanel({ resultsDir: dir })
  try {
    const page = await fetch(panel.url)
    const csp = page.headers.get('content-security-policy') ?? ''
    // `default-src 'none'` also governs connect-src: without this directive every fetch() on
    // the page is blocked and the panel renders an empty shell that still looks "up".
    assert.match(csp, /connect-src 'self'/, `CSP must allow same-origin fetch: ${csp}`)
    assert.match(csp, /default-src 'none'/, 'and still deny everything else')
    assert.doesNotMatch(csp, /connect-src \*/, 'never a wildcard')
  } finally {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})
