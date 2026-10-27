#!/usr/bin/env node
/**
 * Render-check negative control (M3 / T-302).
 *
 * WHY A SEPARATE RECORDER: `record_probe.mjs` renders a real Host, and a real Host that
 * mounts nothing is hard to manufacture honestly. This script proves the *detector* can
 * fail by serving two pages from a loopback HTTP server — `blank` (200 + an empty mount
 * point, the white-screen shape) and `rendered` (200 + mounted content) — and judging both
 * with the same `renderUrl` + `judgeRender` the probe uses, in a real browser.
 *
 *   node scripts/record_render_fixture.mjs --mode blank --browser <chrome> --stamp <iso>
 *
 * Exit codes: 0 recorded and matched · 1 recorded but the expectation was not met
 * · 2 bad usage · 3 no browser available.
 */

import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { findBrowser, judgeRender, renderUrl } from '../packages/probe/dist/index.js'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
if (stamp === null) {
  process.stderr.write('invalid --stamp; expected ISO-8601, e.g. 2026-10-27T12:00:00.000Z\n')
  process.exit(2)
}
const mode = String(argOf('--mode', 'blank'))
if (mode !== 'blank' && mode !== 'rendered') {
  process.stderr.write('usage: node scripts/record_render_fixture.mjs --mode <blank|rendered> [--browser <path>] [--expect <blank|rendered>] [--stamp <iso>]\n')
  process.exit(2)
}
const expectation = String(argOf('--expect', mode))
const browser = findBrowser({ explicit: argOf('--browser', null) })
if (browser === null) {
  process.stderr.write('no Chromium-family browser found; pass --browser <path> (the control must not fake a result)\n')
  process.exit(3)
}
const outDir = pathFor(String(argOf('--out', 'data/results')))

const PAGES = {
  // 200 + an empty mount point: this is what a white screen looks like over the wire.
  blank: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>triage blank fixture</title></head><body><div id="root"></div><script>console.error("the client half threw before it could mount")</script></body></html>`,
  rendered: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>triage rendered fixture</title></head><body><div id="root"><main><h1>mounted</h1><p>This page has a mounted root and more than twenty visible characters.</p></main></div></body></html>`,
}

const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') {
    response.writeHead(204)
    response.end()
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(PAGES[mode])
})

const port = await new Promise((resolvePort, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    resolvePort(typeof address === 'object' && address !== null ? address.port : 0)
  })
})

let check
try {
  check = await renderUrl({
    browser,
    url: `http://127.0.0.1:${port}/`,
    scratchRoot: join(tmpdir(), 'dsh-triage-render-fixture'),
  })
} finally {
  server.close()
}

const judgement = judgeRender(check.signals)
const expectationMet = judgement.state === expectation

const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_render_fixture.mjs',
  generated_at: stamp,
  sample: { kind: 'render-control', mode, served_at: `http://127.0.0.1:${port}/` },
  expectation,
  expectation_met: expectationMet,
  render: {
    state: check.state,
    detail: check.detail,
    ms: check.ms,
    signals:
      check.signals === null
        ? null
        : {
            title_length: check.signals.title.length,
            ready_state: check.signals.readyState,
            body_children: check.signals.bodyChildren,
            root_id: check.signals.rootId,
            root_children: check.signals.rootChildren,
            text_length: check.signals.textLength,
            html_bytes: check.signals.htmlBytes,
          },
  },
  judged: { state: judgement.state, detail: judgement.detail },
  limits: [
    'this is a detector control, not a measurement of any plugin',
    'it proves the render judgement can fail on a 200 response with an empty mount point',
    'the page is static; a real Host serving a broken client is a different shape (T-305 keeps collecting those)',
  ],
}

mkdirSync(outDir, { recursive: true })
const target = join(outDir, `render-fixture-${mode}-${stamp.replaceAll(':', '-')}.json`)
const text = `${JSON.stringify(artifact, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

process.stdout.write(`wrote ${target}\n`)
process.stdout.write(`served ${mode} · judged ${judgement.state} (${judgement.detail}) · ${check.ms}ms\n`)
if (!expectationMet) {
  process.stderr.write(`expectation not met: expected ${expectation}, got ${judgement.state}\n`)
  process.exit(1)
}
process.exit(0)
