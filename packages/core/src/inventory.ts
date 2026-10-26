/**
 * Runtime inventory (M2-a, T-201 P2): turn a `pluginInventory/list` snapshot into
 * verdicts about *phases*, not declarations.
 *
 * WHY: M1 judges the declared layer. It cannot see a row that declared fine and
 * then failed to build a fiber (`fiberPhase: failed`), a row that is enabled but
 * never loaded (`null` + `enabled: true` — the CASE-11080 shape), or a row that
 * was explicitly disabled. Those are the words users actually use: "it didn't
 * start", "nothing happened".
 *
 * HARD RULES (docs/specs/M2-inventory.md §3):
 * - phase evidence is `measured-local` and carries the sampling time + profile;
 * - this layer never upgrades anything to a safety claim;
 * - a missing phase is `unknown`, never `go`;
 * - one entry id can appear under several agent presets with different phases, so
 *   presets are judged separately (we never take the optimistic value).
 *
 * Parsing is defensive on purpose: an upstream field rename must fail loudly here
 * (`inventory-invalid`) instead of silently degrading to "no problems found".
 */

import type { Conclusion, Confidence, EnvFingerprint, Evidence, Reason, Remediation, Verdict } from './types.js'
import { type CoreError, type Result, err, ok } from './result.js'

/** The enum read back from upstream's generated schema (see scripts/bootstrap_upstream.mjs). */
export const FIBER_PHASES = ['pending', 'loading', 'active', 'failed', 'unloading'] as const
export type FiberPhase = (typeof FIBER_PHASES)[number]

const KNOWN_SNAPSHOT_KEYS = new Set([
  'managementAvailable',
  'entries',
  'agentPresets',
  'snapshot',
  'sampled_at',
  'sampledAt',
  'profile',
  // Our own export metadata (P2 files written by hand or by the Host tool).
  'note',
  'kind',
])

export interface InventoryEntry {
  readonly entryId: string
  readonly moduleName: string
  readonly enabled: boolean
  /** `null` means "no fiber", which is a real state upstream reports, not an absence of data. */
  readonly fiberPhase: FiberPhase | null
  /** Fields we do not interpret; kept verbatim instead of guessed. */
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventorySnapshot {
  readonly managementAvailable: boolean | null
  readonly entries: readonly InventoryEntry[]
  /** ISO-8601 sampling time: when the Host answered the query. */
  readonly sampledAt: string
  /** Profile the sample came from, when the file records it. */
  readonly profile: string | null
  /** Where the snapshot came from (a path; the caller redacts it before rendering). */
  readonly source: string
  /** Top-level keys we did not understand — surfaced, never interpreted. */
  readonly unknownKeys: readonly string[]
}

export interface InventoryMeta {
  readonly source: string
  readonly sampledAt: string
  readonly profile?: string | null
}

export interface DeclaredRow {
  readonly entryId: string
  readonly module: string | null
}

export interface InventoryVerdictInput {
  readonly env: EnvFingerprint
  readonly snapshot: InventorySnapshot
  /** What the static layers said exists. Used for the two cross-check conclusions. */
  readonly declared: readonly DeclaredRow[]
  readonly generatedAt: string
}

/* --------------------------------- parsing --------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(detail: string): Result<never, CoreError> {
  return err({ code: 'inventory-invalid', detail })
}

/**
 * Parse a snapshot defensively.
 *
 * Accepts either the raw `PluginInventorySnapshot` or a wrapper
 * `{ snapshot, sampled_at, profile }` as exported by the P1 host tool.
 */
export function parseInventorySnapshot(value: unknown, meta: InventoryMeta): Result<InventorySnapshot, CoreError> {
  if (!isRecord(value)) return invalid('snapshot is not an object')

  const wrapped = isRecord(value['snapshot']) ? value['snapshot'] : value
  const sampledAt = readString(value['sampled_at']) ?? readString(value['sampledAt']) ?? meta.sampledAt
  const profile = readString(value['profile']) ?? meta.profile ?? null

  const rawEntries = wrapped['entries']
  if (!Array.isArray(rawEntries)) return invalid('"entries" is missing or is not an array')

  const managementAvailable = readOptionalBoolean(wrapped['managementAvailable'])
  if (managementAvailable === 'invalid') return invalid('"managementAvailable" is not a boolean')

  const entries: InventoryEntry[] = []
  for (const candidate of rawEntries) {
    if (!isRecord(candidate)) return invalid('an entry is not an object')
    const entryId = readString(candidate['entryId'])
    if (entryId === null || entryId.trim() === '') return invalid('an entry has no entryId')
    const moduleName = readString(candidate['moduleName'])
    if (moduleName === null || moduleName.trim() === '') return invalid(`entry "${entryId}" has no moduleName`)
    if (typeof candidate['enabled'] !== 'boolean') return invalid(`entry "${entryId}" has a non-boolean "enabled"`)

    const phaseValue = candidate['fiberPhase']
    let fiberPhase: FiberPhase | null = null
    if (phaseValue !== undefined && phaseValue !== null) {
      if (typeof phaseValue !== 'string' || !isFiberPhase(phaseValue)) {
        // The rename detector: never coerce an unknown phase into "fine".
        return invalid(
          `entry "${entryId}" has fiberPhase ${JSON.stringify(phaseValue)}, which is not one of ${FIBER_PHASES.join('|')} — upstream may have renamed the enum`,
        )
      }
      fiberPhase = phaseValue
    }

    entries.push({
      entryId,
      moduleName,
      enabled: candidate['enabled'],
      fiberPhase,
      raw: candidate,
    })
  }

  entries.sort((left, right) => left.entryId.localeCompare(right.entryId))
  const unknownKeys = Object.keys(value)
    .filter((key) => !KNOWN_SNAPSHOT_KEYS.has(key))
    .sort((left, right) => left.localeCompare(right))

  return ok({
    managementAvailable,
    entries,
    sampledAt,
    profile,
    source: meta.source,
    unknownKeys,
  })
}

export function isFiberPhase(value: string): value is FiberPhase {
  return (FIBER_PHASES as readonly string[]).includes(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function readOptionalBoolean(value: unknown): boolean | null | 'invalid' {
  if (value === undefined || value === null) return null
  return typeof value === 'boolean' ? value : 'invalid'
}

/* -------------------------------- judgement -------------------------------- */

/**
 * Phase → conclusion, exactly the table in docs/specs/M2-inventory.md §3.
 * Returns `null` when the phase carries no conclusion (transient or healthy).
 */
export function phaseConclusion(entry: InventoryEntry): PhaseConclusion | null {
  if (!entry.enabled) {
    // Disabled wins over every phase: the row is off by configuration, and calling
    // a deliberately disabled row "failed" would send users hunting for a bug.
    return {
      conclusion: 'risky',
      code: 'runtime.disabled',
      messageId: 'runtime.disabled',
      params: { entryId: entry.entryId, module: entry.moduleName, phase: entry.fiberPhase ?? 'none' },
      severity: 'warn',
      remediation: ['disable-entry'],
    }
  }
  if (entry.fiberPhase === 'failed') {
    return {
      conclusion: 'blocked',
      code: 'runtime.fiber-failed',
      messageId: 'runtime.fiber-failed',
      params: { entryId: entry.entryId, module: entry.moduleName },
      severity: 'block',
      remediation: ['disable-entry', 'report'],
    }
  }
  if (entry.fiberPhase === null) {
    return {
      conclusion: 'blocked',
      code: 'runtime.no-fiber',
      messageId: 'runtime.no-fiber',
      params: { entryId: entry.entryId, module: entry.moduleName },
      severity: 'block',
      remediation: ['disable-entry', 'report'],
    }
  }
  // active / pending / loading / unloading: the bundle verdict owns this entry.
  return null
}

export interface PhaseConclusion {
  readonly conclusion: Conclusion
  readonly code: string
  readonly messageId: string
  readonly params: Readonly<Record<string, string | number>>
  readonly severity: 'block' | 'warn' | 'info'
  readonly remediation: readonly ('disable-entry' | 'report' | 'probe' | 'remove-plugin')[]
}

/** Build the runtime-layer verdicts for one snapshot. Deterministic: sorted by entry id. */
export function verdictsFromInventory(input: InventoryVerdictInput): readonly Verdict[] {
  const { snapshot, env, generatedAt } = input
  const out: Verdict[] = []
  const byId = new Map(snapshot.entries.map((entry) => [entry.entryId, entry]))
  const declaredIds = new Set(input.declared.map((row) => row.entryId))

  for (const entry of snapshot.entries) {
    const judgement = phaseConclusion(entry)
    if (judgement === null) continue
    out.push(
      buildVerdict({
        env,
        subject: { name: entry.moduleName, version: null, kind: 'entry' },
        conclusion: judgement.conclusion,
        confidence: { level: judgement.conclusion === 'blocked' ? 'high' : 'medium', basis: 'measured-local' },
        reasons: [
          {
            code: judgement.code,
            severity: judgement.severity,
            messageId: judgement.messageId,
            params: judgement.params,
          },
        ],
        remediation: judgement.remediation.map((kind) => remediationOf(kind, entry.entryId, entry.moduleName, env.profile)),
        missingEvidence: [],
        snapshot,
        generatedAt,
        detail: `phase=${entry.fiberPhase ?? 'none'} enabled=${entry.enabled}`,
      }),
    )
  }

  for (const row of input.declared) {
    if (row.module === null || byId.has(row.entryId)) continue
    out.push(
      buildVerdict({
        env,
        subject: { name: row.module, version: null, kind: 'entry' },
        conclusion: 'unknown',
        confidence: { level: 'low', basis: 'measured-local' },
        reasons: [
          {
            code: 'runtime.missing-entry',
            severity: 'warn',
            messageId: 'runtime.missing-entry',
            params: { entryId: row.entryId, module: row.module },
          },
        ],
        remediation: [remediationOf('probe', row.entryId, row.module, env.profile)],
        missingEvidence: ['missing.fiber'],
        snapshot,
        generatedAt,
        detail: `declared but not in the snapshot: ${row.entryId}`,
      }),
    )
  }

  for (const entry of snapshot.entries) {
    if (declaredIds.has(entry.entryId)) continue
    out.push(
      buildVerdict({
        env,
        subject: { name: entry.moduleName, version: null, kind: 'entry' },
        conclusion: 'risky',
        confidence: { level: 'low', basis: 'measured-local' },
        reasons: [
          {
            code: 'runtime.undeclared-entry',
            severity: 'info',
            messageId: 'runtime.undeclared-entry',
            params: { entryId: entry.entryId, module: entry.moduleName },
          },
        ],
        remediation: [remediationOf('report', entry.entryId, entry.moduleName, env.profile)],
        missingEvidence: [],
        snapshot,
        generatedAt,
        detail: `running but not declared: ${entry.entryId}`,
      }),
    )
  }

  return out
}

/** Declared-vs-running diff for `audit`: the machine-checkable form of "declared but never registered". */
export function compareInventory(
  snapshot: InventorySnapshot,
  declared: readonly DeclaredRow[],
): { readonly missing: readonly DeclaredRow[]; readonly undeclared: readonly InventoryEntry[] } {
  const byId = new Set(snapshot.entries.map((entry) => entry.entryId))
  const declaredIds = new Set(declared.map((row) => row.entryId))
  return {
    missing: declared
      .filter((row) => row.module !== null && !byId.has(row.entryId))
      .sort((left, right) => left.entryId.localeCompare(right.entryId)),
    undeclared: snapshot.entries
      .filter((entry) => !declaredIds.has(entry.entryId))
      .sort((left, right) => left.entryId.localeCompare(right.entryId)),
  }
}

function remediationOf(
  kind: 'disable-entry' | 'report' | 'probe' | 'remove-plugin',
  entryId: string,
  module: string,
  profile: string,
): Remediation {
  switch (kind) {
    case 'disable-entry':
      return {
        kind,
        messageId: 'remediation.disable-entry',
        params: { id: entryId, owners: 'patch:profile' },
        note: `disable entry "${entryId}" in the later patch layer once "${module}" is no longer needed`,
      }
    case 'probe':
      return {
        kind,
        messageId: 'remediation.probe',
        note: `an isolated probe (M3) can decide whether "${module}" would register in a clean profile`,
      }
    case 'remove-plugin':
      return {
        kind,
        messageId: 'remediation.remove-plugin',
        note: `remove "${module}" if entry "${entryId}" is not wanted`,
      }
    case 'report':
      return {
        kind,
        messageId: 'remediation.report',
        note: `report entry "${entryId}" (${module}) to the plugin author; profile "${profile}" has a runtime sample proving it`,
      }
  }
}

function buildVerdict(input: {
  readonly env: EnvFingerprint
  readonly subject: Verdict['subject']
  readonly conclusion: Conclusion
  readonly confidence: Confidence
  readonly reasons: readonly Reason[]
  readonly remediation: readonly Remediation[]
  readonly missingEvidence: readonly string[]
  readonly snapshot: InventorySnapshot
  readonly generatedAt: string
  readonly detail: string
}): Verdict {
  const evidence: Evidence[] = [
    {
      id: 'inventory',
      tier: 'measured-local',
      source: input.snapshot.source,
      method: 'plugin-inventory/list',
      at: input.snapshot.sampledAt,
      detail: input.detail,
    },
  ]
  if (input.snapshot.profile !== null) {
    evidence.push({
      id: 'inventory-profile',
      tier: 'measured-local',
      source: input.snapshot.profile,
      method: 'plugin-inventory/list',
      at: input.snapshot.sampledAt,
      detail: `sampled from profile ${input.snapshot.profile}`,
    })
  }
  return {
    schemaVersion: 1,
    subject: input.subject,
    env: input.env,
    conclusion: input.conclusion,
    confidence: input.confidence,
    reasons: input.reasons,
    evidence,
    remediation: input.remediation,
    missingEvidence: input.missingEvidence,
    generatedAt: input.generatedAt,
  }
}
