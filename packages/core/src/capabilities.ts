/**
 * Capability layer (M2-a · T-202, narrowed).
 *
 * WHY THIS IS FACTS AND DIFFS, NOT "MISSING TOOL" VERDICTS: upstream plugins do not
 * declare their tool names anywhere static. `@deepseek-ai/dsh-tool-bash` has no `dsh`
 * field in `package.json`; the only place `bash` appears is `defineTool({ name: 'bash' })`
 * inside the built `lib/index.js`. So "this plugin declared tool X and X is not
 * registered" cannot be derived — it would require us to ship a hand-written
 * plugin→tool mapping table, which is exactly the guessing this project forbids
 * (`PROJECT_RULES.md`, no evidence → `unknown`).
 *
 * What *is* real:
 *   - the registry's own list of tools, read from `ctx.tools.schemas()` in the Host;
 *   - the difference between two samples, which answers "this row disappearing removed
 *     which abilities" — the primitive a bisect (T-114) needs.
 *
 * Everything below is pure: parsing is defensive, the diff is deterministic, and no
 * conclusion is invented from an absence.
 */

import { type CoreError, type Result, err, ok } from './result.js'
import { type InventoryTransport, readTransportValue } from './inventory.js'

export interface CapabilityTool {
  /** Model-facing tool name, exactly as registered. */
  readonly name: string
  /** Optional one-line description; absent when the deployment does not publish one. */
  readonly description: string | null
}

export interface CapabilitySnapshot {
  /**
   * `'tools'` when a tool registry answered; `null` when the deployment composed none.
   * The distinction matters: "no registry" is not "no tools", and reporting an empty
   * list for both would turn a missing service into a clean bill.
   */
  readonly registry: 'tools' | null
  readonly tools: readonly CapabilityTool[]
  readonly sampledAt: string
  /** How the list was read; same contract as the phase layer. */
  readonly transport: InventoryTransport | null
  /** Channels this build can see but does not read yet. Surfaced, never judged. */
  readonly unjudged: readonly string[]
  /** Why the registry read failed, when it did — never conflated with an empty list. */
  readonly readError: string | null
  /** Which presentation the list was read under (`ptc` collapses to `run_code`). */
  readonly presentation: string | null
  /** Why forcing the native view failed, when it did. */
  readonly presentationError: string | null
}

export interface CapabilityMeta {
  readonly sampledAt: string
}

const KNOWN_KEYS = new Set(['registry', 'tools', 'sampled_at', 'sampledAt', 'transport', 'unjudged', 'note', 'read_error', 'presentation', 'presentation_error'])

/** Parse one `capabilities` block defensively; a renamed field must fail loudly. */
export function parseCapabilitySnapshot(value: unknown, meta: CapabilityMeta): Result<CapabilitySnapshot, CoreError> {
  const invalid = (detail: string): Result<never, CoreError> => err({ code: 'capabilities-invalid', detail })
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('capabilities is not an object')
  }
  const record = value as Record<string, unknown>
  const registryRaw = record['registry']
  if (registryRaw !== null && registryRaw !== 'tools' && registryRaw !== undefined) {
    return invalid(`registry is ${JSON.stringify(registryRaw)}, expected "tools" or null`)
  }
  const registry = registryRaw === undefined ? null : (registryRaw as 'tools' | null)
  const rawTools = record['tools']
  if (!Array.isArray(rawTools)) return invalid('tools is missing or is not an array')
  const tools: CapabilityTool[] = []
  for (const [index, candidate] of rawTools.entries()) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return invalid(`tools[${index}] is not an object`)
    }
    const tool = candidate as Record<string, unknown>
    const name = typeof tool['name'] === 'string' ? tool['name'].trim() : ''
    if (name === '') return invalid(`tools[${index}] has no name`)
    const description = typeof tool['description'] === 'string' && tool['description'] !== '' ? tool['description'] : null
    tools.push({ name, description })
  }
  // A registry that answered with no tools is legal; a registry that answered with a
  // duplicate name is not (the Host rejects duplicate registrations, so this means the
  // sample was assembled by hand).
  const seen = new Set<string>()
  for (const tool of tools) {
    if (seen.has(tool.name)) return invalid(`tool "${tool.name}" appears twice in one snapshot`)
    seen.add(tool.name)
  }
  const transport = readTransportValue(record['transport'])
  if (transport === 'invalid') return invalid(`transport is ${JSON.stringify(record['transport'])}`)
  const unjudged = Array.isArray(record['unjudged'])
    ? record['unjudged'].filter((entry): entry is string => typeof entry === 'string').sort()
    : []
  void KNOWN_KEYS
  const sampledAt = typeof record['sampled_at'] === 'string' ? record['sampled_at'] : typeof record['sampledAt'] === 'string' ? record['sampledAt'] : meta.sampledAt
  return ok({
    registry,
    tools: [...tools].sort((left, right) => left.name.localeCompare(right.name)),
    sampledAt,
    transport,
    unjudged,
    readError: typeof record['read_error'] === 'string' ? record['read_error'] : null,
    presentation: typeof record['presentation'] === 'string' ? record['presentation'] : null,
    presentationError: typeof record['presentation_error'] === 'string' ? record['presentation_error'] : null,
  })
}

export interface CapabilityDiff {
  /** Present before, absent after. */
  readonly removed: readonly string[]
  /** Absent before, present after. */
  readonly added: readonly string[]
  /** Present in both; carried so a reader can see the comparison was not empty. */
  readonly unchanged: number
}

/**
 * What changed between two capability samples.
 *
 * This is deliberately not a judgement: a tool disappearing after a row was disabled is
 * the causal link the operator asked for, but the same diff means "an unrelated plugin
 * crashed" if nobody touched a row. The caller records which experiment produced it.
 */
export function diffCapabilities(
  before: CapabilitySnapshot,
  after: CapabilitySnapshot,
): CapabilityDiff {
  const beforeNames = new Set(before.tools.map((tool) => tool.name))
  const afterNames = new Set(after.tools.map((tool) => tool.name))
  const removed = [...beforeNames].filter((name) => !afterNames.has(name)).sort()
  const added = [...afterNames].filter((name) => !beforeNames.has(name)).sort()
  const unchanged = [...beforeNames].filter((name) => afterNames.has(name)).length
  return { removed, added, unchanged }
}
