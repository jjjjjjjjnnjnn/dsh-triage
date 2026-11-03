#!/usr/bin/env node
/**
 * "When must the next market baseline run so that no D5 window day becomes unmeasurable?" (R76)
 *
 * WHY: the handover told the next agent to re-run the baseline "before 11-08, otherwise the window's first
 * 7 days are permanently missing". Measured against the two live baselines in `data/results/`, both halves
 * of that sentence were wrong:
 *
 *   - npm's `last-week` publishes with a **2-day lag**: the 10-31 run covers `..10-29`, the 11-03 run covers
 *     `..11-01`. So a "before 11-08" run on 11-07 would publish `10-30..11-05` and leave **11-06** out;
 *   - a single run does not have to carry all 7 days. Runs ≤7 days apart chain: `11-03` (…11-01) + `11-10`
 *     (11-02..11-08) cover the first week with no hole, on a day the old prose called too late.
 *
 * A date a human has to remember is the failure mode this repository already paid for once (`T-839`: the
 * release watcher that only looked at its own `--out`). This script makes the date arithmetic instead, and
 * says which days are already out of reach.
 *
 * WHAT IT IS NOT: it is not the D5 verdict. `scripts/record_d5_evidence.mjs` still reads ONE baseline for
 * the download number, and the three thresholds stay frozen. Coverage answers a narrower question — "if the
 * window closed tomorrow, could I still describe its daily series?" — which is auditable but never a pass.
 *
 * EXIT CODES: 0 slack left (or everything covered) · 1 the deadline is `--urgent-within-days` away, today,
 *             or a day is already `lost` · 2 bad usage / could not read the window or the baselines.
 *
 *   node scripts/d5_window_status.mjs
 *   node scripts/d5_window_status.mjs --today 2026-11-09 --baseline-dir %TEMP%\probe --out %TEMP%\probe
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'

import { D5_WINDOW_DAYS } from './lib/d5-score.mjs'
import { dayToNumber, judgeWindowCoverage, numberToDay } from './lib/d5-window-coverage.mjs'
import { writeEvidence } from './lib/evidence.mjs'
import { abs, isoStamp } from './lib/kit.mjs'
import { parseInstant } from './lib/posting.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))
const fromFlag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-11-06T10:00:00.000Z\n`)
  process.exit(2)
}
const outDir = pathFor(String(argOf('--out', 'data/results')))
const baselineDir = pathFor(String(argOf('--baseline-dir', 'data/results')))
const evidenceDir = pathFor(String(argOf('--evidence-dir', 'data/results')))
const registryPath = pathFor(String(argOf('--registry', 'docs/distribution/T-810/registry.json')))
const lagDays = fromFlag('--lag-days')
const urgentWithinDays = fromFlag('--urgent-within-days')
const jsonOnly = argv.includes('--json')

/**
 * The window start — and WHICH post defines it.
 *
 * This bit the first draft: the registry holds several `posted` entries (the GitHub discussion from 11-01 and
 * the X thread from 11-02), so "take the newest posted date" silently moved the D5 window a day later and
 * shifted every deadline with it. D5 counts from ONE sample, and `docs/distribution/channels.json` allows
 * exactly one channel to set `d5_counts: true`. So the window start is read from the D5 chain itself:
 *
 *   1. `--posted-on` (explicit always wins, and the artifact says so);
 *   2. otherwise the newest `d5-evidence-*.json` artifact — the reading the verdict is actually computed
 *      from, and the same field `tests/governance/evidence-and-dates.test.ts` pairs with the registry (T-837);
 *   3. otherwise the registry's newest entry whose URL is a GitHub **discussion** (the X thread cannot be a
 *      D5 sample: see `channels.json`'s `why_not_counted`).
 *
 * Whatever the source, if the registry records a different instant for the same post the run stops: a window
 * start that disagrees with itself is how the R64 timezone mistake moved a 14-day window by seven hours.
 */
function readPostedOn() {
  const explicit = fromFlag('--posted-on')
  if (explicit !== undefined) {
    const instant = parseInstant(explicit)
    if (instant === null) {
      process.stderr.write(`invalid --posted-on "${explicit}": expected an ISO instant with an explicit zone\n`)
      process.exit(2)
    }
    return { postedOn: new Date(instant.epochMs).toISOString(), source: 'argument', postUrl: null, registryCheck: null }
  }

  const registry = readRegistry()
  const registryPosted = (Array.isArray(registry?.drafts) ? registry.drafts : [])
    .filter((draft) => draft !== null && typeof draft === 'object' && draft.status === 'posted')
    .map((draft) => ({
      url: typeof draft.posted_url === 'string' ? draft.posted_url : null,
      instant: parseInstant(draft.posted_on),
    }))
    .filter((entry) => entry.instant !== null)

  const evidence = readNewestD5Evidence()
  if (evidence !== null) {
    const instant = parseInstant(evidence.postedOn)
    if (instant === null) {
      process.stderr.write(`the newest D5 artifact carries an unreadable window start "${String(evidence.postedOn)}"\n`)
      process.exit(2)
    }
    const matching = registryPosted.find((entry) => entry.url !== null && entry.url === evidence.postUrl) ?? null
    let registryCheck = 'no-registry-entry'
    if (matching !== null) {
      registryCheck = matching.instant?.epochMs === instant.epochMs ? 'same-instant' : 'different-instant'
      if (registryCheck === 'different-instant') {
        process.stderr.write(
          `window start disagrees: the D5 artifact says ${evidence.postedOn}, the registry says ${String(matching.instant?.canonical)}\n` +
            '  (one post, two hand-written dates — fix the registry before reading a deadline off it)\n',
        )
        process.exit(2)
      }
    }
    return { postedOn: new Date(instant.epochMs).toISOString(), source: 'd5-evidence', postUrl: evidence.postUrl, registryCheck }
  }

  const discussion = registryPosted
    .filter((entry) => entry.url !== null && /^https:\/\/github\.com\/[^/]+\/[^/]+\/discussions\/\d+$/.test(entry.url))
    .sort((a, b) => (b.instant?.epochMs ?? 0) - (a.instant?.epochMs ?? 0))
  if (discussion.length === 0) {
    process.stderr.write(
      'no D5 sample found: no d5-evidence artifact, and the registry has no `posted` discussion entry\n' +
        '  (pass --posted-on, or point --registry at the distribution registry)\n',
    )
    process.exit(2)
  }
  return {
    postedOn: new Date(discussion[0].instant?.epochMs ?? 0).toISOString(),
    source: 'registry-discussion',
    postUrl: discussion[0].url,
    registryCheck: 'self',
  }
}

function readRegistry() {
  if (!existsSync(registryPath)) return null
  try {
    return JSON.parse(readFileSync(registryPath, 'utf8'))
  } catch (error) {
    process.stderr.write(`cannot parse ${basename(registryPath)}: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
}

/** The newest `d5-evidence-*.json` in `--evidence-dir`: the reading of record for the verdict. */
function readNewestD5Evidence() {
  if (!existsSync(evidenceDir)) return null
  const files = readdirSync(evidenceDir)
    .filter((name) => /^d5-evidence-.*\.json$/.test(name))
    .sort()
  const newest = files[files.length - 1]
  if (newest === undefined) return null
  try {
    const payload = JSON.parse(readFileSync(join(evidenceDir, newest), 'utf8'))
    return {
      file: newest,
      postUrl: typeof payload?.post?.url === 'string' ? payload.post.url : null,
      postedOn: payload?.window?.posted_on ?? null,
    }
  } catch {
    process.stderr.write(`cannot parse ${newest}: it claims to be a D5 reading\n`)
    process.exit(2)
  }
}

const posted = readPostedOn()
const postedDay = dayToNumber(String(posted.postedOn).slice(0, 10))
if (postedDay === null) {
  process.stderr.write(`cannot read the window start "${posted.postedOn}"\n`)
  process.exit(2)
}
const windowStart = numberToDay(postedDay)
const windowEnd = numberToDay(postedDay + D5_WINDOW_DAYS)

/**
 * Which day is "today". The clock is the default; `--today` exists so a backdated run can be reproduced,
 * and the artifact records which one was used — a rehearsal must never look like a live reading
 * (`inputs.today_source`).
 */
const todayFlag = fromFlag('--today')
const todayRaw = todayFlag === undefined ? new Date().toISOString().slice(0, 10) : todayFlag
if (dayToNumber(todayRaw) === null) {
  process.stderr.write(`invalid --today "${todayRaw}": expected YYYY-MM-DD\n`)
  process.exit(2)
}

/** Every `market-baseline-*.json` in the directory, reduced to what coverage may read. */
function readBaselines() {
  if (!existsSync(baselineDir)) {
    process.stderr.write(`--baseline-dir does not exist: ${baselineDir}\n`)
    process.exit(2)
  }
  const files = readdirSync(baselineDir).filter((name) => /^market-baseline-.*\.json$/.test(name)).sort()
  const baselines = []
  const lagObserved = []
  for (const name of files) {
    let payload
    try {
      payload = JSON.parse(readFileSync(join(baselineDir, name), 'utf8'))
    } catch {
      baselines.push({ file: name, kind: 'unproven', from: null, to: null, note: 'unreadable' })
      continue
    }
    const window = payload?.packages?.['dsh-triage']?.window ?? null
    const from = typeof window?.from === 'string' ? window.from : null
    const to = typeof window?.to === 'string' ? window.to : null
    const offline = payload?.inputs?.offline
    const kind = offline === false ? 'measured' : offline === true ? 'recompute' : 'unproven'
    // How stale the published window actually is on this artifact's own clock — the number the module
    // documents. Kept per artifact so a change at npm shows up in the output, not in a silent assumption.
    const generatedDay = typeof payload?.generated_at === 'string' ? dayToNumber(payload.generated_at.slice(0, 10)) : null
    const publishedDay = to === null ? null : dayToNumber(to)
    if (kind === 'measured' && generatedDay !== null && publishedDay !== null) {
      lagObserved.push(generatedDay - publishedDay)
    }
    baselines.push({ file: name, kind, from, to })
  }
  return { baselines, lagObserved }
}

const read = readBaselines()
const coverage = judgeWindowCoverage({
  windowStart,
  windowEnd,
  today: todayRaw,
  lagDays: lagDays === undefined ? undefined : Number(lagDays),
  urgentWithinDays: urgentWithinDays === undefined ? undefined : Number(urgentWithinDays),
  baselines: read.baselines,
})
if (coverage.ok !== true) {
  process.stderr.write(`cannot judge coverage: ${String(coverage.reason)}\n`)
  process.exit(2)
}

/** Compact `2026-11-01..2026-11-05, 2026-11-08` instead of fifteen lines. */
function ranges(days) {
  const list = Array.isArray(days) ? days.map(dayToNumber).filter((day) => day !== null).sort((a, b) => a - b) : []
  if (list.length === 0) return '(none)'
  const parts = []
  let start = list[0]
  let previous = list[0]
  for (const day of list.slice(1)) {
    if (day === previous + 1) {
      previous = day
      continue
    }
    parts.push(start === previous ? numberToDay(start) : `${numberToDay(start)}..${numberToDay(previous)}`)
    start = day
    previous = day
  }
  parts.push(start === previous ? numberToDay(start) : `${numberToDay(start)}..${numberToDay(previous)}`)
  return parts.join(', ')
}

const exitCode = coverage.urgent === true ? 1 : 0
const artifact = {
  schema_version: 1,
  produced_by: 'scripts/d5_window_status.mjs',
  generated_at: stamp,
  inputs: {
    post_url: posted.postUrl,
    posted_on: posted.postedOn,
    posted_on_source: posted.source,
    post_agrees_with_registry: posted.registryCheck,
    window_start: coverage.window?.from ?? null,
    window_end: coverage.window?.to ?? null,
    today: coverage.today ?? null,
    today_source: todayFlag === undefined ? 'clock' : 'argument',
    lag_days: coverage.lag_days ?? null,
    lag_days_source: lagDays === undefined ? 'measured-default' : 'argument',
    lag_observed: [...new Set(read.lagObserved)].sort((a, b) => a - b),
    urgent_within_days: urgentWithinDays === undefined ? 1 : Number(urgentWithinDays),
    baseline_dir: describeDir(baselineDir),
    baselines_seen: read.baselines.length,
  },
  coverage: {
    verdict: coverage.verdict,
    urgent: coverage.urgent,
    window: coverage.window,
    covered: coverage.covered,
    missing: coverage.missing,
    counts: coverage.counts,
    next_run_by: coverage.next_run_by,
    days_until_next_run: coverage.days_until_next_run,
    baselines_used: coverage.used,
    baselines_ignored: coverage.ignored,
  },
  claims: [
    {
      id: 'window-days-still-measurable',
      statement: `${coverage.counts?.covered} of ${coverage.window?.days} D5 window days are already measured, ${coverage.counts?.missing} are missing (${coverage.counts?.collectible_now} collectible now, ${coverage.counts?.upcoming} not published yet, ${coverage.counts?.lost} lost)`,
      recompute: 'coverage.counts / coverage.covered / coverage.missing',
    },
    {
      id: 'next-baseline-run-deadline',
      statement:
        coverage.next_run_by === null
          ? 'nothing left to collect: every window day is covered'
          : `the next market baseline must run on or before ${String(coverage.next_run_by)} (${String(coverage.days_until_next_run)} day(s) of slack), or the earliest missing day can no longer be measured`,
      recompute: 'coverage.next_run_by / coverage.days_until_next_run',
    },
  ],
  limits: [
    'coverage is a statement about days that have a rolling-window reading, not about demand: the D5 verdict still reads ONE baseline (scripts/lib/d5-score.mjs), and its three thresholds are frozen',
    'days are UTC calendar days. The D5 window opens at a wall-clock instant (20:24:37Z), so the first and last day are only partly inside it — a day counts as covered when npm published a bucket for it, not when every hour was in the window',
    'the publish lag is a measured property of api.npmjs.org/downloads/range, not a promise: three reads on 2026-11-03 saw **1 and 2** days (the previous day lands at some point mid-day). `lag_days: 2` is the conservative default — every deadline is then at most one day early, never late — and this artifact records what was observed (`lag_observed`) rather than trusting the constant',
    'only artifacts that prove a live collection (`inputs.offline === false`) count as coverage. A `--fixtures` recompute re-derives a window; it does not prove anyone collected it (R72 / T-841)',
    'a past day reported as `lost` is a fact about our sampling, never evidence that the product had no demand',
    'this script reads the disk only: it does not refresh the baseline, does not read npm, and does not write a D5 verdict',
  ],
}

if (!jsonOnly) {
  const counts = coverage.counts
  const observed = [...new Set(read.lagObserved)].sort((a, b) => a - b)
  const lagDisagrees = observed.length > 0 && !observed.includes(Number(coverage.lag_days))
  process.stdout.write(
    `D5 window ${String(coverage.window?.from)} .. ${String(coverage.window?.to)} (${String(coverage.window?.days)} days)\n` +
      `  sample        ${String(posted.postUrl ?? '(none named)')} · starts ${String(posted.postedOn)} (from ${String(posted.source)})\n` +
      `  covered       ${String(counts?.covered)} day(s): ${ranges(coverage.covered)}\n` +
      `  missing       ${String(counts?.missing)} day(s) — collectible now ${String(counts?.collectible_now)} · not published yet ${String(counts?.upcoming)} · lost ${String(counts?.lost)}\n` +
      `  baselines     used ${String(coverage.used?.length)} · ignored ${String(coverage.ignored?.length)} (only live collections count)\n` +
      `  publish lag   ${String(coverage.lag_days)} day(s) assumed · observed ${observed.length === 0 ? '(none)' : observed.join('/')}\n` +
      (coverage.next_run_by === null
        ? '  next run      not needed\n'
        : `  next run by   ${String(coverage.next_run_by)} (${String(coverage.days_until_next_run)} day(s) of slack)\n`) +
      `verdict: ${String(coverage.verdict)}${coverage.urgent === true ? ' — deadline is here, run the baseline now' : ''}\n`,
  )
  if (lagDisagrees) {
    process.stderr.write(
      `warning: the committed baselines publish ${observed.join('/')} day(s) behind their own clock, but ${String(coverage.lag_days)} was used\n` +
        '  the deadline above is only as right as that number — re-run with --lag-days once you know which it is\n',
    )
  }
}

const written = writeEvidence({
  outDir,
  fileName: `d5-window-status-${stamp.replaceAll(':', '-')}.json`,
  text: `${JSON.stringify(artifact, null, 2)}\n`,
})
if (written.ok !== true) {
  process.stderr.write(`refusing to overwrite ${written.target}\n`)
  process.exit(2)
}
process.stdout.write(`ssot ${written.display} (${written.sha256.slice(0, 12)}…)\n`)
process.exit(exitCode)

/** Absolute paths are for humans at a terminal; an artifact is published, so it only says where it looked. */
function describeDir(dir) {
  const rel = relative(abs('.'), dir)
  return rel === '' ? '.' : rel.startsWith('..') || isAbsolute(rel) ? '(external)' : rel.replaceAll('\\', '/')
}
