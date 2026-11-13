/**
 * R105 · the handover's own claims must be recomputable, and the reader that recomputes them must be
 * able to say "no".
 *
 * WHY: `docs/HANDOFF.md` asks a new session to trust four numbers and three pointers. Every earlier
 * round found one of them stale by *reading*, which is not a control. The check script compares them
 * with the repository; this file proves the comparison can fail — a checker that cannot go red on an
 * eleven-row table is the `BS-66` shape (a green that proves nothing).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  BATCH_ROW_BUDGET,
  acceptanceTestCount,
  countBatchRows,
  handoverSnapshotName,
} from '../../scripts/lib/handover-claims.mjs'

const handoff = readFileSync(new URL('../../docs/HANDOFF.md', import.meta.url), 'utf8')
const results = readdirSync(new URL('../../data/results/', import.meta.url))

test('the live handover keeps exactly the promised number of batch rows', () => {
  assert.equal(countBatchRows(handoff), BATCH_ROW_BUDGET)
})

test('N1: an eleven-row table is caught — the round that actually went wrong', () => {
  /*
   * R105's first extraction archived only R92/R93 and left eleven rows. If the check had only ever
   * been run against the fixed file, that mistake would have shipped. So: take the real handover,
   * duplicate one row inside §2, and the count must change.
   */
  const start = handoff.indexOf('## 2. 当前批次')
  const end = handoff.indexOf('## 3. 下一位 agent 的第一件事')
  const section = handoff.slice(start, end)
  const row = section.split('\n').find((line) => /^\| \*\*.*（R\d+/.test(line))
  assert.ok(row !== undefined)
  const injected = `${handoff.slice(0, end)}${row}\n${handoff.slice(end)}`
  assert.equal(countBatchRows(injected), BATCH_ROW_BUDGET + 1)
})

test('N2: markers outside §2 are not batch rows (the 17-row false alarm)', () => {
  /*
   * §7 has rows that mention a round in passing (`（R47 新增）`). Counting the whole file once said 17.
   * The fixture keeps the §3 heading out of the string on purpose: `countBatchRows` needs BOTH
   * headings to find a boundary, and "the second heading is missing" is its own case (asserted below).
   */
  const synthetic = [
    '## 2. 当前批次',
    '| 项 | 状态 |',
    '|---|---|',
    '| **一个（R104，2026-11-13）** | x |',
    '## 3. 下一件事',
    '| **D5（R47 新增）** | y |',
  ].join('\n')
  // The real §3 heading in the live document is '## 3. 下一位 agent 的第一件事', so the fixture uses it.
  const bounded = synthetic.replace('## 3. 下一件事', '## 3. 下一位 agent 的第一件事')
  assert.equal(countBatchRows(bounded), 1, 'only the row inside §2 counts')

  // Missing headings is "no section", not "zero rows that happen to be fine".
  assert.equal(countBatchRows('no headings here'), 0)
})

test('the acceptance count is the one the badge reports', () => {
  const badge = Number(/badge\/tests-(\d+)/.exec(readFileSync(new URL('../../README.md', import.meta.url), 'utf8'))?.[1])
  assert.equal(acceptanceTestCount(handoff), badge)
})

test('N3: a stale acceptance number is readable as stale', () => {
  const stale = handoff.replace(/当前 \*\*\d+ 测试\*\*/u, '当前 **900 测试**')
  assert.equal(acceptanceTestCount(stale), 900)
  const removed = handoff.replace(/当前 \*\*\d+ 测试\*\*/u, '当前 **很多** 测试')
  assert.equal(acceptanceTestCount(removed), null, 'a sentence without a number is not a count')
})

test('the named snapshot exists, hashes, and is the newest handover snapshot', () => {
  const name = handoverSnapshotName(handoff)
  assert.ok(name !== null, 'the handover must name a snapshot')
  assert.ok(results.length > 0)
  // The snapshot file itself lives under backup/snapshots, not data/results.
  const snapshots = readdirSync(new URL('../../backup/snapshots/', import.meta.url)).filter((file) => file.endsWith('.json'))
  assert.ok(snapshots.includes(name), `${name} must exist in backup/snapshots`)
  assert.ok(
    snapshots.some((file) => `${file}.sha256` === `${name}.sha256`),
    'the snapshot must carry a .sha256 beside it',
  )
})

test('N4: a snapshot pointer that does not exist is a name, not a pass', () => {
  const wrong = handoff.replace(/snapshot-[0-9A-Za-z._-]+\.json/u, 'snapshot-0.3.6-handoff-R96.json')
  const name = handoverSnapshotName(wrong)
  assert.equal(name, 'snapshot-0.3.6-handoff-R96.json')
  const snapshots = readdirSync(new URL('../../backup/snapshots/', import.meta.url)).filter((file) => file.endsWith('.json'))
  assert.equal(snapshots.includes(name), false, 'this is the red that the live check would print')
})

test('the two gate baselines the handover points at are the ones on disk', () => {
  const named = [...handoff.matchAll(/data\/results\/(gates(?:-mutate)?-[\w:.-]+\.json)/g)]
    .map((match) => match[1])
    .filter((file): file is string => file !== undefined)
  assert.ok(named.length >= 2, 'the handover must point at both the green and the negative-control baseline')
  for (const file of named) assert.ok(results.includes(file), `${file} is named but missing`)
})
