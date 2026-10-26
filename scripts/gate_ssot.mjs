#!/usr/bin/env node
/**
 * Gate: SSOT integrity.
 *
 * Every `data/results/*.json` must be script-produced and hash-locked:
 *   produced_by (script path) + generated_at + schema_version + sibling .sha256
 *
 * Negative control: `--mutate` corrupts the hash of the first result.
 */

import { exists, listDir, readText, runGate, sha256 } from './lib/kit.mjs'

await runGate('ssot', async ({ checks, mutate }) => {
  const entries = listDir('data/results').filter((entry) => entry.isFile && entry.name.endsWith('.json'))
  checks.require('results-present', entries.length > 0, 'no data/results/*.json yet')

  for (const entry of entries) {
    const path = `data/results/${entry.name}`
    const text = readText(path)
    let payload
    try {
      payload = JSON.parse(text)
    } catch (error) {
      checks.add(`json:${entry.name}`, false, error instanceof Error ? error.message : String(error))
      continue
    }

    const structural =
      typeof payload.produced_by === 'string' &&
      payload.produced_by.startsWith('scripts/') &&
      typeof payload.generated_at === 'string' &&
      /^\d{4}-\d{2}-\d{2}T/.test(payload.generated_at) &&
      payload.schema_version === 1
    checks.add(
      `fields:${entry.name}`,
      structural,
      structural ? `${payload.produced_by} @ ${payload.generated_at}` : 'need produced_by(scripts/…), generated_at ISO, schema_version 1',
    )

    // The producer must actually exist — otherwise the file is unattributable.
    checks.add(
      `producer:${entry.name}`,
      typeof payload.produced_by === 'string' && exists(payload.produced_by),
      String(payload.produced_by ?? ''),
    )

    const hashPath = `${path}.sha256`
    const expected = readTextSafe(hashPath)
    const actual = sha256(text)
    const compared = mutate ? `${actual.slice(0, -1)}0` : actual
    checks.add(
      `hash:${entry.name}`,
      expected !== null && expected.trim() === compared,
      expected === null ? `missing ${hashPath}` : `expected ${expected.trim().slice(0, 12)}… got ${compared.slice(0, 12)}…`,
    )
  }
})

function readTextSafe(path) {
  try {
    return readText(path)
  } catch {
    return null
  }
}
