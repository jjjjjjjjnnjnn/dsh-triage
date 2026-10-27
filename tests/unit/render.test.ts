import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MIN_VISIBLE_TEXT, extractHostUrl, findBrowser, judgeRender } from '@dsh-triage/probe'
import type { RenderSignals } from '@dsh-triage/probe'

function signals(overrides: Partial<RenderSignals> = {}): RenderSignals {
  return {
    title: 'DeepSeek Harness',
    readyState: 'complete',
    bodyChildren: 4,
    rootId: 'root',
    rootChildren: 1,
    textLength: 320,
    htmlBytes: 553_575,
    ...overrides,
  }
}

/* --------------------------------- judging -------------------------------- */

test('a mounted root with visible text is rendered', () => {
  const judgement = judgeRender(signals())
  assert.equal(judgement.state, 'rendered')
  assert.match(judgement.detail, /1 child/)
})

test('an empty mount root is a white screen, not a pass', () => {
  const judgement = judgeRender(signals({ rootChildren: 0, textLength: 0, htmlBytes: 3_000 }))
  assert.equal(judgement.state, 'blank')
  assert.match(judgement.detail, /has no children/)
})

test('a mounted root with children but no text is inconclusive, not blank', () => {
  // An icon-only or canvas-only panel is a real UI with no text; calling it blank would
  // publish a false "white screen" (R15 review finding).
  const judgement = judgeRender(signals({ rootChildren: 2, textLength: 0 }))
  assert.equal(judgement.state, 'inconclusive')
  assert.match(judgement.detail, /no visible text/)
})

test('a browser error page is not a rendered plugin', () => {
  // Measured: Chrome's ERR_CONNECTION_REFUSED page has body children and 77 visible chars
  // and no #root. Judging body children scored the browser's page as `rendered`.
  const judgement = judgeRender(signals({ rootId: null, rootChildren: 0, bodyChildren: 3, textLength: 77, htmlBytes: 308_101 }))
  assert.equal(judgement.state, 'inconclusive')
  assert.match(judgement.detail, /no #root or #app mount point/)
})

test('a 404 page is not a rendered plugin either', () => {
  assert.equal(judgeRender(signals({ rootId: null, bodyChildren: 1, textLength: 52 })).state, 'inconclusive')
})

test('an empty document is inconclusive, never blank or rendered', () => {
  assert.equal(judgeRender(null).state, 'inconclusive')
  assert.equal(judgeRender(signals({ htmlBytes: 0 })).state, 'inconclusive')
})

test('a document still loading is inconclusive', () => {
  assert.equal(judgeRender(signals({ readyState: 'loading' })).state, 'inconclusive')
})

test('the visible-text threshold is the documented constant', () => {
  assert.equal(MIN_VISIBLE_TEXT, 20)
  assert.equal(judgeRender(signals({ textLength: 19 })).state, 'blank')
  assert.equal(judgeRender(signals({ textLength: 20 })).state, 'rendered')
})

/* -------------------------------- host URL -------------------------------- */

test('the launcher URL is parsed and its token never leaves this layer', () => {
  const stdout = 'dsh web: http://127.0.0.1:53997/?token=abc_DEF-123\n'
  const found = extractHostUrl(stdout)
  assert.equal(found?.port, 53997)
  assert.equal(found?.url.split('?')[0], 'http://127.0.0.1:53997/')
})

test('the newest URL wins when the Host restarted', () => {
  const stdout = [
    'dsh web: http://127.0.0.1:53000/?token=first',
    'dsh web: http://127.0.0.1:53001/?token=second',
  ].join('\n')
  assert.equal(extractHostUrl(stdout)?.port, 53001)
})

test('a URL without a token is not a readiness source', () => {
  assert.equal(extractHostUrl('dsh web: http://127.0.0.1:3080/\n'), null)
})

test('an empty or unrelated log yields no URL', () => {
  assert.equal(extractHostUrl(''), null)
  assert.equal(extractHostUrl('dsh: warning: patch: entry "x" not found'), null)
})

test('a localhost URL is accepted as well as 127.0.0.1', () => {
  assert.equal(extractHostUrl('ready at http://localhost:41234/?token=t')?.port, 41234)
})

test('a URL-safe Base64 token with . = % + is still recognised', () => {
  // The narrower class dropped these and published "the Host printed no URL" (R15 review).
  const stdout = 'dsh web: http://127.0.0.1:53997/?token=ab.cd%2Fef+gh==\n'
  assert.equal(extractHostUrl(stdout)?.port, 53997)
})

/* -------------------------------- browser --------------------------------- */

test('an explicit browser is used only when it exists', () => {
  assert.equal(findBrowser({ explicit: '/opt/chrome', exists: (path) => path === '/opt/chrome' }), '/opt/chrome')
  assert.equal(findBrowser({ explicit: '/opt/missing', exists: () => false }), null)
})

test('DSH_TRIAGE_BROWSER is honoured, and a broken path is not silently swapped', () => {
  const env = { DSH_TRIAGE_BROWSER: '/env/chrome' }
  assert.equal(findBrowser({ env, platform: 'linux', exists: (path) => path === '/env/chrome' }), '/env/chrome')
  assert.equal(findBrowser({ env, platform: 'linux', exists: () => false }), null)
})

test('no browser anywhere is a first-class answer', () => {
  assert.equal(findBrowser({ env: {}, platform: 'linux', exists: () => false }), null)
})

test('the Windows lookup finds Edge and Chrome in their usual places', () => {
  const seen: string[] = []
  const found = findBrowser({
    env: { PROGRAMFILES: 'C:/Program Files', 'PROGRAMFILES(X86)': 'C:/Program Files (x86)' },
    platform: 'win32',
    exists: (path) => {
      seen.push(path)
      return path.endsWith('msedge.exe')
    },
  })
  assert.ok(found?.endsWith('msedge.exe'))
  assert.ok(seen.some((path) => path.includes('Program Files (x86)')))
})
