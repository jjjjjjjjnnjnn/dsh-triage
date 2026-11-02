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
  const expectedVersion = String(input?.expectedVersion ?? '')
  const packages = Array.isArray(input?.packages) ? input.packages : []
  const latest = {}
  const unreachable = []
  const dangling = []
  const extraTags = []
  const problems = []

  for (const entry of packages) {
    const name = String(entry?.name ?? '?')
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
    else if (current !== expectedVersion) problems.push(`${name}: latest=${current}, expected ${expectedVersion}`)

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

  if (packages.length === 0) problems.push('no packument was read — this verdict would be vacuous')

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
