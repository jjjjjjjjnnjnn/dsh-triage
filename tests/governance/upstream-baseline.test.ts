/**
 * The upstream baseline the entry documents quote must equal what the artifact measured (R99).
 *
 * WHY: `next` moved to `0.2.2-rc.2` in R97 and the artifact recorded it, but `AGENTS.md`, the ROADMAP tail
 * and the HANDOFF status block all kept saying `0.2.2-rc.1`; `docs/07-environment.md` was two rounds older
 * still (0.2.1-rc.2, plus the "this machine trails by 8 rc" sentence R91 had already disproved). Four
 * hand-maintained copies, no recomputation — the `BS-64` shape that R97 opened and R99 found again.
 *
 * HOW IT LOCKS IT: the expectation is read from the newest committed `next-release-*.json` (the artifact
 * that actually asked the registry), and every named document must carry that pair on one line. Adding a
 * document to the list is the point: a fact with a second home must be listed here or it is not checked.
 *
 * WHAT IT DOES NOT DO: it does not read the network, does not compare semver and does not say which of the
 * two tags you should upgrade to — only that the documents repeat what was measured.
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { judgeTagClaims } from '../../scripts/lib/upstream-baseline.mjs'

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

/** The documents that state the upstream baseline in prose or in a table row. */
const DOCUMENTS: Array<{ file: string, marker: string }> = [
  { file: 'AGENTS.md', marker: '**上游**' },
  { file: 'docs/ROADMAP.md', marker: '上游基线 `@deepseek-ai/dsh`' },
  { file: 'docs/HANDOFF.md', marker: '`@deepseek-ai/dsh` 的' },
  { file: 'docs/07-environment.md', marker: '上游基线（开发目标）' },
]

function newestObservation(): { file: string, latest: string, next: string } {
  const files = readdirSync(new URL('data/results/', root))
    .filter((name) => /^next-release-.*\.json$/.test(name))
    .sort()
  assert.ok(files.length > 0, 'expected at least one committed next-release artifact')
  for (const name of [...files].reverse()) {
    const payload = JSON.parse(read(`data/results/${name}`)) as {
      latest?: { version?: string }
      next?: { version?: string }
    }
    const latest = payload.latest?.version
    const next = payload.next?.version
    // Old artifacts (before R94) carry no `latest` block; they cannot state the pair, so they are not a baseline.
    if (typeof latest === 'string' && typeof next === 'string' && latest.length > 0 && next.length > 0) {
      return { file: name, latest, next }
    }
  }
  assert.fail('no next-release artifact carries both a `latest` and a `next` version')
}

const claimRegion = (file: string, marker: string): string => {
  const line = read(file)
    .split('\n')
    .find((candidate) => candidate.includes(marker))
  assert.ok(line !== undefined, `${file} must state the upstream baseline on a line containing "${marker}"`)
  /*
   * Slice from the marker: the ROADMAP's baseline sits at the tail of a very long Stand paragraph that
   * earlier names OUR OWN `latest=0.3.8`. Judging the whole line read that number as upstream's `latest` —
   * a parser bug the first run of this test caught. The claim region is what follows its own marker.
   */
  return line.slice(line.indexOf(marker))
}

test('every entry document repeats the upstream versions the newest artifact measured', () => {
  const expected = newestObservation()
  assert.ok(expected.latest !== expected.next, `if upstream's tags agree (${expected.latest}) this test proves nothing — assert the pair elsewhere instead`)
  const problems: string[] = []
  for (const { file, marker } of DOCUMENTS) {
    const verdict = judgeTagClaims({ line: claimRegion(file, marker), expected })
    if (!verdict.ok) problems.push(`${file}: ${verdict.detail}`)
  }
  assert.deepEqual(problems, [], `the documents disagree with ${expected.file} — ${problems.join(' · ')}`)
})

test('a document that names the previous rc is red, not "close enough"', () => {
  // N1: the negative control. The line below is the exact string three documents carried until R99.
  const verdict = judgeTagClaims({
    line: '- `@deepseek-ai/dsh` 的 `next` = **`0.2.2-rc.1`**，**`latest` 已于 2026-11-05T13:21:52Z 转正…',
    expected: { latest: '0.2.2-rc.1', next: '0.2.2-rc.2' },
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.claims.next, '0.2.2-rc.1', 'the parser must read the stale claim, not skip it')
  assert.ok(verdict.problems.some((problem) => problem.includes('0.2.2-rc.1')), verdict.detail)
})

test('a line that dropped the latest claim is red too', () => {
  // N2: `docs/07-environment.md` stayed wrong precisely by losing its `latest` claim.
  const verdict = judgeTagClaims({
    line: '| 上游基线（开发目标） | **0.2.1-rc.2** | npm dist-tags.latest |',
    expected: { latest: '0.2.2-rc.1', next: '0.2.2-rc.2' },
  })
  assert.equal(verdict.ok, false)
  assert.deepEqual(verdict.claims, { latest: null, next: null })
  assert.equal(verdict.problems.length, 2, verdict.detail)
})

test('a document that is missing the marker is a failure, not a skip', () => {
  const expected = newestObservation()
  const verdict = judgeTagClaims({ line: 'nothing about upstream here', expected })
  assert.equal(verdict.ok, false, 'a line with no tag marker must not pass by having nothing to compare')
})

test('the artifact that states a version pair must itself be readable and dated', () => {
  const expected = newestObservation()
  const payload = JSON.parse(read(`data/results/${expected.file}`)) as { generated_at?: string, produced_by?: string }
  assert.equal(payload.produced_by, 'scripts/watch_next_release.mjs')
  assert.ok(typeof payload.generated_at === 'string' && Number.isFinite(Date.parse(payload.generated_at)), 'the baseline artifact needs a real stamp')
})
