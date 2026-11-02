/**
 * Which market baseline may D5's download number come from? (R72, closes `T-841`)
 *
 * WHY THIS IS NOT "just sort the file names": the recorder used to take the newest `market-baseline-*.json`
 * by **name**, and a recompute artifact (`--fixtures`) has the same prefix and a *later* stamp than the
 * measurement it re-derives. So the default could silently read a recompute of an older window: the number
 * would look ordinary and describe the wrong week. Both R52 artifacts have identical numbers, which is
 * exactly why nobody noticed — the failure only shows up on a day when they differ.
 *
 * THE RULE:
 *   - `inputs.offline === false` is the only proof that a baseline was collected live (`measured`);
 *   - `offline === true` is a recompute: legitimate, but it re-derives whatever window it was pointed at;
 *   - a baseline artifact that records neither is `unproven` — usable in a pinch, never preferred;
 *   - among the preferred pool the newest `generated_at` wins, ties keep the first entry (deterministic).
 *
 * WHAT IT DOES NOT DO: it does not verify that the chosen baseline covers the D5 window. That is the
 * operator's job (`docs/d5-close-runbook.md` §0 step 1: refresh the market baseline first).
 */

export const BASELINE_KINDS = ['measured', 'recompute', 'unproven']

/**
 * @param {Array<{ file?: unknown, produced_by?: unknown, generated_at?: unknown, offline?: unknown }>} entries
 * @returns {{ file: string, kind: 'measured' | 'recompute' | 'unproven', at: string | null } | null}
 */
export function pickBaselineArtifact(entries) {
  if (!Array.isArray(entries)) return null
  const usable = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    // Only our own recorder writes a baseline; the name prefix alone proves nothing.
    if (entry.produced_by !== 'scripts/record_market_baseline.mjs') continue
    if (typeof entry.file !== 'string' || entry.file.length === 0) continue
    const kind = entry.offline === false ? 'measured' : entry.offline === true ? 'recompute' : 'unproven'
    const at = typeof entry.generated_at === 'string' ? entry.generated_at : null
    const epoch = at === null ? Number.NaN : Date.parse(at)
    usable.push({ file: entry.file, kind, at, epoch: Number.isFinite(epoch) ? epoch : null })
  }
  if (usable.length === 0) return null

  /*
   * Preference order, not a filter: a run with nothing but recomputes must still be able to read a number
   * (that is what `unmeasurable` is for — "I could not read", not "I refused to look"). What must never
   * happen is a recompute winning over a live measurement.
   */
  for (const kind of /** @type {const} */ (['measured', 'recompute', 'unproven'])) {
    const pool = usable.filter((entry) => entry.kind === kind)
    if (pool.length === 0) continue
    // Entries without a parseable timestamp sort last but stay eligible (R66: an unreadable date is not a
    // reason to invent order; it is a reason to prefer the ones we can read).
    const dated = pool.filter((entry) => entry.epoch !== null)
    const picked =
      dated.length > 0
        ? dated.reduce((best, entry) => (entry.epoch > best.epoch ? entry : best))
        : pool[0]
    return { file: picked.file, kind: picked.kind, at: picked.at }
  }
  return null
}
