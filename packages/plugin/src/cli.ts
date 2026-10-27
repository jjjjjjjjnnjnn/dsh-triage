#!/usr/bin/env node
/**
 * `dsh-triage` CLI.
 *
 * Commands (M0 surface):
 *   env                 print the environment fingerprint a verdict would rest on
 *   why                 attribute "installed but nothing happened" / "tools vanished"
 *   check <pkg[@ver]>   judge a candidate before install (declaration layer)
 *   audit               capability ledger: entry ids, owners, collisions, local evidence
 *   probe <pkg[@ver]>   print the isolated probe plan (dry-run; execution is M3)
 *
 * Exit codes: 0 ok · 1 findings (audit always, others only with --strict) · 2 usage · 3 unavailable
 */

import { readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import {
  catalogFor,
  compareInventory,
  evaluateAdmission,
  extractEntryClaims,
  extractPresetDeclarations,
  findEntryIdCollisions,
  findPresetDivergence,
  format,
  groupClaimsBySource,
  judgeVersionDrift,
  loadEnv,
  parseInventorySnapshot,
  parsePatchYaml,
  redactEnv,
  redactPath,
  redactVerdict,
  renderVerdict,
  rowTargets,
  verdictFromAdmission,
  verdictsFromCollisions,
  verdictsFromDuplicateCopies,
  verdictsFromInventory,
  verdictsFromRowAdmission,
  type Conclusion,
  type EntryClaim,
  type EnvFingerprint,
  type InventorySnapshot,
  type InventoryPreset,
  type PresetDeclaration,
  type Locale,
  type Verdict,
  type VersionDrift,
} from '@dsh-triage/core'
import { buildProbePlan } from '@dsh-triage/probe'
import { discoverLocalArtifacts, fetchPackument } from '@dsh-triage/signals'
import { findDuplicateCopies, loadComposition, resolveRows } from './load.js'

const EXIT_OK = 0
const EXIT_FINDINGS = 1
const EXIT_USAGE = 2
const EXIT_UNAVAILABLE = 3

/**
 * Terminal output stays readable: a profile that mounts 80 rows pinned to the
 * previous build must not print 80 cards. `--json` always carries everything.
 */
const MAX_RENDERED_VERDICTS = 20

interface Flags {
  readonly json: boolean
  readonly all: boolean
  readonly strict: boolean
  readonly execute: boolean
  readonly dshHome: string | null
  readonly profile: string
  readonly stamp: string | null
  readonly locale: Locale
  /** Keep absolute paths in `--json` output (default: redact to `~`). */
  readonly noRedact: boolean
  /** Runtime inventory snapshot (`pluginInventory/list` export) to judge phases from. */
  readonly snapshot: string | null
  /** `check --explain`: print the registry tag facts a verdict rested on. */
  readonly explain: boolean
}

interface Parsed {
  readonly command: string
  readonly positionals: readonly string[]
  readonly flags: Flags
}

const HELP = `dsh-triage — the judgment layer for DeepSeek Harness plugins

Usage
  dsh-triage env                     environment fingerprint
  dsh-triage why                     why did a plugin silently disappear?
  dsh-triage check <pkg[@version]>   judge a candidate before installing
  dsh-triage audit                   capability ledger of the installed set
  dsh-triage probe <pkg[@version]>   print an isolated probe plan (dry-run)

Flags
  --json                machine-readable output
  --all                 include findings that are not blocking
  --strict              exit 1 when a conclusion is not "go"
  --profile <name>      profile name (default: web)
  --dsh-home <path>     override $DSH_HOME (default: ~/.dsh)
  --locale <en|zh>      output language (default: zh, or $DSH_TRIAGE_LOCALE)
  --no-redact           keep absolute paths in --json output (default: redact to ~)
  --stamp <iso>         fixed timestamp for reproducible output
  --snapshot <file>     (audit) judge runtime phases from a pluginInventory snapshot
  --explain             (check) show the registry tag facts behind the verdict
  --execute             (probe) really run the plan — not implemented before M3
  --help                this text

Exit codes: 0 ok · 1 findings (audit always, others only with --strict) · 2 usage · 3 unavailable
`

async function run(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv)
  if (parsed === null) {
    process.stderr.write('invalid arguments; see --help\n')
    return EXIT_USAGE
  }
  const { command, positionals, flags } = parsed

  switch (command) {
    case 'help':
      process.stdout.write(HELP)
      return EXIT_OK
    case 'env':
      return commandEnv(flags)
    case 'why':
      return commandWhy(flags)
    case 'audit':
      return commandAudit(flags)
    case 'check':
      return commandCheck(flags, positionals[0])
    case 'probe':
      return commandProbe(flags, positionals[0])
    default:
      process.stderr.write(`unknown command "${command}"; see --help\n`)
      return EXIT_USAGE
  }
}

/* ------------------------------- commands ------------------------------- */

async function commandEnv(flags: Flags): Promise<number> {
  const env = await requireEnv(flags)
  if (env === null) return EXIT_UNAVAILABLE
  if (flags.json) {
    writeJson({ schema_version: 1, env: safeEnv(flags, env) })
    return EXIT_OK
  }
  process.stdout.write(`dsh        ${env.dsh ?? 'unknown'}\n`)
  process.stdout.write(`node       ${env.node} · ${env.platform}/${env.arch}\n`)
  process.stdout.write(`profile    ${env.profile} (${env.profileDir})\n`)
  process.stdout.write(`bundles    ${env.bundles.length}\n`)
  for (const bundle of env.bundles) process.stdout.write(`  - ${bundle}\n`)
  return EXIT_OK
}

async function commandWhy(flags: Flags): Promise<number> {
  const env = await requireEnv(flags)
  if (env === null) return EXIT_UNAVAILABLE
  const stamp = stampOf(flags)
  const dshHome = resolveDshHome(flags)
  const composition = await loadComposition(env, dshHome)

  const verdicts: Verdict[] = []
  for (const layer of composition.layers) {
    const admission = evaluateAdmission(layer.manifest, env.dsh)
    verdicts.push(
      verdictFromAdmission({
        subject: { name: layer.name, version: layer.version, kind: 'plugin' },
        env,
        admission,
        generatedAt: stamp,
        manifest: layer.manifest,
      }),
    )
  }

  const bannerErrors: string[] = [...composition.errors]
  const claims = collectClaims(composition, bannerErrors)
  const collisions = findEntryIdCollisions(claims)
  verdicts.push(...verdictsFromCollisions({ env, collisions, generatedAt: stamp }))

  // Row-level admission (CASE-11080): upstream disables the *row's module*, not
  // the bundle, so a pinned peer that the new runtime no longer satisfies turns a
  // working profile into a silent one. Bundles alone answered "no denials" here.
  const rows = await resolveRows(env, rowTargets(claims))
  verdicts.push(...verdictsFromRowAdmission({ env, rows, generatedAt: stamp }))

  // Same name, two physical copies (Maven `dependencyConvergence` logic): the
  // silent variant of CASE-10364, which passes admission and breaks at call time.
  const duplicates = await findDuplicateCopies(env)
  verdicts.push(...verdictsFromDuplicateCopies({ env, duplicates, generatedAt: stamp }))

  const findings = verdicts.filter((verdict) => (flags.all ? true : verdict.conclusion !== 'go'))

  if (flags.json) {
    writeJson({
      schema_version: 1,
      command: 'why',
      env: safeEnv(flags, env),
      verdicts: safeVerdicts(flags, findings),
      errors: bannerErrors,
      scanned: { bundles: composition.layers.length, entries: claims.length },
    })
    return exitFor(flags, findings)
  }

  process.stdout.write(
    `scanned ${composition.layers.length} bundles · ${claims.length} loader rows · ${rows.length} import targets · dsh ${env.dsh ?? 'unknown'} · profile ${env.profile}\n`,
  )
  for (const error of bannerErrors) process.stdout.write(`warn  ${error}\n`)
  if (findings.length === 0) {
    process.stdout.write('no denials or collisions found in the declared layer or its rows.\n')
    process.stdout.write('run `dsh-triage audit` to see the capability ledger, or `dsh-triage check <pkg>` before installing.\n')
    return EXIT_OK
  }
  for (const verdict of findings.slice(0, MAX_RENDERED_VERDICTS)) {
    process.stdout.write(`${renderVerdict(verdict, flags.locale)}\n\n`)
  }
  if (findings.length > MAX_RENDERED_VERDICTS) {
    process.stdout.write(
      `… ${findings.length - MAX_RENDERED_VERDICTS} more finding(s); pass --json for the full list.\n`,
    )
  }
  if (findings.some((verdict) => verdict.conclusion === 'unknown')) {
    process.stdout.write(
      'note  "unknown" means there is no @deepseek-ai/dsh* peer range to judge; if the plugin also publishes dsh.compatibility, the reason lines above name that channel (secondary evidence only).\n',
    )
  }
  return exitFor(flags, findings)
}

async function commandCheck(flags: Flags, spec: string | undefined): Promise<number> {
  if (spec === undefined || spec.trim() === '') {
    process.stderr.write('usage: dsh-triage check <pkg[@version]>\n')
    return EXIT_USAGE
  }
  const env = await requireEnv(flags)
  if (env === null) return EXIT_UNAVAILABLE
  const stamp = stampOf(flags)
  const { name, version } = splitSpec(spec)

  const packument = await fetchPackument(name, { at: stamp })
  if (!packument.ok) {
    process.stderr.write(`cannot read ${name} from npm: ${packument.error.code} (${packument.error.detail})\n`)
    return EXIT_UNAVAILABLE
  }

  const targetVersion = version ?? packument.value.latest
  if (targetVersion === null) {
    process.stderr.write(`npm has no resolvable version for ${name}\n`)
    return EXIT_UNAVAILABLE
  }
  const manifest = packument.value.versions.get(targetVersion)
  if (manifest === undefined) {
    process.stderr.write(`npm has no version ${targetVersion} for ${name} (known versions: ${packument.value.versions.size})\n`)
    return EXIT_UNAVAILABLE
  }

  const admission = evaluateAdmission(manifest, env.dsh)
  // Registry facts (T-109 / CASE-10849): the tag decides which build `install <name>`
  // gets, so judge it before the declaration layer has a chance to deny a stale copy.
  const drift = judgeVersionDrift({
    latest: packument.value.latest,
    next: packument.value.distTags['next'] ?? null,
    versions: [...packument.value.versions.keys()],
    publishedAt: packument.value.publishedAt,
    // A deprecated build must never be recommended as "the newer one".
    deprecated: [...packument.value.versions.values()]
      .filter((manifest) => manifest.deprecated !== undefined)
      .map((manifest) => manifest.version),
  })
  const verdict = verdictFromAdmission({
    subject: { name, version: targetVersion, kind: 'plugin' },
    env,
    admission,
    generatedAt: stamp,
    manifest,
    registryDrift: drift,
    rangeAdvice: true,
  })

  if (flags.json) {
    writeJson({
      schema_version: 1,
      command: 'check',
      verdict: safeVerdicts(flags, [verdict])[0],
      admission,
      registry: {
        dist_tags: packument.value.distTags,
        published_at_newest: drift.newestPublishedAt,
        drift: {
          latest: drift.latest,
          next: drift.next,
          newest: drift.newest,
          newest_stable: drift.newestStable,
          standing: drift.standing,
          detail: drift.detail,
        },
      },
    })
    return exitFor(flags, [verdict])
  }
  process.stdout.write(`${renderVerdict(verdict, flags.locale)}\n`)
  if (flags.explain) {
    process.stdout.write(`${renderRegistryExplain(drift, flags.locale)}\n`)
  }
  if (admission.status === 'admitted') {
    process.stdout.write('note  declaration passes; runtime behaviour is still unproven (probe lands in M3).\n')
  }
  return exitFor(flags, [verdict])
}

/**
 * `check --explain`: the registry facts a user cannot see otherwise.
 *
 * WHY: "install a build whose declaration admits 0.2.1-rc.2" is useless advice when
 * the `latest` tag never points at such a build — the user has to know which version
 * to name explicitly. This block answers that, and only that.
 */
function renderRegistryExplain(drift: VersionDrift, locale: Locale): string {
  const catalog = catalogFor(locale)
  const message = (id: string, params?: Record<string, string>): string => {
    const template = catalog.messages[id]
    return template === undefined ? `?${id}` : format(template, params)
  }
  const published = drift.newestPublishedAt === null ? ' (publish date unknown)' : ` (published ${drift.newestPublishedAt.slice(0, 10)})`
  const params = { latest: drift.latest ?? '—', next: drift.next ?? '—', newest: drift.newest ?? '—', published }
  const lines = [`explain  ${message('registry.tags', params)}`]
  const driftId =
    drift.standing === 'latest-behind'
      ? 'registry.latest-behind'
      : drift.standing === 'prerelease-ahead'
        ? 'registry.prerelease-ahead'
        : drift.standing === 'latest-missing'
          ? 'registry.latest-missing'
          : drift.standing === 'latest-unpublished'
            ? 'registry.latest-unpublished'
            : drift.standing === 'latest-deprecated'
              ? 'registry.latest-deprecated'
              : drift.standing === 'unknown'
                ? 'registry.drift-unknown'
                : 'registry.drift-none'
  lines.push(`explain  ${message(driftId, { ...params, detail: drift.detail })}`)
  return lines.join('\n')
}

/** One line that says how a preset differs from "everything in it is running". */
function countPresetRows(preset: InventoryPreset): string {
  let active = 0
  let disabled = 0
  let conditional = 0
  let other = 0
  for (const row of preset.rows) {
    if (row.enabled === 'conditional') conditional += 1
    else if (row.enabled === false) disabled += 1
    else if (row.fiberPhase === 'active') active += 1
    else other += 1
  }
  return `${active} active · ${disabled} disabled · ${conditional} conditional · ${other} other`
}

async function commandAudit(flags: Flags): Promise<number> {
  const env = await requireEnv(flags)
  if (env === null) return EXIT_UNAVAILABLE
  const dshHome = resolveDshHome(flags)
  const composition = await loadComposition(env, dshHome)
  const claims = collectClaims(composition, [])
  const presetDeclarations = collectPresetDeclarations(composition, [])
  const grouped = groupClaimsBySource(claims)
  const collisions = findEntryIdCollisions(claims)
  const artifacts = await discoverLocalArtifacts({ root: env.profileDir })
  const duplicates = await findDuplicateCopies(env)
  const duplicateFindings = duplicates.filter((duplicate) => duplicate.kind === 'different-versions')
  // Resolving rows here is what lets `audit` answer "who put this copy here" for
  // every row, not only for the denied ones (R8 adversary finding F11).
  const auditRows = await resolveRows(env, rowTargets(claims))
  // T-105: `why` and `audit` must reach the SAME row-level admission conclusion. They
  // already resolved the same rows from the same layers; only `why` judged them, so the
  // two commands could disagree about the same profile without anyone noticing.
  const rowVerdicts = verdictsFromRowAdmission({ env, rows: auditRows, generatedAt: stampOf(flags) })
  const rowConclusion = new Map(
    rowVerdicts.map((verdict) => [verdict.subject.name, verdict.conclusion] as const),
  )

  /* --------------------------- runtime inventory --------------------------- */

  let snapshot: InventorySnapshot | null = null
  let inventoryVerdicts: readonly Verdict[] = []
  let diff: {
    readonly missing: readonly { entryId: string; module: string | null }[]
    readonly undeclared: readonly InventorySnapshot['entries'][number][]
    readonly ambiguous: readonly { readonly entryId: string; readonly candidates: readonly string[] }[]
  } = {
    missing: [],
    undeclared: [],
    ambiguous: [],
  }
  const declared = claims.map((claim) => ({ entryId: claim.id, module: claim.name }))

  if (flags.snapshot !== null) {
    const source = flags.noRedact ? flags.snapshot : redactPath(flags.snapshot, [homedir(), resolveDshHome(flags), tmpdir()])
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(flags.snapshot, 'utf8'))
    } catch (error) {
      process.stderr.write(`cannot read snapshot ${source}: ${error instanceof Error ? error.message : String(error)}\n`)
      return EXIT_UNAVAILABLE
    }
    const parsed = parseInventorySnapshot(raw, { source, sampledAt: stampOf(flags), profile: env.profile })
    if (!parsed.ok) {
      // A renamed upstream field must fail loudly: silently dropping the layer
      // would turn "I could not read the phases" into "no problems found".
      process.stderr.write(`snapshot rejected: ${parsed.error.code} — ${parsed.error.detail}\n`)
      return EXIT_UNAVAILABLE
    }
    snapshot = parsed.value
    inventoryVerdicts = verdictsFromInventory({ env, snapshot, declared, generatedAt: stampOf(flags) })
    diff = compareInventory(snapshot, declared)
  }

  if (flags.json) {
    writeJson({
      schema_version: 1,
      command: 'audit',
      env: safeEnv(flags, env),
      claims: [...grouped.entries()].map(([source, list]) => ({ source, entries: list })),
      collisions,
      localArtifacts: artifacts.map((artifact) => ({
        path: artifact.path,
        kind: artifact.kind,
        bytes: artifact.bytes,
        note: artifact.note,
      })),
      duplicates: duplicates.map((duplicate) => ({
        name: duplicate.name,
        kind: duplicate.kind,
        copies: duplicate.copies.map((copy) => ({ scope: copy.scope, path: copy.path, version: copy.version })),
      })),
      preset_declarations: presetDeclarations.map((declaration) => ({
        preset_id: declaration.presetId,
        source: declaration.source,
        row_id: declaration.rowId,
        rows: declaration.rows.length,
        ids: declaration.rows.map((row) => row.id).sort((left, right) => left.localeCompare(right)),
        conditional: declaration.rows.filter((row) => row.enabled === 'conditional').map((row) => row.id),
      })),
      rows: auditRows.map((row) => ({
        row_id: row.rowId,
        module: row.module,
        source: row.source,
        version: row.version,
        declared_by: (row.declaredBy ?? []).map((origin) => ({ name: origin.name, version: origin.version, field: origin.field })),
      })),
      // Same engine as `why`: an e2e test compares these two outputs on one profile.
      row_verdicts: safeVerdicts(flags, rowVerdicts),
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
              declared_without_module: declared.filter((row) => row.module === null).length,
              missing: diff.missing,
              ambiguous: diff.ambiguous,
              undeclared: diff.undeclared.map((entry) => ({
                entry_id: entry.entryId,
                module: entry.moduleName,
                phase: entry.fiberPhase,
              })),
              verdicts: safeVerdicts(flags, inventoryVerdicts),
            },
      errors: composition.errors,
    })
    return collisions.length === 0 &&
      duplicateFindings.length === 0 &&
      inventoryVerdicts.every((verdict) => verdict.conclusion === 'go') &&
      rowVerdicts.every((verdict) => verdict.conclusion === 'go' || verdict.conclusion === 'unknown')
      ? EXIT_OK
      : EXIT_FINDINGS
  }

  process.stdout.write(`capability ledger · dsh ${env.dsh ?? 'unknown'} · profile ${env.profile}\n`)
  for (const [source, list] of grouped) {
    process.stdout.write(`\n${source}  (${list.length} rows)\n`)
    for (const claim of list) {
      const flagsText = [claim.group ? 'group' : null, claim.disabled ? 'disabled' : null].filter(Boolean).join(', ')
      const suffix = flagsText === '' ? '' : `  [${flagsText}]`
      const phase = snapshot === null ? null : snapshot.entries.find((entry) => entry.entryId === claim.id)
      const phaseText =
        phase === undefined || phase === null
          ? ''
          : `  phase=${phase.fiberPhase ?? 'none'}${phase.enabled ? '' : ' (disabled)'}`
      const conclusion = claim.name === null ? undefined : rowConclusion.get(claim.name)
      const verdictText = conclusion === undefined ? '' : `  ${conclusion}`
      process.stdout.write(`  ${claim.id}${claim.name === null ? '' : `  ->  ${claim.name}`}${suffix}${phaseText}${verdictText}\n`)
    }
  }
  // `unknown` is missing evidence, not a defect: `why` does not fail on it either
  // (`exitFor` returns OK unless --strict), and a profile full of modules that declare
  // nothing would otherwise make `audit` exit 1 forever. Blocked/risky still fail.
  const rowFindings = rowVerdicts.filter((verdict) => verdict.conclusion === 'blocked' || verdict.conclusion === 'risky')
  const rowUnknown = rowVerdicts.filter((verdict) => verdict.conclusion === 'unknown')
  process.stdout.write(
    `\nrow admission: ${rowVerdicts.length - rowFindings.length - rowUnknown.length} go · ${rowFindings.length} blocked/risky · ${rowUnknown.length} unknown · same engine as \`why\`\n`,
  )
  for (const verdict of rowFindings.slice(0, MAX_RENDERED_VERDICTS)) {
    process.stdout.write(`${renderVerdict(verdict, flags.locale)}\n\n`)
  }
  if (rowFindings.length > MAX_RENDERED_VERDICTS) {
    process.stdout.write(`… ${rowFindings.length - MAX_RENDERED_VERDICTS} more row finding(s); pass --json for the full list.\n`)
  }
  if (rowUnknown.length > 0) {
    process.stdout.write(
      `${rowUnknown.length} row(s) have no admission evidence (missing.row-module / missing.peer-declaration); they are not counted as failures — pass --json for the list.\n`,
    )
  }
  process.stdout.write(`\ncollisions: ${collisions.length}\n`)
  for (const collision of collisions) {
    process.stdout.write(`  ${collision.id} (${collision.kind}) owners: ${collision.owners.join(', ')}\n`)
  }
  if (artifacts.length > 0) {
    process.stdout.write(`\nlocal artifacts from other tools (${artifacts.length}):\n`)
    for (const artifact of artifacts) {
      process.stdout.write(`  [${artifact.kind}] ${artifact.path} (${artifact.bytes} B) — ${artifact.note}\n`)
    }
  }
  if (duplicates.length > 0) {
    process.stdout.write(`\nduplicate copies (${duplicates.length}):\n`)
    for (const duplicate of duplicates) {
      const versions = [...new Set(duplicate.copies.map((copy) => copy.version ?? 'unknown'))].join(' vs ')
      const marker = duplicate.kind === 'different-versions' ? 'warn' : 'info'
      process.stdout.write(`  ${marker}  ${duplicate.name}  (${versions})\n`)
      for (const copy of duplicate.copies) {
        process.stdout.write(`      ${copy.scope.padEnd(7)} ${copy.path} @ ${copy.version ?? 'unknown'}\n`)
      }
    }
    if (duplicateFindings.length > 0) {
      process.stdout.write(
        '  two physical copies can evaluate module-level state twice (identity split); the declaring plugin should use peerDependencies\n',
      )
    }
  }
  if (snapshot !== null) {
    process.stdout.write(
      `\nruntime inventory · sampled ${snapshot.sampledAt} · transport ${snapshot.transport ?? 'unstated'} · profile ${snapshot.profile ?? 'unknown'} · ${snapshot.entries.length} entries\n`,
    )
    if (snapshot.unknownKeys.length > 0) {
      process.stdout.write(`warn  snapshot has keys this build does not know: ${snapshot.unknownKeys.join(', ')}\n`)
    }
    if (snapshot.presets.length > 0) {
      process.stdout.write(`\nagent presets (${snapshot.presets.length}) — judged per preset, never merged\n`)
      for (const preset of snapshot.presets) {
        if (preset.broken !== null) {
          process.stdout.write(`  ${preset.id}${preset.isDefault ? ' (default)' : ''}  broken: ${preset.broken}\n`)
          continue
        }
        const counts = countPresetRows(preset)
        process.stdout.write(
          `  ${preset.id}${preset.isDefault ? ' (default)' : ''}  ${preset.rows.length} rows · ${counts}\n`,
        )
        for (const row of preset.rows) {
          if (row.enabled === true && row.fiberPhase === 'active') continue
          process.stdout.write(
            `      ${(row.entryId ?? '(no id)').padEnd(28)} ${String(row.enabled).padEnd(12)} phase=${row.fiberPhase ?? 'none'}\n`,
          )
        }
      }
      const divergence = findPresetDivergence(snapshot.presets)
      if (divergence.length > 0) {
        process.stdout.write(`  cross-preset divergence: ${divergence.length} entry/entries\n`)
        for (const item of divergence) process.stdout.write(`    ${item.entryId}  ${item.summary}\n`)
      }
    }
    const withoutModule = declared.filter((row) => row.module === null).length
    if (withoutModule > 0) {
      process.stdout.write(`warn  ${withoutModule} declared row(s) name no module and cannot be attributed to a phase\n`)
    }
    process.stdout.write(`  declared but not in the sample: ${diff.missing.length}\n`)
    for (const row of diff.missing) process.stdout.write(`    ${row.entryId}  ->  ${row.module ?? '(no module)'}\n`)
    if (diff.ambiguous.length > 0) {
      process.stdout.write(`  declared ids matching more than one runtime row: ${diff.ambiguous.length}\n`)
      for (const row of diff.ambiguous) {
        process.stdout.write(`    ${row.entryId}  ->  ${row.candidates.join(', ')}  (not attributed)\n`)
      }
    }
    process.stdout.write(`  in the sample but not declared: ${diff.undeclared.length}\n`)
    for (const entry of diff.undeclared) {
      process.stdout.write(`    ${entry.entryId}  ->  ${entry.moduleName}  phase=${entry.fiberPhase ?? 'none'}\n`)
    }
    if (inventoryVerdicts.length === 0) {
      process.stdout.write('  every sampled entry is either active or transient; no runtime finding.\n')
    } else {
      process.stdout.write('\n')
      for (const verdict of inventoryVerdicts.slice(0, MAX_RENDERED_VERDICTS)) {
        process.stdout.write(`${renderVerdict(verdict, flags.locale)}\n\n`)
      }
      if (inventoryVerdicts.length > MAX_RENDERED_VERDICTS) {
        process.stdout.write(
          `… ${inventoryVerdicts.length - MAX_RENDERED_VERDICTS} more finding(s); pass --json for the full list.\n`,
        )
      }
    }
  }
  return collisions.length === 0 &&
    duplicateFindings.length === 0 &&
    inventoryVerdicts.every((verdict) => verdict.conclusion === 'go') &&
    rowVerdicts.every((verdict) => verdict.conclusion === 'go' || verdict.conclusion === 'unknown')
    ? EXIT_OK
    : EXIT_FINDINGS
}

async function commandProbe(flags: Flags, spec: string | undefined): Promise<number> {
  if (spec === undefined || spec.trim() === '') {
    process.stderr.write('usage: dsh-triage probe <pkg[@version]>\n')
    return EXIT_USAGE
  }
  const dshHome = resolveDshHome(flags)
  const plan = buildProbePlan({
    candidate: spec,
    realDshHome: dshHome,
    workRoot: join(tmpdir(), 'dsh-triage-probe'),
    profile: flags.profile,
  })
  if (!plan.ok) {
    process.stderr.write(`cannot build a safe probe plan: ${plan.error.code} (${plan.error.detail})\n`)
    return EXIT_UNAVAILABLE
  }

  if (flags.json) {
    writeJson({ schema_version: 1, command: 'probe', dryRun: !flags.execute, plan: plan.value })
  } else {
    process.stdout.write(`probe plan (dry-run) for ${plan.value.candidate}\n`)
    process.stdout.write(`sandbox   DSH_HOME=${plan.value.sandboxHome}\n`)
    process.stdout.write(`port      ${plan.value.port}\n`)
    for (const step of plan.value.steps) {
      process.stdout.write(`  ${step.id.padEnd(14)} ${step.argv.join(' ')}\n`)
      process.stdout.write(`  ${''.padEnd(14)} ${step.note}\n`)
    }
    process.stdout.write('assertions\n')
    for (const assertion of plan.value.assertions) {
      process.stdout.write(`  - ${assertion.id}: ${assertion.expect}\n`)
    }
    for (const warning of plan.value.warnings) process.stdout.write(`warn  ${warning}\n`)
  }

  if (flags.execute) {
    process.stderr.write('execution is not implemented before M3; the plan above is what would run\n')
    return EXIT_UNAVAILABLE
  }
  return EXIT_OK
}

/* -------------------------------- helpers -------------------------------- */

async function requireEnv(flags: Flags): Promise<EnvFingerprint | null> {
  const result = await loadEnv({ dshHome: resolveDshHome(flags), profile: flags.profile })
  if (!result.ok) {
    process.stderr.write(`cannot read the profile: ${result.error.code} — ${result.error.detail}\n`)
    if (result.error.code === 'profile-not-found') {
      process.stderr.write('hint: pass --dsh-home <path> or --profile <name>\n')
    }
    return null
  }
  return result.value
}

function resolveDshHome(flags: Flags): string {
  if (flags.dshHome !== null) return flags.dshHome
  return loadEnvDefaultHome()
}

/** Kept as a function so tests can stub the default home without touching env.ts. */
function loadEnvDefaultHome(): string {
  const configured = process.env['DSH_HOME']
  if (configured !== undefined && configured.trim() !== '') return configured
  return join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? process.cwd(), '.dsh')
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

function exitFor(flags: Flags, verdicts: readonly Verdict[]): number {
  if (!flags.strict) return EXIT_OK
  return verdicts.some((verdict) => !isGo(verdict.conclusion)) ? EXIT_FINDINGS : EXIT_OK
}

function isGo(conclusion: Conclusion): boolean {
  return conclusion === 'go'
}

function splitSpec(spec: string): { readonly name: string; readonly version: string | null } {
  const trimmed = spec.trim()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return { name: trimmed, version: null }
  return { name: trimmed.slice(0, at), version: trimmed.slice(at + 1) || null }
}

function stampOf(flags: Flags): string {
  if (flags.stamp !== null) return flags.stamp
  return new Date().toISOString()
}

function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

/**
 * JSON output is meant to be pasted into issues, so it is redacted by default.
 * Text output keeps real paths (local display only); `--no-redact` opts out.
 */
function safeEnv(flags: Flags, env: EnvFingerprint): EnvFingerprint {
  if (flags.noRedact) return env
  return redactEnv(env, [homedir(), resolveDshHome(flags)])
}

function safeVerdicts(flags: Flags, verdicts: readonly Verdict[]): readonly Verdict[] {
  if (flags.noRedact) return verdicts
  const roots = [homedir(), resolveDshHome(flags)]
  return verdicts.map((verdict) => redactVerdict(verdict, roots))
}

function parseArgs(argv: readonly string[]): Parsed | null {
  const positionals: string[] = []
  let json = false
  let all = false
  let strict = false
  let execute = false
  let help = false
  let dshHome: string | null = null
  let profile = 'web'
  let stamp: string | null = null
  let locale: Locale = defaultLocale()
  let noRedact = false
  let snapshot: string | null = null
  let explain = false

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) break
    if (!token.startsWith('-')) {
      positionals.push(token)
      continue
    }
    const [flag, inline] = splitFlag(token)
    const takeValue = (): string | null => {
      if (inline !== null) return inline
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('-')) return null
      index += 1
      return next
    }
    switch (flag) {
      case '--json':
        json = true
        break
      case '--all':
        all = true
        break
      case '--strict':
        strict = true
        break
      case '--execute':
        execute = true
        break
      case '--no-redact':
        noRedact = true
        break
      case '--explain':
        explain = true
        break
      case '--help':
      case '-h':
        help = true
        break
      case '--dsh-home': {
        const value = takeValue()
        if (value === null) return null
        dshHome = value
        break
      }
      case '--profile': {
        const value = takeValue()
        if (value === null) return null
        profile = value
        break
      }
      case '--stamp': {
        const value = takeValue()
        if (value === null) return null
        stamp = value
        break
      }
      case '--snapshot': {
        const value = takeValue()
        if (value === null) return null
        snapshot = value
        break
      }
      case '--locale': {
        const value = takeValue()
        if (value !== 'en' && value !== 'zh') return null
        locale = value
        break
      }
      default:
        return null
    }
  }

  const flags = { json, all, strict, execute, dshHome, profile, stamp, locale, noRedact, snapshot, explain }
  if (help) return { command: 'help', positionals: [], flags }
  const command = positionals.shift() ?? 'help'
  return { command, positionals, flags }
}

function splitFlag(token: string): readonly [string, string | null] {
  const eq = token.indexOf('=')
  if (eq === -1) return [token, null]
  return [token.slice(0, eq), token.slice(eq + 1)]
}

function defaultLocale(): Locale {
  const configured = process.env['DSH_TRIAGE_LOCALE']
  if (configured === 'en' || configured === 'zh') return configured
  return 'zh'
}

const code = await run(process.argv.slice(2))
process.exitCode = code
