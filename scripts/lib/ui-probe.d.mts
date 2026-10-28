/**
 * Types for `scripts/lib/ui-probe.mjs`, which the UI-probe unit test imports directly.
 *
 * WHY A HAND-WRITTEN DECLARATION: gate/record scripts are plain `.mjs` on purpose (zero dependencies,
 * runnable without a build), but `tsconfig.tests.json` type-checks every test, and an implicit `any`
 * on a name-matching helper is exactly where a silent typo would hide.
 */

/** One control as the CDP snapshot records it. */
export interface UiControl {
  tag: string
  role: string
  name: string
}

/** The page as the probe sees it; every field may be absent in a partial snapshot. */
export interface UiSnapshot {
  url?: string
  text?: string
  controls?: UiControl[]
}

export function controlNames(snapshot: UiSnapshot | null | undefined): string[]

export function pickControl(
  controls: UiControl[] | null | undefined,
  needles: string[],
): UiControl | null

export function tabMatch(snapshot: UiSnapshot | null | undefined, labels: string[]): string | null
