import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { MIN_VISIBLE_TEXT, extractHostUrl, findBrowser, judgeRender, renderUrl, scrubBrowserStderr } from '@dsh-triage/probe'
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

/* --------------------------- browser diagnostics --------------------------- */

test('browser diagnostics never carry a machine path', () => {
  // R90 / T-860: the stderr string goes into a CI artifact, so a home directory or a scratch
  // path in it would be published. Every root is masked, longest root first.
  const scratchRoot = join(tmpdir(), 'dsh-triage-render')
  const profileDir = join(scratchRoot, 'triage-render-abc')
  const raw = [
    `[1:1:0101/000000.000:ERROR:zygote.cc(1)] could not open --user-data-dir=${profileDir}`,
    `HOME ${homedir()} TMP ${tmpdir()}`,
    'other /home/alice/crash.dmp C:\\Users\\bob\\crash.dmp',
  ].join('\n')
  const out = scrubBrowserStderr(raw, { profileDir, scratchRoot })
  assert.ok(out.includes('<profile-dir>'), 'the profile directory must be masked')
  assert.ok(!out.includes(profileDir), 'the raw profile directory must not survive')
  assert.ok(!out.includes(homedir()), 'the home directory must be masked')
  assert.ok(!out.includes('alice'), 'a POSIX home must be masked')
  assert.ok(!out.includes('bob'), 'a Windows home must be masked')
  assert.ok(out.includes('/home/<user>'), 'the POSIX shape keeps its root, not the user')
})

test('a DevTools session id and a Host token are masked too', () => {
  // A healthy browser prints the ws URL with its session id, and a real Host URL carries a
  // token; neither belongs in a published artifact.
  const out = scrubBrowserStderr(
    'DevTools listening on ws://127.0.0.1:63079/devtools/browser/81187e16-160c-458c-84d0-e1af7072f1e5\nnavigate http://127.0.0.1:53997/?token=abc_DEF-123\n',
  )
  assert.ok(out.includes('/devtools/browser/<session>'), 'the session id must be masked')
  assert.ok(!out.includes('81187e16'), 'the raw session id must not survive')
  assert.ok(out.includes('token=<redacted>'), 'the token must be masked')
  assert.ok(!out.includes('abc_DEF-123'), 'the raw token must not survive')
  assert.ok(out.includes('127.0.0.1:63079'), 'the loopback port stays: it is already in served_at')
})

test('a browser that never opens a port reports what it said, and still cannot pass', async () => {
  // The three CI reds (R81, R90 x2) stopped here with `stdio: 'ignore'`, so the reason was
  // thrown away. The diagnostic must arrive WITHOUT moving the judgement: a browser that
  // never opened a port is still `inconclusive`, never `blank`.
  const scratchRoot = mkdtempSync(join(tmpdir(), 'triage-render-test-'))
  try {
    const child = new EventEmitter() as EventEmitter & { stderr: PassThrough; pid?: number; kill: () => void }
    child.stderr = new PassThrough()
    child.kill = () => {}
    const spawnImpl = ((..._args: unknown[]) => {
      setImmediate(() => {
        child.stderr.write(
          `[1103/120000.123:ERROR:zygote_host_impl_linux.cc(90)] Running as root without --no-sandbox is not supported. data=${join(scratchRoot, 'triage-render-x')} home=${homedir()}\n`,
        )
        child.stderr.end()
        child.emit('exit', 1, null)
      })
      return child
    }) as unknown as typeof import('node:child_process').spawn

    const check = await renderUrl({ browser: '/fake/chrome', url: 'http://127.0.0.1:1/', scratchRoot, timeoutMs: 400, spawnImpl })

    assert.equal(check.state, 'inconclusive', 'a missing debugging port is not a blank page')
    assert.equal(check.detail, 'the browser never opened a debugging port')
    assert.ok((check.browserStderr ?? '').includes('without --no-sandbox'), 'the browser sentence must be kept')
    assert.equal(check.browserExit?.code, 1, 'an exited browser must be reported as such')
    assert.ok(!(check.browserStderr ?? '').includes(homedir()), 'diagnostics must be masked before they reach an artifact')
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true })
  }
})
