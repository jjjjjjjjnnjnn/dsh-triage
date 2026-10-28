/**
 * Reading the pnpm layout out of a profile (T-315 residual, R30/R31).
 *
 * WHY THIS IS A TEST AND NOT A COMMENT: R26 measured that a copied source with
 * `nodeLinker: hoisted` did not break row recognition, but the artifact never recorded the
 * layout — so "pnpm really switched" was an inference. R31 then found the first version of this
 * reader classified layouts by "is there a `node_modules/.pnpm` dir", which is WRONG on pnpm 12:
 * the virtual store exists in both layouts. These tests pin the shapes from real directories.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

test('a hoisted layout keeps real directories and still has a virtual store', () => {
  withProfile((dir) => {
    // Measured on pnpm 12.15.0: `.pnpm` exists here too, so it cannot be the discriminator.
    mkdirSync(join(dir, 'node_modules', '.pnpm'), { recursive: true })
    mkdirSync(join(dir, 'node_modules', 'semver'), { recursive: true })
    writeFileSync(
      join(dir, 'node_modules', 'semver', 'package.json'),
      '{"name":"semver","version":"7.6.3"}\n',
      'utf8',
    )
    writeFileSync(
      join(dir, 'node_modules', '.modules.yaml'),
      'hoistPattern:\n  - "*"\n  "nodeLinker": "hoisted",\n  "publicHoistPattern": [],\n',
      'utf8',
    )
    const layout = readNodeLayout(dir)
    assert.equal(layout?.linker, 'hoisted')
    assert.equal(layout?.declared, 'hoisted', 'pnpm writes quoted keys with a trailing comma')
    assert.equal(layout?.topLevelSymlink, false)
    assert.equal(layout?.virtualStoreLinks, 0)
    assert.equal(layout?.pnpmStore, true, 'the virtual store is present in BOTH layouts')
    assert.equal(layout?.topLevel, 1)
  })
})

test('a local link entry does not make a hoisted tree look isolated', () => {
  withProfile((dir) => {
    // R31's real shape: the probe fixture is installed as a `file:` link, so the FIRST top-level
    // entry is a symlink pointing outside the store. Classifying on "is the first entry a symlink"
    // answered "isolated" for a tree whose `.modules.yaml` said hoisted.
    const source = join(dir, 'fixture-outside')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'package.json'), '{"name":"fixture","version":"0.0.0"}\n', 'utf8')
    try {
      symlinkSync(source, join(dir, 'node_modules', 'fixture'), 'junction')
    } catch {
      return
    }
    mkdirSync(join(dir, 'node_modules', '.pnpm'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', '.modules.yaml'), '  "nodeLinker": "hoisted",\n', 'utf8')
    const layout = readNodeLayout(dir)
    assert.equal(layout?.linker, 'hoisted')
    assert.equal(layout?.topLevelSymlink, true, 'the first entry IS a link…')
    assert.equal(layout?.virtualStoreLinks, 0, '…but not into the virtual store, so this is not isolated')
  })
})

test('an isolated layout symlinks packages into the virtual store', () => {
  withProfile((dir) => {
    const store = join(dir, 'node_modules', '.pnpm', 'semver@7.6.3', 'node_modules')
    mkdirSync(store, { recursive: true })
    mkdirSync(join(store, 'semver'), { recursive: true })
    writeFileSync(join(store, 'semver', 'package.json'), '{"name":"semver","version":"7.6.3"}\n', 'utf8')
    try {
      // A junction works without administrator rights on Windows, which a plain symlink needs.
      symlinkSync(join(store, 'semver'), join(dir, 'node_modules', 'semver'), 'junction')
    } catch {
      // Filesystems that refuse links cannot demonstrate the shape; skip rather than fake it.
      return
    }
    writeFileSync(join(dir, 'node_modules', '.modules.yaml'), '  "nodeLinker": "isolated",\n', 'utf8')
    const layout = readNodeLayout(dir)
    assert.equal(layout?.linker, 'isolated')
    assert.equal(layout?.declared, 'isolated')
    assert.equal(layout?.topLevelSymlink, true)
    assert.equal(layout?.virtualStoreLinks, 1, 'a link INTO .pnpm is the isolated shape')
  })
})

test('a layout with no .modules.yaml falls back to the symlink observation', () => {
  withProfile((dir) => {
    mkdirSync(join(dir, 'node_modules', 'dsh-triage'), { recursive: true })
    const layout = readNodeLayout(dir)
    assert.equal(layout?.declared, null, 'nothing said anything, so we do not pretend it did')
    assert.equal(layout?.linker, 'hoisted', 'a real directory at the top level is the hoisted shape')
    assert.equal(layout?.topLevelSymlink, false)
  })
})

test('a profile that was never installed reports "absent" instead of "hoisted"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triage-layout-empty-'))
  try {
    const layout = readNodeLayout(dir)
    assert.equal(layout?.linker, 'absent', 'no node_modules is not a layout, and certainly not a flat one')
    assert.equal(layout?.declared, null)
    assert.equal(layout?.topLevel, 0)
    assert.equal(layout?.topLevelSymlink, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty node_modules is "absent", not "hoisted"', () => {
  withProfile((dir) => {
    const layout = readNodeLayout(dir)
    assert.equal(layout?.linker, 'absent', 'nothing installed is not a flat layout')
    assert.equal(layout?.topLevel, 0)
  })
})
