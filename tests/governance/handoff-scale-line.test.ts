import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

/*
 * R88: the `| 规模 |` row in `docs/HANDOFF.md` said "611 tests · 334 SSOT artifacts · 355 ledger
 * steps · 53 blind spots" while the repository actually held 805 / 486 / 509 / 60 — and the role
 * count said 6 when there were 7. Every number in that row was hand-maintained and nothing ever
 * recomputed it, so it drifted for dozens of rounds without a single red test. That is the exact
 * failure mode this project keeps writing down (`docs/HANDOFF.md` §4): a number nobody re-derives
 * is a number that lies.
 *
 * So from this round on, every count in the row is recomputed here from the repository itself.
 * The row stays the only place they are written down; when a round adds an artifact or a ledger
 * step this test goes red ON PURPOSE and the row follows. That is `PROJECT_RULES.md` #8 (sync
 * rule) made mechanical — it tightens no threshold and changes no verdict.
 *
 * The test count is the one number a test cannot derive at runtime, so it is pinned to the README
 * badge — the copy `scripts/check_listing.mjs --tests <n>` validates against a real run. Two
 * copies of one number, with the authority named rather than remembered.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const list = (path: string) => readdirSync(new URL(`../../${path}`, import.meta.url))

const scaleRow = () => {
  const row = read('docs/HANDOFF.md')
    .split('\n')
    .find((line) => line.startsWith('| 规模 |'))
  assert.ok(row !== undefined, 'docs/HANDOFF.md must carry a "| 规模 |" row')
  return row
}

const testCount = () => {
  const match = /badge\/tests-(\d+)/.exec(read('README.md'))
  return match === null ? Number.NaN : Number(match[1])
}

test('the README test badge is parseable, so the count below cannot pass vacuously', () => {
  const count = testCount()
  assert.ok(Number.isInteger(count) && count > 0, `README.md must carry a "badge/tests-<n>" badge (read ${String(count)})`)
})

test('every count in the 规模 row equals a count recomputed from the repository', () => {
  const row = scaleRow()
  const gold = JSON.parse(read('data/gold/admission-cases.json')) as { cases: unknown[] }
  const ledger = JSON.parse(read('audit/step_reviews.json')) as { steps: unknown[] }
  const blinds = JSON.parse(read('audit/blind_spots.json')) as { blind_spots: unknown[] }

  const claims: Array<[number, string, string]> = [
    [testCount(), '测试', 'the README badge, which check_listing --tests validates against a real run'],
    [list('scripts').filter((name) => /^gate_.*\.mjs$/.test(name)).length, '门禁', 'scripts/gate_*.mjs'],
    [list('.agents/roles').filter((name) => name.endsWith('.md')).length, '角色卡', '.agents/roles/*.md'],
    [list('.agents/prompts').filter((name) => name.endsWith('.md')).length, '模板', '.agents/prompts/*.md'],
    [list('data/cases').filter((name) => name.startsWith('CASE-')).length, '个真实案例', 'data/cases/CASE-*'],
    [gold.cases.length, '条金标', 'data/gold/admission-cases.json#cases'],
    [list('data/results').filter((name) => name.endsWith('.json')).length, '份 SSOT 产物', 'data/results/*.json'],
    [ledger.steps.length, '步台账', 'audit/step_reviews.json#steps'],
    [blinds.blind_spots.length, '条盲区', 'audit/blind_spots.json#blind_spots'],
  ]

  for (const [count, unit, source] of claims) {
    /*
     * Match "10 个真实案例" rather than "**10 个真实案例**": some cells keep the bold marker after a
     * parenthetical ("**10 个真实案例（9 命中 / 1 显式 unknown）**"), so the marker is not part of the
     * claim — the number and its unit are.
     */
    const claim = `${count} ${unit}`
    assert.ok(
      row.includes(claim),
      `the 规模 row must say "${claim}" — recomputed ${count} from ${source}. ` +
        'Update the row (never the source) so the entry document follows the repository.',
    )
  }
})

test('the §3 acceptance criterion names the same test count as the badge', () => {
  // §3 tells the next agent what "green" looks like; if it names a stale count, the check below
  // reads as a target to hit rather than a description of the suite.
  const match = /当前 \*\*(\d+) 测试\*\*/.exec(read('docs/HANDOFF.md'))
  assert.ok(match !== null, '§3 must state the expected test count as "当前 **<n> 测试**"')
  assert.equal(
    Number(match[1]),
    testCount(),
    'the §3 acceptance criterion and the README badge disagree on the test count',
  )
})
