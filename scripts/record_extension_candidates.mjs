#!/usr/bin/env node
/**
 * "Which unanswered questions are actually candidates for us?" (R88 / T-862)
 *
 * WHY: `docs/HANDOFF.md` §3 handed the next agent three *hypotheses* about the 1545 Q&A threads in
 * `data/results/question-coverage-2026-11-02T09-57-53-229Z.json` — 178 `needs-their-profile`,
 * 90 `probe-unreadable`, 950 `not-relevant` — and said in the same breath that they were "未逐条核"
 * (not yet checked) and that the first job was to verify them before turning any of them into work.
 * This script does that checking, offline, from the committed artifact only.
 *
 * WHAT IT FOUND (see the artifact's `findings`, not this comment):
 *   - `needs-their-profile` is not one bucket. 107 of the 178 sit on admission / composition / upgrade,
 *     i.e. questions whose answer depends on the installed set — that is our engine. The other 71 are
 *     runtime-layer bug reports, which `docs/adr/0009-agent-scope-reads.md` A decided we do not read.
 *   - `probe-unreadable` is not "the registry would not answer". All 160 probes behind those 90 threads
 *     say `npm has no package <name>`: the names are upstream module names and path fragments that our
 *     extractor mistook for packages. Registry fallback cannot fix a name that is not a name, and probe
 *     isolation would install nothing. The gap is extraction precision.
 *   - `not-relevant` cannot be described from this artifact at all: every one of the 950 has layer
 *     `unknown` and no signals, because that tier means "the keyword classifier matched nothing". Any
 *     sentence about what those threads are *about* is an inference the data does not support.
 *
 * WHAT IT IS NOT: no network, no new classification, no verdict about demand. It re-groups what the
 * committed artifact already says and records the grouping so the spec can cite a hash instead of a
 * memory. `judgeD5`, the three threshold numbers and `admission.ts` are untouched.
 *
 *   node scripts/record_extension_candidates.mjs --stamp 2026-11-05T17:00:00.000Z
 *   node scripts/record_extension_candidates.mjs --input data/results/question-coverage-….json --out %TEMP%\probe
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

import { writeEvidence } from './lib/evidence.mjs'
import { abs, isoStamp } from './lib/kit.mjs'

const DEFAULT_INPUT = 'data/results/question-coverage-2026-11-02T09-57-53-229Z.json'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-11-05T17:00:00.000Z\n`)
  process.exit(2)
}

const inputPath = pathFor(String(argOf('--input', DEFAULT_INPUT)))
const outDir = pathFor(String(argOf('--out', 'data/results')))

const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
const tally = (values, key) => {
  const out = {}
  for (const value of values) {
    const bucket = String(key(value))
    out[bucket] = (out[bucket] ?? 0) + 1
  }
  return sorted(out)
}

if (!existsSync(inputPath)) {
  process.stderr.write(`cannot read ${inputPath}\n`)
  process.exit(2)
}
const sourceText = readFileSync(inputPath, 'utf8')
const digest = sha256(sourceText)

/*
 * The signed artifact is the whole point: a re-grouping of bytes nobody can identify is a rumour. If the
 * sibling `.sha256` exists and disagrees, the numbers below would be about a different file than the one
 * `audit/step_reviews.json` cites, so refuse instead of quietly producing a plausible table.
 */
const sibling = `${inputPath}.sha256`
let signedDigest = null
if (existsSync(sibling)) {
  signedDigest = readFileSync(sibling, 'utf8').trim()
  if (signedDigest !== digest) {
    process.stderr.write(
      `sha256 mismatch: ${basename(inputPath)} hashes to ${digest.slice(0, 12)}… but its .sha256 says ` +
        `${signedDigest.slice(0, 12)}… — the numbers would describe different bytes\n`,
    )
    process.exit(2)
  }
}

let payload
try {
  payload = JSON.parse(sourceText)
} catch (error) {
  process.stderr.write(`cannot parse ${basename(inputPath)}: ${String(error)}\n`)
  process.exit(2)
}

const rows = payload?.rows?.qa
if (!Array.isArray(rows) || rows.length === 0) {
  process.stderr.write(`${basename(inputPath)} has no rows.qa[]\n`)
  process.exit(2)
}

/** Layers whose answer depends on the reader's installed set — the engine we already have. */
const INSTALLED_SET_LAYERS = ['admission', 'composition', 'upgrade']

const ofTier = (tier) => rows.filter((row) => row?.tier === tier)

const describe = (tier) => {
  const selected = ofTier(tier)
  return {
    count: selected.length,
    by_layer: tally(selected, (row) => row?.layer ?? 'unknown'),
    by_verdict: tally(selected, (row) => row?.verdict ?? 'unknown'),
    threads_with_packages: selected.filter((row) => Array.isArray(row?.packages) && row.packages.length > 0).length,
    threads_with_probes: selected.filter((row) => Array.isArray(row?.probes) && row.probes.length > 0).length,
  }
}

const needsProfile = ofTier('needs-their-profile')
const probeUnreadable = ofTier('probe-unreadable')
const notRelevant = ofTier('not-relevant')

const needsProfileInstalledSet = needsProfile.filter((row) => INSTALLED_SET_LAYERS.includes(row?.layer))
const needsProfileRuntime = needsProfile.filter((row) => row?.layer === 'runtime')

const probes = probeUnreadable.flatMap((row) => (Array.isArray(row?.probes) ? row.probes : []))
const probeStates = tally(probes, (probe) => probe?.state ?? 'unknown')
/*
 * `npm has no package <name>` is normalised on purpose: the names differ per thread, the reason does not,
 * and leaving 160 distinct strings in the artifact would look like 160 causes instead of one.
 */
const probeReasons = tally(probes, (probe) => {
  const detail = String(probe?.detail ?? '')
  if (/^npm has no package /.test(detail)) return 'npm has no package <name>'
  return detail === '' ? 'no-detail' : detail.replace(/\d+/g, '<n>')
})
const threadsWithNoMeasuredProbe = probeUnreadable.filter(
  (row) => (Array.isArray(row?.probes) ? row.probes : []).every((probe) => probe?.state !== 'measured'),
).length

/*
 * "npm has no package X" is one reason but several shapes of mistake. Separating them decides who can fix
 * it: a path fragment is our extractor's bug, an absent upstream module is nobody's bug (the token is real,
 * just not a package) — and only the third kind could ever be helped by a registry fallback.
 */
const nameShape = (name) => {
  const value = String(name ?? '')
  if (/^@\d/.test(value) || value.includes('/node_modules')) return 'version-or-path-fragment'
  if (/\.(zip|log|json|png|jpe?g|tgz|tar|gz)$/i.test(value)) return 'file-name'
  if (/^[A-Z0-9-]{4,}$/.test(value)) return 'not-a-name'
  if (/-v?\d+\.\d+\.\d+/.test(value)) return 'version-suffixed'
  return 'upstream-module-or-absent'
}
const failingNames = probes.filter((probe) => probe?.state === 'unreadable').map((probe) => String(probe?.package ?? ''))
const nameShapes = tally(failingNames, nameShape)
const nameExamples = sorted(
  [...new Set(failingNames)].sort().reduce((out, name) => {
    const shape = nameShape(name)
    out[shape] ??= []
    if (out[shape].length < 3) out[shape].push(name)
    return out
  }, {}),
)

if (needsProfileInstalledSet.length + needsProfileRuntime.length !== needsProfile.length) {
  process.stderr.write('needs-their-profile did not split cleanly into installed-set / runtime layers\n')
  process.exit(2)
}

const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_extension_candidates.mjs',
  generated_at: stamp,
  inputs: {
    source: inputPath.replaceAll('\\', '/').split('/data/results/').pop(),
    source_sha256: digest,
    source_sha256_verified_against_sibling: signedDigest !== null,
    qa_threads: rows.length,
  },
  findings: {
    needs_their_profile: {
      total: needsProfile.length,
      answerable_from_installed_set: needsProfileInstalledSet.length,
      runtime_we_do_not_read: needsProfileRuntime.length,
      by_layer: tally(needsProfile, (row) => row?.layer ?? 'unknown'),
      why_this_split: 'admission / composition / upgrade answers depend on which packages that machine has; the engine already reads that. Runtime-layer rows are per-session traces, which `docs/adr/0009-agent-scope-reads.md` A decided not to read.',
    },
    probe_unreadable: {
      total: probeUnreadable.length,
      probes: probes.length,
      by_state: probeStates,
      by_reason: probeReasons,
      by_name_shape: nameShapes,
      name_examples: nameExamples,
      threads_without_a_single_measured_probe: threadsWithNoMeasuredProbe,
      why_this_matters:
        'Every probe behind this tier failed the same way — the name is not a package. Registry fallback cannot answer a name that does not exist, and probe isolation would install nothing. This is extraction precision, not coverage.',
    },
    not_relevant: {
      total: notRelevant.length,
      by_layer: tally(notRelevant, (row) => row?.layer ?? 'unknown'),
      threads_with_signals: notRelevant.filter((row) => (row?.signals ?? []).length > 0).length,
      threads_with_packages: notRelevant.filter((row) => Array.isArray(row?.packages) && row.packages.length > 0).length,
      what_the_label_means:
        'this tier is assigned when the keyword classifier matches nothing. It is a statement about the classifier, not about the thread: any claim that these 950 are "runtime / usage / methodology" is an inference this artifact does not contain.',
    },
    crossed_thresholds: {
      needs_profile_installed_set_is_the_only_large_candidate: needsProfileInstalledSet.length > 100,
    },
  },
  tiers: {
    'names-a-denial': describe('names-a-denial'),
    'rules-out-declaration': describe('rules-out-declaration'),
    'declares-nothing': describe('declares-nothing'),
    'upstream-only': describe('upstream-only'),
    'probe-unreadable': describe('probe-unreadable'),
    'needs-their-profile': describe('needs-their-profile'),
    'not-relevant': describe('not-relevant'),
  },
  limits: [
    'this re-groups one committed artifact; it runs no classifier and reads no network',
    'the tier counts are copied through unchanged so a reader can compare them with the source artifact',
    'labels come from the v1 keyword classifier; R60 measured v2 at 12/20 on a disjoint holdout and it was not adopted',
    'manual_review.status is "pending" in the source artifact — the 9/20 + 5/5 spot check lives in its own artifact',
    'nothing here says any of these questions will be asked again, or that answering them creates demand (D5 is frozen)',
  ],
}

const text = `${JSON.stringify(artifact, null, 2)}\n`
const result = writeEvidence({ outDir, fileName: `extension-candidates-${stamp.replaceAll(':', '-')}.json`, text })
if (!result.ok) {
  process.stderr.write(`refusing to overwrite existing evidence: ${join(outDir, basename(String(result.target)))}\n`)
  process.exit(2)
}

process.stdout.write(`ssot ${result.display} sha256=${result.sha256.slice(0, 12)}…\n`)
process.stdout.write(
  `  needs-their-profile ${needsProfile.length} → installed-set ${needsProfileInstalledSet.length} · runtime ${needsProfileRuntime.length}\n`,
)
process.stdout.write(`  probe-unreadable ${probeUnreadable.length} · ${probes.length} probes · ${JSON.stringify(probeReasons)}\n`)
process.stdout.write(`  name shapes ${JSON.stringify(nameShapes)}\n`)
process.stdout.write(`  not-relevant ${notRelevant.length} · layers ${JSON.stringify(tally(notRelevant, (row) => row?.layer ?? 'unknown'))}\n`)
