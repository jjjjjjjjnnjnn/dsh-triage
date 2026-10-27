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

import { listDir, readJson, readText, runGate } from './lib/kit.mjs'

const TIERS = new Set(['declared', 'scanned', 'measured-registry', 'measured-local', 'inferred'])
const CONCLUSIONS = new Set(['go', 'risky', 'blocked', 'unknown'])
const SEVERITIES = new Set(['block', 'warn', 'info'])
const CONFIDENCE = new Set(['low', 'medium', 'high'])
const MESSAGE_ID = /^(admission|collision|registry|runtime|remediation|missing|probe)\.[a-z0-9.-]+$/

/**
 * Extract the catalogue keys AND their `{placeholder}` requirements from the single
 * source of truth for user-facing text.
 *
 * WHY the placeholders: a reason whose copy says "declared range rejects this
 * runtime ({runtime})" but whose `params` omit `runtime` renders a literal
 * `{runtime}` to the user — the message is technically present, so the old
 * key-only check stayed green (R8 review finding F7 / T-116). Placeholders are
 * unioned across locales: a value needed by either translation must be supplied.
 */
function readMessageCatalog() {
  const source = readText('packages/core/src/messages.ts')
  const keys = new Set()
  const placeholders = new Map()
  for (const match of source.matchAll(/^\s*'([a-zA-Z][\w.-]+)':\s*'((?:[^'\\]|\\.)*)'/gm)) {
    const [, key, template] = match
    keys.add(key)
    const required = placeholders.get(key) ?? new Set()
    for (const holder of template.matchAll(/\{(\w+)\}/g)) required.add(holder[1])
    placeholders.set(key, required)
  }
  return { keys, placeholders }
}

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')

/**
 * Which `{placeholder}`s of this messageId are missing from `params`.
 *
 * A missing key, `null`, or an empty string all count as missing: `format()`
 * leaves an unresolved `{key}` on screen, which is the failure mode this check
 * exists for. Extra params are tolerated (they may be used by a future locale).
 */
function missingPlaceholders(placeholders, messageId, params) {
  const required = placeholders.get(messageId)
  if (required === undefined || required.size === 0) return []
  const provided = params !== null && typeof params === 'object' ? params : {}
  return [...required]
    .filter((key) => provided[key] === undefined || provided[key] === null || String(provided[key]).length === 0)
    .sort()
}

function validateVerdict(verdict, where, catalog) {
  const placeholders = catalog.placeholders
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
      } else if (!catalog.keys.has(reason.messageId)) {
        // Catches the classic "added a reason, forgot the copy" bug: the CLI would
        // render `?admission.foo` instead of failing loudly.
        problems.push(`${where}: reasons[${index}].messageId "${reason.messageId}" is missing from messages.ts`)
      } else {
        const missing = missingPlaceholders(placeholders, reason.messageId, reason.params)
        if (missing.length > 0) {
          problems.push(
            `${where}: reasons[${index}].params missing ${missing.map((key) => `{${key}}`).join(', ')} required by "${reason.messageId}"`,
          )
        }
      }
    }
  }

  const remediation = verdict.remediation
  if (!Array.isArray(remediation)) problems.push(`${where}: remediation must be an array`)
  else {
    for (const [index, item] of remediation.entries()) {
      if (!isNonEmptyString(item?.kind)) problems.push(`${where}: remediation[${index}].kind missing`)
      if (!isNonEmptyString(item?.note)) problems.push(`${where}: remediation[${index}].note missing`)
      if (item?.messageId !== undefined && !catalog.keys.has(item.messageId)) {
        problems.push(`${where}: remediation[${index}].messageId "${item.messageId}" is missing from messages.ts`)
      } else if (item?.messageId !== undefined) {
        const missing = missingPlaceholders(placeholders, item.messageId, item.params)
        if (missing.length > 0) {
          problems.push(
            `${where}: remediation[${index}].params missing ${missing.map((key) => `{${key}}`).join(', ')} required by "${item.messageId}"`,
          )
        }
      }
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
  const catalog = readMessageCatalog()
  checks.require('message-catalog', catalog.keys.size >= 15, `${catalog.keys.size} catalogue keys`)

  // Two-sided self-test: the placeholder assertion must reject a reason that omits
  // a required value AND accept the same reason once the value is supplied. Without
  // this, a typo in the template parser would leave the new check vacuously green.
  const selfReason = (params) => ({
    code: 'self-test',
    severity: 'info',
    messageId: 'admission.admitted',
    ...(params === undefined ? {} : { params }),
  })
  const selfVerdict = (reason) => ({
    schemaVersion: 1,
    subject: { name: 'self-test', version: null, kind: 'plugin' },
    env: { node: '22.19.0', platform: 'linux', arch: 'x64', profile: 'self', profileDir: '<profile>', bundles: [] },
    conclusion: 'go',
    confidence: { level: 'medium', basis: 'declared' },
    reasons: [reason],
    evidence: [{ id: 'self', tier: 'declared', source: 'self-test', method: 'none', at: '1970-01-01T00:00:00.000Z' }],
    remediation: [],
    missingEvidence: [],
  })
  const rejectsMissing = validateVerdict(selfVerdict(selfReason()), 'self-test', catalog).some((problem) =>
    problem.includes('params missing {runtime}'),
  )
  const acceptsPresent = validateVerdict(
    selfVerdict(selfReason({ runtime: '0.2.1-rc.2' })),
    'self-test',
    catalog,
  ).length === 0
  const rejectsMissingRemediation = validateVerdict(
    {
      ...selfVerdict(selfReason({ runtime: '0.2.1-rc.2' })),
      remediation: [{ kind: 'pin-version', messageId: 'remediation.pin-version', note: 'self-test' }],
    },
    'self-test',
    catalog,
  ).some((problem) => problem.includes('remediation[0].params missing {profile}, {runtime}'))
  checks.require(
    'placeholder-params-required',
    rejectsMissing && acceptsPresent && rejectsMissingRemediation,
    'a reason or remediation that omits a required {placeholder} must be rejected, and accepted once params carry it',
  )

  // Two render paths receive NO params at all: `renderVerdict` prints
  // `missingEvidence[]` as a bare messageId and composes the conclusion label from
  // `conclusion.*`. A `{placeholder}` in those entries can never be filled, so the
  // gate rejects it statically instead of waiting for a confused user
  // (R9 adversary finding: the check above only covered reasons/remediation).
  const unrendered = [...catalog.placeholders.entries()]
    .filter(([key, required]) => required.size > 0 && (key.startsWith('missing.') || key.startsWith('conclusion.')))
    .map(([key, required]) => `${key} needs ${[...required].map((name) => `{${name}}`).join(', ')}`)
  checks.require(
    'no-placeholders-without-params',
    unrendered.length === 0,
    unrendered.length === 0 ? 'missing.* and conclusion.* carry no unfillable placeholders' : unrendered.slice(0, 3).join(' | '),
  )

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

  // Anti-vacuity guard for the second mutation below: if no committed verdict ever
  // renders a placeholder-bearing messageId, the mutation has nothing to hit and a
  // green suite would prove less than it claims (R9 adversary finding).
  const exercisesPlaceholders = verdicts.some(({ verdict }) =>
    Array.isArray(verdict?.reasons)
      ? verdict.reasons.some((reason) => (catalog.placeholders.get(reason?.messageId)?.size ?? 0) > 0)
      : false,
  )
  checks.require(
    'placeholder-copy-present',
    exercisesPlaceholders,
    'at least one committed verdict must use a messageId whose copy needs params, or the mutation below is vacuous',
  )

  if (mutate && verdicts.length > 0) {
    // Deliberate violation #1: blocked with no remediation.
    const first = verdicts[0]
    verdicts[0] = {
      where: first.where,
      verdict: { ...first.verdict, conclusion: 'blocked', remediation: [] },
    }
    // Deliberate violation #2: a reason keeps its catalogue id but loses the params
    // that the copy needs, which is the exact shape T-116 exists to catch. It lands
    // on the first verdict that actually renders a placeholder — not necessarily
    // the same one as violation #1.
    const target = verdicts.find(({ verdict }) =>
      Array.isArray(verdict?.reasons)
        ? verdict.reasons.some((reason) => (catalog.placeholders.get(reason?.messageId)?.size ?? 0) > 0)
        : false,
    )
    if (target === undefined) {
      checks.add('mutate-second-injection', false, 'no verdict renders a placeholder-bearing messageId, so the params mutation could not be injected')
    } else {
      const index = verdicts.indexOf(target)
      const reasons = target.verdict.reasons.map((reason) =>
        (catalog.placeholders.get(reason?.messageId)?.size ?? 0) > 0 ? { ...reason, params: {} } : reason,
      )
      verdicts[index] = { where: target.where, verdict: { ...target.verdict, reasons } }
    }
  }

  for (const { verdict, where } of verdicts) {
    const label = `${where}:${String(verdict?.subject?.name ?? '?')}`
    const problems = validateVerdict(verdict, label, catalog)
    checks.add(`verdict:${label}`, problems.length === 0, problems.slice(0, 3).join(' | '))
  }

  const contract = readText('docs/05-verdict-contract.md')
  checks.require('contract-documented', contract.includes('conclusion') && contract.includes('missingEvidence'))
})
