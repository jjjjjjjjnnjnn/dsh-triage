/**
 * Reading the pnpm layout out of a profile (T-315 residual, R30).
 *
 * WHY THIS IS A TEST AND NOT A COMMENT: R26 measured that a copied source with
 * `nodeLinker: hoisted` did not break row recognition, but the artifact never recorded the
 * layout — so "pnpm really switched" was an inference. These tests pin the three shapes the
 * probe can now report, and that an unreadable dir is `null` rather than a guess.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readNodeLayout } from '@dsh-triage/probe'

function withProfile(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'triage-layout-'))
  try {
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('an isolated layout is recognised by pnpm\'s store directory', () => {
  withProfile((dir) => {
    mkdirSync(join(dir, 'node_modules', '.pnpm'), { recursive: true })
    mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true })
    mkdirSync(join(dir, 'node_modules', 'dsh-status-rotator'), { recursive: true })
    writeFileSync(
      join(dir, 'node_modules', '.modules.yaml'),
      'hoistPattern:\n  - "*"\nnodeLinker: isolated\npendingBuilds: []\n',
      'utf8',
    )
    const layout = readNodeLayout(dir)
    assert.equal(layout?.linker, 'isolated')
    assert.equal(layout?.pnpmStore, true)
    assert.equal(layout?.declared, 'isolated')
    assert.equal(layout?.topLevel, 1, 'dot entries (.pnpm/.bin) are not top-level packages')
  })
})

test('a hoisted layout has no store directory, whatever the config claims', () => {
  withProfile((dir) => {
    mkdirSync(join(dir, 'node_modules', 'dsh-triage'), { recursive: true })
    mkdirSync(join(dir, 'node_modules', 'react'), { recursive: true })
    // The declaration and the observation are deliberately reported separately: a shared store
    // can win over `nodeLinker`, and flattening the two into one boolean would hide that.
    writeFileSync(join(dir, 'node_modules', '.modules.yaml'), 'nodeLinker: hoisted\n', 'utf8')
    const layout = readNodeLayout(dir)
    assert.equal(layout?.linker, 'hoisted')
    assert.equal(layout?.pnpmStore, false)
    assert.equal(layout?.declared, 'hoisted')
    assert.equal(layout?.topLevel, 2)
  })
})

test('a profile that was never installed reports "absent" instead of "hoisted"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triage-layout-empty-'))
  try {
    const layout = readNodeLayout(dir)
    assert.equal(layout?.linker, 'absent', 'no node_modules is not a layout, and certainly not a flat one')
    assert.equal(layout?.declared, null)
    assert.equal(layout?.topLevel, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing nodeLinker line stays null rather than being inferred', () => {
  withProfile((dir) => {
    mkdirSync(join(dir, 'node_modules', 'only-flat'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', '.modules.yaml'), 'hoistPattern:\n  - "*"\n', 'utf8')
    const layout = readNodeLayout(dir)
    assert.equal(layout?.linker, 'hoisted')
    assert.equal(layout?.declared, null, 'the config did not say, so we do not pretend it did')
  })
})
