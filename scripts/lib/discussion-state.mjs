/**
 * The reply gate for a prepared-but-not-yet-posted draft (R71).
 *
 * WHY A PURE FUNCTION: the three upstream reply drafts (#8202 / #10849 / #11687) were written in R57 and
 * are posted later, by a human. In the gap the thread can be answered by someone else, closed, or locked.
 * The rule "do not post into a thread that already has its answer" has to be testable without the network,
 * because the *interesting* states are exactly the ones a live read rarely returns.
 *
 * THE ONE THING IT MUST NEVER DO: turn "I could not read it" into `open`. That is the R51/R52 bug class
 * (a `pending` read as an answer, a `403` read as "nobody has this problem") aimed at a person.
 */

export const REPLY_GATES = ['open', 'answered', 'closed', 'unreadable']

/**
 * @param {unknown} thread one GraphQL `discussion` node, or a row carrying `closed` / `isAnswered`
 * @returns {'open' | 'answered' | 'closed' | 'unreadable'}
 */
export function judgeReplyGate(thread) {
  if (thread === null || typeof thread !== 'object') return 'unreadable'
  const record = /** @type {{ closed?: unknown, isAnswered?: unknown, answered?: unknown }} */ (thread)
  const closed = record.closed
  const answered = record.isAnswered === undefined ? record.answered : record.isAnswered
  if (closed === true) return 'closed'
  if (answered === true) return 'answered'
  // Both flags must be *seen* as false. A missing field is not a false one.
  if (closed === false && answered === false) return 'open'
  return 'unreadable'
}
