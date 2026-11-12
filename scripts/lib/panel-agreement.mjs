/**
 * Do the settings page and the CLI say the same thing?
 *
 * WHY A PURE FUNCTION (R102): the first time anyone compared the two surfaces on a real machine, the
 * comparison was done by eye in a report — and the two surfaces disagreed (0 vs 1 collisions, R101's
 * leftover). "They agree" is a claim that has to be computable, and it has to say *which* fields it
 * compared, because row counts legitimately differ (the Host sees the kernel layer, the CLI's
 * composition is the profile's).
 *
 * THE FOUR FIELDS ARE THE USER-VISIBLE ONES: a denial, an entry-id collision, a duplicate copy, and an
 * unreadable configuration all mean "there is something for you to fix". `unknown` is excluded for the
 * same reason `M15` excludes it: "this plugin never declared a range" is not a defect and not
 * actionable.
 */

/**
 * @typedef {{
 *   dsh: string | null,
 *   dshSource: string | null,
 *   counts: Record<string, number | null> | null,
 * }} Side
 */

/** Fields whose values a user acts on; a difference here is a real disagreement. */
export const ACTIONABLE_FIELDS = ['denied', 'collisions', 'duplicateCopies', 'errors']

/**
 * @param {Side} panel
 * @param {Side} cli
 * @returns {{ agree_on_version: boolean, agree_on_actionable: boolean, mismatches: { field: string, panel: unknown, cli: unknown }[], row_counts_differ: boolean }}
 */
export function judgePanelAgreement(panel, cli) {
  const mismatches = []
  const panelDsh = panel?.dsh ?? null
  const cliDsh = cli?.dsh ?? null
  if (String(panelDsh ?? '') !== String(cliDsh ?? '')) {
    mismatches.push({ field: 'dsh', panel: panelDsh, cli: cliDsh })
  }
  for (const field of ACTIONABLE_FIELDS) {
    const a = panel?.counts?.[field] ?? null
    const b = cli?.counts?.[field] ?? null
    if (a !== b) mismatches.push({ field, panel: a, cli: b })
  }
  return {
    // A differing `dshSource` label is NOT a mismatch: `kernel` and `kernel-asar` are two descriptions of
    // the same running runtime by two callers with different visibility (M11-C7 / M14-C2).
    agree_on_version: mismatches.every((item) => item.field !== 'dsh'),
    agree_on_actionable: mismatches.every((item) => !ACTIONABLE_FIELDS.includes(item.field)),
    mismatches,
    row_counts_differ: (panel?.counts?.rows ?? null) !== (cli?.counts?.rows ?? null),
  }
}
