// Fixture: a plugin that installs and composes nothing (R18).
//
// The fifth failure shape the probe must tell apart: the package is present, the Host comes up,
// there is no error anywhere -- and the candidate still produced no row. That is
// `probe.row-missing`, not "it works" and not "it crashed".
export const name = 'triage-probe-no-row'

export function apply() {
  // Intentionally registers nothing and inserts no row.
}

export default { name, apply }
