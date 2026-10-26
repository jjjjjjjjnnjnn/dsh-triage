import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  extractEntryClaims,
  findEntryIdCollisions,
  groupClaimsBySource,
  parsePatchYaml,
} from '@dsh-triage/core'

const PATCH = `
- id: compat-verdict
  name: dsh-triage/host
- id: tools
  name: '@deepseek-ai/dsh-tools'
- group: true
  id: compat-group
  config:
    ignored: true
  insert:
    - id: compat-inner
      name: dsh-triage/inner
      disabled: true
`

test('patch parsing yields rows including nested inserts', () => {
  const parsed = parsePatchYaml(PATCH)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const claims = extractEntryClaims(parsed.value, 'bundle:test')
  assert.deepEqual(
    claims.map((claim) => claim.id),
    ['compat-verdict', 'tools', 'compat-group', 'compat-inner'],
  )
  const inner = claims.find((claim) => claim.id === 'compat-inner')
  assert.equal(inner?.disabled, true)
  assert.equal(inner?.name, 'dsh-triage/inner')
  const group = claims.find((claim) => claim.id === 'compat-group')
  assert.equal(group?.group, true)
})

test('config values are never interpreted as rows', () => {
  const parsed = parsePatchYaml(`- id: compat-x\n  config:\n    id: not-a-row\n`)
  assert.ok(parsed.ok)
  if (!parsed.ok) return
  const claims = extractEntryClaims(parsed.value, 's')
  assert.deepEqual(claims.map((claim) => claim.id), ['compat-x'])
})

test('invalid yaml becomes a typed error instead of throwing', () => {
  const parsed = parsePatchYaml('- id: [unclosed')
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.equal(parsed.error.code, 'patch-invalid')
})

test('two layers defining the same id with different modules are conflicting definitions', () => {
  const claims = [
    ...extractEntryClaims([{ id: 'plugin-manager', name: 'a' }], 'bundle:a'),
    ...extractEntryClaims([{ id: 'plugin-manager', name: 'b' }], 'bundle:b'),
  ]
  const collisions = findEntryIdCollisions(claims)
  assert.equal(collisions.length, 1)
  assert.equal(collisions[0]?.kind, 'conflicting-definitions')
  assert.deepEqual(collisions[0]?.owners, ['bundle:a', 'bundle:b'])
  assert.deepEqual(collisions[0]?.names, ['a', 'b'])
  assert.equal(collisions[0]?.count, 2)
})

test('a pure override is not a collision (regression: a stock profile reported 27 false blocks)', () => {
  const claims = [
    // base defines the row
    ...extractEntryClaims([{ id: 'hmr', name: '@deepseek-ai/cordis-plugin-hmr', config: { root: ['.'] } }], 'bundle:@deepseek-ai/dsh-base'),
    // web-app only disables it — no name, no group
    ...extractEntryClaims([{ id: 'hmr', disabled: true }], 'bundle:@deepseek-ai/dsh-web-app'),
    // profile and home layers may repeat the same override
    ...extractEntryClaims([{ id: 'hmr', disabled: false }], 'patch:profile'),
  ]
  assert.deepEqual(findEntryIdCollisions(claims), [])
})

test('re-declaring the same id with the same module in a later layer is a restatement, not a collision', () => {
  const claims = [
    ...extractEntryClaims([{ id: 'timer', name: '@deepseek-ai/cordis-plugin-timer' }], 'bundle:base'),
    ...extractEntryClaims([{ id: 'timer', name: '@deepseek-ai/cordis-plugin-timer' }], 'bundle:web-app'),
  ]
  assert.deepEqual(findEntryIdCollisions(claims), [])
})

test('duplicates inside one source are reported as within-source duplicates', () => {
  const claims = extractEntryClaims([{ id: 'dup', name: 'a' }, { id: 'dup', name: 'b' }], 'patch:profile')
  const collisions = findEntryIdCollisions(claims)
  assert.equal(collisions[0]?.kind, 'within-source-duplicate')
})

test('grouping is deterministic and sorted', () => {
  const claims = [
    ...extractEntryClaims([{ id: 'z' }, { id: 'a' }], 'bundle:b'),
    ...extractEntryClaims([{ id: 'm' }], 'bundle:a'),
  ]
  const grouped = groupClaimsBySource(claims)
  assert.deepEqual([...grouped.keys()], ['bundle:a', 'bundle:b'])
  assert.deepEqual(grouped.get('bundle:b')?.map((claim) => claim.id), ['a', 'z'])
})
