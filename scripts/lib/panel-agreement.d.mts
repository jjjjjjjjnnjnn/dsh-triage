/**
 * Hand-written types for `scripts/lib/panel-agreement.mjs`.
 *
 * The recorders are plain JS (they must run without a build step); the tests are TS. Without this file
 * `tsc -p tsconfig.tests.json` refuses the import with an implicit `any`, and the repository's
 * convention is to type the helper rather than to cast at the call site.
 */

export interface PanelSide {
  dsh: string | null
  dshSource: string | null
  counts: Record<string, number | null> | null
}

export interface AgreementMismatch {
  field: string
  panel: unknown
  cli: unknown
}

export interface PanelAgreement {
  agree_on_version: boolean
  agree_on_actionable: boolean
  mismatches: AgreementMismatch[]
  row_counts_differ: boolean
}

export declare const ACTIONABLE_FIELDS: readonly string[]
export declare function judgePanelAgreement(panel: PanelSide, cli: PanelSide): PanelAgreement
