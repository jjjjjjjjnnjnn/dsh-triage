/**
 * Scrub absolute user paths out of a value that is about to be published (R94).
 *
 * WHY THIS EXISTS: `record_rescue.mjs` embeds the CLI's own `plan` in its artifact, and that plan
 * carries `spec` strings such as `file:C:/Users/<name>/Desktop/.../pkg.tgz` for packages installed
 * from a local tarball. The recorder replaced `inputs.dsh_home` with a placeholder, but the plan
 * itself still leaked the operator's home path — `gate_governance/results-privacy` caught it on the
 * first measured run (2026-11-11). The spec for M8 says an artifact names the profile, never the
 * user's absolute path; a placeholder that only covers one field does not honour that.
 *
 * WHAT IT REPLACES:
 *   - the home directory itself → `~/`
 *   - any other `C:\Users\<name>\` / `/Users/<name>/` / `/home/<name>/` → `<home>/`
 *
 * WHAT IT DOES NOT DO: it does not touch package names, versions or verdicts; it never rewrites
 * a path that is already relative, and it does not try to recognise every possible home shape.
 * A path that survives this scrub is a path this function could not see — which is why the
 * governance gate still runs afterwards.
 */

const USER_PATTERNS = [
  /[A-Za-z]:\\Users\\[^\\]+\\/g,
  /[A-Za-z]:\/Users\/[^/]+\//g,
  /\/Users\/[^/]+\//g,
  /\/home\/[^/]+\//g,
  /\/root\//g,
]

/**
 * @param {unknown} value any JSON-ish value
 * @param {string} home the operator's home directory (may be empty)
 * @returns {unknown} the same shape, with user paths replaced
 */
export function scrubAbsolutePaths(value, home) {
  if (typeof value === 'string') return scrubString(value, home)
  if (Array.isArray(value)) return value.map((item) => scrubAbsolutePaths(item, home))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, inner] of Object.entries(value)) out[key] = scrubAbsolutePaths(inner, home)
    return out
  }
  return value
}

function scrubString(text, home) {
  let out = text
  if (typeof home === 'string' && home.length > 0) {
    // Both separators, because a Windows path can be written either way in a spec string.
    for (const variant of [home, home.replaceAll('\\', '/'), home.replaceAll('/', '\\')]) {
      out = out.split(variant).join('~')
    }
  }
  for (const pattern of USER_PATTERNS) out = out.replace(pattern, '<home>/')
  return out
}
