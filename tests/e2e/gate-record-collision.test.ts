import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

/*
 * R40: `gate.mjs --record --stamp <iso>` used to overwrite whatever artifact already carried
 * that stamp. Twice in one round it clobbered a file that a committed step cited, and the only
 * symptom appeared later as a sha256 mismatch — with the original bytes already gone.
 *
 * The rule this test pins: an artifact name is evidence identity, so a recording that would
 * replace one must refuse and exit 2 instead of writing. The check runs the real CLI (that is
 * where the bug was), then asserts the cited bytes did not move.
 */

const root = new URL('../../', import.meta.url)
const resultsDir = new URL('../../data/results/', import.meta.url)

const toIsoStamp = (fileName: string) => {
  // gates-2026-10-29T04-00-00.000Z.json → 2026-10-29T04:00:00.000Z
  const body = fileName.slice('gates-'.length, -'.json'.length)
  const at = body.indexOf('T')
  return `${body.slice(0, at)}T${body.slice(at + 1).replaceAll('-', ':')}`
}

test('gate --record refuses to overwrite an artifact that already exists', () => {
  const existing = readdirSync(resultsDir).find((name) => /^gates-\d{4}-\d{2}-\d{2}T.*\.json$/.test(name))
  assert.ok(existing, 'expected at least one committed gates artifact to protect')
  const before = readFileSync(new URL(existing, resultsDir), 'utf8')
  const stamp = toIsoStamp(existing)
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

  const run = spawnSync(process.execPath, ['scripts/gate.mjs', '--record', '--stamp', stamp], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })

  assert.equal(run.status, 2, `expected exit 2, got ${String(run.status)}\n${run.stdout}${run.stderr}`)
  assert.match(`${run.stdout}${run.stderr}`, /refusing to overwrite existing evidence/)
  assert.equal(readFileSync(new URL(existing, resultsDir), 'utf8'), before, 'the cited bytes must not move')
})
