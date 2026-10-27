#!/usr/bin/env node
/**
 * Gate: inventory contract (M2-a / T-201).
 *
 * Three ways this layer rots silently, all locked here:
 *
 * 1. **Mapping drift** — someone edits the phase→conclusion table in code and the
 *    spec keeps saying something else. `tests/fixtures/inventory/cases.json`
 *    encodes the spec's rows; every case is replayed against the built engine.
 * 2. **Upstream enum drift** — `fiberPhase` is upstream's enum. If it is renamed
 *    or extended, a lenient parser would treat the new value as "fine". The
 *    fixture refuses unknown values, and this gate additionally compares the
 *    recorded `fiber_phase` sample (`data/results/upstream-*.json`) against the
 *    enum the code declares.
 * 3. **Untranslated copy** — a phase reason without a `zh`/`en` template renders
 *    as `?runtime.no-fiber`, which is exactly the kind of half-shipped message
 *    this project must not emit.
 *
 * Negative control: `--mutate` flips the first fixture's expectation, so the
 * engine can no longer satisfy it. The gate MUST exit 1.
 */

import { listDir, Checks, exists, fileUrl, readJson, readText, runGate } from './lib/kit.mjs'

const FIXTURES = 'tests/fixtures/inventory/cases.json'
const SPEC = 'docs/specs/M2-inventory.md'
const RUNTIME_REASON_CODES = [
  'runtime.fiber-failed',
  'runtime.no-fiber',
  'runtime.disabled',
  'runtime.missing-entry',
  'runtime.undeclared-entry',
  'runtime.preset-unjudged',
]

await runGate('inventory-contract', async ({ checks, mutate }) => {
  const buildPath = 'packages/core/dist/inventory.js'
  if (!checks.require('core-built', exists(buildPath), 'run `pnpm build` first')) return
  const core = await import(fileUrl(buildPath))
  const catalogPath = 'packages/core/dist/messages.js'
  if (!checks.require('messages-built', exists(catalogPath), 'run `pnpm build` first')) return
  const messages = await import(fileUrl(catalogPath))

  /* 1. mapping fixtures */
  const fixtures = readJson(FIXTURES)
  const cases = Array.isArray(fixtures.cases) ? [...fixtures.cases] : []
  checks.require('fixtures-present', cases.length >= 8, `${cases.length} fixture case(s)`)

  if (mutate && cases.length > 0) {
    // Deliberate violation: keep the snapshot, corrupt the signed expectation.
    cases[0].expect = { conclusion: 'blocked', code: 'runtime.fiber-failed' }
    cases[0].snapshot = {
      entries: [{ entryId: 'tools', moduleName: '@deepseek-ai/dsh-tools', enabled: true, fiberPhase: 'active' }],
    }
  }

  const env = {
    dsh: '0.2.1-rc.2',
    node: '22.19.0',
    platform: 'linux',
    arch: 'x64',
    profile: String(fixtures.profile ?? 'web'),
    profileDir: '~/.dsh/profiles/web',
    bundles: [],
    installed: [],
  }

  for (const testCase of cases) {
    const id = String(testCase.id ?? '<unnamed>')
    const expected = testCase.expect ?? {}
    const parsed = core.parseInventorySnapshot(testCase.snapshot, {
      source: `fixture:${id}`,
      sampledAt: String(fixtures.sampled_at ?? '2026-10-26T00:00:00.000Z'),
      profile: env.profile,
    })

    if (typeof expected.error === 'string') {
      checks.add(`case:${id}`, parsed.ok === false && parsed.error.code === expected.error, parsed.ok ? 'parsed an input the contract refuses' : `${parsed.error.code} vs expected ${expected.error}`)
      continue
    }
    if (!parsed.ok) {
      checks.add(`case:${id}`, false, `refused a valid fixture: ${parsed.error.code} — ${parsed.error.detail}`)
      continue
    }

    const verdicts = core.verdictsFromInventory({
      env,
      snapshot: parsed.value,
      declared: Array.isArray(testCase.declared) ? testCase.declared : [],
      generatedAt: '2026-10-26T00:00:00.000Z',
    })
    const wanted = String(expected.conclusion ?? '')
    if (wanted === 'none') {
      // "No verdict" is a claim too: a silent `active` row must not produce one.
      checks.add(`case:${id}`, verdicts.length === 0, `expected silence, got ${verdicts.map((v) => v.conclusion).join(',')}`)
      continue
    }
    const hit = verdicts.find(
      (verdict) =>
        verdict.conclusion === wanted && verdict.reasons.some((reason) => reason.code === expected.code),
    )
    checks.add(
      `case:${id}`,
      hit !== undefined,
      hit === undefined
        ? `expected ${wanted}/${String(expected.code)}, got ${verdicts.map((v) => `${v.conclusion}:${v.reasons.map((r) => r.code).join('+')}`).join(' | ') || 'nothing'}`
        : `${wanted}/${String(expected.code)}`,
    )
    // Contract invariants that must hold for every emitted verdict.
    for (const verdict of verdicts) {
      const problems = []
      if (verdict.evidence.length === 0) problems.push('no evidence')
      if (verdict.evidence.some((item) => item.tier !== 'measured-local')) problems.push('phase evidence must be measured-local')
      if (verdict.conclusion !== 'unknown' && verdict.remediation.length === 0) problems.push('missing remediation')
      if (verdict.conclusion === 'unknown' && verdict.missingEvidence.length === 0) problems.push('unknown without missingEvidence')
      checks.add(`contract:${id}:${verdict.subject.name}`, problems.length === 0, problems.join(' | '))
    }
  }

  /* 2. upstream enum drift, compared with the recorded sample */
  const upstream = listDir('data/results')
    .filter((entry) => entry.isFile && /^upstream-.*\.json$/.test(entry.name))
    .map((entry) => `data/results/${entry.name}`)
    .sort()
  if (!checks.require('upstream-sample', upstream.length > 0, 'no data/results/upstream-*.json to compare the enum against')) return
  const sample = readJson(upstream[upstream.length - 1])
  const recorded = Array.isArray(sample?.inventory?.fiber_phase) ? sample.inventory.fiber_phase : null
  if (!checks.require('upstream-enum-present', recorded !== null, 'inventory.fiber_phase missing from the upstream sample')) return
  const observed = recorded.filter((value) => value !== null && value !== undefined).map(String)
  const declared = [...core.FIBER_PHASES]
  if (mutate) observed.push('sleeping')
  const unknown = observed.filter((value) => !declared.includes(value))
  checks.add(
    'upstream-enum-matches',
    unknown.length === 0,
    unknown.length === 0 ? `${observed.length} phase(s) match ${declared.join('|')}` : `upstream phases not in the engine: ${unknown.join(', ')}`,
  )

  /* 3. every runtime reason is translated, and the spec agrees with the fixtures */
  const specLines = readText(SPEC).split(/\r?\n/)
  for (const code of RUNTIME_REASON_CODES) {
    for (const locale of ['en', 'zh']) {
      const template = messages.catalogFor(locale).messages[code]
      checks.add(`message:${locale}:${code}`, typeof template === 'string' && template.length > 0, template ?? 'missing template')
    }

    // The spec used to be checked by `spec.includes(code)` alone, which let a
    // one-word edit (`blocked` → `go`) pass every gate. The fixtures are the
    // executable form of the table, so the spec row that names this code must
    // state the same conclusion the fixtures demand.
    const expected = cases
      .map((testCase) => testCase.expect)
      .filter((expect) => expect?.code === code && typeof expect.conclusion === 'string')
      .map((expect) => String(expect.conclusion))
    const rows = specLines.filter((line) => line.startsWith('|') && line.includes(code))
    checks.add(`spec:${code}`, rows.length > 0, `${SPEC} must document ${code}`)
    if (rows.length === 0 || expected.length === 0) continue
    const wanted = [...new Set(expected)]
    // The conclusion column comes first in these rows; later mentions are prose
    // ("risky, not blocked"), so only the first token counts as the stated verdict.
    const stated = [
      ...new Set(
        rows
          .map((line) => [...line.matchAll(/\b(go|risky|blocked|unknown)\b/g)].map((match) => match[1])[0])
          .filter((token) => token !== undefined),
      ),
    ]
    const agrees = wanted.every((conclusion) => stated.includes(conclusion)) && stated.every((token) => wanted.includes(token))
    checks.add(
      `spec-table:${code}`,
      agrees,
      agrees
        ? `spec and fixtures agree on ${wanted.join('|')}`
        : `fixtures say ${wanted.join('|')}, spec row states ${stated.join('|') || '(nothing)'}`,
    )
  }
})

void Checks
