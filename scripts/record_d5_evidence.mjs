#!/usr/bin/env node
/**
 * D5 evidence: the three numbers the only product judgement is allowed to read (R54).
 *
 * WHY THIS EXISTS: `docs/specs/D5-measurement.md` freezes the *reading* of reactions /
 * external references / weekly downloads before anybody looks at the data. Two of those three
 * had no producer at all, which meant the verdict would have been hand-counted at the end of the
 * window — the exact "look at the data, then pick a rule" shape this repository forbids.
 *
 * WHAT IT REFUSES TO DO:
 *   - invent a zero when GitHub cannot be read (`state: unreadable`, verdict `unmeasurable`);
 *   - count our own pull requests or our own issues as "external references";
 *   - read a weekly-download burst as demand (that decision lives in `scripts/lib/download-shape.mjs`
 *     and is consumed here through the baseline artifact, not re-implemented);
 *   - write an artifact at all when there is nothing to measure (`no-post`) or when the whole
 *     reading failed (bad auth, 403 for every source).
 *
 * EXIT CODES: 0 artifact written and verdict ∈ {pass, pending, unmeasurable} · 1 verdict = fail ·
 *             2 bad usage / could not run / nothing posted (no artifact).
 *
 *   node scripts/record_d5_evidence.mjs --stamp 2026-11-03T10:00:00.000Z \
 *     --post https://github.com/deepseek-ai/deepseek-harness/discussions/12000 \
 *     --posted-on 2026-11-03T09:00:00.000Z [--baseline data/results/market-baseline-*.json]
 *
 *   # offline recompute from recorded answers (byte-identical after normalising generated_at)
 *   node scripts/record_d5_evidence.mjs --stamp ... --post ... --posted-on ... \
 *     --fixtures data/fixtures/d5/<stamp> --baseline ...
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

import { classifyDownloadShape } from './lib/download-shape.mjs'
import { judgeD5, isExternalReference, SELF_REFERENCES } from './lib/d5-score.mjs'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { parseInstant } from './lib/posting.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-11-03T10:00:00.000Z\n`)
  process.exit(2)
}
const postUrl = argOf('--post', null)
const postedOn = argOf('--posted-on', null)
const fixturesDir = argOf('--fixtures', null)
const outDir = pathFor(String(argOf('--out', 'data/results')))
const baselinePath = (() => {
  const explicit = argOf('--baseline', null)
  if (explicit !== null) return pathFor(String(explicit))
  const results = pathFor('data/results')
  const candidates = readdirSync(results)
    .filter((name) => /^market-baseline-.*\.json$/.test(name))
    .sort()
  return candidates.length === 0 ? null : join(results, candidates.at(-1))
})()

/** A URL shape we can address; anything else is a usage error, not a silent no-post. */
const postTarget = (() => {
  if (postUrl === null) return null
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/discussions\/(\d+)$/.exec(String(postUrl))
  if (match === null) {
    process.stderr.write(`--post must be a discussion URL (https://github.com/<owner>/<repo>/discussions/<number>), got "${String(postUrl)}"\n`)
    process.exit(2)
  }
  return { owner: match[1], repo: match[2], number: Number(match[3]) }
})()

if (postTarget === null || typeof postedOn !== 'string' || postedOn === '') {
  /*
   * NOTHING POSTED = NOTHING TO MEASURE. Writing `{verdict:'no-post'}` here would produce a file
   * that looks like evidence while the clock has not started; the spec says no-post, and the honest
   * artifact for that is *no artifact*.
   */
  process.stderr.write(
    'no sample is posted yet: pass --post <discussion url> and --posted-on <ISO> once the post exists\n' +
      '  (D5 counts from the post, not from a release; see docs/specs/D5-measurement.md §2)\n',
  )
  process.exit(2)
}

/*
 * R66: THE DATE THAT DRIVES THE VERDICT WAS THE ONE THING NEVER CHECKED. `check_listing` validated
 * `registry.posted_on` (a field no measurement reads), while D5's window comes from this flag. An
 * independent adversary showed the consequence: `--posted-on 2026-02-30T12:00:00Z` is rolled by
 * `Date.parse` to Mar 2, which turns a `pending` sample into `fail`; `2026-13-01T00:00:00Z` yields NaN,
 * which `windowOf` reports as "no post" — the sample silently disappears.
 *
 * So the flag is now validated before anything is fetched: a typo must stop the run with no artifact,
 * the same way an unreadable registry does.
 */
const windowStart = parseInstant(postedOn)
if (windowStart === null) {
  process.stderr.write(
    `--posted-on is not an instant that exists: "${postedOn}"\n` +
      '  expected an ISO-8601 instant with an explicit zone that actually exists, e.g. 2026-11-02T17:36:00.000Z\n' +
      '  (2026-02-30 and 2026-13-01 are refused: Date.parse rolls or drops them, which moves the 14-day window)\n',
  )
  process.exit(2)
}

const gh = (args) => spawnSync('gh', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })

/** Read the three sources. Each returns either a reading or an explicit `unreadable`. */
function readReactions() {
  if (fixturesDir !== null) {
    const file = join(pathFor(String(fixturesDir)), 'reactions.json')
    if (!existsSync(file)) return { state: 'unreadable', detail: `fixture missing: ${file}` }
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    return { state: 'measured', value: Number(payload?.totalCount ?? 0), byType: payload?.byType ?? null }
  }
  const query = [
    'query {',
    `  repository(owner: "${postTarget.owner}", name: "${postTarget.repo}") {`,
    `    discussion(number: ${postTarget.number}) {`,
    '      title',
    '      reactions { totalCount }',
    '      reactionGroups { content users { totalCount } }',
    '    }',
    '  }',
    '}',
  ].join('\n')
  const result = gh(['api', 'graphql', '-f', `query=${query}`])
  if (result.status !== 0) {
    return { state: 'unreadable', detail: `gh graphql exit ${String(result.status)}: ${String(result.stderr ?? '').trim().split('\n')[0] ?? ''}` }
  }
  try {
    const payload = JSON.parse(String(result.stdout))
    const discussion = payload?.data?.repository?.discussion
    if (discussion === null || discussion === undefined) return { state: 'unreadable', detail: 'the GraphQL answer had no discussion' }
    const byType = {}
    for (const group of discussion.reactionGroups ?? []) {
      const name = group?.content
      if (typeof name === 'string') byType[name] = Number(group?.users?.totalCount ?? 0)
    }
    return { state: 'measured', value: Number(discussion?.reactions?.totalCount ?? 0), byType, title: discussion?.title ?? null }
  } catch (error) {
    return { state: 'unreadable', detail: `unreadable GraphQL payload: ${String(error?.message ?? error)}` }
  }
}

function readReferences() {
  if (fixturesDir !== null) {
    const file = join(pathFor(String(fixturesDir)), 'references.json')
    if (!existsSync(file)) return { state: 'unreadable', detail: `fixture missing: ${file}` }
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    const items = Array.isArray(payload?.items) ? payload.items : []
    return finishReferences(items)
  }
  const result = gh(['api', '-X', 'GET', 'search/issues', '-f', `q="${SELF_REFERENCES.repository}"`, '-f', 'per_page=50'])
  if (result.status !== 0) {
    return { state: 'unreadable', detail: `search exit ${String(result.status)}: ${String(result.stderr ?? '').trim().split('\n')[0] ?? ''}` }
  }
  try {
    const payload = JSON.parse(String(result.stdout))
    return finishReferences(Array.isArray(payload?.items) ? payload.items : [])
  } catch (error) {
    return { state: 'unreadable', detail: `unreadable search payload: ${String(error?.message ?? error)}` }
  }
}

/** Shared by live and fixture paths: the exclusion rule lives in `d5-score`, not here. */
function finishReferences(items) {
  const candidates = items.map((item) => ({
    url: String(item?.html_url ?? item?.url ?? ''),
    author: String(item?.user?.login ?? item?.author ?? ''),
    repository: typeof item?.repository_url === 'string' ? item.repository_url.replace('https://api.github.com/repos/', '') : null,
    kind: item?.pull_request ? 'pull' : 'issue',
    title: item?.title ?? null,
  }))
  const external = candidates.filter((candidate) => isExternalReference(candidate, SELF_REFERENCES))
  return { state: 'measured', value: external.length, entries: external, seen: candidates.length }
}

/**
 * Weekly downloads come from the baseline artifact, not from a second implementation: `d5` in that
 * file is already the result of `classifyDownloadShape` + `judgeWeeklyDemand` (R52).
 */
function readDownloads() {
  if (baselinePath === null || !existsSync(baselinePath)) {
    return { state: 'unreadable', detail: 'no market-baseline artifact to read weekly downloads from' }
  }
  const payload = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const d5 = payload?.d5
  if (d5 === null || d5 === undefined) return { state: 'unreadable', detail: 'the baseline artifact has no d5 block' }
  const shape = typeof d5.download_shape === 'string' ? d5.download_shape : 'unreadable'
  if (d5.downloads_state !== 'recorded') {
    return { state: 'unreadable', detail: `the baseline recorded downloads_state=${String(d5.downloads_state)}`, shape }
  }
  /*
   * Belt and braces: recompute the shape from the artifact's own daily series with the same function
   * the recorder used, so a hand-edited `download_shape` cannot flip this number on its own.
   */
  const daily = Array.isArray(payload?.downloads?.daily) ? payload.downloads.daily : null
  if (daily !== null) {
    const recomputed = classifyDownloadShape(daily)
    if (recomputed.shape !== shape) {
      return { state: 'unreadable', detail: `shape disagrees with its own daily series (${shape} vs ${recomputed.shape})`, shape }
    }
  }
  return {
    state: 'measured',
    value: Number(d5.week_downloads ?? 0),
    shape,
    baseline: baselinePath.split(/[\\/]/).slice(-1)[0],
    days_with_downloads: Number(d5.days_with_downloads ?? 0),
    peak_share: Number(d5.peak_share ?? 0),
  }
}

const reactions = readReactions()
const references = readReferences()
const downloads = readDownloads()

/* Every source unreadable means the run itself failed; no artifact, per the repository's rule. */
if (reactions.state === 'unreadable' && references.state === 'unreadable') {
  process.stderr.write(
    `could not read GitHub (reactions: ${String(reactions.detail)}; references: ${String(references.detail)})\n` +
      '  nothing was written: an unreadable window is not a zero\n',
  )
  process.exit(2)
}

/*
 * `--dry-read` prints what the three sources said and writes nothing. It exists because the live
 * path cannot be exercised before a sample is posted — and an untested reader is how "we could not
 * read it" becomes "the number is zero" on the day it matters.
 */
if (argv.includes('--dry-read')) {
  process.stdout.write(`${JSON.stringify({ reactions, references, downloads }, null, 2)}\n`)
  process.exit(0)
}

const evidence = judgeD5({
  post: { url: String(postUrl), number: postTarget.number, author: null },
  postedOn,
  now: stamp,
  readings: {
    reactions,
    externalReferences: references,
    weeklyDownloads: downloads,
  },
})

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_d5_evidence.mjs',
  generated_at: stamp,
  spec: 'docs/specs/D5-measurement.md',
  mode: fixturesDir === null ? 'live' : 'fixtures',
  self_test: fixturesDir !== null,
  /*
   * NOT `verdict`: the verdict contract gate owns that key and would try to validate this whole
   * payload as a go/risky/blocked/unknown verdict (it did — R54). D5's answer is a different kind
   * of judgement and gets its own field name.
   */
  d5_verdict: evidence.verdict,
  counts_as_demand: evidence.counts_as_demand,
  window: evidence.window,
  numbers: evidence.numbers,
  post: evidence.post,
  sources: {
    reactions: fixturesDir === null ? 'graphql' : `fixtures:${String(fixturesDir)}`,
    references: fixturesDir === null ? 'search-api' : `fixtures:${String(fixturesDir)}`,
    downloads: downloads.baseline ?? null,
  },
  inputs: {
    fixtures: fixturesDir === null ? null : String(fixturesDir).split(/[\\/]/).slice(-1)[0],
    baseline: downloads.baseline ?? null,
    reaction_types: reactions.byType ?? null,
    references_seen: references.seen ?? null,
  },
  limits: [
    'reactions is totalCount: every reaction type counts 1, the breakdown is recorded but not weighted',
    'the search API does not index discussions, so a reference written inside a discussion comment is invisible to this number',
    'weekly downloads is read from a market-baseline artifact and re-checked against its own daily series; it is not fetched here',
    'this artifact answers "did the three numbers reach their thresholds by the window", not "is the product good"',
  ],
}

const text = `${JSON.stringify(payload, null, 2)}\n`
/*
 * Fixtures-mode artifacts are named `d5-selftest-*`, never `d5-evidence-*`: the first proves the
 * reader works, the second is the sample's verdict. Mixing them in a directory listing is how a
 * plumbing check gets quoted as a result.
 */
const prefix = payload.mode === 'fixtures' ? 'd5-selftest' : 'd5-evidence'
const fileName = `${prefix}-${stamp.replace(/[:.]/g, '-')}.json`
const target = join(outDir, fileName)
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, sha256(text), 'utf8')

process.stdout.write(
  `D5 · ${evidence.verdict}${evidence.counts_as_demand ? ' (counts as demand)' : ''} · ` +
    `reactions ${String(evidence.numbers.reactions.value)}/${evidence.numbers.reactions.threshold}` +
    ` · references ${String(evidence.numbers.external_references.value)}/${evidence.numbers.external_references.threshold}` +
    ` · downloads ${String(evidence.numbers.weekly_downloads.value)} (${String(evidence.numbers.weekly_downloads.shape)})/${evidence.numbers.weekly_downloads.threshold}\n`,
)
process.stdout.write(`ssot data/results/${fileName} sha256=${sha256(text).slice(0, 12)}…\n`)
process.exit(evidence.verdict === 'fail' ? 1 : 0)
