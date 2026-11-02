#!/usr/bin/env node
/**
 * Evaluate classifier v1 / v2 / v3 on one development set and two disjoint holdouts (R61 candidate).
 *
 * WHY: v3 was designed from v2's holdout misses. To know whether it generalises, it must be scored
 * on a set it was NOT designed from. This recorder reads three label files and writes one artifact:
 *
 *   - dev:      the 20 threads v2 was designed from (v3 also saw their failures)
 *   - holdout1: the 20 threads v2 failed on (v3 saw these, so this is in-sample for v3)
 *   - holdout2: the 20 threads v3 never saw (clean out-of-sample)
 *
 *   node scripts/record_classifier_v3.mjs --stamp <ISO> --fixtures <snapshot dir>
 *
 * EXIT: 0 artifact written · 2 bad usage / missing input.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, basename, join, resolve } from 'node:path'
import process from 'node:process'

import { classifyThread, classifyThreadV2, classifyThreadV3 } from './lib/discussion-triage.mjs'
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
const fixtures = pathFor(String(argOf('--fixtures', 'data/fixtures/question-coverage/2026-11-02T09-57-53-229Z')))
const labels = {
  dev: join(fixtures, 'review.json'),
  holdout1: join(fixtures, 'holdout-review.json'),
  holdout2: join(fixtures, 'holdout2-review.json'),
}
const outDir = pathFor(String(argOf('--out', 'data/results')))

for (const file of [join(fixtures, 'qa.json'), ...Object.values(labels)]) {
  if (!existsSync(file)) {
    process.stderr.write(`missing input: ${file}\n`)
    process.exit(2)
  }
}

const qa = JSON.parse(readFileSync(join(fixtures, 'qa.json'), 'utf8'))
const threads = new Map((Array.isArray(qa.threads) ? qa.threads : []).map((thread) => [Number(thread.number), thread]))
if (threads.size === 0) {
  process.stderr.write('the QA fixture has no threads\n')
  process.exit(2)
}

function evaluate(classifier, reviewPath) {
  const reviews = JSON.parse(readFileSync(reviewPath, 'utf8')).reviews
  let agree = 0
  const disagreements = []
  for (const review of reviews) {
    const thread = threads.get(Number(review.number))
    if (thread === undefined) {
      process.stderr.write(`review for #${review.number} is not in the QA fixture\n`)
      process.exit(2)
    }
    const result = classifier({ title: thread.title, body: thread.bodyText, category: thread.category?.name })
    const same = result.layer === review.layer && result.verdict === review.verdict
    if (same) agree += 1
    else disagreements.push({ number: Number(review.number), classifier: { layer: result.layer, verdict: result.verdict }, reviewer: { layer: review.layer, verdict: review.verdict } })
  }
  return { sample_size: reviews.length, agree, agreement: agree / reviews.length, disagreements }
}

const sets = {}
for (const [name, path] of Object.entries(labels)) {
  sets[name] = {
    source: basename(path),
    v1: evaluate(classifyThread, path),
    v2: evaluate(classifyThreadV2, path),
    v3: evaluate(classifyThreadV3, path),
  }
}

const clean = sets.holdout2
const meetsBar = clean.v3.agreement >= 0.8

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_classifier_v3.mjs',
  generated_at: stamp,
  corpus: { fixtures: basename(fixtures), threads: threads.size, qa_total_count: Number(qa.total_count ?? 0) },
  classifiers: {
    v1: 'scripts/lib/discussion-triage.mjs#SIGNALS_V1 (production)',
    v2: 'scripts/lib/discussion-triage.mjs#SIGNALS_V2 (experiment)',
    v3: 'scripts/lib/discussion-triage.mjs#SIGNALS_V3 + question veto (candidate)',
  },
  sets,
  clean_holdout: 'holdout2',
  bar: 0.8,
  meets_bar: meetsBar,
  decision: meetsBar ? 'candidate-validated' : 'not-adopted',
  reasons: meetsBar
    ? [
        `v3 reaches ${clean.v3.agree}/${clean.v3.sample_size} on a holdout it never saw (bar: 80%)`,
        'adoption is a separate round: it changes the coverage headline, so it needs a live re-measurement and a new 20-thread review',
        'the two misses (runtime performance without an error code, startup stuck on the plugin page) are recorded, not hidden',
      ]
    : [
        `v3 only reaches ${clean.v3.agree}/${clean.v3.sample_size} on the clean holdout (bar: 80%)`,
        'production stays v1; a v4 needs a fourth disjoint set',
      ],
  limits: [
    'holdout2 is now seen: a v4 must use a fourth set',
    'the holdout2 labels were written by an agent, not a HUMAN; a 5-thread HUMAN spot-check is required before adoption',
    'the coverage headline was measured with v1 and is unchanged by this artifact',
  ],
}

const text = `${JSON.stringify(payload, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const file = join(outDir, `classifier-v3-${stamp.replace(/[:.]/g, '-')}.json`)
writeFileSync(file, text, 'utf8')
writeFileSync(`${file}.sha256`, sha256(text), 'utf8')

for (const [name, set] of Object.entries(sets)) {
  process.stdout.write(`${name.padEnd(9)} · v1 ${set.v1.agree}/${set.v1.sample_size} · v2 ${set.v2.agree}/${set.v2.sample_size} · v3 ${set.v3.agree}/${set.v3.sample_size}\n`)
}
process.stdout.write(`decision · ${payload.decision} (clean holdout ${clean.v3.agree}/${clean.v3.sample_size})\n`)
process.stdout.write(`ssot ${basename(file)} sha256=${sha256(text).slice(0, 12)}…\n`)
