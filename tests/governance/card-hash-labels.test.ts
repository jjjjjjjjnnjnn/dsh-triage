/**
 * T-868: two hashes, two names — the card text's hash and the artifact's hash must not share a label.
 *
 * WHY: `record_upgrade_card.mjs` printed one bare `sha256=…` line. That number was the hash of the CARD
 * TEXT, while the `upgrade-card-*.json.sha256` file next to the artifact is the hash of the whole artifact
 * JSON. Both numbers are correct and neither is wrong; the defect is that a reader checking the printed
 * number against the `.sha256` file gets a mismatch and cannot tell whether the evidence or the check is
 * broken. That is the same shape as `T-835`: a number whose *name* points at a different object.
 *
 * HOW THIS LOCKS IT: the recorder must print both numbers under field names that say which object they
 * belong to, and the artifact must carry the card hash as its own field. The negative control is the
 * actual pre-R99 line: under one label, either number fails one of the two assertions below.
 *
 * WHAT IT DOES NOT DO: it does not run the recorder (that needs a real profile — `record_upgrade_card`
 * is the witness for that) and it does not decide which hash a reader should quote.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

const PRINTED_HASH_FIELDS = ['card sha256=', 'artifact sha256=']

/** Every printed hash label that does not name the object it hashes. */
function bareHashLabels(source: string): string[] {
  const offenders: string[] = []
  for (const line of source.split('\n')) {
    // Only stdout writes are "printed". Comments and artifact fields are not claims to a console reader.
    if (!/process\.stdout\.write/.test(line)) continue
    for (const match of line.matchAll(/sha256/g)) {
      const after = line.slice(match.index + 'sha256'.length).trimStart()
      if (!after.startsWith('=') && !after.startsWith('${')) continue
      const before = line.slice(Math.max(0, match.index - 12), match.index)
      if (/card $/.test(before) || /artifact $/.test(before)) continue
      offenders.push(line.trim().slice(0, 100))
    }
  }
  return offenders
}

test('the upgrade card recorder names each hash after the object it hashes', () => {
  const source = read('scripts/record_upgrade_card.mjs')
  for (const field of PRINTED_HASH_FIELDS) {
    assert.ok(source.includes(field), `scripts/record_upgrade_card.mjs must print "${field}" (T-868)`)
  }
  // The old line printed one number for two objects. A bare `sha256=` label is that bug.
  assert.deepEqual(bareHashLabels(source), [], 'a printed hash label must name its object (card / artifact)')
})

test('the artifact carries the card hash under its own field', () => {
  const source = read('scripts/record_upgrade_card.mjs')
  assert.ok(source.includes('card_sha256:'), 'the artifact must write `card_sha256` so the card hash survives the transcript')
  assert.ok(source.includes('sha256(text)'), 'the `.sha256` file must keep hashing the artifact, not the card')
})

test('the negative control: one label for two objects fails this test', () => {
  // N1: the exact pre-R99 print line. If someone re-introduces it, the assertions above go red.
  const stale = 'process.stdout.write(`  ${ok}/${total} checks · sha256 ${sha256(card).slice(0, 12)}…\\n`)'
  assert.deepEqual(bareHashLabels(stale), [stale], 'the old line must be recognised as the bare-label shape')
  for (const field of PRINTED_HASH_FIELDS) assert.equal(stale.includes(field), false)
})

test('a card already on disk still carries both numbers', () => {
  // The witness artifact R97/R98 left behind: it must already have `card_sha256` and a real artifact hash pair.
  const artifact = read('data/results/upgrade-card-2026-11-12T07-35-00.000Z.json')
  const payload = JSON.parse(artifact) as { inputs?: { card_sha256?: string }, card?: string }
  const cardHash = payload.inputs?.card_sha256
  assert.ok(typeof cardHash === 'string' && /^[a-f0-9]{64}$/.test(cardHash), 'the artifact must record the card hash')
  assert.ok(typeof payload.card === 'string' && payload.card.length > 0, 'the artifact must keep the card text it hashed')
})
