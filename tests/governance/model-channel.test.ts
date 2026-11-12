/**
 * R102 · the model channel: no *instruction* may still tell an agent to call an external model CLI.
 *
 * WHY: HUMAN 2026-11-12 — "停止使用 gemini 和 agy 调用，全链路你自己使用当前模型进行". The rule is only
 * worth anything if it is checked, because the repository had **eleven** places telling the next agent
 * to shell out to `agy`, and none of them was ever read by a test. A stale instruction is worse than
 * no instruction: it sends the next agent to a channel whose availability is outside this repo
 * (`BS-58`), and it splits "who writes" from "who checks" into two models that cannot see each other.
 *
 * WHAT IS *NOT* CHECKED, ON PURPOSE: history. `audit/AI_DISCLOSURE_LOG.md`, `_archive/**`,
 * `docs/copy/outreach.json`, `audit/step_reviews.json`, `docs/distribution/T-810/**` and `data/**`
 * record **what actually happened** in earlier rounds. Rewriting them would be the same defect as
 * rewriting a measurement, so the scanner is pointed at the *operative* documents only.
 *
 * The synthetic case at the bottom is the negative control: the same matcher must catch a re-injected
 * instruction. Without it, "zero findings" could just mean "the matcher never matches".
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

/**
 * Documents that tell someone what to do next. Everything here must speak in the current model.
 */
const OPERATIVE_DOCUMENTS = [
  'AGENTS.md',
  'INDEX.md',
  'PROJECT_RULES.md',
  'CONTRIBUTING.md',
  '.agents/README.md',
  '.agents/roles/copywriter.md',
  '.agents/rules/execution-playbook.md',
  'docs/HANDOFF.md',
  'docs/ROADMAP.md',
  'docs/BACKLOG.md',
  'docs/11-d-path.md',
  'docs/copy/README.md',
  'docs/copy/STYLE.md',
  'docs/distribution/posting-runbook.md',
]

/** Documents whose whole job is to describe how the channel works, in the present tense. */
const currentDocuments = () => OPERATIVE_DOCUMENTS.filter((path) => existsSync(new URL(path, root)))

/**
 * One instruction shape: a line that names a model CLI as the thing to run.
 *
 * Deliberately narrow: it needs the CLI *and* a verb that makes it an instruction (`调用` / `走` /
 * `由 … 写` / `--print=`), so a sentence recalling history ("R97 那轮 `agy` 四次超时") does not trip it.
 */
const INSTRUCTION_SHAPES = [
  /agy\s+--model/i,
  /agy\s*--print/i,
  /由外部\s*`?agy`?/i,
  /外部\s*`?agy`?\s*写/i,
  /文案(?:一律)?走外部\s*`?agy`?/i,
  /调用\s*`?(?:agy|gemini)`?/i,
  /gemini-3\.8-flash-high/i,
]

/**
 * Markers that make a line a *record* instead of an instruction.
 *
 * Two kinds, both learned from this repository's own text:
 *   - **negation / retirement** — 「不得」「禁止」「不再」「已退役」「改通道」「不回改」. The rule sentence
 *     itself ("**不得**调用 `agy`") must not be read as "call `agy`".
 *   - **round attribution** — a batch row names the round it records (`（R97，2026-11-12）`) and a ledger
 *     step names its id (`R102-S2`). Those are logs; a fresh instruction does not announce its round.
 */
const RECORD_MARKERS = [/不得/, /禁止/, /不再/, /已退役/, /改通道/, /不回改/, /历史/, /（R\d+[，,]/, /R\d+-S\d+/, /R10[12]\s*改/]

/** @returns {{ path: string, line: number, text: string, shape: string }[]} */
export function findExternalModelInstructions(documents: { path: string, text: string }[]) {
  const found = []
  for (const document of documents) {
    const lines = document.text.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      // A line that marks itself as a record is not an instruction.
      if (RECORD_MARKERS.some((marker) => marker.test(line))) continue
      for (const shape of INSTRUCTION_SHAPES) {
        if (shape.test(line)) {
          found.push({ path: document.path, line: index + 1, text: line.trim().slice(0, 160), shape: String(shape) })
          break
        }
      }
    }
  }
  return found
}

test('no operative document still instructs anyone to call an external model CLI', () => {
  const documents = currentDocuments().map((path) => ({ path, text: read(path) }))
  assert.ok(documents.length >= 10, `expected the operative document set to be present, found ${documents.length}`)
  const found = findExternalModelInstructions(documents)
  assert.deepEqual(
    found,
    [],
    `these lines still tell the next agent to call an external model CLI:\n${found
      .map((hit) => `  ${hit.path}:${hit.line} — ${hit.text}`)
      .join('\n')}`,
  )
})

test('the copy channel states the current-model rule rather than the retired external one', () => {
  const channel = read('docs/copy/README.md')
  assert.match(channel, /当前会话的模型/, 'docs/copy/README.md must name the in-session model as the writer')
  assert.match(channel, /不得.*外部模型 CLI|不得.*agy/, 'docs/copy/README.md must forbid the external CLIs')
  assert.ok(channel.includes('BS-72'), 'the cost of losing the second pair of eyes must be registered')
  const agents = read('AGENTS.md')
  assert.match(agents, /不得\*\*调用 `agy` \/ `gemini`/, 'AGENTS.md must carry the same prohibition')
})

test('history keeps its `agy` records — the rule is about instructions, not about the past', () => {
  // The disclosure log records what earlier rounds actually did. If this file ever becomes "clean",
  // history has been rewritten, and the archive rule (`PROJECT_RULES` #7) has been broken.
  const log = read('audit/AI_DISCLOSURE_LOG.md')
  assert.ok(log.includes('agy'), 'the disclosure log must keep recording the channel that was actually used')
})

test('N1: the matcher catches a re-injected instruction (the control that keeps the rule honest)', () => {
  const injected = [
    {
      path: 'docs/copy/README.md',
      text: '英文措辞由外部 `agy --model gemini-3.8-flash-high` 写（规则见 docs/copy/README.md），由 HUMAN 发。\n',
    },
    { path: 'docs/HANDOFF.md', text: '文案一律走外部 `agy` 读事实包生成。\n' },
    { path: 'AGENTS.md', text: '文案由外部 `agy` 调用 `gemini-3.8-flash-high` 生成。\n' },
  ]
  const found = findExternalModelInstructions(injected)
  assert.equal(found.length, 3, 'all three injected shapes must be caught')
})

test('N2: a line that marks itself as retired is not flagged (no false positive on the fix itself)', () => {
  const retired = [
    { path: 'docs/HANDOFF.md', text: '**R102 改通道**：不再调用 `agy` / `gemini`，文案在会话内写。\n' },
    { path: 'docs/copy/README.md', text: '历史产物里的 `agy` 字样不回改：它们记录的是当时真实发生过的事。\n' },
  ]
  assert.deepEqual(findExternalModelInstructions(retired), [])
})
