/**
 * The card's title must name the version the card resolved, not the keyword you typed (R94).
 *
 * WHY THESE CASES: the first R94 run of `record_upgrade_card.mjs --to latest` recorded 13/14 with the only
 * red being `card-titles-the-target`, while the card itself printed `# 升级日 · 0.2.2-rc.1` — the correct
 * title for the version `latest` resolved to. The check was comparing against the keyword. A false red is
 * worse than no check: it teaches the next reader to skip that line. So the judgement is extracted and
 * pinned in both directions — the keyword case must pass, and a title that names the wrong version must
 * still be red, otherwise "the fix" would have simply disabled the check.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { judgeCardTitle } from '../../scripts/lib/card-target.mjs'

test('a keyword target is satisfied by the version it resolved to', () => {
  const verdict = judgeCardTitle({ title: '# 升级日 · 0.2.2-rc.1', keyword: 'latest', resolved: '0.2.2-rc.1' })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.expected, '0.2.2-rc.1')
})

test('an explicit target still has to appear in the title', () => {
  assert.equal(judgeCardTitle({ title: '# 升级日 · 0.2.2-rc.1', keyword: '0.2.2-rc.1', resolved: '0.2.2-rc.1' }).ok, true)
})

test('NEGATIVE CONTROL: a title naming a different version is red, even for a keyword run', () => {
  // This is the case that must never pass: "fix the false red" must not mean "stop checking".
  const verdict = judgeCardTitle({ title: '# 升级日 · 0.2.1-rc.5', keyword: 'latest', resolved: '0.2.2-rc.1' })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.detail.includes('0.2.1-rc.5'))
})

test('NEGATIVE CONTROL: a title that is not a heading is red', () => {
  assert.equal(judgeCardTitle({ title: '升级日 · 0.2.2-rc.1', keyword: 'latest', resolved: '0.2.2-rc.1' }).ok, false)
})

test('a missing resolved version falls back to the keyword, and an empty title is red', () => {
  assert.equal(judgeCardTitle({ title: '# 升级日 · next', keyword: 'next', resolved: null }).ok, true)
  assert.equal(judgeCardTitle({ title: '   ', keyword: 'next', resolved: null }).ok, false)
  assert.equal(judgeCardTitle({ title: '# 升级日 · x', keyword: '   ', resolved: '' }).ok, false)
})

test('the judging is case- and whitespace-honest about the resolved version', () => {
  // The resolved value is trimmed before use, so a stray newline from a registry body cannot produce a
  // title that "contains" the version by accident.
  assert.equal(judgeCardTitle({ title: '# 升级日 · 0.2.2-rc.1', keyword: 'latest', resolved: ' 0.2.2-rc.1\n' }).ok, true)
  assert.equal(judgeCardTitle({ title: '# 升级日 · v0.2.2-rc.1x', keyword: 'latest', resolved: '0.2.2-rc.1' }).ok, true)
})
