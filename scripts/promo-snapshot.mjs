#!/usr/bin/env node
/**
 * Promotion Bus snapshot — read-only, offline.
 *
 *   node scripts/promo-snapshot.mjs
 *
 * Emits a promotion-snapshot/v1 JSON object on stdout so the local knowledge
 * base's promotion bus (知识库内容/Promotion) can read this project without
 * parsing Markdown. It reads only files this repository already produced:
 *
 *   data/results/traffic-*.json      GitHub / npm / catalogue readings
 *   docs/copy/outreach.json          every comment/reply this account posted
 *   docs/market/index.json           the format-1 index source
 *   packages/plugin/package.json     current version
 *
 * Missing inputs become `unreachable`, never zero. Exit code 0 even then: a
 * daily job that fails because a file is missing should still leave a record.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8'))
  } catch {
    return null
  }
}

function latestResult(pattern) {
  const dir = join(root, 'data', 'results')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort()
  if (!files.length) return null
  return { name: files[files.length - 1], data: readJson(join('data', 'results', files[files.length - 1])) }
}

let version = null
try {
  version = JSON.parse(readFileSync(join(root, 'packages', 'plugin', 'package.json'), 'utf8')).version
} catch {
  version = null
}

const trafficResult = latestResult(/^traffic-.*\.json$/)
const traffic = trafficResult?.data ?? null
const outreach = readJson(join('docs', 'copy', 'outreach.json')) ?? { entries: [], posted_outside_channel: [] }
const market = readJson(join('docs', 'market', 'index.json'))

const unreachable = []
if (!traffic) unreachable.push('traffic')
if (!outreach) unreachable.push('outreach')
if (!market) unreachable.push('market')

const gh = traffic?.github ?? {}
const repo = gh.repo ?? {}
const npm = Object.entries(traffic?.npm ?? {}).map(([name, p]) => ({
  package: name,
  week: p.last7 ?? null,
  total: p.total ?? null,
  window: p.range ?? null,
  newest: null,
  share: null
}))

const catalogue = []
const surface = traffic?.surfaces?.['awesome-dsh-plugin']
if (surface) {
  catalogue.push({
    name: surface.name,
    version: surface.version,
    page: surface.page
  })
}

const devto = (outreach.posted_outside_channel ?? [])
  .filter((item) => item.platform === 'devto')
  .map((item) => ({
    url: item.article,
    comment_id: item.comment_id,
    posted_on: item.posted_on,
    parent_author: item.parent_author
  }))

const x = (outreach.entries ?? [])
  .filter((item) => String(item.url ?? '').includes('x.com'))
  .map((item) => ({ url: item.url, posted_on: item.posted_on, language: item.language }))

const snapshot = {
  schema: 'promotion-snapshot/v1',
  project_id: 'dsh-triage',
  generated_at: new Date().toISOString(),
  release: { version },
  github: traffic
    ? {
        stars: repo.stars ?? null,
        forks: repo.forks ?? null,
        watchers: repo.watchers ?? null,
        open_issues: repo.open_issues ?? null,
        views: { count: gh.views?.count ?? null, uniques: gh.views?.uniques ?? null, window_days: 14 },
        clones: { count: gh.clones?.count ?? null, uniques: gh.clones?.uniques ?? null, window_days: 14 },
        referrers: gh.referrers ?? []
      }
    : {},
  npm,
  catalogue,
  releases: gh.releases ?? [],
  social: { devto, x, reddit: [] },
  upstream: [],
  unreachable,
  source: {
    command: 'node scripts/promo-snapshot.mjs',
    traffic_result: trafficResult?.name ?? null,
    market_format: market?.format ?? null
  }
}

process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`)
