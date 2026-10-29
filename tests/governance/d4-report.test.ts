/**
 * D4 under `ADR-0011` option A: the prior's agreement rate with the next measurement.
 *
 * WHY THIS FILE EXISTS: D4 is a decision gate that will say "not yet" for a long time, and the
 * failure mode this project fears is a denominator that shrinks until the number looks good.
 * These tests pin what makes the answer trustworthy:
 *   1. the published numbers are RECOMPUTABLE from a committed fixture library, with the same
 *      validator the store writes with (`sanitizeOutcome` via `dist/`);
 *   2. fewer than 30 pairs is REFUSED (`gate.passed: false`, `reason: insufficient-pairs`), not
 *      averaged into a percentage;
 *   3. the artifact is counts-only: no record, no `id`, no package name, no path - it is meant
 *      to be committed, and `data/results/**` is published;
 *   4. the same library + cutoff + stamp produce a BYTE-IDENTICAL artifact;
 *   5. `--strict` is the only way to judge D4 from an exit code, and it writes the artifact
 *      before it exits non-zero (the `T-317` decision, applied again).
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = join(repoRoot, 'scripts', 'd4_report.mjs')
const FIXTURE = join(repoRoot, 'tests', 'fixtures', 'outcomes', 'd4-basic.jsonl')
const CUTOFF = '2026-10-20T00:00:00.000Z'
const STAMP = '2026-10-29T10:00:00.000Z'
const ARTIFACT = `d4-${STAMP.replaceAll(':', '-')}.json`

interface D4Report {
  schema_version: number
  produced_by: string
  generated_at: string
  input_sha256: string
  input: { lines: number; valid_records: number; rejected_lines: number }
  window: { t0: string; t1: string; cutoff: string; prior_records: number; later_records: number }
  pairs: number
  hits: number
  agreement: number | null
  wilson: { level: number; low: number | null; high: number | null }
  ties: number
  keys_one_sided: number
  keys_incomplete: number
  later_disagreements: number
  threshold: { min_pairs: number; min_wilson_low: number }
  gate: { passed: boolean; reason: string | null; checks: { id: string; ok: boolean; detail: string }[] }
  limits: string[]
}

function run(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repoRoot, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function withTempDir<T>(body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'triage-d4-'))
  try {
    return body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const readReport = (dir: string): D4Report => JSON.parse(readFileSync(join(dir, ARTIFACT), 'utf8'))

/** A library of `count` agreeing pairs: one prior record and one later record per key. */
function agreeingLibrary(count: number): string {
  const lines: string[] = []
  for (let index = 0; index < count; index += 1) {
    const suffix = index.toString(16).padStart(8, '0')
    for (const [side, at, source] of [
      ['prior', '2026-10-01T00:00:00.000Z', 'check'],
      ['later', '2026-10-21T00:00:00.000Z', 'probe'],
    ] as const) {
      lines.push(
        JSON.stringify({
          schema_version: 1,
          id: `${side === 'prior' ? 'a' : 'b'}${suffix}`.padEnd(32, '0'),
          at,
          source,
          package: `dsh-d4-generated-${index}`,
          version: '1.0.0',
          dsh_version: '0.2.1-rc.4',
          os: 'win32',
          arch: 'x64',
          node_major: 24,
          profile_kind: 'web',
          conclusion: 'go',
          reason_message_ids: ['admission.admitted'],
          evidence_tiers: ['declared'],
          probe: source === 'probe' ? { total_ms_bucket: '5to20s', boot_ms_bucket: '5to20s' } : null,
        }),
      )
    }
  }
  return `${lines.join('\n')}\n`
}

test('the fixture library recomputes into the published D4 numbers', () => {
  withTempDir((dir) => {
    const result = run(['--store', FIXTURE, '--cutoff', CUTOFF, '--stamp', STAMP, '--out', dir])
    assert.equal(result.status, 0, result.stderr)
    const report = readReport(dir)

    assert.equal(report.produced_by, 'scripts/d4_report.mjs')
    assert.equal(report.generated_at, STAMP)
    assert.equal(report.schema_version, 1)
    assert.equal(report.input.lines, 19)
    assert.equal(report.input.valid_records, 19)
    assert.equal(report.input.rejected_lines, 0)
    assert.equal(report.window.t0, '2026-10-01T00:00:00.000Z')
    assert.equal(report.window.t1, '2026-10-21T06:00:00.000Z')
    assert.equal(report.window.cutoff, CUTOFF)
    assert.equal(report.window.prior_records, 12)
    assert.equal(report.window.later_records, 7)

    // Five keys appear on both sides, one prior-window key is tie-only, two are one-sided.
    assert.equal(report.pairs, 4, 'the tied key is removed from the denominator, not counted as a miss')
    assert.equal(report.hits, 3)
    assert.equal(report.agreement, 0.75)
    assert.equal(report.ties, 1)
    assert.equal(report.keys_one_sided, 2)
    assert.equal(report.keys_incomplete, 0)
    assert.equal(report.later_disagreements, 1, 'one key was measured twice in the later window with two answers')

    // Wilson 95% for 3/4, rounded to 3 decimals by the same implementation d2_report uses.
    assert.deepEqual(report.wilson, { level: 0.95, low: 0.301, high: 0.954 })

    assert.equal(report.gate.passed, false)
    assert.equal(report.gate.reason, 'insufficient-pairs')
    assert.deepEqual(
      report.gate.checks.map((check) => [check.id, check.ok]),
      [
        ['min-pairs', false],
        ['wilson-low', false],
      ],
    )
    assert.match(report.gate.checks[0]?.detail ?? '', /4 paired key\(s\), need 30/)

    // The input hash is the sha256 of the library bytes, so a reader can re-derive it.
    const expected = createHash('sha256').update(readFileSync(FIXTURE)).digest('hex')
    assert.equal(report.input_sha256, expected)

    // The sha256 sidecar matches the bytes on disk.
    const bytes = readFileSync(join(dir, ARTIFACT), 'utf8')
    assert.equal(readFileSync(`${join(dir, ARTIFACT)}.sha256`, 'utf8'), createHash('sha256').update(bytes).digest('hex'))
  })
})

test('the artifact is counts-only: no record, no id, no package name, no path', () => {
  withTempDir((dir) => {
    run(['--store', FIXTURE, '--cutoff', CUTOFF, '--stamp', STAMP, '--out', dir])
    const text = readFileSync(join(dir, ARTIFACT), 'utf8')
    const report = readReport(dir)

    // An `id` is local bookkeeping that must never reach the repository (spec §3.1). The gate
    // `outcome-privacy` looks for the VALUE shape, and so do we: `"id": "min-pairs"` is a check
    // name, `"id": "<32 hex>"` is a leaked record identifier.
    assert.doesNotMatch(text, /"id"\s*:\s*"[0-9a-f]{32}"/)
    assert.doesNotMatch(text, /\b[0-9a-f]{32}\b/, 'no 32-hex id may survive into the artifact')
    // The fixture's package names identify exactly what the operator judged.
    assert.doesNotMatch(text, /dsh-d4-fixture/)
    // No paths, no home directories.
    assert.doesNotMatch(text, /[A-Za-z]:[\\/]/)
    assert.doesNotMatch(text, /\/Users\/|\/home\//)

    // The field table from spec §13 / ADR 0011 §4.2, nothing more and nothing less.
    assert.deepEqual(Object.keys(report).sort(), [
      'agreement',
      'criterion',
      'gate',
      'generated_at',
      'hits',
      'input',
      'input_sha256',
      'keys_incomplete',
      'keys_one_sided',
      'later_disagreements',
      'limits',
      'pairs',
      'produced_by',
      'schema_version',
      'threshold',
      'ties',
      'wilson',
      'window',
    ])
    assert.ok(report.limits.length >= 4)
    assert.ok(
      report.limits.some((limit) => /insufficient-pairs means REFUSED/.test(limit)),
      'the "not judged" case must be stated in the artifact itself',
    )
  })
})

test('--strict refuses below 30 pairs, but only after the evidence is written', () => {
  withTempDir((dir) => {
    const result = run(['--store', FIXTURE, '--cutoff', CUTOFF, '--stamp', STAMP, '--out', dir, '--strict'])
    assert.equal(result.status, 1, 'automation asked for an exit code, so it gets one')
    assert.ok(existsSync(join(dir, ARTIFACT)), 'the artifact is written before the non-zero exit')
    assert.ok(existsSync(`${join(dir, ARTIFACT)}.sha256`))
    assert.match(result.stdout, /strict → exit 1/)
    assert.equal(readReport(dir).gate.reason, 'insufficient-pairs')
  })
})

test('with 30 agreeing pairs the gate passes, so the positive path is not dead', () => {
  withTempDir((dir) => {
    const library = join(dir, 'outcomes.jsonl')
    writeFileSync(library, agreeingLibrary(30), 'utf8')
    const result = run(['--store', library, '--cutoff', CUTOFF, '--stamp', STAMP, '--out', dir, '--strict'])
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
    const report = readReport(dir)
    assert.equal(report.pairs, 30)
    assert.equal(report.hits, 30)
    assert.equal(report.agreement, 1)
    assert.equal(report.wilson.low, 0.886)
    assert.equal(report.gate.passed, true)
    assert.equal(report.gate.reason, null)
  })
})

test('29 pairs is still refused: the threshold is a refusal, not a rounding', () => {
  withTempDir((dir) => {
    const library = join(dir, 'outcomes.jsonl')
    writeFileSync(library, agreeingLibrary(29), 'utf8')
    run(['--store', library, '--cutoff', CUTOFF, '--stamp', STAMP, '--out', dir])
    const report = readReport(dir)
    assert.equal(report.pairs, 29)
    assert.equal(report.agreement, 1, 'a perfect rate alone is not enough')
    assert.equal(report.gate.passed, false)
    assert.equal(report.gate.reason, 'insufficient-pairs')
  })
})

test('an incomplete key does not become a tie: it never matches a prior at all', () => {
  withTempDir((dir) => {
    const base = JSON.parse(
      readFileSync(FIXTURE, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')[0] as string,
    ) as Record<string, unknown>
    // `dsh_version: null` is a legal record (the runtime could not be read) but an unusable key.
    const incomplete = { ...base, id: 'c'.repeat(32), dsh_version: null }
    const later = { ...base, id: 'd'.repeat(32), at: '2026-10-21T00:00:00.000Z', dsh_version: null }
    const library = join(dir, 'outcomes.jsonl')
    writeFileSync(library, `${JSON.stringify(incomplete)}\n${JSON.stringify(later)}\n`, 'utf8')
    run(['--store', library, '--cutoff', CUTOFF, '--stamp', STAMP, '--out', dir])
    const report = readReport(dir)
    assert.equal(report.keys_incomplete, 1)
    assert.equal(report.ties, 0)
    assert.equal(report.pairs, 0)
    assert.equal(report.gate.passed, false)
  })
})

test('a corrupted line is counted and dropped, not repaired into a pair', () => {
  withTempDir((dir) => {
    const library = join(dir, 'outcomes.jsonl')
    const good = readFileSync(FIXTURE, 'utf8')
    writeFileSync(library, `${good}{"schema_version":1,"profileDir":"C:\\\\Users\\\\x"}\n`, 'utf8')
    const result = run(['--store', library, '--cutoff', CUTOFF, '--stamp', STAMP, '--out', dir])
    assert.equal(result.status, 0, result.stderr)
    const report = readReport(dir)
    assert.equal(report.input.rejected_lines, 1)
    assert.equal(report.input.valid_records, 19, 'the valid lines are unaffected')
    assert.equal(report.pairs, 4)
  })
})

test('the same library, cutoff and stamp produce a byte-identical artifact', () => {
  withTempDir((left) => {
    withTempDir((right) => {
      run(['--store', FIXTURE, '--cutoff', CUTOFF, '--stamp', STAMP, '--out', left])
      run(['--store', FIXTURE, '--cutoff', CUTOFF, '--stamp', STAMP, '--out', right])
      assert.equal(readFileSync(join(left, ARTIFACT), 'utf8'), readFileSync(join(right, ARTIFACT), 'utf8'))
    })
  })
})

test('a missing library is an infrastructure error (exit 3), not a zero-pair finding', () => {
  withTempDir((dir) => {
    const result = run(['--store', join(dir, 'nope'), '--cutoff', CUTOFF, '--stamp', STAMP, '--out', dir])
    assert.equal(result.status, 3)
    assert.match(result.stderr, /no outcome library/)
    assert.equal(existsSync(join(dir, ARTIFACT)), false, 'nothing recorded means no artifact, not an empty one')
  })
})

test('bad arguments are refused before anything is written', () => {
  withTempDir((dir) => {
    assert.equal(run(['--store', FIXTURE, '--stamp', STAMP, '--out', dir]).status, 2, 'cutoff is required')
    assert.equal(run(['--store', FIXTURE, '--cutoff', CUTOFF, '--out', dir]).status, 2, 'stamp is required')
    assert.equal(run(['--cutoff', CUTOFF, '--stamp', STAMP, '--out', dir]).status, 2, 'store is required')
    assert.equal(run(['--store', FIXTURE, '--cutoff', '2026-10-20', '--stamp', STAMP, '--out', dir]).status, 2, 'cutoff needs milliseconds')
  })
})
