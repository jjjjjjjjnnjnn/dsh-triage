/**
 * The copy channel must be a contract, not a folder (R80).
 *
 * WHY: public copy is the one place where a stale number reads as a lie. The repository already learned
 * this for the T-810 drafts (`check_listing` recomputes every cited artifact). Delegating prose to another
 * agent is only safe if the same rule survives the handoff: **facts first, then words**. So this test locks
 * the mechanical part of that handoff — a draft may not exist without a fact pack, and a fact pack may not
 * cite an artifact that is missing or has no `.sha256`.
 *
 * WHAT IT DOES NOT DO: it does not judge prose, does not run `check_listing` (that remains the gate for
 * T-810 drafts), and does not verify that a number in the prose equals the artifact's number. That last
 * check stays with the engineering side until it earns its own rule.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
const list = (dir: string) => {
  const url = new URL(dir, root)
  return existsSync(url) ? readdirSync(url).filter((name) => name.endsWith('.md')).sort() : []
}

test('the copywriter role card and the channel contract exist', () => {
  const role = read('.agents/roles/copywriter.md')
  for (const section of ['## 输入', '## 输出', '## 禁区', '## 验收']) {
    assert.ok(role.includes(section), `the copywriter role card must keep ${section}`)
  }
  const channel = read('docs/copy/README.md')
  for (const phrase of ['事实包', '产物', 'Gemini', 'paste:start']) {
    assert.ok(channel.includes(phrase), `docs/copy/README.md must state ${phrase}`)
  }
})

test('every fact pack cites artifacts that exist and are hash-locked', () => {
  const facts = list('docs/copy/facts/')
  assert.ok(facts.length > 0, 'expected at least one fact pack under docs/copy/facts/')
  for (const file of facts) {
    const text = read(`docs/copy/facts/${file}`)
    const cited = [...text.matchAll(/data\/results\/[A-Za-z0-9._-]+\.json/g)].map((match) => match[0])
    assert.ok(cited.length > 0, `${file} cites no data/results artifact — a fact pack without evidence is prose`)
    for (const artifact of new Set(cited)) {
      assert.ok(existsSync(new URL(artifact, root)), `${file} cites a missing artifact: ${artifact}`)
      assert.ok(existsSync(new URL(`${artifact}.sha256`, root)), `${file} cites ${artifact} without its .sha256`)
    }
  }
})

test('every draft points at a fact pack and carries a paste block', () => {
  const drafts = list('docs/copy/drafts/')
  assert.ok(drafts.length > 0, 'expected at least one draft under docs/copy/drafts/')
  for (const file of drafts) {
    const text = read(`docs/copy/drafts/${file}`)
    const fact = /<!-- facts: (docs\/copy\/facts\/[^ ]+\.md) -->/.exec(text)
    assert.ok(fact !== null, `${file} must name its fact pack in <!-- facts: ... -->`)
    const factPath = fact?.[1] ?? ''
    assert.notEqual(factPath, '', `${file} must name a fact pack path`)
    assert.ok(existsSync(new URL(factPath, root)), `${file} points at a fact pack that does not exist: ${factPath}`)
    assert.match(text, /<!-- paste:start -->[\s\S]+<!-- paste:end -->/, `${file} must carry a paste block`)
    assert.match(text, /不是你那台机器|not your machine/i, `${file} must keep the not-your-machine boundary`)
  }
})
