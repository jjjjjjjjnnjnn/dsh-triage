// Imports fine, then throws inside `apply`.
//
// This is the shape that produces a `failed` fiber phase rather than a missing one, so
// the probe must report it differently from an import error.
export const name = 'triage-probe-throw'

export function apply() {
  throw new Error('triage-probe-fixture-throw: intentional apply failure for the probe red path')
}

export default { name, apply }
