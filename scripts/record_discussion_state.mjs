#!/usr/bin/env node
/**
 * Can we still reply to those upstream threads? (R71)
 *
 * WHY THIS EXISTS: R57 wrote three reply drafts (#8202 / #10849 / #11687) and R71 was told to *prepare*
 * them rather than post them. The failure mode of "prepare today, post in two weeks" is that the thread
 * moved underneath the draft — someone else answered it, it got closed, or the reporter edited the
 * question. Replying "here is the root cause" to a thread that already has the answer is worse than
 * staying quiet: it is the same shape as the R51 `pending`-read-as-answer and the R52 `threads: 0` bugs,
 * just aimed at a person instead of an artifact.
 *
 * So before a draft can be labelled paste-ready, the thread's *state* has to be readable and recorded:
 *   - `open`        nobody answered, not closed → a reply is still a contribution
 *   - `answered`    the board already has an accepted answer → our draft must not be posted as-is
 *   - `closed`      locked/closed → nothing to post
 *   - `unreadable`  GraphQL could not be read → we do NOT say "still open" (that is the whole point)
 *
 *   node scripts/record_discussion_state.mjs --ids 8202,10849,11687
 *   node scripts/record_discussion_state.mjs --ids 8202 --fixtures data/fixtures/discussions/state-x.json
 *
 * EXIT: 0 artifact written · 2 nothing readable / bad usage — **no artifact** either way.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

import { judgeReplyGate } from './lib/discussion-state.mjs'
import { writeEvidence } from './lib/evidence.mjs'
import { abs, isoStamp } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601\n`)
  process.exit(2)
}

const ids = String(argOf('--ids', ''))
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0)
if (ids.length === 0) {
  process.stderr.write('usage: node scripts/record_discussion_state.mjs --ids 8202,10849,11687\n')
  process.exit(2)
}

const owner = String(argOf('--owner', 'deepseek-ai'))
const name = String(argOf('--repo', 'deepseek-harness'))
const fixturesIn = argOf('--fixtures', null)
const fixturesOut = String(argOf('--fixtures-out', `data/fixtures/discussions/state-${stamp.replace(/[:.]/g, '-')}.json`))
const outDir = String(argOf('--out', 'data/results'))

/**
 * One GraphQL round-trip for every id: one request, one failure mode.
 * `isAnswered` and `closed` are the two fields the decision actually rests on; `updatedAt` and the last
 * comment are recorded so a human can see *why* the gate says what it says.
 */
function fetchThreads() {
  const fields = ids
    .map(
      (id) =>
        `d${id}: discussion(number: ${id}) { number title url createdAt updatedAt isAnswered closed category { name } comments(last: 1) { totalCount nodes { createdAt author { login } } } answer { createdAt author { login } } }`,
    )
    .join('\n')
  const query = `query {\n  repository(owner: "${owner}", name: "${name}") {\n${fields}\n  }\n}`
  const result = spawnSync('gh', ['api', 'graphql', '-f', `query=${query}`], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status !== 0) {
    process.stderr.write(`could not read the discussions: ${String(result.stderr).slice(0, 300)}\n`)
    return null
  }
  try {
    const payload = JSON.parse(String(result.stdout))
    const repository = payload?.data?.repository
    if (repository === null || repository === undefined) return null
    return Object.values(repository).filter((entry) => entry !== null && typeof entry === 'object')
  } catch (error) {
    process.stderr.write(`unreadable GraphQL payload: ${String(error?.message ?? error)}\n`)
    return null
  }
}

function loadFixtures() {
  const file = String(fixturesIn)
  const path = file.startsWith('.') || file.match(/^[A-Za-z]:/) ? file : join(abs('.'), file)
  if (!existsSync(path)) {
    process.stderr.write(`fixture file not found: ${file}\n`)
    return null
  }
  const payload = JSON.parse(readFileSync(path, 'utf8'))
  return Array.isArray(payload?.threads) ? payload.threads : null
}

/**
 * The gate itself lives in `scripts/lib/discussion-state.mjs` so the unit test can import it without
 * executing this script's top-level I/O. Deliberately total: every input shape gets an answer, and the
 * ones we could not read never come out as `open` — "I did not look" and "nobody answered" must not
 * print the same word.
 */
const threads = fixturesIn === null ? fetchThreads() : loadFixtures()
if (threads === null || threads.length === 0) {
  process.stderr.write('nothing was read, so nothing is written (an unreadable thread is not an open one)\n')
  process.exit(2)
}

if (fixturesIn === null) {
  mkdirSync(dirname(fixturesOut), { recursive: true })
  if (!existsSync(fixturesOut)) {
    writeFileSync(
      fixturesOut,
      `${JSON.stringify({ schema_version: 1, produced_by: 'scripts/record_discussion_state.mjs', captured_at: stamp, threads }, null, 2)}\n`,
      'utf8',
    )
  }
}

const rows = [...threads]
  .sort((left, right) => Number(left.number) - Number(right.number))
  .map((thread) => ({
    number: Number(thread.number),
    title: String(thread.title ?? ''),
    url: String(thread.url ?? ''),
    category: thread.category?.name ?? null,
    created_at: String(thread.createdAt ?? ''),
    updated_at: String(thread.updatedAt ?? ''),
    closed: thread.closed === true,
    answered: thread.isAnswered === true,
    comments: Number(thread.comments?.totalCount ?? 0),
    last_comment: thread.comments?.nodes?.[0]?.createdAt
      ? { at: String(thread.comments.nodes[0].createdAt), author: thread.comments?.nodes?.[0]?.author?.login ?? null }
      : null,
    answer: thread.answer?.createdAt ? { at: String(thread.answer.createdAt), author: thread.answer?.author?.login ?? null } : null,
    gate: judgeReplyGate(thread),
  }))

const counts = rows.reduce((acc, row) => ({ ...acc, [row.gate]: (acc[row.gate] ?? 0) + 1 }), {})
const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_discussion_state.mjs',
  generated_at: stamp,
  sample: { ids, source: fixturesIn === null ? 'graphql' : `fixtures:${String(fixturesIn).split(/[\\/]/).slice(-1)[0]}` },
  counts,
  rows,
  limits: [
    'this records the thread board state at one timestamp; it says nothing about whether our draft is correct',
    'isAnswered is GitHub\'s own "accepted answer" flag: a thread can have replies and still read as open',
    'open means "a reply would still be a contribution", not "a reply would be welcome"',
    'read-only: this script posts nothing and writes nothing outside its artifact and fixture snapshot',
  ],
}

const result = writeEvidence({
  outDir,
  fileName: `discussion-state-${stamp.replace(/[:.]/g, '-')}.json`,
  text: `${JSON.stringify(payload, null, 2)}\n`,
})
if (!result.ok) {
  process.stderr.write(`refusing to overwrite existing evidence: ${result.target}\n`)
  process.exit(2)
}

process.stdout.write(`threads ${rows.length} · ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`)
for (const row of rows) {
  process.stdout.write(
    `#${row.number} ${row.gate} · comments ${row.comments} · updated ${row.updated_at}${row.last_comment ? ` · last by ${row.last_comment.author ?? 'unknown'}` : ''}\n`,
  )
}
process.stdout.write(`ssot ${result.display} sha256=${result.sha256.slice(0, 12)}…\n`)
