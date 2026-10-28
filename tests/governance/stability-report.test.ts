/**
 * Stability report contract (`BS-32` / T-319).
 *
 * WHY: the project published "one probe takes ≈X seconds" three times and was wrong three times,
 * because a single run has no spread. These tests pin the two properties that keep the new report
 * honest: (1) every observation is kept and described as a distribution, (2) one matrix is refused
 * — "a spread of one run" is exactly the mistake the report exists to stop.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = join(repoRoot, 'scripts', 'stability_report.mjs')
const STAMP = '2026-10-28T17:00:00.000Z'

interface RunInput {
  readonly label: string
  readonly real: boolean
  readonly conclusion: 'go' | 'blocked' | 'unknown'
  readonly bootMs: number | null
  readonly waitMs?: number
}

function matrix(runs: RunInput[]) {
  return {
    schema_version: 1,
    produced_by: 'scripts/record_probe_matrix.mjs',
    generated_at: STAMP,
    plan: { path: 'tests/fixtures/probe/matrix-r19.json' },
    runs: runs.map((run) => ({
      label: run.label,
      real: run.real,
      shape: run.real ? 'real' : 'fixture',
      conclusion: run.conclusion,
      boot_to_sample_ms: run.bootMs,
      install_ms: 1000,
      artifact: {
        payload: {
          conclusion: run.conclusion,
          timings: run.bootMs === null ? {} : { bootToSampleMs: run.bootMs, bootToFinalSampleMs: (run.bootMs ?? 0) + 4000 },
          inventory: run.waitMs === undefined ? {} : { wait_ms: run.waitMs },
          cleanup: { removed: true, port_closed: true },
        },
      },
    })),
  }
}

function run(args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repoRoot, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function withTempDir<T>(body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'triage-stability-'))
  try {
    return body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writeMatrix(dir: string, name: string, runs: RunInput[]) {
  const path = join(dir, name)
  writeFileSync(path, `${JSON.stringify(matrix(runs), null, 2)}\n`, 'utf8')
  return path
}

test('the same candidate is described as a distribution, not one number', () => {
  withTempDir((dir) => {
    // The real shape this report exists for: one pinned candidate, three runs, two different
    // conclusions and a 3x spread in boot time (BS-32's mcp-connector measurements).
    const a = writeMatrix(dir, 'probe-matrix-a.json', [
      { label: 'real-mcp', real: true, conclusion: 'go', bootMs: 8000, waitMs: 6100 },
      { label: 'real-fast', real: true, conclusion: 'go', bootMs: 5000, waitMs: 2000 },
    ])
    const b = writeMatrix(dir, 'probe-matrix-b.json', [
      { label: 'real-mcp', real: true, conclusion: 'unknown', bootMs: 22500, waitMs: 16200 },
      { label: 'real-fast', real: true, conclusion: 'go', bootMs: 5200, waitMs: 2100 },
    ])
    const c = writeMatrix(dir, 'probe-matrix-c.json', [
      { label: 'real-mcp', real: true, conclusion: 'go', bootMs: 23800, waitMs: 18000 },
      { label: 'real-fast', real: true, conclusion: 'go', bootMs: 4800, waitMs: 1900 },
    ])
    const result = run(['--matrix', a, '--matrix', b, '--matrix', c, '--out', dir, '--stamp', STAMP])
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(readFileSync(join(dir, `stability-${STAMP.replaceAll(':', '-')}.json`), 'utf8'))
    assert.equal(report.produced_by, 'scripts/stability_report.mjs')
    assert.equal(report.summary.matrices, 3)
    assert.equal(report.summary.real_candidates, 2)
    assert.equal(report.summary.real_observations, 6)

    const mcp = report.candidates.find((candidate: { label: string }) => candidate.label === 'real-mcp')
    assert.equal(mcp.runs, 3)
    assert.deepEqual(mcp.verdicts, { go: 2, unknown: 1 })
    assert.equal(mcp.verdict_stable, false, 'go→unknown is a different answer, not noise')
    assert.equal(mcp.boot_to_sample_ms.min, 8000)
    assert.equal(mcp.boot_to_sample_ms.max, 23800)
    assert.equal(mcp.boot_to_sample_ms.median, 22500)
    assert.equal(mcp.boot_to_sample_ms.exceeded_budget, 2)
    assert.equal(mcp.hook_wait_ms.max, 18000, 'the hook wait is published next to the budget')

    const fast = report.candidates.find((candidate: { label: string }) => candidate.label === 'real-fast')
    assert.equal(fast.verdict_stable, true)
    assert.equal(fast.boot_to_sample_ms.exceeded_budget, 0)

    assert.deepEqual(report.summary.verdict_unstable, ['real-mcp'])
    assert.equal(existsSync(join(dir, `stability-${STAMP.replaceAll(':', '-')}.json.sha256`)), true)
  })
})

test('a single matrix is refused: one observation has no spread', () => {
  withTempDir((dir) => {
    const a = writeMatrix(dir, 'probe-matrix-a.json', [{ label: 'real-x', real: true, conclusion: 'go', bootMs: 6000 }])
    const result = run(['--matrix', a, '--out', dir, '--stamp', STAMP])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /at least 2 matrices/)
    assert.equal(existsSync(join(dir, `stability-${STAMP.replaceAll(':', '-')}.json`)), false, 'nothing is written')
  })
})

test('fixtures are described but never counted in the real aggregate', () => {
  withTempDir((dir) => {
    const runs = (boot: number): RunInput[] => [
      { label: 'real-one', real: true, conclusion: 'go', bootMs: boot },
      { label: 'fixture-slow', real: false, conclusion: 'unknown', bootMs: 21300 },
    ]
    const a = writeMatrix(dir, 'probe-matrix-a.json', runs(6000))
    const b = writeMatrix(dir, 'probe-matrix-b.json', runs(6400))
    const result = run(['--matrix', a, '--matrix', b, '--out', dir, '--stamp', STAMP])
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(readFileSync(join(dir, `stability-${STAMP.replaceAll(':', '-')}.json`), 'utf8'))
    assert.equal(report.summary.real_observations, 2, 'the fixture overrun is not in the real aggregate')
    assert.equal(report.summary.real_runs_over_budget, 0)
    const fixture = report.candidates.find((candidate: { label: string }) => candidate.label === 'fixture-slow')
    assert.equal(fixture.boot_to_sample_ms.exceeded_budget, 2, 'but it is still published per candidate')
    assert.equal(report.summary.verdict_unstable.length, 0)
  })
})

test('the report carries no gate: a spread is evidence, not a verdict', () => {
  withTempDir((dir) => {
    const runs: RunInput[] = [{ label: 'real-one', real: true, conclusion: 'go', bootMs: 6000 }]
    const a = writeMatrix(dir, 'probe-matrix-a.json', runs)
    const b = writeMatrix(dir, 'probe-matrix-b.json', runs)
    run(['--matrix', a, '--matrix', b, '--out', dir, '--stamp', STAMP])
    const report = JSON.parse(readFileSync(join(dir, `stability-${STAMP.replaceAll(':', '-')}.json`), 'utf8'))
    assert.equal(report.gate, undefined, 'gating lives in d2_report; a spread must never gate')
    assert.ok(Array.isArray(report.limits) && report.limits.length >= 3, 'the limits travel with the numbers')
    assert.match(String(report.limits.join(' ')), /convenience sample/)
  })
})
