/**
 * Capability layer contracts (M2-b / T-202 narrowed).
 *
 * These tests encode docs/specs/M2-capabilities.md: the list is a FACT, the diff is a
 * COMPARISON, and neither is allowed to become "this tool should have been here" — the
 * upstream packages publish no static tool names, so that judgement has no evidence.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diffCapabilities, parseCapabilitySnapshot, type CapabilitySnapshot } from '@dsh-triage/core'

const SAMPLED = '2026-10-27T23:30:00.000Z'

function parse(value: unknown): CapabilitySnapshot {
  const parsed = parseCapabilitySnapshot(value, { sampledAt: SAMPLED })
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error.detail)
  return parsed.value
}

test('a deployment with no tool service is not a deployment with zero tools', () => {
  const absent = parse({ registry: null, tools: [] })
  assert.equal(absent.registry, null)
  assert.deepEqual(absent.tools, [])

  const empty = parse({ registry: 'tools', tools: [] })
  assert.equal(empty.registry, 'tools', 'a registry that answered is recorded as one')
  assert.equal(empty.tools.length, 0)
  assert.notEqual(absent.registry, empty.registry, 'the two must stay distinguishable')
})

test('tools are sorted, de-duplicated by refusal, and keep their description', () => {
  const snapshot = parse({
    registry: 'tools',
    tools: [
      { name: 'write', description: 'Write a file' },
      { name: 'read', description: '' },
    ],
    transport: 'in-process-projection',
    unjudged: ['skills', 'commands'],
  })
  assert.deepEqual(snapshot.tools.map((tool) => tool.name), ['read', 'write'])
  assert.equal(snapshot.tools[0]?.description, null, 'an empty description is absence, not text')
  assert.deepEqual(snapshot.unjudged, ['commands', 'skills'], 'unread channels are sorted and surfaced')
  assert.equal(snapshot.transport, 'in-process-projection')

  const duplicate = parseCapabilitySnapshot(
    { registry: 'tools', tools: [{ name: 'read' }, { name: 'read' }] },
    { sampledAt: SAMPLED },
  )
  assert.equal(duplicate.ok, false, 'a hand-assembled duplicate must be refused')
  assert.ok(!duplicate.ok && duplicate.error.detail.includes('read'))
})

test('a refused capability snapshot names the offending field', () => {
  const cases: { value: unknown; includes: string }[] = [
    { value: 'nope', includes: 'not an object' },
    { value: { registry: 'tools' }, includes: 'tools is missing' },
    { value: { registry: 'tools', tools: [{}] }, includes: 'has no name' },
    { value: { registry: 'shell', tools: [] }, includes: 'registry' },
    { value: { registry: 'tools', tools: [], transport: 'carrier-pigeon' }, includes: 'transport' },
  ]
  for (const { value, includes } of cases) {
    const parsed = parseCapabilitySnapshot(value, { sampledAt: SAMPLED })
    assert.equal(parsed.ok, false, `expected a refusal for ${includes}`)
    assert.ok(!parsed.ok && parsed.error.detail.includes(includes), `detail must name "${includes}"`)
  }
})

test('a read error is carried, never flattened into an empty list', () => {
  const snapshot = parse({ registry: 'tools', tools: [], read_error: 'tools.schemas() threw: boom' })
  assert.equal(snapshot.tools.length, 0)
  assert.equal(snapshot.readError, 'tools.schemas() threw: boom')
  assert.equal(parse({ registry: 'tools', tools: [] }).readError, null)
})

test('the diff names what left, what arrived, and proves it compared something', () => {
  const before = parse({ registry: 'tools', tools: [{ name: 'read' }, { name: 'write' }, { name: 'bash' }] })
  const after = parse({ registry: 'tools', tools: [{ name: 'read' }, { name: 'write' }, { name: 'pwsh' }] })
  const diff = diffCapabilities(before, after)
  assert.deepEqual(diff.removed, ['bash'])
  assert.deepEqual(diff.added, ['pwsh'])
  assert.equal(diff.unchanged, 2)

  const identical = diffCapabilities(before, before)
  assert.deepEqual(identical.removed, [])
  assert.deepEqual(identical.added, [])
  assert.equal(identical.unchanged, 3, 'a no-op comparison still reports what it compared')
})

test('a diff is not a verdict: an unchanged registry yields no claims at all', () => {
  const before = parse({ registry: null, tools: [] })
  const after = parse({ registry: 'tools', tools: [{ name: 'working_directory' }] })
  const diff = diffCapabilities(before, after)
  // The registry appearing (or not) is a fact about the sample, and `added` says so
  // without inventing a conclusion about the deployment.
  assert.deepEqual(diff.added, ['working_directory'])
  assert.deepEqual(diff.removed, [])
})
