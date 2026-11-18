import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

/*
 * R119: promotion copy is the one place where a stale number reads as a lie.
 *
 * WHY: `docs/distribution/promotion.md` is now the single fact card every outbound post quotes. The
 * repository already learned this lesson for listings (`check_listing`) and for the handoff scale row
 * (`handoff-scale-line`): a number nobody re-derives drifts for dozens of rounds and nobody notices.
 * The promotion card is worse than either, because the drift goes out to other people's threads.
 *
 * WHAT IS CHECKED: version, test count, artifact pointers, the playbook's required sections, and the
 * npm per-version gap. WHAT IS NOT: prose quality, whether a channel accepted the post, or any number
 * that lives in a third party's index (those are readings, not claims).
 */

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

const CARD = 'docs/distribution/promotion.md'
const PLAYBOOK = 'docs/distribution/promotion-playbook.md'

/** `null` when the card states the manifest version; the problem otherwise. */
export const versionProblem = (card: string, version: string): string | null =>
  card.includes(`**${version}**`) ? null : `promotion.md must state the manifest version (${version})`

/** `null` when the card states the badge's test count; the problem otherwise. */
export const testCountProblem = (card: string, count: string): string | null =>
  card.includes(`**${count}**`) ? null : `promotion.md must state ${count} tests`

const manifestVersion = (): string =>
  (JSON.parse(read('packages/plugin/package.json')) as { version: string }).version

const badgeCount = (): string => {
  const badge = /badge\/tests-(\d+)/.exec(read('README.md'))
  assert.ok(badge !== null, 'README.md must carry a badge/tests-<n> badge')
  return String(badge?.[1])
}

test('the promotion fact card states the manifest version', () => {
  const problem = versionProblem(read(CARD), manifestVersion())
  assert.equal(problem, null, problem ?? '')
})

test('the promotion fact card quotes the same test count as the README badge', () => {
  const problem = testCountProblem(read(CARD), badgeCount())
  assert.equal(problem, null, problem ?? '')
})

test('every artifact the fact card cites exists and is hash-locked', () => {
  const cited = [...read(CARD).matchAll(/data\/results\/[A-Za-z0-9._-]+\.json/g)].map((m) => m[0])
  assert.ok(cited.length > 0, 'the fact card must cite at least one artifact — otherwise its numbers are prose')
  for (const artifact of new Set(cited)) {
    assert.ok(existsSync(new URL(artifact, root)), `cited artifact is missing: ${artifact}`)
    assert.ok(existsSync(new URL(`${artifact}.sha256`, root)), `cited artifact has no .sha256: ${artifact}`)
  }
})

test('the playbook keeps the sections an operator needs, in this project’s vocabulary', () => {
  const text = read(PLAYBOOK)
  for (const section of ['渠道矩阵', '去 AI 化', '验证', '兼容性', '交接清单']) {
    assert.ok(text.includes(section), `promotion-playbook.md must keep the "${section}" section`)
  }
  for (const rule of ['HN', 'V2EX', 'removed_by_category', '1280×640']) {
    assert.ok(text.includes(rule), `promotion-playbook.md must name ${rule}`)
  }
})

test('the playbook records the per-version download gap instead of pretending to measure it', () => {
  const text = read(PLAYBOOK)
  assert.ok(text.includes('latest share'), 'the playbook must name the metric it borrowed')
  assert.ok(
    text.includes('不提供按版本下载量') && text.includes('404'),
    'the playbook must record the measured reason the metric is unavailable here',
  )
  assert.ok(text.includes('不要在任何对外文案里引用'), 'the playbook must forbid quoting the unavailable metric')
})

test('N1: a stale version in the card is caught by the same predicate', () => {
  const version = manifestVersion()
  const mutated = read(CARD).replace(`**${version}**`, '**0.0.1**')
  assert.notEqual(
    versionProblem(mutated, version),
    null,
    'the version predicate must reject a card that names an old version',
  )
})

test('N2: a stale test count is caught by the same predicate', () => {
  const count = badgeCount()
  const mutated = read(CARD).replace(`**${count}**`, '**42**')
  assert.notEqual(testCountProblem(mutated, count), null, 'the badge predicate must reject an old count')
})
