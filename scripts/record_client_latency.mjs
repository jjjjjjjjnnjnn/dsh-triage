/**
 * "What does the settings tab actually cost?" — the distribution `BS-54` said was missing (R68).
 *
 * READS `data/results/client-serve-*.json` AND NOTHING ELSE. No browser, no network, no new runs: 25
 * first-screen observations and 9 route timings were already on disk, unread. The blind spot was never a
 * missing measurement, it was the absence of anyone adding them up.
 *
 * THREE SERIES, NEVER MERGED (and `scripts/lib/latency-shape.mjs` keeps them apart):
 *   - `summary.tab_ms`      the stranger's wait: settings navigation → summary on screen (browser + engine)
 *   - `upgrade.route_ms`    the four-bucket route, server side (engine only)
 *   - `upgrade.waited_ms`   how long the page waited for the four buckets before this run gave up
 *
 * Runs are grouped (`measurement` vs `negative-control`) because a control run deliberately changes one
 * thing; mixing them would let a 300ms-wait control drag the median of a 900ms experience.
 *
 *   node scripts/record_client_latency.mjs [--stamp <ISO>]
 *
 * Exit codes: 0 a report was written · 2 bad usage / nothing to read.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { abs, isoStamp } from './lib/kit.mjs'
import { writeEvidence } from './lib/evidence.mjs'
import { judgeLatency } from './lib/latency-shape.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
if (stamp === null) {
  process.stderr.write('usage: node scripts/record_client_latency.mjs --stamp <ISO> [--out <dir>]\n')
  process.exit(2)
}
const outDir = String(argOf('--out', 'data/results'))
const resultsDir = abs('data/results')

const files = readdirSync(resultsDir)
  .filter((name) => name.startsWith('client-serve-') && name.endsWith('.json'))
  .sort()

/** A negative control changes one thing on purpose, so its timings describe a different experiment. */
const groupOf = (name) => (/(^client-serve-)(nc-|negctl)/.test(name) ? 'negative-control' : 'measurement')
const stepById = (payload, id) => (Array.isArray(payload?.steps) ? payload.steps.find((step) => step?.id === id) : undefined)

const summaryValues = []
const routeValues = []
const waitedValues = []
let unreadable = 0

for (const name of files) {
  let payload
  try {
    payload = JSON.parse(readFileSync(join(resultsDir, name), 'utf8'))
  } catch {
    unreadable += 1
    continue
  }
  if (payload?.produced_by !== 'scripts/record_client_serve.mjs') continue
  const at = typeof payload.generated_at === 'string' ? payload.generated_at : null
  const group = groupOf(name)

  const visible = stepById(payload, 'visible')
  if (typeof visible?.tab_ms === 'number') summaryValues.push({ ms: visible.tab_ms, at, source: name, group })

  const route = stepById(payload, 'upgrade-route')
  if (typeof route?.ms === 'number') routeValues.push({ ms: route.ms, at, source: name, group })

  const upgrade = stepById(payload, 'upgrade-visible')
  if (typeof upgrade?.waited_ms === 'number') waitedValues.push({ ms: upgrade.waited_ms, at, source: name, group })
}

const byGroup = (values, group) => values.filter((value) => value.group === group).map(({ ms, at, source }) => ({ ms, at, source }))

const series = [
  { id: 'summary.tab_ms', kind: 'browser', group: 'measurement', values: byGroup(summaryValues, 'measurement') },
  { id: 'summary.tab_ms', kind: 'browser', group: 'negative-control', values: byGroup(summaryValues, 'negative-control') },
  { id: 'upgrade.route_ms', kind: 'engine', group: 'measurement', values: byGroup(routeValues, 'measurement') },
  { id: 'upgrade.waited_ms', kind: 'browser', group: 'measurement', values: byGroup(waitedValues, 'measurement') },
].filter((entry) => entry.values.length > 0)

if (series.length === 0) {
  process.stderr.write(`no client-serve artifact carries a timing under ${resultsDir}\n`)
  process.exit(2)
}

const verdict = judgeLatency({ series })

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_client_latency.mjs',
  generated_at: stamp,
  sources: {
    artifacts: files.length,
    unreadable,
    measurement_runs: byGroup(summaryValues, 'measurement').length,
    negative_control_runs: byGroup(summaryValues, 'negative-control').length,
  },
  series: verdict.series,
  ok: verdict.ok,
  problems: verdict.problems,
  reading: {
    /*
     * Stated as a sentence so nobody has to re-derive it, and stated with its boundary: the number is a
     * browser navigation, not an engine cost, and it is a convenience sample from one machine.
     */
    typical: verdict.series.find((entry) => entry.id === 'summary.tab_ms' && entry.group === 'measurement')?.median ?? null,
    tail: verdict.series.find((entry) => entry.id === 'summary.tab_ms' && entry.group === 'measurement')?.p90 ?? null,
    boundary: 'tab_ms includes the settings navigation and clicks; it is not the engine cost. route timings are the engine side.',
  },
  limits: [
    'one machine, one runtime (0.2.1-rc.4 sandbox), convenience sample: the runs were taken for other reasons',
    'the four slowest first-screen runs cluster in one window; machine load was not recorded, so this does not attribute the tail',
    'p90 below ten observations is flagged provisory and must not be quoted as a percentile',
    'this report adds no new measurement: it sums up runs that already existed (that was the point)',
  ],
}

const text = `${JSON.stringify(payload, null, 2)}\n`
const written = writeEvidence({ outDir, fileName: `client-latency-${stamp.replaceAll(':', '-')}.json`, text, root: abs('.') })
if (written.ok === false) {
  process.stderr.write('refusing to overwrite existing evidence\n')
  process.exit(2)
}

for (const entry of verdict.series) {
  process.stdout.write(
    `${entry.id} [${entry.group}] n=${entry.n} min=${String(entry.min)} median=${String(entry.median)} p90=${String(entry.p90)} max=${String(entry.max)}${entry.provisory ? ' (provisory)' : ''}\n`,
  )
}
if (verdict.problems.length > 0) for (const problem of verdict.problems) process.stdout.write(`  problem: ${problem}\n`)
process.stdout.write(`ssot ${written.display} sha256=${written.sha256.slice(0, 12)}…\n`)
process.exit(0)
