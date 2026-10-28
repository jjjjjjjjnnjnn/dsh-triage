import assert from 'node:assert/strict'
import { test } from 'node:test'
import { controlNames, tabMatch, pickControl } from '../../scripts/lib/ui-probe.mjs'

/*
 * Why these cases: every one is a real failure mode measured on a live Host in R33. The probe's
 * mistakes are naming mistakes, and a naming mistake in this probe produces exactly the failure this
 * project exists to attribute — a green light for something that is not there, or a red light for a
 * tab that is.
 */

const control = (name: string) => ({ tag: 'button', role: '', name })

test('an exact name wins before any prefix match', () => {
  // "settings and more" is a prefix-collision candidate: it appears first in the DOM.
  const controls = [control('Settings and more'), control('Settings')]
  assert.equal(pickControl(controls, ['settings'])?.name, 'Settings')
})

test('a shortcut suffix is matched by prefix, because that is how the Host names the entry', () => {
  // Measured: the settings entry's accessible name is "设置Ctrl+Alt+," — no exact match exists.
  const controls = [control('打开侧边栏'), control('设置Ctrl+Alt+,')]
  assert.equal(pickControl(controls, ['设置'])?.name, '设置Ctrl+Alt+,')
})

test('the plugin settings section is preferred over the plugin manager that shares its prefix', () => {
  // R33 measured both on one page: 插件 = plugin manager (no settings.plugins.tab),
  // 内置插件 = the settings section that owns the slot. Order in DOM must not decide this.
  const controls = [control('插件'), control('内置插件')]
  assert.equal(pickControl(controls, ['内置插件', '内置插件', '插件'])?.name, '内置插件')
})

test('no match is null, never a silent pick', () => {
  assert.equal(pickControl([control('继续'), control('更多')], ['settings', '设置']), null)
  assert.equal(pickControl([], ['settings']), null)
  assert.equal(pickControl(undefined, ['settings']), null)
})

test('the tab label is found in the page text or among the controls', () => {
  assert.equal(tabMatch({ text: '插件视图 分诊台 插件列表', controls: [] }, ['分诊台', 'Triage']), '分诊台')
  assert.equal(tabMatch({ text: '', controls: [control('Triage')] }, ['分诊台', 'Triage']), 'Triage')
})

test('a missing tab label stays null (the negative control depends on this)', () => {
  // The recorded negative control runs this probe with a label that cannot exist; if this ever
  // returned a label the control would pass for the wrong reason.
  assert.equal(tabMatch({ text: '插件视图 插件列表', controls: [control('插件列表')] }, ['absolutely-not-a-tab-xyz']), null)
  assert.equal(tabMatch(null, ['分诊台']), null)
})

test('control names tolerate a partial snapshot', () => {
  assert.deepEqual(controlNames({ controls: [control('a'), control('b')] }), ['a', 'b'])
  assert.deepEqual(controlNames(null), [])
  assert.deepEqual(controlNames({}), [])
})
