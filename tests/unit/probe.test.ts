import assert from 'node:assert/strict'
import { isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { buildProbePlan, validateProbePlan } from '@dsh-triage/probe'

// Platform-independent absolute paths: CI runs on Linux, dev on Windows.
const workRoot = join(tmpdir(), 'dsh-triage-probe')
const realDshHome = join(tmpdir(), 'dsh-triage-real-home', '.dsh')

test('probe plan is deterministic for the same candidate', () => {
  const a = buildProbePlan({ candidate: 'dsh-cost-meter', realDshHome, workRoot })
  const b = buildProbePlan({ candidate: 'dsh-cost-meter', realDshHome, workRoot })
  assert.ok(a.ok && b.ok)
  if (!a.ok || !b.ok) return
  assert.equal(a.value.sandboxHome, b.value.sandboxHome)
  assert.equal(a.value.port, b.value.port)
  assert.deepEqual(a.value.steps, b.value.steps)
})

test('different candidates get different sandboxes and ports', () => {
  const a = buildProbePlan({ candidate: 'dsh-cost-meter', realDshHome, workRoot })
  const b = buildProbePlan({ candidate: 'dsh-pet', realDshHome, workRoot })
  assert.ok(a.ok && b.ok)
  if (!a.ok || !b.ok) return
  assert.notEqual(a.value.sandboxHome, b.value.sandboxHome)
  assert.ok(a.value.port >= 53000 && a.value.port < 54000)
})

test('a sandbox nested inside the real DSH home is refused', () => {
  const plan = buildProbePlan({ candidate: 'x', realDshHome, workRoot: `${realDshHome}/probe` })
  assert.equal(plan.ok, false)
  if (plan.ok) return
  assert.equal(plan.error.code, 'sandbox-overlaps-real-home')
})

/**
 * T-304: a copy plan must say where it came from, keep the source's profile name, and put the
 * profile step before the candidate install.
 */
test('a copy plan records its origin, keeps the source profile name, and copies before installing', () => {
  const plan = buildProbePlan({ candidate: 'x', realDshHome, workRoot, copyProfile: 'desktop' })
  assert.ok(plan.ok)
  if (!plan.ok) return
  assert.equal(plan.value.profileOrigin, 'copy:desktop')
  assert.equal(plan.value.profile, 'desktop', 'the source name decides which composition the launcher reads')
  assert.equal(plan.value.profileSource?.dir, join(realDshHome, 'profiles', 'desktop'))
  const ids = plan.value.steps.map((step) => step.id)
  assert.deepEqual(ids.slice(0, 3), ['runtime', 'profile', 'install'])
  assert.ok(plan.value.warnings.some((warning) => warning.includes('declarations only')))
  // A template plan must not grow a profile step: the two shapes stay distinguishable.
  const template = buildProbePlan({ candidate: 'x', realDshHome, workRoot })
  assert.ok(template.ok)
  if (!template.ok) return
  assert.equal(template.value.profileOrigin, 'template')
  assert.equal(template.value.profileSource, null)
  assert.ok(!template.value.steps.some((step) => step.id === 'profile'))
})

test('a copy profile name that could climb out of the profiles directory is refused', () => {
  for (const name of ['../evil', 'a/b', 'C:\\x', '..', '.']) {
    const plan = buildProbePlan({ candidate: 'x', realDshHome, workRoot, copyProfile: name })
    assert.equal(plan.ok, false, `"${name}" must be refused`)
    if (plan.ok) continue
    assert.equal(plan.error.code, 'invalid-copy-profile')
  }
})

test('a source profile that overlaps the sandbox is refused, in both directions', () => {
  const built = buildProbePlan({ candidate: 'x', realDshHome, workRoot, copyProfile: 'desktop' })
  assert.ok(built.ok)
  if (!built.ok) return
  const base = built.value
  for (const dir of [base.sandboxHome, join(base.sandboxHome, 'profiles', 'desktop', 'inner')]) {
    const verdict = validateProbePlan({
      plan: { ...base, profileSource: { name: 'desktop', dir } },
      realDshHome,
    })
    assert.equal(verdict.ok, false, `${dir} must be refused`)
    if (verdict.ok) continue
    assert.equal(verdict.error.code, 'profile-source-overlaps-sandbox')
  }
})

test('the plan always isolates DSH_HOME and documents cleanup', () => {
  const plan = buildProbePlan({ candidate: 'x', realDshHome, workRoot })
  assert.ok(plan.ok)
  if (!plan.ok) return
  assert.ok(isAbsolute(plan.value.sandboxHome), 'sandbox path must be absolute on this platform')
  // `http` and `render` exercise the sandbox from outside (fetch / a browser) and carry
  // no DSH_HOME of their own; every DSH invocation must still point at the sandbox.
  for (const step of plan.value.steps.filter((item) => item.id !== 'cleanup' && item.id !== 'http' && item.id !== 'render')) {
    assert.equal(step.env.DSH_HOME, plan.value.sandboxHome, `${step.id} must set DSH_HOME`)
  }
  assert.ok(plan.value.steps.some((step) => step.id === 'cleanup'))
  assert.ok(plan.value.steps.some((step) => step.id === 'http'), 'the plan must show the readiness probe it runs')
  assert.ok(plan.value.steps.some((step) => step.id === 'render'), 'T-302: the plan must show the render check it runs')
  assert.ok(plan.value.warnings.some((warning) => warning.includes('dry-run')))
  const rendered = plan.value.assertions.find((assertion) => assertion.id === 'client-rendered')
  assert.ok(rendered !== undefined, 'BS-03: HTTP 200 is not enough')
  assert.equal(rendered?.measured, true, 'T-302 made this measurable; a machine without a browser reports unmeasured at run time')
  assert.equal(plan.value.assertions.find((assertion) => assertion.id === 'namespace-diff')?.measured, false)
  assert.equal(plan.value.assertions.find((assertion) => assertion.id === 'boot-sampled')?.measured, true)
})

test('validateProbePlan rejects an equal sandbox and accepts a sibling', () => {
  const plan = buildProbePlan({ candidate: 'x', realDshHome, workRoot })
  assert.ok(plan.ok)
  if (!plan.ok) return
  assert.equal(validateProbePlan({ plan: plan.value, realDshHome }).ok, true)
  const hostile = { ...plan.value, sandboxHome: realDshHome }
  const verdict = validateProbePlan({ plan: hostile, realDshHome })
  assert.equal(verdict.ok, false)
})

test('an empty candidate is rejected, not guessed', () => {
  const plan = buildProbePlan({ candidate: '   ', realDshHome, workRoot })
  assert.equal(plan.ok, false)
  if (plan.ok) return
  assert.equal(plan.error.code, 'invalid-candidate')
})

test('a profile name that could climb out of the sandbox is refused', () => {
  for (const profile of ['../../evil', '..\\..\\evil', 'a/b', '..', '']) {
    const plan = buildProbePlan({ candidate: 'x', realDshHome, workRoot, profile })
    assert.equal(plan.ok, false, `profile "${profile}" must be refused`)
    if (plan.ok) continue
    assert.equal(plan.error.code, 'invalid-profile')
  }
})

test('the sandbox directory name never carries the candidate path', () => {
  // A Windows absolute candidate used to slugify into `C-Users-<name>-…`, which published
  // the account name inside every artifact (R14 audit finding F-2).
  const candidate = 'C:\\Users\\someone\\Desktop\\project\\tests\\fixtures\\probe\\ok-plugin'
  const plan = buildProbePlan({ candidate, realDshHome, workRoot })
  assert.ok(plan.ok)
  if (!plan.ok) return
  const tail = plan.value.sandboxHome.slice(workRoot.length + 1)
  assert.ok(tail.startsWith('ok-plugin-'), `expected basename-based slug, got ${tail}`)
  assert.equal(tail.includes('someone'), false)
  assert.equal(tail.includes('C-Users'), false)
})
