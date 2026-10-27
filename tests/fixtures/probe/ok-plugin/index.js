// The smallest plugin that proves the loader can mount a candidate at all.
//
// It registers nothing on purpose: the probe's job in this round is to answer
// "did it install, compose and serve", not "what tools does it add" (that surface
// lives in agent scope — BS-21 — and is out of reach of a process-level probe).
export const name = 'triage-probe-ok'

export function apply(ctx = {}) {
  ctx.logger?.info?.('triage-probe-ok mounted')
}

export default { name, apply }
