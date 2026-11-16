/**
 * The D5 deadline must be a computed number in all three entry documents (R76).
 *
 * WHY: the handover told the next agent to re-run the baseline "before 11-08", justified by "npm's rolling
 * 7 days means the first week is permanently missing afterwards". Both halves were wrong (the publish lag is
 * 2 days, and runs ≤7 days apart chain), and the sentence existed in `AGENTS.md`, `INDEX.md` and
 * `docs/HANDOFF.md` — three copies that nobody re-derives. Three hand-maintained dates for one event is the
 * same shape as T-837 (two dates for the window start), and the fix there was to compare them, not to
 * proofread harder.
 *
 * HOW THIS LOCKS IT: the deadline is recomputed from the committed artifacts alone — window start from the
 * D5 reading of record, coverage from the baselines that prove a live collection — with "today" pinned to
 * the newest measurement, so the assertion is deterministic on a clean checkout and does not depend on the
 * wall clock. Then every entry document must contain that date. When a new baseline is committed the date
 * moves, this goes red, and the documents have to follow.
 *
 * WHAT IT DOES NOT DO: it does not check prose quality, and it does not require the deadline to be far away —
 * a deadline that has already passed is reported by `scripts/d5_window_status.mjs` (exit 1), not here.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

import { dayToNumber, judgeWindowCoverage } from '../../scripts/lib/d5-window-coverage.mjs'
import { D5_WINDOW_DAYS } from '../../scripts/lib/d5-score.mjs'

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
const readJson = (path: string) => JSON.parse(read(path))
const listResults = () => readdirSync(new URL('data/results/', root)).sort()

type Baseline = {
  file: string
  kind: 'measured' | 'recompute' | 'unproven'
  from: string | null
  to: string | null
  generated_at: string | null
}

function baselines(): Baseline[] {
  return listResults()
    .filter((name) => /^market-baseline-.*\.json$/.test(name))
    .map((name) => {
      const payload = readJson(`data/results/${name}`) as {
        generated_at?: string
        inputs?: { offline?: boolean }
        packages?: Record<string, { window?: { from?: string, to?: string } }>
      }
      const window = payload.packages?.['dsh-triage']?.window ?? {}
      const offline = payload.inputs?.offline
      return {
        file: name,
        kind: offline === false ? 'measured' : offline === true ? 'recompute' : 'unproven',
        from: window.from ?? null,
        to: window.to ?? null,
        generated_at: payload.generated_at ?? null,
      }
    })
}

function currentWindow(): {
  windowStart: string
  windowEnd: string
  today: string
  rows: Baseline[]
  result: ReturnType<typeof judgeWindowCoverage>
} {
  const evidence = listResults().filter((name) => /^d5-evidence-.*\.json$/.test(name))
  assert.ok(evidence.length > 0, 'expected at least one d5-evidence artifact to define the window start')
  const newest = readJson(`data/results/${evidence[evidence.length - 1]}`) as {
    window?: { posted_on?: string | null }
  }
  const postedOn = newest.window?.posted_on ?? null
  assert.ok(typeof postedOn === 'string' && postedOn.length > 0, 'the D5 reading of record must carry a window start')

  const start = dayToNumber(postedOn.slice(0, 10))
  assert.ok(start !== null, `unreadable window start ${postedOn}`)
  const windowStart = postedOn.slice(0, 10)
  const windowEnd = new Date((start + D5_WINDOW_DAYS) * 86_400_000).toISOString().slice(0, 10)

  const rows = baselines()
  const measuredDays = rows
    .filter((row) => row.kind === 'measured' && typeof row.generated_at === 'string')
    .map((row) => dayToNumber(row.generated_at!.slice(0, 10)))
    .filter((day): day is number => day !== null)
  assert.ok(measuredDays.length > 0, 'expected at least one baseline that proves a live collection')
  // "Today" is pinned to the newest measurement: deterministic on a clean checkout, and it is the newest
  // state of the world anyone could have known.
  const today = new Date(Math.max(...measuredDays) * 86_400_000).toISOString().slice(0, 10)

  return { windowStart, windowEnd, today, rows, result: judgeWindowCoverage({ windowStart, windowEnd, today, baselines: rows }) }
}

test('R76: all three entry documents carry the deadline the committed artifacts imply', () => {
  const { windowStart, windowEnd, result } = currentWindow()

  /*
   * R113: the window closes on 2026-11-15, and "a deadline while the window is open" stops existing
   * the moment it closes. Asking for one then would either force a fake date or teach the reader to
   * ignore the test. So the assertion follows the state instead of pretending:
   *
   *   - window still open  → the deadline must exist and appear in all three documents (unchanged);
   *   - window now closed  → what must exist is the JUDGEMENT: a terminal verdict on record, and the
   *                          three documents must say it is judged. Deleting the verdict is red.
   *
   * This tightens nothing and loosens nothing about D5 itself: the three numbers and the 10/1/20
   * thresholds live in `scripts/lib/d5-score.mjs` and were not touched.
   */
  const closed = d5IsClosed()

  if (!closed) {
    assert.equal(result.ok, true, `coverage could not be judged: ${String(result.reason)}`)
    assert.equal(result.verdict === 'lost', false, 'a D5 window day can no longer be measured — see scripts/d5_window_status.mjs')
    const deadline = result.next_run_by
    assert.ok(typeof deadline === 'string', 'there must still be a deadline while the window is open')
    for (const file of ['AGENTS.md', 'INDEX.md', 'docs/HANDOFF.md']) {
      assert.ok(
        read(file).includes(deadline as string),
        `${file} does not state the computed deadline ${String(deadline)} (window ${windowStart}..${windowEnd}, ${String(result.counts?.missing)} day(s) unmeasured)`,
      )
    }
    return
  }

  const verdict = d5VerdictOfRecord()
  assert.ok(
    ['pass', 'fail', 'unmeasurable'].includes(String(verdict)),
    `the window is closed, so the D5 reading of record must carry a terminal verdict; it says ${String(verdict)}`,
  )
  for (const file of ['AGENTS.md', 'INDEX.md', 'docs/HANDOFF.md']) {
    assert.ok(
      read(file).includes('D5 已判定'),
      `${file} still reads as if D5 were undecided — the window closed on ${windowEnd} and the verdict is ${verdict}`,
    )
  }
})

function newestEvidence(): { verdict: string | null, closed: boolean } {
  const evidence = listResults().filter((name) => /^d5-evidence-.*\.json$/.test(name))
  assert.ok(evidence.length > 0, 'expected at least one d5-evidence artifact')
  const payload = readJson(`data/results/${evidence[evidence.length - 1]}`) as {
    d5_verdict?: string
    window?: { closed?: boolean }
  }
  return { verdict: payload.d5_verdict ?? null, closed: payload.window?.closed === true }
}

const d5IsClosed = () => newestEvidence().closed
const d5VerdictOfRecord = () => newestEvidence().verdict

test('R76: the recorded status artifact agrees with the artifacts it was derived from', () => {
  const status = listResults().filter((name) => /^d5-window-status-.*\.json$/.test(name))
  assert.ok(status.length > 0, 'expected at least one d5-window-status artifact (node scripts/d5_window_status.mjs)')
  const newest = readJson(`data/results/${status[status.length - 1]}`) as {
    produced_by?: string
    inputs?: { posted_on_source?: string, lag_observed?: number[] }
    coverage?: { verdict?: string, next_run_by?: string | null, window?: { from?: string, to?: string } }
  }
  assert.equal(newest.produced_by, 'scripts/d5_window_status.mjs')
  // The window start must come from the D5 chain, never from "the newest posted date" (the X thread moved it
  // a day on the first draft).
  assert.equal(newest.inputs?.posted_on_source, 'd5-evidence')
  // The publish lag is a measurement; a live artifact must show it was seen, not assumed.
  assert.ok(
    Array.isArray(newest.inputs?.lag_observed) && newest.inputs.lag_observed.length > 0,
    'lag_observed must record what the baselines showed',
  )

  const { result, windowStart, windowEnd } = currentWindow()

  /*
   * R113: `next_run_by` answers "when must the next baseline run" — a question that stops existing
   * once the window has closed (the artifact recorded this morning predates that boundary, so it
   * still carries a date). What must agree after the close is the thing the judgement rests on:
   * the window itself, and that the artifact says it was derived from the D5 chain.
   */
  if (d5IsClosed()) {
    assert.equal(newest.coverage?.window?.from ?? null, windowStart)
    assert.equal(newest.coverage?.window?.to ?? null, windowEnd)
  } else if (result.verdict !== 'lost') {
    assert.equal(newest.coverage?.next_run_by ?? null, result.next_run_by ?? null)
  }
})
