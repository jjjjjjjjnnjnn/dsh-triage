/**
 * D2 sample-report contract test.
 *
 * WHY: D2 is a decision gate that may currently say "not yet", and the failure mode this
 * project fears most is a denominator that shrinks until the rate looks good. These tests pin
 * the four properties that make the number trustworthy:
 *   1. the published numbers are recomputable from a recorded matrix artifact;
 *   2. a batch with too few real runs is REFUSED (gate.passed=false), not averaged;
 *   3. an unclean sandbox fails the gate even when every verdict is go;
 *   4. info reasons are evidence, not failure shapes — counting them inflates the shape count.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = join(repoRoot, 'scripts', 'd2_report.mjs')
const STAMP = '2026-10-27T21:00:00.000Z'
const REAL_MATRIX = 'data/results/probe-matrix-2026-10-27T20-30-00.000Z.json'

interface RunInput {
  readonly label: string
  readonly real: boolean
  readonly conclusion: 'go' | 'blocked' | 'unknown'
  readonly bootMs?: number | null
  readonly cleanupOk?: boolean
  readonly reasons?: Array<{ severity: 'block' | 'warn' | 'info'; messageId: string; phase?: string }>
}

function matrixRun(input: RunInput) {
  return {
    label: input.label,
    shape: input.real ? 'real-registry' : 'fixture',
    real: input.real,
    conclusion: input.conclusion,
    artifact: {
      payload: {
        conclusion: input.conclusion,
        timings: { bootToSampleMs: input.bootMs === undefined ? 6800 : input.bootMs },
        cleanup: { removed: input.cleanupOk !== false, port_closed: input.cleanupOk !== false },
        reasons: (input.reasons ?? []).map((reason) => ({
          severity: reason.severity,
          messageId: reason.messageId,
          ...(reason.phase === undefined ? {} : { params: { phase: reason.phase } }),
        })),
      },
    },
  }
}

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repoRoot, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function withTempDir<T>(body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'triage-d2-'))
  try {
    return body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the published D2 numbers are recomputable from the recorded matrix', () => {
  withTempDir((dir) => {
    const result = run(['--matrix', join(repoRoot, REAL_MATRIX), '--out', dir, '--stamp', STAMP, '--json'])
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(readFileSync(join(dir, `d2-${STAMP.replaceAll(':', '-')}.json`), 'utf8'))
    assert.equal(report.produced_by, 'scripts/d2_report.mjs')
    assert.equal(report.denominator.real_runs, 10)
    assert.equal(report.denominator.enough, true)
    assert.equal(report.verdicts.go, 9)
    assert.equal(report.real_pass_rate.go, 9, 'nine of the ten real plugins composed and served')
    assert.equal(report.real_pass_rate.blocked, 1)
    assert.equal(report.cleanup.ok, report.cleanup.checked)
    assert.equal(report.failure_shapes.length, 5, 'install / row-failed / row-missing-fiber / no-row / not-settled')
    assert.equal(report.gate.passed, true)
    assert.equal(report.timing.within_budget, report.timing.sampled)
  })
})

test('a batch with too few real runs is refused instead of averaged', () => {
  withTempDir((dir) => {
    const matrix = {
      schema_version: 1,
      produced_by: 'scripts/record_probe_matrix.mjs',
      generated_at: STAMP,
      plan: { path: 'tests/fixtures/probe/small.json' },
      runs: [matrixRun({ label: 'a', real: true, conclusion: 'go' }), matrixRun({ label: 'b', real: true, conclusion: 'go' })],
    }
    const path = join(dir, 'probe-matrix-2026-10-27T20-00-00.000Z.json')
    writeFileSync(path, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8')
    const result = run(['--matrix', path, '--out', dir, '--stamp', STAMP, '--json'])
    assert.equal(result.status, 0, 'a failing gate is data, not an infrastructure error')
    const report = JSON.parse(readFileSync(join(dir, `d2-${STAMP.replaceAll(':', '-')}.json`), 'utf8'))
    assert.equal(report.gate.passed, false)
    assert.equal(report.denominator.real_runs, 2)
    assert.equal(report.denominator.enough, false)
    const check = report.gate.checks.find((item: { id: string }) => item.id === 'min-real-runs')
    assert.equal(check.ok, false)
    assert.match(check.detail, /need 10/)
  })
})

test('an unclean sandbox fails the gate even when every verdict is go', () => {
  withTempDir((dir) => {
    const runs = Array.from({ length: 10 }, (_unused, index) =>
      matrixRun({ label: `real-${index}`, real: true, conclusion: 'go', cleanupOk: index !== 3 }),
    )
    const path = join(dir, 'probe-matrix-2026-10-27T20-00-00.000Z.json')
    writeFileSync(path, `${JSON.stringify({ generated_at: STAMP, plan: { path: 'x' }, runs }, null, 2)}\n`, 'utf8')
    run(['--matrix', path, '--out', dir, '--stamp', STAMP, '--json'])
    const report = JSON.parse(readFileSync(join(dir, `d2-${STAMP.replaceAll(':', '-')}.json`), 'utf8'))
    const check = report.gate.checks.find((item: { id: string }) => item.id === 'cleanup-complete')
    assert.equal(check.ok, false)
    assert.match(check.detail, /9\/10/)
    assert.equal(report.gate.passed, false)
  })
})

test('a run over the boot budget fails the gate', () => {
  withTempDir((dir) => {
    const runs = [
      ...Array.from({ length: 9 }, (_unused, index) => matrixRun({ label: `real-${index}`, real: true, conclusion: 'go', bootMs: 7000 })),
      matrixRun({ label: 'real-slow', real: true, conclusion: 'go', bootMs: 24_000 }),
    ]
    const path = join(dir, 'probe-matrix-2026-10-27T20-00-00.000Z.json')
    writeFileSync(path, `${JSON.stringify({ generated_at: STAMP, plan: { path: 'x' }, runs }, null, 2)}\n`, 'utf8')
    run(['--matrix', path, '--out', dir, '--stamp', STAMP, '--json'])
    const report = JSON.parse(readFileSync(join(dir, `d2-${STAMP.replaceAll(':', '-')}.json`), 'utf8'))
    assert.equal(report.timing.within_budget, 9)
    assert.equal(report.gate.checks.find((item: { id: string }) => item.id === 'boot-budget').ok, false)
    assert.equal(report.gate.passed, false)
  })
})

test('info reasons are evidence, not failure shapes', () => {
  withTempDir((dir) => {
    const runs = Array.from({ length: 10 }, (_unused, index) =>
      matrixRun({
        label: `real-${index}`,
        real: true,
        conclusion: index === 0 ? 'blocked' : 'go',
        reasons:
          index === 0
            ? [
                { severity: 'block', messageId: 'probe.row-inactive', phase: 'failed' },
                // A blocked run still carries info evidence; counting it would invent a shape.
                { severity: 'info', messageId: 'probe.render-ok' },
                { severity: 'info', messageId: 'probe.served' },
              ]
            : [{ severity: 'info', messageId: 'probe.served' }],
      }),
    )
    const path = join(dir, 'probe-matrix-2026-10-27T20-00-00.000Z.json')
    writeFileSync(path, `${JSON.stringify({ generated_at: STAMP, plan: { path: 'x' }, runs }, null, 2)}\n`, 'utf8')
    run(['--matrix', path, '--out', dir, '--stamp', STAMP, '--json'])
    const report = JSON.parse(readFileSync(join(dir, `d2-${STAMP.replaceAll(':', '-')}.json`), 'utf8'))
    assert.deepEqual(
      report.failure_shapes.map((entry: { shape: string }) => entry.shape),
      ['blocked:probe.row-inactive(failed)'],
    )
    assert.equal(report.gate.checks.find((item: { id: string }) => item.id === 'failure-shapes').ok, false)
  })
})

test('unknown is a verdict for reliability but never counts toward the pass rate', () => {
  withTempDir((dir) => {
    const runs = [
      ...Array.from({ length: 9 }, (_unused, index) => matrixRun({ label: `real-${index}`, real: true, conclusion: 'go' })),
      matrixRun({ label: 'real-unknown', real: true, conclusion: 'unknown', reasons: [{ severity: 'warn', messageId: 'probe.tree-not-settled' }] }),
    ]
    const path = join(dir, 'probe-matrix-2026-10-27T20-00-00.000Z.json')
    writeFileSync(path, `${JSON.stringify({ generated_at: STAMP, plan: { path: 'x' }, runs }, null, 2)}\n`, 'utf8')
    run(['--matrix', path, '--out', dir, '--stamp', STAMP, '--json'])
    const report = JSON.parse(readFileSync(join(dir, `d2-${STAMP.replaceAll(':', '-')}.json`), 'utf8'))
    assert.equal(report.probe_reliability.rate, 1, 'an honest unknown is still a completed measurement')
    assert.equal(report.probe_reliability.unknown_runs, 1)
    assert.equal(report.real_pass_rate.decided, 9, 'unknown is not folded into go or blocked')
    assert.equal(report.real_pass_rate.rate, 1)
  })
})

test('the same matrix and stamp produce a byte-identical report', () => {
  withTempDir((left) => {
    withTempDir((right) => {
      run(['--matrix', join(repoRoot, REAL_MATRIX), '--out', left, '--stamp', STAMP])
      run(['--matrix', join(repoRoot, REAL_MATRIX), '--out', right, '--stamp', STAMP])
      const name = `d2-${STAMP.replaceAll(':', '-')}.json`
      assert.equal(readFileSync(join(left, name), 'utf8'), readFileSync(join(right, name), 'utf8'))
    })
  })
})
