// Fixture: slower than the hook's settle budget (R18 / BS-26).
//
// Same mechanism as slow-plugin (a top-level await on the module), but 20s > the hook's 15s
// settle budget, so the sample must come back `settled: false` and the verdict must be
// `unknown` + `missing.inventory` -- not `blocked` (we never saw the row fail) and not `go`
// (we never saw the tree settle).
export const name = 'triage-probe-slow-overrun'

await new Promise((resolve) => setTimeout(resolve, 20000))

export function apply(ctx = {}) {
  ctx.logger?.info?.('triage-probe-slow-overrun mounted after the settle budget')
}

export default { name, apply }
