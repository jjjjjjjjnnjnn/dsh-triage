#!/usr/bin/env node
/**
 * Question coverage: how much of the upstream question stream can this tool actually judge (R59).
 *
 * WHY: `audit/RECON_2026-11-02_upstream-help.md` looked at 12 threads and said "7 nameable, 1
 * rules-out, 3 declare-nothing, 3 runtime". Twelve is a sample chosen by five keyword searches, not
 * a denominator. This script turns the same judgement into a census of the Q&A category (and, as a
 * separate control population, General), with the reading frozen in `docs/specs/question-coverage.md`
 * **before** the data was read.
 *
 * WHAT IT REFUSES:
 *   - to write a ratio when `fetched != totalCount` (an incomplete census is not a sample);
 *   - to turn a registry failure into `denied` (that is `probe-unreadable`);
 *   - to count `declares-nothing` in the headline numerator;
 *   - to shrink the denominator (the Q&A population is fixed; `probe-unreadable` stays inside it);
 *   - to answer for a package it could not read, or to guess a version that is not on the registry;
 *   - to call a pilot artifact evidence (its name and `pilot: true` both say so).
 *
 *   # live census (Q&A + General), then a review artifact once the 20 threads are labelled
 *   node scripts/record_question_coverage.mjs --stamp 2026-11-03T10:00:00.000Z
 *   node scripts/record_question_coverage.mjs --review-only --stamp 2026-11-03T12:00:00.000Z \
 *     --measurement data/results/question-coverage-2026-11-03T10-00-00.000Z.json \
 *     --fixtures data/fixtures/question-coverage/2026-11-03T10-00-00.000Z \
 *     --review data/fixtures/question-coverage/<stamp>/review.json
 *
 *   # offline recompute (must reproduce rows / counts / tiers item by item)
 *   node scripts/record_question_coverage.mjs --stamp ... --recompute \
 *     --fixtures data/fixtures/question-coverage/<stamp>
 *
 *   # pilot: newest N per category, never cited
 *   node scripts/record_question_coverage.mjs --stamp ... --pilot 100 --out %TEMP%/coverage
 *
 * EXIT: 0 artifact written · 2 bad usage / unreadable sample / incomplete census.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, basename, join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

import { fetchPackument } from '../packages/signals/dist/index.js'
import { judgePackageName, packumentFromSnapshot, planProbeTargets, probePackage, selectProbeTargets } from './lib/discussion-probe.mjs'
import { classifyThread } from './lib/discussion-triage.mjs'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import {
  assertComplete,
  coverageOf,
  manualReviewSample,
  reviewAgreement,
  scrubHomePaths,
  signalSnippets,
  tierOfThread,
} from './lib/question-coverage.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const flag = (name) => argv.includes(name)
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const RAW_STAMP = String(argOf('--stamp', new Date().toISOString()))
const STAMP = isoStamp(RAW_STAMP)
if (STAMP === null) {
  process.stderr.write(`invalid --stamp "${RAW_STAMP}": expected ISO-8601, e.g. 2026-11-03T10:00:00.000Z\n`)
  process.exit(2)
}
const OUT_DIR = pathFor(String(argOf('--out', 'data/results')))
const FIXTURES_DIR = argOf('--fixtures', null) === null ? null : pathFor(String(argOf('--fixtures')))
const RECOMPUTE = flag('--recompute')
const REVIEW_ONLY = flag('--review-only')
const TARGET_ARG = argOf('--target', null)
const PILOT = argOf('--pilot', null) === null ? 0 : Number(argOf('--pilot', 0))
const SEED = Number(argOf('--seed', 20261102))
const REVIEW_SIZE = Number(argOf('--review-size', 20))
const HUMAN_SIZE = Number(argOf('--human-size', 5))
const DELAY_MS = Number(argOf('--delay', 200))
const NO_GENERAL = flag('--no-general')
const REPO = { owner: 'deepseek-ai', name: 'deepseek-harness' }
const CATEGORIES = {
  qa: String(argOf('--category-qa', 'DIC_kwDOT3T1g84DDSUc')),
  general: String(argOf('--category-general', 'DIC_kwDOT3T1g84DDSUb')),
}
const REVIEWER = String(argOf('--reviewer', 'agent:deepseek-v4.1-flash'))

const die = (message) => {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

if (!Number.isInteger(PILOT) || PILOT < 0) die(`--pilot must be a non-negative integer (got "${String(argOf('--pilot', ''))}")`)
if (!Number.isInteger(SEED) || SEED < 0) die('--seed must be a non-negative integer')
if (!Number.isInteger(REVIEW_SIZE) || REVIEW_SIZE < 1) die('--review-size must be a positive integer')
if (!Number.isInteger(HUMAN_SIZE) || HUMAN_SIZE < 1) die('--human-size must be a positive integer')
if (!Number.isFinite(DELAY_MS) || DELAY_MS < 0) die('--delay must be a non-negative number of milliseconds')
if (PILOT > 0 && FIXTURES_DIR !== null) die('--pilot reads the live API; it does not take --fixtures')
if (FIXTURES_DIR !== null && TARGET_ARG === null && !REVIEW_ONLY) {
  // The target is part of the snapshot's provenance; a recompute without it would silently use a different runtime.
  die('--fixtures requires --target <exact version> (the snapshot does not carry the runtime)')
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(TARGET_ARG ?? '1.0.0'))) {
  die(`--target must be an exact semver (got "${String(TARGET_ARG)}")`)
}

/* ------------------------------------------------------------------ *
 * GraphQL
 * ------------------------------------------------------------------ */

function ghGraphQL(query, variables = {}) {
  const result = spawnSync('gh', ['api', 'graphql', '--input', '-'], {
    input: JSON.stringify({ query, variables }),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error !== undefined && result.error !== null) {
    throw new Error(`gh could not be started: ${String(result.error.message ?? result.error)}`)
  }
  if (result.status !== 0) {
    const first = String(result.stderr ?? '').trim().split('\n')[0] ?? ''
    throw new Error(`gh graphql exit ${String(result.status)}: ${first}`)
  }
  let payload
  try {
    payload = JSON.parse(String(result.stdout))
  } catch (error) {
    throw new Error(`unreadable GraphQL payload: ${String(error?.message ?? error)}`)
  }
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw new Error(`GraphQL refused the query: ${String(payload.errors[0]?.message ?? 'unknown error')}`)
  }
  const repository = payload?.data?.repository
  if (repository === null || repository === undefined) throw new Error('GraphQL answer had no repository')
  return repository
}

const PRE_QUERY = `query($categoryId: ID!) {
  repository(owner: "${REPO.owner}", name: "${REPO.name}") {
    discussions(first: 1, categoryId: $categoryId, orderBy: {field: CREATED_AT, direction: DESC}) {
      totalCount
      nodes { number createdAt }
    }
  }
}`

const PAGE_QUERY = `query($categoryId: ID!, $after: String) {
  repository(owner: "${REPO.owner}", name: "${REPO.name}") {
    discussions(first: 100, after: $after, categoryId: $categoryId, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes { number title createdAt url category { name } bodyText }
    }
  }
}`

const PILOT_QUERY = `query($categoryId: ID!, $first: Int!) {
  repository(owner: "${REPO.owner}", name: "${REPO.name}") {
    discussions(first: $first, categoryId: $categoryId, orderBy: {field: CREATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes { number title createdAt url category { name } bodyText }
    }
  }
}`

/**
 * Read one category. The cutoff is a **thread number**, not a wall clock: new threads created while
 * we paginate get numbers above it and are excluded by construction, so `fetched === totalCount` is
 * a checkable statement rather than a race.
 */
function fetchCategory(categoryId, { pilot = 0 } = {}) {
  const pre = ghGraphQL(PRE_QUERY, { categoryId }).discussions
  const totalCount = Number(pre?.totalCount ?? 0)
  const newest = Array.isArray(pre?.nodes) ? pre.nodes[0] : undefined
  const cutoff = newest === undefined ? 0 : Number(newest.number)

  if (pilot > 0) {
    const page = ghGraphQL(PILOT_QUERY, { categoryId, first: pilot }).discussions
    const nodes = Array.isArray(page?.nodes) ? page.nodes : []
    return { totalCount, cutoff, nodes: nodes.slice(0, pilot), pages: 1, pilot: true }
  }

  if (totalCount === 0) return { totalCount: 0, cutoff: 0, nodes: [], pages: 0, pilot: false }

  const collected = []
  let after = null
  let pages = 0
  let done = false
  while (!done) {
    const page = ghGraphQL(PAGE_QUERY, { categoryId, after }).discussions
    pages += 1
    const nodes = Array.isArray(page?.nodes) ? page.nodes : []
    for (const node of nodes) {
      if (Number(node.number) <= cutoff) collected.push(node)
    }
    const pastCutoff = nodes.length > 0 && nodes.every((node) => Number(node.number) > cutoff)
    if (pastCutoff || nodes.length === 0 || page?.pageInfo?.hasNextPage !== true) done = true
    else after = page?.pageInfo?.endCursor ?? null
    if (pages > 500) throw new Error('pagination did not terminate after 500 pages; refusing to guess')
  }

  const unique = new Map(collected.map((node) => [Number(node.number), node]))
  if (unique.size !== collected.length) throw new Error('the API returned the same thread twice; refusing to count it twice')
  return { totalCount, cutoff, nodes: [...unique.values()], pages, pilot: false }
}

function fetchThreads(fixturesDir) {
  const read = (name) => {
    const file = join(fixturesDir, name)
    if (!existsSync(file)) die(`fixture is missing: ${basename(file)}`)
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  const qa = read('qa.json')
  const general = NO_GENERAL ? { threads: [], total_count: 0, fetched: 0, pages: 0 } : read('general.json')
  const packuments = read('packuments.json')
  return {
    qa: {
      totalCount: Number(qa.total_count ?? qa.threads?.length ?? 0),
      cutoff: Number(qa.cutoff ?? 0),
      nodes: Array.isArray(qa.threads) ? qa.threads : [],
      pages: Number(qa.pages ?? 0),
      pilot: false,
    },
    general: {
      totalCount: Number(general.total_count ?? general.threads?.length ?? 0),
      cutoff: Number(general.cutoff ?? 0),
      nodes: Array.isArray(general.threads) ? general.threads : [],
      pages: Number(general.pages ?? 0),
      pilot: false,
    },
    packuments: packuments.packages ?? {},
  }
}

/* ------------------------------------------------------------------ *
 * Target runtime
 * ------------------------------------------------------------------ */

async function resolveTarget() {
  if (TARGET_ARG !== null) return { runtime: String(TARGET_ARG), source: 'argument' }
  const fetched = await fetchPackument('@deepseek-ai/dsh', { at: STAMP })
  if (!fetched?.ok) die(`could not read @deepseek-ai/dsh dist-tags: ${String(fetched?.error?.detail ?? fetched?.error?.code ?? 'unknown')}`)
  const next = fetched.value?.distTags?.next
  if (typeof next !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(next)) {
    die(`next dist-tag is not an exact version: ${String(next)}`)
  }
  return { runtime: next, source: 'next-dist-tag' }
}

/* ------------------------------------------------------------------ *
 * Probing
 * ------------------------------------------------------------------ */

async function fetchPackumentWithRetry(name) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fetched = await fetchPackument(name, { at: STAMP })
    if (fetched?.ok) return fetched
    if (fetched?.error?.code === 'not-found') return fetched
    if (attempt === 1) return fetched
    await sleep(2000)
  }
  return { ok: false, error: { code: 'network-error', detail: 'no attempt was made' } }
}

/**
 * Probe every selected target once. Packages are de-duplicated across thousands of threads: a
 * registry that sees 3,000 requests because 3,000 threads mention `dsh-tools` is how R52 got a 429.
 * `liveCache` is shared by the Q&A and General passes so a package mentioned in both is read once.
 */
const liveCache = new Map()

async function probeThreads(rows, target, { snapshot = null } = {}) {
  const targetsByNumber = new Map()
  const unique = new Set()
  for (const row of rows) {
    if (row.verdict !== 'answerable' && row.verdict !== 'partially-answerable') continue
    // General has no full text in the snapshot, so its selected targets (including pinned versions)
    // are recorded at capture time and reused here; Q&A re-selects from the text.
    const selection = Array.isArray(row.probeTargets)
      ? {
          targets: row.probeTargets.map((entry) => ({ ...entry, ...judgePackageName(entry.name) })),
          omitted: Number(row.packagesOmitted ?? 0),
          packages: Array.isArray(row.packages) ? row.packages : [],
        }
      : selectProbeTargets(row, `${row.title}\n${row.bodyText}`)
    const plan = planProbeTargets(selection.targets)
    targetsByNumber.set(row.number, { ...selection, plan })
    /*
     * Only names that could be packages are fetched. A rejected name still gets a reading below —
     * that is what keeps `tierOfThread` on the same tier — but it never reaches the network.
     */
    for (const item of plan) {
      if (item.kind !== 'fetch') continue
      unique.add(item.name)
    }
  }

  const cache = new Map()
  if (snapshot === null) {
    for (const name of [...unique].sort()) {
      if (!liveCache.has(name)) {
        liveCache.set(name, await fetchPackumentWithRetry(name))
        if (DELAY_MS > 0) await sleep(DELAY_MS)
      }
      cache.set(name, liveCache.get(name))
    }
  } else {
    for (const name of unique) {
      const recorded = snapshot[name]
      if (recorded === undefined) {
        cache.set(name, { ok: false, error: { code: 'not-found', detail: `package ${name} is not in the snapshot` } })
      } else if (recorded.state !== 'measured') {
        cache.set(name, { ok: false, error: recorded.error ?? { code: 'unreadable', detail: 'snapshot says unreadable' } })
      } else {
        cache.set(name, { ok: true, value: packumentFromSnapshot(recorded) })
      }
    }
  }

  const loader = (name) => Promise.resolve(cache.get(name) ?? { ok: false, error: { code: 'not-found', detail: 'not in the probe set' } })
  const probesByNumber = new Map()
  for (const row of rows) {
    const selection = targetsByNumber.get(row.number)
    const probes = []
    if (selection !== undefined) {
      for (const item of selection.plan ?? planProbeTargets(selection.targets)) {
        if (item.kind === 'rejected') {
          probes.push(item.record)
          continue
        }
        probes.push(await probePackage(item.name, target, { pinned: item.pinned, loadPackument: loader }))
      }
    }
    probesByNumber.set(row.number, { probes, selection })
  }
  return { probesByNumber, cache }
}

/** The snapshot is a projection, not a full packument: only the versions this run actually judged. */
function packumentSnapshot(cache, probesByNumber) {
  const used = new Map()
  for (const { probes } of probesByNumber.values()) {
    for (const probe of probes) {
      if (probe.state !== 'measured' || typeof probe.version !== 'string') continue
      if (!used.has(probe.package)) used.set(probe.package, new Set())
      used.get(probe.package).add(probe.version)
    }
  }

  const packages = {}
  for (const [name, fetched] of [...cache.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    if (!fetched?.ok) {
      packages[name] = {
        name,
        state: 'unreadable',
        error: { code: String(fetched?.error?.code ?? 'unreadable'), detail: String(fetched?.error?.detail ?? '') },
      }
      continue
    }
    const versions = {}
    for (const version of used.get(name) ?? []) {
      const manifest = fetched.value.versions.get(version)
      if (manifest === undefined) continue
      /*
       * Preserve `undefined` instead of normalising it to `null`: the admission engine distinguishes
       * "no declaration" from "malformed declaration", and the first full run proved that writing
       * `null` here flips `unconstrained` into `denied` on every offline recompute.
       */
      versions[version] = {
        ...(manifest.engines === undefined ? {} : { engines: manifest.engines }),
        ...(manifest.peerDependencies === undefined ? {} : { peerDependencies: manifest.peerDependencies }),
        ...(manifest.deprecated === undefined ? {} : { deprecated: manifest.deprecated }),
      }
    }
    packages[name] = {
      name,
      state: 'measured',
      dist_tags: fetched.value.distTags ?? {},
      latest: fetched.value.latest ?? null,
      versions,
    }
  }
  return packages
}

/* ------------------------------------------------------------------ *
 * Rows and coverage
 * ------------------------------------------------------------------ */

function classifyNode(node) {
  /*
   * The General snapshot is a projection (no full text in the repo). Re-running the text classifier
   * on it would silently turn every General thread into `unknown`, so a projected row carries its
   * classification and we reuse it verbatim. Q&A snapshots keep the text, so they re-classify.
   */
  if (node?.bodyText === undefined && typeof node?.layer === 'string' && typeof node?.verdict === 'string') {
    return {
      layer: node.layer,
      verdict: node.verdict,
      reason: 'snapshot projection (General keeps no full text)',
      signals: Array.isArray(node.signals) ? node.signals : [],
      packages: Array.isArray(node.packages) ? node.packages : [],
      answerableWith: null,
    }
  }
  return classifyThread({ title: node.title, body: node.bodyText, category: node.category?.name })
}

function toRow(node, classification, probes, selection, { projection = false } = {}) {
  const row = {
    number: Number(node.number),
    url: String(node.url ?? ''),
    title: scrubHomePaths(String(node.title ?? '')),
    created_at: String(node.createdAt ?? ''),
    category: node.category?.name ?? null,
    layer: classification.layer,
    verdict: classification.verdict,
    tier: tierOfThread({ layer: classification.layer, probes }),
    signals: classification.signals,
    packages: classification.packages,
    packages_omitted: selection?.omitted ?? 0,
    truncated: (selection?.omitted ?? 0) > 0,
    probes: probes.map((probe) => ({
      ...probe,
      ...(typeof probe.detail === 'string' ? { detail: scrubHomePaths(probe.detail) } : {}),
    })),
  }
  /*
   * R88 / X2: names refused before the request. Recorded on the row (not only in the counts) so a
   * reader can see which token was rejected and why, instead of trusting a total.
   */
  if (Array.isArray(selection?.rejected) && selection.rejected.length > 0) {
    row.names_rejected = selection.rejected.map((entry) => ({ name: entry.name, reason: entry.reason }))
  }
  if (projection) {
    const text = `${String(node.title ?? '')}\n${String(node.bodyText ?? '')}`
    row.body_sha256 = typeof node.body_sha256 === 'string' ? node.body_sha256 : sha256(text)
    row.body_chars = Number.isInteger(node.body_chars) ? node.body_chars : text.length
  }
  return row
}

function probeStats(rows) {
  let attempts = 0
  let unreadable = 0
  let truncated = 0
  let rejected = 0
  const packages = new Set()
  for (const row of rows) {
    for (const probe of row.probes) {
      attempts += 1
      packages.add(probe.package)
      if (probe.state !== 'measured') unreadable += 1
      if (/^name is not a package \(/.test(String(probe.detail ?? ''))) rejected += 1
    }
    if (row.truncated) truncated += 1
  }
  /*
   * `rejected_names` is a *subset* of `unreadable`, not extra work: those names would have been
   * asked and would have answered "no such package". It is reported so the next reader can see how
   * much of "unreadable" was never a real question.
   */
  return { unique_packages: packages.size, attempts, unreadable, rejected_names: rejected, truncated_threads: truncated }
}

function buildCounts(rows, coverage, probes) {
  return {
    threads: coverage.threads,
    relevant: coverage.relevant,
    decidable: coverage.decidable,
    by_layer: coverage.by_layer,
    by_verdict: coverage.by_verdict,
    tiers: coverage.tiers,
    probes,
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const target = FIXTURES_DIR === null ? await resolveTarget() : { runtime: String(TARGET_ARG), source: 'argument' }

  let qaRead
  let generalRead
  // `null`, not `undefined`: `undefined` would skip the snapshot build (the first full run did exactly that).
  let packumentsSnapshot = null
  if (FIXTURES_DIR === null) {
    try {
      qaRead = fetchCategory(CATEGORIES.qa, { pilot: PILOT })
      generalRead = NO_GENERAL ? { totalCount: 0, cutoff: 0, nodes: [], pages: 0, pilot: false } : fetchCategory(CATEGORIES.general, { pilot: PILOT })
    } catch (error) {
      die(`could not read the discussions: ${String(error?.message ?? error)}`)
    }
  } else {
    const fixture = fetchThreads(FIXTURES_DIR)
    qaRead = fixture.qa
    generalRead = NO_GENERAL ? { totalCount: 0, cutoff: 0, nodes: [], pages: 0, pilot: false } : fixture.general
    packumentsSnapshot = fixture.packuments
  }

  const pilot = qaRead.pilot === true
  for (const [label, read] of [
    ['Q&A', qaRead],
    ['General', generalRead],
  ]) {
    const complete = assertComplete({ total_count: read.totalCount, fetched: read.nodes.length, pilot: read.pilot === true })
    if (!complete.ok) die(`${label}: ${complete.detail}`)
  }
  if (qaRead.nodes.length === 0) die('the Q&A population is empty: that is a reading failure, not 0% coverage')

  // Classify first: only answerable/partially-answerable threads need probes.
  const qaClassified = qaRead.nodes.map((node) => ({ node, classification: classifyNode(node) }))
  const generalClassified = generalRead.nodes.map((node) => ({ node, classification: classifyNode(node) }))

  const qaProbeRows = qaClassified.map(({ node, classification }) => ({
    number: Number(node.number),
    title: node.title,
    bodyText: node.bodyText,
    verdict: classification.verdict,
    packages: classification.packages,
  }))
  const generalProbeRows = generalClassified.map(({ node, classification }) => ({
    number: Number(node.number),
    title: node.title,
    bodyText: node.bodyText,
    verdict: classification.verdict,
    packages: classification.packages,
    probeTargets: Array.isArray(node.probe_targets) ? node.probe_targets : undefined,
    packagesOmitted: Number(node.packages_omitted ?? 0),
  }))

  const qaProbed = await probeThreads(qaProbeRows, target.runtime, { snapshot: packumentsSnapshot })
  const generalProbed = await probeThreads(generalProbeRows, target.runtime, { snapshot: packumentsSnapshot })

  // The General probe set can add packages the Q&A pass never touched; merge before snapshotting.
  const mergedCache = new Map([...qaProbed.cache, ...generalProbed.cache])
  if (packumentsSnapshot === null) packumentsSnapshot = packumentSnapshot(mergedCache, new Map([...qaProbed.probesByNumber, ...generalProbed.probesByNumber]))

  const qaRows = qaClassified.map(({ node, classification }) => {
    const entry = qaProbed.probesByNumber.get(Number(node.number))
    return toRow(node, classification, entry?.probes ?? [], entry?.selection ?? null)
  })
  const generalRows = generalClassified.map(({ node, classification }) => {
    const entry = generalProbed.probesByNumber.get(Number(node.number))
    return toRow(node, classification, entry?.probes ?? [], entry?.selection ?? null, { projection: true })
  })

  /*
   * The General pass can introduce a package that the Q&A snapshot missed only if the two passes used
   * different caches; when both are live they share nothing, so re-snapshot the merged cache with the
   * union of probes. (Offline recompute passes one snapshot for both, so this is a no-op there.)
   */
  if (FIXTURES_DIR !== null) {
    const missing = [...mergedCache.keys()].filter((name) => packumentsSnapshot[name] === undefined)
    if (missing.length > 0) die(`the snapshot is missing ${missing.length} package(s) the rows need: ${missing.slice(0, 3).join(', ')}`)
  }

  const qaCoverage = coverageOf(qaRows)
  const generalCoverage = coverageOf(generalRows)
  const qaProbes = probeStats(qaRows)
  const generalProbes = probeStats(generalRows)

  const sampleNumbers = manualReviewSample(
    qaRows.map((row) => row.number),
    { seed: SEED, size: REVIEW_SIZE },
  )
  if (sampleNumbers.length < REVIEW_SIZE) die(`the Q&A population has fewer than ${REVIEW_SIZE} threads; a review of ${sampleNumbers.length} is not the signed sample`)

  const review = loadReview(argOf('--review', null), qaRows, sampleNumbers)

  const payload = {
    schema_version: 1,
    produced_by: 'scripts/record_question_coverage.mjs',
    generated_at: STAMP,
    sample: {
      source: FIXTURES_DIR === null ? (pilot ? 'graphql:pilot' : 'graphql') : `fixtures:${basename(FIXTURES_DIR)}`,
      repository: `${REPO.owner}/${REPO.name}`,
      captured_at: STAMP,
      cutoff: {
        qa_newest_number: qaRead.cutoff,
        general_newest_number: generalRead.cutoff,
      },
      qa: {
        category_id: CATEGORIES.qa,
        total_count: qaRead.totalCount,
        fetched: qaRows.length,
        pages: qaRead.pages,
      },
      general: {
        category_id: NO_GENERAL ? null : CATEGORIES.general,
        total_count: generalRead.totalCount,
        fetched: generalRows.length,
        pages: generalRead.pages,
      },
      pilot,
    },
    target,
    classifier: { version: 1, source: 'scripts/lib/discussion-triage.mjs' },
    counts: {
      qa: buildCounts(qaRows, qaCoverage, qaProbes),
      general: buildCounts(generalRows, generalCoverage, generalProbes),
    },
    coverage: {
      qa: {
        headline: qaCoverage.headline,
        tiers: qaCoverage.tier_shares,
        sensitivity: qaCoverage.sensitivity,
      },
      general: {
        label: 'projection-only',
        headline: generalCoverage.headline,
        tiers: generalCoverage.tier_shares,
        sensitivity: generalCoverage.sensitivity,
      },
    },
    manual_review: {
      seed: SEED,
      sample_size: REVIEW_SIZE,
      sample_numbers: sampleNumbers,
      status: review === null ? 'pending' : 'labelled',
      agent: review === null ? null : review,
      human_spot_check: {
        reviewer: 'human',
        size: HUMAN_SIZE,
        numbers: sampleNumbers.slice(0, HUMAN_SIZE),
        status: 'pending',
        agree: null,
      },
    },
    rows: { qa: qaRows, general: generalRows },
    limits: [
      'classification reads the thread text only; it does not run the reporter\'s profile',
      `one target runtime (${target.runtime}) is used for every thread; a package the thread pinned is judged at that version, everything else at the version the registry called latest at capture`,
      'declares-nothing is not compatibility and not a denial; it never counts toward the headline numerator',
      'probe-unreadable stays in the denominator: a registry we could not read is not evidence that the thread is unanswerable',
      'R88: `counts.*.probes.attempts` counts probe RECORDS, including `rejected_names` — names refused before any request because they cannot be package names (uppercase / file name / path fragment / `@<version>` path). Those names are a subset of `unreadable`, recorded on the row as `names_rejected[]`; refusing them changes no tier and spends no request',
      'General is a projection snapshot (no full text in the repo); it is a control population and is never pooled with Q&A',
      'at most 3 packages per thread are probed; the omitted count is recorded per row and summed in counts.*.probes.truncated_threads',
    ],
  }

  if (FIXTURES_DIR === null && !pilot) writeSnapshot(packumentsSnapshot, qaRead, generalRead)

  const prefix = pilot
    ? 'question-coverage-pilot'
    : FIXTURES_DIR === null
      ? 'question-coverage'
      : RECOMPUTE
        ? 'question-coverage-recompute'
        : 'question-coverage-selftest'
  writeArtifact(prefix, payload)
}

function loadReview(path, rows, sampleNumbers) {
  if (path === null) return null
  const file = pathFor(String(path))
  if (!existsSync(file)) die(`review file not found: ${String(path)}`)
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  const reviews = Array.isArray(parsed?.reviews) ? parsed.reviews : null
  if (reviews === null) die('review file must carry { "reviews": [...] }')
  const expected = new Set(sampleNumbers)
  const seen = new Set()
  for (const review of reviews) {
    const number = Number(review?.number)
    if (!expected.has(number)) die(`review for #${number} is not in the seeded sample`)
    if (seen.has(number)) die(`review for #${number} appears twice`)
    seen.add(number)
    if (typeof review?.layer !== 'string' || typeof review?.verdict !== 'string') die(`review for #${number} must carry layer and verdict`)
  }
  if (seen.size !== sampleNumbers.length) {
    die(`review covers ${seen.size} of ${sampleNumbers.length} sampled threads: the signed sample is 20, not "about 20"`)
  }
  return { reviewer: REVIEWER, ...reviewAgreement(rows, reviews) }
}

function writeSnapshot(packages, qaRead, generalRead) {
  if (packages === null || packages === undefined || typeof packages !== 'object') {
    die('refusing to write a snapshot without packuments: the recompute would have nothing to read')
  }
  const dir = abs(`data/fixtures/question-coverage/${STAMP.replace(/[:.]/g, '-')}`)
  mkdirSync(dir, { recursive: true })
  const write = (name, value) => writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')

  /*
   * Q&A keeps the full text: it is the headline population and its recompute must be real. General
   * keeps a projection because 5,781 long threads would add tens of megabytes to every clone; the
   * artifact says `projection-only` so nobody mistakes it for a full-text recompute.
   */
  write('qa.json', {
    schema_version: 1,
    produced_by: 'scripts/record_question_coverage.mjs',
    captured_at: STAMP,
    total_count: qaRead.totalCount,
    cutoff: qaRead.cutoff,
    pages: qaRead.pages,
    threads: qaRead.nodes.map((node) => ({
      number: Number(node.number),
      title: String(node.title ?? ''),
      url: String(node.url ?? ''),
      createdAt: String(node.createdAt ?? ''),
      category: { name: node.category?.name ?? null },
      bodyText: String(node.bodyText ?? ''),
    })),
  })
  write('general.json', {
    schema_version: 1,
    produced_by: 'scripts/record_question_coverage.mjs',
    captured_at: STAMP,
    total_count: generalRead.totalCount,
    cutoff: generalRead.cutoff,
    pages: generalRead.pages,
    projection_only: true,
    threads: generalRead.nodes.map((node) => {
      const classification = classifyNode(node)
      const text = `${String(node.title ?? '')}\n${String(node.bodyText ?? '')}`
      const selection = selectProbeTargets(classification, text)
      return {
        number: Number(node.number),
        title: String(node.title ?? ''),
        url: String(node.url ?? ''),
        createdAt: String(node.createdAt ?? ''),
        category: { name: node.category?.name ?? null },
        body_sha256: sha256(text),
        body_chars: text.length,
        layer: classification.layer,
        verdict: classification.verdict,
        signals: classification.signals,
        packages: classification.packages,
        probe_targets: selection.targets,
        packages_omitted: selection.omitted,
        snippets: signalSnippets(text),
      }
    }),
  })
  write('packuments.json', {
    schema_version: 1,
    produced_by: 'scripts/record_question_coverage.mjs',
    captured_at: STAMP,
    packages,
  })
  process.stderr.write(`snapshot data/fixtures/question-coverage/${basename(dir)}\n`)
}

function writeArtifact(prefix, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`
  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `${prefix}-${STAMP.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, text, 'utf8')
  writeFileSync(`${file}.sha256`, sha256(text), 'utf8')

  const qa = payload.counts.qa
  const headline = payload.coverage.qa.headline
  const ratio = headline.ratio === null ? 'null' : `${(headline.ratio * 100).toFixed(2)}%`
  process.stdout.write(
    `sample · Q&A ${payload.sample.qa.fetched}/${payload.sample.qa.total_count}` +
      ` · General ${payload.sample.general.fetched}/${payload.sample.general.total_count}` +
      ` · target ${payload.target.runtime} (${payload.target.source})\n`,
  )
  process.stdout.write(
    `tiers · ${Object.entries(qa.tiers)
      .map(([tier, count]) => `${tier} ${count}`)
      .join(' · ')}\n`,
  )
  process.stdout.write(`headline · ${headline.count}/${headline.denominator} = ${ratio} · Wilson95 ${JSON.stringify(headline.wilson95)}\n`)
  process.stdout.write(`ssot ${basename(file)} sha256=${sha256(text).slice(0, 12)}…\n`)
}

/* ------------------------------------------------------------------ *
 * Review-only mode: label the seeded sample, write a sibling artifact
 * ------------------------------------------------------------------ */

function runReviewOnly() {
  const measurementPath = argOf('--measurement', null)
  if (measurementPath === null) die('--review-only requires --measurement <data/results/question-coverage-*.json>')
  if (FIXTURES_DIR === null) die('--review-only requires --fixtures <snapshot dir> (it reads the thread texts from there)')
  const measurementFile = pathFor(String(measurementPath))
  if (!existsSync(measurementFile)) die(`measurement artifact not found: ${String(measurementPath)}`)
  const measurementText = readFileSync(measurementFile, 'utf8')
  const measurement = JSON.parse(measurementText)
  if (measurement?.produced_by !== 'scripts/record_question_coverage.mjs') die('that artifact was not produced by this script')
  if (measurement?.sample?.pilot === true) die('a pilot artifact cannot be reviewed as evidence')
  /*
   * Reviewing a hand-edited measurement would make the agreement rate a claim about an artifact
   * nobody measured. The sibling hash is the guard the SSOT gate uses; use the same one here.
   */
  const measurementHash = `${measurementFile}.sha256`
  if (!existsSync(measurementHash)) die(`measurement artifact has no .sha256: ${basename(measurementHash)}`)
  if (readFileSync(measurementHash, 'utf8').trim() !== sha256(measurementText)) {
    die('the measurement artifact does not match its .sha256 (refusing to review an edited artifact)')
  }

  const sampleNumbers = Array.isArray(measurement?.manual_review?.sample_numbers) ? measurement.manual_review.sample_numbers : null
  if (sampleNumbers === null || sampleNumbers.length === 0) die('the measurement artifact carries no seeded sample')

  const reviewPath = argOf('--review', null)
  if (reviewPath === null) die('--review-only requires --review <review.json>')
  const reviewFile = pathFor(String(reviewPath))
  if (!existsSync(reviewFile)) die(`review file not found: ${String(reviewPath)}`)
  const reviews = JSON.parse(readFileSync(reviewFile, 'utf8'))?.reviews
  if (!Array.isArray(reviews)) die('review file must carry { "reviews": [...] }')

  const expected = new Set(sampleNumbers.map(Number))
  const seen = new Set()
  for (const review of reviews) {
    const number = Number(review?.number)
    if (!expected.has(number)) die(`review for #${number} is not in the seeded sample`)
    if (seen.has(number)) die(`review for #${number} appears twice`)
    seen.add(number)
  }
  if (seen.size !== expected.size) die(`review covers ${seen.size} of ${expected.size} sampled threads`)

  const qaThreads = new Map(
    (JSON.parse(readFileSync(join(FIXTURES_DIR, 'qa.json'), 'utf8'))?.threads ?? []).map((thread) => [Number(thread.number), thread]),
  )
  const rows = measurement.rows.qa.map((row) => {
    const thread = qaThreads.get(Number(row.number))
    return { ...row, title: thread?.title ?? row.title }
  })
  const agreement = reviewAgreement(rows, reviews)

  const humanPath = argOf('--human', null)
  let human = {
    reviewer: 'human',
    size: HUMAN_SIZE,
    numbers: sampleNumbers.slice(0, HUMAN_SIZE),
    status: 'pending',
    agree: null,
    total: HUMAN_SIZE,
    notes: null,
  }
  if (humanPath !== null) {
    const file = pathFor(String(humanPath))
    if (!existsSync(file)) die(`human spot-check file not found: ${String(humanPath)}`)
    const checks = JSON.parse(readFileSync(file, 'utf8'))?.reviews
    if (!Array.isArray(checks)) die('human spot-check file must carry { "reviews": [...] }')
    const humanExpected = new Set(sampleNumbers.slice(0, HUMAN_SIZE).map(Number))
    const humanSeen = new Set()
    let humanAgree = 0
    for (const check of checks) {
      const number = Number(check?.number)
      if (!humanExpected.has(number)) die(`human check for #${number} is not in the spot-check set`)
      if (humanSeen.has(number)) die(`human check for #${number} appears twice`)
      humanSeen.add(number)
      if (typeof check?.agree !== 'boolean') die(`human check for #${number} must carry a boolean agree`)
      if (check.agree) humanAgree += 1
    }
    if (humanSeen.size !== humanExpected.size) die(`human spot-check covers ${humanSeen.size} of ${humanExpected.size}`)
    human = {
      reviewer: 'human',
      size: HUMAN_SIZE,
      numbers: [...humanExpected],
      status: 'done',
      agree: humanAgree,
      total: HUMAN_SIZE,
      notes: checks.map((check) => ({ number: Number(check.number), agree: Boolean(check.agree), note: typeof check.note === 'string' ? check.note : null })),
    }
  }

  const payload = {
    schema_version: 1,
    produced_by: 'scripts/record_question_coverage.mjs',
    generated_at: STAMP,
    mode: 'review',
    measurement: {
      path: `data/results/${basename(measurementFile)}`,
      sha256: sha256(measurementText),
    },
    seed: measurement.manual_review.seed,
    sample_size: sampleNumbers.length,
    sample_numbers: sampleNumbers,
    reviews: rows
      .filter((row) => expected.has(Number(row.number)))
      .map((row) => {
        const review = reviews.find((entry) => Number(entry.number) === Number(row.number))
        return {
          number: Number(row.number),
          title: row.title,
          classifier: { layer: row.layer, verdict: row.verdict },
          reviewer: { layer: review.layer, verdict: review.verdict },
          agree: review.layer === row.layer && review.verdict === row.verdict,
          why: typeof review.why === 'string' ? review.why : null,
        }
      }),
    agent: { reviewer: REVIEWER, ...agreement },
    human_spot_check: human,
    limits: [
      'the reviewer labels the text they were shown; the classifier is frozen for this round',
      'agreement is exact on both layer and verdict; near misses are still disagreements',
    ],
  }

  const text = `${JSON.stringify(payload, null, 2)}\n`
  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `question-review-${STAMP.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, text, 'utf8')
  writeFileSync(`${file}.sha256`, sha256(text), 'utf8')
  process.stdout.write(
    `review · ${agreement.agree}/${agreement.total} agree` +
      ` · human ${human.status}${human.status === 'done' ? ` ${human.agree}/${human.total}` : ''}\n`,
  )
  process.stdout.write(`ssot ${basename(file)} sha256=${sha256(text).slice(0, 12)}…\n`)
}

/* ------------------------------------------------------------------ *
 * Dispatch (after every declaration, so a mode cannot read a `const` before it is initialised)
 * ------------------------------------------------------------------ */

if (REVIEW_ONLY) {
  runReviewOnly()
} else {
  await main()
}
