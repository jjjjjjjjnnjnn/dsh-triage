#!/usr/bin/env node
/**
 * What does this repository's traffic actually look like? (R116)
 *
 * WHY THIS EXISTS: the D5 verdict counted downloads and reactions, but "who looked" was never recorded
 * anywhere. GitHub's traffic API only keeps 14 days, so a number not written down today is gone
 * tomorrow. This recorder writes one snapshot: repo views / clones / referrers / paths, npm daily
 * downloads for the four packages, and the two third-party listings (awesome-dsh-plugin, dsh.so).
 *
 * WHAT IT CANNOT SEE: unique visitors behind a shared IP, downloads by a mirror, anyone who read the
 * README on npm without opening GitHub, or a force-push. GitHub's traffic API is a 14-day window and
 * is only readable by the repository owner — when `gh` is not authenticated this records `unmeasured`
 * and exits 3, never a zero.
 *
 *   node scripts/record_traffic.mjs --stamp 2026-11-17T13:00:00.000Z
 *
 * Exit codes: 0 written and measured · 3 written with an unmeasured section · 2 bad usage.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
if (stamp === null) {
  process.stderr.write('usage: node scripts/record_traffic.mjs --stamp <ISO> [--repo owner/name] [--out <dir>]\n')
  process.exit(2)
}
const repo = String(argOf('--repo', 'jjjjjjjjnnjnn/dsh-triage'))
const npmName = String(argOf('--npm', 'dsh-triage'))
const outDir = (() => {
  const value = String(argOf('--out', 'data/results'))
  return isAbsolute(value) ? value : resolve(abs('.'), value)
})()

const json = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const gh = (endpoint) => {
  const result = spawnSync('gh', ['api', endpoint], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    return { ok: false, error: String(result.stderr ?? '').trim().slice(0, 400) || `exit ${String(result.status)}` }
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout) }
  } catch {
    return { ok: false, error: 'gh returned non-JSON' }
  }
}

const direct = (endpoint) => {
  const result = spawnSync('gh', ['api', endpoint], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return null
  return String(result.stdout ?? '').trim()
}

const fetchJson = async (url) => {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    if (!response.ok) return { ok: false, status: response.status }
    return { ok: true, value: await response.json() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const unmeasured = []
const note = (name, detail) => {
  unmeasured.push({ name, detail })
}

/* --- 1. GitHub repository + 14-day traffic ---------------------------------------------------- */
const repoInfo = gh(`repos/${repo}`)
const views = gh(`repos/${repo}/traffic/views`)
const clones = gh(`repos/${repo}/traffic/clones`)
const referrers = gh(`repos/${repo}/traffic/popular/referrers`)
const paths = gh(`repos/${repo}/traffic/popular/paths`)
const releases = gh(`repos/${repo}/releases`)
const tags = gh(`repos/${repo}/tags`)

for (const [name, result] of [
  ['repo', repoInfo],
  ['traffic.views', views],
  ['traffic.clones', clones],
  ['traffic.referrers', referrers],
  ['traffic.paths', paths],
  ['releases', releases],
  ['tags', tags],
]) {
  if (!result.ok) note(`github.${name}`, result.error)
}

const viewsValue = views.ok ? views.value : null
const clonesValue = clones.ok ? clones.value : null
const repoValue = repoInfo.ok ? repoInfo.value : null

const trafficWindow = {
  since: viewsValue?.views?.[0]?.timestamp ?? clonesValue?.clones?.[0]?.timestamp ?? null,
  until: viewsValue?.views?.at(-1)?.timestamp ?? clonesValue?.clones?.at(-1)?.timestamp ?? null,
  days: viewsValue?.views?.length ?? clonesValue?.clones?.length ?? 0,
}

/* --- 2. npm daily downloads for the four packages --------------------------------------------- */
const packages = ['dsh-triage', '@dsh-triage/core', '@dsh-triage/signals', '@dsh-triage/probe']
const end = new Date(`${stamp.slice(0, 10)}T00:00:00.000Z`)
const start = new Date(end.getTime() - 30 * 86_400_000)
const range = `${start.toISOString().slice(0, 10)}:${end.toISOString().slice(0, 10)}`
const downloads = {}
for (const pkg of packages) {
  const payload = await fetchJson(`https://api.npmjs.org/downloads/range/${range}/${encodeURIComponent(pkg)}`)
  if (!payload.ok) {
    note(`npm.${pkg}`, payload.error ?? `HTTP ${String(payload.status)}`)
    downloads[pkg] = null
    continue
  }
  const days = Array.isArray(payload.value.downloads) ? payload.value.downloads : []
  const total = days.reduce((sum, day) => sum + Number(day.downloads ?? 0), 0)
  const peak = days.reduce((best, day) => (Number(day.downloads) > Number(best.downloads) ? day : best), {
    day: null,
    downloads: -1,
  })
  const last7 = days.slice(-7).reduce((sum, day) => sum + Number(day.downloads ?? 0), 0)
  downloads[pkg] = { range, total, last7, peak, days }
}

/* --- 3. The two third-party listings ---------------------------------------------------------- */
const awesome = await fetchJson('https://awesome-dsh-plugin.com/plugins.json')
let awesomeEntry = null
if (awesome.ok) {
  const list = Array.isArray(awesome.value.plugins) ? awesome.value.plugins : []
  awesomeEntry =
    list.find((entry) => String(entry?.url ?? '').includes(repo)) ??
    list.find((entry) => String(entry?.npm ?? '') === npmName) ??
    null
} else {
  note('awesome-dsh-plugin', awesome.error ?? `HTTP ${String(awesome.status)}`)
}

const dshSoArtifact = await fetchJson(
  'https://www.dsh.so/artifact/@jjjjjjjjnnjnn/dsh-triage.json',
)
const dshSoInstall = await fetchJson(
  'https://www.dsh.so/data/install/@jjjjjjjjnnjnn/dsh-triage.json',
)
if (!dshSoArtifact.ok) note('dsh.so.artifact', dshSoArtifact.error ?? `HTTP ${String(dshSoArtifact.status)}`)
if (!dshSoInstall.ok) note('dsh.so.install', dshSoInstall.error ?? `HTTP ${String(dshSoInstall.status)}`)

/* --- 4. Assemble ------------------------------------------------------------------------------ */
const npmRoot = downloads['dsh-triage']
const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_traffic.mjs',
  generated_at: stamp,
  question: 'where does anyone actually see this repository, and how much of that is a human?',
  inputs: { repo, npm: npmName, npm_range: range, github_traffic_window: trafficWindow },
  github: {
    repo:
      repoValue === null
        ? null
        : {
            description: repoValue.description ?? null,
            homepage: repoValue.homepage ?? null,
            topics: repoValue.topics ?? [],
            stars: repoValue.stargazers_count ?? null,
            forks: repoValue.forks_count ?? null,
            watchers: repoValue.subscribers_count ?? null,
            open_issues: repoValue.open_issues_count ?? null,
            created_at: repoValue.created_at ?? null,
            pushed_at: repoValue.pushed_at ?? null,
          },
    views: viewsValue,
    clones: clonesValue,
    referrers: referrers.ok ? referrers.value : null,
    paths: paths.ok ? paths.value : null,
    releases: releases.ok ? releases.value : null,
    tags: tags.ok ? tags.value : null,
  },
  npm: downloads,
  surfaces: {
    'awesome-dsh-plugin': awesomeEntry,
    'dsh.so': {
      artifact: dshSoArtifact.ok ? dshSoArtifact.value : null,
      install: dshSoInstall.ok ? dshSoInstall.value : null,
    },
  },
  funnel: {
    repo_views_14d: viewsValue?.count ?? null,
    repo_uniques_14d: viewsValue?.uniques ?? null,
    repo_clones_14d: clonesValue?.count ?? null,
    repo_unique_clones_14d: clonesValue?.uniques ?? null,
    clone_to_view_ratio:
      viewsValue?.count && clonesValue?.count
        ? Number((clonesValue.count / viewsValue.count).toFixed(2))
        : null,
    npm_total_31d: npmRoot?.total ?? null,
    npm_last7: npmRoot?.last7 ?? null,
    npm_peak: npmRoot?.peak ?? null,
    stars: repoValue?.stargazers_count ?? null,
    forks: repoValue?.forks_count ?? null,
    watchers: repoValue?.subscribers_count ?? null,
    open_issues: repoValue?.open_issues_count ?? null,
  },
  unmeasured,
  limits: [
    'GitHub traffic is a 14-day window and only the repository owner can read it',
    'a clone is not a reader: CI, mirrors and scanners clone too',
    'npm counts installs by package, not by person; a publish day produces a spike',
    'the awesome-dsh-plugin and dsh.so numbers are their readings, on their refresh schedule',
    'a unique is an IP, not a human',
  ],
}

mkdirSync(outDir, { recursive: true })
const fileName = `traffic-${stamp.replace(/[:.]/g, '-')}.json`
const target = join(outDir, fileName)
writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`)
const digest = sha256(readFileSync(target, 'utf8'))
writeFileSync(`${target}.sha256`, `${digest}\n`)

process.stdout.write(
  `traffic · views ${String(payload.funnel.repo_views_14d)}/${String(payload.funnel.repo_uniques_14d)} unique · ` +
    `clones ${String(payload.funnel.repo_clones_14d)}/${String(payload.funnel.repo_unique_clones_14d)} · ` +
    `npm 31d ${String(payload.funnel.npm_total_31d)} · stars ${String(payload.funnel.stars)}\n` +
    `  ${target} · ${digest.slice(0, 12)}\n`,
)
if (unmeasured.length > 0) {
  process.stdout.write(`  unmeasured: ${unmeasured.map((entry) => entry.name).join(', ')}\n`)
  process.exit(3)
}
