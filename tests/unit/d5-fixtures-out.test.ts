/**
 * "Capture the raw reads, then derive the same verdict from them" (R72).
 *
 * WHY THIS TEST EXISTS: D5 is the only product judgement in this repository, and until R72 its recorder
 * could only *read* a fixture directory — nothing ever wrote one. So the close-window artifact was
 * re-readable but never re-derivable, which is the one thing the repository's SSOT rule forbids for every
 * other recorder (market baseline, question coverage, discussion triage all snapshot their raw input).
 *
 * Two contracts are pinned here, both offline (the fixture set is checked in):
 *   1. `--fixtures-out` writes exactly the two files `--fixtures` reads, and a second run **from those
 *      files** produces the same verdict and the same three numbers;
 *   2. `--dry-read` still writes nothing, so combining it with `--fixtures-out` is a usage error rather
 *      than a silent write — the rehearsal path must not be able to leave evidence behind.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = join(repoRoot, 'scripts', 'record_d5_evidence.mjs')
const FIXTURES = join(repoRoot, 'tests', 'fixtures', 'd5', 'self-test')
const POST = 'https://github.com/deepseek-ai/deepseek-harness/discussions/12000'
const POSTED_ON = '2026-11-01T20:24:37.000Z'

/** A minimal baseline artifact: `steady` and above the threshold, so the download number is a real reading. */
function baselineFile(dir: string): string {
  const path = join(dir, 'market-baseline-test.json')
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        d5: { downloads_state: 'recorded', week_downloads: 41, download_shape: 'steady', days_with_downloads: 7 },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return path
}

function run(args: readonly string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: repoRoot })
  return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
}

const verdictOf = (file: string) => {
  const payload = JSON.parse(readFileSync(file, 'utf8')) as { d5_verdict: string; numbers: unknown; window: unknown }
  // The three numbers and the window are what a reader would re-check; the stamp of this run is not.
  return JSON.stringify({ verdict: payload.d5_verdict, numbers: payload.numbers, window: payload.window })
}

const artifactIn = (dir: string) => {
  const name = readdirSync(dir).find((entry) => entry.startsWith('d5-selftest-') && entry.endsWith('.json'))
  assert.ok(name !== undefined, `expected an artifact in ${dir}`)
  return join(dir, name)
}

test('R72: a captured read set re-derives the same verdict, without the network', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-triage-d5-capture-'))
  try {
    const baseline = baselineFile(dir)
    const first = join(dir, 'first')
    const captured = join(dir, 'captured')

    const run1 = run([
      '--stamp', '2026-11-05T10:00:00.000Z',
      '--post', POST,
      '--posted-on', POSTED_ON,
      '--fixtures', FIXTURES,
      '--fixtures-out', captured,
      '--baseline', baseline,
      '--out', first,
    ])
    assert.equal(run1.status, 0, run1.stderr)
    assert.ok(existsSync(join(captured, 'reactions.json')), 'a capture must include reactions.json')
    assert.ok(existsSync(join(captured, 'references.json')), 'a capture must include references.json')

    // Second run: derived only from the capture. If the capture were lossy, one of the three numbers
    // would move (that is exactly how R59's `undefined` snapshot turned 81 rows into denials).
    const second = join(dir, 'second')
    const run2 = run([
      '--stamp', '2026-11-05T10:10:00.000Z',
      '--post', POST,
      '--posted-on', POSTED_ON,
      '--fixtures', captured,
      '--baseline', baseline,
      '--out', second,
    ])
    assert.equal(run2.status, 0, run2.stderr)
    assert.equal(verdictOf(artifactIn(second)), verdictOf(artifactIn(first)), 'the re-derived verdict must match')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('R72: --dry-read refuses to write a capture, so a rehearsal leaves nothing behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-triage-d5-dryrun-'))
  try {
    const captured = join(dir, 'captured')
    mkdirSync(captured)
    const result = run([
      '--stamp', '2026-11-05T10:00:00.000Z',
      '--post', POST,
      '--posted-on', POSTED_ON,
      '--fixtures', FIXTURES,
      '--fixtures-out', captured,
      '--dry-read',
    ])
    assert.equal(result.status, 2, 'the combination must be refused, not silently honoured')
    assert.deepEqual(readdirSync(captured), [], 'a dry read must not write a capture')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
