/**
 * R49 UI pass: the panel has to be *usable*, and the things that made it unusable were all
 * invisible to HTTP-level tests. These pin the contract the page relies on.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { renderPanelHtml, summarizeArtifact } from '../../packages/plugin/dist/serve.js'

for (const locale of ['zh', 'en'] as const) {
  test(`${locale}: every COPY key the page reads is shipped in the injected copy`, () => {
    const html = renderPanelHtml(locale)
    const marker = 'const COPY = '
    const start = html.indexOf(marker)
    assert.ok(start > 0, 'the page must ship a copy blob')
    const from = start + marker.length
    const to = html.indexOf('\nconst esc', from)
    assert.ok(to > from, 'the copy blob must end before the helper script')
    const parsed = JSON.parse(html.slice(from, to).trim().replace(/;$/, '')) as Record<string, unknown>

    // The first browser pass found this the hard way: `allKinds`, `allConclusions` and
    // `kbdHint` were read by the script but never injected, so the selects and the keyboard
    // hint rendered empty. A missing key is now a failing test, not a blank control.
    const used = new Set([...html.matchAll(/COPY\.([A-Za-z0-9_]+)/g)].map((match) => String(match[1])))
    const missing = [...used].filter((key) => !(key in parsed))
    assert.deepEqual(missing, [], `${locale} reads COPY keys that were never injected: ${missing.join(', ')}`)
    assert.ok(used.size > 20, `the page should actually use the copy (saw ${used.size} keys)`)
  })

  test(`${locale}: the controls a person needs are present and CSP-safe`, () => {
    const html = renderPanelHtml(locale)
    // Search + two filters + sortable headers + drawer + theme + deep links.
    for (const id of ['search', 'kind', 'conclusion', 'drawer', 'theme', 'refresh', 'counts', 'issues', 'next', 'rows', 'view-simple', 'view-advanced', 'hero-actions']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing control #${id}`)
    }
    assert.match(html, /data-sort="generated_at"/, 'the artifact table must be sortable')
    assert.match(html, /#artifact=/, 'an artifact can be linked directly')
    assert.match(html, /#theme=/, 'a link can carry the theme (screenshots, docs)')
    assert.match(html, /id="tab-evidence" hidden/, 'the evidence tab starts closed')
    // No inline handlers: the page must work under `script-src 'unsafe-inline'` without
    // becoming an XSS surface, and behaviour stays in one place.
    assert.doesNotMatch(html, /<[^>]+\son(click|load|change|input|submit)=/i, 'no inline event handlers')
    assert.match(html, /aria-live="polite"/, 'the verdict is announced when it arrives')
    // A first-time user gets one sentence and one button; the ledger is one click away.
    assert.match(html, /<body data-view="simple">/, 'the page opens in the simple view')
    assert.match(html, /only-simple/, 'simple-view text exists')
    assert.match(html, /only-advanced/, 'the detailed wording still exists')
    assert.match(html, /id="view-simple"[^>]*aria-pressed="true"/, 'simple is the pressed state on load')
    assert.match(html, /checked in \{ms\} ms|检查用时 \{ms\} 毫秒/, 'the panel says how long the check took')
  })
}

test('the listing reads the outcome recorders actually write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triage-summary-'))
  try {
    const cases: [string, unknown, string | null][] = [
      ['verdict.json', { conclusion: 'go' }, 'go'],
      ['passed.json', { passed: true }, 'passed'],
      ['failed.json', { passed: false }, 'failed'],
      ['gates.json', { ok: true, mode: 'normal' }, 'passed'],
      ['case.json', { expectation_met: true }, 'passed'],
      ['none.json', { schema_version: 1 }, null],
    ]
    for (const [name, payload, expected] of cases) {
      writeFileSync(join(dir, name), JSON.stringify(payload), 'utf8')
      assert.equal(summarizeArtifact(dir, name).conclusion, expected, `${name} should read as ${String(expected)}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
