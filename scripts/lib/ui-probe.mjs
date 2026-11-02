/**
 * Pure helpers for the CDP UI probe in `scripts/record_client_serve.mjs` (T-401 / R33).
 *
 * WHY THIS IS A MODULE: the probe's failure modes are all about NAMES, not about CDP. R33 measured
 * two of them the hard way — "Settings" is only reachable through a prefix match (`设置Ctrl+Alt+,`,
 * the shortcut is part of the accessible name), and the bare word 插件 opens the plugin MANAGER while
 * the settings section that owns `settings.plugins.tab` is called 内置插件. Both are decidable without
 * a browser, so they are decided here and pinned by `tests/unit/ui-probe.test.ts`.
 */

/** Names of the recorded controls, in DOM order. Tolerates a missing/partial snapshot. */
export function controlNames(snapshot) {
  return (snapshot?.controls ?? []).map((control) => String(control.name))
}

/**
 * Pick one control by name: an EXACT match anywhere wins before any prefix match, so an entry that is
 * merely a prefix of another ("settings" vs "settings and more") cannot shadow the real one.
 * Needles are tried in the caller's order, which encodes priority (内置插件 before 插件).
 */
export function pickControl(controls, needles) {
  const names = (controls ?? []).map((control) => String(control.name).toLowerCase())
  for (const needle of needles) {
    const index = names.indexOf(String(needle).toLowerCase())
    if (index !== -1) return controls[index]
  }
  for (const needle of needles) {
    const index = names.findIndex((name) => name.startsWith(String(needle).toLowerCase()))
    if (index !== -1) return controls[index]
  }
  return null
}

/** The first expected label that appears in the page text or among the controls, or null. */
export function tabMatch(snapshot, labels) {
  const text = String(snapshot?.text ?? '')
  for (const label of labels) if (text.includes(label)) return label
  const names = controlNames(snapshot)
  for (const label of labels) if (names.some((name) => name.includes(label))) return label
  return null
}

/* ------------------------------------------------------------------------------------------------
 * "Is this screen an answer?" — the same question, asked twice, answered wrong twice.
 *
 * R51 (2026-10-30): the summary tab rendered `data-triage-kind="pending"` while its fetch was in
 * flight, and the probe read the presence of an error element as a verdict. The run was recorded as
 * `visible: unmeasured` and the fix was a one-line `kind !== 'pending'` in the loop.
 *
 * R61 (2026-11-02): the upgrade screen repeated it. Loading is rendered by the FAILURE view (with
 * `data-triage-kind="loading"`), the probe's loop broke on `error: true` at ~500ms, and the artifact
 * said "the page fetch is still pending" while the same route had answered Node in 815ms.
 *
 * Twice is a missing rule, not two slips. So "decided" is a pure function here, both probes call it,
 * and `tests/unit/ui-probe.test.ts` fails if loading/pending is ever treated as a conclusion again.
 * ---------------------------------------------------------------------------------------------- */

/** Views that mean "the answer has not arrived yet" and must never be read as a verdict. */
export const NOT_A_VERDICT_KINDS = ['pending', 'loading']

/** The four buckets the upgrade screen must render, in the order the CLI prints them. */
export const UPGRADE_BUCKETS = ['would-be-denied', 'cannot-tell', 'improved', 'likely-fine']

/**
 * Judge the summary tab as the DOM probe saw it.
 *
 * @param {{ present?: boolean, mode?: string | null, kind?: string | null } | null | undefined} probe
 * @returns {{ decided: boolean, state: 'absent' | 'pending' | 'answer' | 'failed', reason: string }}
 */
export function judgeTabView(probe) {
  if (probe === null || typeof probe !== 'object' || probe.present !== true) {
    return { decided: false, state: 'absent', reason: 'no tab body is in the DOM yet' }
  }
  const mode = typeof probe.mode === 'string' ? probe.mode : ''
  if (mode === 'summary') {
    return { decided: true, state: 'answer', reason: 'the summary view is on screen' }
  }
  if (mode === 'error') {
    const kind = typeof probe.kind === 'string' ? probe.kind : ''
    if (NOT_A_VERDICT_KINDS.includes(kind)) {
      return { decided: false, state: 'pending', reason: `the tab is still "${kind}" — that is not a verdict` }
    }
    return { decided: true, state: 'failed', reason: `the tab rendered an error view (${kind === '' ? 'no kind' : kind})` }
  }
  return { decided: false, state: 'absent', reason: `the tab reported an unknown mode (${mode === '' ? 'none' : mode})` }
}

/**
 * Judge the on-demand upgrade screen. Only four bucket rows with finite counts are an answer;
 * a loading sentence is not, and neither is an empty table (that would read as "nothing will break").
 *
 * @param {{ view?: string | null, kind?: string | null, counts?: Array<{ bucket?: unknown, count?: unknown }> } | null | undefined} probe
 * @returns {{ decided: boolean, state: 'absent' | 'loading' | 'answer' | 'failed', reason: string }}
 */
export function judgeUpgradeView(probe) {
  if (probe === null || typeof probe !== 'object') {
    return { decided: false, state: 'absent', reason: 'the upgrade probe returned nothing' }
  }
  const view = typeof probe.view === 'string' ? probe.view : ''
  if (view === 'loading') {
    return { decided: false, state: 'loading', reason: 'the upgrade screen is still reading the registry' }
  }
  if (view === 'error') {
    const kind = typeof probe.kind === 'string' ? probe.kind : ''
    return { decided: true, state: 'failed', reason: `the upgrade screen shows a sentence instead of buckets (${kind === '' ? 'no kind' : kind})` }
  }
  if (view !== 'answer') {
    return { decided: false, state: 'absent', reason: 'no upgrade screen is in the DOM yet' }
  }
  const counts = Array.isArray(probe.counts) ? probe.counts : []
  const seen = new Set()
  for (const row of counts) {
    if (row === null || typeof row !== 'object') continue
    const bucket = typeof row.bucket === 'string' ? row.bucket : ''
    const count = row.count
    if (bucket === '' || typeof count !== 'number' || !Number.isFinite(count)) continue
    seen.add(bucket)
  }
  const missing = UPGRADE_BUCKETS.filter((bucket) => !seen.has(bucket))
  if (missing.length > 0) {
    return { decided: true, state: 'failed', reason: `the four-bucket view rendered without ${missing.join(', ')}` }
  }
  return { decided: true, state: 'answer', reason: 'four buckets, each with a count' }
}

/**
 * The sentence a probe writes when it ran out of patience. It must not read as a conclusion either
 * way: "we stopped asking" is a different fact from "the screen is broken" (`unmeasured`, not `failed`).
 */
export function describeNoAnswer(state, waitedMs) {
  const where = state === 'loading' || state === 'pending' ? 'still waiting for the answer' : `still "${state}"`
  return `the probe waited ${waitedMs}ms and the screen was ${where}; no answer arrived, so nothing is claimed`
}

/** The CLI's snake_case count keys, one per bucket the screen prints. */
export const UPGRADE_CLI_KEY = {
  'would-be-denied': 'would_be_denied',
  'cannot-tell': 'cannot_tell',
  improved: 'improved',
  'likely-fine': 'likely_fine',
}

/**
 * "The four numbers on screen are the four numbers the CLI prints" — decided without a browser.
 *
 * R62: this comparison used to be four inline `===`s inside the recorder, so the only way to see it
 * fail was a full two-minute run with a deliberately mismatched screen. As a pure function the
 * disagreement case is a unit test, and the artifact records which bucket disagreed (the old detail
 * said only "they disagree", which is not an answer anyone can act on).
 *
 * @param {Array<{ bucket?: unknown, count?: unknown }> | null | undefined} domCounts
 * @param {Record<string, unknown> | null | undefined} cliCounts
 * @returns {{
 *   same: boolean,
 *   pairs: Array<{ bucket: string, tab: number | null, cli: number | null, agree: boolean }>,
 * }}
 */
export function compareUpgradeBuckets(domCounts, cliCounts) {
  const fromDom = new Map()
  for (const row of Array.isArray(domCounts) ? domCounts : []) {
    if (row === null || typeof row !== 'object') continue
    const bucket = typeof row.bucket === 'string' ? row.bucket : ''
    if (bucket === '') continue
    fromDom.set(bucket, typeof row.count === 'number' && Number.isFinite(row.count) ? row.count : null)
  }
  const pairs = UPGRADE_BUCKETS.map((bucket) => {
    const key = UPGRADE_CLI_KEY[bucket]
    const tab = fromDom.has(bucket) ? fromDom.get(bucket) : null
    const raw = cliCounts === null || typeof cliCounts !== 'object' ? null : cliCounts[key]
    const cli = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
    return { bucket, tab, cli, agree: tab !== null && cli !== null && tab === cli }
  })
  return { same: pairs.every((pair) => pair.agree), pairs }
}
