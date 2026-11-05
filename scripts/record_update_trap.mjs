#!/usr/bin/env node
/**
 * "Is the version the manager would offer actually newer?" — publish order versus semver order.
 *
 * WHY THIS RECORDER EXISTS: a discussion thread (#12209) reported that the plugin manager offered
 * `dsh-win-pwsh7@0.12.3` as an "update" to a profile running `0.2.6`, because the comparison is
 * `semver.gt(version, installed)` and never looks at publish time. The reporter then pointed out a
 * real weakness in our first probe: it ran *after* the author unpublished `0.12.3`, so it cannot
 * distinguish "the comparison is correct" from "there is nothing older left to compare".
 *
 * This recorder answers that objection in the only way it can be answered: it takes the registry's
 * own `time` field for every published version and asks, per package, whether the **highest semver
 * above the installed one was published before the installed one**. If it was, a manager that only
 * compares semver would offer older code — and nothing needs to be unpublished for that to be true.
 *
 * WHAT IT IS NOT: not a claim about the manager's UI, not a claim about code quality, and not a
 * verdict on any plugin. It reads published metadata only.
 *
 *   node scripts/record_update_trap.mjs --stamp 2026-11-05T10:40:00.000Z
 *   node scripts/record_update_trap.mjs --package dsh-win-pwsh7 --installed dsh-win-pwsh7@0.2.6
 *
 * EXIT: 0 artifact written · 2 usage / nothing could be read.
 */

import process from 'node:process'

import { fetchPackument } from '../packages/signals/dist/index.js'
import { writeEvidence } from './lib/evidence.mjs'
import { isoStamp } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const values = (name) => {
  const out = []
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === name && argv[i + 1] !== undefined) out.push(argv[i + 1])
  return out
}
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

const packages = values('--package')
const search = argOf('--search', null)
if (packages.length === 0 && search === null) {
  packages.push('dsh-win-pwsh7', '@deepseek-ai/dsh', '@deepseek-ai/dsh-plugin-manager', 'dsh-triage')
}
if (search !== null) {
  const limit = Number(argOf('--limit', '60'))
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(String(search))}&size=${String(Math.min(Math.max(limit, 1), 250))}`
  const response = await fetch(url)
  if (!response.ok) {
    process.stderr.write(`npm search refused: HTTP ${response.status}\n`)
    process.exit(2)
  }
  const body = await response.json()
  for (const object of body.objects ?? []) {
    const name = object?.package?.name
    if (typeof name === 'string' && !packages.includes(name)) packages.push(name)
  }
  if (packages.length === 0) {
    process.stderr.write(`npm search for "${String(search)}" named no packages\n`)
    process.exit(2)
  }
}
const installedOverrides = new Map()
for (const spec of values('--installed')) {
  const at = spec.lastIndexOf('@')
  if (at <= 0) {
    process.stderr.write(`--installed needs name@version; got "${spec}"\n`)
    process.exit(2)
  }
  installedOverrides.set(spec.slice(0, at), spec.slice(at + 1))
}

/* ------------------------------ semver compare ------------------------------ */

/**
 * Minimal comparison, because this repo's recorders stay dependency-free.
 *
 * `semver.gt` semantics: numeric fields first, then a prerelease sorts *below* its release
 * (`0.2.2-rc.1 < 0.2.2`), and prerelease identifiers compare numerically when both are numeric.
 * The artifact carries the checks that prove this implementation does what the claims need.
 */
function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(version).trim())
  if (match === null) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compare(a, b) {
  const left = parse(a)
  const right = parse(b)
  if (left === null || right === null) return null
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] > right.core[i] ? 1 : -1
  }
  const leftPre = left.pre
  const rightPre = right.pre
  if (leftPre.length === 0 && rightPre.length === 0) return 0
  if (leftPre.length === 0) return 1
  if (rightPre.length === 0) return -1
  const length = Math.max(leftPre.length, rightPre.length)
  for (let i = 0; i < length; i += 1) {
    const l = leftPre[i]
    const r = rightPre[i]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const ln = /^\d+$/.test(l)
    const rn = /^\d+$/.test(r)
    if (ln && rn) {
      if (Number(l) !== Number(r)) return Number(l) > Number(r) ? 1 : -1
      continue
    }
    if (ln !== rn) return ln ? -1 : 1
    if (l !== r) return l > r ? 1 : -1
  }
  return 0
}

const checks = [
  ['0.12.3', '0.2.6', 1, 'a renumbered-down older line still sorts higher'],
  ['0.2.2-rc.1', '0.2.1-rc.5', 1, 'a newer release candidate sorts higher'],
  ['0.2.2-rc.1', '0.2.2', -1, 'a prerelease sorts below its release'],
  ['1.0.0-rc.2', '1.0.0-rc.10', -1, 'numeric prerelease identifiers compare numerically'],
  ['1.0.0', '1.0.0', 0, 'equal versions compare equal'],
  ['not-a-version', '1.0.0', null, 'an unparsable version yields null, never a guess'],
].map(([a, b, expected, why]) => {
  const actual = compare(a, b)
  return { a, b, expected, actual, why, passed: actual === expected }
})

/* --------------------------------- reading --------------------------------- */

const rows = []
for (const name of packages) {
  const packument = await fetchPackument(name, { at: stamp })
  if (packument === null || packument.ok !== true) {
    rows.push({ package: name, verdict: 'unreadable', detail: 'the registry did not answer for this package' })
    continue
  }
  const value = packument.value
  // `publishedAt` keeps timestamps for versions that have since been unpublished, so the candidate
  // list must come from `versions` — those are the only ones a manager could actually install.
  const time = value.publishedAt ?? {}
  const published = [...value.versions.keys()]
  const installed = installedOverrides.get(name) ?? value.distTags?.latest ?? null
  if (installed === null || typeof time[installed] !== 'string') {
    rows.push({ package: name, verdict: 'no-installed', detail: 'no installed version to compare against' })
    continue
  }
  const installedAt = Date.parse(time[installed])

  const above = published
    .filter((version) => {
      const order = compare(version, installed)
      return order !== null && order > 0
    })
    .sort((a, b) => (compare(a, b) ?? 0) * -1)

  const channels = Object.entries(value.distTags ?? {})
    .filter(([, tagged]) => tagged === installed)
    .map(([tag]) => tag)

  if (above.length === 0) {
    rows.push({
      package: name,
      installed,
      installed_published_at: time[installed],
      channels,
      verdict: 'no-newer',
      detail: 'no published version has a higher semver than the installed one',
    })
    continue
  }

  const highest = above[0]
  const highestAt = typeof time[highest] === 'string' ? Date.parse(time[highest]) : null
  if (highestAt === null || Number.isNaN(highestAt)) {
    rows.push({
      package: name,
      installed,
      installed_published_at: time[installed],
      channels,
      highest_semver: highest,
      verdict: 'time-missing',
      detail: 'the registry has no publish time for the highest version, so order cannot be checked',
    })
    continue
  }

  const days = Math.round(((installedAt - highestAt) / 86_400_000) * 10) / 10
  rows.push({
    package: name,
    installed,
    installed_published_at: time[installed],
    channels,
    highest_semver: highest,
    highest_published_at: time[highest],
    days_older_than_installed: days,
    verdict: days > 0 ? 'trap' : 'no-trap',
    detail:
      days > 0
        ? `a semver-only comparison would offer ${highest}, published ${days} day(s) before the installed ${installed}`
        : `the highest semver above ${installed} was published later, so semver and publish order agree`,
  })
}

if (rows.every((row) => row.verdict === 'unreadable' || row.verdict === 'no-installed')) {
  process.stderr.write('nothing could be read from the registry; no artifact written\n')
  process.exit(2)
}

const traps = rows.filter((row) => row.verdict === 'trap')
const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_update_trap.mjs',
  generated_at: stamp,
  question: 'for each package, was the highest semver above the installed version published before the installed version?',
  method: {
    source: 'registry.npmjs.org packument: versions + time + dist-tags',
    installed: installedOverrides.size === 0 ? 'dist-tags.latest' : 'as given by --installed, else dist-tags.latest',
    semver: 'semver.gt semantics, reimplemented here (see checks)',
  },
  rows,
  counts: { packages: rows.length, traps: traps.length, readable: rows.filter((row) => row.verdict !== 'unreadable').length },
  checks,
  passed: checks.every((check) => check.passed),
  limits: [
    'published metadata only: this says nothing about whether either build runs',
    'no version was unpublished for this run, which is the point — a trap row is measured on live data',
    'dsh-win-pwsh7 appears as no-newer because its whole older line has been unpublished; that is the honest post-mitigation state, not proof the comparison is correct',
    'semver.gt semantics are reimplemented here instead of imported; the checks array proves the cases this claim depends on',
  ],
  recompute: `node scripts/record_update_trap.mjs --stamp ${stamp} --package ${packages.join(' --package ')}`,
}

const fileName = `update-trap-${stamp.replace(/[:.]/g, '-')}.json`
const result = writeEvidence({ outDir, fileName, text: `${JSON.stringify(payload, null, 2)}\n` })
if (!result.ok) {
  process.stderr.write(`refusing to overwrite existing evidence: ${result.target}\n`)
  process.exit(2)
}

for (const row of rows) {
  const where = row.highest_semver === undefined ? '' : ` · highest ${row.highest_semver} (${row.days_older_than_installed ?? '?'}d)`
  process.stdout.write(`${row.verdict.padEnd(12)} ${row.package}@${row.installed ?? '?'}${where}\n`)
}
process.stdout.write(`checks       ${checks.filter((check) => check.passed).length}/${checks.length} · traps ${traps.length}/${rows.length}\n`)
process.stdout.write(`ssot ${result.display} (${result.sha256.slice(0, 12)}…)\n`)
process.exit(payload.passed ? 0 : 1)
