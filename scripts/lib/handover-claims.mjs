/**
 * Pure readers for `docs/HANDOFF.md` (R105).
 *
 * WHY A SEPARATE MODULE: the handover makes claims nothing recomputes, and the point of
 * `scripts/handover_check.mjs` is to recompute them. But a checker that can only be exercised against
 * the live file cannot be given a negative control — you would have to break the real handover to see
 * it go red. These readers take text, so a test can feed them an 11-row table or a wrong number and
 * watch the answer change.
 *
 * WHAT THEY DO NOT DO: they do not read files, do not go to the network, and do not decide whether a
 * claim is *true* — they only extract what the text says, so the caller can compare it with the
 * repository.
 */

/** How many rounds the batch table promises to keep. One number, used by both the check and its test. */
export const BATCH_ROW_BUDGET = 10

/**
 * The rows §2 actually holds.
 *
 * Scoped to §2 on purpose: `(R47 新增)` style markers appear in §7's risk table, and counting the
 * whole file reported 17 rows for a table that had 10.
 *
 * @param {string} handoff
 * @returns {number}
 */
export function countBatchRows(handoff) {
  const start = handoff.indexOf('## 2. 当前批次')
  const end = handoff.indexOf('## 3. 下一位 agent 的第一件事')
  if (start === -1 || end === -1 || end <= start) return 0
  const section = handoff.slice(start, end)
  return section
    .split('\n')
    /*
     * R106: the archive-pointer row starts with `| **历史批次行…` and names rounds in passing
     * (`…-batch-rows-R92-R93.md`（R92/R93/R94）). It is a fixture of §2, not a batch row, and it tripped
     * the counter the first time a rewrite dropped the bold marker after `（`. Excluding it by its own
     * marker is the same shape as N2 ("markers outside §2 are not rows"), one level inward.
     */
    .filter((line) => !line.startsWith('| **历史批次行'))
    .filter((line) => /^\| \*\*.*（R\d+/.test(line)).length
}

/**
 * The test count the acceptance criterion promises, or `null` when the sentence is gone.
 * @param {string} handoff
 * @returns {number | null}
 */
export function acceptanceTestCount(handoff) {
  const match = /当前 \*\*(\d+) 测试\*\*/.exec(handoff)
  return match === null ? null : Number(match[1])
}

/**
 * The snapshot file §3 tells the next reader to start from, or `null`.
 *
 * It looks for the sentence that introduces it (`交接快照`) rather than the first `.json` on the page,
 * because the wrong answer here sends someone to a snapshot of a version the registry no longer serves.
 * @param {string} handoff
 * @returns {string | null}
 */
export function handoverSnapshotName(handoff) {
  const marker = handoff.indexOf('**R105 交接快照**')
  const start = marker === -1 ? handoff.indexOf('交接快照') : marker
  if (start === -1) return null
  const match = /snapshot-[0-9A-Za-z._-]+\.json/.exec(handoff.slice(start))
  return match === null ? null : match[0]
}
