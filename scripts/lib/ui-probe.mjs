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
