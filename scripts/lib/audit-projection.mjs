/**
 * What `record_audit.mjs` writes down about duplicate copies (R94).
 *
 * WHY THIS IS A MODULE AND NOT THREE LINES IN THE RECORDER: the recorder used to keep its own
 * projection — `{ name, kind, copies }` — and dropped `surface`. That field is the one thing the
 * whole of R92 turns on: since R92 a duplicate group is only a finding when the package can take
 * part in DSH's own loading, and `surface: false` means "counted, not a finding". Dropping it made
 * the artifact unable to support the sentence the round was built to prove ("13 groups, 0 findings"):
 * a reader could see thirteen groups and no verdicts, but not *why*.
 *
 * So the projection lives here, is pure, and is unit-tested in both directions. Two traps it exists
 * to avoid:
 *
 *   - **Absence is not `false`.** A hand-built duplicate with no `surface` is a finding by the
 *     engine's rule (`surface !== false`), so the artifact must not record it as `false` — that
 *     would launder an unstated group into a downgraded one.
 *   - **The summary must be the engine's number, not a re-derivation.** `findings` is passed in
 *     rather than recomputed from the groups, because the engine also drops same-version groups and
 *     groups with fewer than two readable versions. A second copy of that rule here would drift.
 */

/**
 * One duplicate group, with the field the verdict turns on.
 *
 * @param {{ name: string, kind: string, surface?: boolean, copies: readonly { scope: string, path: string, version: string | null }[] }} duplicate
 * @returns {{ name: string, kind: string, surface: boolean | null, copies: { scope: string, path: string, version: string | null }[] }}
 */
export function projectDuplicate(duplicate) {
  const copies = Array.isArray(duplicate?.copies) ? duplicate.copies : []
  return {
    name: typeof duplicate?.name === 'string' ? duplicate.name : '',
    kind: typeof duplicate?.kind === 'string' ? duplicate.kind : 'unknown',
    // `null`, never `false`: "the scanner did not say" and "the scanner said no" are different facts.
    surface: duplicate?.surface === true ? true : duplicate?.surface === false ? false : null,
    copies: copies.map((copy) => ({
      scope: typeof copy?.scope === 'string' ? copy.scope : 'unknown',
      path: typeof copy?.path === 'string' ? copy.path : '',
      version: typeof copy?.version === 'string' ? copy.version : null,
    })),
  }
}

/**
 * @param {{ groups: readonly unknown[], findings: number }} input
 * @returns {{ groups: number, findings: number, downgraded: number, unstated_surface: number, different_versions: number }}
 */
export function summariseDuplicates(input) {
  const groups = Array.isArray(input?.groups) ? input.groups.map(projectDuplicate) : []
  const findings = Number.isInteger(input?.findings) && input.findings >= 0 ? input.findings : 0
  return {
    groups: groups.length,
    findings,
    downgraded: groups.filter((group) => group.surface === false).length,
    unstated_surface: groups.filter((group) => group.surface === null).length,
    different_versions: groups.filter((group) => group.kind === 'different-versions').length,
  }
}
