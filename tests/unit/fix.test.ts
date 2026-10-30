/**
 * Autofix (M7) — the only module that writes to a user's profile.
 *
 * Everything here is about *not* damaging the profile: plan before write, refuse more than it
 * does, keep a byte-exact backup, and make the undo path testable without a real DSH install.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { EnvFingerprint, Verdict } from '../../packages/core/dist/index.js'
import type { AuditData } from '../../packages/plugin/dist/audit-data.js'
import {
  applyExemptionFixes,
  isExactVersion,
  parsePackageVersion,
  planFixes,
  readCompatibility,
  readProfileDependencies,
  runtimeSupportsExemptions,
  safeStamp,
  undoFix,
} from '../../packages/plugin/dist/fix.js'

function profileDir(): string {
  return mkdtempSync(join(tmpdir(), 'triage-fix-'))
}

function env(profile = 'web', dsh: string | null = '0.2.1-rc.4'): EnvFingerprint {
  return {
    dsh,
    node: 'v24.15.0',
    platform: 'win32',
    arch: 'x64',
    profile,
    profileDir: join('~', '.dsh', 'profiles', profile),
    bundles: [],
    installed: [],
  }
}

function blockedVerdict(name: string, version: string | null): Verdict {
  return {
    schemaVersion: 1,
    subject: { name, version, kind: 'entry' },
    env: env(),
    conclusion: 'blocked',
    confidence: { level: 'high', basis: 'declared' },
    reasons: [{ code: 'admission-denied-engines', severity: 'block', messageId: 'admission.denied' }],
    evidence: [],
    remediation: [
      {
        kind: 'allow-version',
        command: `dsh plugin --profile web allow-version ${name}@${version ?? ''} --dsh-version 0.2.1-rc.4 --accept-risk`,
        note: 'explicit exemption',
        messageId: 'remediation.allow-version',
      },
    ],
    missingEvidence: [],
    generatedAt: '2026-10-30T00:00:00.000Z',
  }
}

function data(options: { profileDir: string; verdicts: readonly Verdict[] }): AuditData {
  return {
    env: { ...env(), profileDir: options.profileDir },
    claims: [],
    grouped: new Map(),
    collisions: [],
    artifacts: [],
    duplicates: [],
    duplicateFindings: [],
    rows: [],
    rowVerdicts: options.verdicts,
    presetDeclarations: [],
    snapshot: null,
    inventoryVerdicts: [],
    diff: { missing: [], undeclared: [], ambiguous: [] },
    declared: [],
    errors: [],
  }
}

/* --------------------------------- inputs --------------------------------- */

test('only canonical exact versions are accepted', () => {
  for (const good of ['1.2.3', '0.0.0', '0.2.1-rc.4', '1.0.0+build.7', '2.0.0-rc.1+build']) {
    assert.equal(isExactVersion(good), true, `${good} should be exact`)
  }
  for (const bad of ['^1.2.3', '~1.2.3', '1.2', 'v1.2.3', '1.2.3 ', 'workspace:*', '*', 'latest']) {
    assert.equal(isExactVersion(bad), false, `${bad} must not be treated as exact`)
  }
})

test('exemption keys keep scoped names intact and reject ranges', () => {
  assert.deepEqual(parsePackageVersion('@scope/name@1.2.3'), { name: '@scope/name', version: '1.2.3' })
  assert.deepEqual(parsePackageVersion('plain@0.2.1-rc.4'), { name: 'plain', version: '0.2.1-rc.4' })
  assert.throws(() => parsePackageVersion('plain@^1.0.0'), /not an exact version/)
  assert.throws(() => parsePackageVersion('no-version'), /name@version/)
})

/* ------------------------------- detection -------------------------------- */

test('exemption support is proven by the implementation being installed', () => {
  const withoutRuntime = profileDir()
  const oldRuntime = profileDir()
  const newRuntime = profileDir()
  try {
    assert.equal(runtimeSupportsExemptions(withoutRuntime), false, 'no runtime installed means no support')

    // 0.1.0-rc.6 shape: the file is never mentioned.
    const oldBoot = join(oldRuntime, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib')
    mkdirSync(oldBoot, { recursive: true })
    writeFileSync(join(oldBoot, 'index.js'), 'export const version = "0.1.0-rc.6"\n', 'utf8')
    assert.equal(runtimeSupportsExemptions(oldRuntime), false)

    // 0.2.x shape: both the filename and the writer exist.
    const newBoot = join(newRuntime, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib')
    mkdirSync(newBoot, { recursive: true })
    writeFileSync(
      join(newBoot, 'index.js'),
      'const PROFILE_COMPATIBILITY_FILENAME = "compatibility.json"\nasync function setProfileVersionExemption() {}\n',
      'utf8',
    )
    assert.equal(runtimeSupportsExemptions(newRuntime), true)
  } finally {
    for (const dir of [withoutRuntime, oldRuntime, newRuntime]) rmSync(dir, { recursive: true, force: true })
  }
})

test('the profile dependencies are read, never guessed', () => {
  const dir = profileDir()
  try {
    assert.deepEqual(readProfileDependencies(dir), [], 'a missing manifest has no dependencies')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { a: '1.0.0' }, devDependencies: { b: '2.0.0' } }), 'utf8')
    assert.deepEqual([...readProfileDependencies(dir)].sort(), ['a', 'b'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ---------------------------------- plan ---------------------------------- */

test('a plan says what it can fix and what it cannot, without touching disk', () => {
  const dir = profileDir()
  try {
    const verdicts = [blockedVerdict('@scope/plugin', '1.2.3'), blockedVerdict('no-version-plugin', null)]
    const supported = planFixes(data({ profileDir: dir, verdicts }), { exemptionSupport: true, installable: [] })
    assert.equal(supported.items.length, 2)
    assert.equal(supported.items[0]?.status, 'ready')
    assert.equal(supported.items[0]?.packageVersion, '@scope/plugin@1.2.3')
    assert.equal(supported.applicable, 1, 'the row without a version cannot be named in an exemption')
    assert.equal(supported.items[1]?.status, 'unknown-version')

    const unsupported = planFixes(data({ profileDir: dir, verdicts }), { exemptionSupport: false, installable: ['@scope/plugin'] })
    assert.equal(unsupported.applicable, 0, 'without runtime support nothing is applicable')
    assert.equal(unsupported.items[0]?.action, 'pin')
    assert.equal(unsupported.items[0]?.status, 'no-compatible-version')
    assert.match(unsupported.items[0]?.detail ?? '', /only real fix is a plugin version/)

    const unknownShape = planFixes(data({ profileDir: dir, verdicts }), { exemptionSupport: false, installable: [] })
    assert.equal(unknownShape.items[0]?.status, 'unknown-install-shape')
    assert.equal(existsSync(join(dir, 'compatibility.json')), false, 'planning never writes')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* --------------------------------- apply ---------------------------------- */

test('a dry run writes nothing at all, not even a backup', () => {
  const dir = profileDir()
  try {
    const plan = planFixes(data({ profileDir: dir, verdicts: [blockedVerdict('p', '1.0.0')] }), { exemptionSupport: true })
    const run = applyExemptionFixes(plan, { stamp: '2026-10-30T00:00:00.000Z', dryRun: true })
    assert.equal(run.dryRun, true)
    assert.equal(run.changes.length, 0)
    assert.equal(existsSync(join(dir, 'compatibility.json')), false)
    assert.equal(existsSync(join(dir, '.dsh-triage')), false, 'no trace at all on a dry run')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('apply writes the file the runtime expects, backs it up, and undo restores it byte-for-byte', () => {
  const dir = profileDir()
  try {
    const original = '{\n  "other@1.0.0": [\n    "0.2.0"\n  ]\n}\n'
    writeFileSync(join(dir, 'compatibility.json'), original, 'utf8')

    const stamp = '2026-10-30T01:00:00.000Z'
    const plan = planFixes(data({ profileDir: dir, verdicts: [blockedVerdict('@scope/plugin', '1.2.3')] }), { exemptionSupport: true })
    const run = applyExemptionFixes(plan, { stamp, dryRun: false })

    const written = readFileSync(join(dir, 'compatibility.json'), 'utf8')
    const parsed = JSON.parse(written) as Record<string, string[]>
    assert.deepEqual(parsed['@scope/plugin@1.2.3'], ['0.2.1-rc.4'])
    assert.deepEqual(parsed['other@1.0.0'], ['0.2.0'], 'existing exemptions are preserved')
    assert.ok(written.endsWith('\n'), 'the file keeps a trailing newline')
    assert.deepEqual(Object.keys(parsed), ['@scope/plugin@1.2.3', 'other@1.0.0'], 'keys are sorted for a stable diff')

    // backup + journal
    assert.ok(existsSync(join(dir, '.dsh-triage', 'backups', safeStamp(stamp), 'compatibility.json')))
    assert.equal(readFileSync(join(dir, '.dsh-triage', 'backups', safeStamp(stamp), 'compatibility.json'), 'utf8'), original)
    assert.ok(existsSync(run.journal))
    assert.equal(run.changes.length, 1)

    // idempotent: applying twice does not duplicate the version
    const again = planFixes(data({ profileDir: dir, verdicts: [blockedVerdict('@scope/plugin', '1.2.3')] }), { exemptionSupport: true })
    applyExemptionFixes(again, { stamp: '2026-10-30T02:00:00.000Z', dryRun: false })
    const twice = JSON.parse(readFileSync(join(dir, 'compatibility.json'), 'utf8')) as Record<string, string[]>
    assert.deepEqual(twice['@scope/plugin@1.2.3'], ['0.2.1-rc.4'])

    const { restored } = undoFix(run.journal)
    assert.equal(restored.length, 1)
    assert.equal(readFileSync(join(dir, 'compatibility.json'), 'utf8'), original, 'undo is byte-exact')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a compatibility file this tool did not write is refused, not rewritten', () => {
  const dir = profileDir()
  try {
    const junk = '{ this is not json'
    writeFileSync(join(dir, 'compatibility.json'), junk, 'utf8')
    assert.equal(readCompatibility(dir).rewritable, false)
    const plan = planFixes(data({ profileDir: dir, verdicts: [blockedVerdict('p', '1.0.0')] }), { exemptionSupport: true })
    assert.throws(() => applyExemptionFixes(plan, { stamp: '2026-10-30T03:00:00.000Z', dryRun: false }), /refusing to rewrite/)
    assert.equal(readFileSync(join(dir, 'compatibility.json'), 'utf8'), junk, 'the user file is untouched')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('undo refuses to overwrite a file that changed after the journal', () => {
  const dir = profileDir()
  try {
    writeFileSync(join(dir, 'compatibility.json'), '{}\n', 'utf8')
    const plan = planFixes(data({ profileDir: dir, verdicts: [blockedVerdict('p', '1.0.0')] }), { exemptionSupport: true })
    const run = applyExemptionFixes(plan, { stamp: '2026-10-30T04:00:00.000Z', dryRun: false })
    writeFileSync(join(dir, 'compatibility.json'), '{"hand":"edited"}\n', 'utf8')
    assert.throws(() => undoFix(run.journal), /changed after this journal/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a second apply keeps the first backup, and the two journals undo back to the original', () => {
  const dir = profileDir()
  try {
    const original = '{"keep@1.0.0":["0.2.0"]}\n'
    writeFileSync(join(dir, 'compatibility.json'), original, 'utf8')
    const stamp = '2026-10-30T05:00:00.000Z'
    const plan = planFixes(data({ profileDir: dir, verdicts: [blockedVerdict('p', '1.0.0')] }), { exemptionSupport: true })

    const first = applyExemptionFixes(plan, { stamp, dryRun: false })
    const patched = readFileSync(join(dir, 'compatibility.json'), 'utf8')
    const second = applyExemptionFixes(plan, { stamp, dryRun: false })

    assert.notEqual(first.journal, second.journal, 'two runs must not share one journal')
    // The bug this pins: re-applying used to overwrite the backup with the *patched* file.
    assert.equal(
      readFileSync(join(dir, '.dsh-triage', 'backups', safeStamp(stamp), 'compatibility.json'), 'utf8'),
      original,
      'the backup must still hold the bytes from before the first apply',
    )

    undoFix(second.journal)
    assert.equal(readFileSync(join(dir, 'compatibility.json'), 'utf8'), patched)
    undoFix(first.journal)
    assert.equal(readFileSync(join(dir, 'compatibility.json'), 'utf8'), original, 'unwinding both journals returns the original')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
