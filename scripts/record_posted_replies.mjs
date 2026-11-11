#!/usr/bin/env node
/**
 * Record that the outreach replies really exist, and that they are still ours (R94).
 *
 * WHY THIS EXISTS: R58 wrote three replies and R71 was told to *prepare* them, so for nine days the
 * repository's only evidence that they were "ready" was prose. When they were finally posted
 * (2026-11-11) the proof would otherwise be three URLs pasted into a pull-request description —
 * exactly the shape this project keeps rejecting: a claim with no artifact.
 *
 * WHAT IT CHECKS (per reply):
 *   1. the URL resolves to a comment that exists in the discussion it names;
 *   2. the comment's author is the account running this script (a reply, not somebody else's);
 *   3. the body is non-empty and its length is recorded verbatim;
 *   4. the discussion is still `isAnswered: false` — if somebody has since answered it, that is
 *      recorded too, because "we replied" and "the thread now has an answer" are different facts.
 *
 * WHAT IT DOES NOT DO: it does not post anything, does not judge the prose, and does not feed D5.
 * D5 counts reactions and external references on `#11813` only (`docs/specs/D5-measurement.md` §1);
 * answering somebody else's thread is contact, not demand.
 *
 *   node scripts/record_posted_replies.mjs --stamp 2026-11-11T13:30:00.000Z \
 *     --reply 8202=https://github.com/deepseek-ai/deepseek-harness/discussions/8202#discussioncomment-19542005 \
 *     --reply 10849=https://github.com/deepseek-ai/deepseek-harness/discussions/10849#discussioncomment-19542006
 *
 * Exit codes: 0 written · 2 bad usage / a reply could not be verified (no artifact).
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { parseReplySpec } from './lib/reply-spec.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const allOf = (name) => {
  const out = []
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === name && argv[i + 1] !== undefined) out.push(argv[i + 1])
  return out
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
const outDir = pathFor(String(argOf('--out', 'data/results')))
if (stamp === null) {
  process.stderr.write('usage: node scripts/record_posted_replies.mjs --stamp <ISO> --reply <n>=<url> [--reply ...]\n')
  process.exit(2)
}

const gh = (args) => {
  const child = spawnSync('gh', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 })
  if (child.status !== 0) return { ok: false, detail: (child.stderr ?? '').trim().slice(0, 300) }
  try {
    return { ok: true, value: JSON.parse(child.stdout ?? '{}') }
  } catch {
    return { ok: false, detail: 'gh returned unparseable JSON' }
  }
}

const WHOAMI = gh(['api', 'user'])
if (!WHOAMI.ok) {
  process.stderr.write(`cannot read the authenticated login: ${WHOAMI.detail}\n`)
  process.exit(2)
}
const me = String(WHOAMI.value?.login ?? '').trim()
if (me.length === 0) {
  process.stderr.write('cannot read the authenticated login: the API answer carries no `login`\n')
  process.exit(2)
}

const specs = allOf('--reply')
if (specs.length === 0) {
  process.stderr.write('usage: --reply <discussion-number>=<discussion-comment-url> (at least one)\n')
  process.exit(2)
}

const replies = []
const problems = []
for (const spec of specs) {
  const eq = spec.indexOf('=')
  if (eq === -1) {
    problems.push(`"${spec}" is not <n>=<url>`)
    continue
  }
  const url = spec.slice(eq + 1).trim()
  const parsed = parseReplySpec(spec.slice(0, eq), url)
  if (!parsed.ok) {
    problems.push(parsed.detail)
    continue
  }
  const { owner, repo, number, commentId } = parsed

  /*
   * Read the thread, not just the comment: a comment URL that resolves proves we typed something,
   * not that the thread is still ours to answer. `isAnswered` is the fact R71 built the whole
   * `open` / `answered` distinction on, so it is recorded here rather than assumed.
   */
  const query = `
  query ($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      discussion(number: $number) {
        number
        url
        title
        isAnswered
        comments(last: 20) {
          totalCount
          nodes {
            id
            databaseId
            url
            createdAt
            body
            author { login }
          }
        }
      }
    }
  }
`
  const res = gh([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `repo=${repo}`,
    '-F',
    `number=${number}`,
  ])
  if (!res.ok) {
    problems.push(`#${number}: ${res.detail}`)
    continue
  }
  const discussion = res.value?.data?.repository?.discussion
  if (discussion === null || discussion === undefined) {
    problems.push(`#${number}: the discussion does not exist`)
    continue
  }
  /*
   * The URL carries the *database* id (`discussioncomment-19542005`); the GraphQL `id` is an opaque
   * node id (`DC_kwDOT3T1g84BKi_1`). Matching on the node id silently found nothing and the first run
   * refused three real replies — a false negative in exactly the check that exists to not be fooled.
   * So: databaseId first, the URL as the fallback.
   */
  const node = (discussion.comments?.nodes ?? []).find(
    (candidate) => String(candidate.databaseId ?? '') === commentId || String(candidate.url ?? '') === url,
  )
  if (node === undefined) {
    problems.push(`#${number}: the comment ${commentId} is not in the last 20 comments — re-read by hand`)
    continue
  }
  const author = String(node.author?.login ?? '')
  if (author !== me) problems.push(`#${number}: the comment is by ${author || 'unknown'}, not ${me}`)
  const body = String(node.body ?? '')
  if (body.trim().length === 0) problems.push(`#${number}: the recorded comment body is empty`)

  replies.push({
    discussion: Number(number),
    url,
    comment_id: commentId,
    discussion_url: String(discussion.url ?? ''),
    title: String(discussion.title ?? ''),
    author,
    created_at: String(node.createdAt ?? ''),
    body_chars: body.length,
    discussion_is_answered: discussion.isAnswered === true,
    comments_total: Number(discussion.comments?.totalCount ?? 0),
  })
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`posting check: ${problem}\n`)
  process.stderr.write('nothing recorded — a reply that cannot be verified is not a reply\n')
  process.exit(2)
}

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_posted_replies.mjs',
  generated_at: stamp,
  account: me,
  replies,
  claims: [
    {
      id: 'replies-exist-and-are-ours',
      statement: `${replies.length} outreach comment(s) resolve, are authored by ${me}, and carry a non-empty body`,
      recompute: 'replies[].author / replies[].body_chars',
    },
    {
      id: 'threads-not-answered',
      statement: `${replies.filter((reply) => reply.discussion_is_answered === false).length} of ${replies.length} thread(s) are still unanswered`,
      recompute: 'replies[].discussion_is_answered',
    },
  ],
  limits: [
    'this records that the comments exist; it says nothing about whether they were useful',
    'answering somebody else\'s thread is contact, not demand: D5 counts #11813 reactions and external references only',
    'a thread can be answered after this reading — re-run before quoting "still unanswered"',
  ],
}

const fileName = `posted-replies-${stamp.replaceAll(':', '-')}.json`
mkdirSync(outDir, { recursive: true })
const target = join(outDir, fileName)
const text = `${JSON.stringify(payload, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, sha256(text), 'utf8')

const display = target.startsWith(abs('.')) ? target.slice(abs('.').length + 1).replaceAll('\\', '/') : target
process.stdout.write(`posted-replies · ${replies.length} reply(ies) by ${me} · unanswered ${replies.filter((r) => !r.discussion_is_answered).length}/${replies.length}\n`)
for (const reply of replies) process.stdout.write(`  #${reply.discussion} · ${reply.body_chars} chars · ${reply.url}\n`)
process.stdout.write(`ssot ${display} sha256=${sha256(text).slice(0, 12)}…\n`)
