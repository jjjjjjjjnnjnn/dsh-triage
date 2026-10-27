import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { listArtifacts, renderPanelHtml, startPanel, summarizeArtifact } from '../../packages/plugin/dist/serve.js'

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

test('the page ships no remote assets, in both locales', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderPanelHtml(locale)
    assert.doesNotMatch(html, /src="https?:/, 'offline first: no remote script or image')
    assert.match(html, /<meta charset="utf-8">/)
  }
  assert.match(renderPanelHtml('en'), /Triage · evidence panel/)
  assert.match(renderPanelHtml('zh'), /分诊台 · 证据面板/)
})
