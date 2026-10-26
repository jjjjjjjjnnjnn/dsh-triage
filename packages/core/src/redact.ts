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

/** Redact the one path a fingerprint carries. */
export function redactEnv(env: EnvFingerprint, roots: readonly string[]): EnvFingerprint {
  return { ...env, profileDir: redactPath(env.profileDir, roots) }
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
