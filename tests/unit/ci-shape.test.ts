/**
 * R106 · the "CI shape" rule: a reading that needs this machine must skip, not fail.
 *
 * THE INCIDENT THIS PINS: `pnpm run verify` was green on the maintainer's machine from 2026-11-12
 * while all three public CI jobs failed (`run 43315617523`) on four tests that read
 * `~/.dsh/profiles/desktop`. Two separate holes made that possible:
 *
 *   1. `tsc -p tsconfig.tests.json` had an error (`match[1]` is `string | undefined`) and no gate
 *      runs tsc, so `node --test` (which strips types) was the only opinion anyone heard;
 *   2. the four readings asserted `loadEnv(...).ok === true`, so "there is no profile on this
 *      machine" was reported as a defect of the tool rather than as "not measured".
 *
 * The recorder (`scripts/record_ci_shape.mjs`) measures both shapes of the same files. This file
 * proves the judge can say no in all three ways it has to: a failing run, a reading turned into a
 * skip on the machine that has the profile, and a run that skipped nothing on the machine that has
 * no profile (i.e. the readings were deleted rather than adapted).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { judgeShape, judgeShapes, SKIP_TOLERATED_FILES } from '../../scripts/lib/ci-shape.mjs'

const GREEN = { tests: 11, pass: 11, fail: 0, skipped: 0 }
const run = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('the green pair passes: readings run here, skips happen where there is no profile', () => {
  assert.deepEqual(judgeShape('with_home', GREEN), { ok: true, problems: [] })
  assert.deepEqual(judgeShape('without_home', { tests: 11, pass: 7, fail: 0, skipped: 4 }), { ok: true, problems: [] })
})

test('N1: a failing run on an account with no profile is red (the incident shape)', () => {
  const verdict = judgeShape('without_home', { tests: 11, pass: 7, fail: 4, skipped: 0 })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => problem.includes('4 test(s) failed')), verdict.problems.join(' | '))
})

test('N2: turning a reading into a skip on the machine that HAS the profile is red', () => {
  const verdict = judgeShape('with_home', { tests: 11, pass: 10, fail: 0, skipped: 1 })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => problem.includes('skipped on the machine that HAS')), verdict.problems.join(' | '))
})

test('N3: deleting the readings leaves nothing to skip, and that is red too', () => {
  const verdict = judgeShape('without_home', { tests: 7, pass: 7, fail: 0, skipped: 0 })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => problem.includes('nothing skipped')), verdict.problems.join(' | '))
})

test('N4: an unreadable TAP summary is "nothing proven", not a pass', () => {
  const verdict = judgeShape('with_home', { tests: null, pass: null, fail: null, skipped: null })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems[0]?.includes('unreadable'), verdict.problems.join(' | '))
})

test('the skip-tolerant list is exactly the two files that read this machine', () => {
  assert.deepEqual([...SKIP_TOLERATED_FILES].sort(), [
    'tests/unit/composition-source.test.ts',
    'tests/unit/desktop-misreport.test.ts',
  ])
})

test('those two files really do skip instead of asserting a profile exists', () => {
  /*
   * The point of the list is that the shape it names is the shape on disk. If a future round puts
   * `assert.equal(env.ok, true)` back into either file, the list above would still "pass" while the
   * CI shape went red again — so pin the guards themselves, not just the file names.
   */
  for (const path of [...SKIP_TOLERATED_FILES]) {
    const body = run(path)
    assert.ok(body.includes('t.skip('), `${path} must skip instead of failing when there is no profile`)
    assert.ok(
      !/assert\.equal\(env\.ok, true/.test(body),
      `${path} must not assert that this machine has a profile (that is what made CI red for a day)`,
    )
  }
})

test('N5: the handover-claims typecheck fix is in the file, not only in the transcript', () => {
  // The `string | undefined` error came from a `.map(match => match[1])` under `noUncheckedIndexedAccess`.
  const body = run('tests/governance/handover-claims.test.ts')
  assert.match(body, /filter\(\(file\): file is string => file !== undefined\)/u)
})

/* ------------------------------------------------------------------------------------------------
 * R107 · the gate half: `judgeShapes` decides whether the `with_home` side could mean anything here.
 * The recorder only prints; `scripts/gate_clean_home.mjs` fails the build, so these are the six
 * shapes that must be separated (and the one that must NOT be red, or the gate blocks every runner).
 * ---------------------------------------------------------------------------------------------- */
const RUN = { tests: 11, pass: 11, fail: 0, skipped: 0 }
const SKIPPED = { tests: 11, pass: 7, fail: 0, skipped: 4 }
const UNREADABLE = { tests: null, pass: null, fail: null, skipped: null }

test('M17-N1: on a machine WITH a profile, a skipped reading is red even when nothing failed', () => {
  const verdict = judgeShapes({ profilePresent: true, withHome: SKIPPED, withoutHome: SKIPPED })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => problem.includes('skipped on the machine that HAS')), verdict.problems.join(' | '))
})

test('M17-N2: on a machine with NO profile, zero skips is red (the readings were deleted, not adapted)', () => {
  const verdict = judgeShapes({ profilePresent: false, withHome: RUN, withoutHome: RUN })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => problem.includes('nothing skipped')), verdict.problems.join(' | '))
})

test('M17-N3: the 2026-11-12 CI shape is red whichever side it arrives on', () => {
  const failing = { tests: 11, pass: 7, fail: 4, skipped: 0 }
  for (const profilePresent of [true, false]) {
    const verdict = judgeShapes({ profilePresent, withHome: RUN, withoutHome: failing })
    assert.equal(verdict.ok, false, `profilePresent=${String(profilePresent)}`)
    assert.ok(verdict.problems.some((problem) => problem.includes('4 test(s) failed')), verdict.problems.join(' | '))
  }
})

test('M17-N4: a runner with no profile is GREEN — the gate must not fail the machine it runs on', () => {
  // Both runs see the same empty home there; demanding 0 skips would make this gate red on every CI job.
  assert.deepEqual(judgeShapes({ profilePresent: false, withHome: SKIPPED, withoutHome: SKIPPED }), { ok: true, problems: [] })
})

test('M17-N5: an unreadable summary is not green on either machine', () => {
  assert.equal(judgeShapes({ profilePresent: false, withHome: UNREADABLE, withoutHome: SKIPPED }).ok, false)
  assert.equal(judgeShapes({ profilePresent: true, withHome: RUN, withoutHome: UNREADABLE }).ok, false)
})

test('M17-N6: on a machine with a profile, both shapes green passes', () => {
  assert.deepEqual(judgeShapes({ profilePresent: true, withHome: RUN, withoutHome: SKIPPED }), { ok: true, problems: [] })
})

test('M17: the gate is registered and names the incident as its injection', () => {
  const ledger = JSON.parse(run('audit/gate_ledger.json')) as {
    gates: { id: string; script: string; negative_control: string }[]
  }
  const gate = ledger.gates.find((entry) => entry.id === 'clean-home')
  assert.ok(gate !== undefined, 'clean-home must be registered in audit/gate_ledger.json')
  assert.equal(gate.script, 'scripts/gate_clean_home.mjs')
  assert.match(gate.negative_control, /--mutate/u)
  assert.ok(run(gate.script).includes('judgeShapes'), 'the gate must judge, not print')
})
