/**
 * Parse `--reply <n>=<url>` into the thread it claims to answer (R94).
 *
 * WHY A PURE FUNCTION: the recorder cannot be run in a test (it needs a live GraphQL answer), but the
 * half that decides *which* thread we are talking about must be checkable. A reply attributed to the
 * wrong discussion is worse than no reply at all: it puts our words under somebody else's question.
 *
 * WHAT IT REFUSES, AND WHY EACH ONE IS A REAL RISK:
 *   - a discussion URL without `#discussioncomment-<id>`: "I replied" needs the comment, not the thread;
 *   - a declared `#<n>` that the URL does not name: the two halves come from different places and only
 *     one of them is authoritative — the URL is, so a mismatch is a caller error, not a preference;
 *   - any host other than `https://github.com`: the same path shape exists elsewhere.
 */

/**
 * @param {string} declared the thread number the caller typed
 * @param {string} url the comment URL
 * @returns {{ ok: true, owner: string, repo: string, number: number, commentId: string } | { ok: false, detail: string }}
 */
export function parseReplySpec(declared, url) {
  const declaredText = typeof declared === 'string' ? declared.trim() : ''
  const urlText = typeof url === 'string' ? url.trim() : ''
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/discussions\/(\d+)#discussioncomment-(\d+)$/.exec(urlText)
  if (match === null) {
    return {
      ok: false,
      detail: `${urlText || '<empty>'} is not a discussion-comment URL (needs https://github.com/<owner>/<repo>/discussions/<n>#discussioncomment-<id>)`,
    }
  }
  const [, owner, repo, number, commentId] = match
  if (declaredText.length === 0) {
    return { ok: false, detail: `no thread number was declared for ${urlText}` }
  }
  if (!/^\d+$/.test(declaredText)) {
    return { ok: false, detail: `the declared thread "${declaredText}" is not a number` }
  }
  if (declaredText !== number) {
    return {
      ok: false,
      detail: `${urlText} names discussion #${number}, but the flag said #${declaredText}`,
    }
  }
  return { ok: true, owner, repo, number: Number(number), commentId }
}
