#!/usr/bin/env node
/**
 * Evaluate classifier v1 vs v2 on a development set and a disjoint holdout (R60).
 *
 * WHY: v2 was designed from the 20 v1 review errors and scored 20/20 on that same set. That number
 * says nothing about generalisation. This recorder answers the only question that matters — does v2
 * beat v1 on threads it was not designed from? — and writes the answer as an SSOT artifact so the
 * "not adopted" decision is reproducible, not a prose claim.
 *
 *   node scripts/record_classifier_v2.mjs --stamp <ISO> \
 *     --fixtures data/fixtures/question-coverage/2026-11-02T09-57-53-229Z \
 *     --dev .../review.json --holdout .../holdout-review.json
 *
 * EXIT: 0 artifact written · 2 bad usage / missing input.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, basename, join, resolve } from 'node:path'
import process from 'node:process'

import { classifyThread, classifyThreadV2 } from './lib/discussion-triage.mjs'
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
const devPath = pathFor(String(argOf('--dev', join(fixtures, 'review.json'))))
const holdoutPath = pathFor(String(argOf('--holdout', join(fixtures, 'holdout-review.json'))))
const outDir = pathFor(String(argOf('--out', 'data/results')))

for (const file of [join(fixtures, 'qa.json'), devPath, holdoutPath]) {
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
  if (!Array.isArray(reviews) || reviews.length === 0) {
    process.stderr.write(`${basename(reviewPath)} has no reviews\n`)
    process.exit(2)
  }
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
    else {
      disagreements.push({
        number: Number(review.number),
        classifier: { layer: result.layer, verdict: result.verdict },
        reviewer: { layer: review.layer, verdict: review.verdict },
      })
    }
  }
  return { sample_size: reviews.length, agree, agreement: agree / reviews.length, disagreements }
}

const dev = { v1: evaluate(classifyThread, devPath), v2: evaluate(classifyThreadV2, devPath) }
const holdout = { v1: evaluate(classifyThread, holdoutPath), v2: evaluate(classifyThreadV2, holdoutPath) }

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_classifier_v2.mjs',
  generated_at: stamp,
  corpus: {
    fixtures: basename(fixtures),
    threads: threads.size,
    qa_total_count: Number(qa.total_count ?? 0),
  },
  classifiers: {
    v1: 'scripts/lib/discussion-triage.mjs#SIGNALS_V1 (production)',
    v2: 'scripts/lib/discussion-triage.mjs#SIGNALS_V2 (experiment)',
  },
  dev: { source: basename(devPath), ...dev },
  holdout: { seed: 20261103, source: basename(holdoutPath), ...holdout },
  decision: 'not-adopted',
  reasons: [
    'v2 was designed from the development set; 20/20 on that set is an in-sample fit, not an accuracy claim',
    `v2 beats v1 on the disjoint holdout (${holdout.v2.agree}/${holdout.v2.sample_size} vs ${holdout.v1.agree}/${holdout.v1.sample_size}) but is below the 80% bar in docs/specs/question-coverage.md §8`,
    'the production classifier stays v1; the R59 coverage headline (74/1545 = 4.8%) and its 9/20 agreement are unchanged',
  ],
  limits: [
    'the holdout is now seen: a v3 must use a third disjoint set, or this number becomes a second development set',
    'exact layer+verdict agreement is strict; a `unknown` vs `runtime` miss changes the tier split more than the headline',
    'the QA fixture is a fixed cutoff (#11857); a live rerun would add threads and change the sampling frame',
  ],
}

const text = `${JSON.stringify(payload, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const file = join(outDir, `classifier-v2-${stamp.replace(/[:.]/g, '-')}.json`)
writeFileSync(file, text, 'utf8')
writeFileSync(`${file}.sha256`, sha256(text), 'utf8')

process.stdout.write(
  `dev     · v1 ${dev.v1.agree}/${dev.v1.sample_size} · v2 ${dev.v2.agree}/${dev.v2.sample_size}\n` +
    `holdout · v1 ${holdout.v1.agree}/${holdout.v1.sample_size} · v2 ${holdout.v2.agree}/${holdout.v2.sample_size}\n` +
    `verdict · ${payload.decision} (v1 stays production)\n` +
    `ssot ${basename(file)} sha256=${sha256(text).slice(0, 12)}…\n`,
)
