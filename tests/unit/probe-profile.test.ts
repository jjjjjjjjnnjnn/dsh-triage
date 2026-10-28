import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import {
  PROFILE_DECLARATION_FILES,
  copyProfileDeclarations,
  danglingLocalDependencies,
  localDependencyTargets,
  readProfileManifest,
} from '@dsh-triage/probe'

/**
 * T-304: the copy is declarations only, and a `link:` target is checked by stat — not by the
 * package manager's exit code, which R20 measured to be 0 for a link to nothing (F40).
 */

function withDirs(body: (root: { source: string; target: string }) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'triage-profile-copy-'))
  try {
    body({ source: join(root, 'source'), target: join(root, 'target') })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('only the named declarations are copied; npmrc and node_modules stay behind', () => {
  withDirs(({ source, target }) => {
    mkdirSync(join(source, 'node_modules', 'left-behind'), { recursive: true })
    writeFileSync(join(source, 'node_modules', 'left-behind', 'package.json'), '{}', 'utf8')
    writeFileSync(join(source, '.npmrc'), '//registry.example/:_authToken=secret\n', 'utf8')
    mkdirSync(join(source, '.plugin-manager'), { recursive: true })
    writeFileSync(join(source, '.plugin-manager', 'logs.json'), '{}', 'utf8')
    writeFileSync(join(source, 'package.json'), '{"name":"p"}', 'utf8')
    writeFileSync(join(source, 'cordis.yml'), '[]\n', 'utf8')
    writeFileSync(join(source, 'cordis.patch.yml'), '[]\n', 'utf8')

    const result = copyProfileDeclarations({ sourceDir: source, targetDir: target, files: PROFILE_DECLARATION_FILES })
    assert.deepEqual([...result.copied], ['package.json', 'cordis.yml', 'cordis.patch.yml'])
    // `pnpm-workspace.yaml` is optional in a profile, so its absence is reported, not failed.
    assert.deepEqual([...result.missing], ['pnpm-workspace.yaml'])
    assert.deepEqual(readProfileManifest(target), { name: 'p' })
    // The credential file is the one that must never travel into a probe artifact.
    assert.equal(existsSync(join(target, '.npmrc')), false)
    assert.equal(existsSync(join(target, 'node_modules')), false)
    assert.equal(existsSync(join(target, '.plugin-manager')), false)
  })
})

test('local dependency targets are link:/file: only, and resolve inside the profile', () => {
  const profileDir = join(tmpdir(), 'triage-profile-copy-target')
  const manifest = {
    dependencies: {
      'linked-thing': 'link:./plugins/linked-thing',
      'tarball-thing': 'file:./vendor/thing-1.0.0.tgz',
      'registry-thing': '^1.2.3',
      'alias-thing': 'npm:other-thing@1.0.0',
      'workspace-thing': 'workspace:*',
    },
    devDependencies: { 'dev-link': 'link:../sibling' },
    optionalDependencies: { 'optional-link': 'link:./opt' },
  }
  const targets = localDependencyTargets(manifest, profileDir)
  const names = targets.map((target) => target.name).sort()
  assert.deepEqual(names, ['dev-link', 'linked-thing', 'optional-link', 'tarball-thing'])
  const link = targets.find((target) => target.name === 'linked-thing')
  assert.equal(link?.field, 'dependencies')
  assert.equal(link?.target, join(profileDir, 'plugins', 'linked-thing'))
})

test('a link pointing at nothing is dangling, while an existing one is not (F40)', () => {
  withDirs(({ source }) => {
    mkdirSync(join(source, 'here'), { recursive: true })
    const manifest = {
      dependencies: {
        present: 'link:./here',
        absent: 'link:./not-here',
        tarball: 'file:./nope.tgz',
      },
    }
    const targets = localDependencyTargets(manifest, source)
    const dangling = danglingLocalDependencies(targets)
    assert.deepEqual(dangling.map((target) => target.name).sort(), ['absent', 'tarball'])
    // The spec text is kept verbatim: it is what the reader needs to fix their profile.
    assert.equal(dangling.find((target) => target.name === 'absent')?.spec, 'link:./not-here')
  })
})

test('a broken symlink counts as missing, not as present', () => {
  withDirs(({ source }) => {
    const manifest = { dependencies: { ghost: 'link:./ghost' } }
    const targets = localDependencyTargets(manifest, source)
    // Nothing was created at `./ghost`, which is the same stat result as a broken link.
    assert.equal(danglingLocalDependencies(targets).length, 1)
  })
})

test('a manifest that is absent or unparseable is null, never an invented profile', () => {
  withDirs(({ source }) => {
    assert.equal(readProfileManifest(source), null)
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'package.json'), '{ not json', 'utf8')
    assert.equal(readProfileManifest(source), null)
    // A BOM must not make a perfectly good manifest unreadable (PowerShell writes one).
    writeFileSync(join(source, 'package.json'), '\uFEFF{"name":"p"}', 'utf8')
    assert.deepEqual(readProfileManifest(source), { name: 'p' })
  })
})
