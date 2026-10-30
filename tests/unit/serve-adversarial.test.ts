/**
 * Adversarial tests for the local panel (R49).
 *
 * The panel is the one part of the product that opens a socket, so it gets the hostile
 * treatment: names that try to leave the results directory, files that try to exhaust memory,
 * methods it never promised, origins that are almost `127.0.0.1`, and a hundred tabs hitting
 * the same scan. Every case here is a *refusal* the panel must keep making; none of them is
 * about the verdict itself.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { startPanel } from '../../packages/plugin/dist/serve.js'
import type { ProfileSummary } from '../../packages/plugin/dist/summary.js'

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'triage-adversarial-'))
}

function summary(): ProfileSummary {
  return {
    tone: 'ok',
    headline: 'no problems found',
    counts: { rows: 1, judged: 1, go: 1, denied: 0, unknown: 0, collisions: 0, duplicateCopies: 0, errors: 0 },
    issues: [],
    more: 0,
    next: [],
  }
}

async function withPanel<T>(options: Parameters<typeof startPanel>[0], body: (panel: Awaited<ReturnType<typeof startPanel>>) => Promise<T>): Promise<T> {
  const panel = await startPanel(options)
  try {
    return await body(panel)
  } finally {
    panel.server.closeAllConnections?.()
    await new Promise<void>((resolve) => panel.server.close(() => resolve()))
  }
}

/* ----------------------------- names that travel --------------------------- */

test('every traversal spelling is refused before the disk is touched', async () => {
  const root = dir()
  try {
    writeFileSync(join(root, 'ok.json'), '{"a":1}', 'utf8')
    await withPanel({ resultsDir: root }, async (panel) => {
      const names = [
        '../package.json',
        '..\\package.json',
        '..%2Fpackage.json',
        '%2e%2e%2fpackage.json',
        '%2e%2e%5cpackage.json',
        'a/../../b.json',
        'a\\..\\..\\b.json',
        'C:\\Windows\\win.ini',
        'C:/Windows/win.ini',
        '/etc/passwd',
        '\\\\server\\share\\x.json',
        'ok.json:stream',
        'ok.json::$DATA',
        'ok.json\u0000.txt',
        '\uFF0Fetc\uFF0Fpasswd',
        '\u2025\u2025/package.json',
        '..',
        '.',
        '',
        '   ',
      ]
      for (const name of names) {
        const response = await fetch(`http://127.0.0.1:${panel.port}/api/artifact?token=${panel.token}&name=${encodeURIComponent(name)}`)
        assert.equal(response.status, 400, `name ${JSON.stringify(name)} must be refused with 400, got ${response.status}`)
        const body = (await response.json()) as { error: string }
        assert.match(body.error, /plain \*\.json file name/)
      }
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a name that is a legal file name but does not exist is a 404, not a crash', async () => {
  const root = dir()
  try {
    await withPanel({ resultsDir: root }, async (panel) => {
      const response = await fetch(`http://127.0.0.1:${panel.port}/api/artifact?token=${panel.token}&name=missing.json`)
      assert.equal(response.status, 404)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a link inside the results directory cannot point the panel outside it', async (t) => {
  const root = dir()
  const outside = dir()
  try {
    writeFileSync(join(outside, 'secret.json'), '{"secret":"do-not-serve"}', 'utf8')
    let linked = false
    try {
      symlinkSync(join(outside, 'secret.json'), join(root, 'linked.json'), 'file')
      linked = true
    } catch {
      // Windows refuses file symlinks without developer mode; a junction needs no privilege.
      try {
        symlinkSync(outside, join(root, 'linked.json'), 'junction')
        linked = true
      } catch {
        linked = false
      }
    }
    if (!linked) {
      t.skip('this machine refuses both symlinks and junctions')
      return
    }
    await withPanel({ resultsDir: root }, async (panel) => {
      const response = await fetch(`http://127.0.0.1:${panel.port}/api/artifact?token=${panel.token}&name=linked.json`)
      assert.equal(response.status, 404, 'the realpath containment check must refuse the escape')
      assert.ok(!(await response.text()).includes('do-not-serve'))
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

/* ---------------------------- size and malformed --------------------------- */

test('an artifact over 2MB is refused by the detail route and never parsed by the listing', async () => {
  const root = dir()
  try {
    // 2MB + 1 byte of valid-ish JSON: big enough to matter, small enough to write quickly.
    const big = `{"pad":"${'x'.repeat(2 * 1024 * 1024)}"}`
    writeFileSync(join(root, 'huge.json'), big, 'utf8')
    writeFileSync(join(root, 'small.json'), '{"conclusion":"go"}', 'utf8')
    await withPanel({ resultsDir: root }, async (panel) => {
      const detail = await fetch(`http://127.0.0.1:${panel.port}/api/artifact?token=${panel.token}&name=huge.json`)
      assert.equal(detail.status, 404)

      const listing = await fetch(`http://127.0.0.1:${panel.port}/api/artifacts?token=${panel.token}`)
      assert.equal(listing.status, 200)
      const body = (await listing.json()) as { count: number; artifacts: { name: string; bytes: number; conclusion: string | null }[] }
      assert.equal(body.count, 2, 'the big file is still listed by name')
      const huge = body.artifacts.find((item) => item.name === 'huge.json')
      assert.ok(huge !== undefined)
      assert.equal(huge.conclusion, null, 'an unparsed file must not pretend to have a conclusion')
      assert.ok(huge.bytes > 2 * 1024 * 1024)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('malformed JSON is a 422, and the listing still answers', async () => {
  const root = dir()
  try {
    writeFileSync(join(root, 'broken.json'), '{ "a": ', 'utf8')
    await withPanel({ resultsDir: root }, async (panel) => {
      const detail = await fetch(`http://127.0.0.1:${panel.port}/api/artifact?token=${panel.token}&name=broken.json`)
      assert.equal(detail.status, 422)
      assert.match(((await detail.json()) as { error: string }).error, /not valid JSON/)
      const listing = await fetch(`http://127.0.0.1:${panel.port}/api/artifacts?token=${panel.token}`)
      assert.equal(listing.status, 200)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/* -------------------------------- methods --------------------------------- */

test('only GET is served; POST is a gated refusal and everything else is 405', async () => {
  const root = dir()
  try {
    await withPanel({ resultsDir: root }, async (panel) => {
      for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
        const response = await fetch(`http://127.0.0.1:${panel.port}/api/artifacts?token=${panel.token}`, { method })
        assert.equal(response.status, 405, `${method} must be 405, got ${response.status}`)
      }
      const head = await fetch(`http://127.0.0.1:${panel.port}/api/artifacts?token=${panel.token}`, { method: 'HEAD' })
      assert.equal(head.status, 405, 'HEAD is not promised; the panel says so instead of guessing')
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/* --------------------------------- token ---------------------------------- */

test('the token is the only way in: wrong, empty and near-miss tokens are 401', async () => {
  const root = dir()
  try {
    await withPanel({ resultsDir: root }, async (panel) => {
      for (const token of ['', 'x', `${panel.token}x`, panel.token.slice(0, -1), panel.token.toUpperCase()]) {
        const response = await fetch(`http://127.0.0.1:${panel.port}/api/artifacts?token=${encodeURIComponent(token)}`)
        assert.equal(response.status, 401, `token ${JSON.stringify(token)} must not pass`)
      }
      // The cookie the page sets is a valid credential; that is the designed path.
      const cookie = await fetch(`http://127.0.0.1:${panel.port}/api/artifacts`, {
        headers: { cookie: `triage_token=${panel.token}` },
      })
      assert.equal(cookie.status, 200)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('origins that merely start with 127.0.0.1 are still cross-origin', async () => {
  const root = dir()
  try {
    await withPanel({ resultsDir: root }, async (panel) => {
      const hostile = [
        'http://127.0.0.1.evil.example',
        'http://evil.example/127.0.0.1',
        'https://127.0.0.1',
        'http://localhost.evil.example',
        'null',
      ]
      for (const origin of hostile) {
        const response = await fetch(`http://127.0.0.1:${panel.port}/api/artifacts?token=${panel.token}`, { headers: { origin } })
        assert.equal(response.status, 403, `origin ${origin} must be refused`)
      }
      for (const origin of [`http://127.0.0.1:${panel.port}`, 'http://localhost:3000']) {
        const response = await fetch(`http://127.0.0.1:${panel.port}/api/artifacts?token=${panel.token}`, { headers: { origin } })
        assert.equal(response.status, 200, `origin ${origin} is local and allowed`)
      }
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/* ------------------------------- concurrency ------------------------------ */

test('ten concurrent readers share one scan, and the next request scans again', async () => {
  const root = dir()
  let calls = 0
  try {
    await withPanel(
      {
        resultsDir: root,
        audit: async () => {
          calls += 1
          await new Promise((resolve) => setTimeout(resolve, 40))
          return { ok: true, payload: { env: { dsh: 'x' } }, summary: summary() }
        },
      },
      async (panel) => {
        const responses = await Promise.all(
          Array.from({ length: 10 }, () => fetch(`http://127.0.0.1:${panel.port}/api/summary?token=${panel.token}`)),
        )
        assert.deepEqual(responses.map((response) => response.status), Array(10).fill(200))
        assert.equal(calls, 1, 'pile-up protection: ten tabs, one profile read')

        const after = await fetch(`http://127.0.0.1:${panel.port}/api/summary?token=${panel.token}`)
        assert.equal(after.status, 200)
        assert.equal(calls, 2, 'no TTL: the next click re-reads the profile')
      },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a scan that throws still releases the single-flight slot', async () => {
  const root = dir()
  let calls = 0
  try {
    await withPanel(
      {
        resultsDir: root,
        audit: async () => {
          calls += 1
          throw new Error('boom')
        },
      },
      async (panel) => {
        const first = await fetch(`http://127.0.0.1:${panel.port}/api/summary?token=${panel.token}`)
        assert.equal(first.status, 500)
        const second = await fetch(`http://127.0.0.1:${panel.port}/api/summary?token=${panel.token}`)
        assert.equal(second.status, 500, 'the panel keeps serving')
        assert.equal(calls, 2, 'a failed scan must not be reused forever')
      },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/* --------------------------------- headers -------------------------------- */

test('JSON responses are nosniff and uncached', async () => {
  const root = dir()
  try {
    await withPanel({ resultsDir: root }, async (panel) => {
      const response = await fetch(`http://127.0.0.1:${panel.port}/api/artifacts?token=${panel.token}`)
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.match(response.headers.get('content-type') ?? '', /application\/json/)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
