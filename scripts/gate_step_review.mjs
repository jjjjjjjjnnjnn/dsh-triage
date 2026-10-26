#!/usr/bin/env node
/**
 * Gate: step review (HUMAN-mandated 2026-10-26).
 *
 * RULE BEING ENFORCED: every finished step of work must be (a) reviewed on four
 * axes plus an adversary pass, and (b) proven by a REAL run whose artifact is
 * hash-locked. A step that only produced prose, or whose evidence cannot be
 * recomputed, is not done.
 *
 * The ledger is `audit/step_reviews.json`. This gate recomputes the sha256 of
 * every cited artifact, so a retro-edited result cannot pass.
 *
 *   node scripts/gate_step_review.mjs
 *   node scripts/gate_step_review.mjs --json
 *   node scripts/gate_step_review.mjs --mutate   # negative control: MUST fail
 */

import { existsSync } from 'node:fs'
import { listDir, readJson, readText, runGate, sha256 } from './lib/kit.mjs'

const LEDGER = 'audit/step_reviews.json'
const AXES = ['correctness', 'reproducibility', 'licence', 'ssot', 'adversary']
const MIN_NOTE = 12

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0

await runGate('step-review', async ({ checks, mutate }) => {
  const exists = existsSync(LEDGER)
  checks.require('ledger-exists', exists, LEDGER)
  if (!exists) return

  let ledger
  try {
    ledger = readJson(LEDGER)
  } catch (error) {
    checks.add('ledger-parses', false, error instanceof Error ? error.message : String(error))
    return
  }
  checks.add('ledger-parses', true, '')

  const steps = Array.isArray(ledger.steps) ? ledger.steps : []
  checks.require('steps-present', steps.length > 0, `${steps.length} step(s) recorded`)

  const claimedArtifacts = new Set()
  for (const step of steps) {
    const id = isNonEmptyString(step?.id) ? step.id : '<missing id>'
    const problems = []

    if (!isNonEmptyString(step?.id) || !/^[A-Z]+\d+-S\d+$/.test(step.id)) {
      problems.push('id must look like R4-S1')
    }
    if (!isNonEmptyString(step?.batch)) problems.push('batch missing')
    if (!isNonEmptyString(step?.step) || step.step.trim().length < 8) problems.push('step description too short')
    if (!Array.isArray(step?.changed) || step.changed.length === 0) problems.push('changed[] missing')
    else {
      for (const file of step.changed) {
        if (!existsSync(file)) problems.push(`changed file does not exist: ${file}`)
      }
    }

    // 1. Four axes + adversary, each with a real verdict (not "ok").
    const review = step?.review
    if (review === null || typeof review !== 'object') problems.push('review missing')
    else {
      for (const axis of AXES) {
        const note = review[axis]
        if (!isNonEmptyString(note)) problems.push(`review.${axis} missing`)
        else if (note.trim().length < MIN_NOTE) problems.push(`review.${axis} too short to be a verdict`)
        else if (mutate && axis === 'adversary') problems.push('mutate: adversary axis blanked for the negative control')
      }
    }

    // 2. A real run, with a recomputable artifact.
    const test = step?.real_test
    if (test === null || typeof test !== 'object') problems.push('real_test missing')
    else {
      if (!isNonEmptyString(test.command)) problems.push('real_test.command missing')
      if (!isNonEmptyString(test.outcome)) problems.push('real_test.outcome missing')
      if (!isNonEmptyString(test.artifact) || !test.artifact.startsWith('data/results/')) {
        problems.push('real_test.artifact must live under data/results/')
      } else {
        claimedArtifacts.add(test.artifact)
        if (!existsSync(test.artifact)) {
          problems.push(`artifact does not exist: ${test.artifact}`)
        } else {
          const actual = sha256(readText(test.artifact))
          const recorded = isNonEmptyString(test.sha256) ? test.sha256.trim() : ''
          const compared = mutate ? `${actual.slice(0, -1)}0` : actual
          if (recorded !== compared) {
            problems.push(`artifact sha256 mismatch for ${test.artifact}`)
          }
          try {
            const payload = readJson(test.artifact)
            if (!isNonEmptyString(payload?.produced_by) || !payload.produced_by.startsWith('scripts/')) {
              problems.push(`${test.artifact} has no produced_by(scripts/…)`)
            }
            if (!isNonEmptyString(payload?.generated_at)) problems.push(`${test.artifact} has no generated_at`)
          } catch {
            problems.push(`${test.artifact} is not valid JSON`)
          }
        }
        if (!existsSync(`${test.artifact}.sha256`)) problems.push(`missing ${test.artifact}.sha256`)
      }
    }

    checks.add(`step:${id}`, problems.length === 0, problems.slice(0, 4).join(' | '))
  }

  // 3. No orphan SSOT: every result file must be cited by a reviewed step.
  const results = listDir('data/results')
    .filter((entry) => entry.isFile && entry.name.endsWith('.json'))
    .map((entry) => `data/results/${entry.name}`)
  const orphans = results.filter((file) => !claimedArtifacts.has(file))
  checks.require(
    'no-orphan-results',
    orphans.length === 0,
    orphans.length === 0 ? `${results.length} artifacts all cited` : `unreviewed: ${orphans.join(', ')}`,
  )

  // 4. The rule itself must be written where agents actually read it.
  const rules = readText('PROJECT_RULES.md')
  checks.require(
    'rule-documented',
    rules.includes('每步') && rules.includes('step-review'),
    'PROJECT_RULES.md must state the per-step review rule and name this gate',
  )
  const playbook = readText('.agents/rules/execution-playbook.md')
  checks.require(
    'playbook-documented',
    playbook.includes(LEDGER),
    `execution-playbook must point at ${LEDGER}`,
  )
})
