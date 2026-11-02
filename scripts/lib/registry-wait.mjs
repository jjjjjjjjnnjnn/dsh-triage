/**
 * "The version is not on the registry yet" is not the same fact as "the release failed" (R62).
 *
 * WHAT HAPPENED: R53 chained the forensics to the publish (`preflight → publish → record_publish`), so
 * `record_publish` starts within seconds of a successful publish. On 0.3.2 that chain produced three
 * red artifacts in five minutes — 14:10:13, 14:14:43, 14:15:09 — for a release that had worked: every
 * read check passed (`latest=0.3.2` on all four packages) while the anonymous install still answered
 *
 *     npm error notarget No matching version found for dsh-triage@0.3.2
 *
 * because the anonymous / install document is served from a replica that lagged ~4.5 minutes behind
 * the region that accepted the write. The fourth run, 14:15:36, was 20/20 with no code change.
 *
 * WHY THIS IS A DEFECT AND NOT A FLAKE: a red that appears on every release trains people to ignore
 * red. The honest fix is to WAIT for the claim to become checkable, keep the wait in the artifact, and
 * still fail for real when the budget runs out — not to soften the assertion.
 *
 * The two decisions are pure functions so the retry policy is a test, not a comment:
 *   - `looksLikePropagationLag` — is this failure the "not propagated yet" shape at all?
 *   - `shouldRetryInstall`      — given the elapsed time and the budget, ask again or give up?
 *
 * No clock, no network, no filesystem here: the caller owns the waiting.
 */

/** Failure shapes npm prints when the registry has not caught up with the write. */
export const PROPAGATION_PATTERNS = [/notarget/i, /ETARGET/i, /No matching version/i, /E404 .*is not in this registry/i]

/** How long `record_publish` is willing to wait for the replicas (5 minutes covers the 4.5 measured). */
export const DEFAULT_REGISTRY_WAIT_MS = 5 * 60 * 1000

/** Gap between attempts. Long enough not to hammer the registry, short enough to catch the replica. */
export const RETRY_INTERVAL_MS = 15_000

/** Hard cap on attempts, so a pathological budget cannot turn into an unbounded loop. */
export const MAX_ATTEMPTS = 40

/**
 * @param {{ code: number | null, output?: string | null }} attempt
 * @returns {boolean}
 */
export function looksLikePropagationLag(attempt) {
  const code = attempt?.code
  if (code === 0) return false
  const output = String(attempt?.output ?? '')
  if (output === '') return false
  return PROPAGATION_PATTERNS.some((pattern) => pattern.test(output))
}

/**
 * Ask again only when BOTH are true: the failure looks like propagation, and there is budget left.
 * Everything else (wrong credentials, a malformed tarball, a name we never published) fails at once —
 * retrying those for five minutes would just delay the same answer.
 *
 * @param {{ code: number | null, output?: string | null, elapsedMs: number, budgetMs: number, attempt: number }} state
 * @returns {boolean}
 */
export function shouldRetryInstall(state) {
  if (!looksLikePropagationLag({ code: state?.code ?? null, output: state?.output ?? null })) return false
  const budget = Number(state?.budgetMs)
  if (!Number.isFinite(budget) || budget <= 0) return false
  const attempt = Number(state?.attempt)
  if (!Number.isFinite(attempt) || attempt >= MAX_ATTEMPTS) return false
  const elapsed = Number(state?.elapsedMs)
  if (!Number.isFinite(elapsed)) return false
  return elapsed < budget
}

/**
 * One sentence for the artifact: how long we waited, and whether that wait ended in an answer.
 *
 * `settled: false` is the honest branch — the budget ran out and the registry still said the version
 * was not there, which is a real failure, not a wait (R62's control run hit exactly this).
 *
 * @param {{ attempts: number, waitedMs: number, settled?: boolean }} state
 * @returns {string}
 */
export function describePropagationWait(state) {
  const attempts = Number(state?.attempts ?? 1)
  const waitedMs = Number(state?.waitedMs ?? 0)
  if (attempts <= 1) return 'the registry answered on the first try (no propagation wait)'
  if (state?.settled === false) {
    return `the install answered "not on the registry yet" ${attempts - 1} time(s); after ${waitedMs}ms it still did, so this is a real failure, not a wait`
  }
  return `the install answered "not on the registry yet" ${attempts - 1} time(s); the probe re-asked and got a real answer after ${waitedMs}ms`
}
