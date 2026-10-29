#!/usr/bin/env node
/**
 * Check that the public copy still tells the truth about this repository (`T-601`, R45).
 *
 * WHY THIS EXISTS: the README once claimed "427 tests" while the repo had moved on, and that kind of
 * drift is invisible until someone checks by hand. Marketing copy is the one place where a stale
 * number reads as a lie about measured evidence, so the claims that are *mechanically* checkable are
 * checked here, not in a review checklist:
 *
 *   1. every `data/results/*.json` a document points at exists (and has its `.sha256`);
 *   2. the published version named in the copy matches `packages/plugin/package.json`;
 *   3. the DSH range named in the copy matches `engines.dsh` in that same manifest;
 *   4. the test count named in the copy matches the count passed by the caller (`--tests`);
 *   5. no placeholder or forbidden claim (placeholders, "100% compatible", "no malware", "faster");
 *   6. every post in `docs/posts/` is listed in its README;
 *   7. the honest boundaries are still present (Wilson interval in the listings, the forward-`improved`
 *      finding in the upgrade post) — deleting a limitation must fail the check, not pass silently;
 *   8. both READMEs quote an upgrade card whose four bucket numbers match the artifact they point at,
 *      with the sandbox annotation and the recompute command still in place (`T-809`).
 *
 * WHAT IT DOES NOT DO: it does not judge prose, does not verify numbers inside `data/results` payloads
 * (those artifacts are the source of truth) and does not publish anything.
 *
 *   node scripts/check_listing.mjs --stamp <ISO> --tests 430
 *
 * Exit codes: 0 all checks passed · 1 a check failed (artifact written) · 2 bad usage / refusing to overwrite.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = argOf('--stamp', null)
const stamp = rawStamp === null ? null : isoStamp(String(rawStamp))
const tests = argOf('--tests', null)
if (stamp === null) {
  process.stderr.write('usage: node scripts/check_listing.mjs --stamp <ISO> [--tests <n>] [--out <dir>]\n')
  process.exit(2)
}
const outDir = pathFor(String(argOf('--out', 'data/results')))
const testCount = tests === null ? null : Number(tests)
if (testCount !== null && (!Number.isInteger(testCount) || testCount <= 0)) {
  process.stderr.write(`--tests must be a positive integer (got "${String(tests)}")\n`)
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(abs('packages/plugin/package.json'), 'utf8'))
const version = String(manifest.version)
const dshRange = String(manifest.engines?.dsh ?? '')

/** The documents a stranger reads. `README*` counts: it is the npm page. */
const DOCUMENTS = [
  'docs/market/listing_zh.md',
  'docs/market/listing_en.md',
  'docs/market/submissions/README.md',
  'docs/market/submissions/awesome-lists.md',
  'README.md',
  'README.zh-CN.md',
  ...readdirSync(abs('docs/posts')).filter((name) => name.endsWith('.md')).map((name) => `docs/posts/${name}`),
]

/** Copy that must never appear: placeholders, or claims this project cannot support. */
const FORBIDDEN = ['REPLACE-ME', 'TODO', 'TBD', '100% 兼容', '100% compatible', '无恶意', 'no malware', '提升速度', 'boosts speed']

const checks = []
const check = (id, ok, detail) => {
  checks.push({ id, ok: Boolean(ok), detail })
  return ok
}

const texts = new Map()
const missingDocuments = []
for (const file of DOCUMENTS) {
  if (!existsSync(abs(file))) {
    missingDocuments.push(file)
    continue
  }
  texts.set(file, readFileSync(abs(file), 'utf8'))
}
check('documents-exist', missingDocuments.length === 0, missingDocuments.join(', ') || `${texts.size} document(s)`)

/* 1. Every evidence pointer resolves. */
const EVIDENCE = /data\/results\/[A-Za-z0-9._-]+\.json/g
const referenced = new Set()
for (const text of texts.values()) for (const match of text.match(EVIDENCE) ?? []) referenced.add(match)
const brokenEvidence = [...referenced].filter((path) => !existsSync(abs(path)) || !existsSync(abs(`${path}.sha256`)))
check(
  'evidence-paths-exist',
  brokenEvidence.length === 0,
  brokenEvidence.length === 0 ? `${referenced.size} evidence path(s) resolve with sha256` : `missing: ${brokenEvidence.slice(0, 5).join(', ')}`,
)

/* 2. Version claims. */
const versionClaims = new Set()
for (const [file, text] of texts) {
  for (const match of text.match(/dsh-triage@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g) ?? []) versionClaims.add(`${file}:${match}`)
}
const wrongVersions = [...versionClaims].filter((entry) => !entry.endsWith(`dsh-triage@${version}`))
check(
  'version-matches-manifest',
  wrongVersions.length === 0,
  wrongVersions.length === 0 ? `every named version is ${version}` : `stale: ${wrongVersions.slice(0, 4).join(', ')}`,
)

/* 3. The DSH range a reader is told to expect.
 * Only the documents that state OUR compatibility: the posts quote other authors' ranges on purpose
 * (that is the point of the prerelease section), so scanning them here would be a false positive. */
const RANGE_DOCUMENTS = ['docs/market/listing_zh.md', 'docs/market/listing_en.md', 'README.md', 'README.zh-CN.md']
const rangeClaims = new Set()
for (const [file, text] of texts) {
  if (!RANGE_DOCUMENTS.includes(file)) continue
  for (const match of text.match(/>=0\.[0-9]+\.[0-9]+-rc\.[0-9]+ <0\.[0-9]+\.[0-9]+-0/g) ?? []) rangeClaims.add(`${file}:${match}`)
}
const wrongRanges = [...rangeClaims].filter((entry) => !entry.endsWith(dshRange))
check(
  'engines-range-matches-manifest',
  wrongRanges.length === 0 && rangeClaims.size > 0,
  wrongRanges.length > 0
    ? `stale range: ${wrongRanges.slice(0, 4).join(', ')}`
    : rangeClaims.size === 0
      ? 'no DSH range claim found in the copy'
      : `${rangeClaims.size} claim(s) all equal ${dshRange}`,
)

/* 4. Test count claims, when the caller knows the real number. */
const COUNT = /(\d{2,4})\s*(?:个)?(?:测试|tests?)\b/g
const countClaims = new Set()
for (const [file, text] of texts) {
  for (const match of text.matchAll(COUNT)) countClaims.add(`${file}:${match[1]}`)
}
const staleCounts = testCount === null ? [] : [...countClaims].filter((entry) => !entry.endsWith(`:${testCount}`))
check(
  'test-count-matches',
  testCount === null ? true : staleCounts.length === 0,
  testCount === null
    ? 'skipped (no --tests passed)'
    : staleCounts.length === 0
      ? `${countClaims.size} claim(s) all equal ${testCount}`
      : `stale: ${staleCounts.slice(0, 4).join(', ')}`,
)

/* 5. Placeholders and unsupportable claims.
 * A line that NAMES a phrase in order to forbid it is not a claim: the submission notes literally say
 * "don't write 100% compatible". Only unflagged occurrences count. */
const PROHIBITION = /严禁|不写|禁止|不出现|never write|do not write|don't write/i
const hits = []
for (const [file, text] of texts) {
  for (const line of text.split('\n')) {
    if (PROHIBITION.test(line)) continue
    for (const phrase of FORBIDDEN) if (line.includes(phrase)) hits.push(`${file}:${phrase}`)
  }
}
check('no-placeholders-or-claims', hits.length === 0, hits.join(', ') || 'no placeholder, no unsupported claim')

/* 6. Every post is discoverable from its index. */
const posts = [...texts.keys()].filter((file) => file.startsWith('docs/posts/') && file !== 'docs/posts/README.md')
const postIndex = texts.get('docs/posts/README.md') ?? ''
const unlisted = posts.filter((file) => !postIndex.includes(file.replace('docs/posts/', '')))
check('posts-are-indexed', unlisted.length === 0, unlisted.join(', ') || `${posts.length} post(s) listed in docs/posts/README.md`)

/* 7. The boundaries that must survive a copy edit. */
const zh = texts.get('docs/market/listing_zh.md') ?? ''
const en = texts.get('docs/market/listing_en.md') ?? ''
const upgradePost = texts.get('docs/posts/03-before-you-upgrade.md') ?? ''
check(
  'listing-keeps-wilson-interval',
  /0\.667[–-]0\.986/.test(zh) && /0\.667[–-]0\.986/.test(en),
  'both listings must state the Wilson interval of the 12/13 convenience sample',
)
check(
  'listing-keeps-forward-improved-boundary',
  zh.includes('1584') && en.includes('1584') && upgradePost.includes('1584'),
  'both listings and the upgrade post must state the forward-improved finding (0 of 1584)',
)
/* 7c. R47: 1584 is a keyword-search result, not a census (`dsh-plugin-catalog` advertises 7,557 entries).
 * The number may stay; the word that makes it a lie may not. */
const QUALIFIER = /关键词|keyword/i
const CENSUS = /全量|全网|所有 dsh 插件|every dsh plugin|all dsh plugins/i
const CENSUS_DENIED = /不是全量|非全量|not a census|no census/i
const censusHits = []
for (const [file, text] of texts) {
  for (const line of text.split('\n')) {
    if (!line.includes('1584')) continue
    const claimsCensus = CENSUS.test(line) && !CENSUS_DENIED.test(line) && !PROHIBITION.test(line)
    const missingQualifier = !QUALIFIER.test(line)
    if (claimsCensus || missingQualifier) censusHits.push(`${file}:${claimsCensus ? 'calls-1584-a-census' : 'missing-keyword-qualifier'}`)
  }
}
check(
  'listing-1584-is-qualified',
  censusHits.length === 0,
  censusHits.slice(0, 4).join(', ') || 'every mention of 1584 says it is a keyword-search result, not a census',
)

/* 8. The upgrade card on the first screen (R48 / T-809).
 * A stranger should meet the product's answer before the architecture. The numbers are never
 * re-typed by hand: they are read out of the artifact the README points at, so a card that moved
 * under the copy turns this red instead of quietly ageing (`BS-42` all over again). */
const cardProblems = []
for (const file of ['README.md', 'README.zh-CN.md']) {
  const text = texts.get(file) ?? ''
  const block = text.match(/<!--\s*upgrade-card:\s*(\S+?)\s*-->([\s\S]*?)<!--\s*\/upgrade-card\s*-->/)
  if (block === null) {
    cardProblems.push(`${file}: no upgrade-card block`)
    continue
  }
  const [, pointer, body] = block
  if (!existsSync(abs(pointer))) {
    cardProblems.push(`${file}: points at a missing artifact ${pointer}`)
    continue
  }
  const artifact = JSON.parse(readFileSync(abs(pointer), 'utf8'))
  const counts = artifact?.inputs?.counts
  if (counts === undefined) {
    cardProblems.push(`${file}: ${pointer} has no inputs.counts`)
    continue
  }
  for (const [bucket, count] of [
    ['would-be-denied', counts.would_be_denied],
    ['cannot-tell', counts.cannot_tell],
    ['improved', counts.improved],
    ['likely-fine', counts.likely_fine],
  ]) {
    if (!body.includes(`| \`${bucket}\` | ${count} |`)) {
      cardProblems.push(`${file}: the ${bucket} row does not say ${count}`)
    }
  }
  const conclusion = body.split('\n').find((line) => line.trim().startsWith('**') && line.trim().endsWith('**')) ?? ''
  if (!conclusion.includes(String(counts.total))) cardProblems.push(`${file}: the conclusion does not state ${counts.total} units`)
  if (!conclusion.includes(String(artifact?.inputs?.target))) cardProblems.push(`${file}: the conclusion does not name the target`)
  if (!body.includes('upgrade --to')) cardProblems.push(`${file}: the block does not show the command`)
  // The sandbox annotation is not decoration: without it the numbers read as "your machine".
  if (!/沙盒|sandbox/i.test(text)) cardProblems.push(`${file}: no sandbox annotation`)
  if (!/不是你的机器|not your machine/i.test(text)) cardProblems.push(`${file}: the sandbox annotation does not say it is not the reader's machine`)
  if (!/record_upgrade_card\.mjs/.test(text)) cardProblems.push(`${file}: no recompute command`)
}
check(
  'readme-shows-real-card',
  cardProblems.length === 0,
  cardProblems.slice(0, 4).join('; ') || 'both READMEs quote the artifact the card was recorded from',
)

const passed = checks.every((entry) => entry.ok)
const artifact = {
  schema_version: 1,
  produced_by: 'scripts/check_listing.mjs',
  generated_at: stamp,
  inputs: {
    version,
    engines_dsh: dshRange,
    tests: testCount,
    documents: [...texts.keys()].sort(),
  },
  referenced_evidence: [...referenced].sort(),
  checks,
  passed,
  limits: [
    'this checks mechanically verifiable claims only: version, DSH range, test count, evidence pointers, forbidden phrases',
    'prose quality, tone and whether the evidence actually supports a sentence are review work, not script work',
    'numbers inside the cited artifacts are not re-derived here; each artifact is its own source of truth',
  ],
}

const text = `${JSON.stringify(artifact, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const fileName = `listing-${stamp.replaceAll(':', '-')}.json`
const targetPath = join(outDir, fileName)
if (existsSync(targetPath)) {
  process.stderr.write(`refusing to overwrite existing evidence: ${join('data/results', fileName)}\n`)
  process.exit(2)
}
writeFileSync(targetPath, text, 'utf8')
writeFileSync(`${targetPath}.sha256`, sha256(text), 'utf8')

process.stdout.write(`listing check · ${join('data/results', fileName)}\n`)
process.stdout.write(`  ${texts.size} document(s) · version ${version} · dsh ${dshRange} · tests ${testCount ?? 'n/a'}\n`)
for (const entry of checks) process.stdout.write(`  ${entry.ok ? 'PASS' : 'FAIL'}  ${entry.id} — ${entry.detail}\n`)
process.stdout.write(`ssot ${join('data/results', fileName)} sha256=${sha256(text).slice(0, 12)}…\n`)
process.exit(passed ? 0 : 1)
