/**
 * Upgrade impact: "if I move to dsh `<target>`, which loader rows and bundles get denied?"
 *
 * WHAT THIS MODULE IS ALLOWED TO SAY
 * ----------------------------------
 * One thing per unit: **would the target runtime be admitted by the range this unit
 * declares?** It answers that by calling `evaluateAdmission` — the same function `why`,
 * `check`, `audit` and the panel use — with `env.dsh` replaced by the target. There is no
 * second range implementation here on purpose: admission semantics are locked by
 * `data/gold/admission-cases.json`, and a local copy of "engines first, then peers" would
 * be a second rule set that drifts silently.
 *
 * WHAT IT REFUSES TO SAY
 * ----------------------
 * - "this row will *work*": a declaration being admitted is not a measurement;
 * - anything about feature behaviour, configuration names or data migration;
 * - anything about a plugin that is not installed (no manifest = nothing to judge);
 * - anything about another profile. `impact.profile` names the one that was read
 *   (`BS-38`: two profiles, two correct answers).
 *
 * PURITY
 * ------
 * No filesystem access, no network, no clock, no environment reads. Rows and bundles arrive
 * already parsed, the timestamp arrives from the caller. Same input (in any array order) →
 * byte-identical output: the ordering keys below form a total order and never use
 * `localeCompare`, whose result depends on the ICU build of the machine that runs it.
 */

import { gt, valid } from 'semver'
import type { AdmissionMode, AdmissionResult, AdmissionStatus, Requirement } from './admission.js'
import { evaluateAdmission } from './admission.js'
import { catalogFor, format, type Locale } from './messages.js'
import type { EnvFingerprint, Reason, Remediation, Verdict, VerdictSubject } from './types.js'
import type { RowDeclaration } from './verdict.js'
import { verdictFromAdmission, verdictsFromRowAdmission } from './verdict.js'

/** The four buckets, in terminal order. A unit lands in exactly one of them. */
export const UPGRADE_BUCKETS = ['would-be-denied', 'cannot-tell', 'improved', 'likely-fine'] as const
export type UpgradeBucket = (typeof UPGRADE_BUCKETS)[number]

/**
 * Machine-readable reason for the bucket a unit landed in.
 *
 * `cannot-tell` is deliberately narrow: it means **admission was not established**, never
 * "it looks fine" and never "a definite denial that we decided not to report".
 */
export type UpgradeCause =
  | 'target-denied'
  | 'unusable-declaration'
  | 'no-declaration'
  | 'not-installed'
  | 'runtime-unknown'
  | 'denied-now-admitted-then'
  | 'admitted-at-target'

/** `null` = the runtime string was absent; `invalid-runtime` = present but not a version. */
export type UpgradeStandingStatus = AdmissionStatus | 'not-installed' | 'invalid-runtime' | null

export interface UpgradeStanding {
  readonly runtime: string | null
  readonly status: UpgradeStandingStatus
  readonly mode: AdmissionMode | null
  /** Requirements that did not hold under **this** runtime (empty unless denied). */
  readonly unmet: readonly Requirement[]
}

/** A bundle layer as the composition loader read it. */
export interface UpgradeBundleInput {
  readonly name: string
  readonly version: string | null
  /** Raw `package.json`; `null` when the snapshot names a bundle it does not contain. */
  readonly manifest: unknown | null
}

/**
 * Registry lookups are **secondary evidence**: a newer published build whose declaration
 * admits the target. They are attached as annotations and are never read while bucketing.
 */
export interface UpgradeRegistryFact {
  readonly package: string
  readonly version: string
  readonly declaredRange: string
  /** Computed by the caller with the same `evaluateAdmission`; never recomputed here. */
  readonly admitsTarget: boolean
  readonly publishedAt?: string | null
}

export interface UpgradeRegistryFailure {
  readonly package: string
  readonly code: string
  readonly detail: string
}

export interface UpgradeRegistryNote {
  readonly annotation_only: true
  readonly tier: 'measured-registry'
  readonly package: string
  readonly version: string
  readonly declared_range: string
  readonly admits_target: boolean
  readonly published_at: string | null
  readonly note_id: 'upgrade.registry-annotation'
}

export interface UpgradeUnit {
  /** `bundle:<name>` or `row:<rowId>`; unique across the list. */
  readonly id: string
  readonly kind: 'bundle' | 'row'
  /** Bundle name, or the module a row imports. */
  readonly name: string
  readonly version: string | null
  readonly row_ids: readonly string[]
  /** Patch layer that declares the row; `null` for a bundle. */
  readonly source: string | null
  readonly bucket: UpgradeBucket
  readonly cause: UpgradeCause
  /** The current runtime denies this unit too: the upgrade did not cause the denial. */
  readonly already_denied_at_current: boolean
  readonly current: UpgradeStanding
  readonly target: UpgradeStanding
  /** Exactly the remediation the same engine prints for this denial. */
  readonly remediation: readonly Remediation[]
  readonly reasons: readonly Reason[]
  readonly missing_evidence: readonly string[]
  /** Verdict at the target runtime (`env.dsh === target`); `null` when there is nothing to judge. */
  readonly verdict: Verdict | null
  readonly suggestions: readonly UpgradeRegistryNote[]
}

export interface UpgradeCounts {
  readonly bundles: number
  readonly rows: number
  readonly would_be_denied: number
  readonly cannot_tell: number
  readonly improved: number
  readonly likely_fine: number
  readonly total: number
}

export type UpgradeRelation = 'same' | 'newer' | 'older' | 'unknown'

export interface UpgradeImpact {
  readonly schema_version: 1
  /** The profile this answer is about. Never "your setup in general". */
  readonly profile: string
  readonly profile_source: 'live' | 'snapshot'
  readonly current: string | null
  readonly current_valid: boolean
  readonly target: string
  readonly target_valid: true
  readonly target_relation: UpgradeRelation
  readonly buckets: readonly UpgradeBucket[]
  readonly counts: UpgradeCounts
  readonly units: readonly UpgradeUnit[]
  readonly registry: {
    readonly consulted: boolean
    readonly facts: number
    readonly failures: readonly UpgradeRegistryFailure[]
  }
  readonly generated_at: string
}

export type UpgradeJudgement =
  | { readonly ok: true; readonly impact: UpgradeImpact }
  | { readonly ok: false; readonly code: 'invalid-target'; readonly detail: string; readonly target: string }

export interface UpgradeImpactInput {
  /** The environment the profile was read from. `env.dsh` **is** the current runtime. */
  readonly env: EnvFingerprint
  readonly target: string
  readonly bundles: readonly UpgradeBundleInput[]
  readonly rows: readonly RowDeclaration[]
  readonly generatedAt: string
  readonly profileSource?: 'live' | 'snapshot'
  readonly registry?: readonly UpgradeRegistryFact[]
  readonly registryFailures?: readonly UpgradeRegistryFailure[]
}

/**
 * Validate a target before anything is read.
 *
 * Exposed because the CLI must reject `--to ^0.3.0` **before** it touches a profile: a
 * usage error that depends on whether the profile exists would report the wrong thing.
 */
export function upgradeTargetProblem(target: string): string | null {
  const trimmed = target.trim()
  if (trimmed === '') return 'target must be an exact semver version; got an empty string'
  if (valid(trimmed) === null) {
    return `target must be an exact semver version (got "${target}"); only the keywords next and latest are resolved from npm, everything else must be exact`
  }
  return null
}

/**
 * Judge the impact of moving to `input.target`.
 *
 * The target is validated first: `semver.satisfies('0.3', '*')` returns `false` without
 * throwing, so an unvalidated target would silently turn every unit into "denied". A bad
 * target is a usage error, not a finding.
 */
export function judgeUpgradeImpact(input: UpgradeImpactInput): UpgradeJudgement {
  const problem = upgradeTargetProblem(input.target)
  if (problem !== null) {
    return { ok: false, code: 'invalid-target', detail: problem, target: input.target }
  }
  const target = input.target.trim()

  const env = input.env
  const current = env.dsh === null || env.dsh.trim() === '' ? null : env.dsh.trim()
  const targetEnv: EnvFingerprint = { ...env, dsh: target }
  const registryFacts = [...(input.registry ?? [])]

  const units: UpgradeUnit[] = [
    ...input.bundles.map((bundle) => bundleUnit(bundle, env, targetEnv, current, input.generatedAt)),
    ...input.rows.map((row) => rowUnit(row, env, targetEnv, current, input.generatedAt)),
  ]

  // Attach registry annotations AFTER every bucket decision. This ordering is the whole
  // reason a registry fact cannot move a unit: by the time it is read, `bucket` is frozen.
  const annotated = units.map((unit) => ({ ...unit, suggestions: notesFor(unit, registryFacts) }))
  const ordered = [...annotated].sort(compareUnits)

  return {
    ok: true,
    impact: {
      schema_version: 1,
      profile: env.profile,
      profile_source: input.profileSource ?? 'live',
      current,
      current_valid: current !== null && valid(current) !== null,
      target,
      target_valid: true,
      target_relation: relationOf(current, target),
      buckets: UPGRADE_BUCKETS,
      counts: countOf(ordered),
      units: ordered,
      registry: {
        consulted: registryFacts.length > 0 || (input.registryFailures ?? []).length > 0,
        facts: registryFacts.length,
        failures: [...(input.registryFailures ?? [])].sort(
          (left, right) => compareStrings(left.package, right.package) || compareStrings(left.code, right.code),
        ),
      },
      generated_at: input.generatedAt,
    },
  }
}

/* ------------------------------- classification ------------------------------- */

interface Classification {
  readonly bucket: UpgradeBucket
  readonly cause: UpgradeCause
  readonly verdict: Verdict | null
  readonly missing_evidence: readonly string[]
}

/**
 * Classify one unit by **target status first, then current status**.
 *
 * Kept in one place so `would-be-denied` cannot mean two different things for a row and a
 * bundle, and so `improved` has exactly one definition (spec §4.1).
 */
function classify(input: {
  readonly kind: 'bundle' | 'row'
  readonly name: string
  readonly version: string | null
  readonly manifest: unknown | null
  readonly targetEnv: EnvFingerprint
  readonly current: string | null
  readonly generatedAt: string
  readonly row: RowDeclaration | null
}): Classification {
  if (input.manifest === null) {
    // A row with no installed package has a verdict the engine already knows how to write
    // (it names `missing.row-module`); a bundle from a snapshot does not, and says so itself.
    const verdict =
      input.row === null
        ? null
        : (verdictsFromRowAdmission({
            env: input.targetEnv,
            rows: [input.row],
            generatedAt: input.generatedAt,
          })[0] ?? null)
    return {
      bucket: 'cannot-tell',
      cause: 'not-installed',
      verdict,
      missing_evidence: verdict === null ? ['missing.admission'] : verdict.missingEvidence,
    }
  }

  const admission = evaluateAdmission(input.manifest, input.targetEnv.dsh ?? '')

  if (admission.status === 'indeterminate') {
    // Unreachable with a validated target; kept so a future caller cannot get `likely-fine`.
    return { bucket: 'cannot-tell', cause: 'runtime-unknown', verdict: null, missing_evidence: ['missing.runtime'] }
  }

  if (admission.status === 'unconstrained') {
    const verdict = verdictAt(input, admission)
    return {
      bucket: 'cannot-tell',
      cause: 'no-declaration',
      verdict,
      missing_evidence: verdict.missingEvidence,
    }
  }

  if (admission.status === 'denied') {
    // A range that can never be satisfied (`""`, `workspace:*`, not-semver) denies on *any*
    // runtime. Reporting it as `target-denied` would blame the upgrade for a defect that is
    // already there; reporting it as `cannot-tell` would hide a definite denial. So it stays
    // in `would-be-denied` with a cause that says why (spec §14 #1).
    const unusable = admission.unmet.length > 0 && admission.unmet.every((requirement) => requirement.failure !== null)
    return {
      bucket: 'would-be-denied',
      cause: unusable ? 'unusable-declaration' : 'target-denied',
      verdict: verdictAt(input, admission),
      missing_evidence: [],
    }
  }

  // admitted at target: the only branch where `improved` can exist.
  const currentAdmission = currentAdmissionOf(input.manifest, input.current)
  const improved =
    currentAdmission !== null &&
    currentAdmission.status === 'denied' &&
    currentAdmission.unmet.some((requirement) => requirement.failure === null)
  return {
    bucket: improved ? 'improved' : 'likely-fine',
    cause: improved ? 'denied-now-admitted-then' : 'admitted-at-target',
    verdict: verdictAt(input, admission),
    missing_evidence: [],
  }
}

/**
 * The verdict the same engine would print for this unit at the **target** runtime.
 *
 * Rows go through `verdictsFromRowAdmission` so the row id, the `disable-entry` remediation
 * and the unmet reasons are exactly what `why` prints for a denied row. Admitted rows return
 * no row verdict there (silence is `why`'s "fine"), so they fall back to the plugin-shaped
 * builder. Bundles always use the plugin-shaped builder — a bundle has no row to name.
 */
function verdictAt(
  input: {
    readonly kind: 'bundle' | 'row'
    readonly name: string
    readonly version: string | null
    readonly targetEnv: EnvFingerprint
    readonly generatedAt: string
    readonly row: RowDeclaration | null
  },
  admission: AdmissionResult,
): Verdict {
  if (input.kind === 'row' && input.row !== null) {
    const [rowVerdict] = verdictsFromRowAdmission({
      env: input.targetEnv,
      rows: [input.row],
      generatedAt: input.generatedAt,
    })
    if (rowVerdict !== undefined) return rowVerdict
  }
  return verdictFromAdmission({
    subject: {
      name: input.name,
      version: input.version,
      kind: input.kind === 'row' ? 'entry' : 'plugin',
    },
    env: input.targetEnv,
    admission,
    generatedAt: input.generatedAt,
  })
}

function bundleUnit(
  bundle: UpgradeBundleInput,
  env: EnvFingerprint,
  targetEnv: EnvFingerprint,
  current: string | null,
  generatedAt: string,
): UpgradeUnit {
  const classification = classify({
    kind: 'bundle',
    name: bundle.name,
    version: bundle.version,
    manifest: bundle.manifest,
    targetEnv,
    current,
    generatedAt,
    row: null,
  })
  return unitOf({
    id: `bundle:${bundle.name}`,
    kind: 'bundle',
    name: bundle.name,
    version: bundle.version,
    rowIds: [],
    source: null,
    classification,
    manifest: bundle.manifest,
    targetEnv,
    current,
  })
}

function rowUnit(
  row: RowDeclaration,
  env: EnvFingerprint,
  targetEnv: EnvFingerprint,
  current: string | null,
  generatedAt: string,
): UpgradeUnit {
  const classification = classify({
    kind: 'row',
    name: row.module,
    version: row.version,
    manifest: row.manifest,
    targetEnv,
    current,
    generatedAt,
    row,
  })
  return unitOf({
    id: `row:${row.rowId}`,
    kind: 'row',
    name: row.module,
    version: row.version,
    rowIds: [row.rowId],
    source: row.source,
    classification,
    manifest: row.manifest,
    targetEnv,
    current,
  })
}

function unitOf(input: {
  readonly id: string
  readonly kind: 'bundle' | 'row'
  readonly name: string
  readonly version: string | null
  readonly rowIds: readonly string[]
  readonly source: string | null
  readonly classification: Classification
  readonly manifest: unknown | null
  readonly targetEnv: EnvFingerprint
  readonly current: string | null
}): UpgradeUnit {
  const target = standingOf(input.manifest, input.targetEnv.dsh)
  const currentStanding = standingOf(input.manifest, input.current)
  const verdict = input.classification.verdict
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    version: input.version,
    row_ids: input.rowIds,
    source: input.source,
    bucket: input.classification.bucket,
    cause: input.classification.cause,
    already_denied_at_current: currentStanding.status === 'denied',
    current: currentStanding,
    target,
    remediation: verdict === null ? [] : verdict.remediation,
    reasons: verdict === null ? [] : verdict.reasons,
    missing_evidence: input.classification.missing_evidence,
    verdict,
    suggestions: [],
  }
}

/* --------------------------------- standings --------------------------------- */

/**
 * Evaluate one manifest on one runtime **without inventing an answer**.
 *
 * `runtime === null` and an unparsable runtime are both "not evaluated": `satisfies()` would
 * return `false` for a garbage version and we would report a denial that means nothing.
 */
function standingOf(manifest: unknown | null, runtime: string | null): UpgradeStanding {
  const name = runtime === null || runtime.trim() === '' ? null : runtime.trim()
  if (manifest === null) return { runtime: name, status: 'not-installed', mode: null, unmet: [] }
  if (name === null) return { runtime: null, status: null, mode: null, unmet: [] }
  if (valid(name) === null) return { runtime: name, status: 'invalid-runtime', mode: null, unmet: [] }
  const admission = evaluateAdmission(manifest, name)
  return { runtime: name, status: admission.status, mode: admission.mode, unmet: admission.unmet }
}

function currentAdmissionOf(manifest: unknown, current: string | null): AdmissionResult | null {
  if (current === null || valid(current) === null) return null
  return evaluateAdmission(manifest, current)
}

function relationOf(current: string | null, target: string): UpgradeRelation {
  if (current === null || valid(current) === null) return 'unknown'
  if (current === target) return 'same'
  return gt(target, current) ? 'newer' : 'older'
}

/* ------------------------------- registry notes ------------------------------- */

/**
 * Turn one packument's version→manifest map into ONE annotation.
 *
 * Chosen here (in core, next to the range logic) rather than in the CLI, because picking
 * "the newest version whose declaration admits the target" needs semver ordering — a second
 * implementation of that ordering in the CLI would be exactly the kind of drift this file
 * exists to avoid.
 *
 * `admitsTarget: false` is a legitimate answer: it means "I looked, and no published version
 * declares the target". Dropping it would make the search invisible.
 */
export function registryFactFor(input: {
  readonly packageName: string
  readonly versions: ReadonlyMap<string, unknown>
  readonly target: string
  readonly publishedAt?: Readonly<Record<string, string>> | null
}): UpgradeRegistryFact | null {
  if (upgradeTargetProblem(input.target) !== null) return null
  const target = input.target.trim()
  const candidates = [...input.versions.entries()]
    .filter((entry): entry is [string, unknown] => valid(entry[0]) !== null)
    .sort((left, right) => (gt(left[0], right[0]) ? -1 : gt(right[0], left[0]) ? 1 : 0))
  const newest = candidates[0]
  if (newest === undefined) return null
  const admitting = candidates.find(([, manifest]) => evaluateAdmission(manifest, target).status === 'admitted')
  const chosen = admitting ?? newest
  return {
    package: input.packageName,
    version: chosen[0],
    declaredRange: describeDeclaredRanges(evaluateAdmission(chosen[1], target)),
    admitsTarget: admitting !== undefined,
    publishedAt: input.publishedAt?.[chosen[0]] ?? null,
  }
}

/** How the annotation names the declaration: `engines.dsh 0.1.0-rc.6`, `@x/dsh-llm@0.2.1-rc.4`. */
function describeDeclaredRanges(admission: AdmissionResult): string {
  if (admission.requirements.length === 0) return 'no declaration'
  const shown = admission.requirements
    .slice(0, 3)
    .map((requirement) => (requirement.key === 'dsh' ? `engines.dsh ${requirement.range}` : `${requirement.key}@${requirement.range}`))
  const rest = admission.requirements.length - shown.length
  return rest > 0 ? `${shown.join(' & ')} (+${rest} more)` : shown.join(' & ')
}

/**
 * Attach registry facts as annotations.
 *
 * Only `would-be-denied` / `cannot-tell` units get them: those are the units where "is there
 * a published build that declares the target?" is the next question. A fact with
 * `admitsTarget: false` is still attached — it is evidence that was looked up, and dropping
 * it would hide the search.
 */
function notesFor(unit: UpgradeUnit, facts: readonly UpgradeRegistryFact[]): readonly UpgradeRegistryNote[] {
  if (facts.length === 0) return []
  if (unit.bucket !== 'would-be-denied' && unit.bucket !== 'cannot-tell') return []
  return facts
    .filter((fact) => fact.package === unit.name)
    .map((fact): UpgradeRegistryNote => ({
      annotation_only: true,
      tier: 'measured-registry',
      package: fact.package,
      version: fact.version,
      declared_range: fact.declaredRange,
      admits_target: fact.admitsTarget,
      published_at: fact.publishedAt ?? null,
      note_id: 'upgrade.registry-annotation',
    }))
    .sort((left, right) => compareVersionsDescending(left.version, right.version))
}

/* --------------------------------- ordering ---------------------------------- */

const BUCKET_RANK: Readonly<Record<UpgradeBucket, number>> = {
  'would-be-denied': 0,
  'cannot-tell': 1,
  improved: 2,
  'likely-fine': 3,
}

const KIND_RANK: Readonly<Record<'bundle' | 'row', number>> = { bundle: 0, row: 1 }

/**
 * Total order: bucket → kind → name → version → id.
 *
 * `localeCompare` is not used anywhere in this chain: it depends on the ICU build, so the
 * same input could sort differently on two machines and the artifact would stop reproducing.
 */
export function compareUnits(left: UpgradeUnit, right: UpgradeUnit): number {
  return (
    BUCKET_RANK[left.bucket] - BUCKET_RANK[right.bucket] ||
    KIND_RANK[left.kind] - KIND_RANK[right.kind] ||
    compareStrings(left.name, right.name) ||
    compareStrings(left.version ?? '', right.version ?? '') ||
    compareStrings(left.id, right.id)
  )
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareVersionsDescending(left: string, right: string): number {
  const leftValid = valid(left) !== null
  const rightValid = valid(right) !== null
  if (leftValid && rightValid) return gt(left, right) ? -1 : gt(right, left) ? 1 : 0
  if (leftValid !== rightValid) return leftValid ? -1 : 1
  return compareStrings(right, left)
}

function countOf(units: readonly UpgradeUnit[]): UpgradeCounts {
  const count = (bucket: UpgradeBucket): number => units.filter((unit) => unit.bucket === bucket).length
  const bundles = units.filter((unit) => unit.kind === 'bundle').length
  return {
    bundles,
    rows: units.length - bundles,
    would_be_denied: count('would-be-denied'),
    cannot_tell: count('cannot-tell'),
    improved: count('improved'),
    likely_fine: count('likely-fine'),
    total: units.length,
  }
}

/* --------------------------------- rendering --------------------------------- */

/** Units printed per bucket before the terminal says "… N more, --json". */
const MAX_RENDERED_UNITS = 20
/** Reasons and fixes printed per unit; the full lists live in `--json`. */
const MAX_DETAIL_PER_UNIT = 2

const FIX_PRIORITY: readonly Remediation['kind'][] = [
  'pin-version',
  'disable-entry',
  'downgrade-dsh',
  'upgrade-dsh',
  'allow-version',
  'probe',
  'report',
  'remove-plugin',
]

const BUCKET_LABEL: Readonly<Record<UpgradeBucket, string>> = {
  'would-be-denied': 'upgrade.bucket.would-be-denied',
  'cannot-tell': 'upgrade.bucket.cannot-tell',
  improved: 'upgrade.bucket.improved',
  'likely-fine': 'upgrade.bucket.likely-fine',
}

const COUNT_KEY: Readonly<Record<UpgradeBucket, keyof UpgradeCounts>> = {
  'would-be-denied': 'would_be_denied',
  'cannot-tell': 'cannot_tell',
  improved: 'improved',
  'likely-fine': 'likely_fine',
}

const RELATION_ID: Readonly<Record<UpgradeRelation, string>> = {
  same: 'upgrade.relation.same',
  newer: 'upgrade.relation.newer',
  older: 'upgrade.relation.older',
  unknown: 'upgrade.relation.unknown',
}

/** Terminal rendering. Pure: locale in, text out; no colour, no clock, no width probing. */
export function renderUpgradeImpact(impact: UpgradeImpact, locale: Locale): string {
  const catalog = catalogFor(locale)
  const text = (id: string, params?: Readonly<Record<string, string | number>>): string => {
    const template = catalog.messages[id]
    return template === undefined ? `?${id}` : format(template, params)
  }
  const lines: string[] = []
  lines.push(
    text('upgrade.header', {
      target: impact.target,
      units: impact.counts.total,
      bundles: impact.counts.bundles,
      rows: impact.counts.rows,
    }),
  )
  lines.push(
    text(RELATION_ID[impact.target_relation], {
      target: impact.target,
      current: impact.current ?? 'unknown',
    }),
  )
  lines.push(text('upgrade.profile-scope', { profile: impact.profile, source: impact.profile_source }))
  lines.push(text('upgrade.admitted-only', { target: impact.target }))

  if (impact.counts.total === 0) {
    lines.push('')
    lines.push(text('upgrade.nothing-sampled', { profile: impact.profile }))
    return `${lines.join('\n')}\n`
  }

  for (const bucket of impact.buckets) {
    const units = impact.units.filter((unit) => unit.bucket === bucket)
    const count = impact.counts[COUNT_KEY[bucket]]
    lines.push('')
    lines.push(text(BUCKET_LABEL[bucket], { count, target: impact.target }))
    for (const unit of units.slice(0, MAX_RENDERED_UNITS)) {
      lines.push(`  ${unit.id}${unit.version === null ? '' : `  ${unit.name}@${unit.version}`}`)
      if (unit.cause === 'unusable-declaration') lines.push(`    ${text('upgrade.unusable-declaration', { target: impact.target })}`)
      if (unit.already_denied_at_current) lines.push(`    ${text('upgrade.already-denied', { current: impact.current ?? 'unknown' })}`)
      for (const reason of pickBlockingReasons(unit)) {
        lines.push(`    reason  ${text(reason.messageId, reason.params)}`)
      }
      for (const reason of pickCurrentBlockingReasons(unit)) {
        lines.push(`    now     ${text(reason.messageId, reason.params)}`)
      }
      for (const missing of unit.missing_evidence) {
        lines.push(`    missing ${text(missing)}`)
      }
      const fixes = orderedFixes(unit.remediation)
      for (const fix of fixes.slice(0, MAX_DETAIL_PER_UNIT)) {
        lines.push(`    fix     [${fix.kind}] ${fix.messageId === undefined ? fix.note : text(fix.messageId, fix.params)}`)
      }
      if (fixes.length > MAX_DETAIL_PER_UNIT) {
        lines.push(`    …       ${text('upgrade.more-fixes', { count: fixes.length - MAX_DETAIL_PER_UNIT })}`)
      }
      for (const note of unit.suggestions) {
        lines.push(
          `    ${text('upgrade.registry-annotation', {
            package: note.package,
            version: note.version,
            range: note.declared_range,
            target: impact.target,
            verdict: note.admits_target ? 'admitted' : 'denied',
          })}`,
        )
      }
    }
    if (count > MAX_RENDERED_UNITS) {
      lines.push(`  ${text('upgrade.more-units', { count: count - MAX_RENDERED_UNITS })}`)
    }
  }

  for (const failure of impact.registry.failures) {
    lines.push(`registry ${failure.package}: ${failure.code} (${failure.detail})`)
  }
  return `${lines.join('\n')}\n`
}

function pickBlockingReasons(unit: UpgradeUnit): readonly Reason[] {
  return unit.reasons.filter((reason) => reason.severity === 'block').slice(0, MAX_DETAIL_PER_UNIT)
}

/** For `improved`: the denial that exists **today**, which is what makes the unit interesting. */
function pickCurrentBlockingReasons(unit: UpgradeUnit): readonly Reason[] {
  if (unit.bucket !== 'improved') return []
  return unit.current.unmet
    .slice(0, MAX_DETAIL_PER_UNIT)
    .map((requirement): Reason => ({
      code: 'upgrade-current-unmet',
      severity: 'info',
      messageId: requirement.key === 'dsh' ? 'admission.unmet.engines' : 'admission.unmet.peer',
      params: { key: requirement.key, range: requirement.range, runtime: unit.current.runtime ?? 'unknown' },
    }))
}

function orderedFixes(remediation: readonly Remediation[]): readonly Remediation[] {
  const rank = (kind: Remediation['kind']): number => {
    const index = FIX_PRIORITY.indexOf(kind)
    return index === -1 ? FIX_PRIORITY.length : index
  }
  return [...remediation].sort((left, right) => rank(left.kind) - rank(right.kind) || compareStrings(left.note, right.note))
}

/** Convenience for callers that only need a yes/no: is anything going to be denied? */
export function hasNewDenials(impact: UpgradeImpact): boolean {
  return impact.counts.would_be_denied > 0
}
