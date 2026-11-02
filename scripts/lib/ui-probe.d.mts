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

/* ------------------------------------------------------------------------------------------------
 * "Is this screen an answer?" — see the long comment in `ui-probe.mjs`. Both probes (summary and the
 * on-demand upgrade screen) must go through these two functions, which is what makes "loading is not
 * a verdict" a rule instead of a habit.
 * ---------------------------------------------------------------------------------------------- */

export type ViewState = 'absent' | 'pending' | 'loading' | 'answer' | 'failed'

export interface ViewJudgement<State extends ViewState = ViewState> {
  decided: boolean
  state: State
  reason: string
}

/** What the summary probe reads off `[data-triage-tab]`. */
export interface TabProbeView {
  present?: boolean
  mode?: string | null
  kind?: string | null
}

/** What the upgrade probe reads off `[data-triage-tab="upgrade*"]`. */
export interface UpgradeProbeView {
  view?: string | null
  kind?: string | null
  counts?: Array<{ bucket?: unknown, count?: unknown }>
}

export const NOT_A_VERDICT_KINDS: string[]
export const UPGRADE_BUCKETS: string[]

export function judgeTabView(
  probe: TabProbeView | null | undefined,
): ViewJudgement<'absent' | 'pending' | 'answer' | 'failed'>

export function judgeUpgradeView(
  probe: UpgradeProbeView | null | undefined,
): ViewJudgement<'absent' | 'loading' | 'answer' | 'failed'>

export function describeNoAnswer(state: string, waitedMs: number): string

export const UPGRADE_CLI_KEY: Record<string, string>

export interface UpgradeBucketPair {
  bucket: string
  tab: number | null
  cli: number | null
  agree: boolean
}

export function compareUpgradeBuckets(
  domCounts: Array<{ bucket?: unknown, count?: unknown }> | null | undefined,
  cliCounts: Record<string, unknown> | null | undefined,
): { same: boolean, pairs: UpgradeBucketPair[] }
