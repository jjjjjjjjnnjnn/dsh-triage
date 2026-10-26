/**
 * Capability ledger: what each loader row / bundle claims to occupy.
 *
 * Source of truth for the shape: a DSH profile patch layer is a top-level YAML
 * array whose items may carry `id`, `name`, `disabled`, `group`, and nested
 * `insert` lists. We only read identifiers — we never interpret config values,
 * because interpreting them would make us a second loader implementation.
 *
 * Blind spot (BS-04 in `audit/blind_spots.json`): static extraction cannot see
 * capabilities registered dynamically at runtime. Runtime registries
 * (`tools.schemas()`, `commands.list()`, …) are the second source in M2.
 */

import { parseDocument } from 'yaml'
import type { CoreError, Result } from './result.js'
import { err, ok } from './result.js'

export interface EntryClaim {
  /** Loader entry id, unique inside a composition. */
  readonly id: string
  /** Module specifier the row imports; `null` for structural groups. */
  readonly name: string | null
  readonly disabled: boolean
  readonly group: boolean
  /** Where the claim came from, e.g. `profile:<pkg>#patch` or `patch:./cordis.patch.yml`. */
  readonly source: string
  /** Nesting depth, kept so renderers can show the row tree. */
  readonly depth: number
}

export interface EntryCollision {
  readonly id: string
  readonly kind: 'within-source-duplicate' | 'conflicting-definitions'
  /** Distinct owners; sorted for deterministic output. */
  readonly owners: readonly string[]
  /** How many claims carried this id in total. */
  readonly count: number
  /** Row definitions involved (module specifiers), sorted; `<group>` for groups. */
  readonly names: readonly string[]
}

const MAX_DEPTH = 32

/** Parse a patch file. Returns a typed error instead of throwing. */
export function parsePatchYaml(text: string): Result<unknown, CoreError> {
  // `logLevel: 'silent'` suppresses upstream `!!js` tag warnings (DSH patch layers
  // legitimately contain `!!js` expressions and we only read row ids). Because that
  // level also quiets parse errors, we inspect `doc.errors` explicitly — an invalid
  // patch must never be treated as an empty one.
  const doc = parseDocument(text, { logLevel: 'silent' })
  if (doc.errors.length > 0) {
    const first = doc.errors[0]
    return err({ code: 'patch-invalid', detail: first === undefined ? 'invalid yaml' : first.message })
  }
  try {
    return ok(doc.toJS())
  } catch (error) {
    return err({ code: 'patch-invalid', detail: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Collect every addressable row in one patch document.
 * Structural groups are kept (they can also collide) but flagged via `group`.
 */
export function extractEntryClaims(document: unknown, source: string): readonly EntryClaim[] {
  const claims: EntryClaim[] = []
  visit(document, source, 0, claims)
  return claims
}

function visit(node: unknown, source: string, depth: number, out: EntryClaim[]): void {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return

  if (Array.isArray(node)) {
    for (const item of node) visit(item, source, depth, out)
    return
  }

  const record = node as Record<string, unknown>
  const id = record['id']
  if (typeof id === 'string' && id !== '') {
    out.push({
      id,
      name: typeof record['name'] === 'string' ? record['name'] : null,
      disabled: record['disabled'] === true,
      group: record['group'] === true,
      source,
      depth,
    })
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === 'config') continue // config may contain arbitrary user objects; never interpret it
    if (value !== null && typeof value === 'object') {
      visit(value, source, depth + 1, out)
    }
  }
}

/**
 * Detect duplicate loader entry ids that are actually fatal.
 *
 * WHY THIS IS NOT A NAIVE GROUP-BY (learned the hard way):
 * a patch layer reuses an existing `id` on purpose — `- id: hmr` + `disabled: true`
 * is an *override*, not a duplicate. Grouping by id alone produced 27 false
 * "blocked" verdicts on a stock profile. The classifier therefore ignores claims
 * that carry no row definition, and only reports:
 *
 *  - `within-source-duplicate`: one layer defines the same id twice;
 *  - `conflicting-definitions`: two layers define the same id with different
 *    module specifiers (the real `duplicate loader entry id` boot failure).
 */
export function findEntryIdCollisions(claims: readonly EntryClaim[]): readonly EntryCollision[] {
  const byId = new Map<string, EntryClaim[]>()
  for (const claim of claims) {
    const bucket = byId.get(claim.id)
    if (bucket === undefined) byId.set(claim.id, [claim])
    else bucket.push(claim)
  }

  const collisions: EntryCollision[] = []
  for (const [id, bucket] of [...byId.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // A claim without `name` and without `group` only patches config/disabled of
    // an existing row: never a collision, however many layers repeat it.
    const definitions = bucket.filter((claim) => claim.name !== null || claim.group)
    if (definitions.length < 2) continue

    const names = [...new Set(definitions.map((claim) => claim.name ?? '<group>'))].sort((a, b) => a.localeCompare(b))
    const owners = [...new Set(definitions.map((claim) => claim.source))].sort((a, b) => a.localeCompare(b))

    if (names.length === 1) {
      // Same id + same module re-declared by a later layer is a legitimate restatement.
      if (owners.length > 1) continue
      collisions.push({ id, kind: 'within-source-duplicate', owners, count: definitions.length, names })
      continue
    }

    collisions.push({
      id,
      kind: owners.length > 1 ? 'conflicting-definitions' : 'within-source-duplicate',
      owners,
      count: definitions.length,
      names,
    })
  }
  return collisions
}

/** One row that imports a module; groups and config-only overrides are excluded. */
export interface RowTarget {
  readonly rowId: string
  readonly module: string
  readonly source: string
}

/**
 * Keep the rows that actually import something.
 *
 * A row without `name` only patches config/disabled of an existing row, and a
 * group row has no module either — neither can be admitted or rejected on its
 * own, so evaluating them would invent findings.
 */
export function rowTargets(claims: readonly EntryClaim[]): readonly RowTarget[] {
  const seen = new Set<string>()
  const out: RowTarget[] = []
  for (const claim of claims) {
    if (claim.name === null || claim.group || claim.disabled) continue
    const key = `${claim.source}\u0000${claim.id}\u0000${claim.name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ rowId: claim.id, module: claim.name, source: claim.source })
  }
  return out
}

/** Group claims by owner, preserving deterministic order. */
export function groupClaimsBySource(claims: readonly EntryClaim[]): ReadonlyMap<string, readonly EntryClaim[]> {
  const grouped = new Map<string, EntryClaim[]>()
  for (const claim of claims) {
    const bucket = grouped.get(claim.source)
    if (bucket === undefined) grouped.set(claim.source, [claim])
    else bucket.push(claim)
  }
  for (const bucket of grouped.values()) bucket.sort((a, b) => a.id.localeCompare(b.id))
  return new Map([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)))
}
