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
 *   3. **the shape of that traffic** (R52): the daily series per package, classified as `steady` /
 *      `single-day-burst` / `no-downloads` / `unreadable`, and the resulting D5 verdict. A weekly total
 *      alone is not a demand claim: on 2026-10-31 `dsh-triage` showed 634 downloads, all of them on one
 *      day between two silent days (a mirror/scanner crawl of a brand-new package). D5's `>= 20` counts
 *      only when the shape is `steady` (`scripts/lib/download-shape.mjs`, rule approved in `SIGNOFF` R52);
 *   4. upstream GitHub Discussions: the most recent N (default 900), split into pain clusters with a fixed
 *      regex table, plus how many of those threads have zero replies.
 *
 * WHAT IT MUST NEVER DO:
 *   - invent a download number. A 404 stays `week_downloads: null` + `downloads_state: 'no-record'`, and the
 *     category total only sums the numeric members (`summed_members` says how many);
 *   - turn a single-day burst into demand, or a missing series into "no demand". A series we could not read is
 *     `unreadable` and its verdict is `unmeasurable` - never a conclusion;
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
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { BURST_PEAK_SHARE, D5_MINIMUM_WEEK_DOWNLOADS, classifyDownloadShape, judgeWeeklyDemand } from './lib/download-shape.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

/**
 * A path as it may appear in a published artifact.
 *
 * R52 caught this the hard way: an offline recompute wrote `inputs.fixtures` as
 * `C:\Users\<name>\Desktop\...` into `data/results/`, which `gate_governance` rejects (`results-privacy`).
 * Inside the repo the path is repo-relative; outside it, only the last segment survives.
 */
const portablePath = (value) => {
  const rel = relative(abs('.'), value)
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? `<external>/${basename(value)}` : rel.replaceAll('\\', '/')
}

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
/** Collected source failures. The artifact ships them; they are never silently dropped. */
const failures = []

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
  return { status: response.status, ok: response.ok, text, retryAfter: response.headers.get('retry-after') }
}

const downloadsName = (name) => name.replace('/', '%2F')

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * One request, paced, with retries on the two answers that mean "ask again" rather than "here is the data".
 *
 * R52: a first run of this script asked for 31 weekly totals and 22 daily series back to back and the npm
 * downloads API started answering `429`. Eleven packages became `unreadable`, which is honest but useless -
 * a category total that silently loses a third of its members is worse than a slow run. So:
 *
 *   - requests are paced, because the limit is per unit time, not per request;
 *   - `429` / `5xx` are retried with `Retry-After` when the API sends one, exponential backoff otherwise;
 *   - **a retried-out failure is not cached as a fixture**: writing a `429` into `data/fixtures/` would make
 *     an offline recompute replay the failure as if it were the world's answer.
 *
 * Measured on 2026-10-31 (so the numbers are not guesses): 22 back-to-back weekly-total requests all
 * answered `200`, while the daily-series endpoint started answering `429` after **11** requests in the same
 * burst, and recovered **within ~5s**. So the two endpoints get different pacing, and the retry ladder
 * starts above the window it has to cross.
 */
const DEFAULT_PACE_MS = 300
const SERIES_PACE_MS = 800
const RETRY_DELAYS = [2000, 5000, 10000]

async function readOrFetch(cachePath, url, headers, paceMs = DEFAULT_PACE_MS) {
  if (offline) {
    if (!existsSync(cachePath)) {
      process.stderr.write(`offline: missing fixture ${cachePath}\n`)
      process.exit(2)
    }
    return JSON.parse(readFileSync(cachePath, 'utf8'))
  }

  let result = null
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
    if (attempt > 0) {
      const retryAfter = result?.retryAfter === null || result?.retryAfter === undefined ? null : Number(result.retryAfter)
      const wait = retryAfter !== null && Number.isFinite(retryAfter) ? retryAfter * 1000 : RETRY_DELAYS[attempt - 1]
      await sleep(wait)
    }
    result = await fetchJson(url, headers)
    const retryable = result.status === 429 || result.status >= 500
    if (!retryable) break
  }

  const cacheable = result.status < 500 && result.status !== 429
  if (cacheable) {
    mkdirSync(join(fixturesDir), { recursive: true })
    writeFileSync(cachePath, `${JSON.stringify({ url, status: result.status, body: result.text })}\n`, 'utf8')
  }
  await sleep(paceMs)
  return { url, status: result.status, body: result.text }
}

const cacheName = (prefix, key) => join(fixturesDir, `${prefix}-${key.replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`)

/* ---------------------------------------------------------------- downloads */

/*
 * Batching, measured 2026-10-31: one request can carry many unscoped names
 * (`/point/last-week/a,b,c` -> an object keyed by name, with `null` for a package that has no record), but
 * **scoped packages are rejected in bulk lookups** ("scoped packages are not currently supported in bulk
 * lookups"). So: one batched request for the unscoped members, one per scoped member. That is 10 requests
 * instead of 62 - which is what the rate limiter was actually punishing.
 */

const isScoped = (name) => name.startsWith('@')
const parseBody = (cached) => {
  try {
    return JSON.parse(cached.body)
  } catch {
    return null
  }
}

const allNames = Object.values(CATEGORIES).flat()
const plainNames = allNames.filter((name) => !isScoped(name))
const scopedNames = allNames.filter(isScoped)

/** name -> { state: 'recorded' | 'no-record' | 'error-<status>', body } */
const pointByName = new Map()
{
  const cached = await readOrFetch(
    cacheName('npm-downloads', 'bulk-unscoped'),
    `https://api.npmjs.org/downloads/point/last-week/${plainNames.join(',')}`,
  )
  const body = parseBody(cached)
  const usable = cached.status === 200 && body !== null && typeof body === 'object' && !Array.isArray(body)
  for (const name of plainNames) {
    if (!usable) {
      pointByName.set(name, { state: `error-${cached.status}`, body: null })
      failures.push(`${name}: downloads API ${cached.status} (bulk lookup for unscoped members)`)
      continue
    }
    const member = body[name] ?? null
    pointByName.set(name, member === null ? { state: 'no-record', body: null } : { state: 'recorded', body: member })
  }
}
for (const name of scopedNames) {
  const cached = await readOrFetch(
    cacheName('npm-downloads', name),
    `https://api.npmjs.org/downloads/point/last-week/${downloadsName(name)}`,
  )
  const body = parseBody(cached)
  if (cached.status === 200 && body !== null && typeof body.downloads === 'number') {
    pointByName.set(name, { state: 'recorded', body })
  } else if (cached.status === 404) {
    pointByName.set(name, { state: 'no-record', body: null })
  } else {
    pointByName.set(name, { state: `error-${cached.status}`, body: null })
    failures.push(`${name}: downloads API ${cached.status}`)
  }
}

/** The window to ask daily series for: every member of one `last-week` lookup shares it. */
const seriesWindow = (() => {
  for (const [name, entry] of pointByName) {
    if (entry.state !== 'recorded') continue
    const { start, end } = entry.body ?? {}
    if (typeof start === 'string' && typeof end === 'string') return { from: start, to: end }
    failures.push(`${name}: downloads API gave no start/end window`)
  }
  return null
})()

/** name -> daily series (array) or null. */
const dailyByName = new Map()
if (seriesWindow !== null) {
  const cached = await readOrFetch(
    cacheName('npm-downloads-range', 'bulk-unscoped'),
    `https://api.npmjs.org/downloads/range/${seriesWindow.from}:${seriesWindow.to}/${plainNames.join(',')}`,
    {},
    SERIES_PACE_MS,
  )
  const body = parseBody(cached)
  for (const name of plainNames) {
    if (pointByName.get(name)?.state !== 'recorded') continue
    const member = body === null || typeof body !== 'object' ? null : body[name]
    const series = Array.isArray(member?.downloads) ? member.downloads : null
    if (series === null) failures.push(`${name}: downloads range API gave no daily series (HTTP ${cached.status})`)
    dailyByName.set(name, series)
  }
  for (const name of scopedNames) {
    if (pointByName.get(name)?.state !== 'recorded') continue
    const entry = pointByName.get(name)
    const own = entry.body?.start && entry.body?.end ? { from: entry.body.start, to: entry.body.end } : seriesWindow
    const seriesCached = await readOrFetch(
      cacheName('npm-downloads-range', name),
      `https://api.npmjs.org/downloads/range/${own.from}:${own.to}/${downloadsName(name)}`,
      {},
      SERIES_PACE_MS,
    )
    const seriesBody = parseBody(seriesCached)
    const series = Array.isArray(seriesBody?.downloads) ? seriesBody.downloads : null
    if (series === null) failures.push(`${name}: downloads range API ${seriesCached.status}`)
    dailyByName.set(name, series)
  }
} else {
  for (const name of plainNames) if (pointByName.get(name)?.state === 'recorded') failures.push(`${name}: no window, so no daily series`)
  for (const name of scopedNames) if (pointByName.get(name)?.state === 'recorded') failures.push(`${name}: no window, so no daily series`)
}

const packages = {}
for (const [category, members] of Object.entries(CATEGORIES)) {
  for (const name of members) {
    const entry = pointByName.get(name) ?? { state: 'error-unknown', body: null }
    if (entry.state === 'recorded') {
      const window =
        typeof entry.body.start === 'string' && typeof entry.body.end === 'string'
          ? { from: entry.body.start, to: entry.body.end }
          : null
      const daily = dailyByName.get(name) ?? null
      const shape = classifyDownloadShape(daily)
      const judgement = judgeWeeklyDemand(shape)
      packages[name] = {
        category,
        week_downloads: entry.body.downloads,
        downloads_state: 'recorded',
        window,
        download_shape: shape.shape,
        shape_reason: shape.reason,
        days_with_downloads: shape.days_with_downloads,
        peak_day: shape.peak_day,
        peak_share: shape.peak_share,
        weekly_demand_verdict: judgement.verdict,
        daily,
      }
    } else if (entry.state === 'no-record') {
      // No recorded downloads in the window. Deliberately not written as 0.
      packages[name] = {
        category,
        week_downloads: null,
        downloads_state: 'no-record',
        window: null,
        download_shape: 'no-record',
        shape_reason: 'the downloads API has no record for this package at all',
        days_with_downloads: null,
        peak_day: null,
        peak_share: null,
        weekly_demand_verdict: judgeWeeklyDemand({ shape: 'no-record', total: null }).verdict,
        daily: null,
      }
    } else {
      packages[name] = {
        category,
        week_downloads: null,
        downloads_state: entry.state,
        window: null,
        download_shape: 'unreadable',
        shape_reason: `the downloads API answered ${String(entry.state).replace('error-', '')}`,
        days_with_downloads: null,
        peak_day: null,
        peak_share: null,
        weekly_demand_verdict: 'unmeasurable',
        daily: null,
      }
    }
  }
}

const shapeCounts = {}
for (const value of Object.values(packages)) {
  shapeCounts[value.download_shape] = (shapeCounts[value.download_shape] ?? 0) + 1
}

const triagePackage = packages['dsh-triage']
const triageJudgement = judgeWeeklyDemand(
  { shape: triagePackage?.download_shape ?? 'unreadable', total: triagePackage?.week_downloads ?? null, peak_day: triagePackage?.peak_day ?? null },
  { minimum: D5_MINIMUM_WEEK_DOWNLOADS },
)

const d5 = {
  gate: 'D5',
  package: 'dsh-triage',
  weekly_threshold: D5_MINIMUM_WEEK_DOWNLOADS,
  week_downloads: triagePackage?.week_downloads ?? null,
  downloads_state: triagePackage?.downloads_state ?? 'unreadable',
  download_shape: triagePackage?.download_shape ?? 'unreadable',
  days_with_downloads: triagePackage?.days_with_downloads ?? null,
  peak_day: triagePackage?.peak_day ?? null,
  peak_share: triagePackage?.peak_share ?? null,
  verdict: triageJudgement.verdict,
  counts_as_demand: triageJudgement.counts_as_demand,
  detail: triageJudgement.detail,
  rule: `「周下载 ≥ ${D5_MINIMUM_WEEK_DOWNLOADS}」只在 download_shape=steady 时判定（≥2 天有下载且单日占比 ≤ ${BURST_PEAK_SHARE * 100}%）；单日爆发不计为需求。口径 2026-10-31 批准，见 audit/SIGNOFF.md R52 与 docs/ROADMAP.md §2`,
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

/**
 * GitHub keeps two different refusals apart, and so must we:
 *   - unauthenticated `403 API rate limit exceeded` (60 requests/hour per IP) — the run cannot ask, so it must
 *     not write a baseline that reads as "nobody has problems". `GITHUB_TOKEN` / `GH_TOKEN` raises the limit
 *     to 5,000/hour; the token is read from the environment and never written to the artifact;
 *   - a page that genuinely does not exist (404 / empty) — that is a real end of list.
 */
const GITHUB_TOKEN = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? ''

async function discussionsPage(pageNumber) {
  const headers = { accept: 'application/vnd.github+json' }
  if (GITHUB_TOKEN !== '') headers.authorization = `Bearer ${GITHUB_TOKEN}`
  const result = await fetchJson(`https://api.github.com/repos/${UPSTREAM}/discussions?per_page=100&page=${pageNumber}`, headers)
  await sleep(GITHUB_PACE_MS)
  if (!result.ok) return { ok: false, status: result.status, items: [], detail: firstLine(result.text) }
  let items = []
  try {
    items = JSON.parse(result.text)
  } catch {
    return { ok: false, status: result.status, items: [], detail: 'body is not JSON' }
  }
  return { ok: true, status: result.status, items: Array.isArray(items) ? items : [], detail: null }
}

const GITHUB_PACE_MS = 250

function firstLine(text) {
  const line = String(text ?? '').split(/\r?\n/).find((value) => value.trim() !== '')
  return line === undefined ? '' : line.trim().slice(0, 200)
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
  // The same rule on the offline path: an empty projection is not evidence of a painless ecosystem.
  if (threads.length === 0) {
    process.stderr.write('refusing to write a market baseline from an empty discussion projection\n')
    process.exit(2)
  }
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
      failures.push(`discussions page ${pageNumber}: HTTP ${result.status}${result.detail ? ` · ${result.detail}` : ''}`)
      continue
    }
    threads.push(...project(result.items))
  }

  // An empty or half-read discussion table is the worst possible artifact: `pain_threads: 0` reads as
  // "nobody has problems". If we could not read the threads, we do not write a baseline at all.
  if (threads.length === 0) {
    process.stderr.write('refusing to write a market baseline with zero discussion threads read\n')
    for (const failure of failures) process.stderr.write(`  failure ${failure}\n`)
    process.stderr.write(
      '  GitHub answers 403 "API rate limit exceeded" for unauthenticated requests (60/hour per IP).\n' +
        '  Set GITHUB_TOKEN (or GH_TOKEN) and re-run: `$env:GITHUB_TOKEN = gh auth token`\n',
    )
    process.exit(2)
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
    id: 'this-package-weekly-downloads-are-not-demand',
    statement: `dsh-triage summed ${String(d5.week_downloads)} weekly downloads with shape '${d5.download_shape}', so the D5 download verdict is '${d5.verdict}' (counts as demand: ${String(d5.counts_as_demand)})`,
    recompute: 'd5.verdict / packages["dsh-triage"].download_shape',
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
    fixtures: offline ? portablePath(fixturesDir) : 'data/fixtures/market-baseline/<stamp>',
  },
  packages,
  categories: categoryTotals,
  downloads: {
    window: 'last-week',
    daily_source: 'api.npmjs.org/downloads/range (per UTC day)',
    shape_counts: shapeCounts,
    shape_rule: {
      steady: `at least 2 days with downloads and no single day above ${BURST_PEAK_SHARE * 100}% of the window`,
      'single-day-burst': `at most 1 day with downloads, or one day above ${BURST_PEAK_SHARE * 100}% of the window`,
      'no-downloads': 'the window exists and sums to 0',
      unreadable: 'no usable daily series was read; never treated as "no demand"',
      'no-record': 'the downloads API answered 404 for the package',
    },
  },
  d5,
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
    'npm download counts are not people: they include CI runs, registry mirrors and security scanners. That is why the weekly total is paired with a shape, and why D5 counts only `steady` windows',
    'the shape rule (steady needs >= 2 days with downloads and <= 80% of the window on any one day) is a decision-gate rule, not a measurement: it was approved on 2026-10-31 and lives in audit/SIGNOFF.md R52 and docs/ROADMAP.md §2',
    'a daily series we could not read is `unreadable` with verdict `unmeasurable`; it is never reported as "no demand" and never as a burst',
    'discussion threads need `GITHUB_TOKEN` / `GH_TOKEN` once the unauthenticated 60-requests/hour limit is spent; if no thread could be read the run exits 2 instead of writing `pain_threads: 0`, which would read as "nobody has problems"',
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
process.stdout.write(
  `  dsh-triage ${String(d5.week_downloads)} weekly · shape=${d5.download_shape} · d5=${d5.verdict} (counts as demand: ${String(d5.counts_as_demand)})\n`,
)
process.stdout.write(`  download shapes ${JSON.stringify(shapeCounts)}\n`)
process.stdout.write(`  discussions ${threads.length} fetched · pain ${pain.length} · unanswered ${pain.filter((thread) => thread.comments === 0).length}\n`)
if (failures.length > 0) {
  for (const failure of failures) process.stdout.write(`  failure ${failure}\n`)
}
process.stdout.write(`ssot ${fileName} sha256=${sha256(text).slice(0, 12)}…\n`)
process.exit(0)
