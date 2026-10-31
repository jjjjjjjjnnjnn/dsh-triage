/**
 * The market-baseline recorder contract (`scripts/record_market_baseline.mjs`, R52).
 *
 * WHY: D5 is the one gate that decides whether this product exists, and its download criterion is the only
 * part of it that a script can answer. On 2026-10-31 the npm API said `634` for `dsh-triage` - thirty times
 * the threshold - and every one of those landed on a single day between two silent days. A recorder that
 * reports the weekly total and stops would have handed us a false pass.
 *
 * So the tests pin, end to end and offline:
 *
 *   1. the committed fixtures reproduce `burst-not-demand` (the real 2026-10-29 burst does not count);
 *   2. a synthetic steady 25-downloads window DOES count - otherwise the rule could pass by always saying no;
 *   3. an empty discussion table refuses to write at all (it would read as "nobody has problems");
 *   4. the artifact carries no home path, even when it was produced from an absolute `--fixtures` path.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = join(repoRoot, 'scripts', 'record_market_baseline.mjs')
const FIXTURES = join(repoRoot, 'data', 'fixtures', 'market-baseline', '2026-10-31T06-40-00.000Z')

interface FixtureFile {
  url: string
  status: number
  body: string
}

const readFixture = (dir: string, name: string): FixtureFile =>
  JSON.parse(readFileSync(join(dir, name), 'utf8')) as FixtureFile

const writeFixture = (dir: string, name: string, fixture: FixtureFile): void => {
  writeFileSync(join(dir, name), `${JSON.stringify(fixture)}\n`, 'utf8')
}

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repoRoot, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** Copy the real fixture set so a test can change one response and leave the rest of the world intact. */
function scratchFixtures(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-triage-market-'))
  cpSync(FIXTURES, dir, { recursive: true })
  return dir
}

test('the committed fixtures reproduce the real burst: 634 weekly downloads do not count as demand', () => {
  const out = mkdtempSync(join(tmpdir(), 'dsh-triage-market-out-'))
  try {
    const result = run(['--stamp', '2026-10-31T08:00:00.000Z', '--fixtures', FIXTURES, '--out', out])
    assert.equal(result.status, 0, result.stderr)

    const artifact = JSON.parse(readFileSync(join(out, 'market-baseline-2026-10-31T08-00-00.000Z.json'), 'utf8'))
    assert.equal(artifact.d5.package, 'dsh-triage')
    assert.equal(artifact.d5.week_downloads, 634)
    assert.equal(artifact.d5.download_shape, 'single-day-burst')
    assert.equal(artifact.d5.peak_day, '2026-10-29')
    assert.equal(artifact.d5.verdict, 'burst-not-demand')
    assert.equal(artifact.d5.counts_as_demand, false)

    // Every package carries a shape, and the counts partition the package list.
    const total = Object.values(artifact.downloads.shape_counts as Record<string, number>).reduce((sum, n) => sum + n, 0)
    assert.equal(total, Object.keys(artifact.packages).length)
    for (const [name, value] of Object.entries(artifact.packages as Record<string, { download_shape?: string }>)) {
      assert.ok(typeof value.download_shape === 'string', `${name} must carry a download_shape`)
    }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('a steady window that clears the threshold DOES count (the rule is not "always no")', () => {
  const fixtures = scratchFixtures()
  const out = mkdtempSync(join(tmpdir(), 'dsh-triage-market-out-'))
  try {
    // Keep every other response real; change only this package's weekly total and daily series.
    const point = readFixture(fixtures, 'npm-downloads-bulk-unscoped.json')
    const pointBody = JSON.parse(point.body)
    pointBody['dsh-triage'] = { downloads: 25, package: 'dsh-triage', start: '2026-10-23', end: '2026-10-29' }
    writeFixture(fixtures, 'npm-downloads-bulk-unscoped.json', { ...point, body: JSON.stringify(pointBody) })

    const range = readFixture(fixtures, 'npm-downloads-range-bulk-unscoped.json')
    const rangeBody = JSON.parse(range.body)
    rangeBody['dsh-triage'] = {
      package: 'dsh-triage',
      start: '2026-10-23',
      end: '2026-10-29',
      downloads: [
        { day: '2026-10-23', downloads: 3 },
        { day: '2026-10-24', downloads: 4 },
        { day: '2026-10-25', downloads: 3 },
        { day: '2026-10-26', downloads: 4 },
        { day: '2026-10-27', downloads: 3 },
        { day: '2026-10-28', downloads: 4 },
        { day: '2026-10-29', downloads: 4 },
      ],
    }
    writeFixture(fixtures, 'npm-downloads-range-bulk-unscoped.json', { ...range, body: JSON.stringify(rangeBody) })

    const result = run(['--stamp', '2026-10-31T08:10:00.000Z', '--fixtures', fixtures, '--out', out])
    assert.equal(result.status, 0, result.stderr)

    const artifact = JSON.parse(readFileSync(join(out, 'market-baseline-2026-10-31T08-10-00.000Z.json'), 'utf8'))
    assert.equal(artifact.d5.week_downloads, 25)
    assert.equal(artifact.d5.download_shape, 'steady')
    assert.equal(artifact.d5.verdict, 'threshold-met')
    assert.equal(artifact.d5.counts_as_demand, true)
  } finally {
    rmSync(fixtures, { recursive: true, force: true })
    rmSync(out, { recursive: true, force: true })
  }
})

test('an empty discussion projection refuses to write a baseline', () => {
  const fixtures = scratchFixtures()
  const out = mkdtempSync(join(tmpdir(), 'dsh-triage-market-out-'))
  try {
    writeFixture(fixtures, 'gh-discussions-projection.json', {
      url: 'https://api.github.com/repos/deepseek-ai/deepseek-harness/discussions',
      status: 200,
      body: JSON.stringify({ upstream: 'deepseek-ai/deepseek-harness', last_page: 1, page_numbers: [], threads: [] }),
    } as unknown as FixtureFile)

    const result = run(['--stamp', '2026-10-31T08:20:00.000Z', '--fixtures', fixtures, '--out', out])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /empty discussion projection/)
    assert.deepEqual(readdirSync(out), [], 'no artifact may be written')
  } finally {
    rmSync(fixtures, { recursive: true, force: true })
    rmSync(out, { recursive: true, force: true })
  }
})

test('the artifact never carries the operator home path, even from an absolute fixture path', () => {
  const fixtures = scratchFixtures()
  const out = mkdtempSync(join(tmpdir(), 'dsh-triage-market-out-'))
  try {
    const result = run(['--stamp', '2026-10-31T08:30:00.000Z', '--fixtures', fixtures, '--out', out])
    assert.equal(result.status, 0, result.stderr)

    const file = join(out, 'market-baseline-2026-10-31T08-30-00.000Z.json')
    assert.ok(existsSync(file))
    const text = readFileSync(file, 'utf8')
    const artifact = JSON.parse(text)
    assert.equal(artifact.inputs.offline, true)
    assert.doesNotMatch(JSON.stringify(artifact.inputs.fixtures), /Users|AppData|\\\\|\/\/\?\/[A-Za-z]:/i)
    assert.doesNotMatch(text, /[A-Za-z]:\\\\Users\\\\/i)
  } finally {
    rmSync(fixtures, { recursive: true, force: true })
    rmSync(out, { recursive: true, force: true })
  }
})
