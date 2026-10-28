/**
 * `audit` as data, not as a command (T-406).
 *
 * WHY THIS FILE EXISTS: `serve` needs the same conclusions the CLI prints, and the only
 * acceptable way to get them is to reuse the engine that produced them. A panel that
 * re-derived verdicts would be a second engine, and two engines drift.
 *
 * CONTRACT (unchanged by the extraction): the JSON payload this module builds is byte-for-
 * byte the payload `dsh-triage audit --json` printed before the refactor. The rename was
 * verified by hashing `audit --json` before and after on two profiles (see
 * `audit/AUDIT_2026-10-28_R19.md`); nothing here may grow a new conclusion or a new field
 * without a spec change.
 */

import { readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import {
  compareInventory,
  extractEntryClaims,
  extractPresetDeclarations,
  findEntryIdCollisions,
  groupClaimsBySource,
  parseInventorySnapshot,
  parsePatchYaml,
  redactEnv,
  redactPath,
  redactVerdict,
  rowTargets,
  verdictsFromInventory,
  verdictsFromRowAdmission,
  type DuplicateCopy,
  type EntryClaim,
  type EnvFingerprint,
  type InventorySnapshot,
  type PresetDeclaration,
  type Verdict,
} from '@dsh-triage/core'
import { discoverLocalArtifacts, type LocalArtifact } from '@dsh-triage/signals'
import { findDuplicateCopies, loadComposition, resolveRows } from './load.js'

/** The declared/runtime diff, kept as three separate lists so a reader never has to infer. */
export interface AuditDiff {
  readonly missing: readonly { entryId: string; module: string | null }[]
  readonly undeclared: readonly InventorySnapshot['entries'][number][]
  readonly ambiguous: readonly { readonly entryId: string; readonly candidates: readonly string[] }[]
}

export interface AuditData {
  readonly env: EnvFingerprint
  readonly claims: readonly EntryClaim[]
  readonly grouped: ReadonlyMap<string, readonly EntryClaim[]>
  readonly collisions: ReturnType<typeof findEntryIdCollisions>
  readonly artifacts: readonly LocalArtifact[]
  readonly duplicates: readonly DuplicateCopy[]
  readonly duplicateFindings: readonly DuplicateCopy[]
  readonly rows: Awaited<ReturnType<typeof resolveRows>>
  readonly rowVerdicts: readonly Verdict[]
  readonly presetDeclarations: readonly PresetDeclaration[]
  readonly snapshot: InventorySnapshot | null
  readonly inventoryVerdicts: readonly Verdict[]
  readonly diff: AuditDiff
  readonly declared: readonly { entryId: string; module: string | null }[]
  readonly errors: readonly string[]
}

export interface AuditLoadInput {
  readonly env: EnvFingerprint
  readonly dshHome: string
  /** Fixed ISO timestamp; never `Date.now()` inside this module. */
  readonly stamp: string
  /** `audit --snapshot <file>`: judge runtime phases from a `pluginInventory/list` export. */
  readonly snapshotPath: string | null
  readonly noRedact: boolean
}

export type AuditLoad =
  | { readonly ok: true; readonly data: AuditData }
  | { readonly ok: false; readonly message: string }

/**
 * Everything `audit` reads, in one pass.
 *
 * Failure is data (`ok: false`) rather than an exception: the CLI turns it into exit 3, and
 * the panel turns it into a 409 with the same sentence — neither may print a half-read ledger.
 */
export async function loadAuditData(input: AuditLoadInput): Promise<AuditLoad> {
  const composition = await loadComposition(input.env, input.dshHome)
  const errors: string[] = []
  const claims = collectClaims(composition, errors)
  const presetDeclarations = collectPresetDeclarations(composition, errors)
  const grouped = groupClaimsBySource(claims)
  const collisions = findEntryIdCollisions(claims)
  const artifacts = await discoverLocalArtifacts({ root: input.env.profileDir })
  const duplicates = await findDuplicateCopies(input.env)
  const duplicateFindings = duplicates.filter((duplicate) => duplicate.kind === 'different-versions')
  // Resolving rows here is what lets `audit` answer "who put this copy here" for
  // every row, not only for the denied ones (R8 adversary finding F11).
  const rows = await resolveRows(input.env, rowTargetsOf(claims))
  // T-105: `why` and `audit` must reach the SAME row-level admission conclusion.
  const rowVerdicts = verdictsFromRowAdmission({ env: input.env, rows, generatedAt: input.stamp })

  let snapshot: InventorySnapshot | null = null
  let inventoryVerdicts: readonly Verdict[] = []
  let diff: AuditDiff = { missing: [], undeclared: [], ambiguous: [] }
  const declared = claims.map((claim) => ({ entryId: claim.id, module: claim.name }))

  if (input.snapshotPath !== null) {
    const source = input.noRedact
      ? input.snapshotPath
      : redactPath(input.snapshotPath, [homedir(), input.dshHome, tmpdir()])
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(input.snapshotPath, 'utf8'))
    } catch (error) {
      return { ok: false, message: `cannot read snapshot ${source}: ${error instanceof Error ? error.message : String(error)}` }
    }
    const parsed = parseInventorySnapshot(raw, { source, sampledAt: input.stamp, profile: input.env.profile })
    if (!parsed.ok) {
      // A renamed upstream field must fail loudly: silently dropping the layer would turn
      // "I could not read the phases" into "no problems found".
      return { ok: false, message: `snapshot rejected: ${parsed.error.code} — ${parsed.error.detail}` }
    }
    snapshot = parsed.value
    inventoryVerdicts = verdictsFromInventory({ env: input.env, snapshot, declared, generatedAt: input.stamp })
    diff = compareInventory(snapshot, declared)
  }

  return {
    ok: true,
    data: {
      env: input.env,
      claims,
      grouped,
      collisions,
      artifacts,
      duplicates,
      duplicateFindings,
      rows,
      rowVerdicts,
      presetDeclarations,
      snapshot,
      inventoryVerdicts,
      diff,
      declared,
      errors,
    },
  }
}

/** Redaction roots: the two homes a profile path can start with. */
export function auditRedactRoots(dshHome: string): readonly string[] {
  return [homedir(), dshHome]
}

export function redactedEnv(env: EnvFingerprint, options: { noRedact: boolean; roots: readonly string[] }): EnvFingerprint {
  if (options.noRedact) return env
  return redactEnv(env, options.roots)
}

export function redactedVerdicts(
  verdicts: readonly Verdict[],
  options: { noRedact: boolean; roots: readonly string[] },
): readonly Verdict[] {
  if (options.noRedact) return verdicts
  return verdicts.map((verdict) => redactVerdict(verdict, options.roots))
}

/**
 * The `audit --json` payload.
 *
 * Every field here existed before T-406; the panel renders this object verbatim, which is
 * what "same engine as the CLI" means in practice.
 */
export function auditJsonPayload(
  data: AuditData,
  options: { noRedact: boolean; roots: readonly string[] },
): Record<string, unknown> {
  const redaction = { noRedact: options.noRedact, roots: options.roots }
  const { snapshot, diff } = data
  return {
    schema_version: 1,
    command: 'audit',
    env: redactedEnv(data.env, redaction),
    claims: [...data.grouped.entries()].map(([source, list]) => ({ source, entries: list })),
    collisions: data.collisions,
    localArtifacts: data.artifacts.map((artifact) => ({
      path: artifact.path,
      kind: artifact.kind,
      bytes: artifact.bytes,
      note: artifact.note,
    })),
    duplicates: data.duplicates.map((duplicate) => ({
      name: duplicate.name,
      kind: duplicate.kind,
      copies: duplicate.copies.map((copy) => ({ scope: copy.scope, path: copy.path, version: copy.version })),
    })),
    preset_declarations: data.presetDeclarations.map((declaration) => ({
      preset_id: declaration.presetId,
      source: declaration.source,
      row_id: declaration.rowId,
      rows: declaration.rows.length,
      ids: declaration.rows.map((row) => row.id).sort((left, right) => left.localeCompare(right)),
      conditional: declaration.rows.filter((row) => row.enabled === 'conditional').map((row) => row.id),
    })),
    rows: data.rows.map((row) => ({
      row_id: row.rowId,
      module: row.module,
      source: row.source,
      version: row.version,
      declared_by: (row.declaredBy ?? []).map((origin) => ({ name: origin.name, version: origin.version, field: origin.field })),
    })),
    // Same engine as `why`: an e2e test compares these two outputs on one profile.
    row_verdicts: redactedVerdicts(data.rowVerdicts, redaction),
    inventory:
      snapshot === null
        ? null
        : {
            sampled_at: snapshot.sampledAt,
            profile: snapshot.profile,
            source: snapshot.source,
            transport: snapshot.transport,
            management_available: snapshot.managementAvailable,
            unknown_keys: snapshot.unknownKeys,
            entries: snapshot.entries.map((entry) => ({
              entry_id: entry.entryId,
              module: entry.moduleName,
              enabled: entry.enabled,
              phase: entry.fiberPhase,
            })),
            presets: snapshot.presets.map((preset) => ({
              id: preset.id,
              name: preset.name,
              is_default: preset.isDefault,
              broken: preset.broken,
              rows: preset.rows.map((row) => ({
                entry_id: row.entryId,
                module: row.moduleName,
                enabled: row.enabled,
                condition: row.condition,
                phase: row.fiberPhase,
              })),
            })),
            declared_without_module: data.declared.filter((row) => row.module === null).length,
            missing: diff.missing,
            ambiguous: diff.ambiguous,
            undeclared: diff.undeclared.map((entry) => ({
              entry_id: entry.entryId,
              module: entry.moduleName,
              phase: entry.fiberPhase,
            })),
            verdicts: redactedVerdicts(data.inventoryVerdicts, redaction),
          },
    errors: [...data.errors],
  }
}

/** `audit`'s exit code: findings in collisions, duplicate copies, or any non-go verdict. */
export function auditExitOutcome(data: AuditData): 'ok' | 'findings' {
  const clean =
    data.collisions.length === 0 &&
    data.duplicateFindings.length === 0 &&
    data.inventoryVerdicts.every((verdict) => verdict.conclusion === 'go') &&
    data.rowVerdicts.every((verdict) => verdict.conclusion === 'go' || verdict.conclusion === 'unknown')
  return clean ? 'ok' : 'findings'
}

/** Row targets for `resolveRows`, derived from the same claims the JSON publishes. */
function rowTargetsOf(claims: readonly EntryClaim[]): Parameters<typeof resolveRows>[1] {
  return rowTargets(claims)
}

function collectClaims(
  composition: Awaited<ReturnType<typeof loadComposition>>,
  errors: string[],
): readonly EntryClaim[] {
  const claims: EntryClaim[] = []
  const add = (text: string | null, source: string): void => {
    if (text === null) return
    const parsed = parsePatchYaml(text)
    if (!parsed.ok) {
      errors.push(`${source}: ${parsed.error.code} — ${parsed.error.detail}`)
      return
    }
    claims.push(...extractEntryClaims(parsed.value, source))
  }
  for (const layer of composition.layers) {
    const multi = layer.patchFiles.length > 1
    for (const file of layer.patchFiles) {
      // A preset patch file does double duty: it inserts the preset *carrier* row into
      // the tree (a real loader entry, e.g. `preset-standard`) and declares the
      // composition inside that row's `config.plugins`. The carrier belongs here; the
      // composition belongs to `collectPresetDeclarations`.
      add(file.text, multi ? `bundle:${layer.name}/${file.relative}` : `bundle:${layer.name}`)
    }
  }
  add(composition.profilePatch.text, 'patch:profile')
  add(composition.homePatch.text, 'patch:home')
  return claims
}

/**
 * Rows a deployment's preset patch files name, kept out of the loader-tree claims.
 *
 * They are not entries: the loader never mounts them, a preset composition does. Mixing
 * them in would both invent "conflicting definitions" (the same row id legitimately
 * appears in the tree *and* in a preset) and make the declared/runtime diff meaningless.
 */
function collectPresetDeclarations(
  composition: Awaited<ReturnType<typeof loadComposition>>,
  errors: string[],
): readonly PresetDeclaration[] {
  const out: PresetDeclaration[] = []
  for (const layer of composition.layers) {
    for (const file of layer.patchFiles) {
      if (file.scope !== 'preset' || file.text === null) continue
      const source = `bundle:${layer.name}/${file.relative}`
      const parsed = parsePatchYaml(file.text)
      if (!parsed.ok) {
        errors.push(`${source}: ${parsed.error.code} — ${parsed.error.detail}`)
        continue
      }
      out.push(...extractPresetDeclarations(parsed.value, source))
    }
  }
  return out
}
