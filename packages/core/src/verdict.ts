/**
 * Verdict assembly.
 *
 * Design rules enforced by `scripts/gate_verdict_contract.mjs`:
 * - conclusions come from {@link Conclusion} only;
 * - `blocked` and `risky` must carry at least one remediation;
 * - `unknown` must carry `missingEvidence`;
 * - `evidence` is never empty;
 * - output is deterministic for identical input (stable sort, no `Date.now()`).
 */

import { gt, minVersion } from 'semver'
import type { AdmissionResult } from './admission.js'
import type { EntryCollision } from './ledger.js'
import { catalogFor, format, type Locale } from './messages.js'
import type {
  Conclusion,
  Confidence,
  EnvFingerprint,
  Evidence,
  Reason,
  Remediation,
  Verdict,
  VerdictSubject,
} from './types.js'

export interface AdmissionVerdictInput {
  readonly subject: VerdictSubject
  readonly env: EnvFingerprint
  readonly admission: AdmissionResult
  readonly generatedAt: string
}

export interface CollisionVerdictInput {
  readonly env: EnvFingerprint
  readonly collisions: readonly EntryCollision[]
  readonly generatedAt: string
}

const REASON_ORDER: readonly Reason[] = []

/** Build a verdict from an admission decision. */
export function verdictFromAdmission(input: AdmissionVerdictInput): Verdict {
  const { admission, env, subject, generatedAt } = input
  const runtime = env.dsh ?? 'unknown'
  const baseEvidence: Evidence = {
    id: 'admission',
    tier: 'declared',
    source: `${subject.name}@${subject.version ?? 'unknown'}`,
    method: 'declared-range',
    at: generatedAt,
    detail: admission.mode === 'none' ? 'no declaration' : admission.mode,
  }
  const runtimeEvidence: Evidence = {
    id: 'runtime',
    tier: 'measured-local',
    source: env.profileDir,
    method: 'profile-scan',
    at: generatedAt,
    detail: env.dsh === null ? 'runtime version not found' : `dsh ${env.dsh}`,
  }
  const evidence = [baseEvidence, runtimeEvidence]

  if (admission.status === 'indeterminate') {
    return finish({
      subject,
      env,
      conclusion: 'unknown',
      confidence: { level: 'low', basis: 'declared' },
      reasons: [
        { code: 'admission-indeterminate', severity: 'info', messageId: 'admission.indeterminate', params: { runtime } },
      ],
      evidence,
      remediation: [{ kind: 'report', messageId: 'remediation.report', note: 'cannot resolve the DSH runtime version for this profile' }],
      missingEvidence: ['missing.runtime'],
      generatedAt,
    })
  }

  if (admission.status === 'unconstrained') {
    return finish({
      subject,
      env,
      conclusion: 'unknown',
      confidence: { level: 'low', basis: 'declared' },
      reasons: [
        { code: 'admission-unconstrained', severity: 'warn', messageId: 'admission.unconstrained', params: { runtime } },
      ],
      evidence,
      remediation: [{ kind: 'probe', messageId: 'remediation.probe', note: 'declaration is absent; only an isolated probe can resolve behaviour' }],
      missingEvidence: ['missing.admission', 'missing.probe'],
      generatedAt,
    })
  }

  if (admission.status === 'admitted') {
    return finish({
      subject,
      env,
      conclusion: 'go',
      confidence: { level: 'medium', basis: 'declared' },
      reasons: [
        { code: 'admission-admitted', severity: 'info', messageId: 'admission.admitted', params: { runtime } },
        {
          code: 'admission-declared-only',
          severity: 'info',
          messageId: 'admission.declared-only',
          params: { runtime },
        },
      ],
      evidence,
      remediation: [],
      missingEvidence: [],
      generatedAt,
    })
  }

  // denied
  const reasons: Reason[] = admission.unmet.map((requirement) => unmetReason(requirement, runtime))
  const remediation = remediationForDenial(admission.unmet, runtime, env.profile, subject)

  return finish({
    subject,
    env,
    conclusion: 'blocked',
    confidence: { level: 'high', basis: 'declared' },
    reasons,
    evidence,
    remediation,
    missingEvidence: [],
    generatedAt,
  })
}

/** Build one verdict per collision; each is blocked because boot fails on duplicate ids. */
export function verdictsFromCollisions(input: CollisionVerdictInput): readonly Verdict[] {
  return input.collisions.map((collision) =>
    finish({
      subject: { name: collision.id, version: null, kind: 'entry' },
      env: input.env,
      conclusion: 'blocked',
      confidence: { level: 'high', basis: 'declared' },
      reasons: [
        {
          code: collision.kind === 'conflicting-definitions' ? 'entry-id-collision' : 'entry-id-duplicate',
          severity: 'block',
          messageId: collision.kind === 'conflicting-definitions' ? 'collision.entry-id' : 'collision.duplicate-in-source',
          params: {
            id: collision.id,
            owner: collision.owners.join(', '),
            count: collision.count,
            source: collision.owners[0] ?? '',
          },
        },
      ],
      evidence: collision.owners.map((owner, index) => ({
        id: `entry-${index}`,
        tier: 'declared' as const,
        source: owner,
        method: 'patch-parse',
        at: input.generatedAt,
        detail: `entry id ${collision.id}`,
      })),
      remediation: [
        {
          kind: 'disable-entry',
          messageId: 'remediation.disable-entry',
          params: { id: collision.id, owners: collision.owners.join(', ') },
          note: `set \`disabled: true\` on entry "${collision.id}" in the later patch layer, or remove one of: ${collision.owners.join(', ')} (definitions: ${collision.names.join(' vs ')})`,
        },
        {
          kind: 'report',
          messageId: 'remediation.report',
          note: 'upstream boots fail outright on duplicate loader entry ids',
        },
      ],
      missingEvidence: [],
      generatedAt: input.generatedAt,
    }),
  )
}

/** Merge verdicts into one: worst conclusion wins, evidence/reasons/remediation are unioned. */
export function mergeVerdicts(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.length === 0) {
    throw new Error('mergeVerdicts requires at least one verdict')
  }
  const [first, ...rest] = verdicts as [Verdict, ...Verdict[]]
  let worst: Verdict = first
  for (const candidate of rest) {
    if (conclusionRank(candidate.conclusion) > conclusionRank(worst.conclusion)) worst = candidate
  }
  return finish({
    subject: worst.subject,
    env: worst.env,
    conclusion: worst.conclusion,
    confidence: worst.confidence,
    reasons: dedupeReasons(verdicts.flatMap((verdict) => verdict.reasons)),
    evidence: dedupeEvidence(verdicts.flatMap((verdict) => verdict.evidence)),
    remediation: dedupeRemediation(verdicts.flatMap((verdict) => verdict.remediation)),
    missingEvidence: [...new Set(verdicts.flatMap((verdict) => verdict.missingEvidence))],
    generatedAt: worst.generatedAt,
  })
}

export function conclusionRank(conclusion: Conclusion): number {
  switch (conclusion) {
    case 'unknown':
      return 0
    case 'go':
      return 1
    case 'risky':
      return 2
    case 'blocked':
      return 3
  }
}

/** Human-readable rendering. Pure: takes a locale, returns text. */
export function renderVerdict(verdict: Verdict, locale: Locale): string {
  const catalog = catalogFor(locale)
  const lines: string[] = []
  const label = verdict.conclusion.toUpperCase()
  const subject = `${verdict.subject.name}${verdict.subject.version === null ? '' : `@${verdict.subject.version}`}`
  lines.push(`[${label}] ${subject} — ${message(catalog, `conclusion.${verdict.conclusion}`)}`)
  lines.push(`  env      dsh ${verdict.env.dsh ?? 'unknown'} · ${verdict.env.platform}/${verdict.env.arch} · profile ${verdict.env.profile}`)
  for (const reason of verdict.reasons.slice(0, MAX_RENDERED_REASONS)) {
    lines.push(`  reason   ${message(catalog, reason.messageId, reason.params)}`)
  }
  if (verdict.reasons.length > MAX_RENDERED_REASONS) {
    lines.push(
      `  ...      ${message(catalog, 'ui.more-reasons', { count: verdict.reasons.length - MAX_RENDERED_REASONS })}`,
    )
  }
  for (const remediation of verdict.remediation) {
    const command = remediation.command === undefined ? '' : ` -> ${remediation.command}`
    // Localized copy when available; the English `note` stays as machine-stable fallback.
    const text =
      remediation.messageId === undefined
        ? remediation.note
        : message(catalog, remediation.messageId, remediation.params)
    lines.push(`  fix      [${remediation.kind}] ${text}${command}`)
  }
  for (const missing of verdict.missingEvidence) {
    lines.push(`  missing  ${message(catalog, missing)}`)
  }
  lines.push(`  evidence ${verdict.evidence.map((item) => `${item.tier}:${item.id}`).join(', ')}`)
  return lines.join('\n')
}

/**
 * Terminal output must stay readable: a plugin with 10 stale peer ranges must not
 * print 32 lines. Full detail is always available via `--json`.
 */
const MAX_RENDERED_REASONS = 3

function message(
  catalog: ReturnType<typeof catalogFor>,
  id: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = catalog.messages[id]
  return template === undefined ? `?${id}` : format(template, params)
}

function unmetReason(requirement: { key: string; range: string; failure: string | null }, runtime: string): Reason {
  if (requirement.failure !== null) {
    return {
      code: `admission-${requirement.failure}`,
      severity: 'block',
      messageId: `admission.failure.${requirement.failure}`,
      params: { range: requirement.range, runtime },
    }
  }
  const isEngines = requirement.key === 'dsh'
  return {
    code: isEngines ? 'admission-denied-engines' : 'admission-denied-peer',
    severity: 'block',
    messageId: isEngines ? 'admission.unmet.engines' : 'admission.unmet.peer',
    params: { key: requirement.key, range: requirement.range, runtime },
  }
}

/**
 * Turn a denial into at most a handful of actionable lines.
 *
 * WHY NOT per-requirement: a plugin with 10 stale peer ranges produced 32 output
 * lines, which is unusable. Users need one direction ("upgrade DSH"), one
 * alternative ("pin an older plugin build"), one escape hatch ("exempt this exact
 * pair"), and the caveat ("behaviour is still unproven"). The per-requirement
 * detail stays in `reasons` and in `--json`.
 */
function remediationForDenial(
  unmet: readonly { key: string; range: string; failure: string | null }[],
  runtime: string,
  profile: string,
  subject: VerdictSubject,
): readonly Remediation[] {
  const out: Remediation[] = []

  const malformed = unmet.filter((requirement) => requirement.failure !== null)

  const parsed = unmet
    .filter((requirement) => requirement.failure === null)
    .map((requirement) => ({ requirement, lower: minVersion(requirement.range, true) }))
  const newer = parsed.filter((entry) => entry.lower !== null && gt(entry.lower, runtime))
  const older = parsed.filter((entry) => entry.lower === null || !gt(entry.lower, runtime))

  if (malformed.length > 0) {
    out.push({
      kind: 'pin-version',
      messageId: 'remediation.pin-version-unusable',
      params: {
        count: malformed.length,
        failures: [...new Set(malformed.map((r) => r.failure))].join(', '),
        runtime,
      },
      note: `${malformed.length} declaration(s) are unusable (${[...new Set(malformed.map((r) => r.failure))].join(', ')}); install a build that declares a range including ${runtime}`,
    })
  } else {
    out.push({
      kind: 'pin-version',
      messageId: 'remediation.pin-version',
      params: { runtime, profile },
      note: `install a plugin build whose declarations include ${runtime} (profile: ${profile})`,
    })
  }

  if (newer.length > 0) {
    const highest = newer
      .map((entry) => entry.lower)
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((a, b) => (gt(a, b) ? -1 : 1))[0]
    out.push({
      kind: 'upgrade-dsh',
      messageId: 'remediation.upgrade-dsh',
      params: { count: newer.length, runtime, highest: highest?.version ?? 'unknown' },
      note: `${newer.length} requirement(s) need a newer DSH (highest lower bound: ${highest?.version ?? 'unknown'}); this profile runs ${runtime}`,
    })
  }
  if (older.length > 0) {
    out.push({
      kind: 'downgrade-dsh',
      messageId: 'remediation.downgrade-dsh',
      params: { count: older.length, runtime },
      note: `${older.length} requirement(s) exclude ${runtime}; either upgrade the plugin or stay on a runtime it declares`,
    })
  }

  out.push({
    kind: 'allow-version',
    command: allowVersionCommand(subject, runtime, profile),
    messageId: 'remediation.allow-version',
    note: 'explicit exemption for this exact plugin version and runtime version',
  })
  out.push({
    kind: 'probe',
    messageId: 'remediation.probe',
    note: 'an exemption bypasses the declaration only; behaviour is still unproven',
  })
  return out
}

function allowVersionCommand(subject: VerdictSubject, runtime: string, profile: string): string {
  const target = subject.version === null ? subject.name : `${subject.name}@${subject.version}`
  return `dsh plugin --profile ${profile} allow-version ${target} --dsh-version ${runtime} --accept-risk`
}

function finish(input: {
  subject: VerdictSubject
  env: EnvFingerprint
  conclusion: Conclusion
  confidence: Confidence
  reasons: readonly Reason[]
  evidence: readonly Evidence[]
  remediation: readonly Remediation[]
  missingEvidence: readonly string[]
  generatedAt: string
}): Verdict {
  return {
    schemaVersion: 1,
    subject: input.subject,
    env: input.env,
    conclusion: input.conclusion,
    confidence: input.confidence,
    reasons: dedupeReasons(input.reasons),
    evidence: dedupeEvidence(input.evidence),
    remediation: dedupeRemediation(input.remediation),
    missingEvidence: [...input.missingEvidence].sort((a, b) => a.localeCompare(b)),
    generatedAt: input.generatedAt,
  }
}

function dedupeReasons(reasons: readonly Reason[]): readonly Reason[] {
  const seen = new Set<string>()
  const out: Reason[] = []
  for (const reason of reasons) {
    const key =
      reason.code +
      JSON.stringify(reason.params === undefined ? {} : Object.entries(reason.params).sort(([a], [b]) => a.localeCompare(b)))
    if (seen.has(key)) continue
    seen.add(key)
    out.push(reason)
  }
  return out
}

function dedupeEvidence(evidence: readonly Evidence[]): readonly Evidence[] {
  const seen = new Set<string>()
  const out: Evidence[] = []
  for (const item of evidence) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function dedupeRemediation(remediation: readonly Remediation[]): readonly Remediation[] {
  const seen = new Set<string>()
  const out: Remediation[] = []
  for (const item of remediation) {
    const key = `${item.kind}|${item.command ?? ''}|${item.note}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.note.localeCompare(b.note))
}

/** Kept for callers that need the canonical reason ordering in tests. */
export function reasonOrder(): readonly Reason[] {
  return REASON_ORDER
}
