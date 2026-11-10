/**
 * "Is the public repository still the container's `dsh-triage/` subtree?" (R93)
 *
 * WHY THIS EXISTS: the public repo `jjjjjjjjnnjnn/dsh-triage` is not a second copy of this project — it is
 * the container's `dsh-triage/` directory, re-rooted. R93 cut it out by hand (`git rev-parse main:dsh-triage`
 * → `commit-tree` → push) and compared the trees once, in a transcript nobody can re-run. That comparison
 * has to happen after every push, and both ways of getting it wrong are silent:
 *
 *   1. **forgotten cut** — the container moved on and the public repo still sells the previous README: the
 *      badge, the test count and the version on the npm page describe a repository that stopped existing;
 *   2. **over-pushed** — someone pushes the container's ROOT to the public repo, which gains a
 *      `dsh-triage/` prefix and loses its `package.json` entry point while every file still looks present.
 *
 * THE THREE OUTCOMES ARE NOT NEGOTIABLE, so they are named here rather than folded into one boolean:
 *
 *   - `in-sync` — the public tree equals the subtree of **HEAD**: the cut is current;
 *   - `behind`  — the public tree equals the subtree of an **older** container commit: the cut is real but
 *                 the container has moved on. This is the normal state between a round's commits and its
 *                 push, so it must not read as a failure — it reports the commit the public repo was cut
 *                 from, and how many commits it is behind;
 *   - `drift`   — the public tree matches **no** container commit: something was pushed that this
 *                 repository never contained (the wrong-push case, or a hand-edited public repo).
 *
 * WHAT IT CANNOT SEE: whether a push was forced (a rewritten history can carry an identical tree), whether
 * the public repo has commits the container never had, or what GitHub serves at this instant — it reads the
 * locally fetched `origin/<ref>`.
 */

const isObjectId = (value) => /^[0-9a-f]{40}$/.test(value) || /^[0-9a-f]{64}$/.test(value)

const short = (value) => String(value ?? '').trim().slice(0, 7)

/**
 * @param {{
 *   headSubtreeTree?: unknown,
 *   head?: unknown,
 *   publicTree?: unknown,
 *   publicHead?: unknown,
 *   matchingCommit?: unknown,
 *   commitsBehind?: unknown,
 *   ref?: unknown,
 *   rootTree?: unknown,
 * }} input
 * @returns {{ status: 'in-sync' | 'behind' | 'drift' | 'unmeasured', problems: string[] }}
 */
export function judgePublicCut(input) {
  const ref = String(input?.ref ?? '').trim() || 'origin/main'
  const headSubtreeTree = String(input?.headSubtreeTree ?? '').trim()
  const head = String(input?.head ?? '').trim()
  const publicTree = String(input?.publicTree ?? '').trim()
  const publicHead = String(input?.publicHead ?? '').trim()
  const matchingCommit = String(input?.matchingCommit ?? '').trim()
  const rootTree = String(input?.rootTree ?? '').trim()
  const commitsBehind = input?.commitsBehind
  const problems = []

  /*
   * Shape first, then meaning. `git rev-parse` prints nothing and exits non-zero for a ref it cannot
   * resolve, and a caller that swallows that returns `''` — where `'' === ''` is *true*. Two unread values
   * comparing equal is exactly how a "the public repo is current" verdict gets printed on a machine that
   * never fetched it (the R51/R52 shape: a value that was never read, reported as a conclusion).
   */
  if (!isObjectId(headSubtreeTree)) problems.push(`the container's subtree tree is not a git object id (got "${headSubtreeTree}")`)
  if (!isObjectId(head)) problems.push(`the container's HEAD is not a git object id (got "${head}")`)
  if (!isObjectId(publicTree)) problems.push(`the public tree is not a git object id (got "${publicTree}")`)
  if (!isObjectId(publicHead)) problems.push(`the public head is not a git object id (got "${publicHead}")`)
  if (matchingCommit.length > 0 && !isObjectId(matchingCommit)) problems.push(`the matching commit is not a git object id (got "${matchingCommit}")`)
  if (problems.length > 0) return { status: 'unmeasured', problems }

  if (publicTree === headSubtreeTree) return { status: 'in-sync', problems }

  /*
   * The wrong push, caught before it is blamed on a stale cut: if the public tree equals the container's
   * ROOT tree, the push carried the `dsh-triage/` prefix. This is worth its own sentence because every
   * file is still there, so "does it look complete?" cannot see it.
   */
  if (isObjectId(rootTree) && publicTree === rootTree) {
    problems.push(
      `the public repository is the container's ROOT, not its subtree: ${ref} tree ${publicTree} equals ` +
        `the root tree of ${short(head)}, so every path gained the prefix — re-cut with "git rev-parse main:dsh-triage"`,
    )
    return { status: 'drift', problems }
  }

  if (isObjectId(matchingCommit)) {
    const behind = commitsBehind === undefined || commitsBehind === null ? null : Number(commitsBehind)
    problems.push(
      `${ref} is the cut of container commit ${short(matchingCommit)}, not of HEAD ${short(head)}` +
        (Number.isInteger(behind) && behind > 0 ? ` — ${behind} commit(s) behind, re-run the cut after the last commit` : '') +
        `. Nothing is wrong with the public repo; it is simply older than the container.`,
    )
    return { status: 'behind', problems }
  }

  problems.push(
    `the ${ref} tree ${publicTree} matches no container commit's subtree (HEAD is ${short(head)}, subtree ` +
      `${headSubtreeTree}) — something was pushed that this repository never contained, or the public repo was edited by hand`,
  )
  return { status: 'drift', problems }
}

export { isObjectId }
