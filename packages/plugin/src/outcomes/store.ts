/**
 * Append-only local outcome store (spec §8 / §9).
 *
 * WHAT THIS FILE IS ALLOWED TO DO: turn a verdict this process already computed into ONE
 * line of `outcomes.jsonl`, through `sanitizeOutcome`, and append it. Nothing else.
 *
 * WHAT IT MUST NEVER DO:
 * - change a `conclusion`, a `confidence` or an exit code. Recording is a side channel; a
 *   failed write prints one line on stderr and the command returns what it would have
 *   returned anyway (control N14).
 * - write anything when the mode is `off` - not even `mkdir` (controls N1 / N4 / N6).
 * - hold paths, usernames, env values, log tails or free text: the record is built from the
 *   whitelist in `@dsh-triage/core` and validated by `sanitizeOutcome` before it is written,
 *   so a mistake here is a rejected record, not a leak.
 * - lock the file. `O_APPEND` + one `write` per line + a 1024-byte cap is the whole
 *   concurrency story, and a lock file would survive a purge (controls N11 / N6).
 *
 * No network client is imported here, and none may ever be (spec §12).
 */

import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import process from 'node:process'
import {
  sanitizeOutcome,
  assertOutcomeLine,
  type Conclusion,
  type EnvFingerprint,
  type OutcomeArch,
  type OutcomeKey,
  type OutcomeOs,
  type OutcomeProfileKind,
  type OutcomeProbe,
  type OutcomeRecord,
  type OutcomeSource,
  type TimingBucket,
  type Verdict,
} from '@dsh-triage/core'
import {
  errorCodeOf,
  effectiveOutcomeMode,
  outcomesPathOf,
  type OutcomeMode,
} from './config.js'

/** One command may add at most this many records; `probe` is structurally one (§9). */
export const MAX_RECORDS_PER_RUN = 200

/** One subject to record. `version` is the exact version; `null` means "cannot key it". */
export interface OutcomeSubject {
  readonly verdict: Verdict
  readonly version: string | null
}

export interface ProbeFacts {
  /** Sum of the probe's step durations, in ms. Bucketed before it is written (§3.2). */
  readonly totalMs: number | null
  /** Spawn → first sample, in ms. Bucketed; `null` for a surface without HTTP + render. */
  readonly bootMs: number | null
  /** The profile name the run measured, so `profile_kind` is about the measured surface. */
  readonly profile: string
}

export interface RecordOutcomesInput {
  readonly source: OutcomeSource
  readonly subjects: readonly OutcomeSubject[]
  /** ISO timestamp from the caller (`--stamp`), never a clock read here (§5.4). */
  readonly at: string
  /** Only for `source: 'probe'`. */
  readonly probe: ProbeFacts | null
  /** `--outcomes off|local`: per-invocation override, never persisted. */
  readonly flag: OutcomeMode | null
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly platform?: string
  readonly stderr: (line: string) => void
  /** Test seam for the random id; production always uses 16 CSPRNG bytes. */
  readonly idFactory?: () => string
}

export interface OutcomeRecordingReport {
  readonly mode: OutcomeMode
  readonly root: string | null
  readonly written: number
  readonly rejected: number
  readonly skipped: number
}

const recordId = (): string => randomBytes(16).toString('hex')

/**
 * Platform → outcome vocabulary. `other` is a real value, not a failure: the key must be
 * exact, and inventing `linux` for an unknown platform would merge two different worlds.
 */
export function outcomeOsOf(platform: string): OutcomeOs {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux' || platform === 'freebsd'
    ? platform
    : 'other'
}

export function outcomeArchOf(arch: string): OutcomeArch {
  return arch === 'x64' || arch === 'arm64' || arch === 'ia32' ? arch : 'other'
}

export function nodeMajorOf(version: string): number {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10)
  return Number.isInteger(major) ? major : 0
}

/**
 * Which surface a profile has (spec §2's seventh position).
 *
 * The profile NAME is the only evidence available here, so an unrecognised name becomes
 * `unknown` - and an `unknown` profile kind never matches a prior (§2).
 */
export function profileKindOf(profile: string): OutcomeProfileKind {
  const name = profile.trim().toLowerCase()
  if (name.includes('headless')) return 'headless'
  if (name.includes('tui')) return 'tui'
  if (name.includes('web')) return 'web'
  return 'unknown'
}

/** Coarse timing bucket. The boundaries are fixed at 5s / 20s / 60s (`ADR-0006`). */
export function timingBucketOf(ms: number | null): TimingBucket | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null
  if (ms < 5_000) return 'lt5s'
  if (ms < 20_000) return '5to20s'
  if (ms < 60_000) return '20to60s'
  return 'gte60s'
}

/** The seven-tuple for a verdict computed on this machine. */
export function outcomeKeyFor(verdict: Verdict, version: string | null): OutcomeKey {
  return outcomeKeyOfEnv(verdict.env, verdict.subject.name, version)
}

/** The same tuple for a candidate named without a verdict (the prior path). */
export function outcomeKeyOfEnv(env: EnvFingerprint, packageName: string, version: string | null): OutcomeKey {
  return {
    package: packageName,
    version: version ?? '',
    dsh: env.dsh,
    os: outcomeOsOf(env.platform),
    arch: outcomeArchOf(env.arch),
    node_major: nodeMajorOf(env.node),
    profile_kind: profileKindOf(env.profile),
  }
}

const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort()

/** The whitelisted projection of one verdict, still unvalidated. `sanitizeOutcome` decides. */
function outcomeCandidate(input: {
  readonly verdict: Verdict
  readonly version: string
  readonly source: OutcomeSource
  readonly at: string
  readonly id: string
  readonly probe: ProbeFacts | null
}): Record<string, unknown> {
  const key = outcomeKeyFor(input.verdict, input.version)
  let probe: OutcomeProbe | null = null
  if (input.source === 'probe' && input.probe !== null) {
    const total = timingBucketOf(input.probe.totalMs)
    if (total !== null) {
      const kind = profileKindOf(input.probe.profile)
      probe = {
        total_ms_bucket: total,
        // A surface with no HTTP + no render has no boot→sample number (`BS-23`).
        boot_ms_bucket: kind === 'web' ? timingBucketOf(input.probe.bootMs) : null,
      }
    }
  }
  return {
    schema_version: 1,
    id: input.id,
    at: input.at,
    source: input.source,
    package: key.package,
    version: key.version,
    dsh_version: key.dsh,
    os: key.os,
    arch: key.arch,
    node_major: key.node_major,
    profile_kind: key.profile_kind,
    conclusion: input.verdict.conclusion,
    reason_message_ids: uniqueSorted(input.verdict.reasons.map((reason) => reason.messageId)),
    evidence_tiers: uniqueSorted(input.verdict.evidence.map((evidence) => evidence.tier)),
    probe,
  }
}

/**
 * Record the verdicts of one command. NEVER throws and never changes what the command
 * returns: every failure ends in one stderr line.
 */
export function recordOutcomes(input: RecordOutcomesInput): OutcomeRecordingReport {
  const report: { mode: OutcomeMode; root: string | null; written: number; rejected: number; skipped: number } = {
    mode: 'off',
    root: null,
    written: 0,
    rejected: 0,
    skipped: 0,
  }
  try {
    const reading = effectiveOutcomeMode({ flag: input.flag, env: input.env ?? process.env, platform: input.platform ?? process.platform })
    report.mode = reading.mode
    report.root = reading.root
    for (const problem of reading.problems) input.stderr(`outcomes: off (${problem})\n`)
    if (reading.mode === 'off' || reading.root === null) return report

    // "Rather record nothing than half a batch" (§9): the cap is checked before any write.
    if (input.subjects.length > MAX_RECORDS_PER_RUN) {
      input.stderr(`outcomes: skipped (subjects=${input.subjects.length} > cap ${MAX_RECORDS_PER_RUN})\n`)
      return report
    }

    const makeId = input.idFactory ?? recordId
    const lines: string[] = []
    for (const subject of input.subjects) {
      // A verdict without an exact version cannot be keyed; it is not repaired into one.
      if (subject.version === null) {
        report.skipped += 1
        input.stderr('outcomes: skipped (no exact version, so the key is incomplete)\n')
        continue
      }
      const candidate = outcomeCandidate({
        verdict: subject.verdict,
        version: subject.version,
        source: input.source,
        at: input.at,
        id: makeId(),
        probe: input.probe,
      })
      const sanitized = sanitizeOutcome(candidate)
      if (!sanitized.ok) {
        report.rejected += 1
        input.stderr(`outcomes: 1 record rejected (${sanitized.reason}: ${sanitized.field ?? 'record'})\n`)
        continue
      }
      lines.push(JSON.stringify(sanitized.record))
    }
    if (lines.length === 0) return report

    // The directory is created only when there is a record to write (N1: off means nothing,
    // and "on but nothing to say" must not leave an empty store behind either).
    mkdirSync(reading.root, { recursive: true })
    const path = outcomesPathOf(reading.root)
    for (const line of lines) {
      // One `write` per line with `O_APPEND`: two processes appending concurrently each get a
      // complete line, and there is no lock file to survive a purge (N11 / §8).
      appendFileSync(path, `${line}\n`, { flag: 'a', encoding: 'utf8' })
      report.written += 1
    }
    return report
  } catch (error) {
    // Read-only directory, full disk, a store path that is a file: one line, exit code untouched.
    input.stderr(`outcomes: could not record (${errorCodeOf(error)})\n`)
    return report
  }
}

export interface ReadOutcomesResult {
  readonly records: readonly OutcomeRecord[]
  /** Lines that failed validation. Counted, never repaired and never surfaced as records. */
  readonly rejected: number
  /** Complete lines seen (valid + rejected), so "0 records" is distinguishable from "no file". */
  readonly lines: number
  /** Whether `outcomes.jsonl` could be read at all. */
  readonly read: boolean
}

/**
 * Read the store back for counting (status, purge, prior).
 *
 * A line that fails `assertOutcomeLine` is skipped and counted: one corrupted line must not
 * destroy a library, and it must never look like a record either (spec §6 runtime row).
 */
export function readOutcomeRecords(root: string): ReadOutcomesResult {
  let text: string
  try {
    text = readFileSync(outcomesPathOf(root), 'utf8')
  } catch {
    return { records: [], rejected: 0, lines: 0, read: false }
  }
  const records: OutcomeRecord[] = []
  let rejected = 0
  let lines = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    lines += 1
    const parsed = assertOutcomeLine(line)
    if (!parsed.ok) {
      rejected += 1
      continue
    }
    records.push(parsed.record)
  }
  return { records, rejected, lines, read: true }
}

/** Counts by conclusion, for `outcomes --status` and for the recorded (artifact) summaries. */
export function countConclusions(records: readonly OutcomeRecord[]): Record<Conclusion, number> {
  const counts: Record<Conclusion, number> = { go: 0, risky: 0, blocked: 0, unknown: 0 }
  for (const record of records) counts[record.conclusion] += 1
  return counts
}
