#!/usr/bin/env node
/**
 * Market baseline (R47): what the ecosystem actually downloads, and how much of its pain goes unanswered.
 *
 * WHY THIS EXISTS: R47 turned the product around (generic checker -> "upgrade day") on the strength of three
 * outside numbers: the diagnostics category's download ceiling, our own zero, and the share of upstream fault
 * discussions nobody answers. Those numbers were first read in a chat. This project's own rule is that a
 * conclusion without an artifact is not a conclusion, so the numbers get a script, a snapshot and a `.sha256`.
 *
 * WHAT IT MEASURES (nothing else):
 *   1. `last-week` npm downloads for a fixed, hand-classified package list (diagnostics / marketplace /
 *      decorative / capability) plus the harness itself and this repo's own package;
 *   2. whether this repo's package has any download record at all (the downloads API answers 404 for a
 *      package with no recorded downloads - that is "no record", which is NOT the same claim as "0");
 *   3. upstream GitHub Discussions: the most recent N (default 900), split into pain clusters with a fixed
 *      regex table, plus how many of those threads have zero replies.
 *
 * WHAT IT MUST NEVER DO:
 *   - invent a download number. A 404 stays `week_downloads: null` + `downloads_state: 'no-record'`, and the
 *     category total only sums the numeric members (`summed_members` says how many);
 *   - claim a census. The package list is hand-classified and npm keyword search is the only discovery
 *     channel we have (`dsh-plugin-catalog` advertises 7,557 entries; keyword search returns 1,584), so every
 *     denominator in the artifact is named;
 *   - depend on the network to be re-readable: raw responses are cached under `data/fixtures/`, and
 *     `--fixtures <dir>` recomputes the whole artifact offline.
 *
 *   node scripts/record_market_baseline.mjs --stamp 2026-10-29T12:00:00.000Z
 *   node scripts/record_market_baseline.mjs --stamp <ISO> --fixtures data/fixtures/market-baseline/<stamp>
 *
 * Exit codes: 0 written · 2 bad usage / refusing to overwrite / a required source failed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
if (stamp === null) {
  process.stderr.write('usage: node scripts/record_market_baseline.mjs --stamp <ISO> [--fixtures <dir>] [--pages <n>] [--out <dir>]\n')
  process.exit(2)
}
const outDir = pathFor(String(argOf('--out', 'data/results')))
const fixturesDir = argOf('--fixtures', null) === null ? pathFor(join('data/fixtures/market-baseline', stamp.replaceAll(':', '-'))) : pathFor(String(argOf('--fixtures')))
const offline = argOf('--fixtures', null) !== null
const discussionTarget = Number(argOf('--pages', '9')) * 100
const UPSTREAM = 'deepseek-ai/deepseek-harness'
const USER_AGENT = 'dsh-triage-market-baseline'

/*
 * The hand-classified list. Every member is a real npm name observed in the dsh ecosystem on 2026-10-29.
 * A package that has no download record stays in the list: its absence is the finding, not a reason to drop it.
 */
const CATEGORIES = {
  diagnostics: [
    'dsh-doctor',
    'dsh-verify',
    'dsh-plugin-guard',
    'dsh-plugin-check',
    'dsh-guard',
    'dsh-compat',
    'dsh-lint',
    'dsh-diagnose',
    'dsh-triage',
    'dsh-preflight',
  ],
  marketplace: ['dshmarket', 'dsh-plugin-catalog', 'dsh-plugin'],
  decorative: ['dsh-pet', 'dsh-whale-widget', 'dsh-plugin-wallpaper-engine', 'dsh-meme', 'dsh-dream-skin', 'dsh-dafeiyu'],
  capability: [
    'dsh-ops',
    'dsh-cost-meter',
    '@michengai/dsh-skills-manager',
    '@xmanrui/dsh-im',
    'dsh-free-search',
    'dsh-mnemon',
    'dsh-image-gen',
    '@liustack/modsearch',
    'dsh-connect-workbuddy',
    'dsh-codex-subscription',
    'dsh-bili-scroll',
  ],
  harness: ['@deepseek-ai/dsh'],
}

/** Pain clusters. Fixed on purpose: a regex table that drifts makes two runs incomparable. */
const CLUSTERS = {
  'session-history': /历史|session log|corrupt|会话.*(损坏|丢失|加载失败)|seq 重叠|归档/i,
  'plugin-breakage': /插件.*(报错|崩|不可用|消失|冲突|没反应)|plugin.*(fail|break|conflict|resolve|not found)|兼容|incompatible|装了.*(报错|崩)/i,
  'install-startup': /安装.*(失败|报错|卡)|无法(安装|启动)|pnpm add|loader cannot resolve|启动失败|EACCES|ENOENT/i,
  'windows-native': /koffi|原生|Win32|ReplaceFile|windows.*(崩|报错|不可用)/i,
  'model-provider': /模型.*(连接|报错|不可用)|provider|STREAM_CLOSED|gateway|OAuth/i,
  'ui-ux': /界面|UI|卡死|白屏|卡顿|体验|GUI/i,
  'plugin-authoring': /开发.*插件|写.*插件|插件.*(教程|上架|发布)|plugin.*(dev|publish|spec)/i,
}

const fetchJson = async (url, headers = {}) => {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers } })
  const text = await response.text()
  return { status: response.status, ok: response.ok, text }
}

const downloadsName = (name) => name.replace('/', '%2F')

async function readOrFetch(cachePath, url, headers) {
  if (offline) {
    if (!existsSync(cachePath)) {
      process.stderr.write(`offline: missing fixture ${cachePath}\n`)
      process.exit(2)
    }
    return JSON.parse(readFileSync(cachePath, 'utf8'))
  }
  const result = await fetchJson(url, headers)
  mkdirSync(join(fixturesDir), { recursive: true })
  writeFileSync(cachePath, `${JSON.stringify({ url, status: result.status, body: result.text })}\n`, 'utf8')
  return { url, status: result.status, body: result.text }
}

const cacheName = (prefix, key) => join(fixturesDir, `${prefix}-${key.replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`)

/* ---------------------------------------------------------------- downloads */

const packages = {}
const failures = []
for (const [category, members] of Object.entries(CATEGORIES)) {
  for (const name of members) {
    const cached = await readOrFetch(
      cacheName('npm-downloads', name),
      `https://api.npmjs.org/downloads/point/last-week/${downloadsName(name)}`,
    )
    let body = null
    try {
      body = JSON.parse(cached.body)
    } catch {
      body = null
    }
    if (cached.status === 200 && body !== null && typeof body.downloads === 'number') {
      packages[name] = {
        category,
        week_downloads: body.downloads,
        downloads_state: 'recorded',
        window: { from: body.start ?? null, to: body.end ?? null },
      }
    } else if (cached.status === 404) {
      // No recorded downloads in the window. Deliberately not written as 0.
      packages[name] = { category, week_downloads: null, downloads_state: 'no-record', window: null }
    } else {
      packages[name] = { category, week_downloads: null, downloads_state: `error-${cached.status}`, window: null }
      failures.push(`${name}: downloads API ${cached.status}`)
    }
  }
}

const categoryTotals = {}
for (const category of Object.keys(CATEGORIES)) {
  const members = Object.entries(packages).filter(([, value]) => value.category === category)
  const numeric = members.filter(([, value]) => typeof value.week_downloads === 'number')
  const total = numeric.reduce((sum, [, value]) => sum + value.week_downloads, 0)
  categoryTotals[category] = {
    members: members.map(([name]) => name).sort(),
    summed_members: numeric.length,
    unrecorded_members: members.filter(([, value]) => value.week_downloads === null).map(([name]) => name).sort(),
    week_downloads_total: total,
    note: `total sums only the ${numeric.length} member(s) with a recorded download count; ${members.length - numeric.length} have no record`,
  }
}

/* ----------------------------------------------------------------- registry */

const triageRegistry = await readOrFetch(cacheName('npm-registry', 'dsh-triage'), 'https://registry.npmjs.org/dsh-triage')
let triageVersions = null
let triageTags = null
try {
  const parsed = JSON.parse(triageRegistry.body)
  triageVersions = Object.keys(parsed.versions ?? {}).sort()
  triageTags = parsed['dist-tags'] ?? null
} catch {
  failures.push('dsh-triage: registry body unreadable')
}

/* -------------------------------------------------------------- discussions */

const projectionPath = join(fixturesDir, 'gh-discussions-projection.json')

/** Only the fields the classifier reads. Raw thread bodies are never cached: 100 full threads per page is megabytes. */
function project(items) {
  return items.map((item) => ({
    number: typeof item.number === 'number' ? item.number : null,
    title: String(item.title ?? '').slice(0, 240),
    category: String(item.category?.name ?? ''),
    comments: typeof item.comments === 'number' ? item.comments : 0,
    created_at: String(item.created_at ?? ''),
    excerpt: String(item.body ?? '').slice(0, 240),
  }))
}

async function discussionsPage(pageNumber) {
  const result = await fetchJson(`https://api.github.com/repos/${UPSTREAM}/discussions?per_page=100&page=${pageNumber}`, {
    accept: 'application/vnd.github+json',
  })
  if (!result.ok) return { ok: false, status: result.status, items: [] }
  let items = []
  try {
    items = JSON.parse(result.text)
  } catch {
    return { ok: false, status: result.status, items: [] }
  }
  return { ok: true, status: result.status, items: Array.isArray(items) ? items : [] }
}

/** The last page holding discussions, by doubling then bisecting. ~8 requests instead of 120. */
async function lastDiscussionPage() {
  let known = 1
  let probe = 1
  for (;;) {
    const result = await discussionsPage(probe)
    if (!result.ok || result.items.length === 0) break
    known = probe
    probe *= 2
    if (probe > 4096) break
  }
  let low = known
  let high = probe
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    const result = await discussionsPage(middle)
    if (!result.ok || result.items.length === 0) high = middle
    else low = middle
  }
  return low
}

let pageNumbers = []
let threads = []
if (offline) {
  if (!existsSync(projectionPath)) {
    process.stderr.write(`offline: missing fixture ${projectionPath}\n`)
    process.exit(2)
  }
  const projection = JSON.parse(readFileSync(projectionPath, 'utf8'))
  pageNumbers = Array.isArray(projection.page_numbers) ? projection.page_numbers : []
  threads = Array.isArray(projection.threads) ? projection.threads : []
} else {
  const lastPage = await lastDiscussionPage()
  const pagesPerFetch = Math.max(1, Math.ceil(discussionTarget / 100))
  for (let index = pagesPerFetch - 1; index >= 0; index -= 1) {
    const pageNumber = lastPage - index
    if (pageNumber >= 1) pageNumbers.push(pageNumber)
  }
  for (const pageNumber of pageNumbers) {
    const result = await discussionsPage(pageNumber)
    if (!result.ok) {
      failures.push(`discussions page ${pageNumber}: HTTP ${result.status}`)
      continue
    }
    threads.push(...project(result.items))
  }
  mkdirSync(fixturesDir, { recursive: true })
  writeFileSync(projectionPath, `${JSON.stringify({ upstream: UPSTREAM, last_page: lastPage, page_numbers: pageNumbers, threads }, null, 2)}\n`, 'utf8')
}

const clusterCounts = {}
for (const [id, pattern] of Object.entries(CLUSTERS)) {
  const hit = threads.filter((thread) => pattern.test(thread.title) || pattern.test(thread.excerpt))
  clusterCounts[id] = {
    threads: hit.length,
    comments_total: hit.reduce((sum, thread) => sum + thread.comments, 0),
    unanswered: hit.filter((thread) => thread.comments === 0).length,
  }
}
const pain = threads.filter((thread) => Object.values(CLUSTERS).some((pattern) => pattern.test(thread.title) || pattern.test(thread.excerpt)))
const ratio = (numerator, denominator) => (denominator === 0 ? null : Number((numerator / denominator).toFixed(4)))

/* ------------------------------------------------------------------ claims */

const diagnostics = categoryTotals.diagnostics
const marketplace = categoryTotals.marketplace
const decorative = categoryTotals.decorative
const claims = [
  {
    id: 'diagnostics-category-ceiling',
    statement: `the whole diagnostics category sums to ${diagnostics.week_downloads_total} weekly downloads across the ${diagnostics.summed_members} of ${diagnostics.members.length} members with a record`,
    recompute: 'categories.diagnostics.week_downloads_total',
  },
  {
    id: 'diagnostics-share-of-marketplace',
    statement: `diagnostics is ${ratio(diagnostics.week_downloads_total, marketplace.week_downloads_total)} of the marketplace category`,
    recompute: 'compare categories.diagnostics / categories.marketplace',
  },
  {
    id: 'this-package-has-no-record',
    statement: `dsh-triage downloads_state is '${packages['dsh-triage']?.downloads_state}', which is not the same claim as zero downloads`,
    recompute: 'packages["dsh-triage"].downloads_state',
  },
  {
    id: 'decorative-outdraws-diagnostics',
    statement: `decorative members sum to ${decorative.week_downloads_total} weekly downloads, ${ratio(decorative.week_downloads_total, diagnostics.week_downloads_total)}x the whole diagnostics category`,
    recompute: 'categories.decorative.week_downloads_total',
  },
  {
    id: 'pain-share-and-unanswered',
    statement: `of the ${threads.length} most recent discussions, ${pain.length} (${ratio(pain.length, threads.length)}) match a pain cluster and ${pain.filter((thread) => thread.comments === 0).length} of those have zero replies`,
    recompute: 'discussions.pain_threads / discussions.unanswered_share',
  },
]

const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_market_baseline.mjs',
  generated_at: stamp,
  inputs: {
    window: 'last-week',
    packages: Object.keys(packages).length,
    discussion_pages: pageNumbers,
    discussion_target: discussionTarget,
    offline,
    fixtures: offline ? fixturesDir : 'data/fixtures/market-baseline/<stamp>',
  },
  packages,
  categories: categoryTotals,
  triage: { registry_status: triageRegistry.status, versions: triageVersions, dist_tags: triageTags },
  discussions: {
    upstream: UPSTREAM,
    fetched: threads.length,
    page_numbers: pageNumbers,
    newest_number: threads.length === 0 ? null : Math.max(...threads.map((thread) => thread.number ?? 0)),
    oldest_number: threads.length === 0 ? null : Math.min(...threads.map((thread) => thread.number ?? 0)),
    window: threads.length === 0 ? null : { from: threads.at(-1)?.created_at ?? null, to: threads[0]?.created_at ?? null },
    clusters: clusterCounts,
    pain_threads: pain.length,
    pain_share: ratio(pain.length, threads.length),
    unanswered_share: ratio(pain.filter((thread) => thread.comments === 0).length, pain.length),
  },
  claims,
  failures,
  limits: [
    'the package list is hand-classified, not a census: npm keyword search is the only discovery channel this repo has (dsh-plugin-catalog advertises 7,557 entries; keyword search returns 1,584)',
    'a 404 from the downloads API is recorded as `no-record`, never as 0 - the two are different claims',
    'discussion threads are classified by a fixed regex table over title + a 240-character excerpt; long bodies are not retained, so a re-run classifies the same excerpt, not the whole thread',
    'github discussion paging is not stable: new threads shift page boundaries, so `page_numbers` and the newest/oldest numbers are recorded for every run and runs are not byte-comparable across days',
    'this measures the ecosystem, not users: it cannot tell whether the demand is absent or merely unavailable in this delivery form (that is D5)',
  ],
}

/* -------------------------------------------------------------------- write */

const text = `${JSON.stringify(artifact, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const fileName = `market-baseline-${stamp.replaceAll(':', '-')}.json`
const targetPath = join(outDir, fileName)
if (existsSync(targetPath)) {
  process.stderr.write(`refusing to overwrite existing evidence: ${fileName}\n`)
  process.exit(2)
}
writeFileSync(targetPath, text, 'utf8')
writeFileSync(`${targetPath}.sha256`, `${sha256(text)}\n`, 'utf8')

process.stdout.write(`market baseline · ${fileName}\n`)
process.stdout.write(`  diagnostics ${diagnostics.week_downloads_total} / marketplace ${marketplace.week_downloads_total} / decorative ${decorative.week_downloads_total}\n`)
process.stdout.write(`  dsh-triage downloads_state=${packages['dsh-triage']?.downloads_state} versions=${String(triageVersions?.length ?? 0)}\n`)
process.stdout.write(`  discussions ${threads.length} fetched · pain ${pain.length} · unanswered ${pain.filter((thread) => thread.comments === 0).length}\n`)
if (failures.length > 0) {
  for (const failure of failures) process.stdout.write(`  failure ${failure}\n`)
}
process.stdout.write(`ssot ${fileName} sha256=${sha256(text).slice(0, 12)}…\n`)
process.exit(0)
