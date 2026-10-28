import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/*
 * Doc drift is a real defect, not cosmetic (R33): HANDOFF said R32 while INDEX still said R29 and the
 * ROADMAP said R15, and HANDOFF's line 2 was a stray table row left outside any table. Every reader is
 * told to start from these three files, so a wrong stand sends them to the wrong round.
 *
 * These run as plain tests rather than a new gate injection on purpose: `audit/gate_ledger.json`'s
 * `negative_control` is a frozen area (HANDOFF §5), and adding an injection there needs a HUMAN sign.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const standOf = (text: string) => {
  const match = /^\s*>?\s*\*\*Stand\*\*:\s*R(\d+)/m.exec(text)
  return match === null ? null : Number(match[1])
}
/** JSON ledgers store the round as a bare string (`"stand": "R33 (2026-10-29)"`). */
const roundOf = (value: unknown) => {
  const match = /R(\d+)/.exec(String(value ?? ''))
  return match === null ? null : Number(match[1])
}

test('HANDOFF, INDEX and ROADMAP agree on the round', () => {
  const rounds = {
    'docs/HANDOFF.md': standOf(read('docs/HANDOFF.md')),
    'INDEX.md': standOf(read('INDEX.md')),
    'docs/ROADMAP.md': standOf(read('docs/ROADMAP.md')),
  }
  for (const [file, round] of Object.entries(rounds)) {
    assert.notEqual(round, null, `${file} must carry a "**Stand**: R<n>" line`)
  }
  const unique = new Set(Object.values(rounds))
  assert.equal(unique.size, 1, `the three entry documents disagree on the round: ${JSON.stringify(rounds)}`)
})

test('the ledgers agree with the entry documents', () => {
  const entry = standOf(read('docs/HANDOFF.md')) as number
  const ledger = JSON.parse(read('audit/step_reviews.json')) as { stand?: string }
  const spots = JSON.parse(read('audit/blind_spots.json')) as { stand?: string }
  assert.equal(roundOf(ledger.stand), entry, 'audit/step_reviews.json stand lags the handoff')
  assert.equal(roundOf(spots.stand), entry, 'audit/blind_spots.json stand lags the handoff')
})

test('HANDOFF does not start with a stray table row outside a table', () => {
  // The R32 handover left `| T-313 … |` on line 2, above the stand line: a table row with no header.
  const lines = read('docs/HANDOFF.md').split('\n')
  const firstContent = lines.findIndex((line) => line.trim() !== '')
  assert.equal(lines[firstContent]?.trim(), '# HANDOFF · 交接入口', 'the handoff must open with its title')
  const stray = lines.findIndex((line, index) => index > firstContent && /^\|\s*T-\d+/.test(line) && index < 6)
  assert.equal(stray, -1, `a table row leaked out of its table near the top (line ${stray + 1})`)
})

test('every new ADR is listed in INDEX', () => {
  const index = read('INDEX.md')
  for (const adr of ['0010-same-source-in-tab']) {
    assert.ok(index.includes(adr), `INDEX.md must mention docs/adr/${adr}`)
  }
})
