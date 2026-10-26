#!/usr/bin/env node
/**
 * Gate: admission parity.
 *
 * Locks `@dsh-triage/core` admission behaviour to the signed golden fixtures in
 * `data/gold/admission-cases.json`, which encode the upstream semantics of
 * `@deepseek-ai/dsh-app-boot@0.2.1-rc.2`.
 *
 * Negative control: `--mutate` swaps the first case's manifest so the signed
 * expectation can no longer hold. The gate MUST then exit 1.
 */

import { Checks, exists, fileUrl, readJson, runGate } from './lib/kit.mjs'

const STATUSES = new Set(['admitted', 'denied', 'unconstrained', 'indeterminate'])

await runGate('admission-parity', async ({ checks, mutate }) => {
  const buildPath = 'packages/core/dist/admission.js'
  if (!checks.require('core-built', exists(buildPath), 'run `pnpm build` first')) return
  const { evaluateAdmission } = await import(fileUrl(buildPath))

  const gold = readJson('data/gold/admission-cases.json')
  checks.require('gold-schema', gold.schema_version === 1, `schema_version=${String(gold.schema_version)}`)
  checks.require('gold-runtime', typeof gold.runtime === 'string' && gold.runtime.length > 0, gold.runtime)

  const cases = Array.isArray(gold.cases) ? [...gold.cases] : []
  checks.require('gold-case-count', cases.length >= 15, `${cases.length} cases`)
  checks.require(
    'gold-has-real-snapshots',
    cases.filter((item) => item.kind === 'real').length >= 5,
    `${cases.filter((item) => item.kind === 'real').length} real cases`,
  )
  const covered = new Set(cases.map((item) => item.expect?.status))
  checks.require('gold-status-coverage', covered.size >= 3, [...covered].join(','))

  if (mutate) {
    // Deliberate violation: keep the signed expectation, destroy the manifest.
    const target = cases.find((item) => item.expect?.status === 'admitted')
    if (target !== undefined) {
      target.manifest = { engines: { dsh: '0.0.1' } }
    } else {
      checks.add('mutate-had-target', false, 'no admitted case to mutate')
    }
  }

  for (const testCase of cases) {
    const id = String(testCase.id ?? '<unnamed>')
    const expected = testCase.expect ?? {}
    const result = evaluateAdmission(testCase.manifest, gold.runtime)
    const statusSkew = result.status !== expected.status
    checks.add(
      `case:${id}`,
      !statusSkew && STATUSES.has(result.status),
      statusSkew ? `expected ${String(expected.status)}, got ${result.status}` : `${result.status}`,
    )

    const expectedUnmet = Array.isArray(expected.unmet) ? [...expected.unmet].sort() : []
    const actualUnmet = result.unmet.map((requirement) => requirement.key).sort()
    if (expectedUnmet.length > 0) {
      checks.add(
        `unmet:${id}`,
        JSON.stringify(expectedUnmet) === JSON.stringify(actualUnmet),
        `expected [${expectedUnmet.join(',')}], got [${actualUnmet.join(',')}]`,
      )
    }
  }
})
