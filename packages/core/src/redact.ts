/**
 * Path redaction for anything that leaves the machine.
 *
 * WHY: `data/results/**` is committed and the repository is meant to become
 * public. A verdict that embeds `C:\Users\<name>\.dsh\...` leaks the user's home
 * directory into git history forever. Redaction happens at the serialization
 * boundary only — the engine keeps real paths so probe/fix commands still work
 * locally.
 *
 * Tier: this is a *display* transform; it must never change a conclusion.
 */

import type { EnvFingerprint, Verdict } from './types.js'

const HOME_TOKEN = '~'

function normalize(value: string): string {
  return value.replace(/[\\/]+$/, '')
}

function startsWithRoot(value: string, root: string): boolean {
  const v = normalize(value).toLowerCase()
  const r = normalize(root).toLowerCase()
  if (r === '') return false
  if (v === r) return true
  return v.startsWith(`${r}/`) || v.startsWith(`${r}\\`)
}

/**
 * Replace the longest matching root prefix with `~`.
 *
 * Deterministic: roots are sorted longest-first, so nested homes resolve to the
 * most specific token instead of a truncated path.
 */
export function redactPath(value: string, roots: readonly string[]): string {
  const sorted = roots
    .filter((root) => typeof root === 'string' && root.trim() !== '')
    .map(normalize)
    .sort((a, b) => b.length - a.length)
  for (const root of sorted) {
    if (!startsWithRoot(value, root)) continue
    const rest = normalize(value).slice(root.length)
    return rest === '' ? HOME_TOKEN : `${HOME_TOKEN}${rest}`
  }
  return value
}

/**
 * Redact every path a fingerprint carries.
 *
 * `kernelRoots` was added by M11 and is an absolute path by construction. It leaked the temp root
 * into `audit --json` immediately (three e2e tests, first run). The rule stays the same: anything
 * that leaves the machine gets the same treatment, not just the field someone remembered.
 */
export function redactEnv(env: EnvFingerprint, roots: readonly string[]): EnvFingerprint {
  const { kernelManifests, ...rest } = env
  return {
    ...rest,
    profileDir: redactPath(env.profileDir, roots),
    ...(env.kernelRoots === undefined
      ? {}
      : { kernelRoots: env.kernelRoots.map((root) => redactPath(root, roots)) }),
    /*
     * R101/M14: `kernelProbe.path` is an absolute path by construction (it names the desktop archive),
     * and `results-privacy` caught it in `audit --json` on the first attempt. Same rule as `kernelRoots`:
     * anything that leaves the machine gets redacted.
     */
    ...(env.kernelProbe === undefined
      ? {}
      : {
          kernelProbe: {
            ...env.kernelProbe,
            path: env.kernelProbe.path === null ? null : redactPath(env.kernelProbe.path, roots),
          },
        }),
    /*
     * R101/M14: `env` is published verbatim into `audit --json`, and a `Map` serializes to `{}` — which is
     * a lie of the same shape as a missing field. The manifests belong to the reading, not to the answer:
     * they are handed to `resolveRows` in memory and then dropped here.
     */
    ...(kernelManifests === undefined ? {} : {}),
  }
}

/**
 * Redact every path a verdict can carry.
 *
 * Found by the e2e test: redacting `env.profileDir` alone still leaked the home
 * directory through `evidence[].source` (the runtime evidence points at the
 * profile directory). Serialization must redact the whole verdict, not one field.
 */
export function redactVerdict(verdict: Verdict, roots: readonly string[]): Verdict {
  return {
    ...verdict,
    env: redactEnv(verdict.env, roots),
    evidence: verdict.evidence.map((item) => ({ ...item, source: redactPath(item.source, roots) })),
  }
}
