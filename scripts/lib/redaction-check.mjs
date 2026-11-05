/**
 * "Can this text be pasted into a public thread?" — the one check behind the answer kit (R88 / X1-A).
 *
 * WHY IT IS ITS OWN MODULE: the kit tells a reporter to paste a command's output, and the promise it
 * makes is "your paths are not in here". A promise like that is worth nothing unless the checker
 * itself can be shown to fail — so it lives here, pure, with a unit test that feeds it a path and
 * expects a hit.
 *
 * WHAT COUNTS AS A LEAK: an absolute path. On Windows that is a drive letter (`C:\…`); on POSIX it
 * is `/home/<user>`, `/Users/<user>` or `/root/<user>`. A home-relative path (`~\profiles\web`) is
 * NOT a leak — it does not name the reader's home directory — but it does name their profile, so it
 * is reported separately and the kit tells people to replace it if they care.
 */

const ABSOLUTE = [
  { label: 'windows-drive', pattern: /\b[A-Za-z]:\\/ },
  { label: 'posix-home', pattern: /\/(?:home|Users|root)\/[^\s"'`]+/ },
  { label: 'windows-user-home', pattern: /\bUsers\\[^\s"'`\\]+\\/i },
]

const HOME_RELATIVE = /~(?:[\\/])[^\s"'`]+/

/**
 * @param {string} text
 * @returns {{ leaks: string[], homeRelative: boolean }}
 */
export function findAbsolutePaths(text) {
  const value = String(text ?? '')
  const leaks = ABSOLUTE.filter((entry) => entry.pattern.test(value)).map((entry) => entry.label)
  return { leaks, homeRelative: HOME_RELATIVE.test(value) }
}
