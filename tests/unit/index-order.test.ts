/**
 * "Where does a new entry go in the upstream community.json, and does our own guard agree with theirs?" (2026-11-10)
 *
 * WHY: upstream `zhu1090093659/dsh-community-plugins` changed its index to "sorted by id" and our recorder still
 * appended, so it printed `rejected` for a legal entry. That is the quiet kind of bug — the artifact stayed
 * green-looking in shape while the status went red, and only an outside change made it visible. These cases pin
 * the ordering rule at its boundaries (front / middle / end), pin the two refusals that must stay loud (a
 * duplicate id, a missing id), and pin the shapes that are easy to get subtly wrong: the input array must survive
 * untouched, and the ascending assertion must refuse exactly what their `previous > current` refuses — no more
 * (`>=` would reject a repeated id that their gate accepts) and no less (`['b','a']` must throw).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assertAscendingIds, insertByEntryId } from '../../scripts/lib/index-order.mjs'

/** Real ids from the upstream index, so the middle-insert case is not a made-up alphabet. */
const entryOf = (id: string) => ({ id, name: id })

const existing = (...ids: string[]) => ids.map(entryOf)

test('a new id lands between the two neighbours it belongs between, not at the end', () => {
  const before = ['dsh-translate', 'dsh-tui']
  const entries = existing(...before)
  const placed = insertByEntryId(entries, { id: 'dsh-triage', name: 'Triage' })
  assert.deepEqual(
    placed.map((item: { id: string }) => item.id),
    ['dsh-translate', 'dsh-triage', 'dsh-tui'],
  )
  // Not merely "contains": the index is the fact the recorder writes as insert_index.
  assert.equal((placed[1] as { id: string }).id, 'dsh-triage')
  assert.equal(placed.length, 3)
})

test('an id smaller than every existing entry is inserted first', () => {
  const placed = insertByEntryId(existing('dsh-translate', 'dsh-tui'), entryOf('dsh-aaa'))
  assert.deepEqual(placed.map((item: { id: string }) => item.id), ['dsh-aaa', 'dsh-translate', 'dsh-tui'])
})

test('an id greater than every existing entry is inserted last', () => {
  const placed = insertByEntryId(existing('dsh-translate', 'dsh-tui'), entryOf('dsh-zzz'))
  assert.deepEqual(placed.map((item: { id: string }) => item.id), ['dsh-translate', 'dsh-tui', 'dsh-zzz'])
})

test('the comparison is raw code-unit order, not locale order: an uppercase id sorts before lowercase', () => {
  /*
   * 'Z' is 0x5a and 'a' is 0x61, so in code units "dsh-Zeta" < "dsh-alpha" — while every locale comparison puts
   * Zeta after alpha. If this module ever switches to localeCompare (the "tidier" call), the entry lands on the
   * wrong side of its neighbour and their gate rejects the file. This is the assertion that would break first.
   */
  const placed = insertByEntryId(existing('dsh-alpha'), entryOf('dsh-Zeta'))
  assert.deepEqual(
    placed.map((item: { id: string }) => item.id),
    ['dsh-Zeta', 'dsh-alpha'],
  )
  assert.ok('dsh-alpha'.localeCompare('dsh-Zeta') < 0, 'the locale disagrees with code units here — that is the point')
})

test('a duplicate id is refused loudly instead of being added twice', () => {
  assert.throws(
    () => insertByEntryId(existing('dsh-translate', 'dsh-triage'), entryOf('dsh-triage')),
    (error: Error) => error.message.includes('entry id dsh-triage already present'),
  )
})

test('an entry without a non-empty string id is refused, and so is a non-array index', () => {
  for (const bad of [undefined, null, 7, '', {}, { id: 5 }, { id: '' }, { id: null }]) {
    assert.throws(() => insertByEntryId(existing('dsh-translate'), bad as never), /non-empty string id/)
  }
  assert.throws(() => insertByEntryId('not an array' as never, entryOf('dsh-triage')), /must be an array/)
  assert.throws(() => insertByEntryId(null as never, entryOf('dsh-triage')), /must be an array/)
})

test('the input array is not mutated in place — length and order are unchanged after the call', () => {
  const entries = existing('dsh-translate', 'dsh-tui')
  const snapshot = entries.map((item: { id: string }) => item.id)
  const placed = insertByEntryId(entries, entryOf('dsh-triage'))
  assert.equal(entries.length, 2)
  assert.deepEqual(entries.map((item: { id: string }) => item.id), snapshot)
  assert.notEqual(placed, entries)
  assert.equal(placed.length, 3)
})

test('a descending neighbour pair is exactly what the upstream gate rejects', () => {
  assert.throws(() => assertAscendingIds(existing('b', 'a')), /must be sorted by id/)
  // Their gate only looks at adjacent pairs, so an out-of-order pair anywhere in the list must still throw.
  assert.throws(() => assertAscendingIds(existing('a', 'c', 'b')), /must be sorted by id/)
  assert.throws(() => assertAscendingIds(existing('dsh-tui', 'dsh-translate')), /must be sorted by id/)
})

test('an ascending list passes, including adjacent duplicates (their gate uses > and not >=)', () => {
  assert.doesNotThrow(() => assertAscendingIds(existing('a', 'a')))
  assert.doesNotThrow(() => assertAscendingIds(existing('dsh-translate', 'dsh-triage', 'dsh-tui')))
  assert.doesNotThrow(() => assertAscendingIds(existing()))
  assert.doesNotThrow(() => assertAscendingIds(existing('dsh-tui')))
})

test('the assertion is also what the recorder writes to disk: inserted output is always accepted', () => {
  // The end-to-end shape of the recorder: parse → insert → assert → serialise. Nothing may be refused after a
  // successful insert, otherwise the recorder would report a red it caused itself.
  for (const id of ['dsh-aaa', 'dsh-alpha', 'dsh-middle', 'dsh-zzz']) {
    const ordered = insertByEntryId(existing('dsh-beta', 'dsh-gamma'), entryOf(id))
    assert.doesNotThrow(() => assertAscendingIds(ordered), `inserted ${id} must satisfy the upstream assertion`)
  }
})