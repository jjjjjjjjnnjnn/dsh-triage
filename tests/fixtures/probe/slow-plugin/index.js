// Fixture: a candidate that is SLOW but not broken (R17 / BS-25, corrected in R18).
//
// The first version delayed inside `apply` by returning a promise. Measured in R18:
// Cordis marks the row `active` as soon as `apply` is entered, so that fixture never
// produced a transient row (`wait_ms` 3.3s, phase `active` immediately) and proved less
// than it claimed.
//
// This version delays the MODULE IMPORT with a top-level await, which is what a large
// real-world bundle actually does: the loader cannot finish composing this row until the
// module resolves, so the row really is `loading` for the whole delay.
export const name = 'triage-probe-slow'

await new Promise((resolve) => setTimeout(resolve, 6000))

export function apply(ctx = {}) {
  ctx.logger?.info?.('triage-probe-slow mounted after a 6s import')
}

export default { name, apply }
