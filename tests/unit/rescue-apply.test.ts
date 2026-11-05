/**
 * Rescue B 段 — the one write this tool performs on a profile.
 *
 * The tests are all about the failure directions, because a rescue that half-applies is worse than
 * one that refuses:
 *   - dry run writes **nothing at all** (no `.dsh-triage`, no backup);
 *   - a failure **after** the backup exists must put the original bytes back;
 *   - undo restores the **exact bytes**, and refuses when the profile moved on;
 *   - `dependencies` is never rewritten (that is what keeps undo an array edit).
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  applyRescue,
  classifyBundles,
  readProfileBundles,
  undoRescue,
  type RescuePlan,
} from '../../packages/plugin/dist/rescue.js'

const MANIFEST = 'package.json'

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

interface Fixture {
  readonly root: string
  readonly profileDir: string
  readonly file: string
  readonly text: string
}

function fixture(options?: { readonly bundles?: readonly string[] }): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'triage-rescue-apply-'))
  const profileDir = join(root, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  const text = `${JSON.stringify(
    {
      name: 'dsh-profile-web',
      private: true,
      dependencies: { '@deepseek-ai/dsh-base': '^0.2.1', '@acme/dsh-widgets': 'link:../widgets' },
      dsh: { profile: { bundles: options?.bundles ?? ['@deepseek-ai/dsh-base', '@acme/dsh-widgets'] } },
    },
    null,
    2,
  )}\n`
  const file = join(profileDir, MANIFEST)
  writeFileSync(file, text, 'utf8')
  return { root, profileDir, file, text }
}

function planFor(profileDir: string): RescuePlan {
  const reading = readProfileBundles(profileDir)
  if (!reading.ok) throw new Error(reading.reason)
  return classifyBundles({
    profile: 'web',
    declared: reading.declared,
    installed: [
      { name: '@deepseek-ai/dsh-base', version: '0.2.1-rc.4' },
      { name: '@acme/dsh-widgets', version: '1.0.3' },
    ],
    manifestSha256: reading.manifestSha256,
    field: reading.field,
  })
}

test('a dry run writes nothing at all — no backup, no journal, no .dsh-triage directory', () => {
  const f = fixture()
  try {
    const before = sha256(readFileSync(f.file, 'utf8'))
    const run = applyRescue({ plan: planFor(f.profileDir), profileDir: f.profileDir, stamp: '2026-11-05T10:00:00.000Z', dryRun: true })
    assert.equal(run.dryRun, true)
    assert.equal(run.journal, '')
    assert.deepEqual(run.removed, [])
    assert.equal(sha256(readFileSync(f.file, 'utf8')), before)
    assert.equal(existsSync(join(f.profileDir, '.dsh-triage')), false, 'a preview must not leave a trace')
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('apply removes only the removable entries, keeps dependencies, and journals before/after hashes', () => {
  const f = fixture({ bundles: ['@deepseek-ai/dsh-base', '@acme/dsh-widgets', '@acme/ghost'] })
  try {
    const beforeText = readFileSync(f.file, 'utf8')
    const run = applyRescue({ plan: planFor(f.profileDir), profileDir: f.profileDir, stamp: '2026-11-05T10:00:00.000Z', dryRun: false })
    const afterText = readFileSync(f.file, 'utf8')

    assert.equal(run.dryRun, false)
    assert.deepEqual(run.removed, ['@acme/dsh-widgets', '@acme/ghost'])
    assert.ok(afterText.endsWith('\n'), 'the manifest keeps the repo shape: two spaces, one trailing newline')

    const parsed = JSON.parse(afterText) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    assert.deepEqual(parsed.dsh.profile.bundles, ['@deepseek-ai/dsh-base'])
    assert.deepEqual(parsed.dependencies, { '@deepseek-ai/dsh-base': '^0.2.1', '@acme/dsh-widgets': 'link:../widgets' }, 'dependencies must never change')

    const journal = JSON.parse(readFileSync(run.journal, 'utf8')) as {
      before_sha256: string
      after_sha256: string
      removed: { name: string; at: number }[]
    }
    assert.equal(journal.before_sha256, sha256(beforeText))
    assert.equal(journal.after_sha256, sha256(afterText))
    assert.deepEqual(journal.removed, [
      { name: '@acme/dsh-widgets', at: 1 },
      { name: '@acme/ghost', at: 2 },
    ])
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('a failure after the write puts the original bytes back (N9)', () => {
  const f = fixture()
  try {
    const before = sha256(readFileSync(f.file, 'utf8'))
    assert.throws(
      () =>
        applyRescue({
          plan: planFor(f.profileDir),
          profileDir: f.profileDir,
          stamp: '2026-11-05T10:00:00.000Z',
          dryRun: false,
          afterWrite: () => {
            throw new Error('injected failure after the write')
          },
        }),
      /injected failure after the write/u,
    )
    assert.equal(sha256(readFileSync(f.file, 'utf8')), before, 'a failure after the write must roll the profile back')
    assert.equal(existsSync(join(f.profileDir, '.dsh-triage', 'rescue', '2026-11-05T10-00-00-000Z.json')), false, 'no journal for a write that was rolled back')
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('a failure before the write never touches the file', () => {
  const f = fixture()
  try {
    const before = sha256(readFileSync(f.file, 'utf8'))
    assert.throws(
      () =>
        applyRescue({
          plan: planFor(f.profileDir),
          profileDir: f.profileDir,
          stamp: '2026-11-05T10:00:00.000Z',
          dryRun: false,
          beforeWrite: () => {
            throw new Error('injected write failure')
          },
        }),
      /injected write failure/u,
    )
    assert.equal(sha256(readFileSync(f.file, 'utf8')), before)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('undo restores the exact original bytes (N10)', () => {
  const f = fixture()
  try {
    const before = sha256(readFileSync(f.file, 'utf8'))
    const run = applyRescue({ plan: planFor(f.profileDir), profileDir: f.profileDir, stamp: '2026-11-05T10:00:00.000Z', dryRun: false })
    assert.notEqual(sha256(readFileSync(f.file, 'utf8')), before)
    const { restored } = undoRescue(run.journal)
    assert.deepEqual(restored, [f.file])
    assert.equal(sha256(readFileSync(f.file, 'utf8')), before, 'byte equality, not "looks the same"')
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('undo refuses when the profile changed after the rescue (N11)', () => {
  const f = fixture()
  try {
    const run = applyRescue({ plan: planFor(f.profileDir), profileDir: f.profileDir, stamp: '2026-11-05T10:00:00.000Z', dryRun: false })
    writeFileSync(f.file, `${readFileSync(f.file, 'utf8')}\n`, 'utf8')
    const edited = sha256(readFileSync(f.file, 'utf8'))
    assert.throws(() => undoRescue(run.journal), /changed after this rescue was applied/u)
    assert.equal(sha256(readFileSync(f.file, 'utf8')), edited, 'a refused undo must not touch the file')
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('apply with nothing removable is a dry run even when asked to write', () => {
  const f = fixture({ bundles: ['@deepseek-ai/dsh-base'] })
  try {
    const before = sha256(readFileSync(f.file, 'utf8'))
    const run = applyRescue({ plan: planFor(f.profileDir), profileDir: f.profileDir, stamp: '2026-11-05T10:00:00.000Z', dryRun: false })
    assert.equal(run.dryRun, true)
    assert.equal(sha256(readFileSync(f.file, 'utf8')), before)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('apply refuses when the manifest disagrees with the plan instead of "succeeding"', () => {
  const f = fixture()
  try {
    const plan = planFor(f.profileDir)
    writeFileSync(
      f.file,
      `${JSON.stringify({ name: 'dsh-profile-web', dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }, null, 2)}\n`,
      'utf8',
    )
    assert.throws(
      () => applyRescue({ plan, profileDir: f.profileDir, stamp: '2026-11-05T10:00:00.000Z', dryRun: false }),
      /no longer contains them/u,
    )
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})
