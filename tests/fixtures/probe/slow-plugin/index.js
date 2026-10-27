// Fixture: a candidate that is SLOW but not broken (R17 / BS-25).
//
// The probe used to turn "the tree had not finished composing" into "the plugin is broken",
// because a silent port inside a 5s window and a dead row looked identical. This fixture keeps
// its row in `loading` for `delayMs` before it registers, so:
//
//   * `boot -> sample` is late by design (the hook waits for a settled tree),
//   * the sample must come back with `settled: true`,
//   * the verdict must be `go`, never `blocked`.
//
// It deliberately does nothing else: no timers left running, no tools, no side effects.
export const name = 'triage-probe-slow'

export function apply(ctx = {}, config = {}) {
  const delayMs = Number(config.delayMs ?? 6000)
  ctx.logger?.info?.(`triage-probe-slow: registering after ${delayMs}ms`)
  // Returning a promise keeps the row `loading` until it resolves, which is exactly the
  // "tree still moving" shape the settle logic has to survive.
  return new Promise((resolve) => {
    setTimeout(() => {
      ctx.logger?.info?.('triage-probe-slow mounted')
      resolve()
    }, delayMs)
  })
}

export default { name, apply }
