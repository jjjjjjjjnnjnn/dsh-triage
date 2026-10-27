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

/**
 * How the snapshot reached us. This is not cosmetic: `pluginInventory/list` is a
 * Remote call, while `readPluginInventory(ctx)` is the same projection read in
 * process. Recording which one produced a row keeps the artifact from claiming a
 * transport it never used (see the `transport-not-claimed` fixture).
 */
export const INVENTORY_TRANSPORTS = ['in-process-projection', 'remote'] as const
export type InventoryTransport = (typeof INVENTORY_TRANSPORTS)[number]

const KNOWN_SNAPSHOT_KEYS = new Set([
  'managementAvailable',
  'entries',
  'agentPresets',
  'snapshot',
  'sampled_at',
  'sampledAt',
  'profile',
  'transport',
  // Our own export metadata (P2 files written by hand, or the P1 host hook).
  'note',
  'kind',
  'method',
  'wait_ms',
  'upstream',
  'excluded',
  'host_summary',
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
  /** Which transport produced the rows; `null` means the file did not say. */
  readonly transport: InventoryTransport | null
  /**
   * Per-preset compositions. Judged per row and per preset (T-112): one entry id can
   * carry a different phase under each preset, and taking the best-looking one would
   * be the exact lie this layer exists to prevent.
   */
  readonly presets: readonly InventoryPreset[]
}

/** One plugin row inside an agent preset's composition. */
export interface InventoryPresetRow {
  /** `null` when the composition file spells no row id (upstream allows it). */
  readonly entryId: string | null
  readonly moduleName: string
  /** `'conditional'` is upstream's way of saying "a gate only a Loader context can decide". */
  readonly enabled: boolean | 'conditional'
  /** The row's own `!!js` disabled expression, when it carries one. */
  readonly condition: string | null
  readonly fiberPhase: FiberPhase | null
  readonly raw: Readonly<Record<string, unknown>>
}

/** One agent preset's identity plus its flattened composition. */
export interface InventoryPreset {
  readonly id: string
  readonly name: string | null
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean
  /** Why the composition cannot be read; `null` when the rows answer. */
  readonly broken: string | null
  readonly rows: readonly InventoryPresetRow[]
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
  // Unknown keys are collected from the wrapper *and* the inner snapshot: a field
  // upstream adds inside `snapshot` is exactly as interesting as one on the wrapper,
  // and the earlier version only looked at the wrapper.
  const unknownKeys = [...new Set([...Object.keys(value), ...Object.keys(wrapped)])]
    .filter((key) => !KNOWN_SNAPSHOT_KEYS.has(key))
    .sort((left, right) => left.localeCompare(right))

  const transport = readTransport(value['transport'] ?? wrapped['transport'])
  if (transport === 'invalid') {
    return invalid(
      `"transport" is ${JSON.stringify(value['transport'] ?? wrapped['transport'])}, which is not one of ${INVENTORY_TRANSPORTS.join('|')} — a sample must say how it was taken`,
    )
  }

  const presets = readPresets(wrapped['agentPresets'])
  if (presets !== null && !presets.ok) return invalid(presets.error)

  return ok({
    managementAvailable,
    entries,
    sampledAt,
    profile,
    source: meta.source,
    unknownKeys,
    transport,
    presets: presets === null ? [] : presets.presets,
  })
}

function readTransport(value: unknown): InventoryTransport | null | 'invalid' {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return 'invalid'
  return (INVENTORY_TRANSPORTS as readonly string[]).includes(value) ? (value as InventoryTransport) : 'invalid'
}

/** Shared with the capability layer, so one sample cannot be parsed with two rules. */
export function readTransportValue(value: unknown): InventoryTransport | null | 'invalid' {
  return readTransport(value)
}

/**
 * Parse `agentPresets` defensively (T-112).
 *
 * A preset whose composition cannot be read (`broken`) keeps its identity and its
 * reason and contributes no rows — it must stay visible, because "this preset is
 * broken" is exactly the kind of fact a silent drop would erase.
 *
 * EVERY REFUSAL NAMES ITS CAUSE. The first version returned one shared message
 * ("agentPresets is present but not an array") for a missing `moduleName`, a bogus
 * `enabled`, and a non-array `rows` — a false explanation is worse than no sample,
 * because it sends the next reader to the wrong field.
 */
function readPresets(value: unknown): { ok: true; presets: readonly InventoryPreset[] } | { ok: false; error: string } | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) return { ok: false, error: `"agentPresets" is ${typeof value}, not an array` }
  const presets: InventoryPreset[] = []
  const seen = new Set<string>()
  for (const [index, candidate] of value.entries()) {
    const where = `agentPresets[${index}]`
    if (!isRecord(candidate)) return { ok: false, error: `${where} is not an object` }
    const id = readString(candidate['id'])
    if (id === null) return { ok: false, error: `${where} has no id` }
    if (seen.has(id)) return { ok: false, error: `preset "${id}" appears more than once, so its rows cannot be attributed` }
    seen.add(id)
    const broken = readString(candidate['broken'])
    const rawRows = candidate['rows']
    if (rawRows !== undefined && rawRows !== null && !Array.isArray(rawRows)) {
      return { ok: false, error: `${where} ("${id}") has "rows" that is not an array` }
    }
    // A broken preset legitimately carries no rows ("stays listed with its reason and
    // no rows"), but carrying rows *and* a reason contradicts itself: judging the rows
    // while saying the composition is unreadable would hide whichever answer is wrong.
    if ((rawRows === undefined || rawRows === null) && broken === null) {
      return { ok: false, error: `${where} ("${id}") has neither readable rows nor a broken reason` }
    }
    const rows: InventoryPresetRow[] = []
    for (const [rowIndex, rawRow] of (rawRows ?? []).entries()) {
      const rowWhere = `${where}.rows[${rowIndex}]`
      if (!isRecord(rawRow)) return { ok: false, error: `${rowWhere} is not an object` }
      const moduleName = readString(rawRow['moduleName'])
      if (moduleName === null) return { ok: false, error: `${rowWhere} has no moduleName` }
      const enabled = rawRow['enabled']
      if (enabled !== true && enabled !== false && enabled !== 'conditional') {
        return { ok: false, error: `${rowWhere} ("${moduleName}") has enabled=${JSON.stringify(enabled)}, expected true/false/'conditional'` }
      }
      const phaseValue = rawRow['fiberPhase']
      let fiberPhase: FiberPhase | null = null
      if (phaseValue !== undefined && phaseValue !== null) {
        if (typeof phaseValue !== 'string' || !isFiberPhase(phaseValue)) {
          // Same rename detector as the main list, per row: a preset row with an
          // unknown phase must not be judged "fine".
          return {
            ok: false,
            error: `${rowWhere} ("${moduleName}") has fiberPhase ${JSON.stringify(phaseValue)}, which is not one of ${FIBER_PHASES.join('|')}`,
          }
        }
        fiberPhase = phaseValue
      }
      const entryId = readString(rawRow['entryId'])
      rows.push({
        entryId,
        moduleName,
        enabled,
        condition: readString(rawRow['condition']),
        fiberPhase,
        raw: rawRow,
      })
    }
    if (broken !== null && rows.length > 0) {
      return { ok: false, error: `${where} ("${id}") is marked broken and still carries ${rows.length} row(s)` }
    }
    presets.push({
      id,
      name: readString(candidate['name']),
      isDefault: candidate['isDefault'] === true,
      broken,
      rows,
    })
  }
  const sorted = [...presets].sort((left, right) => left.id.localeCompare(right.id))
  return { ok: true, presets: sorted }
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
  const index = indexRuntimeIds(snapshot)
  /** Runtime ids a declared row accounts for (exact, or the one tail match). */
  const claimedRuntimeIds = new Set<string>()
  const ambiguous: { declared: DeclaredRow; candidates: readonly string[] }[] = []
  for (const row of input.declared) {
    const resolved = resolveRuntimeId(index, row.entryId, row.module)
    if (resolved.kind === 'matched') claimedRuntimeIds.add(resolved.entryId)
    else if (resolved.kind === 'ambiguous') {
      ambiguous.push({ declared: row, candidates: resolved.candidates })
      for (const candidate of resolved.candidates) claimedRuntimeIds.add(candidate)
    }
  }

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
    if (row.module === null) continue
    if (resolveRuntimeId(index, row.entryId, row.module).kind !== 'absent') continue
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

  for (const item of ambiguous) {
    // Same row id under two groups: picking one would invent an attribution.
    out.push(
      buildVerdict({
        env,
        subject: { name: item.declared.module ?? item.declared.entryId, version: null, kind: 'entry' },
        conclusion: 'unknown',
        confidence: { level: 'low', basis: 'measured-local' },
        reasons: [
          {
            code: 'runtime.ambiguous-entry',
            severity: 'warn',
            messageId: 'runtime.ambiguous-entry',
            params: {
              entryId: item.declared.entryId,
              candidates: item.candidates.join(', '),
              count: item.candidates.length,
            },
          },
        ],
        remediation: [remediationOf('probe', item.declared.entryId, item.declared.module ?? item.declared.entryId, env.profile)],
        missingEvidence: ['missing.row-identity'],
        snapshot,
        generatedAt,
        detail: `declared id "${item.declared.entryId}" matches ${item.candidates.join(', ')}`,
      }),
    )
  }

  for (const entry of snapshot.entries) {
    // A disabled entry that nobody declares is already reported as `disabled`;
    // adding "runs but is not declared" would be a lie about a row that is off.
    if (!entry.enabled || claimedRuntimeIds.has(entry.entryId)) continue
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
            params: { entryId: entry.entryId, module: entry.moduleName, phase: entry.fiberPhase ?? 'none' },
          },
        ],
        remediation: [remediationOf('report', entry.entryId, entry.moduleName, env.profile)],
        missingEvidence: [],
        snapshot,
        generatedAt,
        detail: `in the sample but not declared: ${entry.entryId}`,
      }),
    )
  }

  for (const verdict of presetVerdicts({ env, snapshot, generatedAt })) out.push(verdict)

  return out
}

/**
 * Preset dimension (T-112, `docs/specs/M2-inventory.md` §3 hard constraint 3).
 *
 * WHY ROWS ARE NOT JUDGED LIKE THE MAIN LIST: for a Loader entry, `null` + enabled
 * is the CASE-11080 shape (declared, never loaded) and blocks. For a *preset* row,
 * upstream documents `fiberPhase` as "root-fiber phase when the composition is live;
 * null otherwise" — so `null` there also covers "this preset was never composed on
 * this Host", which is not a fault. Claiming `blocked` from that would manufacture a
 * failure out of a preset nobody used; claiming `go` would hide a real one. That
 * leaves exactly one honest conclusion: `unknown`, with the ambiguity named.
 */
function presetVerdicts(input: {
  readonly env: EnvFingerprint
  readonly snapshot: InventorySnapshot
  readonly generatedAt: string
}): readonly Verdict[] {
  const { env, snapshot, generatedAt } = input
  const out: Verdict[] = []

  for (const preset of snapshot.presets) {
    if (preset.broken !== null) {
      // Keep the channel visible: a broken preset is a fact about the deployment, and
      // dropping it because its rows are unreadable would hide the deployment's shape.
      out.push(
        withPresetDetail(
          buildVerdict({
            env,
            subject: { name: `preset:${preset.id}`, version: null, kind: 'set' },
            conclusion: 'unknown',
            confidence: { level: 'low', basis: 'measured-local' },
            reasons: [
              {
                code: 'runtime.preset-unjudged',
                severity: 'warn',
                messageId: 'runtime.preset-unjudged',
                params: { preset: preset.id, reason: preset.broken },
              },
            ],
            remediation: [remediationOf('probe', preset.id, preset.id, env.profile)],
            missingEvidence: ['missing.preset-phase'],
            snapshot,
            generatedAt,
            detail: `preset ${preset.id} is broken: ${preset.broken}`,
          }),
          preset.id,
        ),
      )
      continue
    }

    for (const row of preset.rows) {
      const entryId = row.entryId ?? row.moduleName
      if (row.enabled === 'conditional') {
        out.push(
          withPresetDetail(
            buildVerdict({
              env,
              subject: { name: row.moduleName, version: null, kind: 'entry' },
              conclusion: 'unknown',
              confidence: { level: 'low', basis: 'measured-local' },
              reasons: [
                {
                  code: 'runtime.preset-conditional',
                  severity: 'warn',
                  messageId: 'runtime.preset-conditional',
                  params: {
                    preset: preset.id,
                    entryId,
                    module: row.moduleName,
                    condition: row.condition ?? 'unknown',
                  },
                },
              ],
              remediation: [remediationOf('probe', entryId, row.moduleName, env.profile)],
              missingEvidence: ['missing.preset-context'],
              snapshot,
              generatedAt,
              detail: `preset ${preset.id} row ${entryId}: conditional`,
            }),
            preset.id,
          ),
        )
        continue
      }
      // A disabled floor row is a composition choice (the `minimal` preset is built
      // out of them). Reporting each as a finding would bury the real ones; the row
      // stays visible in the preset listing and in `--json`.
      if (row.enabled === false) continue
      if (row.fiberPhase === 'failed') {
        out.push(
          withPresetDetail(
            buildVerdict({
              env,
              subject: { name: row.moduleName, version: null, kind: 'entry' },
              conclusion: 'blocked',
              confidence: { level: 'high', basis: 'measured-local' },
              reasons: [
                {
                  code: 'runtime.preset-fiber-failed',
                  severity: 'block',
                  messageId: 'runtime.preset-fiber-failed',
                  params: { preset: preset.id, entryId, module: row.moduleName },
                },
              ],
              remediation: [
                remediationOf('disable-entry', entryId, row.moduleName, env.profile),
                remediationOf('report', entryId, row.moduleName, env.profile),
              ],
              missingEvidence: [],
              snapshot,
              generatedAt,
              detail: `preset ${preset.id} row ${entryId}: phase=failed`,
            }),
            preset.id,
          ),
        )
        continue
      }
      if (row.fiberPhase === null) {
        out.push(
          withPresetDetail(
            buildVerdict({
              env,
              subject: { name: row.moduleName, version: null, kind: 'entry' },
              conclusion: 'unknown',
              confidence: { level: 'low', basis: 'measured-local' },
              reasons: [
                {
                  code: 'runtime.preset-no-fiber',
                  severity: 'warn',
                  messageId: 'runtime.preset-no-fiber',
                  params: { preset: preset.id, entryId, module: row.moduleName },
                },
              ],
              remediation: [remediationOf('probe', entryId, row.moduleName, env.profile)],
              missingEvidence: ['missing.preset-phase'],
              snapshot,
              generatedAt,
              detail: `preset ${preset.id} row ${entryId}: enabled with no live fiber (never composed, or failed before a fiber)`,
            }),
            preset.id,
          ),
        )
      }
    }
  }

  for (const divergence of findPresetDivergence(snapshot.presets)) {
    out.push(
      buildVerdict({
        env,
        subject: { name: divergence.moduleName, version: null, kind: 'entry' },
        conclusion: 'risky',
        confidence: { level: 'medium', basis: 'measured-local' },
        reasons: [
          {
            code: 'runtime.preset-divergence',
            severity: 'info',
            messageId: 'runtime.preset-divergence',
            params: { entryId: divergence.entryId, presets: divergence.summary },
          },
        ],
        remediation: [remediationOf('report', divergence.entryId, divergence.moduleName, env.profile)],
        missingEvidence: [],
        snapshot,
        generatedAt,
        detail: `preset phases disagree: ${divergence.summary}`,
      }),
    )
  }

  return out
}

/**
 * The machine-checkable form of "never take the optimistic value": name every entry
 * whose *enabled* rows reach different phases under different presets.
 *
 * Disabled rows are excluded on purpose — a preset that leaves a tool out is not a
 * disagreement about a phase, it is the absence of one.
 */
export function findPresetDivergence(
  presets: readonly InventoryPreset[],
): readonly { readonly entryId: string; readonly moduleName: string; readonly summary: string }[] {
  const seen = new Map<string, { moduleName: string; phases: Map<string, string[]> }>()
  for (const preset of presets) {
    if (preset.broken !== null) continue
    for (const row of preset.rows) {
      if (row.enabled !== true) continue
      const entryId = row.entryId ?? row.moduleName
      const phase = row.fiberPhase ?? 'none'
      const bucket = seen.get(entryId) ?? { moduleName: row.moduleName, phases: new Map<string, string[]>() }
      bucket.phases.set(phase, [...(bucket.phases.get(phase) ?? []), preset.id])
      seen.set(entryId, bucket)
    }
  }
  const out: { entryId: string; moduleName: string; summary: string }[] = []
  for (const [entryId, bucket] of seen) {
    if (bucket.phases.size < 2) continue
    const summary = [...bucket.phases]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([phase, presetsWithPhase]) => `${phase}@${[...presetsWithPhase].sort().join('+')}`)
      .join(' vs ')
    out.push({ entryId, moduleName: bucket.moduleName, summary })
  }
  return out.sort((left, right) => left.entryId.localeCompare(right.entryId))
}

/** Tag a preset verdict with the preset it belongs to, so two rows with one id stay apart. */
function withPresetDetail(verdict: Verdict, presetId: string): Verdict {
  // `Verdict` carries no free-form detail field on purpose (docs/05 §契约), so the
  // preset identity travels as its own evidence row instead of being folded into prose.
  return {
    ...verdict,
    evidence: [
      ...verdict.evidence,
      {
        id: 'preset',
        tier: 'measured-local',
        source: `preset:${presetId}`,
        method: 'agent-preset-composition',
        at: verdict.evidence[0]?.at ?? '',
        detail: `this row comes from preset "${presetId}"`,
      },
    ],
  }
}

/**
 * The `method` an evidence row may honestly claim.
 *
 * A snapshot read through `readPluginInventory(ctx)` inside the Host is the same
 * projection the Remote serves, but it is not a Remote call. Writing
 * `plugin-inventory/list` for it would be a small lie that a future reader would
 * quote as proof the transport was exercised.
 */
export function evidenceMethod(transport: InventoryTransport | null): string {
  switch (transport) {
    case 'remote':
      return 'plugin-inventory/list'
    case 'in-process-projection':
      return 'readPluginInventory (in-process projection)'
    default:
      // Deliberately does NOT borrow the Remote endpoint's name: an unlabelled file may
      // well be a projection, and "plugin-inventory/list (unstated)" reads as a Remote
      // call to anyone skimming it.
      return 'inventory snapshot (transport unstated)'
  }
}

/** Declared-vs-running diff for `audit`: the machine-checkable form of "declared but never registered". */
export function compareInventory(
  snapshot: InventorySnapshot,
  declared: readonly DeclaredRow[],
): {
  readonly missing: readonly DeclaredRow[]
  readonly undeclared: readonly InventoryEntry[]
  readonly ambiguous: readonly { readonly entryId: string; readonly candidates: readonly string[] }[]
} {
  const index = indexRuntimeIds(snapshot)
  const missing: DeclaredRow[] = []
  const ambiguous: { entryId: string; candidates: readonly string[] }[] = []
  const claimedRuntimeIds = new Set<string>()
  for (const row of declared) {
    const resolved = resolveRuntimeId(index, row.entryId, row.module)
    if (resolved.kind === 'matched') {
      claimedRuntimeIds.add(resolved.entryId)
      continue
    }
    if (resolved.kind === 'ambiguous') {
      ambiguous.push({ entryId: row.entryId, candidates: resolved.candidates })
      for (const candidate of resolved.candidates) claimedRuntimeIds.add(candidate)
      continue
    }
    if (row.module !== null) missing.push(row)
  }
  return {
    missing: missing.sort((left, right) => left.entryId.localeCompare(right.entryId)),
    undeclared: snapshot.entries
      .filter((entry) => !claimedRuntimeIds.has(entry.entryId))
      .sort((left, right) => left.entryId.localeCompare(right.entryId)),
    ambiguous: ambiguous.sort((left, right) => left.entryId.localeCompare(right.entryId)),
  }
}

/**
 * Why declared ids and runtime ids disagree on a bundle-composed profile:
 * the loader wraps the profile's `cordis.yml` in an `include` group, so a patch row
 * `tool-bash` runs as `include:tool-bash`. Comparing them literally on a real
 * sandbox produced 96 "declared but absent" and 195 "running but undeclared" rows
 * out of a healthy Host — all noise, all false.
 *
 * The rule below never guesses: an exact id wins, a unique `*:<id>` tail matches, and
 * a tail shared by several entries is reported as ambiguous instead of picking one.
 */
export interface RuntimeIdIndex {
  readonly exact: ReadonlySet<string>
  readonly byTail: ReadonlyMap<string, readonly string[]>
  /** entryId → package the row loads, so a tail match can also check *what* it loads. */
  readonly moduleOf: ReadonlyMap<string, string>
}

export function indexRuntimeIds(snapshot: InventorySnapshot): RuntimeIdIndex {
  const exact = new Set<string>()
  const byTail = new Map<string, string[]>()
  const moduleOf = new Map<string, string>()
  for (const entry of snapshot.entries) {
    exact.add(entry.entryId)
    moduleOf.set(entry.entryId, entry.moduleName)
    const cut = entry.entryId.lastIndexOf(':')
    if (cut === -1) continue
    const tail = entry.entryId.slice(cut + 1)
    byTail.set(tail, [...(byTail.get(tail) ?? []), entry.entryId])
  }
  return { exact, byTail, moduleOf }
}

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. Subpath exports share one package. */
export function packageNameOf(moduleName: string): string {
  const parts = moduleName.split('/')
  return moduleName.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? moduleName)
}

/**
 * Resolve a declared patch row id to the loader entry it became.
 *
 * WHY THE MODULE MATTERS (adversary finding E): a tail match on the id alone lets an
 * unrelated row satisfy a declaration — declaring `tools` while the only runtime row is
 * `other:tools` loading `@other/pkg` produced **zero** verdicts, i.e. a genuinely missing
 * plugin plus an unrelated row cancelled out into "all fine". So a suffix match must also
 * agree on the package it loads; a row whose package differs is not a match at all.
 */
export function resolveRuntimeId(
  index: RuntimeIdIndex,
  declaredId: string,
  declaredModule: string | null = null,
):
  | { readonly kind: 'matched'; readonly entryId: string }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] }
  | { readonly kind: 'absent' } {
  if (index.exact.has(declaredId)) {
    // An exact id is the row itself, whatever module it loads: `pluginInventory` brands
    // entry ids at the owning boundary, so an exact hit needs no corroboration.
    return { kind: 'matched', entryId: declaredId }
  }
  const tails = index.byTail.get(declaredId) ?? []
  const wanted = declaredModule === null ? null : packageNameOf(declaredModule)
  const candidates =
    wanted === null
      ? [...tails]
      : tails.filter((entryId) => {
          const moduleName = index.moduleOf.get(entryId)
          return moduleName === undefined ? false : packageNameOf(moduleName) === wanted
        })
  if (candidates.length === 1) return { kind: 'matched', entryId: candidates[0] as string }
  if (candidates.length > 1) return { kind: 'ambiguous', candidates: [...candidates].sort() }
  return { kind: 'absent' }
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
      method: evidenceMethod(input.snapshot.transport),
      at: input.snapshot.sampledAt,
      detail: input.detail,
    },
  ]
  if (input.snapshot.profile !== null) {
    evidence.push({
      id: 'inventory-profile',
      tier: 'measured-local',
      source: input.snapshot.profile,
      method: evidenceMethod(input.snapshot.transport),
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
