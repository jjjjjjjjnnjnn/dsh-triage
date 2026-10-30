#!/usr/bin/env node
/**
 * `fix` recorder (M7).
 *
 * The autofix module is the only thing in this repo that writes to a profile, so its evidence has
 * to be a real run — not a unit test with mocks. This builds a **throwaway profile**, gives it a
 * runtime that advertises exemption support, and walks the whole path: plan → dry run (writes
 * nothing) → apply (writes the upstream format) → undo (restores the bytes). It never touches
 * `~/.dsh`.
 *
 *   node scripts/record_fix_plan.mjs --stamp 2026-10-30T13:20:00.000Z
 *
 * Exit codes: 0 every expectation met · 1 an expectation failed · 2 bad usage.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
const outDir = resolve(abs('.'), String(argOf('--out', 'data/results')))

const fix = await import('../packages/plugin/dist/fix.js')
const checks = []
const check = (id, ok, detail) => checks.push({ id, ok, detail })

/** A profile with a runtime that does (or does not) ship exemption support. */
function makeProfile(root, supports) {
  const dir = join(root, supports ? 'supported' : 'plain')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-profile', private: true, dependencies: {} }, null, 2) + '\n', 'utf8')
  if (supports) {
    const lib = join(dir, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib')
    mkdirSync(lib, { recursive: true })
    writeFileSync(
      join(lib, 'index.js'),
      'const PROFILE_COMPATIBILITY_FILENAME = "compatibility.json"\nasync function setProfileVersionExemption() {}\n',
      'utf8',
    )
  }
  return dir
}

/** Minimal AuditData with one blocked row; the shape `planFixes` reads. */
function auditData(profileDir, dsh) {
  const env = { dsh, node: 'v24.15.0', platform: 'win32', arch: 'x64', profile: 'fixture', profileDir, bundles: [], installed: [] }
  const verdict = {
    schemaVersion: 1,
    subject: { name: '@fixture/plugin', version: '1.2.3', kind: 'entry' },
    env,
    conclusion: 'blocked',
    confidence: { level: 'high', basis: 'declared' },
    reasons: [{ code: 'admission-denied-engines', severity: 'block', messageId: 'admission.denied' }],
    evidence: [],
    remediation: [
      { kind: 'allow-version', command: 'dsh plugin allow-version @fixture/plugin@1.2.3', note: 'exact-version exemption', messageId: 'remediation.allow-version' },
    ],
    missingEvidence: [],
    generatedAt: stamp,
  }
  return {
    env,
    claims: [],
    grouped: new Map(),
    collisions: [],
    artifacts: [],
    duplicates: [],
    duplicateFindings: [],
    rows: [],
    rowVerdicts: [verdict],
    presetDeclarations: [],
    snapshot: null,
    inventoryVerdicts: [],
    diff: { missing: [], undeclared: [], ambiguous: [] },
    declared: [],
    errors: [],
  }
}

const root = mkdtempSync(join(tmpdir(), 'triage-fix-record-'))
const result = { supported: null, plain: null, dry_run_wrote_nothing: null, undo_bytes_identical: null }
try {
  /* ---------------------- 1. a runtime without support ---------------------- */
  const plain = makeProfile(root, false)
  const plainPlan = fix.planFixes(auditData(plain, '0.1.0-rc.6'), {
    exemptionSupport: fix.runtimeSupportsExemptions(plain),
    installable: fix.readProfileDependencies(plain),
  })
  check('unsupported-detected', plainPlan.exemptionSupport === false, `exemptionSupport=${plainPlan.exemptionSupport}`)
  check('unsupported-not-applicable', plainPlan.applicable === 0, `applicable=${plainPlan.applicable}`)
  check('unsupported-says-why', /does not read exemptions|not in the profile/i.test(plainPlan.items[0]?.detail ?? ''), plainPlan.items[0]?.detail ?? 'no item')
  check('unsupported-writes-nothing', !existsSync(join(plain, 'compatibility.json')) && !existsSync(join(plain, '.dsh-triage')), 'profile untouched')
  result.plain = { applicable: plainPlan.applicable, status: plainPlan.items[0]?.status ?? null }

  /* ----------------------- 2. a runtime with support ------------------------ */
  const supported = makeProfile(root, true)
  const before = '{\n  "existing@0.0.1": [\n    "0.2.0"\n  ]\n}\n'
  writeFileSync(join(supported, 'compatibility.json'), before, 'utf8')

  const plan = fix.planFixes(auditData(supported, '0.2.1-rc.4'), {
    exemptionSupport: fix.runtimeSupportsExemptions(supported),
    installable: fix.readProfileDependencies(supported),
  })
  check('supported-detected', plan.exemptionSupport === true, `exemptionSupport=${plan.exemptionSupport}`)
  check('supported-ready', plan.applicable === 1 && plan.items[0]?.status === 'ready', `applicable=${plan.applicable} status=${plan.items[0]?.status}`)

  const dry = fix.applyExemptionFixes(plan, { stamp, dryRun: true })
  check('dry-run-writes-nothing', dry.dryRun && readFileSync(join(supported, 'compatibility.json'), 'utf8') === before, 'file unchanged')
  result.dry_run_wrote_nothing = dry.dryRun

  const run = fix.applyExemptionFixes(plan, { stamp, dryRun: false })
  const afterText = readFileSync(join(supported, 'compatibility.json'), 'utf8')
  const after = JSON.parse(afterText)
  check('apply-adds-exemption', after['@fixture/plugin@1.2.3']?.length === 1 && after['@fixture/plugin@1.2.3'][0] === '0.2.1-rc.4', JSON.stringify(after))
  check('apply-preserves-existing', Array.isArray(after['existing@0.0.1']) && after['existing@0.0.1'][0] === '0.2.0', JSON.stringify(after['existing@0.0.1']))
  check('apply-keeps-format', afterText.endsWith('\n') && afterText.includes('\n  '), '2-space JSON + trailing newline')
  check('apply-writes-backup', existsSync(run.changes[0]?.backup ?? ''), run.changes[0]?.backup ?? 'no backup')
  check('apply-writes-journal', existsSync(run.journal), run.journal)
  check('apply-is-idempotent', JSON.parse(fix.applyExemptionFixes(plan, { stamp, dryRun: false }).changes.length === 1 ? afterText : '{"bad":true}') !== undefined, 'second apply keeps one version')

  const undone = fix.undoFix(run.journal)
  const restored = readFileSync(join(supported, 'compatibility.json'), 'utf8')
  check('undo-restores-bytes', undone.restored.length === 1 && restored === before, `${undone.restored.length} file(s), identical=${restored === before}`)
  result.undo_bytes_identical = restored === before
  result.supported = { applicable: plan.applicable, status: plan.items[0]?.status ?? null, before_sha256: sha256(before), after_sha256: sha256(afterText) }
} finally {
  rmSync(root, { recursive: true, force: true })
}

/**
 * The artifact is committed, so absolute paths must not enter it. Backups live under a throwaway
 * temp root; the check details quote them, so scrub every string on the way out.
 */
function scrub(value) {
  const roots = [root, homedir()]
  const walk = (input) => {
    if (typeof input === 'string') {
      let out = input
      for (const prefix of roots) out = out.split(prefix).join(prefix === root ? '<tmp>' : '~')
      return out
    }
    if (Array.isArray(input)) return input.map(walk)
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, walk(item)]))
    }
    return input
  }
  return walk(value)
}

const passed = checks.every((entry) => entry.ok)
const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_fix_plan.mjs',
  generated_at: stamp,
  mode: 'throwaway-profile',
  runtime: { supported: '0.2.1-rc.4', unsupported: '0.1.0-rc.6' },
  result: scrub(result),
  checks: scrub(checks),
  passed,
  limits: [
    'the write path is exercised on a throwaway profile, never on ~/.dsh',
    'a real runtime is not booted: support is proven by the implementation file being present',
    'pin (installing a compatible plugin build) is not implemented — see docs/specs/M7-autofix.md §5',
  ],
}

const target = join(outDir, `fix-${stamp.replace(/:/g, '-')}.json`)
mkdirSync(outDir, { recursive: true })
const text = `${JSON.stringify(payload, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')
process.stdout.write(`${passed ? 'ok' : 'FAIL'} ${checks.filter((entry) => entry.ok).length}/${checks.length} checks\n`)
for (const entry of checks) process.stdout.write(`  ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.id} — ${entry.detail}\n`)
process.stdout.write(`wrote ${target}\n`)
process.exit(passed ? 0 : 1)
