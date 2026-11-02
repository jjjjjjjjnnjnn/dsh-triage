/**
 * One place that turns "a thread named this package" into a declaration-layer reading (R59).
 *
 * WHY IT WAS EXTRACTED: R57 had `probePackage` inline in its recorder. R59 needs the same answer
 * for thousands of threads, and the repository already learned what a second copy of a rule costs
 * (the four-bucket logic and the upgrade engine share one implementation on purpose). This module
 * keeps the R57 semantics exactly:
 *
 *   - a thread that pinned `pkg@1.2.3` is judged at 1.2.3, never at `latest` (CASE-8202);
 *   - a bare name is dropped when the same thread also carries `@scope/<bare>` (`dsh-llm` is not
 *     `@deepseek-ai/dsh-llm`);
 *   - third-party packages are probed before upstream built-ins;
 *   - `unreadable` is not `denied`; `unconstrained` is not `admitted`.
 *
 * The registry read is injected (`loadPackument`), so the same code runs live and from fixtures.
 */

import { evaluateAdmission } from '../../packages/core/dist/index.js'

/**
 * Versions a thread pinned itself (`pkg@1.2.3`). A probe must judge the version the reporter had,
 * not `latest`: #8202 names `@deepseek-ai/dsh-mcp-client@0.1.0-rc.7`, while `latest` is
 * `0.0.1-rc.1` — judging `latest` there answers a different question than the one asked.
 *
 * @param {string} text
 * @returns {Map<string, string>} lowercased package name -> version
 */
export function pinnedVersions(text) {
  const map = new Map()
  for (const match of String(text ?? '').matchAll(/(@?[a-z0-9][a-z0-9._/-]*[a-z0-9])@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/gi)) {
    const name = match[1].toLowerCase()
    if (!map.has(name)) map.set(name, match[2])
  }
  return map
}

/**
 * Which packages this thread may be judged on, and in what order.
 *
 * @param {{ packages?: string[] }} classification
 * @param {string} text
 * @param {{ limit?: number }} [options]
 * @returns {{ targets: Array<{ name: string, pinned: string | null }>, omitted: number, packages: string[] }}
 */
export function selectProbeTargets(classification, text, { limit = 3 } = {}) {
  const packages = Array.isArray(classification?.packages) ? classification.packages : []
  const scopedSuffixes = new Set(packages.filter((name) => name.startsWith('@')).map((name) => name.split('/')[1].toLowerCase()))
  const candidates = packages.filter((name) => name.startsWith('@') || !scopedSuffixes.has(name.toLowerCase()))
  // Third-party names first: an upstream built-in that "denies" is usually the app itself talking.
  const ordered = [...candidates].sort((left, right) => {
    const third = (name) => (/^@deepseek-ai\//i.test(name) ? 1 : 0)
    return third(left) - third(right)
  })
  const pinned = pinnedVersions(text)
  return {
    targets: ordered.slice(0, limit).map((name) => ({ name, pinned: pinned.get(name.toLowerCase()) ?? null })),
    omitted: Math.max(0, ordered.length - limit),
    packages,
  }
}

/** Build a packument-shaped object from the R59 snapshot projection (offline recompute). */
export function packumentFromSnapshot(snapshot) {
  const versions = new Map()
  for (const [version, manifest] of Object.entries(snapshot?.versions ?? {})) {
    /*
     * `null` in a snapshot means "the manifest had no such field": an earlier writer normalised
     * `undefined` to `null`, and `evaluateAdmission` reads a literal `null` as a malformed
     * declaration (denied). Restore the absent field so the offline verdict matches the live one.
     */
    versions.set(version, {
      version,
      engines: manifest?.engines === null ? undefined : manifest?.engines,
      peerDependencies: manifest?.peerDependencies === null ? undefined : manifest?.peerDependencies,
      deprecated: manifest?.deprecated === null ? undefined : manifest?.deprecated,
    })
  }
  return {
    name: String(snapshot?.name ?? ''),
    latest: typeof snapshot?.latest === 'string' ? snapshot.latest : null,
    versions,
    modified: null,
    distTags: snapshot?.dist_tags ?? {},
    publishedAt: {},
  }
}

/**
 * A real answer for one named package: published manifest + declared range vs the target runtime.
 * We ask the registry (or the fixture that recorded it), never the author's profile.
 *
 * @param {string} name
 * @param {string} target
 * @param {{ pinned?: string | null, loadPackument: (name: string) => Promise<{ ok: boolean, value?: any, error?: any }> }} options
 * @returns {Promise<{
 *   package: string,
 *   state: 'measured' | 'unreadable',
 *   version?: string,
 *   version_source?: 'thread-pinned' | 'latest',
 *   target?: string,
 *   admission_status?: 'admitted' | 'denied' | 'unconstrained' | 'indeterminate',
 *   mode?: string,
 *   admits_target?: boolean,
 *   declared_range?: string | null,
 *   unmet?: string[],
 *   detail?: string,
 *   verdict: null,
 * }>}
 */
export async function probePackage(name, target, { pinned = null, loadPackument } = {}) {
  if (typeof loadPackument !== 'function') throw new TypeError('probePackage needs a loadPackument function')
  const fetched = await loadPackument(name)
  if (!fetched?.ok) {
    return {
      package: name,
      state: 'unreadable',
      detail: fetched?.error?.detail ?? fetched?.error?.code ?? 'registry did not answer',
      verdict: null,
    }
  }

  const packument = fetched.value
  const versions = [...packument.versions.keys()].sort()
  const chosen = pinned ?? packument.latest ?? versions.at(-1)
  const manifest = chosen === undefined ? undefined : packument.versions.get(chosen)
  if (manifest === undefined) {
    return {
      package: name,
      state: 'unreadable',
      detail: pinned === null ? 'no published version with a manifest' : `version ${String(pinned)} is not on the registry`,
      verdict: null,
    }
  }

  const admission = evaluateAdmission({ name, ...manifest }, target)
  const engines = manifest.engines
  const dshRange = engines !== null && typeof engines === 'object' ? /** @type {Record<string, unknown>} */ (engines).dsh : null
  const peers =
    manifest.peerDependencies !== null && typeof manifest.peerDependencies === 'object'
      ? Object.entries(/** @type {Record<string, unknown>} */ (manifest.peerDependencies))
          .filter(([key]) => key.startsWith('@deepseek-ai/dsh'))
          .map(([key, range]) => `${key}@${String(range)}`)
          .join(' , ')
      : ''

  /*
   * `status`, NOT "anything that is not admitted is denied" (R57): the engine has four statuses and
   * `unconstrained` means "declares nothing" — reporting that as a denial is the exact false claim
   * this repository forbids.
   */
  return {
    package: name,
    version: chosen,
    version_source: pinned === null ? 'latest' : 'thread-pinned',
    state: 'measured',
    target,
    admission_status: admission.status,
    mode: admission.mode,
    admits_target: admission.status === 'admitted',
    declared_range: typeof dshRange === 'string' ? `engines.dsh ${dshRange}` : peers === '' ? null : peers,
    unmet: Array.isArray(admission.unmet) ? admission.unmet.map((requirement) => `${requirement.key}@${requirement.range}`) : [],
    verdict: null,
  }
}
