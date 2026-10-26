#!/usr/bin/env node
/**
 * Gate: verdict contract.
 *
 * Every verdict file under `data/results/` must satisfy the contract in
 * `docs/05-verdict-contract.md`. This is the gate that stops the project from
 * degrading into "a plausible score with no evidence".
 *
 * Negative control: `--mutate` injects a `blocked` verdict with no remediation.
 */

import { Checks, listDir, readJson, readText, runGate } from './lib/kit.mjs'

const TIERS = new Set(['declared', 'scanned', 'measured-registry', 'measured-local', 'inferred'])
const CONCLUSIONS = new Set(['go', 'risky', 'blocked', 'unknown'])
const SEVERITIES = new Set(['block', 'warn', 'info'])
const CONFIDENCE = new Set(['low', 'medium', 'high'])
const MESSAGE_ID = /^(admission|collision|remediation|missing)\.[a-z0-9.-]+$/

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')

function validateVerdict(verdict, where) {
  const problems = []
  if (verdict === null || typeof verdict !== 'object') return [`${where}: verdict is not an object`]
  if (verdict.schemaVersion !== 1) problems.push(`${where}: schemaVersion must be 1`)
  if (!CONCLUSIONS.has(verdict.conclusion)) problems.push(`${where}: unknown conclusion ${String(verdict.conclusion)}`)

  const subject = verdict.subject
  if (subject === null || typeof subject !== 'object') problems.push(`${where}: missing subject`)
  else if (!isNonEmptyString(subject.name)) problems.push(`${where}: subject.name missing`)

  const env = verdict.env
  if (env === null || typeof env !== 'object') problems.push(`${where}: missing env`)
  else {
    for (const key of ['node', 'platform', 'arch', 'profile', 'profileDir']) {
      if (!isNonEmptyString(env[key])) problems.push(`${where}: env.${key} missing`)
    }
    if (!Array.isArray(env.bundles)) problems.push(`${where}: env.bundles missing`)
  }

  const evidence = verdict.evidence
  if (!Array.isArray(evidence) || evidence.length === 0) problems.push(`${where}: evidence must be non-empty`)
  else {
    for (const [index, item] of evidence.entries()) {
      if (!TIERS.has(item?.tier)) problems.push(`${where}: evidence[${index}].tier invalid`)
      for (const key of ['id', 'source', 'method', 'at']) {
        if (!isNonEmptyString(item?.[key])) problems.push(`${where}: evidence[${index}].${key} missing`)
      }
    }
  }

  const confidence = verdict.confidence
  if (confidence === null || typeof confidence !== 'object') problems.push(`${where}: missing confidence`)
  else {
    if (!CONFIDENCE.has(confidence.level)) problems.push(`${where}: confidence.level invalid`)
    if (!TIERS.has(confidence.basis)) problems.push(`${where}: confidence.basis invalid`)
  }

  const reasons = verdict.reasons
  if (!Array.isArray(reasons)) problems.push(`${where}: reasons must be an array`)
  else {
    for (const [index, reason] of reasons.entries()) {
      if (!isNonEmptyString(reason?.code)) problems.push(`${where}: reasons[${index}].code missing`)
      if (!SEVERITIES.has(reason?.severity)) problems.push(`${where}: reasons[${index}].severity invalid`)
      if (!MESSAGE_ID.test(String(reason?.messageId))) {
        problems.push(`${where}: reasons[${index}].messageId must be a catalogue id, not prose`)
      }
    }
  }

  const remediation = verdict.remediation
  if (!Array.isArray(remediation)) problems.push(`${where}: remediation must be an array`)
  else {
    for (const [index, item] of remediation.entries()) {
      if (!isNonEmptyString(item?.kind)) problems.push(`${where}: remediation[${index}].kind missing`)
      if (!isNonEmptyString(item?.note)) problems.push(`${where}: remediation[${index}].note missing`)
    }
  }

  if ((verdict.conclusion === 'blocked' || verdict.conclusion === 'risky') && (!Array.isArray(remediation) || remediation.length === 0)) {
    problems.push(`${where}: ${verdict.conclusion} verdict without remediation`)
  }
  if (verdict.conclusion === 'unknown' && !isStringArray(verdict.missingEvidence)) {
    problems.push(`${where}: unknown verdict must list missingEvidence`)
  }
  if (verdict.conclusion === 'unknown' && Array.isArray(verdict.missingEvidence) && verdict.missingEvidence.length === 0) {
    problems.push(`${where}: unknown verdict has empty missingEvidence`)
  }

  return problems
}

await runGate('verdict-contract', async ({ checks, mutate }) => {
  const files = listDir('data/results')
    .filter((entry) => entry.isFile && entry.name.endsWith('.json'))
    .map((entry) => `data/results/${entry.name}`)

  checks.require('results-directory', files.length > 0, 'no data/results/*.json — run `node scripts/scan_env.mjs`')

  const verdicts = []
  for (const file of files) {
    let payload
    try {
      payload = readJson(file)
    } catch (error) {
      checks.add(`json:${file}`, false, error instanceof Error ? error.message : String(error))
      continue
    }
    if (Array.isArray(payload.verdicts)) {
      for (const verdict of payload.verdicts) verdicts.push({ verdict, where: file })
    }
    if (payload.verdict !== undefined) verdicts.push({ verdict: payload.verdict, where: file })
  }

  checks.require('verdicts-present', verdicts.length > 0, `${verdicts.length} verdicts across ${files.length} files`)

  if (mutate && verdicts.length > 0) {
    // Deliberate violation: blocked with no remediation.
    const first = verdicts[0]
    verdicts[0] = {
      where: first.where,
      verdict: { ...first.verdict, conclusion: 'blocked', remediation: [] },
    }
  }

  for (const { verdict, where } of verdicts) {
    const label = `${where}:${String(verdict?.subject?.name ?? '?')}`
    const problems = validateVerdict(verdict, label)
    checks.add(`verdict:${label}`, problems.length === 0, problems.slice(0, 3).join(' | '))
  }

  const contract = readText('docs/05-verdict-contract.md')
  checks.require('contract-documented', contract.includes('conclusion') && contract.includes('missingEvidence'))
})
