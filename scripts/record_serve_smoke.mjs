#!/usr/bin/env node
/**
 * `dsh-triage serve` smoke recorder (M4 form A).
 *
 * Starts the real panel over the repo's `data/results`, walks the routes a human would use,
 * and writes ONE artifact describing what answered what. No screenshots, no browser: the
 * panel is plain HTTP + inline HTML by design (`docs/adr/0003` discipline).
 *
 *   node scripts/record_serve_smoke.mjs --stamp 2026-10-27T14:10:00.000Z
 *
 * Exit codes: 0 every expectation met · 1 an expectation failed · 2 bad usage.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { makeRedactor, redactDeep } from './lib/live.mjs'
import { startPanel } from '../packages/plugin/dist/serve.js'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
if (stamp === null) {
  process.stderr.write('invalid --stamp; expected ISO-8601, e.g. 2026-10-27T14:10:00.000Z\n')
  process.exit(2)
}
const resultsDir = pathFor(String(argOf('--results', 'data/results')))
const outDir = pathFor(String(argOf('--out', 'data/results')))
// Same redaction discipline as every other recorder: the artifact may say WHICH directory,
// never the absolute path (R14 F-2 / `results-privacy` gate).
const redact = makeRedactor([abs('.'), homedir(), tmpdir()])

const panel = await startPanel({ resultsDir, locale: 'zh' })
const checks = []
const check = (id, ok, detail) => checks.push({ id, ok, detail })

const get = async (path, init) => {
  const response = await fetch(`http://127.0.0.1:${panel.port}${path}`, init)
  const text = await response.text()
  return { status: response.status, text, headers: response.headers }
}

try {
  const anonymous = await get('/')
  check('token-required', anonymous.status === 401, `GET / without token → ${anonymous.status}`)

  const page = await get(`/?token=${panel.token}`)
  check(
    'page-renders',
    page.status === 200 && page.text.includes('证据面板') && page.text.includes('/api/artifacts'),
    `GET / → ${page.status}, ${page.text.length} bytes`,
  )

  const health = await get(`/api/health?token=${panel.token}`)
  const healthBody = JSON.parse(health.text)
  check('health', health.status === 200 && healthBody.ok === true, `ok=${healthBody.ok} readOnly=${healthBody.readOnly}`)

  const listing = await get(`/api/artifacts?token=${panel.token}`)
  const list = JSON.parse(listing.text)
  check(
    'artifacts-listed',
    listing.status === 200 && list.count > 0,
    `${list.count} artifacts · kinds ${Object.entries(list.byKind ?? {}).map(([k, v]) => `${k}:${v}`).join(' ')}`,
  )

  const firstProbe = (list.artifacts ?? []).find((item) => item.kind === 'probe')
  if (firstProbe === undefined) {
    check('artifact-detail', false, 'no probe artifact to open')
  } else {
    const detail = await get(`/api/artifact?token=${panel.token}&name=${encodeURIComponent(firstProbe.name)}`)
    const body = JSON.parse(detail.text)
    check(
      'artifact-detail',
      detail.status === 200 && typeof body.payload === 'object' && body.payload !== null,
      `${firstProbe.name} → ${detail.status}, sha256=${String(body.sha256 ?? 'none').slice(0, 12)}`,
    )
  }

  const traversal = await get(`/api/artifact?token=${panel.token}&name=${encodeURIComponent('../package.json')}`)
  check('traversal-refused', traversal.status === 400, `../package.json → ${traversal.status}`)

  const crossOrigin = await get(`/api/artifacts?token=${panel.token}`, { headers: { origin: 'http://evil.example' } })
  check('cross-origin-refused', crossOrigin.status === 403, `Origin: evil → ${crossOrigin.status}`)

  const post = await get(`/api/probe?token=${panel.token}`, { method: 'POST' })
  check('post-read-only', post.status === 403, `POST /api/probe → ${post.status}`)
} finally {
  // `fetch` keeps its sockets alive; a plain close() would leave them open and Node can
  // abort while tearing down (observed on Windows, libuv async.c assertion).
  panel.server.closeAllConnections?.()
  await new Promise((resolveClose) => panel.server.close(() => resolveClose()))
}

const failed = checks.filter((item) => !item.ok)
const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_serve_smoke.mjs',
  generated_at: stamp,
  panel: { results_dir: redact(resultsDir), port: panel.port, read_only: true, url_shape: 'http://127.0.0.1:<port>/?token=<token>' },
  checks: redactDeep(checks, redact),
  passed: failed.length === 0,
  limits: [
    'this proves the panel answers and refuses the ways it claims to; it is not a UI review',
    'no browser is involved: the page is inline HTML and the API is plain JSON',
    'the token and port are not written to this artifact',
  ],
}

mkdirSync(outDir, { recursive: true })
const target = join(outDir, `serve-smoke-${stamp.replaceAll(':', '-')}.json`)
const text = `${JSON.stringify(artifact, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

for (const item of checks) process.stdout.write(`${item.ok ? 'ok  ' : 'FAIL'} ${item.id.padEnd(20)} ${item.detail}\n`)
process.stdout.write(`wrote ${target}\n`)
// No `process.exit()`: let the loop drain, otherwise Windows can abort while a socket is
// still closing (measured in this script's first run).
process.exitCode = failed.length === 0 ? 0 : 1
