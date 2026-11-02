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
  const from = typeof previous?.version === 'string' ? previous.version : null
  const to = typeof current?.version === 'string' ? current.version : null

  if (current?.ok !== true || typeof to !== 'string' || to.length === 0) {
    return {
      state: 'unmeasured',
      changed: false,
      writesArtifact: false,
      from,
      to: null,
      detail: `the registry could not be read (${String(current?.detail ?? 'no reason given')}) — this is not "no update"`,
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
