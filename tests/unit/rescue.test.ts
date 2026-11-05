/**
 * Rescue (M8 A 段) — the read-only plan.
 *
 * The whole module is a classification, so the tests are three kinds:
 *   - **the three origins never collapse into two** (N3): `unresolved` is not "third-party";
 *   - **the plan is a pure function** (C1): two calls produce the identical bytes;
 *   - **the sentences are sentences** (C3/C7): no error codes, no `declared` label, no claim about booting.
 *
 * Nothing here proves the CLI writes nothing — that needs a real profile, and it lives in
 * `tests/e2e/rescue-cli.test.ts` (N1) where the manifest can be hashed before and after.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  classifyBundles,
  readProfileBundles,
  type ClassifyInput,
  type DeclaredBundle,
  type InstalledReading,
} from '../../packages/plugin/dist/rescue.js'

const SHA = 'a'.repeat(64)

function classify(options: {
  readonly declared: readonly DeclaredBundle[]
  readonly installed?: readonly InstalledReading[]
  readonly field?: 'present' | 'empty' | 'absent'
  readonly profile?: string
}) {
  const input: ClassifyInput = {
    profile: options.profile ?? 'web',
    declared: options.declared,
    installed: options.installed ?? [],
    manifestSha256: SHA,
    field: options.field,
  }
  return classifyBundles(input)
}

test('an official bundle from the registry is not something a rescue would trim', () => {
  const plan = classify({
    declared: [{ name: '@deepseek-ai/dsh-web', spec: '^0.2.1' }],
    installed: [{ name: '@deepseek-ai/dsh-web', version: '0.2.1-rc.4' }],
  })
  assert.equal(plan.bundles[0]?.origin, 'official')
  assert.equal(plan.bundles[0]?.removable, false)
  assert.equal(plan.removable.length, 0)
})

test('a bundle outside the official scope is third-party and trimmable', () => {
  const plan = classify({
    declared: [{ name: '@acme/dsh-widgets', spec: '^1.0.0' }],
    installed: [{ name: '@acme/dsh-widgets', version: '1.0.3' }],
  })
  assert.equal(plan.bundles[0]?.origin, 'third-party')
  assert.equal(plan.bundles[0]?.removable, true)
  assert.equal(plan.thirdParty, 1)
  assert.equal(plan.unresolved, 0)
})

test('official scope does not save a bundle installed from a local path', () => {
  const plan = classify({
    declared: [{ name: '@deepseek-ai/dsh-my-fork', spec: 'link:../../my-fork' }],
    installed: [{ name: '@deepseek-ai/dsh-my-fork', version: '0.0.0' }],
  })
  assert.equal(plan.bundles[0]?.origin, 'third-party', 'a local install is the user\'s own code')
  assert.equal(plan.bundles[0]?.removable, true)
})

test('listed but not installed is its own origin, not a flavour of third-party (N3)', () => {
  const plan = classify({
    declared: [{ name: '@acme/ghost', spec: '^9.0.0' }],
    installed: [{ name: '@acme/ghost', version: null }],
  })
  assert.equal(plan.bundles[0]?.origin, 'unresolved')
  assert.equal(plan.bundles[0]?.removable, true)
  assert.equal(plan.thirdParty, 0, 'counting it as third-party would describe two failures with one number')
  assert.equal(plan.unresolved, 1)
})

test('a missing bundles field and an empty list are different facts (N6)', () => {
  const absent = classify({ declared: [], field: 'absent' })
  const empty = classify({ declared: [], field: 'empty' })
  assert.equal(absent.empty, true)
  assert.equal(empty.empty, true)
  assert.equal(absent.field, 'absent')
  assert.equal(empty.field, 'empty')
  assert.deepEqual(absent.removable, [])
  assert.deepEqual(empty.removable, [])
})

test('the plan is a pure function: same input, same bytes (C1)', () => {
  const declared = [
    { name: '@deepseek-ai/dsh-web', spec: '^0.2.1' },
    { name: '@acme/dsh-widgets', spec: '^1.0.0' },
    { name: '@acme/ghost', spec: null },
  ] as const
  const installed = [
    { name: '@deepseek-ai/dsh-web', version: '0.2.1-rc.4' },
    { name: '@acme/dsh-widgets', version: '1.0.3' },
    { name: '@acme/ghost', version: null },
  ] as const
  const first = JSON.stringify(classify({ declared, installed }))
  const second = JSON.stringify(classify({ declared, installed }))
  assert.equal(first, second)
  assert.doesNotMatch(first, /\d{4}-\d{2}-\d{2}T/, 'a timestamp would make the plan unreproducible')
})

test('declared order survives, and each removable entry knows where it came from', () => {
  const plan = classify({
    declared: [
      { name: '@deepseek-ai/dsh-web', spec: '^0.2.1' },
      { name: '@acme/dsh-widgets', spec: '^1.0.0' },
      { name: 'plain-bundle', spec: '2.0.0' },
    ],
    installed: [
      { name: '@deepseek-ai/dsh-web', version: '0.2.1-rc.4' },
      { name: '@acme/dsh-widgets', version: '1.0.3' },
      { name: 'plain-bundle', version: '2.0.0' },
    ],
  })
  assert.deepEqual(
    plan.bundles.map((entry) => entry.name),
    ['@deepseek-ai/dsh-web', '@acme/dsh-widgets', 'plain-bundle'],
  )
  assert.deepEqual(
    plan.removable.map((entry) => entry.restore),
    [
      { at: 1, entry: '@acme/dsh-widgets' },
      { at: 2, entry: 'plain-bundle' },
    ],
  )
})

test('every reason is a human sentence, and the evidence tier is `scanned` (C3 / C7)', () => {
  const plan = classify({
    declared: [
      { name: '@deepseek-ai/dsh-web', spec: '^0.2.1' },
      { name: '@acme/dsh-widgets', spec: '^1.0.0' },
      { name: '@acme/ghost', spec: null },
    ],
    installed: [
      { name: '@deepseek-ai/dsh-web', version: '0.2.1-rc.4' },
      { name: '@acme/dsh-widgets', version: '1.0.3' },
      { name: '@acme/ghost', version: null },
    ],
  })
  assert.equal(plan.evidence, 'scanned', 'a profile manifest is scanned, not declared')
  for (const entry of plan.bundles) {
    assert.match(entry.detail, /^[A-Z].*\.$/u, `not a sentence: ${entry.detail}`)
    assert.doesNotMatch(entry.detail, /[a-z]+-[a-z-]+:[a-z-]+/u, 'no error-code shape in a reason')
    assert.doesNotMatch(entry.detail, /\bboot(s|ed|ing)?\b/u, 'a plan may not promise a boot')
  }
})

test('nothing in the plan looks like a home directory (N7)', () => {
  const plan = classify({
    declared: [{ name: '@acme/dsh-widgets', spec: 'link:C:\\Users\\someone\\code\\widgets' }],
    installed: [{ name: '@acme/dsh-widgets', version: '1.0.3' }],
  })
  const json = JSON.stringify(plan)
  // The spec is carried verbatim (it is the user's own file), so this test pins the boundary that
  // matters: we do not ADD a resolved absolute path anywhere.
  assert.doesNotMatch(json, /AppData|node_modules/u)
})

test('readProfileBundles reads one file and carries each dependency spec verbatim', () => {
  const root = mkdtempSync(join(tmpdir(), 'triage-rescue-'))
  try {
    const profileDir = join(root, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      join(profileDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'dsh-profile-web',
          dependencies: { '@deepseek-ai/dsh-web': '^0.2.1', '@acme/dsh-widgets': 'link:../widgets' },
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-web', '@acme/dsh-widgets', '@acme/ghost'] } },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const reading = readProfileBundles(profileDir)
    assert.equal(reading.ok, true)
    if (!reading.ok) return
    assert.equal(reading.field, 'present')
    assert.deepEqual(reading.declared, [
      { name: '@deepseek-ai/dsh-web', spec: '^0.2.1' },
      { name: '@acme/dsh-widgets', spec: 'link:../widgets' },
      { name: '@acme/ghost', spec: null },
    ])
    assert.match(reading.manifestSha256, /^[0-9a-f]{64}$/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('readProfileBundles reports an unreadable profile instead of returning an empty plan (N5)', () => {
  const root = mkdtempSync(join(tmpdir(), 'triage-rescue-missing-'))
  try {
    const reading = readProfileBundles(join(root, 'profiles', 'nope'))
    assert.equal(reading.ok, false)
    if (reading.ok) return
    assert.match(reading.reason, /cannot read the profile manifest/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('readProfileBundles refuses a manifest that is not valid JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'triage-rescue-broken-'))
  try {
    const profileDir = join(root, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), '{ not json', 'utf8')
    const reading = readProfileBundles(profileDir)
    assert.equal(reading.ok, false)
    if (reading.ok) return
    assert.match(reading.reason, /not valid JSON/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
