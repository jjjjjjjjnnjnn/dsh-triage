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
import { evaluateAdmission } from './admission.js'
import { judgeCompatChannel } from './compat-channel.js'
import type { EntryCollision } from './ledger.js'
import { catalogFor, format, type Locale } from './messages.js'
import type { VersionDrift } from './version-drift.js'
import { judgeRangeShape } from './version-drift.js'
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
  /**
   * The resolved manifest, when the caller has it. Only used to read
   * `dsh.compatibility` as secondary evidence (T-108); the admission decision
   * itself is already made by `admission`, so omitting this never changes it.
   */
  readonly manifest?: unknown
  /**
   * Registry facts for the version under discussion (T-109). Only `check` supplies
   * them: `why`/`audit` describe an installed set, where the dist-tag is irrelevant.
   */
  readonly registryDrift?: VersionDrift
  /**
   * Author-side advice about the shape of each declared range (T-115). Off by
   * default: it is shopping advice for `check`, not a diagnosis of a broken profile.
   */
  readonly rangeAdvice?: boolean
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
  // Secondary channel (T-108). Never feeds the conclusion: `reportSecondaryOnly`
  // is true exactly when there is no peer range to judge, so the user learns which
  // channel the author actually used instead of getting silence.
  const compat = compatSurfacing(input.manifest, env.dsh, generatedAt, {
    reportSecondaryOnly: admission.status === 'unconstrained',
  })
  // Registry facts (T-109) and range-shape advice (T-115). Both are additive: they
  // append `info`/`warn` reasons plus tiered evidence and never touch `conclusion`.
  const registry =
    input.registryDrift === undefined
      ? { reasons: [] as readonly Reason[], evidence: [] as readonly Evidence[] }
      : registrySurfacing(input.registryDrift, subject.name, generatedAt)
  const advice = input.rangeAdvice === true ? rangeShapeReasons(admission) : []

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
        ...compat.reasons,
        ...registry.reasons,
      ],
      evidence: [...evidence, ...compat.evidence, ...registry.evidence],
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
        ...compat.reasons,
        ...advice,
        ...registry.reasons,
      ],
      evidence: [...evidence, ...compat.evidence, ...registry.evidence],
      remediation: [],
      missingEvidence: [],
      generatedAt,
    })
  }

  // denied
  const reasons: Reason[] = [
    ...admission.unmet.map((requirement) => unmetReason(requirement, runtime)),
    ...advice,
    ...registry.reasons,
  ]
  const remediation = remediationForDenial(admission.unmet, runtime, env.profile, subject)

  return finish({
    subject,
    env,
    conclusion: 'blocked',
    confidence: { level: 'high', basis: 'declared' },
    reasons,
    evidence: [...evidence, ...registry.evidence],
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

/** One patch row that names an importable module, with its resolved package.json. */
export interface RowDeclaration {
  readonly rowId: string
  /** Bare module specifier the row imports, e.g. `@deepseek-ai/dsh-hooks-claude-code`. */
  readonly module: string
  /** Patch layer that declares the row, e.g. `patch:profile` or `bundle:@deepseek-ai/dsh-base`. */
  readonly source: string
  /** Resolved `package.json` of the module; `null` when the package is not installed here. */
  readonly manifest: unknown | null
  readonly version: string | null
  /**
   * Installed packages whose *dependency* fields pulled this module's copy into
   * the profile (the `npm explain` / Maven "paths to dependency" idea).
   *
   * WHY: for the shadowing cases (CASE-10364 / CASE-10759) the expensive part was
   * not knowing the row was denied — the stderr line said that — but finding out
   * which plugin's `dependencies` placed the stale copy. The source-level reply in
   * #10364 said exactly this line would have saved the reporter.
   */
  readonly declaredBy?: readonly InstallOrigin[]
}

/** Where an installed copy came from: which package declared it, and in which field. */
export interface InstallOrigin {
  readonly name: string
  readonly version: string | null
  readonly field: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'
}

export interface RowAdmissionInput {
  readonly env: EnvFingerprint
  readonly rows: readonly RowDeclaration[]
  readonly generatedAt: string
}

/**
 * Row-level admission attribution.
 *
 * WHY THIS EXISTS (CASE-11080): upstream admits or rejects **each loader row's
 * module**, not each bundle. A row mounted in `cordis.patch.yml` that pins a peer
 * version the running build no longer satisfies is disabled at startup, and the
 * only trace is one stderr line ("disabling profile plugin row … incompatible
 * with dsh …"). Evaluating bundles alone answered "no denials" for a profile
 * whose hooks had silently stopped firing — a false negative, and exactly the
 * failure this product exists to catch.
 *
 * Rows are grouped by module so a bundle that pins one package in 20 rows yields
 * one verdict that names every affected row, instead of 20 near-identical cards.
 */
export function verdictsFromRowAdmission(input: RowAdmissionInput): readonly Verdict[] {
  const runtime = input.env.dsh
  // Without a runtime version every row would be `unknown`; the bundle verdicts
  // already say that once, so row-level noise would add nothing.
  if (runtime === null || runtime.trim() === '') return []

  const out: Verdict[] = []
  for (const [module, rows] of groupRowsByModule(input.rows)) {
    const first = rows[0]
    if (first === undefined) continue
    const rowIds = rows.map((row) => row.rowId).join(', ')
    const sources = [...new Set(rows.map((row) => row.source))].sort((a, b) => a.localeCompare(b))
    const subject: VerdictSubject = { name: module, version: first.version, kind: 'entry' }
    const scopeReason: Reason = {
      code: 'admission-row-scope',
      severity: 'info',
      messageId: 'admission.row-scope',
      params: { rows: rowIds, module, source: sources.join(', ') },
    }
    const rowEvidence: Evidence = {
      id: 'row',
      tier: 'declared',
      source: sources[0] ?? 'patch',
      method: 'patch-parse',
      at: input.generatedAt,
      detail: `row(s) ${rowIds}`,
    }
    const runtimeEvidence: Evidence = {
      id: 'runtime',
      tier: 'measured-local',
      source: input.env.profileDir,
      method: 'profile-scan',
      at: input.generatedAt,
      detail: `dsh ${runtime}`,
    }

    if (first.manifest === null) {
      out.push(
        finish({
          subject,
          env: input.env,
          conclusion: 'unknown',
          confidence: { level: 'low', basis: 'declared' },
          reasons: [
            scopeReason,
            {
              code: 'admission-row-missing',
              severity: 'warn',
              messageId: 'admission.row-missing',
              params: { rows: rowIds, module },
            },
          ],
          evidence: [rowEvidence, runtimeEvidence],
          remediation: [
            {
              kind: 'remove-plugin',
              messageId: 'remediation.remove-plugin',
              note: `row(s) ${rowIds} import ${module}, which is not installed under this profile`,
            },
          ],
          missingEvidence: ['missing.row-module'],
          generatedAt: input.generatedAt,
        }),
      )
      continue
    }

    const admission = evaluateAdmission(first.manifest, runtime)
    // R9 / T-107: a row module that declares *nothing* used to fall through the
    // "stay silent" branch below, so a profile whose only broken plugin has no
    // declaration produced zero verdicts (CASE-7590). Silence is what "fine" looks
    // like to a user, so the honest answer is `unknown` plus what is missing.
    if (admission.status === 'unconstrained') {
      const compat = compatSurfacing(first.manifest, runtime, input.generatedAt, { reportSecondaryOnly: true })
      out.push(
        finish({
          subject,
          env: input.env,
          conclusion: 'unknown',
          confidence: { level: 'low', basis: 'declared' },
          reasons: [
            scopeReason,
            {
              code: 'admission-row-unconstrained',
              severity: 'warn',
              messageId: 'admission.row-unconstrained',
              params: { rows: rowIds, module },
            },
            ...compat.reasons,
          ],
          evidence: [rowEvidence, runtimeEvidence, ...compat.evidence],
          remediation: [
            {
              kind: 'report',
              messageId: 'remediation.declare-peer',
              params: { module },
              note: `row(s) ${rowIds} import ${module}, which declares no @deepseek-ai/dsh* range; behaviour on ${runtime} is unproven`,
            },
          ],
          missingEvidence: ['missing.peer-declaration'],
          generatedAt: input.generatedAt,
        }),
      )
      continue
    }

    // Admitted / indeterminate rows stay silent: the bundle-level verdict already
    // covers them, and repeating "fine" for 80 rows is noise.
    if (admission.status !== 'denied') continue

    // Name the copy's origin only when it changes the advice: "install a build
    // that admits this runtime" is wrong when the copy was dragged in by another
    // plugin's dependency and nobody asked for it (CASE-10364 / CASE-10759).
    const declaredBy = (first.declaredBy ?? []).filter((origin) => origin.field !== 'peerDependencies')
    const shadowReasons: Reason[] =
      declaredBy.length === 0
        ? []
        : [
            {
              code: 'admission-row-declared-by',
              severity: 'info',
              messageId: 'admission.row-declared-by',
              params: {
                module,
                by: declaredBy.map((origin) => `${origin.name}@${origin.version ?? 'unknown'}`).join(', '),
                fields: [...new Set(declaredBy.map((origin) => origin.field))].sort().join(', '),
              },
            },
          ]
    const shadowRemediation: Remediation[] =
      declaredBy.length === 0
        ? []
        : [
            {
              kind: 'remove-plugin',
              messageId: 'remediation.declared-by',
              params: {
                module,
                by: declaredBy.map((origin) => origin.name).join(', '),
              },
              note: `"${module}" is in this profile because ${declaredBy
                .map((origin) => origin.name)
                .join(', ')} lists it under ${[...new Set(declaredBy.map((origin) => origin.field))].join('/')}; moving it to peerDependencies (or removing the declaring plugin) removes the shadowing copy`,
            },
          ]

    out.push(
      finish({
        subject,
        env: input.env,
        conclusion: 'blocked',
        confidence: { level: 'high', basis: 'declared' },
        reasons: [scopeReason, ...shadowReasons, ...admission.unmet.map((requirement) => unmetReason(requirement, runtime))],
        evidence: [
          {
            id: 'admission',
            tier: 'declared',
            source: `${module}@${first.version ?? 'unknown'}`,
            method: 'declared-range',
            at: input.generatedAt,
            detail: admission.mode,
          },
          ...(declaredBy.length === 0
            ? []
            : [
                {
                  id: 'install-origin',
                  tier: 'scanned' as const,
                  source: declaredBy[0]?.name ?? 'profile',
                  method: 'node_modules-scan',
                  at: input.generatedAt,
                  detail: `${module} copy declared by ${declaredBy.map((origin) => `${origin.name} (${origin.field})`).join(', ')}`,
                },
              ]),
          rowEvidence,
          runtimeEvidence,
        ],
        remediation: [
          ...remediationForDenial(admission.unmet, runtime, input.env.profile, subject),
          ...shadowRemediation,
          ...rows.map((row) => ({
            kind: 'disable-entry' as const,
            messageId: 'remediation.disable-entry' as const,
            params: { id: row.rowId, owners: row.source },
            note: `disable row "${row.rowId}" in ${row.source} when ${module} is no longer needed`,
          })),
        ],
        missingEvidence: [],
        generatedAt: input.generatedAt,
      }),
    )
  }
  return out
}

function groupRowsByModule(rows: readonly RowDeclaration[]): ReadonlyMap<string, readonly RowDeclaration[]> {
  const grouped = new Map<string, RowDeclaration[]>()
  for (const row of rows) {
    const bucket = grouped.get(row.module)
    if (bucket === undefined) grouped.set(row.module, [row])
    else bucket.push(row)
  }
  for (const bucket of grouped.values()) bucket.sort((a, b) => a.rowId.localeCompare(b.rowId))
  return new Map([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)))
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
  for (const reason of renderOrder(verdict.reasons).slice(0, MAX_RENDERED_REASONS)) {
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

/**
 * Order for the terminal: the loudest reason first, so a `warn` is never hidden by
 * two `info` lines. The row-scope line stays pinned first because it carries the row
 * id the user needs to act on (documented in `docs/05` §2b); everything else sorts by
 * severity with a stable sort, so output stays deterministic.
 *
 * WHY (R10 adversary finding): the registry drift warn is appended after two `info`
 * reasons, so the headline finding of the round was silently cut to "…2 more".
 */
function renderOrder(reasons: readonly Reason[]): readonly Reason[] {
  const rank = (severity: string): number => (severity === 'block' ? 3 : severity === 'warn' ? 2 : 1)
  const ordered = [...reasons].sort((left, right) => rank(right.severity) - rank(left.severity))
  const scopeIndex = ordered.findIndex((reason) => reason.messageId === 'admission.row-scope')
  if (scopeIndex > 0) {
    const [scope] = ordered.splice(scopeIndex, 1)
    if (scope !== undefined) ordered.unshift(scope)
  }
  return ordered
}

function message(
  catalog: ReturnType<typeof catalogFor>,
  id: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = catalog.messages[id]
  return template === undefined ? `?${id}` : format(template, params)
}

/**
 * Secondary evidence from `dsh.compatibility` (R9 / T-108).
 *
 * Tier discipline, enforced by tests: this helper can add `info`/`warn` reasons and
 * `declared` evidence, and nothing else. No caller may fold it into the admission
 * decision — a self-declared channel is not a measurement, so it can never block a
 * plugin and can never turn `unknown` into `go`/`blocked`.
 */
function compatSurfacing(
  manifest: unknown,
  runtime: string | null,
  generatedAt: string,
  options: { readonly reportSecondaryOnly: boolean },
): { readonly reasons: readonly Reason[]; readonly evidence: readonly Evidence[] } {
  const reading = judgeCompatChannel(manifest, runtime)
  if (reading === null) return { reasons: [], evidence: [] }

  const { channel, standing } = reading
  const evidence: Evidence = {
    id: 'compat-channel',
    tier: 'declared',
    source: 'manifest:dsh.compatibility',
    method: 'manifest-compat',
    at: generatedAt,
    detail:
      standing === 'unknown'
        ? `${channel.claim} (no per-version statement for this runtime)`
        : `${channel.claim} → ${standing} against ${runtime ?? 'unknown'}`,
  }

  if (standing === 'mismatch') {
    return {
      reasons: [
        {
          code: 'admission-compat-channel-mismatch',
          severity: 'warn',
          messageId: 'admission.compat-channel-mismatch',
          params: { claim: channel.claim, runtime: runtime ?? 'unknown' },
        },
      ],
      evidence: [evidence],
    }
  }

  if (options.reportSecondaryOnly) {
    return {
      reasons: [
        {
          code: 'admission-compat-channel',
          severity: 'info',
          messageId: 'admission.compat-channel',
          params: { claim: channel.claim, runtime: runtime ?? 'unknown' },
        },
      ],
      evidence: [evidence],
    }
  }

  return { reasons: [], evidence: [evidence] }
}

/**
 * Registry dist-tag facts as reasons + evidence (T-109).
 *
 * Only problems produce a reason; a healthy tag still leaves a tiered evidence entry
 * so `--json` consumers can see what was checked. Nothing here can change
 * `conclusion`: a stale dist-tag is a reason to pin a version, not a judgement that
 * the plugin does or does not work on this machine.
 */
function registrySurfacing(
  drift: VersionDrift,
  subjectName: string,
  generatedAt: string,
): { readonly reasons: readonly Reason[]; readonly evidence: readonly Evidence[] } {
  const published = dateNote(drift.newestPublishedAt)
  const evidence: Evidence = {
    id: 'registry-tags',
    tier: 'measured-registry',
    source: `npm:${subjectName}`,
    method: 'registry-metadata',
    at: generatedAt,
    detail: drift.detail,
  }
  const params = { latest: drift.latest ?? '—', newest: drift.newest ?? '—', published }

  switch (drift.standing) {
    case 'latest-behind':
      return {
        reasons: [{ code: 'registry-latest-behind', severity: 'warn', messageId: 'registry.latest-behind', params }],
        evidence: [evidence],
      }
    case 'prerelease-ahead':
      return {
        reasons: [
          { code: 'registry-prerelease-ahead', severity: 'info', messageId: 'registry.prerelease-ahead', params },
        ],
        evidence: [evidence],
      }
    case 'latest-missing':
      return {
        reasons: [
          { code: 'registry-latest-missing', severity: 'warn', messageId: 'registry.latest-missing', params },
        ],
        evidence: [evidence],
      }
    case 'latest-unpublished':
      return {
        reasons: [
          { code: 'registry-latest-unpublished', severity: 'warn', messageId: 'registry.latest-unpublished', params },
        ],
        evidence: [evidence],
      }
    case 'latest-deprecated':
      return {
        reasons: [
          { code: 'registry-latest-deprecated', severity: 'warn', messageId: 'registry.latest-deprecated', params },
        ],
        evidence: [evidence],
      }
    default:
      return { reasons: [], evidence: [evidence] }
  }
}

/** ` (published 2026-10-20)` — always non-empty, so the copy never keeps a placeholder. */
function dateNote(iso: string | null): string {
  return iso === null ? ' (publish date unknown)' : ` (published ${iso.slice(0, 10)})`
}

/**
 * Author-side advice about how each declared range will age (T-115).
 *
 * An exact pin is denied by the next upstream patch; an unbounded range admits the
 * next breaking major. Both are `info`/`warn` only — the user asked "can I install
 * this", not "is the author's semver style good".
 */
function rangeShapeReasons(admission: AdmissionResult): readonly Reason[] {
  const out: Reason[] = []
  for (const requirement of admission.requirements) {
    const reading = judgeRangeShape(requirement.range)
    if (reading.shape === 'exact') {
      out.push({
        code: 'admission-range-exact-pin',
        severity: 'info',
        messageId: 'admission.range-exact-pin',
        params: { key: requirement.key, range: reading.range },
      })
    } else if (reading.shape === 'unbounded') {
      out.push({
        code: 'admission-range-unbounded',
        severity: 'warn',
        messageId: 'admission.range-unbounded',
        params: { key: requirement.key, range: reading.range },
      })
    }
  }
  return out
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
