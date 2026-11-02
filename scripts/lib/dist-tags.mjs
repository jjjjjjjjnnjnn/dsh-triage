/**
 * "The four packages on npm point at the same version" — a claim `record_publish` made only
 * per-package until R64.
 *
 * WHY THIS EXISTS: the release has gone wrong twice in the same shape, and both times the shape was
 * "one package's `latest` disagreed with the others":
 *
 *   - 0.3.1 (2026-11-01): `@dsh-triage/core@0.3.1` was stuck in registry staging, so `latest` on the
 *     root package named a version a stranger could not install (2m47s of `notarget`).
 *   - 0.3.3 (2026-11-02): a staged promotion rolled `latest` back to 0.3.2 on three of the four
 *     packages while `signals` was already 0.3.3.
 *
 * The per-package `latest:<name>` check catches the second only if it runs *while* the rollback is live;
 * nothing states the cross-package invariant, and nothing notices a tag that names a version the registry
 * does not actually serve. This module states both, as one verdict, so the artifact says "these four
 * tags agree" instead of leaving it to whoever reads four `latest=` strings.
 *
 * WHAT IT DOES NOT PROVE: that the bytes install (that is `anonymous-install`), or that the version is
 * usable by DSH (that is `probe` / `record_client_serve`). It also cannot see a registry that serves
 * different regions different tags — it judges the copy fetched at one timestamp.
 */

/** The four packages this project publishes. Order is the dependency order used elsewhere. */
export const PUBLISHED_PACKAGES = ['@dsh-triage/core', '@dsh-triage/signals', '@dsh-triage/probe', 'dsh-triage']

/**
 * Judge the `dist-tags` of every published package against the version being released.
 *
 * Each input entry is one packument as the registry served it:
 *   { name, unreachable?: true, distTags?: Record<string,string>, versions?: string[] }
 *
 * An unreachable package is reported as UNMEASURED and still fails the verdict: a release where one
 * package's tags could not be read is not a release whose tags were verified. Saying "ok" there would be
 * the recurring mistake this repo pays for (a check that did not run reading as a pass).
 *
 * @param {{
 *   expectedVersion: string,
 *   packages: Array<{ name: string, unreachable?: boolean, distTags?: Record<string, string> | null, versions?: string[] | null }>,
 * }} input
 * @returns {{
 *   ok: boolean,
 *   expectedVersion: string,
 *   latest: Record<string, string | null>,
 *   unreachable: string[],
 *   dangling: Array<{ name: string, tag: string, version: string }>,
 *   extraTags: Array<{ name: string, tag: string, version: string }>,
 *   problems: string[],
 *   detail: string,
 * }}
 */
export function judgeDistTags(input) {
  const expectedVersion = String(input?.expectedVersion ?? '').trim()
  const packages = Array.isArray(input?.packages) ? input.packages : []
  const latest = {}
  const unreachable = []
  const dangling = []
  const extraTags = []
  const problems = []

  if (expectedVersion.length === 0) {
    // An empty expectation would make "they all agree with the release" true of nothing (R66).
    problems.push('the expected version is empty, so this verdict would be vacuous')
  }

  const seen = new Set()
  for (const entry of packages) {
    const name = String(entry?.name ?? '')
    /*
     * The claim is about THE FOUR PACKAGES (R66). Before this, passing one packument — any packument —
     * produced "all 1 package(s) point latest at X" and a green. `PUBLISHED_PACKAGES` was exported and
     * never consulted, which is a trap for the next caller.
     */
    if (name.length === 0) {
      problems.push('a packument arrived without a name, so which package it describes is unknown')
      continue
    }
    if (seen.has(name)) problems.push(`${name}: appears twice in one verdict, so the two readings cannot both be true`)
    seen.add(name)
    if (entry?.unreachable === true) {
      unreachable.push(name)
      latest[name] = null
      problems.push(`${name}: the registry did not answer, so its tags are unmeasured (not verified)`)
      continue
    }
    const tags = entry?.distTags !== null && typeof entry?.distTags === 'object' ? entry.distTags : {}
    const versions = Array.isArray(entry?.versions) ? entry.versions.map(String) : null
    const current = typeof tags.latest === 'string' ? tags.latest : null
    latest[name] = current
    if (current === null) problems.push(`${name}: no latest tag at all`)
    else if (expectedVersion.length > 0 && current !== expectedVersion) problems.push(`${name}: latest=${current}, expected ${expectedVersion}`)

    /*
     * Without the version list a tag cannot be checked for dangling, so the honest verdict is
     * "unmeasured" — not "no dangling tags found" (which is what `versions: null` used to mean, while
     * `versions: []` turned every tag into a false red; the unreadable case was the *more* lenient one).
     */
    if (versions === null && Object.keys(tags).length > 0) {
      problems.push(`${name}: the version list is unreadable, so its tags cannot be checked against published versions`)
    }

    for (const [tag, version] of Object.entries(tags).sort(([left], [right]) => (left < right ? -1 : 1))) {
      if (typeof version !== 'string') continue
      if (versions !== null && !versions.includes(version)) {
        dangling.push({ name, tag, version })
        // A tag naming a version the registry does not serve is how a stranger lands on a 404/notarget.
        problems.push(`${name}: tag "${tag}" points at ${version}, which is not a published version`)
        continue
      }
      if (tag !== 'latest') extraTags.push({ name, tag, version })
    }
  }

  for (const name of PUBLISHED_PACKAGES) {
    if (seen.has(name)) continue
    latest[name] = null
    problems.push(`${name}: no packument in this run, so its tags are unmeasured (not verified)`)
  }

  if (packages.length === 0 && problems.length === 0) problems.push('no packument was read — this verdict would be vacuous')

  /*
   * The cross-package invariant. Reported separately from the per-package mismatch so the detail line
   * names the *shape* ("these two disagree") and not four identical "expected 0.3.3" sentences.
   */
  const measured = Object.entries(latest).filter(([, value]) => value !== null)
  if (measured.length > 1) {
    const distinct = [...new Set(measured.map(([, value]) => value))]
    if (distinct.length > 1) {
      const byVersion = distinct
        .sort()
        .map((version) => `${version} on ${measured.filter(([, value]) => value === version).map(([name]) => name).join(', ')}`)
        .join(' | ')
      problems.push(`the four packages disagree on latest: ${byVersion}`)
    }
  }

  const tagsAgree = measured.length > 0 && new Set(measured.map(([, value]) => value)).size === 1
  const detail =
    problems.length === 0
      ? `all ${packages.length} package(s) point latest at ${expectedVersion}` +
        (extraTags.length === 0 ? '' : ` · other tag(s): ${extraTags.map((item) => `${item.name}@${item.tag}=${item.version}`).join(', ')}`)
      : problems.slice(0, 4).join(' · ')

  return {
    ok: problems.length === 0,
    expectedVersion,
    latest,
    unreachable,
    dangling,
    extraTags,
    problems,
    tagsAgree,
    detail,
  }
}
