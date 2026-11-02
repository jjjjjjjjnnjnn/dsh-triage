#!/usr/bin/env node
/**
 * Which upstream help threads can this tool actually answer? (R57)
 *
 * WHY: the D5 sample is live and the obvious next move is "go answer questions in the discussion
 * board". The failure mode of that move is answering the wrong ones — replying with an admission
 * verdict to a thread about a gateway 503 makes the tool look broken. So the sample is classified by
 * **layer** first (`scripts/lib/discussion-triage.mjs`), and for the threads whose layer is ours and
 * which name a package, we do not claim an answer: we **compute** one by fetching the published
 * manifest and evaluating its range against the target runtime (the same `evaluateAdmission` the
 * engine uses).
 *
 * WHAT IT REFUSES: to call a runtime crash "answerable"; to answer for a package it could not read
 * (that is `unreadable`, not `denied`); to guess a version that is not on the registry.
 *
 *   node scripts/record_discussion_triage.mjs --stamp <ISO> --ids 11687,10849,8202 \
 *     [--target 0.2.1-rc.5] [--fixtures data/fixtures/discussions/<file>.json]
 *
 * EXIT: 0 artifact written · 1 nothing could be read · 2 usage.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'

import { fetchPackument } from '../packages/signals/dist/index.js'
import { probePackage, selectProbeTargets } from './lib/discussion-probe.mjs'
import { classifyThread } from './lib/discussion-triage.mjs'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}"\n`)
  process.exit(2)
}
const ids = String(argOf('--ids', '')).split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0)
if (ids.length === 0) {
  process.stderr.write('usage: node scripts/record_discussion_triage.mjs --stamp <ISO> --ids 11687,10849\n')
  process.exit(2)
}
const targetRuntime = String(argOf('--target', '0.2.1-rc.5'))
const fixturesIn = argOf('--fixtures', null)
const fixturesOut = pathFor(String(argOf('--fixtures-out', `data/fixtures/discussions/${stamp.replace(/[:.]/g, '-')}.json`)))
const outDir = pathFor(String(argOf('--out', 'data/results')))

/** One GraphQL round-trip for all ids: fewer requests, one failure mode. */
function fetchThreads() {
  const fields = ids
    .map((id) => `d${id}: discussion(number: ${id}) { number title url createdAt category { name } comments { totalCount } bodyText }`)
    .join('\n')
  const query = `query {\n  repository(owner: "deepseek-ai", name: "deepseek-harness") {\n${fields}\n  }\n}`
  const result = spawnSync('gh', ['api', 'graphql', '-f', `query=${query}`], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) {
    process.stderr.write(`could not read the discussions: ${String(result.stderr).slice(0, 300)}\n`)
    return null
  }
  try {
    const payload = JSON.parse(String(result.stdout))
    const repository = payload?.data?.repository
    if (repository === null || repository === undefined) return null
    return Object.values(repository).filter((entry) => entry !== null && typeof entry === 'object')
  } catch (error) {
    process.stderr.write(`unreadable GraphQL payload: ${String(error?.message ?? error)}\n`)
    return null
  }
}

/**
 * A real answer for an admission/upgrade thread: published manifest + declared range vs the target
 * runtime. The implementation lives in `scripts/lib/discussion-probe.mjs` so R59 uses the same one.
 */
const loadPackument = (name) => fetchPackument(name, {})

function loadFixtures() {
  const file = String(fixturesIn)
  if (!existsSync(pathFor(file))) {
    process.stderr.write(`fixture file not found: ${file}\n`)
    return null
  }
  const payload = JSON.parse(readFileSync(pathFor(file), 'utf8'))
  return Array.isArray(payload?.threads) ? payload.threads : null
}

const threads = fixturesIn === null ? fetchThreads() : loadFixtures()
if (threads === null || threads.length === 0) {
  process.stderr.write('nothing was read, so nothing is written (an unreadable sample is not an empty one)\n')
  process.exit(1)
}

if (fixturesIn === null) {
  mkdirSync(dirname(String(fixturesOut)), { recursive: true })
  writeFileSync(fixturesOut, `${JSON.stringify({ schema_version: 1, produced_by: 'scripts/record_discussion_triage.mjs', captured_at: stamp, threads }, null, 2)}\n`, 'utf8')
}

const rows = []
for (const thread of [...threads].sort((a, b) => Number(b.number) - Number(a.number))) {
  const classification = classifyThread({ title: thread.title, body: thread.bodyText, category: thread.category?.name })
  const probes = []
  if (classification.verdict === 'answerable' || classification.verdict === 'partially-answerable') {
    // Bare names, pinned versions and third-party ordering all live in the shared selector (R59).
    const { targets } = selectProbeTargets(classification, `${thread.title}\n${thread.bodyText}`)
    for (const target of targets) {
      probes.push(await probePackage(target.name, targetRuntime, { pinned: target.pinned, loadPackument }))
    }
  }
  rows.push({
    number: Number(thread.number),
    title: String(thread.title),
    url: String(thread.url ?? ''),
    created_at: String(thread.createdAt ?? ''),
    category: thread.category?.name ?? null,
    comments: Number(thread.comments?.totalCount ?? 0),
    layer: classification.layer,
    verdict: classification.verdict,
    /*
     * WHAT WE CAN ACTUALLY SAY (R57): "answerable" is too coarse. Naming the denied package and its
     * range is one kind of answer; ruling the declaration layer OUT ("their plugins admit rc.5, so the
     * crash is elsewhere") is a different, equally useful one — and reporting both as "solved" would
     * overstate the second.
     */
    answer: (() => {
      const measured = probes.filter((probe) => probe.state === 'measured')
      if (probes.length === 0) return null
      if (measured.some((probe) => probe.admission_status === 'denied')) return 'names-a-denial'
      if (measured.some((probe) => probe.admission_status === 'admitted')) return 'rules-out-declaration'
      if (measured.length > 0) return 'declares-nothing'
      return 'unreadable'
    })(),
    reason: classification.reason,
    answerable_with: classification.answerableWith,
    packages: classification.packages,
    probes,
  })
}

const counts = rows.reduce((acc, row) => ({ ...acc, [row.verdict]: (acc[row.verdict] ?? 0) + 1 }), {})
const answers = rows.reduce((acc, row) => {
  if (row.answer === null) return acc
  return { ...acc, [row.answer]: (acc[row.answer] ?? 0) + 1 }
}, {})
const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_discussion_triage.mjs',
  generated_at: stamp,
  sample: { ids, target_runtime: targetRuntime, source: fixturesIn === null ? 'graphql' : `fixtures:${String(fixturesIn).split(/[\\/]/).slice(-1)[0]}` },
  counts,
  answers,
  rows,
  limits: [
    'classification reads the thread text only; it does not run the reporter\'s profile',
    'a probe judges the **latest published** version unless the thread named one explicitly (the version used is recorded per probe)',
    'answerable means "we can produce a declaration-layer answer", not "we solved their problem"',
    'runtime threads are partially answerable at best: we can rule the declaration layer in or out, nothing more',
  ],
}

const text = `${JSON.stringify(payload, null, 2)}\n`
const prefix = fixturesIn === null ? 'discussion-triage' : 'discussion-triage-selftest'
mkdirSync(outDir, { recursive: true })
const target = join(outDir, `${prefix}-${stamp.replace(/[:.]/g, '-')}.json`)
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, sha256(text), 'utf8')

process.stdout.write(`sample ${rows.length} · ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`)
process.stdout.write(`answers · ${Object.entries(answers).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}\n`)
const PHRASE = { admitted: 'admits', denied: 'denies', unconstrained: 'declares nothing', indeterminate: 'could not tell' }
for (const row of rows) {
  const probed = row.probes
    .filter((probe) => probe.state === 'measured')
    .map((probe) => `${probe.package}@${probe.version} ${PHRASE[probe.admission_status] ?? String(probe.admission_status)} ${probe.target}`)
  process.stdout.write(`#${row.number} [${row.layer}] ${row.verdict}${probed.length > 0 ? ` :: ${probed.join(' | ')}` : ''}\n`)
}
process.stdout.write(`ssot ${basename(target)} sha256=${sha256(text).slice(0, 12)}…\n`)

function pathOf(value) {
  return isAbsolute(String(value)) ? String(value) : resolve(abs('.'), String(value))
}
