/**
 * D1 sample-report contract test.
 *
 * WHY: the D1 decision gate is a *number* (>=8 of >=10 real cases attribute the
 * root cause). A number that lives in prose can be rounded up by accident or on
 * purpose. This test pins three properties:
 *   1. the report is derived from `data/results/why-case-*.json`, so recounting
 *      from the artifacts reproduces the published totals;
 *   2. a re-run of one case never double-counts it (newest `generated_at` wins,
 *      the loser is listed as superseded instead of vanishing);
 *   3. an artifact whose `hit.verdict` is neither hit nor miss is refused with a
 *      non-zero exit, so a typo cannot silently become a pass.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = join(repoRoot, 'scripts', 'd1_report.mjs')
const STAMP = '2026-10-26T12:00:00.000Z'

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repoRoot, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

interface CaseArtifact {
  schema_version: number
  produced_by: string
  generated_at: string
  mode: string
  case: { id: string }
  verdicts: unknown[]
  hit: {
    verdict: string
    expected: { kind: string; module: string; requirement_key_source: string }
    matched: { subject: { name: string } } | null
    why: string
  }
}

function caseArtifact(id: string, verdict: string, generatedAt: string, conclusions: string[] = []): CaseArtifact {
  return {
    schema_version: 1,
    produced_by: 'scripts/record_case.mjs',
    generated_at: generatedAt,
    mode: 'profile',
    case: { id },
    verdicts: conclusions.map((conclusion) => ({ conclusion })),
    hit: {
      verdict,
      expected: { kind: 'row-admission', module: `@scope/${id.toLowerCase()}`, requirement_key_source: 'report-explicit' },
      matched: verdict === 'hit' ? { subject: { name: `@scope/${id.toLowerCase()}` } } : null,
      why: `${id} fixture`,
    },
  }
}

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-triage-d1-'))
}

function writeArtifact(dir: string, name: string, payload: unknown): string {
  const path = join(dir, name)
  const text = `${JSON.stringify(payload, null, 2)}\n`
  writeFileSync(path, text, 'utf8')
  return path
}

test('the published D1 totals are reproducible from the case artifacts', () => {
  const resultsDir = join(repoRoot, 'data', 'results')
  const artifacts = readdirSync(resultsDir).filter((name) => /^why-case-.+\.json$/.test(name))
  assert.ok(artifacts.length > 0, 'expected at least one recorded case')

  const newestPerCase = new Map<string, { verdict: string; generatedAt: string }>()
  for (const name of artifacts) {
    const payload = JSON.parse(readFileSync(join(resultsDir, name), 'utf8')) as {
      case: { id: string }
      generated_at: string
      hit: { verdict: string }
    }
    const previous = newestPerCase.get(payload.case.id)
    if (previous === undefined || payload.generated_at > previous.generatedAt) {
      newestPerCase.set(payload.case.id, { verdict: payload.hit.verdict, generatedAt: payload.generated_at })
    }
  }
  const hits = [...newestPerCase.values()].filter((entry) => entry.verdict === 'hit').length

  const reports = readdirSync(resultsDir).filter((name) => /^d1-.+\.json$/.test(name))
  assert.ok(reports.length > 0, 'expected a committed D1 report — run scripts/d1_report.mjs')
  const report = JSON.parse(readFileSync(join(resultsDir, reports.sort().at(-1) as string), 'utf8')) as {
    totals: { cases: number; hit: number; miss: number }
    gate: { passed: boolean; minimum_hits: number; minimum_total: number }
    cases: { id: string; verdict: string }[]
  }

  assert.equal(report.totals.cases, newestPerCase.size, 'case count must match the artifacts')
  assert.equal(report.totals.hit, hits, 'hit count must be recomputable from the artifacts')
  assert.equal(report.totals.miss, newestPerCase.size - hits)
  assert.equal(report.cases.length, newestPerCase.size, 'every case must appear exactly once')
  assert.equal(
    report.gate.passed,
    report.gate.minimum_hits <= hits && report.gate.minimum_total <= newestPerCase.size,
    'gate.passed must follow from its own thresholds and the recounted numbers',
  )
})

test('miss_kind tells a silent miss apart from an answered one (R9 / T-107)', () => {
  const dir = fixtureDir()
  try {
    // Three misses, three different degrees of honesty.
    writeArtifact(dir, 'why-case-CASE-0007-2026-10-27T00-00-00.000Z.json', caseArtifact('CASE-0007', 'miss', '2026-10-27T00:00:00.000Z'))
    writeArtifact(
      dir,
      'why-case-CASE-0008-2026-10-27T00-00-00.000Z.json',
      caseArtifact('CASE-0008', 'miss', '2026-10-27T00:00:00.000Z', ['unknown']),
    )
    writeArtifact(
      dir,
      'why-case-CASE-0009-2026-10-27T00-00-00.000Z.json',
      caseArtifact('CASE-0009', 'miss', '2026-10-27T00:00:00.000Z', ['blocked', 'go']),
    )
    writeArtifact(dir, 'why-case-CASE-0010-2026-10-27T00-00-00.000Z.json', caseArtifact('CASE-0010', 'hit', '2026-10-27T00:00:00.000Z', ['blocked']))

    const result = run(['--results', dir, '--out', dir, '--stamp', STAMP, '--min-hit', '1', '--min-total', '1'])
    assert.equal(result.status, 0, result.stderr)
    const reportName = readdirSync(dir).find((name) => name.startsWith('d1-') && name.endsWith('.json')) as string
    const report = JSON.parse(readFileSync(join(dir, reportName), 'utf8')) as {
      totals: { miss: number; miss_by_kind: Record<string, number> }
      cases: { id: string; verdict: string; miss_kind: string | null; conclusions: string[]; verdict_count: number }[]
    }
    const kindOf = (id: string) => report.cases.find((entry) => entry.id === id)?.miss_kind
    assert.equal(kindOf('CASE-0007'), 'silent', 'zero verdicts is silence, and silence must be visible as such')
    assert.equal(kindOf('CASE-0008'), 'explicit-unknown')
    assert.equal(kindOf('CASE-0009'), 'explicit-other')
    assert.equal(kindOf('CASE-0010'), null, 'a hit needs no miss classification')
    assert.deepEqual(report.totals.miss_by_kind, { 'explicit-other': 1, 'explicit-unknown': 1, silent: 1 })
    const summed = Object.values(report.totals.miss_by_kind).reduce((total, value) => total + value, 0)
    assert.equal(summed, report.totals.miss, 'the breakdown must add up to the miss count')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the committed D1 report agrees with the artifacts it claims to summarise', () => {
  const resultsDir = join(repoRoot, 'data', 'results')
  const reports = readdirSync(resultsDir).filter((name) => /^d1-.+\.json$/.test(name)).sort()
  assert.ok(reports.length > 0, 'expected a committed D1 report — run scripts/d1_report.mjs')
  const report = JSON.parse(readFileSync(join(resultsDir, reports.at(-1) as string), 'utf8')) as {
    cases: { id: string; verdict: string; miss_kind: string | null; conclusions: string[]; verdict_count: number }[]
    totals: { miss: number; miss_by_kind: Record<string, number> }
  }
  // Without this the loops below would all pass vacuously on an empty report.
  assert.ok(report.cases.length > 0, 'a committed report with zero cases proves nothing')
  for (const entry of report.cases) {
    const expected =
      entry.verdict === 'hit'
        ? null
        : entry.conclusions.includes('unknown')
          ? 'explicit-unknown'
          : entry.verdict_count === 0
            ? 'silent'
            : 'explicit-other'
    assert.equal(entry.miss_kind, expected, `${entry.id}: miss_kind must be recomputed from the artifact, not written`)
  }
  const summed = Object.values(report.totals.miss_by_kind).reduce((total, value) => total + value, 0)
  assert.equal(summed, report.totals.miss)
})

test('a re-run of one case supersedes the old artifact instead of double-counting', () => {
  const dir = fixtureDir()
  try {
    writeArtifact(dir, 'why-case-CASE-0001-2026-10-26T00-00-00.000Z.json', caseArtifact('CASE-0001', 'miss', '2026-10-26T00:00:00.000Z'))
    writeArtifact(dir, 'why-case-CASE-0001-2026-10-26T12-00-00.000Z.json', caseArtifact('CASE-0001', 'hit', '2026-10-26T12:00:00.000Z'))
    writeArtifact(dir, 'why-case-CASE-0002-2026-10-26T00-00-00.000Z.json', caseArtifact('CASE-0002', 'hit', '2026-10-26T00:00:00.000Z'))

    const result = run(['--results', dir, '--out', dir, '--stamp', STAMP, '--min-hit', '1', '--min-total', '2'])
    assert.equal(result.status, 0, result.stderr)

    const reportName = readdirSync(dir).filter((name) => name.startsWith('d1-') && name.endsWith('.json'))
    assert.equal(reportName.length, 1, 'exactly one artifact per stamp')
    const report = JSON.parse(readFileSync(join(dir, reportName[0] as string), 'utf8')) as {
      totals: { cases: number; hit: number; miss: number }
      superseded: string[]
      gate: { passed: boolean }
      cases: { id: string; verdict: string }[]
    }
    assert.equal(report.totals.cases, 2, 'one row per case id, not per file')
    assert.equal(report.totals.hit, 2, 'the newest artifact per case is what counts')
    assert.equal(report.totals.miss, 0)
    assert.equal(report.superseded.length, 1, 'the older artifact must be listed, not dropped silently')
    assert.match(report.superseded[0] as string, /CASE-0001-2026-10-26T00-00-00/)
    assert.equal(report.gate.passed, true)
    assert.equal(readFileSync(join(dir, `${reportName[0]}.sha256`), 'utf8').trim().length, 64)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreadable hit verdict is refused instead of counted', () => {
  const dir = fixtureDir()
  try {
    writeArtifact(dir, 'why-case-CASE-0003-2026-10-26T00-00-00.000Z.json', caseArtifact('CASE-0003', 'hit', '2026-10-26T00:00:00.000Z'))
    const broken = caseArtifact('CASE-0004', 'hit', '2026-10-26T00:00:00.000Z')
    broken.hit.verdict = 'maybe'
    writeArtifact(dir, 'why-case-CASE-0004-2026-10-26T00-00-00.000Z.json', broken)

    const result = run(['--results', dir, '--out', dir, '--stamp', STAMP])
    assert.equal(result.status, 2, 'a hand-edited verdict must not produce a report')
    assert.match(result.stderr, /expected hit\|miss/)
    assert.equal(readdirSync(dir).filter((name) => name.startsWith('d1-')).length, 0, 'no artifact on refusal')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the gate fails when the sample is short, even with a perfect hit rate', () => {
  const dir = fixtureDir()
  try {
    writeArtifact(dir, 'why-case-CASE-0005-2026-10-26T00-00-00.000Z.json', caseArtifact('CASE-0005', 'hit', '2026-10-26T00:00:00.000Z'))
    const result = run(['--results', dir, '--out', dir, '--stamp', STAMP, '--min-hit', '8', '--min-total', '10'])
    assert.equal(result.status, 0, result.stderr)
    const reportName = readdirSync(dir).find((name) => name.startsWith('d1-') && name.endsWith('.json')) as string
    const report = JSON.parse(readFileSync(join(dir, reportName), 'utf8')) as {
      gate: { passed: boolean; samples_ok: boolean; hits_ok: boolean }
      totals: { hit: number }
    }
    assert.equal(report.totals.hit, 1)
    assert.equal(report.gate.hits_ok, false)
    assert.equal(report.gate.samples_ok, false)
    assert.equal(report.gate.passed, false, '1 of 1 must not pass an 8-of-10 gate')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the report is deterministic for a fixed stamp', () => {
  const dir = fixtureDir()
  try {
    writeArtifact(dir, 'why-case-CASE-0006-2026-10-26T00-00-00.000Z.json', caseArtifact('CASE-0006', 'hit', '2026-10-26T00:00:00.000Z'))
    const args = ['--results', dir, '--out', dir, '--stamp', STAMP]
    assert.equal(run(args).status, 0)
    const reportName = readdirSync(dir).find((name) => name.startsWith('d1-') && name.endsWith('.json')) as string
    const first = readFileSync(join(dir, reportName), 'utf8')
    assert.equal(run(args).status, 0)
    assert.equal(readFileSync(join(dir, reportName), 'utf8'), first, 'same stamp must produce identical bytes')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
