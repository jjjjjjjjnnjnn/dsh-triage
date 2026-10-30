/**
 * "Which npm failed, and was it our fault?" — the auth half of `scripts/release_preflight.mjs`.
 *
 * WHY THIS EXISTS (2026-10-30): the preflight printed
 *
 *     FAIL  not-logged-in: npm 不认这个 token（`npm whoami` 返回 401）
 *
 * on a machine where `npm whoami` printed the operator's own user name. The check had
 * never actually run: on Windows `npm` is `npm.cmd`, and Node refuses to spawn a batch
 * file without a shell (`spawnSync npm ENOENT`, the CVE-2024-27980 mitigation). Every
 * failure was then rendered with a hard-coded 401 sentence, so "our check is broken"
 * was reported as "your credentials are broken" — the operator went off to re-authenticate
 * something that was already fine, and the publish that would have worked never started.
 *
 * Three things are encoded here so it cannot happen again:
 *
 *   1. `npmInvocation()` calls npm the one way that works on Windows (`ComSpec /d /s /c`,
 *      never `shell: true` — DEP0190 deprecates that when args are passed);
 *   2. `classifyWhoami()` keeps three outcomes apart: logged in / not logged in / **could
 *      not ask**. A check that did not run is not a conclusion;
 *   3. both are pure, so `tests/unit/release-preflight.test.ts` can pin them offline.
 */

/**
 * Turn `['whoami']` into an argv that this platform can actually spawn.
 *
 * @param {string[]} args
 * @param {string} [platform]
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ command: string, args: string[] }}
 */
export function npmInvocation(args, platform = process.platform, env = process.env) {
  const list = Array.isArray(args) ? args.map((value) => String(value)) : []
  if (platform !== 'win32') return { command: 'npm', args: list }
  const line = ['npm', ...list].map(quoteIfNeeded).join(' ')
  return { command: env['ComSpec'] ?? 'cmd.exe', args: ['/d', '/s', '/c', line] }
}

function quoteIfNeeded(part) {
  return /[ \t"&|<>^]/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part
}

/**
 * Text that means "the registry rejected us", as opposed to "we never reached it".
 * Kept explicit instead of "any failure means 401": that assumption is the bug.
 */
const AUTH_FAILURES = [/\bE401\b/i, /\b401\b/, /\bENEEDAUTH\b/i, /not logged in/i, /unauthorized/i, /authentication (?:token|failed)/i]

/**
 * @param {{ ok: boolean, stdout?: string, stderr?: string }} observed
 * @returns {{ state: 'logged-in' | 'not-logged-in' | 'could-not-run', user: string | null, detail: string, observed: string }}
 */
export function classifyWhoami(observed) {
  const stdout = String(observed?.stdout ?? '').trim()
  const stderr = String(observed?.stderr ?? '').trim()

  if (observed?.ok === true) {
    const user = lastNonEmptyLine(stdout)
    if (user === '') {
      return {
        state: 'could-not-run',
        user: null,
        // Exited 0 without a name: still not a login we can trust.
        detail: '`npm whoami` 退出码 0 但没打印用户名（无法确认登录身份）',
        observed: '',
      }
    }
    return { state: 'logged-in', user, detail: `npm user: ${user}`, observed: user }
  }

  const text = `${stderr}\n${stdout}`.trim()
  const firstLine = firstNonEmptyLine(text)
  if (AUTH_FAILURES.some((pattern) => pattern.test(text))) {
    return {
      state: 'not-logged-in',
      user: null,
      detail: firstLine === '' ? 'registry 拒绝了当前凭据' : firstLine,
      observed: firstLine,
    }
  }
  return {
    state: 'could-not-run',
    user: null,
    detail: firstLine === '' ? '调用 npm 失败，且没有任何输出' : firstLine,
    observed: firstLine,
  }
}

function firstNonEmptyLine(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed
  }
  return ''
}

function lastNonEmptyLine(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return lines.length === 0 ? '' : lines[lines.length - 1]
}
