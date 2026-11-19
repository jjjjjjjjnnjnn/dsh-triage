import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/*
 * R122 续: the promotion bus is the single state machine; this repository only emits readings.
 *
 * The snapshot half was already wired (scripts/promo-snapshot.mjs + KB projects/facts). What was
 * missing is the other half dsh-remedy has: a repo-side boundary that can go red if someone starts
 * maintaining a second status table here, and a governance test that really runs the snapshot
 * command instead of trusting a prose claim about it.
 *
 * WHAT IS NOT CHECKED: whether a channel accepted a post, whether the prose is good, or any number
 * that lives in a third-party index. Those are readings, not claims.
 */

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
const PAGE = 'docs/distribution/promotion.md'
const PLAY = 'docs/distribution/promotion-playbook.md'

/** `null` when the text carries the bus boundary, otherwise the missing claim. */
export const boundaryProblem = (text: string, needle: string): string | null =>
  text.includes(needle) ? null : `missing bus boundary: ${needle}`

/** `null` when the snapshot source still has the contract, otherwise the broken property. */
export const contractProblem = (source: string, needle: string): string | null =>
  source.includes(needle) ? null : `promo-snapshot.mjs lost: ${needle}`

test('the repo defers promotion status to the knowledge-base bus', () => {
  const page = read(PAGE)
  const play = read(PLAY)
  const rules = read('PROJECT_RULES.md')
  for (const [text, needle] of [
    [page, '唯一宣传状态机'],
    [page, 'kb promo status'],
    [page, 'kb promo record'],
    [page, '不是渠道状态机'],
    [play, '宣传总线'],
    [rules, '## 9. 工作流与需求入口'],
    [rules, '不是第二份状态机'],
  ] as const) {
    assert.equal(boundaryProblem(text, needle), null, boundaryProblem(text, needle) ?? '')
  }
})

test('the single-entry agent workflow is wired through the file chain', () => {
  const flow = read('docs/AGENT-WORKFLOW.md')
  for (const section of ['开工第一屏', '归属表', '需求与想法', '发版流程', '宣传流程', '文件地图', '交接清单']) {
    assert.ok(flow.includes(section), `AGENT-WORKFLOW.md lost the section: ${section}`)
  }
  for (const command of ['kb promo status', 'kb promo plan dsh-triage', 'kb promo record']) {
    assert.ok(flow.includes(command), `AGENT-WORKFLOW.md must wire ${command}`)
  }
  assert.ok(flow.includes('知识库 `Promotion/` 总线'), 'the workflow must name the KB bus as the state machine')
  assert.ok(read('AGENTS.md').includes('docs/AGENT-WORKFLOW.md'), 'AGENTS.md must point at the entry')
  assert.ok(read('INDEX.md').includes('docs/AGENT-WORKFLOW.md'), 'INDEX.md must list the entry')
  assert.ok(read(PAGE).includes('docs/AGENT-WORKFLOW.md'), 'the promotion page must point at the entry')
})

test('the outreach ledger stays bus-readable: URL, ISO instant, no D5 counting', () => {
  const ledger = JSON.parse(read('docs/copy/outreach.json')) as {
    entries: Array<{ status?: string; url?: string; comment_url?: string; posted_on?: string; d5_counts?: boolean }>
    posted_outside_channel: Array<{ posted_on?: string; comment_id?: string; d5_counts?: boolean }>
  }
  const posted = ledger.entries.filter((entry) => entry.status === 'posted')
  assert.ok(posted.length > 0, 'a ledger with no posted entry proves nothing')
  for (const entry of posted) {
    assert.ok(entry.url || entry.comment_url, 'a posted entry must carry the real URL')
    assert.match(String(entry.posted_on), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/)
    assert.equal(entry.d5_counts, false, 'outreach is contact, never a D5 demand signal')
  }
  assert.ok(Array.isArray(ledger.posted_outside_channel), 'replies posted from the browser must be recorded too')
  for (const entry of ledger.posted_outside_channel) {
    assert.ok(entry.comment_id, 'an outside-channel reply must carry its platform id')
    assert.match(String(entry.posted_on), /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(entry.d5_counts, false)
  }
})

test('promo-snapshot.mjs is read-only, offline and stdout-only', () => {
  const source = read('scripts/promo-snapshot.mjs')
  for (const forbidden of ['fetch(', 'spawnSync', 'execSync', 'writeFileSync', 'appendFileSync', 'mkdirSync']) {
    assert.ok(!source.includes(forbidden), `the bus snapshot command must not ${forbidden}`)
  }
  for (const needed of [
    "schema: 'promotion-snapshot/v1'",
    "project_id: 'dsh-triage'",
    'unreachable',
    'process.stdout.write',
    'posted_outside_channel',
  ]) {
    assert.equal(contractProblem(source, needed), null, contractProblem(source, needed) ?? '')
  }
})

test('promo-snapshot.mjs speaks promotion-snapshot/v1 for the bus', () => {
  const result = spawnSync(process.execPath, ['scripts/promo-snapshot.mjs'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
    maxBuffer: 32 << 20,
    timeout: 240000,
  })
  assert.equal(result.status, 0, String(result.stderr ?? '').slice(0, 300))
  const snap = JSON.parse(result.stdout) as {
    schema: string
    project_id: string
    generated_at: string
    release: { version: string }
    github: object
    npm: unknown[]
    catalogue: unknown[]
    releases: unknown[]
    social: { devto: Array<{ comment_id?: string }>; x: unknown[] }
    upstream: unknown[]
    unreachable: unknown[]
    source: { command: string }
  }
  assert.equal(snap.schema, 'promotion-snapshot/v1')
  assert.equal(snap.project_id, 'dsh-triage')
  assert.match(snap.release.version, /^\d+\.\d+\.\d+$/)
  for (const key of ['github', 'npm', 'catalogue', 'releases', 'social', 'upstream', 'unreachable', 'source'] as const) {
    assert.ok(key in snap, `snapshot is missing ${key}`)
  }
  assert.ok(Array.isArray(snap.unreachable), 'a missing source must be listed, not turned into zero')
  assert.ok(snap.source.command.includes('promo-snapshot.mjs'))
  assert.ok(snap.catalogue.length > 0, 'docs/market/index.json must reach the bus as catalogue')
  assert.ok(
    snap.social.devto.some((item) => item.comment_id === '3lj78'),
    'a reply posted from the browser must reach the bus through posted_outside_channel',
  )
})

test('N1: deleting the bus boundary from a document is caught by the same predicate', () => {
  const mutated = read(PAGE).replace('唯一宣传状态机', '我们自己的渠道表')
  assert.notEqual(boundaryProblem(mutated, '唯一宣传状态机'), null)
})

test('N2: changing the snapshot schema in the source is caught by the same predicate', () => {
  const mutated = read('scripts/promo-snapshot.mjs').replaceAll('promotion-snapshot/v1', 'something-else/v9')
  assert.notEqual(contractProblem(mutated, "schema: 'promotion-snapshot/v1'"), null)
})
