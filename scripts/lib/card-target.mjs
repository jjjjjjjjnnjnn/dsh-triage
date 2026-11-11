/**
 * "Does the upgrade-day card title name the version it actually resolved?" (R94)
 *
 * WHY THIS EXISTS AS A FUNCTION: `record_upgrade_card.mjs` compared the card's title line against the
 * `--to` argument. That is right for `--to 0.2.2-rc.1` and wrong for `--to latest` / `--to next`, where the
 * argument is a **keyword** and the card titles the version the registry resolved it to
 * (`# 升级日 · 0.2.2-rc.1`). A keyword run therefore recorded 13/14 with the only red being this check —
 * a false red, and false reds teach the next reader to stop reading that check.
 *
 * The product is right and the assertion was wrong, so the fix belongs in the assertion, and an assertion
 * that only ever runs inside a recorder cannot be negative-controlled. Hence: pure, exported, unit-tested.
 *
 * WHAT IT DOES NOT DECIDE: it does not say the card is correct, only that its title names the target the
 * JSON run resolved. Whether the resolved version is the one you *wanted* is `target_source`'s business.
 */

/**
 * @param {{ title: string, keyword: string, resolved: string | null }} input
 * @returns {{ ok: boolean, expected: string, detail: string }}
 */
export function judgeCardTitle(input) {
  const title = typeof input?.title === 'string' ? input.title : ''
  const keyword = typeof input?.keyword === 'string' ? input.keyword.trim() : ''
  const resolvedRaw = typeof input?.resolved === 'string' ? input.resolved.trim() : ''
  const resolved = resolvedRaw.length > 0 ? resolvedRaw : null

  /*
   * The resolved version wins when it exists: `latest` is not a version and never appears in a title.
   * When the JSON carries no `target` at all, fall back to the keyword so a broken run is still caught
   * (a title that names neither is red either way).
   */
  const expected = resolved ?? keyword
  const ok = title.startsWith('# ') && expected.length > 0 && title.includes(expected)
  return {
    ok,
    expected,
    detail: `${title.slice(0, 60)} (expected ${expected}, keyword ${keyword || '<missing>'})`,
  }
}
