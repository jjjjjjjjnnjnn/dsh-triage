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

test('the plan always isolates DSH_HOME and documents cleanup', () => {
  const plan = buildProbePlan({ candidate: 'x', realDshHome, workRoot })
  assert.ok(plan.ok)
  if (!plan.ok) return
  assert.ok(isAbsolute(plan.value.sandboxHome), 'sandbox path must be absolute on this platform')
  for (const step of plan.value.steps.filter((item) => item.id !== 'cleanup')) {
    assert.equal(step.env.DSH_HOME, plan.value.sandboxHome, `${step.id} must set DSH_HOME`)
  }
  assert.ok(plan.value.steps.some((step) => step.id === 'cleanup'))
  assert.ok(plan.value.warnings.some((warning) => warning.includes('dry-run')))
  assert.ok(plan.value.assertions.some((assertion) => assertion.id === 'client-rendered'), 'BS-03: HTTP 200 is not enough')
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
