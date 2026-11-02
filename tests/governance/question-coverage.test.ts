/**
 * The coverage recorder's end-to-end contract, offline (`scripts/record_question_coverage.mjs`, R59).
 *
 * WHY: the number this artifact carries will sit on the README. The two failure modes that matter
 * are (a) a ratio computed from a partial census, and (b) a "recompute" that quietly reads the live
 * registry instead of the snapshot. The mini fixture pins both:
 *
 *   1. the committed snapshot reproduces the same rows / counts / tiers twice;
 *   2. `fetched != total_count` exits 2 and writes nothing;
 *   3. an upstream-only denial is `upstream-only`, not part of the headline;
 *   4. the artifact never carries an absolute path, even when `--fixtures` was absolute.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = join(repoRoot, 'scripts', 'record_question_coverage.mjs')
const FIXTURES = join(repoRoot, 'tests', 'fixtures', 'question-coverage', 'coverage-mini')
const TARGET = '0.2.1-rc.5'

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repoRoot, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function coverageArgs(stamp: string, out: string, extra: string[] = []): string[] {
  return ['--stamp', stamp, '--fixtures', FIXTURES, '--target', TARGET, '--out', out, '--review-size', '3', ...extra]
}

test('the committed snapshot is enough to compute the mini census, and the tiers are the signed ones', () => {
  const out = mkdtempSync(join(tmpdir(), 'dsh-triage-coverage-out-'))
  try {
    const result = run(coverageArgs('2026-11-02T16:00:00.000Z', out))
    assert.equal(result.status, 0, result.stderr)

    const file = join(out, 'question-coverage-selftest-2026-11-02T16-00-00-000Z.json')
    assert.ok(existsSync(`${file}.sha256`), 'every artifact carries a sibling hash')
    const artifact = JSON.parse(readFileSync(file, 'utf8'))

    // Q&A: one denied third-party package, one thread with no package name, one silent thread.
    assert.equal(artifact.counts.qa.threads, 3)
    assert.equal(artifact.counts.qa.relevant, 2)
    assert.equal(artifact.counts.qa.tiers['names-a-denial'], 1)
    assert.equal(artifact.counts.qa.tiers['needs-their-profile'], 1)
    assert.equal(artifact.counts.qa.tiers['not-relevant'], 1)
    assert.equal(artifact.coverage.qa.headline.count, 1)
    assert.equal(artifact.coverage.qa.headline.denominator, 3)
    assert.equal(artifact.coverage.qa.headline.ratio, 1 / 3)

    // General: the upstream package is unpinned -> upstream-only; the third-party admitted -> rules-out.
    assert.equal(artifact.counts.general.tiers['upstream-only'], 1)
    assert.equal(artifact.counts.general.tiers['rules-out-declaration'], 1)
    assert.equal(artifact.coverage.general.label, 'projection-only')

    // The snapshot is portable: no repo path, no temp path, no self-test masquerading as evidence.
    const text = readFileSync(file, 'utf8')
    assert.ok(!text.includes(repoRoot), 'no repository root in the artifact')
    assert.ok(!text.includes(out), 'no output directory in the artifact')
    assert.equal(artifact.sample.source, 'fixtures:coverage-mini')
    assert.equal(artifact.sample.pilot, false)
    assert.match(file, /question-coverage-selftest-/, 'a self-test is never named like a live reading')
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('N10: a second run from the same snapshot reproduces rows and counts item by item', () => {
  const first = mkdtempSync(join(tmpdir(), 'dsh-triage-coverage-a-'))
  const second = mkdtempSync(join(tmpdir(), 'dsh-triage-coverage-b-'))
  try {
    const one = run(coverageArgs('2026-11-02T16:10:00.000Z', first))
    const two = run(coverageArgs('2026-11-02T16:20:00.000Z', second, ['--recompute']))
    assert.equal(one.status, 0, one.stderr)
    assert.equal(two.status, 0, two.stderr)

    const a = JSON.parse(readFileSync(join(first, 'question-coverage-selftest-2026-11-02T16-10-00-000Z.json'), 'utf8'))
    const b = JSON.parse(readFileSync(join(second, 'question-coverage-recompute-2026-11-02T16-20-00-000Z.json'), 'utf8'))
    assert.notEqual(a.generated_at, b.generated_at)
    assert.deepEqual(b.rows, a.rows)
    assert.deepEqual(b.counts, a.counts)
    assert.deepEqual(b.coverage, a.coverage)
  } finally {
    rmSync(first, { recursive: true, force: true })
    rmSync(second, { recursive: true, force: true })
  }
})

test('N8: a census that read fewer threads than totalCount writes nothing', () => {
  const fixtures = mkdtempSync(join(tmpdir(), 'dsh-triage-coverage-broken-'))
  const out = mkdtempSync(join(tmpdir(), 'dsh-triage-coverage-out-'))
  try {
    cpSync(FIXTURES, fixtures, { recursive: true })
    const qa = JSON.parse(readFileSync(join(fixtures, 'qa.json'), 'utf8'))
    qa.total_count = 4
    writeFileSync(join(fixtures, 'qa.json'), `${JSON.stringify(qa, null, 2)}\n`, 'utf8')

    const result = run(['--stamp', '2026-11-02T16:30:00.000Z', '--fixtures', fixtures, '--target', TARGET, '--out', out, '--review-size', '3'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /incomplete census/)
    assert.deepEqual(readdirSync(out), [], 'no artifact for an incomplete census')
  } finally {
    rmSync(fixtures, { recursive: true, force: true })
    rmSync(out, { recursive: true, force: true })
  }
})

test('a snapshot without the target runtime is a usage error, not a silent default', () => {
  const out = mkdtempSync(join(tmpdir(), 'dsh-triage-coverage-out-'))
  try {
    const result = run(['--stamp', '2026-11-02T16:40:00.000Z', '--fixtures', FIXTURES, '--out', out])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /requires --target/)
    assert.deepEqual(readdirSync(out), [])
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})
