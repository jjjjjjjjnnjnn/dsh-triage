/**
 * Which version is `record_publish` supposed to prove? (R53)
 *
 * WHY THIS IS A MODULE AND NOT ONE LINE IN THE SCRIPT: on 2026-11-01 the release
 * command published three of four packages and exited; the fourth (`@dsh-triage/core`)
 * was left behind, so `latest` pointed at a version nobody could install. The post-publish
 * verification existed (`record_publish`) but its `--version` defaulted to `0.1.0`, so the
 * natural invocation — the one a person types after publishing — would have checked the
 * wrong version. A default that is *usually* wrong is not a default.
 *
 * RULES:
 *   - an explicit `--version` wins, but it must be an exact semver; `v0.3.1`, `^0.3.1`,
 *     `0.3`, `latest` are refused rather than normalised (a check that silently rewrites
 *     its target can prove the wrong thing);
 *   - with no `--version`, the version comes from `packages/plugin/package.json`, which is
 *     the package users install and the one whose dependencies decide installability;
 *   - nothing here invents a version: a missing or non-exact manifest version is an error,
 *     not a guess.
 */

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/**
 * @param {{ requested?: unknown, manifestVersion?: unknown }} input
 * @returns {{ ok: true, version: string, source: 'argument' | 'manifest' } | { ok: false, error: string }}
 */
export function resolvePublishVersion({ requested, manifestVersion }) {
  const raw = typeof requested === 'string' ? requested.trim() : ''
  if (raw !== '') {
    if (!EXACT_SEMVER.test(raw)) {
      return { ok: false, error: `invalid --version "${raw}": expected an exact semver such as 0.3.1 (not "v0.3.1", "^0.3.1", "0.3" or "latest")` }
    }
    return { ok: true, version: raw, source: 'argument' }
  }
  const manifest = typeof manifestVersion === 'string' ? manifestVersion.trim() : ''
  if (!EXACT_SEMVER.test(manifest)) {
    return { ok: false, error: `packages/plugin/package.json has no exact version (read "${manifest}"); pass --version explicitly` }
  }
  return { ok: true, version: manifest, source: 'manifest' }
}
