/**
 * Local outcome records: the whitelist that proves a record carries no PII.
 *
 * WHY THIS MODULE EXISTS (spec `docs/specs/M5-reflow.md` §3–§5, `T-501`):
 * "we only store the four-state conclusion" is a claim; a whitelist projection that
 * *rejects* the whole line when one unknown key appears is an enforcement. Everything
 * the local store can hold is declared here, and there is exactly one function that
 * decides whether a candidate record is allowed to reach disk (`sanitizeOutcome`) and
 * one that decides whether an existing line may be read back (`assertOutcomeLine`).
 *
 * WHAT THIS MODULE MUST NEVER DO (§12 of the spec, machine-checked by the
 * `outcome-privacy` check of `scripts/gate_governance.mjs`):
 * - no network client of any kind, no `fs`, no clock, no `process.env`;
 * - no randomness: `id` and `at` are injected by the caller, exactly like `generatedAt`
 *   in `verdict.ts`;
 * - no repair: a rejected record is rejected, never "cleaned up and written anyway".
 *
 * TIER DISCIPLINE (`ADR-0011` option A): a `LocalPrior` is an *annotation*. It never
 * enters `conclusion` / `confidence` / `evidence[]`, and there is no evidence tier for
 * it (`measured-local` is reused as a label for "this machine measured this before").
 */

import { valid } from 'semver'
import { CONCLUSION_VALUES, type Conclusion, type EvidenceTier } from './types.js'

/** Why a candidate record was refused. Closed set; `sanitizeOutcome` never invents one. */
export type OutcomeRejection = 'not-an-object' | 'unknown-field' | 'value-shape' | 'too-long' | 'bad-timestamp'

/** Why a stored line could not be read back. Adds the parse step to {@link OutcomeRejection}. */
export type OutcomeLineRejection = OutcomeRejection | 'not-json'

export type OutcomeOs = 'win32' | 'darwin' | 'linux' | 'freebsd' | 'other'
export type OutcomeArch = 'x64' | 'arm64' | 'ia32' | 'other'
export type OutcomeProfileKind = 'web' | 'tui' | 'headless' | 'unknown'
export type OutcomeSource = 'check' | 'probe'
/** Coarse timing bucket. Milliseconds are a high-entropy fingerprint (`BS-32`, spec §3.2). */
export type TimingBucket = 'lt5s' | '5to20s' | '20to60s' | 'gte60s'

export const OUTCOME_OS_VALUES = ['win32', 'darwin', 'linux', 'freebsd', 'other'] as const
export const OUTCOME_ARCH_VALUES = ['x64', 'arm64', 'ia32', 'other'] as const
export const OUTCOME_PROFILE_KIND_VALUES = ['web', 'tui', 'headless', 'unknown'] as const
export const OUTCOME_SOURCE_VALUES = ['check', 'probe'] as const
export const TIMING_BUCKET_VALUES = ['lt5s', '5to20s', '20to60s', 'gte60s'] as const

/** The five evidence tiers, as a value list, so the sanitizer does not have to trust a cast. */
export const EVIDENCE_TIER_VALUES = ['inferred', 'declared', 'scanned', 'measured-registry', 'measured-local'] as const

/** One line of `outcomes.jsonl`. Field order here is the serialization order (determinism). */
export interface OutcomeRecord {
  readonly schema_version: 1
  /** 32 lowercase hex characters. Local bookkeeping only; never enters the repository (§3.1). */
  readonly id: string
  readonly at: string
  readonly source: OutcomeSource
  readonly package: string
  readonly version: string
  readonly dsh_version: string | null
  readonly os: OutcomeOs
  readonly arch: OutcomeArch
  readonly node_major: number
  readonly profile_kind: OutcomeProfileKind
  readonly conclusion: Conclusion
  readonly reason_message_ids: readonly string[]
  readonly evidence_tiers: readonly EvidenceTier[]
  readonly probe: OutcomeProbe | null
}

export interface OutcomeProbe {
  readonly total_ms_bucket: TimingBucket
  /** `null` for a surface without HTTP + render (`BS-23`: `tui` / `headless`). */
  readonly boot_ms_bucket: TimingBucket | null
}

/** The seven-tuple a record is valid for (§2). Any differing position is a different key. */
export interface OutcomeKey {
  readonly package: string
  readonly version: string
  readonly dsh: string | null
  readonly os: OutcomeOs
  readonly arch: OutcomeArch
  readonly node_major: number
  readonly profile_kind: OutcomeProfileKind
}

/**
 * The `prior` annotation block (`check --explain`). Shape is pinned by spec §10.2; it is
 * deliberately NOT part of `Verdict` — it is a sibling object the CLI renders.
 */
export interface LocalPrior {
  readonly schema_version: 1
  readonly annotation_only: true
  readonly key: OutcomeKey
  readonly source: 'local-outcomes'
  readonly method: 'outcome-log'
  readonly n: number
  readonly counts: Readonly<Record<Conclusion, number>>
  readonly majority: Conclusion | null
  readonly agreement: number | null
  readonly tier: 'measured-local'
  readonly evidence_id: 'prior-local'
  readonly note_id: 'prior.annotation-only'
}

export type OutcomeSanitizeResult =
  | { readonly ok: true; readonly record: OutcomeRecord }
  | { readonly ok: false; readonly reason: OutcomeRejection; readonly field: string | null }

export type OutcomeLineResult =
  | { readonly ok: true; readonly record: OutcomeRecord }
  | { readonly ok: false; readonly reason: OutcomeLineRejection; readonly field: string | null }

/** Exactly the keys of {@link OutcomeRecord}. Anything else is an `unknown-field` rejection. */
const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'schema_version',
  'id',
  'at',
  'source',
  'package',
  'version',
  'dsh_version',
  'os',
  'arch',
  'node_major',
  'profile_kind',
  'conclusion',
  'reason_message_ids',
  'evidence_tiers',
  'probe',
])

const PROBE_FIELDS: ReadonlySet<string> = new Set(['total_ms_bucket', 'boot_ms_bucket'])

/** npm's own name grammar (scope-aware), kept literal so a package name containing `/` is legal. */
const PACKAGE_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const ID_RE = /^[0-9a-f]{32}$/
const ISO_UTC_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const MESSAGE_ID_RE = /^(admission|collision|registry|runtime|remediation|missing|probe|tool|prior)\.[a-z0-9.-]+$/

const MAX_PACKAGE = 214
const MAX_VERSION = 64
const MAX_REASON_IDS = 12
const MAX_TIERS = 8
/** One line, 1024 bytes. A defence line, not a formatting preference (§5.5). */
export const MAX_OUTCOME_BYTES = 1024

/**
 * Forbidden shapes, scanned over every final string value (§5.3).
 *
 * WHY the context around `/`: a scoped package name (`@scope/name`) is legal, so a bare
 * separator cannot be the signal. A path needs a drive letter, a leading separator after
 * whitespace/`"`/`=`, a UNC prefix, or a `file://` scheme — those are the shapes that
 * actually carry a username.
 */
const FORBIDDEN_SHAPES: readonly RegExp[] = [
  /[A-Za-z]:[\\/]/,
  /\\\\[A-Za-z0-9._-]+\\/,
  /(^|[\s"=])\/(Users|home|root|tmp)\//,
  /file:\/\//i,
  /~\//,
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /npm_[A-Za-z0-9]{20,}/,
  /bearer\s/i,
  /token=/i,
]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasForbiddenShape(value: string): boolean {
  return FORBIDDEN_SHAPES.some((pattern) => pattern.test(value))
}

/** UTF-8 length without touching a Node-only global (core stays bundle-safe). */
function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Every final string of the assembled record, so the forbidden-shape scan cannot skip one. */
function recordStrings(record: OutcomeRecord): readonly string[] {
  const values: string[] = [
    record.id,
    record.at,
    record.source,
    record.package,
    record.version,
    record.os,
    record.arch,
    record.profile_kind,
    record.conclusion,
    ...record.reason_message_ids,
    ...record.evidence_tiers,
  ]
  if (record.dsh_version !== null) values.push(record.dsh_version)
  if (record.probe !== null) {
    values.push(record.probe.total_ms_bucket)
    if (record.probe.boot_ms_bucket !== null) values.push(record.probe.boot_ms_bucket)
  }
  return values
}

/** A string array that is deduplicated AND ascending: order is part of the contract, not noise. */
function readSortedStrings(
  value: unknown,
  limit: number,
  accept: (item: string) => boolean,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length > limit) return null
  const out: string[] = []
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || !accept(item)) return null
    // Strictly ascending ⇒ sorted AND deduplicated. A caller that hands us an unordered
    // list has already lost the guarantee the gate recomputes, so we refuse instead of sorting.
    if (index > 0) {
      const previous = out[index - 1]
      if (previous === undefined || !(previous < item)) return null
    }
    out.push(item)
  }
  return out
}

function fail(reason: OutcomeRejection, field: string | null): OutcomeSanitizeResult {
  return { ok: false, reason, field }
}

const isEnumValue = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value)

/**
 * Project a candidate record onto the whitelist, or refuse it.
 *
 * Order of operations is the contract (§5): unknown keys → value domains → forbidden
 * shapes over the *assembled* record → byte cap. A rejection never mutates the input and
 * never returns a partially cleaned record.
 */
export function sanitizeOutcome(input: unknown): OutcomeSanitizeResult {
  if (!isPlainObject(input)) return fail('not-an-object', null)

  // 1. Whitelist projection: an unknown key means the caller already holds data it should
  // not have, so the whole record dies (§5.1). Silently dropping it would hide that path.
  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(key)) return fail('unknown-field', key)
  }

  if (input['schema_version'] !== 1) return fail('value-shape', 'schema_version')

  const id = input['id']
  if (typeof id !== 'string' || !ID_RE.test(id)) return fail('value-shape', 'id')

  const at = input['at']
  if (typeof at !== 'string' || !ISO_UTC_MS_RE.test(at) || Number.isNaN(Date.parse(at))) {
    return fail('bad-timestamp', 'at')
  }

  const source = input['source']
  if (!isEnumValue(OUTCOME_SOURCE_VALUES, source)) return fail('value-shape', 'source')

  const packageName = input['package']
  if (typeof packageName !== 'string' || packageName.length > MAX_PACKAGE || !PACKAGE_RE.test(packageName)) {
    return fail('value-shape', 'package')
  }

  // `+build` would smuggle a build fingerprint into a version string, so it is refused
  // rather than stripped (`semver.valid` keeps it, which is why the check is explicit).
  const version = input['version']
  if (
    typeof version !== 'string' ||
    version.length > MAX_VERSION ||
    version.includes('+') ||
    valid(version) === null
  ) {
    return fail('value-shape', 'version')
  }

  const dshVersion = input['dsh_version']
  if (dshVersion !== null) {
    if (typeof dshVersion !== 'string' || dshVersion.length > MAX_VERSION || valid(dshVersion) === null) {
      return fail('value-shape', 'dsh_version')
    }
  }

  const os = input['os']
  if (!isEnumValue(OUTCOME_OS_VALUES, os)) return fail('value-shape', 'os')

  const arch = input['arch']
  if (!isEnumValue(OUTCOME_ARCH_VALUES, arch)) return fail('value-shape', 'arch')

  const nodeMajor = input['node_major']
  if (typeof nodeMajor !== 'number' || !Number.isInteger(nodeMajor) || nodeMajor < 18 || nodeMajor > 99) {
    return fail('value-shape', 'node_major')
  }

  const profileKind = input['profile_kind']
  if (!isEnumValue(OUTCOME_PROFILE_KIND_VALUES, profileKind)) return fail('value-shape', 'profile_kind')

  const conclusion = input['conclusion']
  if (!isEnumValue(CONCLUSION_VALUES, conclusion)) return fail('value-shape', 'conclusion')

  const reasonIds = readSortedStrings(input['reason_message_ids'], MAX_REASON_IDS, (item) =>
    MESSAGE_ID_RE.test(item),
  )
  if (reasonIds === null) return fail('value-shape', 'reason_message_ids')

  const tiers = readSortedStrings(input['evidence_tiers'], MAX_TIERS, (item) =>
    isEnumValue(EVIDENCE_TIER_VALUES, item),
  )
  if (tiers === null) return fail('value-shape', 'evidence_tiers')

  const rawProbe = input['probe']
  let probe: OutcomeProbe | null = null
  if (rawProbe !== null) {
    if (!isPlainObject(rawProbe)) return fail('value-shape', 'probe')
    for (const key of Object.keys(rawProbe)) {
      if (!PROBE_FIELDS.has(key)) return fail('unknown-field', `probe.${key}`)
    }
    // Only a probe run can carry probe facts; a `check` record with buckets would be a
    // claim about a measurement that never happened.
    if (source !== 'probe') return fail('value-shape', 'probe')
    const total = rawProbe['total_ms_bucket']
    if (!isEnumValue(TIMING_BUCKET_VALUES, total)) return fail('value-shape', 'probe.total_ms_bucket')
    const boot = rawProbe['boot_ms_bucket']
    if (boot !== null && !isEnumValue(TIMING_BUCKET_VALUES, boot)) {
      return fail('value-shape', 'probe.boot_ms_bucket')
    }
    probe = { total_ms_bucket: total, boot_ms_bucket: boot }
  }

  const record: OutcomeRecord = {
    schema_version: 1,
    id,
    at,
    source,
    package: packageName,
    version,
    dsh_version: dshVersion,
    os,
    arch,
    node_major: nodeMajor,
    profile_kind: profileKind,
    conclusion,
    reason_message_ids: reasonIds,
    evidence_tiers: tiers as readonly EvidenceTier[],
    probe,
  }

  // 3. Forbidden shapes, over the assembled record (never over the raw input: only what we
  // are about to write matters).
  for (const value of recordStrings(record)) {
    if (hasForbiddenShape(value)) return fail('value-shape', fieldOfShapeHit(record, value))
  }

  // 5. Byte cap. Free text cannot fit in a record that is capped at one short line.
  if (utf8Length(JSON.stringify(record)) > MAX_OUTCOME_BYTES) return fail('too-long', null)

  return { ok: true, record }
}

/** Name the field a forbidden shape was found in, so the rejection is actionable. */
function fieldOfShapeHit(record: OutcomeRecord, value: string): string {
  if (value === record.id) return 'id'
  if (value === record.at) return 'at'
  if (value === record.package) return 'package'
  if (value === record.version) return 'version'
  if (value === record.dsh_version) return 'dsh_version'
  if (value === record.source) return 'source'
  if (value === record.os) return 'os'
  if (value === record.arch) return 'arch'
  if (value === record.profile_kind) return 'profile_kind'
  if (value === record.conclusion) return 'conclusion'
  if (record.reason_message_ids.includes(value)) return 'reason_message_ids'
  if (record.evidence_tiers.includes(value as EvidenceTier)) return 'evidence_tiers'
  return 'probe'
}

/**
 * Read back one stored line.
 *
 * WHY A SECOND FUNCTION: reading is where a hand-edited or corrupted library turns into fake
 * evidence. A line that does not validate is dropped by the caller and counted as
 * `rejected_lines`; it is never repaired, and it never aborts the whole read.
 */
export function assertOutcomeLine(line: string): OutcomeLineResult {
  if (typeof line !== 'string' || line.trim() === '') return { ok: false, reason: 'not-json', field: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return { ok: false, reason: 'not-json', field: null }
  }
  const result = sanitizeOutcome(parsed)
  if (!result.ok) return result
  return { ok: true, record: result.record }
}

/** The seven-tuple of a record (§2). One definition, so the store, the prior and D4 agree. */
export function outcomeKeyOf(record: OutcomeRecord): OutcomeKey {
  return {
    package: record.package,
    version: record.version,
    dsh: record.dsh_version,
    os: record.os,
    arch: record.arch,
    node_major: record.node_major,
    profile_kind: record.profile_kind,
  }
}

/** A key is usable for prior matching only when all seven positions are known (§2, B10). */
export function isCompleteOutcomeKey(key: OutcomeKey): boolean {
  return key.dsh !== null && key.profile_kind !== 'unknown'
}

export function sameOutcomeKey(left: OutcomeKey, right: OutcomeKey): boolean {
  return (
    left.package === right.package &&
    left.version === right.version &&
    left.dsh === right.dsh &&
    left.os === right.os &&
    left.arch === right.arch &&
    left.node_major === right.node_major &&
    left.profile_kind === right.profile_kind
  )
}

/**
 * The local prior for one key: counts, strict majority, agreement.
 *
 * `majority` is a **strict majority** (`counts[majority] * 2 > n`), so a tie - and any
 * plurality that does not exceed half - reads as "no majority" rather than as a winner.
 * Stricter than a plain mode on purpose: this number is shown to a user next to a verdict
 * that it must not influence (`ADR-0011` §4.1), and "2 of 4 said go" is not a majority.
 *
 * Returns `null` when the key is incomplete or `n = 0`, and the caller then omits the whole
 * `prior` key (§10.2: "nothing" must be distinguishable from "empty").
 */
export function computeLocalPrior(
  records: readonly OutcomeRecord[],
  key: OutcomeKey,
): LocalPrior | null {
  if (!isCompleteOutcomeKey(key)) return null
  const counts: Record<Conclusion, number> = { go: 0, risky: 0, blocked: 0, unknown: 0 }
  let n = 0
  for (const record of records) {
    if (!sameOutcomeKey(outcomeKeyOf(record), key)) continue
    counts[record.conclusion] += 1
    n += 1
  }
  if (n < 1) return null

  let majority: Conclusion | null = null
  for (const conclusion of CONCLUSION_VALUES) {
    if (counts[conclusion] * 2 > n) majority = conclusion
  }
  return {
    schema_version: 1,
    annotation_only: true,
    key,
    source: 'local-outcomes',
    method: 'outcome-log',
    n,
    counts,
    majority,
    agreement: majority === null ? null : counts[majority] / n,
    tier: 'measured-local',
    evidence_id: 'prior-local',
    note_id: 'prior.annotation-only',
  }
}
