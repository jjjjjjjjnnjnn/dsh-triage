/**
 * "Does the document say the same upstream version the artifact measured?" (R99)
 *
 * WHY THIS EXISTS AS A FUNCTION: `next` moved from `0.2.2-rc.1` to `0.2.2-rc.2` in R97 and the artifact
 * recorded it (`next-release-2026-11-12T06-50-44.469Z.json`), but three entry documents kept saying
 * "`next` = `0.2.2-rc.1`" — and a fourth (`docs/07-environment.md`) was two rounds older still, claiming
 * 0.2.1-rc.2 while R91 had already measured the running kernel at 0.2.2-rc.1. Four hand-maintained copies
 * of one fact, zero recomputations. That is `BS-64` in its purest form: the same fact in a second home.
 *
 * So the claim is parsed instead of trusted. The parser is deliberately narrow — it only reads a version
 * that directly follows the tag marker (allowing the punctuation the documents actually use: `=`, `**`,
 * backticks), so prose like "`next` was promoted" cannot be mistaken for a measured value.
 *
 * WHAT IT DOES NOT DO: it does not read the network (the artifact already did that once, under a stamp),
 * and it says nothing about whether `next` is the version you *want* — only that the documents repeat the
 * number the artifact recorded.
 */

/** Strip the punctuation documents put between a tag marker and its value. */
const CONNECTOR = /^[\s`*:=·|，,（(]+/

/**
 * Read the version that directly follows the `latest` / `next` markers on one line.
 *
 * @param {unknown} line
 * @returns {{ latest: string | null, next: string | null }}
 */
export function readTagClaims(line) {
  const text = typeof line === 'string' ? line : ''
  const claims = { latest: /** @type {string | null} */ (null), next: /** @type {string | null} */ (null) }
  for (const tag of /** @type {const} */ (['latest', 'next'])) {
    const at = text.indexOf('`' + tag + '`')
    if (at === -1) continue
    const rest = text.slice(at + tag.length + 2).replace(CONNECTOR, '')
    const match = /^([0-9][0-9A-Za-z.\-]*)/.exec(rest)
    if (match !== null) claims[tag] = match[1]
  }
  return claims
}

/**
 * Judge one document line against the recorded upstream `latest` / `next`.
 *
 * `missing` cases are reported, not skipped: a line that lost its `latest` claim is exactly how
 * `docs/07-environment.md` stayed wrong for two rounds, and passing it silently would be the R52
 * `threads: 0` mistake in a new place.
 *
 * @param {{ line: unknown, expected: { latest: string, next: string } }} input
 * @returns {{ ok: boolean, claims: { latest: string | null, next: string | null }, problems: string[], detail: string }}
 */
export function judgeTagClaims(input) {
  const line = typeof input?.line === 'string' ? input.line : ''
  const expected = {
    latest: String(input?.expected?.latest ?? '').trim(),
    next: String(input?.expected?.next ?? '').trim(),
  }
  const claims = readTagClaims(line)
  const problems = []

  if (expected.latest.length === 0) problems.push('the artifact recorded no `latest`, so this verdict would be vacuous')
  if (expected.next.length === 0) problems.push('the artifact recorded no `next`, so this verdict would be vacuous')

  for (const tag of /** @type {const} */ (['latest', 'next'])) {
    const claimed = claims[tag]
    if (claimed === null) problems.push(`${tag}: the line names no version after the marker`)
    else if (expected[tag].length > 0 && claimed !== expected[tag]) {
      problems.push(`${tag}: the line says ${claimed}, the artifact measured ${expected[tag]}`)
    }
  }

  return {
    ok: problems.length === 0,
    claims,
    problems,
    detail:
      problems.length === 0
        ? `latest ${expected.latest} · next ${expected.next}`
        : problems.slice(0, 3).join(' · '),
  }
}
