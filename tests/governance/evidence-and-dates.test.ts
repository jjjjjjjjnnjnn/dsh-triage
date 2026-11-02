/**
 * Two governance checks that came out of R66's independent adversary (R67).
 *
 * 1. **T-835** — a recorder that accepts `--out` must not print a hard-coded `data/results/…` path. The
 *    same bug was copied twice in one day (`watch_next_release.mjs` → `record_usability_smoke.mjs`), and
 *    both times it was invisible with the default `--out`: the tool reported a file that did not exist
 *    and stayed silent about the one it wrote.
 *
 * 2. **T-837** — `registry.json`'s `posted_on` and the D5 artifact's `window.posted_on` are two
 *    hand-written dates for the same event. R66 made each of them valid; nothing compared them. One hour
 *    apart is exactly the shape of the R64 timezone mistake, and it would move a 14-day window.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { test } from 'node:test'

import { writeEvidence } from '../../scripts/lib/evidence.mjs'
import { parseInstant } from '../../scripts/lib/posting.mjs'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const readJson = (path: string) => JSON.parse(read(path))
const listScripts = () => readdirSync(new URL('../../scripts/', import.meta.url)).filter((name) => name.endsWith('.mjs'))

test('a recorder that takes --out never prints a hard-coded data/results path (T-835)', () => {
  const offenders: string[] = []
  for (const name of listScripts()) {
    const source = read(`scripts/${name}`)
    if (!source.includes("'--out'")) continue
    // The literal `ssot data/results/` in a template string is the bug: the path was not derived.
    if (/ssot data\/results\//.test(source)) offenders.push(name)
  }
  assert.deepEqual(offenders, [], `these recorders accept --out but print a fixed data/results path: ${offenders.join(', ')}`)
})

test('writeEvidence derives the printed path from the file it actually wrote', () => {
  const root = process.cwd()
  const outDir = `${root}/.evidence-probe`
  try {
    const written = writeEvidence({ outDir, fileName: 'probe.json', text: '{"a":1}\n', root })
    assert.equal(written.ok, true)
    if (written.ok !== true) return
    // Inside the repo the display is repo-relative; the file is where the display says.
    assert.equal(written.display, '.evidence-probe/probe.json')
    assert.equal(readFileSync(written.target, 'utf8'), '{"a":1}\n')
    assert.equal(readFileSync(`${written.target}.sha256`, 'utf8'), written.sha256)

    // A second write to the same name is refused rather than silently overwriting evidence.
    const again = writeEvidence({ outDir, fileName: 'probe.json', text: '{"a":2}\n', root })
    assert.equal(again.ok, false)
    assert.equal(readFileSync(written.target, 'utf8'), '{"a":1}\n')
  } finally {
    // A dot-directory at the repo root, created and removed inside this test: nothing is committed.
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('the registry date and the D5 window start are the same instant (T-837)', () => {
  const registry = readJson('docs/distribution/T-810/registry.json') as {
    drafts: { file: string, status: string, posted_url: string | null, posted_on: string | null }[]
  }
  const evidenceFiles = readdirSync(new URL('../../data/results/', import.meta.url))
    .filter((name) => name.startsWith('d5-evidence-') && name.endsWith('.json'))
    .sort()
  assert.ok(evidenceFiles.length > 0, 'expected at least one d5-evidence artifact')

  const newest = readJson(`data/results/${evidenceFiles[evidenceFiles.length - 1]}`) as {
    post?: { url?: string }
    window?: { posted_on?: string | null }
  }
  const sampleUrl = newest.post?.url ?? null
  assert.ok(typeof sampleUrl === 'string' && sampleUrl.length > 0, 'the newest D5 artifact must name its sample post')
  const windowStart = newest.window?.posted_on ?? null
  assert.ok(typeof windowStart === 'string', 'the newest D5 artifact must carry a window start')

  const posted = registry.drafts.find((draft) => draft.status === 'posted' && draft.posted_url === sampleUrl)
  assert.ok(posted !== undefined, `no posted draft records the D5 sample (${sampleUrl})`)

  // Compare instants, not spellings: an offset form and a Z form of the same moment must agree.
  const a = parseInstant(posted?.posted_on)
  const b = parseInstant(windowStart)
  assert.ok(a !== null && b !== null, 'both dates must be real instants')
  assert.equal(a?.epochMs, b?.epochMs, `registry says ${String(posted?.posted_on)}, the D5 artifact says ${windowStart}`)
})
