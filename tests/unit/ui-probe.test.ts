import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compareUpgradeBuckets,
  controlNames,
  describeNoAnswer,
  judgeTabView,
  judgeUpgradeView,
  tabMatch,
  pickControl,
} from '../../scripts/lib/ui-probe.mjs'

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

/*
 * R51 and R61 are the same bug, twice: an in-flight screen was read as an answer. The summary tab
 * rendered `data-triage-kind="pending"` (R51) and the upgrade screen renders `loading` through its
 * FAILURE view (R61) — the probe's "is there an error element" test said "yes, decided" while the
 * answer was still on the wire. The four cases below are the rule that stops the third time.
 */

test('a summary tab that is still fetching is not a verdict (R51)', () => {
  const pending = judgeTabView({ present: true, mode: 'error', kind: 'pending' })
  assert.equal(pending.decided, false)
  assert.equal(pending.state, 'pending')

  // Same class, other spelling: a stale bundle could render `loading` on the summary side too.
  assert.equal(judgeTabView({ present: true, mode: 'error', kind: 'loading' }).decided, false)
})

test('a rendered summary IS the verdict, and a real error view is too', () => {
  assert.equal(judgeTabView({ present: true, mode: 'summary', kind: null }).state, 'answer')
  const failed = judgeTabView({ present: true, mode: 'error', kind: 'route-missing' })
  assert.equal(failed.decided, true)
  assert.equal(failed.state, 'failed')
})

test('no tab body yet is never decided, in either direction', () => {
  assert.equal(judgeTabView({ present: false }).decided, false)
  assert.equal(judgeTabView(null).decided, false)
  assert.equal(judgeTabView({ present: true, mode: 'mystery' }).decided, false)
})

test('the upgrade screen keeps loading until four buckets with counts exist (R61)', () => {
  assert.equal(judgeUpgradeView({ view: 'loading' }).decided, false)
  assert.equal(judgeUpgradeView({ view: 'loading' }).state, 'loading')
})

test('four buckets are the answer; anything less is a structure failure, not a pass', () => {
  const full = judgeUpgradeView({
    view: 'answer',
    counts: [
      { bucket: 'would-be-denied', count: 3 },
      { bucket: 'cannot-tell', count: 189 },
      { bucket: 'improved', count: 0 },
      { bucket: 'likely-fine', count: 2 },
    ],
  })
  assert.equal(full.decided, true)
  assert.equal(full.state, 'answer')

  const short = judgeUpgradeView({
    view: 'answer',
    counts: [
      { bucket: 'would-be-denied', count: 3 },
      { bucket: 'cannot-tell', count: 189 },
      { bucket: 'improved', count: 0 },
    ],
  })
  assert.equal(short.state, 'failed')
  assert.match(short.reason, /likely-fine/)

  // A bucket whose count did not survive the DOM read (NaN) cannot count as present.
  const broken = judgeUpgradeView({
    view: 'answer',
    counts: [
      { bucket: 'would-be-denied', count: Number.NaN },
      { bucket: 'cannot-tell', count: 189 },
      { bucket: 'improved', count: 0 },
      { bucket: 'likely-fine', count: 2 },
    ],
  })
  assert.equal(broken.state, 'failed')
  assert.match(broken.reason, /would-be-denied/)
})

test('an offline sentence is decided-failed, and no screen at all is neither', () => {
  const offline = judgeUpgradeView({ view: 'error', kind: 'http' })
  assert.equal(offline.decided, true)
  assert.equal(offline.state, 'failed')
  assert.equal(judgeUpgradeView({ view: 'absence' }).decided, false)
  assert.equal(judgeUpgradeView(null).decided, false)
})

test('giving up is not a conclusion: the no-answer sentence claims nothing', () => {
  const text = describeNoAnswer('loading', 20_000)
  assert.match(text, /waited 20000ms/)
  assert.match(text, /nothing is claimed/)
  assert.doesNotMatch(text, /break|passed|failed/)
})

/*
 * The four buckets on screen versus the four buckets the CLI prints. This used to be four inline
 * `===`s in the recorder; R62 moved it here so the disagreement case is a test rather than a
 * two-minute real-machine run with a hand-corrupted screen.
 */

const SCREEN_BUCKETS = [
  { bucket: 'would-be-denied', count: 3 },
  { bucket: 'cannot-tell', count: 190 },
  { bucket: 'improved', count: 0 },
  { bucket: 'likely-fine', count: 2 },
]

const CLI_SAME = { would_be_denied: 3, cannot_tell: 190, improved: 0, likely_fine: 2 }

test('the tab and the CLI agree when every bucket matches', () => {
  const comparison = compareUpgradeBuckets(SCREEN_BUCKETS, CLI_SAME)
  assert.equal(comparison.same, true)
  assert.deepEqual(
    comparison.pairs.map((pair) => pair.bucket),
    ['would-be-denied', 'cannot-tell', 'improved', 'likely-fine'],
  )
})

test('one bucket off by one is a disagreement, and the bucket is named', () => {
  // The negative control R62 needs: a screen that is 99% right must not be recorded as agreement.
  const comparison = compareUpgradeBuckets(SCREEN_BUCKETS, { ...CLI_SAME, cannot_tell: 191 })
  assert.equal(comparison.same, false)
  const wrong = comparison.pairs.filter((pair) => !pair.agree)
  assert.equal(wrong.length, 1)
  assert.equal(wrong[0]?.bucket, 'cannot-tell')
  assert.equal(wrong[0]?.tab, 190)
  assert.equal(wrong[0]?.cli, 191)
})

test('a missing bucket is a disagreement, never a silent "equal to nothing"', () => {
  const comparison = compareUpgradeBuckets(SCREEN_BUCKETS.slice(0, 3), CLI_SAME)
  assert.equal(comparison.same, false)
  assert.deepEqual(
    comparison.pairs.filter((pair) => !pair.agree).map((pair) => pair.bucket),
    ['likely-fine'],
  )
})

test('an unreadable CLI payload cannot pass by accident', () => {
  assert.equal(compareUpgradeBuckets(SCREEN_BUCKETS, null).same, false)
  assert.equal(compareUpgradeBuckets(null, CLI_SAME).same, false)
  // A NaN count (an attribute the DOM read as garbage) is not a match for a real number.
  const withNaN = [...SCREEN_BUCKETS.slice(0, 3), { bucket: 'likely-fine', count: Number.NaN }]
  assert.equal(compareUpgradeBuckets(withNaN, CLI_SAME).same, false)
})
