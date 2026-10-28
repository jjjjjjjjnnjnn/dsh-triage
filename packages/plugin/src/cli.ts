#!/usr/bin/env node
/**
 * `dsh-triage` CLI.
 *
 * Commands (M0 surface):
 *   env                 print the environment fingerprint a verdict would rest on
 *   why                 attribute "installed but nothing happened" / "tools vanished"
 *   check <pkg[@ver]>   judge a candidate before install (declaration layer)
 *   audit               capability ledger: entry ids, owners, collisions, local evidence
 *   probe <pkg[@ver]>   plan (dry-run) or run an isolated boot probe for a candidate
 *
 * Exit codes: 0 ok · 1 findings (audit always, others only with --strict) · 2 usage · 3 unavailable
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
import { buildProbePlan, executeProbe, findFreePort, judgeProbe, probeVerdict } from '@dsh-triage/probe'
import { discoverLocalArtifacts, fetchPackument } from '@dsh-triage/signals'
import {
  auditExitOutcome,
  auditJsonPayload,
  auditRedactRoots,
  loadAuditData,
  redactedEnv,
  redactedVerdicts,
} from './audit-data.js'
import { renderBadge, summarizeEvidence, type ProbeRecord } from './badge.js'
import { findDuplicateCopies, loadComposition, resolveRows } from './load.js'
import {
  candidatePackageName,
  normalizeCandidateSpec,
  probeScratchRoot,
  realDshHomeOf,
  realProbeDeps,
  sandboxBundles,
} from './probe-run.js'
import { startPanel, type AuditSnapshot } from './serve.js'

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
  /** `probe --execute`: the DSH launcher entry to run inside the sandbox. */
  readonly dshMain: string | null
  /** `probe --execute --no-http`: the profile serves no web surface; skip readiness. */
  readonly noHttp: boolean
  /** `probe --execute --browser <path>`: Chromium-family binary for the render check (T-302). */
  readonly browser: string | null
  /** `serve --port <n>`: 0 picks a free port. */
  readonly port: number | null
  /** `serve --results <dir>`, `badge --results <dir>`: where the panel/command reads artifacts from. */
  readonly results: string | null
  /** `badge --out <file>`: write the SVG to a file instead of stdout. */
  readonly out: string | null
  /** `serve --allow-execute`: enable actions (still 501 today; the flag is the gate). */
  readonly allowExecute: boolean
  /** `serve --audit`: expose `GET /api/audit` (read-only; off by default, and 501 when off). */
  readonly audit: boolean
  /** `probe --execute --readiness-timeout <ms>`: budget for a settled tree (R17). */
  readonly readinessTimeoutMs: number | null
  /** `probe --execute --unsettled-timeout <ms>`: window for a tree still composing (R17). */
  readonly unsettledReadinessMs: number | null
  /**
   * `probe --copy-profile <name>`: measure the candidate inside a copy of this profile's
   * declarations instead of an empty template profile (T-304).
   */
  readonly copyProfile: string | null
  /** Whether `--profile` was passed (the `web` default is not an explicit choice). */
  readonly profileExplicit: boolean
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
  dsh-triage serve                   open a read-only local evidence panel (127.0.0.1)
  dsh-triage badge <pkg[@version]>   shields-style SVG rendered from recorded evidence
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
  --execute             (probe) really run the plan inside an isolated DSH_HOME
  --dsh-main <path>     (probe --execute) DSH launcher entry the sandbox boots
  --no-http             (probe --execute) profile serves no web surface; skip readiness
  --browser <path>      (probe --execute) Chromium-family binary for the render check (T-302)
  --readiness-timeout <ms>  (probe --execute) readiness budget for a settled tree (default 5000)
  --unsettled-timeout <ms>  (probe --execute) readiness window while the tree is still composing (default 20000)
  --copy-profile <name> (probe) measure inside a copy of this profile's declarations (T-304)
  --port <n>            (serve) port to bind on 127.0.0.1; 0 picks a free one
  --results <dir>       (serve, badge) directory of evidence to read (default: ./data/results)
  --out <file>          (badge) write the SVG here instead of stdout
  --allow-execute       (serve) enable actions; without it the panel is read-only
  --audit               (serve) expose GET /api/audit (current composition, same engine as the CLI)
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
    case 'badge':
      return commandBadge(flags, positionals[0])
    case 'serve':
      return commandServe(flags)
    default:
      process.stderr.write(`unknown command "${command}"; see --help\n`)
      return EXIT_USAGE
  }
}

/* ------------------------------- commands ------------------------------- */

/** Split `name@version`, keeping scoped names (`@scope/name@1.2.3`) intact. */
function splitSubject(subject: string): { name: string; version: string | null } {
  const at = subject.lastIndexOf('@')
  if (at <= 0) return { name: subject, version: null }
  return { name: subject.slice(0, at), version: subject.slice(at + 1) }
}

/**
 * `badge <pkg[@ver]>`: render what the recorded evidence already says (T-402).
 *
 * Reads only `probe-*.json` artifacts from the evidence directory — never the network, never the
 * registry — so a badge cannot claim something no run measured. `not measured` is a first-class
 * answer: an author with no evidence gets a grey badge and a pointer to `dsh-triage probe`.
 */
async function commandBadge(flags: Flags, subject: string | undefined): Promise<number> {
  if (subject === undefined) {
    process.stderr.write('usage: dsh-triage badge <pkg[@version]> [--results <dir>] [--out <file>] [--json]\n')
    return EXIT_USAGE
  }
  const { name, version } = splitSubject(subject)
  const resultsDir = flags.results === null ? resolve('data', 'results') : resolve(flags.results)
  const records: { artifact: string; payload: ProbeRecord }[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(resultsDir)
  } catch {
    process.stderr.write(`no evidence directory at ${resultsDir}\n`)
    return EXIT_UNAVAILABLE
  }
  for (const entry of entries) {
    if (!entry.startsWith('probe-') || !entry.endsWith('.json')) continue
    try {
      const payload = JSON.parse(readFileSync(join(resultsDir, entry), 'utf8')) as ProbeRecord
      // `--version` narrows the choice; without it the newest usable run wins.
      if (version !== null) {
        const resolvedVersion = payload.candidate?.resolved?.version
        if (typeof resolvedVersion === 'string' && resolvedVersion !== version) continue
        if (typeof resolvedVersion !== 'string') continue
      }
      records.push({ artifact: entry, payload })
    } catch {
      // A half-written artifact must not break the badge; it simply contributes no evidence.
    }
  }
  const evidence = summarizeEvidence(name, records)
  const svg = renderBadge(evidence)
  if (flags.json) {
    writeJson({
      schema_version: 1,
      command: 'badge',
      subject: { name, version },
      evidence,
      svg_sha256: createHash('sha256').update(svg).digest('hex'),
      svg,
    })
    return EXIT_OK
  }
  if (flags.out !== null) {
    writeFileSync(flags.out, svg, 'utf8')
    process.stdout.write(`wrote ${flags.out} (${evidence.conclusion ?? 'not measured'})\n`)
    return EXIT_OK
  }
  process.stdout.write(svg)
  return EXIT_OK
}

async function commandEnv(flags: Flags): Promise<number> {  const env = await requireEnv(flags)
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
  // T-406: the collection lives in `audit-data.ts` so `serve` can show the same object.
  // The text and JSON below are byte-for-byte what they were before the extraction.
  const loaded = await loadAuditData({
    env,
    dshHome,
    stamp: stampOf(flags),
    snapshotPath: flags.snapshot,
    noRedact: flags.noRedact,
  })
  if (!loaded.ok) {
    process.stderr.write(`${loaded.message}\n`)
    return EXIT_UNAVAILABLE
  }
  const data = loaded.data
  const { grouped, collisions, artifacts, duplicates, duplicateFindings, snapshot, diff, rowVerdicts, inventoryVerdicts, declared } = data
  const rowConclusion = new Map(
    rowVerdicts.map((verdict) => [verdict.subject.name, verdict.conclusion] as const),
  )

  if (flags.json) {
    writeJson(auditJsonPayload(data, { noRedact: flags.noRedact, roots: auditRedactRoots(dshHome) }))
    return auditExitOutcome(data) === 'ok' ? EXIT_OK : EXIT_FINDINGS
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
  return auditExitOutcome(data) === 'ok' ? EXIT_OK : EXIT_FINDINGS
}

async function commandProbe(flags: Flags, spec: string | undefined): Promise<number> {
  if (spec === undefined || spec.trim() === '') {
    process.stderr.write('usage: dsh-triage probe <pkg[@version]>\n')
    return EXIT_USAGE
  }
  // The plan is built against the REAL home only to prove the sandbox is disjoint from it;
  // nothing here reads or writes `~/.dsh`.
  const dshHome = realDshHomeOf(flags.dshHome)
  const candidate = normalizeCandidateSpec(spec)
  // R17: the plan's port is a hash, and this machine excludes TCP 53461-53560, so the
  // sandbox webserver died with EACCES on 53506 and the candidate was blamed for it. Ask the
  // OS for a port it will actually hand out instead of trusting the digest.
  const freePort = await findFreePort()
  const plan = buildProbePlan({
    candidate,
    realDshHome: dshHome,
    workRoot: probeScratchRoot(),
    ...(flags.profileExplicit ? { profile: flags.profile } : {}),
    ...(flags.copyProfile === null ? {} : { copyProfile: flags.copyProfile }),
    dshBin: flags.dshMain ?? 'dsh',
    ...(freePort === null ? {} : { basePort: freePort }),
  })
  if (!plan.ok) {
    process.stderr.write(`cannot build a safe probe plan: ${plan.error.code} (${plan.error.detail})\n`)
    return plan.error.code === 'invalid-profile' ? EXIT_USAGE : EXIT_UNAVAILABLE
  }

  // T-304: a copy of a profile that is not there is a usage error, not a measurement. Refusing
  // here also stops a dry-run from advertising a composition that cannot be copied.
  const profileSource = plan.value.profileSource
  if (profileSource !== null && !existsSync(join(profileSource.dir, 'package.json'))) {
    process.stderr.write(
      `profile "${profileSource.name}" has no package.json at ${profileSource.dir}; nothing to copy (check --dsh-home and the profile name)\n`,
    )
    return EXIT_USAGE
  }

  if (!flags.execute) {
    if (flags.json) {
      writeJson({ schema_version: 1, command: 'probe', dryRun: true, plan: plan.value })
    } else {
      process.stdout.write(`probe plan (dry-run) for ${plan.value.candidate}\n`)
      process.stdout.write(`sandbox   DSH_HOME=${plan.value.sandboxHome}\n`)
      process.stdout.write(`profile   ${plan.value.profile}\n`)
      // T-304: the composition is part of the plan, so the dry-run says which one it is.
      process.stdout.write(
        `origin    ${plan.value.profileOrigin}${plan.value.profileSource === null ? ' (launcher template)' : ` ← ${plan.value.profileSource.dir}`}\n`,
      )
      process.stdout.write(`port      ${plan.value.port}\n`)
      for (const step of plan.value.steps) {
        process.stdout.write(`  ${step.id.padEnd(14)} ${step.argv.join(' ')}\n`)
        process.stdout.write(`  ${''.padEnd(14)} ${step.note}\n`)
      }
      process.stdout.write('assertions\n')
      for (const assertion of plan.value.assertions) {
        process.stdout.write(
          `  - ${assertion.id}${assertion.measured ? '' : ' (not measured by M3)'}: ${assertion.expect}\n`,
        )
      }
      for (const warning of plan.value.warnings) process.stdout.write(`warn  ${warning}\n`)
      process.stdout.write('note  dry-run: nothing was spawned; pass --execute --dsh-main <path> to run it\n')
    }
    return EXIT_OK
  }

  if (flags.dshMain === null) {
    process.stderr.write('probe --execute needs --dsh-main <path to @deepseek-ai/dsh/lib/bin.js>\n')
    return EXIT_USAGE
  }
  const candidatePackage = candidatePackageName(spec)
  if (candidatePackage === null) {
    process.stderr.write(
      `cannot determine which package "${spec}" installs as; the probe matches rows by module name\n`,
    )
    return EXIT_USAGE
  }

  const stamp = stampOf(flags)
  // The sandbox is deleted by `executeProbe`'s cleanup, so the composition this run measured
  // has to be read from the SOURCE before anything runs (T-304). Bundle names are declarations,
  // not secrets; the source directory itself never enters an unredacted artifact.
  const measuredBundles =
    plan.value.profileSource === null ? [] : sandboxBundles(plan.value.profileSource.dir)
  const run = await executeProbe(
    { plan: plan.value, dshMain: flags.dshMain, candidatePackage, ...(flags.noHttp ? { skipHttp: true } : {}) },
    realProbeDeps({
      baseEnv: process.env,
      ...(flags.browser === null ? {} : { browser: flags.browser }),
      ...(flags.readinessTimeoutMs === null ? {} : { readinessTimeoutMs: flags.readinessTimeoutMs }),
      ...(flags.unsettledReadinessMs === null ? {} : { unsettledReadinessMs: flags.unsettledReadinessMs }),
    }),
  )
  const judgement = judgeProbe({ run, at: stamp })
  const env: EnvFingerprint = {
    dsh: run.runtimeVersion,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    profile: plan.value.profile,
    profileDir: plan.value.sandboxProfileDir,
    bundles: measuredBundles.length > 0 ? measuredBundles : sandboxBundles(plan.value.sandboxProfileDir),
    installed: [],
  }
  const verdict = probeVerdict({ run, judgement, env, at: stamp })
  const roots = [homedir(), dshHome, probeScratchRoot()]

  if (flags.json) {
    writeJson({
      schema_version: 1,
      command: 'probe',
      dryRun: false,
      candidate: { spec, package: candidatePackage },
      // T-304: which composition was measured, and whether its declarations could be copied
      // and installed at all. A copy that never became usable can only be `unknown`.
      profile: {
        origin: run.profileOrigin,
        source: run.profileSourceDir === null ? null : redactPath(run.profileSourceDir, roots),
        copy:
          run.profileCopy === null
            ? null
            : {
                files: [...run.profileCopy.copied],
                missing: [...run.profileCopy.missing],
                install: run.profileCopy.install,
                dangling_links: run.profileCopy.danglingLinks.map((link) => ({
                  name: link.name,
                  spec: link.spec,
                  target: redactPath(link.target, roots),
                })),
              },
      },
      steps: run.steps,
      timings: run.timings,
      assertions: judgement.assertions,
      verdict: flags.noRedact ? verdict : redactVerdict(verdict, roots),
    })
  } else {
    process.stdout.write(`probe ${candidatePackage} · sandbox DSH_HOME=${plan.value.sandboxHome}\n`)
    process.stdout.write(`profile   ${run.profileOrigin}\n`)
    for (const step of run.steps) {
      const mark = step.status === 'passed' ? 'ok  ' : step.status === 'skipped' ? 'skip' : 'FAIL'
      process.stdout.write(`  ${mark} ${step.id.padEnd(10)} ${String(step.ms).padStart(6)}ms  ${step.detail ?? ''}\n`)
    }
    process.stdout.write('assertions\n')
    for (const assertion of judgement.assertions) {
      process.stdout.write(`  ${assertion.status.padEnd(10)} ${assertion.id}${assertion.detail === null ? '' : `  (${assertion.detail})`}\n`)
    }
    process.stdout.write('\n')
    process.stdout.write(`${renderVerdict(verdict, flags.locale)}\n`)
    process.stdout.write('note  this proves boot + HTTP + row phase only; it is not a security or feature verdict\n')
  }

  return verdict.conclusion === 'blocked' || verdict.conclusion === 'risky' ? EXIT_FINDINGS : EXIT_OK
}

/**
 * `serve` — the local evidence panel (M4 form A). Read-only unless `--allow-execute` was
 * passed, and even then this version answers 501 for actions: the flag is the gate, not a
 * promise. The URL carries a one-time token and is the only way in.
 */
async function commandServe(flags: Flags): Promise<number> {
  const resultsDir = flags.results === null ? resolve(process.cwd(), 'data/results') : resolve(flags.results)
  const dshHome = resolveDshHome(flags)
  // T-406: `--audit` is explicit. Without it the panel still works (artifacts only) and
  // `/api/audit` answers 501 — the panel never silently "reads nothing" and calls it clean.
  const audit = flags.audit
    ? async (): Promise<AuditSnapshot> => {
        const loadedEnv = await loadEnv({ dshHome, profile: flags.profile })
        if (!loadedEnv.ok) {
          return { ok: false, message: `cannot read the profile: ${loadedEnv.error.code} — ${loadedEnv.error.detail}` }
        }
        const loaded = await loadAuditData({
          env: loadedEnv.value,
          dshHome,
          // The panel answers "what is true now", so the stamp is the request time; the CLI
          // keeps `--stamp` for reproducible output.
          stamp: new Date().toISOString(),
          snapshotPath: null,
          noRedact: false,
        })
        if (!loaded.ok) return { ok: false, message: loaded.message }
        return {
          ok: true,
          payload: auditJsonPayload(loaded.data, { noRedact: false, roots: auditRedactRoots(dshHome) }),
        }
      }
    : null
  const panel = await startPanel({
    resultsDir,
    port: flags.port ?? 0,
    allowExecute: flags.allowExecute,
    locale: flags.locale,
    audit,
  })
  const readOnly = !flags.allowExecute
  if (flags.json) {
    writeJson({
      schema_version: 1,
      command: 'serve',
      url: panel.url,
      port: panel.port,
      resultsDir,
      readOnly,
    })
  } else {
    process.stdout.write(`panel   ${panel.url}\n`)
    process.stdout.write(`results ${resultsDir}${existsSync(resultsDir) ? '' : '  (does not exist yet)'}\n`)
    process.stdout.write(`mode    ${readOnly ? 'read-only' : 'actions requested (POST still returns 501)'}\n`)
    process.stdout.write('open the URL above; it carries a one-time token, and the panel binds 127.0.0.1 only\n')
  }
  // Stay in the foreground until the user stops it: a panel that backgrounds itself is a
  // process nobody can find later.
  await new Promise<void>((resolveStop) => {
    const stop = (): void => {
      panel.server.close(() => resolveStop())
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
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
  return redactedEnv(env, { noRedact: false, roots: [homedir(), resolveDshHome(flags)] })
}

function safeVerdicts(flags: Flags, verdicts: readonly Verdict[]): readonly Verdict[] {
  if (flags.noRedact) return verdicts
  const roots = [homedir(), resolveDshHome(flags)]
  return redactedVerdicts(verdicts, { noRedact: false, roots })
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
  /**
   * Was `--profile` actually passed? `probe --copy-profile upstream` must keep the profile
   * named `upstream`, so the default `web` cannot be treated as an explicit choice (T-304).
   */
  let profileExplicit = false
  let stamp: string | null = null
  let locale: Locale = defaultLocale()
  let noRedact = false
  let snapshot: string | null = null
  let explain = false
  let dshMain: string | null = null
  let noHttp = false
  let browser: string | null = null
  let port: number | null = null
  let results: string | null = null
  let out: string | null = null
  let allowExecute = false
  let audit = false
  let readinessTimeoutMs: number | null = null
  let unsettledReadinessMs: number | null = null
  let copyProfile: string | null = null

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
      case '--no-http':
        noHttp = true
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
        profileExplicit = true
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
      case '--dsh-main': {
        const value = takeValue()
        if (value === null) return null
        dshMain = value
        break
      }
      case '--browser': {
        const value = takeValue()
        if (value === null) return null
        browser = value
        break
      }
      case '--port': {
        const value = takeValue()
        if (value === null) return null
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) return null
        port = parsed
        break
      }
      case '--results': {
        const value = takeValue()
        if (value === null) return null
        results = value
        break
      }
      case '--out': {
        const value = takeValue()
        if (value === null) return null
        out = value
        break
      }
      case '--allow-execute':
        allowExecute = true
        break
      case '--audit':
        audit = true
        break
      case '--readiness-timeout': {
        const value = takeValue()
        if (value === null) return null
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) return null
        readinessTimeoutMs = parsed
        break
      }
      case '--unsettled-timeout': {
        const value = takeValue()
        if (value === null) return null
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 300_000) return null
        unsettledReadinessMs = parsed
        break
      }
      case '--copy-profile': {
        const value = takeValue()
        if (value === null) return null
        copyProfile = value
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

  const flags = { json, all, strict, execute, dshHome, profile, stamp, locale, noRedact, snapshot, explain, dshMain, noHttp, browser, port, results, allowExecute, audit, readinessTimeoutMs, unsettledReadinessMs, copyProfile, profileExplicit, out }
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
