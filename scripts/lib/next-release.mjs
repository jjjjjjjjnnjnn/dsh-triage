/**
 * "Did upstream publish a new rc since we last looked?" — the one part of the upgrade-day front door
 * that has always depended on a human noticing (R64).
 *
 * WHY THIS EXISTS: the product's strongest moment is the hour a new runtime lands, because that is when
 * people's plugins start disappearing. Every previous round produced the card by hand, after someone
 * read the Discussions. That works exactly as often as someone remembers to look.
 *
 * WHAT IT DECIDES (pure, no clock, no network):
 *   - the registry answered and there is no earlier observation  → `baseline`   (record it, claim nothing)
 *   - the registry answered and the value is the same            → `unchanged`  (nothing to publish)
 *   - the registry answered and the value differs                → `changed`    (includes a rollback)
 *   - the registry could not be read                             → `unmeasured` (**never** "no change")
 *
 * The last line is the whole point. A watcher that reports "no update" when it could not reach npm is a
 * machine for producing false calm — the same shape as R52's `threads: 0` and R51's `pending`.
 *
 * WHAT IT DOES NOT DO: it does not compare semver, so it cannot say forward-vs-rollback (both are
 * `changed` and both are printed verbatim); it does not run the card; it does not post anywhere.
 */

/** States a watcher run can end in. Only `changed`/`baseline` are worth an artifact. */
export const NEXT_RELEASE_STATES = ['baseline', 'changed', 'unchanged', 'unmeasured']

/**
 * @param {{
 *   previous: { version: string, at: string | null } | null,
 *   current: { ok: boolean, version?: string | null, detail?: string | null },
 * }} input
 * @returns {{
 *   state: string,
 *   changed: boolean,
 *   writesArtifact: boolean,
 *   from: string | null,
 *   to: string | null,
 *   detail: string,
 * }}
 */
export function judgeNextChange(input) {
  const previous = input?.previous ?? null
  const current = input?.current ?? { ok: false, version: null }
  /*
   * Trim before comparing (R66): `'0.2.1-rc.5 '` and `'0.2.1-rc.5'` are the same version, and a version
   * that is only whitespace is not a version. Before this, a trailing space read as "upstream moved",
   * wrote an artifact, and printed `upgrade --to " "` as the next command.
   *
   * A version is printable ASCII without spaces (npm versions are semver); anything else — NUL, CJK
   * digits, a newline — is a corrupted reading, not a release.
   */
  const isVersion = (value) => typeof value === 'string' && /^[!-~]+$/.test(value.trim())
  const fromRaw = isVersion(previous?.version) ? String(previous?.version).trim() : ''
  const from = fromRaw.length > 0 ? fromRaw : null
  const toRaw = isVersion(current?.version) ? String(current?.version).trim() : ''
  const to = toRaw.length > 0 ? toRaw : null

  if (current?.ok !== true || to === null) {
    return {
      state: 'unmeasured',
      changed: false,
      writesArtifact: false,
      from,
      to: null,
      detail: `the registry could not be read (${String(current?.detail ?? 'no reason given')}) — this is not "no update"`,
    }
  }
  if (previous !== null && from === null) {
    /*
     * An observation exists but carries no usable version. That is "I cannot tell what the baseline was",
     * which is not the same as "first observation" — reporting `baseline` here would let a corrupted
     * artifact pass as a clean start.
     */
    return {
      state: 'unmeasured',
      changed: false,
      writesArtifact: false,
      from: null,
      to,
      detail: `the previous observation carries no usable version (${String(previous?.at ?? 'no timestamp')}), so a change cannot be judged`,
    }
  }
  if (from === null) {
    return {
      state: 'baseline',
      changed: false,
      writesArtifact: true,
      from: null,
      to,
      detail: `first observation: next=${to}`,
    }
  }
  if (from === to) {
    return {
      state: 'unchanged',
      changed: false,
      writesArtifact: false,
      from,
      to,
      detail: `next is still ${to} (unchanged since ${String(previous?.at ?? 'the last observation')})`,
    }
  }
  return {
    state: 'changed',
    changed: true,
    writesArtifact: true,
    from,
    to,
    // Said plainly because the two directions mean different things to the reader.
    detail: `next moved ${from} → ${to}; this includes a rollback, which changes what the card would say`,
  }
}
