/**
 * "The package on the registry still carries a browser half" — a claim `record_publish` could not
 * make until R62 (T-829).
 *
 * WHY THIS EXISTS: on 0.3.2 the release evidence verified the CLI (`cli-runs`), the module entry
 * (`module-resolves`) and the tarball bytes — but not one thing about `client.js`. So "the four-bucket
 * screen actually reached users" was confirmed by hand: `npm pack dsh-triage@0.3.2`, untar it, grep for
 * the markers. A hand check is fine once; it is not a release gate. The tarball hash proves the file
 * we shipped is the file we built, but nothing proved the file is *reachable* and *registers the tab*:
 * a `files` field that drops `client.js`, an `exports` entry pointing at a moved file, or a bundle
 * that lost its `settings.plugins.tab` registration would all ship green.
 *
 * WHAT IT CHECKS (all decidable from the installed package, no network, no browser):
 *   1. `dsh.client` is declared, and its `platform` is `web`  (otherwise the Host never loads it)
 *   2. `exports["./client"]` names a file that EXISTS in the installed package
 *   3. that file carries the client-runner contract (`__ModuleLoader__.load`)
 *   4. that file registers into `settings.plugins.tab` (the slot this product lives in)
 *
 * WHAT IT DOES NOT PROVE (said here so the artifact is not over-read): that a Host boots it, that the
 * React renderer accepts the component, or that anything appears on screen. Those need
 * `record_client_serve` against a real sandbox.
 */

/** The slot this product registers into; a bundle that names it is the bundle users can see. */
export const REQUIRED_SLOT = 'settings.plugins.tab'

/** The client-runner contract: without this line the file is a module, not a client bundle. */
export const REQUIRED_LOADER = '__ModuleLoader__.load'

/**
 * Where the installed package says its browser half is.
 *
 * `dsh.client` carries `{ platform, inject }` and no path (measured on 0.3.2), so the file is named by
 * `exports["./client"]`. Both the string form and the `{ default }` form are accepted.
 *
 * @param {Record<string, unknown> | null | undefined} manifest
 * @returns {string | null}
 */
export function resolveClientEntry(manifest) {
  const exportsField = manifest?.exports
  if (exportsField === null || typeof exportsField !== 'object') return null
  const entry = exportsField['./client']
  if (typeof entry === 'string') return entry
  if (entry !== null && typeof entry === 'object') {
    const fallback = entry.default
    if (typeof fallback === 'string') return fallback
    const first = Object.values(entry).find((value) => typeof value === 'string')
    return typeof first === 'string' ? first : null
  }
  return null
}

/**
 * Judge the installed browser half.
 *
 * @param {{
 *   manifest: Record<string, unknown> | null | undefined,
 *   file: { exists: boolean, source?: string | null } | null | undefined,
 * }} input
 * @returns {{
 *   ok: boolean,
 *   entry: string | null,
 *   bytes: number,
 *   facts: { declared: boolean, platform: string | null, present: boolean, loader: boolean, slot: boolean },
 *   missing: string[],
 *   detail: string,
 * }}
 */
export function judgeClientBundle(input) {
  const manifest = input?.manifest ?? null
  const client = manifest?.dsh?.client ?? null
  const declared = client !== null && typeof client === 'object'
  const platform = declared && typeof client.platform === 'string' ? client.platform : null
  const entry = resolveClientEntry(manifest)
  const source = typeof input?.file?.source === 'string' ? input.file.source : null
  const present = input?.file?.exists === true && source !== null
  const loader = present && source.includes(REQUIRED_LOADER)
  const slot = present && source.includes(REQUIRED_SLOT)

  const missing = []
  if (!declared) missing.push('no dsh.client declaration')
  else if (platform !== 'web') missing.push(`dsh.client.platform is ${platform === null ? 'missing' : `"${platform}"`}, not "web"`)
  if (entry === null) missing.push('exports["./client"] names no file')
  if (entry !== null && !present) missing.push(`${entry} is not in the installed package`)
  if (present && !loader) missing.push(`${String(entry)} does not carry ${REQUIRED_LOADER}`)
  if (present && !slot) missing.push(`${String(entry)} never names ${REQUIRED_SLOT}`)

  const facts = { declared, platform, present, loader, slot }
  const bytes = source === null ? 0 : source.length
  return {
    ok: missing.length === 0,
    entry,
    bytes,
    facts,
    missing,
    detail:
      missing.length === 0
        ? `${String(entry)} resolves (${bytes}B) · loader=yes · slot=${REQUIRED_SLOT}`
        : missing.join(' · '),
  }
}
