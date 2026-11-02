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
import { judgeChannels } from './lib/channels.mjs'
import { judgePosting } from './lib/posting.mjs'
import { formatInterval, formatPercent, TIERS } from './lib/question-coverage.mjs'

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
/*
 * R62: this used to be `(\d{2,4})\s*(?:个)?(?:测试|tests?)\b`, and it found ZERO claims in a repo whose
 * README says「623 个测试」— `\b` is an ASCII word boundary, so it can never match after a CJK
 * character. The check was green because it was empty, and the README's test badge stayed at 542 for
 * three rounds. Three shapes are counted now, including the badge, and "no claim found" is only
 * allowed when the caller did not pass a number.
 */
const COUNT = [/(\d{2,4})\s*(?:个)?(?:测试|tests?)/g, /tests[:\-]\s*(\d{2,4})/g, /badge\/tests-(\d{2,4})/g]
const countClaims = new Set()
for (const [file, text] of texts) {
  for (const pattern of COUNT) {
    for (const match of text.matchAll(pattern)) countClaims.add(`${file}:${match[1]}`)
  }
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
/* A checker that finds nothing must say so: "0 claims" with a number passed in is a broken pattern. */
check(
  'test-count-is-not-vacuous',
  testCount === null ? true : countClaims.size > 0,
  testCount === null ? 'skipped (no --tests passed)' : `${countClaims.size} claim(s) found across ${texts.size} document(s)`,
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

/* 9. Distribution drafts (T-810, R52): the copy that will go OUT must cite artifacts that exist and still hash.
 * D5's sample is the first thing a stranger reads, and it is the easiest place to re-type a number by hand.
 * `docs/distribution/T-810/registry.json` is the only allowed source of evidence pointers; a draft that cites
 * an artifact it did not register, or a registry that points at a file that moved, both fail here. */
const DRAFTS_DIR = 'docs/distribution/T-810'
const draftProblems = []
let draftCount = 0
const registryPath = abs(`${DRAFTS_DIR}/registry.json`)
if (!existsSync(registryPath)) {
  draftProblems.push(`${registryPath} is missing`)
} else {
  let registry = null
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  } catch {
    draftProblems.push('registry.json does not parse')
  }
  const drafts = Array.isArray(registry?.drafts) ? registry.drafts : []
  if (drafts.length === 0) draftProblems.push('registry.json lists no drafts')
  const onDisk = readdirSync(abs(DRAFTS_DIR))
    .filter((name) => name.endsWith('.md') && name !== '00-README.md')
    .sort()
  const listed = drafts.map((entry) => String(entry?.file ?? '')).sort()
  for (const name of onDisk) if (!listed.includes(name)) draftProblems.push(`${name}: on disk but not in registry.json`)
  for (const name of listed) if (!onDisk.includes(name)) draftProblems.push(`${name}: in registry.json but not on disk`)

  // The phrases five draft rules forbid, and the ban on personal identity, are checked on the drafts themselves.
  const DRAFT_FORBIDDEN = ['升级会修好', '升级即修复', 'upgrade fixes', '全网', '已收录', 'every dsh plugin', '所有 dsh 插件']
  const DRAFT_PROHIBITION = /严禁|不写|不许|不做|不得|禁止|不出现|没有出现|never|cannot|do not|don't|不要写/i
  const IDENTITY = [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, /我的微信|个人微信|加我微信/, /个人主页/]

  for (const entry of drafts) {
    /*
     * R66: a `null` inside a hand-written array used to throw on `entry.file`, which killed the whole
     * script — so all 15 assertions vanished and nothing was recorded. One bad row must fail the checks
     * it belongs to, not the run ("a check that did not run must not read as a pass", inverted).
     */
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      draftProblems.push('registry.json contains a draft entry that is not an object')
      continue
    }
    if (typeof entry.file !== 'string' || entry.file.length === 0) {
      // R66 (adversary N-1): `[{}]` used to reach `readFileSync(<drafts dir>)` and throw EISDIR, which
      // killed all 15 assertions and produced no artifact. A row without a file name is a bad row, not a
      // fatal error.
      draftProblems.push('registry.json contains a draft entry without a file name')
      continue
    }
    const name = String(entry.file ?? '')
    const status = String(entry.status ?? '')
    if (!['draft', 'posted'].includes(status)) draftProblems.push(`${name}: status must be draft|posted (got "${status}")`)
    if (status === 'posted' && (entry.posted_url === null || entry.posted_url === undefined || entry.posted_on === null || entry.posted_on === undefined)) {
      draftProblems.push(`${name}: posted drafts must record posted_url and posted_on`)
    }
    const cites = Array.isArray(entry.cites) ? entry.cites : []
    if (cites.length === 0) draftProblems.push(`${name}: cites no artifact`)
    if (!existsSync(abs(`${DRAFTS_DIR}/${name}`))) {
      draftProblems.push(`${name}: missing`)
      continue
    }
    draftCount += 1
    const text = readFileSync(abs(`${DRAFTS_DIR}/${name}`), 'utf8')
    for (const cite of cites) {
      if (!/^data\/results\/[A-Za-z0-9._-]+\.json$/.test(String(cite))) {
        draftProblems.push(`${name}: "${cite}" is not a data/results artifact`)
        continue
      }
      if (!existsSync(abs(String(cite)))) {
        draftProblems.push(`${name}: cites a missing artifact ${cite}`)
        continue
      }
      const recorded = existsSync(abs(`${cite}.sha256`)) ? readFileSync(abs(`${cite}.sha256`), 'utf8').trim() : ''
      const actual = sha256(readFileSync(abs(String(cite)), 'utf8'))
      if (recorded !== actual) draftProblems.push(`${name}: ${cite} does not match its .sha256`)
      if (!text.includes(String(cite))) draftProblems.push(`${name}: cites ${cite} in the registry but not in the text`)
    }
    if (!/upgrade --to|record_upgrade_card\.mjs|dsh-triage audit/.test(text)) {
      draftProblems.push(`${name}: no recompute command a reader could run`)
    }
    for (const line of text.split('\n')) {
      if (DRAFT_PROHIBITION.test(line)) continue
      for (const phrase of DRAFT_FORBIDDEN) if (line.includes(phrase)) draftProblems.push(`${name}: forbidden claim "${phrase}"`)
      for (const pattern of IDENTITY) if (pattern.test(line)) draftProblems.push(`${name}: personal identity (${pattern.source})`)
    }
  }
}
check(
  'drafts-cite-real-artifacts',
  draftProblems.length === 0,
  draftProblems.slice(0, 4).join('; ') || `${draftCount} draft(s), every cited artifact hashes and every draft carries a recompute command`,
)

/*
 * 13th assertion (R56): a `posted` draft must carry a usable URL and an ISO `posted_on`.
 * WHY IT MATTERS: D5's window is `posted_on + 14 days` (`docs/specs/D5-measurement.md` §2), so a
 * typo or a `null` here does not fail loudly — it silently moves the deadline and hands the verdict
 * a different window. The registry is hand-written; this is the only thing that reads it.
 *
 * R64: the URL no longer has to be a GitHub discussion. Distribution happens on more than one platform,
 * and while the rule accepted *only* discussion URLs, a post on X could not be recorded at all — so the
 * registry stayed `draft` and drifted from what actually happened (exactly the R56 failure shape).
 *
 * R65: the matcher itself moved to `scripts/lib/posting.mjs` and became unit-tested, because it had been
 * wrong twice. The second time was this round's own work: it demanded a trailing `Z`, so the perfectly
 * valid `2026-11-02T18:36:00+01:00` — the spelling a human on a UTC+1 machine writes first — was refused
 * with a message claiming it was "not timezone-qualified". `tests/unit/posting.test.ts` now pins that.
 */
const postingProblems = []
const postedRegistry = (() => {
  try {
    return JSON.parse(readFileSync(abs(`${DRAFTS_DIR}/registry.json`), 'utf8'))
  } catch {
    return null
  }
})()
if (postedRegistry === null || !Array.isArray(postedRegistry.drafts) || postedRegistry.drafts.length === 0) {
  postingProblems.push('registry.json does not parse or lists no drafts — this assertion would be vacuous')
}
for (const draft of Array.isArray(postedRegistry?.drafts) ? postedRegistry.drafts : []) {
  const name = String(draft?.file ?? '?')
  const status = String(draft?.status ?? '')
  if (status === 'posted') {
    const verdict = judgePosting({
      channel: draft?.channel,
      url: draft?.posted_url,
      postedOn: draft?.posted_on,
      now: stamp,
    })
    for (const problem of verdict.problems) postingProblems.push(`${name}: status=posted but ${problem}`)
  }
  if (status === 'draft') {
    /*
     * R66: `""` and a missing key both mean "no URL", but only `null` was accepted — so a draft with
     * `"posted_url": ""` was reported as "posted_url is set", which was a false statement about a field
     * that was never set.
     */
    const url = draft?.posted_url
    const hasUrl = url !== null && url !== undefined && String(url).length > 0
    if (hasUrl) postingProblems.push(`${name}: status=draft but posted_url is set — post the draft or clear the field`)
  }
}
check(
  'posted-drafts-carry-a-date',
  postingProblems.length === 0,
  postingProblems.slice(0, 4).join('; ') || 'every posted draft carries a URL on the platform its channel names, and a past ISO instant; drafts carry no URL',
)

/*
 * 14th assertion (R59): the coverage section's numbers are read out of the artifact, not typed.
 * WHY: the headline is 4.8% of all Q&A, and the easiest way to make it look like 12.5% is to swap
 * the denominator in prose. The block points at the **live** measurement; the review artifact and
 * the recompute artifact must exist, hash-match, and agree with it. A pilot, self-test or recompute
 * artifact is refused as the measurement pointer.
 */
const coverageProblems = []
const artifactCache = new Map()
const readArtifact = (path) => {
  if (artifactCache.has(path)) return artifactCache.get(path)
  const value = JSON.parse(readFileSync(abs(path), 'utf8'))
  artifactCache.set(path, value)
  return value
}
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right)

for (const file of ['README.md', 'README.zh-CN.md']) {
  const text = texts.get(file) ?? ''
  const block = text.match(/<!--\s*question-coverage:\s*(\S+?)\s*-->([\s\S]*?)<!--\s*\/question-coverage\s*-->/)
  if (block === null) {
    coverageProblems.push(`${file}: no question-coverage block`)
    continue
  }
  const [, pointer, body] = block
  if (!/^data\/results\/question-coverage-(?!pilot-|selftest-|recompute-)[A-Za-z0-9._-]+\.json$/.test(pointer)) {
    coverageProblems.push(`${file}: ${pointer} is not a live measurement (pilot/selftest/recompute are not evidence)`)
    continue
  }
  if (!existsSync(abs(pointer))) {
    coverageProblems.push(`${file}: points at a missing artifact ${pointer}`)
    continue
  }
  if (!existsSync(abs(`${pointer}.sha256`)) || readFileSync(abs(`${pointer}.sha256`), 'utf8').trim() !== sha256(readFileSync(abs(pointer), 'utf8'))) {
    coverageProblems.push(`${file}: ${pointer} does not match its .sha256`)
    continue
  }
  const measurement = readArtifact(pointer)
  const qa = measurement?.counts?.qa
  const general = measurement?.counts?.general
  const coverage = measurement?.coverage?.qa
  if (qa === undefined || general === undefined || coverage === undefined) {
    coverageProblems.push(`${file}: ${pointer} has no counts/coverage blocks`)
    continue
  }

  const headline = coverage.headline
  const headlineText = `${headline.count}/${headline.denominator} = ${formatPercent(headline.ratio)}`
  if (!body.includes(headlineText)) coverageProblems.push(`${file}: headline does not say "${headlineText}"`)
  const headlineInterval = formatInterval(headline.wilson95)
  if (headlineInterval === null || !body.includes(headlineInterval)) {
    coverageProblems.push(`${file}: headline does not carry Wilson ${String(headlineInterval)}`)
  }

  for (const tier of TIERS) {
    const count = qa.tiers?.[tier]
    if (typeof count !== 'number') {
      coverageProblems.push(`${file}: the artifact has no count for tier ${tier}`)
      continue
    }
    const match = body.match(new RegExp(`\\|\\s*\`?${tier}\`?\\s*\\|\\s*(\\d+)\\s*\\|\\s*([\\d.]+)%\\s*\\|`))
    if (match === null) {
      coverageProblems.push(`${file}: the ${tier} row is missing`)
      continue
    }
    if (Number(match[1]) !== count) coverageProblems.push(`${file}: ${tier} says ${match[1]}, artifact says ${count}`)
    const share = `${((count / qa.threads) * 100).toFixed(1)}%`
    if (match[2] !== share.replace('%', '')) coverageProblems.push(`${file}: ${tier} share is ${match[2]}%, artifact implies ${share}`)
  }

  for (const [label, share] of [
    ['relevant', coverage.sensitivity?.relevant],
    ['decidable', coverage.sensitivity?.decidable],
  ]) {
    if (share === undefined || share === null) {
      coverageProblems.push(`${file}: the artifact has no ${label} sensitivity`)
      continue
    }
    const text = `${share.count}/${share.denominator} = ${formatPercent(share.ratio)}`
    if (!body.includes(text)) coverageProblems.push(`${file}: ${label} context does not say "${text}"`)
    const interval = formatInterval(share.wilson95)
    if (interval === null || !body.includes(interval)) coverageProblems.push(`${file}: ${label} context does not carry Wilson ${String(interval)}`)
  }

  const generalHeadline = measurement?.coverage?.general?.headline
  if (generalHeadline === undefined) {
    coverageProblems.push(`${file}: the artifact has no General headline`)
  } else {
    const text = `${generalHeadline.count}/${generalHeadline.denominator} = ${formatPercent(generalHeadline.ratio)}`
    if (!body.includes(text)) coverageProblems.push(`${file}: General context does not say "${text}"`)
    if (!/投影|projection/i.test(body)) coverageProblems.push(`${file}: General is not labelled as a projection snapshot`)
    if (!/不与 Q&A 合并|not pooled/i.test(body)) coverageProblems.push(`${file}: General is not marked as un-pooled`)
  }

  const boundary = [
    ['sample-only boundary', /只对这个样本成立|sample only/i],
    ['not-your-machine boundary', /不是你的机器|not your machine/i],
    ['classifier caveat', /分类器|classifier/i],
    ['classifier agreement', /9\/20/],
    ['human spot-check', /5\/5/],
    ['404 explanation', /404/],
  ]
  for (const [label, pattern] of boundary) {
    if (!pattern.test(body)) coverageProblems.push(`${file}: missing ${label}`)
  }

  const reviewPointer = body.match(/data\/results\/question-review-[A-Za-z0-9._-]+\.json/)?.[0]
  if (reviewPointer === undefined) {
    coverageProblems.push(`${file}: no question-review artifact is cited`)
  } else if (!existsSync(abs(reviewPointer))) {
    coverageProblems.push(`${file}: review artifact is missing: ${reviewPointer}`)
  } else {
    const review = readArtifact(reviewPointer)
    const agreement = `${review?.agent?.agree}/${review?.agent?.total}`
    if (agreement !== '9/20') coverageProblems.push(`${file}: review artifact says ${agreement}, README says 9/20`)
    const human = `${review?.human_spot_check?.agree}/${review?.human_spot_check?.total}`
    if (human !== '5/5') coverageProblems.push(`${file}: human spot-check is ${human}, README says 5/5`)
    if (review?.measurement?.sha256 !== sha256(readFileSync(abs(pointer), 'utf8'))) {
      coverageProblems.push(`${file}: review artifact was recorded against a different measurement`)
    }
  }

  const recomputePointer = body.match(/data\/results\/question-coverage-recompute-[A-Za-z0-9._-]+\.json/)?.[0]
  if (recomputePointer === undefined) {
    coverageProblems.push(`${file}: no recompute artifact is cited`)
  } else if (!existsSync(abs(recomputePointer))) {
    coverageProblems.push(`${file}: recompute artifact is missing: ${recomputePointer}`)
  } else {
    const recompute = readArtifact(recomputePointer)
    for (const key of ['counts', 'coverage']) {
      if (!sameJson(recompute?.[key], measurement?.[key])) coverageProblems.push(`${file}: recompute disagrees with the measurement on ${key}`)
    }
    for (const key of ['qa', 'general']) {
      if (!sameJson(recompute?.rows?.[key], measurement?.rows?.[key])) coverageProblems.push(`${file}: recompute rows.${key} differ from the measurement`)
    }
  }
}
check(
  'readme-quotes-real-question-coverage',
  coverageProblems.length === 0,
  coverageProblems.slice(0, 4).join('; ') || 'both READMEs quote the live measurement, and its review/recompute artifacts agree',
)

/*
 * 16th assertion (R71): a paste-ready draft's numbers must equal the artifact it cites.
 *
 * WHY IT EXISTS: R57 wrote the three reply drafts and `drafts-cite-real-artifacts` checked that the cited
 * file exists, hashes correctly and is mentioned in the text. That is a **file** check, not a **number**
 * check: the draft could say "6 peerDependencies" while the artifact recorded 4 and both assertions stayed
 * green. R52 and R53 both lost a round to exactly that shape (a number that drifted from its evidence).
 *
 * HOW: the registry declares what the draft claims (`claims.packages[].version` / `admission_status` /
 * `range_items`) and how many times the paste block lists it (`claims.listing.token` x `times`). The checker
 * recomputes each of those **from the artifact** — and separately from the paste block — so the two have to
 * agree with each other and with the evidence. Two artifact shapes are supported, and both are named:
 *   - discussion-triage  → `rows[]` keyed by `number`, probes under `row.probes`
 *   - remedy-probe       → `rows[]` keyed by `package` + `version` (a probe IS the row)
 */
const claimProblems = []
const PASTE_BLOCK = /<!--\s*paste:start\s*-->([\s\S]*?)<!--\s*paste:end\s*-->/
const countOf = (haystack, needle) => {
  if (needle.length === 0) return 0
  let count = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    count += 1
    at = haystack.indexOf(needle, at + needle.length)
  }
  return count
}
const claimRegistry = (() => {
  try {
    return JSON.parse(readFileSync(abs(`${DRAFTS_DIR}/registry.json`), 'utf8'))
  } catch {
    return null
  }
})()
const claimDrafts = Array.isArray(claimRegistry?.drafts) ? claimRegistry.drafts : []
let claimCount = 0
for (const entry of claimDrafts) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
  const name = String(entry.file ?? '')
  const claims = entry.claims
  if (claims === undefined || claims === null) continue // only drafts that declare claims are checked
  claimCount += 1
  if (typeof name !== 'string' || name.length === 0) {
    claimProblems.push('a draft declares claims but has no file name')
    continue
  }
  if (!existsSync(abs(`${DRAFTS_DIR}/${name}`))) {
    claimProblems.push(`${name}: declares claims but the file is missing`)
    continue
  }
  const text = readFileSync(abs(`${DRAFTS_DIR}/${name}`), 'utf8')
  const paste = text.match(PASTE_BLOCK)
  if (paste === null) {
    claimProblems.push(`${name}: declares claims but has no <!-- paste:start -->…<!-- paste:end --> block`)
    continue
  }
  const body = paste[1]
  if (typeof claims.target !== 'string' || !body.includes(claims.target)) {
    claimProblems.push(`${name}: the paste block never names the target runtime ${String(claims.target)}`)
  }
  for (const phrase of Array.isArray(claims.paste_must_contain) ? claims.paste_must_contain : []) {
    if (!body.includes(String(phrase))) claimProblems.push(`${name}: the paste block lost the required phrase "${String(phrase)}"`)
  }

  // The tag claim is its own fact: a `latest` reading is a timestamped snapshot, not a property of the package.
  if (claims.dist_tags !== undefined && claims.dist_tags !== null) {
    const tagCite = String(claims.dist_tags.cite ?? '')
    if (!existsSync(abs(tagCite))) {
      claimProblems.push(`${name}: dist_tags cite is missing ${tagCite}`)
    } else {
      const tags = readArtifact(tagCite)?.rows?.find((row) => row?.dist_tags !== null && row?.dist_tags !== undefined)?.dist_tags
      if (tags === null || tags === undefined) {
        claimProblems.push(`${name}: ${tagCite} records no dist_tags, so the tag claim cannot be checked`)
      } else {
        for (const tag of ['latest', 'next']) {
          const claimed = claims.dist_tags[tag]
          if (claimed === undefined) continue
          if (tags[tag] !== claimed) claimProblems.push(`${name}: says ${tag}=${String(claimed)}, the artifact recorded ${String(tags[tag])}`)
        }
      }
    }
  }

  const packages = Array.isArray(claims.packages) ? claims.packages : []
  if (packages.length === 0) claimProblems.push(`${name}: declares claims but lists no packages`)
  for (const claim of packages) {
    if (claim === null || typeof claim !== 'object') {
      claimProblems.push(`${name}: a package claim is not an object`)
      continue
    }
    const cite = String(claim.cite ?? '')
    if (!existsSync(abs(cite))) {
      claimProblems.push(`${name}: cites a missing artifact ${cite}`)
      continue
    }
    const artifact = readArtifact(cite)
    const rows = Array.isArray(artifact?.rows) ? artifact.rows : []
    const byNumber = rows.find((row) => row?.number === claims.discussion)
    const probes = byNumber === undefined ? rows : (Array.isArray(byNumber.probes) ? byNumber.probes : [])
    const probe = probes.find(
      (candidate) =>
        candidate?.package === claim.package &&
        (claim.version === null || claim.version === undefined || candidate?.version === claim.version),
    )
    if (probe === undefined) {
      claimProblems.push(`${name}: ${String(claim.package)}${claim.version ? `@${String(claim.version)}` : ''} is not in ${cite}`)
      continue
    }
    if (claim.state !== undefined && probe.state !== claim.state) {
      claimProblems.push(`${name}: ${String(claim.package)} state is ${String(probe.state)} in the artifact, draft claims ${String(claim.state)}`)
    }
    if (claim.admission_status !== undefined && (probe.admission_status ?? null) !== claim.admission_status) {
      claimProblems.push(
        `${name}: ${String(claim.package)} is ${String(probe.admission_status)} in the artifact, draft claims ${String(claim.admission_status)}`,
      )
    }
    if (claim.state === 'measured' && claims.target !== undefined && probe.target !== claims.target) {
      claimProblems.push(`${name}: ${String(claim.package)} was judged against ${String(probe.target)}, draft claims ${String(claims.target)}`)
    }
    /*
     * R71's own first negative control failed to fail: editing `…@0.1.0-rc.7` to `…@0.1.0-rc.6` in the
     * paste block stayed green, because the claimed version was only used to *find* the probe, never to
     * check that the prose printed it. Requiring the literal `pkg@version` closes that hole — a reply that
     * names the wrong build is the most damaging thing this draft can do.
     */
    if (claim.state === 'measured' && typeof claim.version === 'string' && claim.version.length > 0) {
      const pair = `${String(claim.package)}@${claim.version}`
      if (!body.includes(pair)) claimProblems.push(`${name}: the paste block never names ${pair}`)
    }
    if (claim.range_items !== undefined) {
      const declared = typeof probe.declared_range === 'string' ? probe.declared_range.split(' , ').filter((item) => item.length > 0).length : 0
      if (declared !== claim.range_items) {
        claimProblems.push(`${name}: ${String(claim.package)} declares ${declared} range item(s) in the artifact, draft claims ${String(claim.range_items)}`)
      }
      if (Array.isArray(probe.unmet) && claim.admission_status === 'denied' && probe.unmet.length === 0) {
        claimProblems.push(`${name}: ${String(claim.package)} is claimed denied but the artifact records no unmet range`)
      }
    }
    if (claim.listing !== undefined && claim.listing !== null) {
      /*
       * `listing` is about the TEXT: the paste block states this phrase this many times. It is deliberately
       * not required to equal `range_items` — a block may summarise ("… 等 13 项") instead of listing every
       * peer. The two directions of drift are still covered, because `range_items` is recomputed from the
       * artifact and `listing` is recomputed from the block: change the evidence and the first fails, change
       * the number in the prose and the second fails.
       */
      const token = String(claim.listing.token ?? '')
      const times = Number(claim.listing.times ?? -1)
      if (token.length === 0 || !Number.isInteger(times) || times < 1) {
        claimProblems.push(`${name}: listing needs a non-empty token and a positive integer count`)
        continue
      }
      const seen = countOf(body, token)
      if (seen !== times) claimProblems.push(`${name}: the paste block contains "${token}" ${seen} time(s), the claim says ${times}`)
    }
  }
}
check(
  'draft-claims-match-their-artifact',
  claimProblems.length === 0,
  claimProblems.slice(0, 4).join('; ') ||
    (claimCount === 0
      ? 'no draft declares claims (nothing was checked — not the same as everything checked out)'
      : `${claimCount} draft(s): every claimed version, bucket, range count and tag value equals the cited artifact`),
)

/*
 * 17th assertion (R73): the multi-channel ledger is real, and exactly one channel feeds D5.
 *
 * WHY: distribution went from one discussion to four channels (GitHub / X / two subreddits) in eleven days,
 * and only the GitHub one was machine-checked. The two failure modes are symmetric and both happened to
 * other projects: a mistyped link nobody clicks, and promotion slowly reading as evidence. So the ledger
 * (`docs/distribution/channels.json`) is checked for platform/host/date coherence, for "exactly one channel
 * counts toward D5", and for agreement with the human-facing table in `00-README.md`.
 */
const channelProblems = []
let channelDetail = ''
const CHANNEL_LEDGER = 'docs/distribution/channels.json'
const CHANNEL_TABLE_DOC = 'docs/distribution/T-810/00-README.md'
const channelLedger = (() => {
  try {
    return JSON.parse(readFileSync(abs(CHANNEL_LEDGER), 'utf8'))
  } catch (error) {
    channelProblems.push(`${CHANNEL_LEDGER} does not parse: ${String(error?.message ?? error)}`)
    return null
  }
})()
if (channelLedger !== null) {
  const registry = postedRegistry
  const posted = Array.isArray(registry?.drafts)
    ? registry.drafts.filter((entry) => entry?.status === 'posted' && typeof entry?.posted_url === 'string')
    : []
  const d5Post = posted.find((entry) => /discussions\/\d+/.test(String(entry.posted_url))) ?? null
  const verdict = judgeChannels({
    channels: channelLedger.channels,
    now: stamp,
    registryUrl: d5Post === null ? null : String(d5Post.posted_url),
    registryPostedOn: d5Post === null ? null : String(d5Post.posted_on),
  })
  channelProblems.push(...verdict.problems)

  /*
   * The table and the ledger must name the same links. Both directions matter: a ledger entry missing from
   * the document is invisible to a human reader, and a document row missing from the ledger is a claim no
   * machine checks — that is how the Reddit posts lived in prose only.
   */
  const ledgerUrls = new Set(
    (Array.isArray(channelLedger.channels) ? channelLedger.channels : [])
      .map((entry) => (entry !== null && typeof entry === 'object' ? String(entry.url ?? '') : ''))
      .filter((url) => url.length > 0),
  )
  /*
   * Read the two human-facing files directly instead of adding them to DOCUMENTS: `DOCUMENTS` runs the
   * forbidden-phrase check over marketing copy, and that copy is HUMAN-owned (R73: the Reddit/HN draft is a
   * promo asset, not a project claim). Here we only need the link sets.
   */
  const readIfPresent = (path) => (existsSync(abs(path)) ? readFileSync(abs(path), 'utf8') : null)
  const doc = readIfPresent(CHANNEL_TABLE_DOC)
  const sectionStart = doc === null ? -1 : doc.indexOf('已发布的社区矩阵跟踪')
  if (doc === null) {
    channelProblems.push(`${CHANNEL_TABLE_DOC}: missing`)
  } else if (sectionStart === -1) {
    channelProblems.push(`${CHANNEL_TABLE_DOC}: no 已发布的社区矩阵跟踪 section`)
  } else {
    const rest = doc.slice(sectionStart)
    const stop = rest.slice(1).search(/\n(?:>|##)/)
    const section = stop === -1 ? rest : rest.slice(0, stop + 1)
    const tableUrls = new Set((section.match(/https:\/\/[^\s|)]+/g) ?? []).map((url) => url.replace(/[.,;]+$/, '')))
    for (const url of ledgerUrls) if (!tableUrls.has(url)) channelProblems.push(`${CHANNEL_TABLE_DOC}: the table never lists ${url}`)
    for (const url of tableUrls) if (!ledgerUrls.has(url)) channelProblems.push(`${CHANNEL_LEDGER}: ${url} is in the table but not in the ledger`)
  }

  // The Reddit links also live in the campaign file a human copies from; a typo there is the lived risk.
  const campaign = readIfPresent('docs/distribution/reddit-and-hn-posts.md')
  let campaignChecked = false
  if (campaign !== undefined && campaign !== null) {
    campaignChecked = true
    for (const entry of Array.isArray(channelLedger.channels) ? channelLedger.channels : []) {
      if (entry?.platform !== 'reddit') continue
      if (!campaign.includes(String(entry.url))) channelProblems.push(`docs/distribution/reddit-and-hn-posts.md: does not mention ${String(entry.url)}`)
    }
  }
  /*
   * Say when a cross-check did not run. The campaign file is HUMAN-owned and may be absent from a given
   * checkout; a skip that looks identical to a pass is the R51 `pending`-as-answer shape.
   */
  channelDetail = campaignChecked ? '' : ' (reddit campaign file absent: its link cross-check did not run)'
}
check(
  'channel-ledger-matches-reality',
  channelProblems.length === 0,
  channelProblems.slice(0, 4).join('; ') ||
    `${Array.isArray(channelLedger?.channels) ? channelLedger.channels.length : 0} channel(s): one feeds D5, the rest say why they do not, and the table names the same links${channelDetail}`,
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
    /**
     * R65: which registry state produced this verdict. The posting controls mutate the registry and
     * restore it byte for byte, so without this digest every control artifact would look identical to the
     * final green run — the audit trail would say "15/15" and nothing about *what* was checked.
     */
    drafts_registry_sha256: existsSync(registryPath) ? sha256(readFileSync(registryPath, 'utf8')) : null,
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
