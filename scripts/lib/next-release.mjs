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
     *
     * The timestamp is only printed when it is actually a string: R66's first cut used
     * `String(previous?.at ?? …)`, which on an array printed `function at() { [native code] }`
     * (adversary N-4) — the state was right and the sentence was nonsense.
     */
    const at = typeof previous?.at === 'string' && previous.at.length > 0 ? previous.at : 'no usable timestamp'
    return {
      state: 'unmeasured',
      changed: false,
      writesArtifact: false,
      from: null,
      to,
      detail: `the previous observation carries no usable version (${at}), so a change cannot be judged`,
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

/*
 * R94: the watcher watched one tag and missed the upgrade day.
 *
 * `judgeNextChange` above answers "did `next` move". That is the canary channel. The *upgrade day* — the
 * hour every user on the default channel starts loading a new runtime — is `dist-tags.latest` moving, and
 * on 2026-11-05T13:21:52Z upstream promoted `0.2.2-rc.1` to `latest`. Our watcher reported `unchanged`
 * every six hours for six days, because `next` had not moved since 11-05 and nothing looked at `latest`.
 * A watcher that cannot see the channel most users are on is the same failure shape as R71's amnesiac
 * watcher: a green run that does not mean what the reader thinks it means.
 *
 * This judges the SECOND tag without touching the first. `judgeNextChange` keeps its four states and its
 * wording (`watch-upstream.yml` greps for "next moved"); this one is additive and its own four states are
 * about the default channel plus one thing `next` alone can never express: **the two channels now agree**.
 *
 *   - unreadable / no `latest`             → `unmeasured` (**never** "no change on the default channel")
 *   - first observation of `latest`        → `baseline`   (record it, claim nothing)
 *   - `latest` moved and now equals `next` → `promoted`   (this IS the upgrade day)
 *   - `latest` moved, channels disagree    → `latest-moved`
 *   - same value twice                     → `unchanged`
 */

/** States a `latest` reading can end in. Only `baseline`/`promoted`/`latest-moved` are worth an artifact. */
export const LATEST_TAG_STATES = ['baseline', 'promoted', 'latest-moved', 'unchanged', 'unmeasured']

/**
 * @param {{
 *   previous: { version: string, at: string | null } | null,
 *   current: { ok: boolean, version?: string | null, next?: string | null, detail?: string | null },
 * }} input
 * @returns {{ state: string, changed: boolean, writesArtifact: boolean, from: string | null, to: string | null, agreesWithNext: boolean | null, detail: string }}
 */
export function judgeLatestTag(input) {
  const previous = input?.previous ?? null
  const current = input?.current ?? { ok: false, version: null }
  const isVersion = (value) => typeof value === 'string' && /^[!-~]+$/.test(value.trim())
  const fromRaw = isVersion(previous?.version) ? String(previous?.version).trim() : ''
  const from = fromRaw.length > 0 ? fromRaw : null
  const toRaw = isVersion(current?.version) ? String(current?.version).trim() : ''
  const to = toRaw.length > 0 ? toRaw : null
  const next = isVersion(current?.next) ? String(current.next).trim() : null

  if (current?.ok !== true || to === null) {
    return {
      state: 'unmeasured',
      changed: false,
      writesArtifact: false,
      from,
      to: null,
      agreesWithNext: null,
      detail: `the "latest" tag could not be read (${String(current?.detail ?? 'no reason given')}) — this is not "no change" on the default channel`,
    }
  }
  if (previous !== null && from === null) {
    const at = typeof previous?.at === 'string' && previous.at.length > 0 ? previous.at : 'no usable timestamp'
    return {
      state: 'unmeasured',
      changed: false,
      writesArtifact: false,
      from: null,
      to,
      agreesWithNext: null,
      detail: `the previous "latest" observation carries no usable version (${at}), so a change cannot be judged`,
    }
  }
  if (from === null) {
    return {
      state: 'baseline',
      changed: false,
      writesArtifact: true,
      from: null,
      to,
      agreesWithNext: next === to,
      detail: `first observation of "latest": ${to}`,
    }
  }
  if (from === to) {
    return {
      state: 'unchanged',
      changed: false,
      writesArtifact: false,
      from,
      to,
      agreesWithNext: next === to,
      detail: `latest is still ${to} (unchanged since ${String(previous?.at ?? 'the last observation')})`,
    }
  }
  if (next === to) {
    return {
      state: 'promoted',
      changed: true,
      writesArtifact: true,
      from,
      to,
      agreesWithNext: true,
      detail: `latest moved ${from} → ${to} and now equals next — the default channel is serving this build: this is the upgrade day`,
    }
  }
  return {
    state: 'latest-moved',
    changed: true,
    writesArtifact: true,
    from,
    to,
    agreesWithNext: false,
    detail: `latest moved ${from} → ${to} while next is ${String(next ?? 'unreadable')} — the two channels disagree`,
  }
}

/**
 * Which observation is "the previous one"? (R71)
 *
 * WHY THIS IS A FUNCTION AND NOT THREE LINES IN THE SCRIPT: until R71 the watcher only looked in its own
 * `--out` directory. Locally that works because the artifacts are committed next to it. In CI the runner
 * starts from a fresh checkout and `--out` points at `$RUNNER_TEMP`, so `previous` was always `null`, the
 * verdict was always `baseline`, and **the scheduled watcher could never report `changed`** — a watcher
 * that cannot see the past is not a watcher.
 *
 * The rule: the newest **parseable** timestamp wins; an entry whose `at` cannot be parsed is ignored
 * rather than being treated as newest or oldest (both would be an invention). Ties keep the first entry,
 * so the same input always picks the same observation.
 *
 * @param {Array<{ version?: unknown, at?: unknown }>} candidates
 * @returns {{ version: string, at: string } | null}
 */
export function pickNewestObservation(candidates) {
  if (!Array.isArray(candidates)) return null
  const dated = []
  for (const entry of candidates) {
    if (entry === null || typeof entry !== 'object') continue
    if (typeof entry.version !== 'string' || entry.version.trim().length === 0) continue
    if (typeof entry.at !== 'string') continue
    const epoch = Date.parse(entry.at)
    if (!Number.isFinite(epoch)) continue
    dated.push({ version: entry.version, at: entry.at, epoch })
  }
  if (dated.length === 0) return null
  let newest = dated[0]
  for (const entry of dated.slice(1)) if (entry.epoch > newest.epoch) newest = entry
  return { version: newest.version, at: newest.at }
}
