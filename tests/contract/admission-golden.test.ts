import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { evaluateAdmission } from '@dsh-triage/core'

interface GoldCase {
  readonly id: string
  readonly kind: 'synthetic' | 'real'
  readonly source?: string
  readonly recorded_at?: string
  readonly manifest: unknown
  readonly expect: { readonly status: string; readonly unmet?: readonly string[] }
  readonly why: string
}

interface GoldFile {
  readonly schema_version: number
  readonly runtime: string
  readonly signature: { readonly signed_at: string }
  readonly cases: readonly GoldCase[]
}

const gold = JSON.parse(
  readFileSync(new URL('../../data/gold/admission-cases.json', import.meta.url), 'utf8'),
) as GoldFile

test('golden fixtures are signed and versioned', () => {
  assert.equal(gold.schema_version, 1)
  assert.match(gold.runtime, /^\d+\.\d+\.\d+-rc\.\d+$/)
  assert.ok(gold.signature.signed_at.length > 0)
  assert.ok(gold.cases.length >= 15)
})

test('every golden case declares why it exists (no unexplained expectations)', () => {
  for (const testCase of gold.cases) {
    assert.ok(testCase.why.length > 10, `${testCase.id} needs a rationale`)
    assert.ok(['admitted', 'denied', 'unconstrained'].includes(testCase.expect.status), testCase.id)
  }
})

test('real snapshot cases carry provenance', () => {
  const real = gold.cases.filter((testCase) => testCase.kind === 'real')
  assert.ok(real.length >= 5)
  for (const testCase of real) {
    assert.ok(testCase.source?.startsWith('https://registry.npmjs.org/'), `${testCase.id} source`)
    assert.match(String(testCase.recorded_at), /^\d{4}-\d{2}-\d{2}$/)
  }
})

test('implementation matches every signed expectation', () => {
  for (const testCase of gold.cases) {
    const result = evaluateAdmission(testCase.manifest, gold.runtime)
    assert.equal(result.status, testCase.expect.status, `${testCase.id}: ${testCase.why}`)
    if (testCase.expect.unmet !== undefined) {
      assert.deepEqual(
        result.unmet.map((requirement) => requirement.key).sort(),
        [...testCase.expect.unmet].sort(),
        `${testCase.id}: unmet keys`,
      )
    }
  }
})
