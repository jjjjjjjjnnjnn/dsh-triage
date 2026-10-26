import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
const readJson = (path: string) => JSON.parse(read(path)) as Record<string, unknown>

test('gate ledger and scripts/ stay in sync', () => {
  const ledger = readJson('audit/gate_ledger.json') as { gates: { id: string; script: string; negative_control: string }[] }
  const onDisk = readdirSync(new URL('scripts/', root))
    .filter((name) => /^gate_.*\.mjs$/.test(name))
    .map((name) => `scripts/${name}`)
    .sort()
  const registered = ledger.gates.map((gate) => gate.script).sort()
  assert.deepEqual(registered, onDisk, 'every gate file must be registered, and vice versa')
})

test('every gate declares a negative control', () => {
  const ledger = readJson('audit/gate_ledger.json') as { gates: { id: string; negative_control: string }[] }
  for (const gate of ledger.gates) {
    assert.ok(gate.negative_control.includes('--mutate'), `${gate.id} needs a mutate control`)
  }
})

test('AI disclosure log has at least one round with a session slot', () => {
  const log = read('audit/AI_DISCLOSURE_LOG.md')
  assert.ok(log.includes('### '), 'expected at least one round entry')
  assert.ok(log.includes('SessionID'), 'round entries must carry a SessionID field')
})

test('blind spots are actionable, not decorative', () => {
  const payload = readJson('audit/blind_spots.json') as {
    blind_spots: { id: string; area: string; cannot_see: string; mitigation: string; owner: string }[]
  }
  assert.ok(payload.blind_spots.length >= 3)
  for (const spot of payload.blind_spots) {
    assert.match(spot.id, /^BS-\d{2}$/)
    assert.ok(spot.mitigation.length > 10, `${spot.id} mitigation`)
    assert.ok(spot.owner.length > 0)
  }
})

test('quarantine manifest records licences and usage boundaries', () => {
  const payload = readJson('quarantine/vendor-manifest.json') as {
    entries: { id: string; license: string; usage: string; commercial_ok: boolean }[]
  }
  assert.ok(payload.entries.length >= 1)
  for (const entry of payload.entries) {
    assert.ok(entry.license.length > 0, `${entry.id} license`)
    assert.ok(entry.usage.length > 0, `${entry.id} usage`)
    assert.equal(typeof entry.commercial_ok, 'boolean')
  }
})

test('README states the honest boundaries (no security guarantee) in both languages', async () => {
  const zh = read('README.zh-CN.md')
  const en = read('README.md')
  assert.match(zh, /不提供安全背书/)
  assert.match(en, /do \*\*not\*\* provide security assurances/i)
})

test('agent role cards are complete (输入/输出/禁区/验收)', () => {
  const dir = new URL('.agents/roles/', root)
  const files = readdirSync(dir).filter((name) => name.endsWith('.md'))
  assert.ok(files.length >= 5, `expected >=5 role cards, got ${files.length}`)
  for (const file of files) {
    const text = readFileSync(new URL(file, dir), 'utf8')
    for (const section of ['## 输入', '## 输出', '## 禁区', '## 验收']) {
      assert.ok(text.includes(section), `${file} missing ${section}`)
    }
  }
})

test('prompt templates all expose a 模板 section', () => {
  const dir = new URL('.agents/prompts/', root)
  const files = readdirSync(dir).filter((name) => name.endsWith('.md'))
  assert.ok(files.length >= 3, `expected >=3 templates, got ${files.length}`)
  for (const file of files) {
    assert.ok(readFileSync(new URL(file, dir), 'utf8').includes('## 模板'), `${file} missing 模板`)
  }
})

test('handoff entry has a current batch and one runnable first task', () => {
  const handoff = read('docs/HANDOFF.md')
  assert.ok(handoff.includes('## 2. 当前批次'))
  assert.ok(handoff.includes('## 3. 下一位 agent 的第一件事'))
  assert.match(handoff, /```powershell/)
  assert.ok(read('AGENTS.md').includes('.agents/README.md'), 'AGENTS.md must link the agent framework')
})
