#!/usr/bin/env node
/**
 * Adjacent-tools census (R81): who else is building rescue / diagnosis / upgrade-safety for DSH?
 *
 * WHY: the next direction is a "first-aid kit" — diagnose, plan, apply, verify, undo. Before adding
 * capabilities, we need to know what already exists, what it actually does, and what its licence allows.
 * Hand-written lists rot and cannot be re-run; this recorder keeps the queries fixed, the raw responses
 * in `data/fixtures/`, and the categories mechanical.
 *
 * WHAT IT DOES NOT DO: it does not judge quality, does not read source code, and does not copy anything.
 * A missing licence is reported as `null` (all rights reserved by default), never guessed.
 *
 *   node scripts/record_adjacent_tools.mjs --stamp 2026-11-05T09:00:00.000Z
 *
 * Exit: 0 written · 2 usage / a query failed.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

import { abs, isoStamp } from './lib/kit.mjs'
import { writeEvidence } from './lib/evidence.mjs'

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
const outDir = String(argOf('--out', 'data/results'))
const fileStamp = stamp.replace(/:/g, '-')
const fixtureDir = join('data/fixtures/adjacent-tools', stamp.replace(/[:.]/g, '-'))

const QUERIES = [
  'dsh rescue in:name,description,readme',
  'dsh doctor in:name,description,readme',
  'dsh plugin compatibility in:name,description,readme',
  'dsh plugin diagnose in:name,description,readme',
  'deepseek harness plugin rescue in:name,description,readme',
  'dsh backup rollback in:name,description,readme',
  'topic:dsh-plugin',
]

const CATEGORIES = [
  ['rescue', /rescue|急救|救援|lazarus|recover|safe[ -]?mode|安全模式|抢救/i],
  ['doctor', /doctor|diagnos|诊断|health|体检|repair|修复/i],
  ['compatibility', /compatib|兼容|gating|pre-?check|contract|preflight|保险/i],
  ['backup', /backup|备份|undo|snapshot|快照|rollback|回滚|savepoint|restore|恢复|migrat/i],
  ['ops', /launcher|启动器|ops|运维|watchdog|守护|upgrade|升级|monitor|监控/i],
  ['catalog', /market|市场|awesome|目录|directory|store|hub|radar|索引|index/i],
  ['context', /context|上下文|memory|记忆|token/i],
]

const categoryOf = (row) => {
  const text = `${row.fullName} ${row.description ?? ''}`
  for (const [name, pattern] of CATEGORIES) if (pattern.test(text)) return name
  return 'other'
}

const search = (query) => {
  const result = spawnSync(
    'gh',
    [
      'search',
      'repos',
      query,
      '--limit',
      '50',
      '--json',
      'fullName,description,stargazersCount,forksCount,license,updatedAt,pushedAt,url,isArchived,isFork,homepage,language',
    ],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
  )
  if (result.status !== 0) {
    process.stderr.write(`gh search failed for "${query}": ${String(result.stderr).slice(0, 300)}\n`)
    return null
  }
  return JSON.parse(result.stdout)
}

const isDsh = (row) => {
  const text = `${row.fullName} ${row.description ?? ''}`.toLowerCase()
  return (
    row.fullName.toLowerCase().includes('dsh') ||
    text.includes('deepseek harness') ||
    text.includes('deepseek-harness') ||
    text.includes('deepseek-harness')
  )
}

mkdirSync(abs(fixtureDir), { recursive: true })
const raw = {}
const merged = new Map()
for (const query of QUERIES) {
  const rows = search(query)
  if (rows === null) {
    process.stderr.write('refusing to write an artifact from a partial search\n')
    process.exit(2)
  }
  raw[query] = rows
  const file = join(fixtureDir, `${query.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.json`)
  writeFileSync(abs(file), `${JSON.stringify({ query, rows }, null, 2)}\n`, 'utf8')
  for (const row of rows) {
    if (!isDsh(row)) continue
    const key = row.fullName.toLowerCase()
    const previous = merged.get(key)
    if (previous === undefined || (row.stargazersCount ?? 0) > (previous.stargazersCount ?? 0)) {
      merged.set(key, { ...row, query })
    }
  }
}

const rows = [...merged.values()]
  .map((row) => ({
    full_name: row.fullName,
    url: row.url,
    description: row.description ?? null,
    stars: row.stargazersCount ?? 0,
    forks: row.forksCount ?? 0,
    license: (row.license?.spdxId ?? row.license?.key ?? '') || null,
    language: row.language ?? null,
    pushed_at: row.pushedAt ?? null,
    updated_at: row.updatedAt ?? null,
    archived: row.isArchived === true,
    fork: row.isFork === true,
    homepage: row.homepage || null,
    first_seen_in: row.query,
    category: categoryOf({ fullName: row.fullName, description: row.description ?? '' }),
  }))
  .sort((left, right) => right.stars - left.stars || left.full_name.localeCompare(right.full_name))

const byCategory = {}
for (const row of rows) byCategory[row.category] = (byCategory[row.category] ?? 0) + 1
const byLicense = {}
for (const row of rows) {
  const key = row.license ?? 'none'
  byLicense[key] = (byLicense[key] ?? 0) + 1
}
const samePosition = rows.filter((row) => row.category === 'rescue' || row.category === 'doctor')
const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_adjacent_tools.mjs',
  generated_at: stamp,
  inputs: {
    queries: QUERIES,
    limit_per_query: 50,
    relevant_only: 'name or description mentions dsh / deepseek harness',
    fixtures: fixtureDir.replaceAll('\\', '/'),
  },
  counts: {
    raw_results: Object.values(raw).reduce((sum, list) => sum + list.length, 0),
    unique_dsh_relevant: rows.length,
    by_category: byCategory,
    by_license: byLicense,
    unlicensed: rows.filter((row) => row.license === null).length,
    same_position_rescue_or_doctor: samePosition.length,
  },
  same_position: samePosition.map((row) => ({
    full_name: row.full_name,
    url: row.url,
    stars: row.stars,
    license: row.license,
    pushed_at: row.pushed_at,
    category: row.category,
    description: row.description,
  })),
  rows,
  limits: [
    'GitHub search is not a census: it returns at most 50 per query, ranks by relevance, and misses repositories that never mention dsh in their name or description.',
    'Licence is what GitHub detects from the repository; null means no detected licence, which is "all rights reserved" for reuse purposes — read the repository before borrowing anything.',
    'This artifact records metadata only. It does not read source code, does not judge quality, and does not establish that a tool works.',
    'Stars and pushed_at are time-of-read facts, not adoption or maintenance claims.',
  ],
}

const written = writeEvidence({
  outDir: isAbsolute(outDir) ? outDir : resolve(abs('.'), outDir),
  fileName: `adjacent-tools-${fileStamp}.json`,
  text: `${JSON.stringify(artifact, null, 2)}\n`,
})
if (!written.ok) {
  process.stderr.write(`refusing to overwrite ${written.target}\n`)
  process.exit(2)
}
process.stdout.write(`adjacent tools · ${rows.length} DSH-relevant repositories\n`)
process.stdout.write(`  same position (rescue/doctor): ${samePosition.length} · unlicensed: ${artifact.counts.unlicensed}\n`)
for (const [category, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`  ${category}: ${count}\n`)
}
process.stdout.write(`ssot ${written.display} sha256=${written.sha256.slice(0, 12)}…\n`)
