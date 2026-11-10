/**
 * Where a new entry belongs in the upstream `community.json`, and the assertion that proves it.
 *
 * WHY THIS EXISTS: on 2026-11-10 `zhu1090093659/dsh-community-plugins` switched its index from "append" to
 * "sorted by id". Its own `scripts/community-index.cjs --check` rejects anything else with
 * `community.json: entries must be sorted by id: slumberpavilion comes before dsh-triage`. Our recorder
 * (`scripts/record_market_channels.mjs`) still appended, so it ran their validator against unsorted bytes and
 * reported `rejected` — a red status on a perfectly legal entry. A red that our own bug produced is worse than
 * no red at all: it teaches the reader to ignore the status.
 *
 * WHY IT COMPARES WITH `>` ON RAW STRINGS AND NOTHING ELSE: their gate does literally `previous > current`
 * on the two `id` strings. Not `localeCompare`, not `Array.prototype.sort()` (whose default is UTF-16 code-unit
 * order anyway, but whose *stability* and *comparator plumbing* invite a "tidier" call that then disagrees on
 * `-` vs `.` and on case). If we sorted differently than they do we would produce an index that *we* think is
 * sorted and that *their* gate rejects — exactly the failure this module exists to prevent. Byte-for-byte the
 * same comparison is the only version that can be checked by running their gate, so this file deliberately
 * replicates the naive form instead of improving on it.
 *
 * Zero dependencies on purpose: `scripts/` must keep running on Node builtins alone
 * (`PROJECT_RULES.md`), so this file imports nothing at all.
 */

/**
 * Insert `entry` into a copy of `entries` at its ascending-id position.
 *
 * Returns a NEW array (the parsed upstream array is never mutated — the caller re-reads it on the next run, and
 * an in-place push/splice is how the original bug happened). The entry lands immediately before the first entry
 * whose string id is strictly greater than `entry.id`; if every existing id is smaller it lands at the end.
 *
 * Throws (rather than returning a sentinel) for the three cases where continuing would write a wrong index:
 * a non-array input, an entry without a non-empty string id, and an id that is already present. Their gate would
 * reject the first two for reasons that are hard to read back (`community.json: …`), and silently duplicating an
 * entry is the one mistake no validator downstream will catch as a duplicate.
 */
export function insertByEntryId(entries, entry) {
  if (!Array.isArray(entries)) throw new Error('entries must be an array of community.json entries')
  const id = entry === null || typeof entry !== 'object' ? undefined : entry.id
  if (typeof id !== 'string' || id.length === 0) throw new Error(`entry must carry a non-empty string id (got ${JSON.stringify(id ?? null)})`)

  for (const existing of entries) {
    if (existing !== null && typeof existing === 'object' && existing.id === id) throw new Error(`entry id ${id} already present`)
  }

  const inserted = []
  let placed = false
  for (const existing of entries) {
    // Non-string ids cannot be ordered (their gate would have rejected the file already); step over them instead
    // of guessing, so the worst case is "inserted after them" rather than "inserted in the wrong place".
    if (!placed && existing !== null && typeof existing === 'object' && typeof existing.id === 'string' && existing.id > id) {
      inserted.push(entry)
      placed = true
    }
    inserted.push(existing)
  }
  if (!placed) inserted.push(entry)
  return inserted
}

/**
 * The same assertion their `community-index.cjs` performs: no pair of adjacent string ids may go downhill.
 *
 * This runs against the bytes we are about to hand their gate, so a future change on either side fails here with
 * one readable line instead of showing up as `rejected` plus a truncated stack tail in an artifact nobody re-reads.
 *
 * NOTE the strict `>` (not `>=`): duplicate ids are legal for the ordering check and are caught by
 * `insertByEntryId` instead. Turning this into `>=` would make the two guards disagree about what an index is.
 */
export function assertAscendingIds(entries) {
  if (!Array.isArray(entries)) throw new Error('entries must be an array of community.json entries')
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]
    const current = entries[index]
    const previousId = previous !== null && typeof previous === 'object' ? previous.id : undefined
    const currentId = current !== null && typeof current === 'object' ? current.id : undefined
    if (typeof previousId !== 'string' || typeof currentId !== 'string') continue
    if (previousId > currentId) {
      throw new Error(`community.json: entries must be sorted by id: ${currentId} comes before ${previousId}`)
    }
  }
}
