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

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'
import {
  catalogFor,
  compareInventory,
  DIST_TAG_PACKAGE,
  distTagTargetOf,
  evaluateAdmission,
  extractEntryClaims,
  extractPresetDeclarations,
  findEntryIdCollisions,
  findPresetDivergence,
  format,
  groupClaimsBySource,
  hasNewDenials,
  judgeUpgradeImpact,
  judgeVersionDrift,
  loadEnv,
  parseInventorySnapshot,
  parsePatchYaml,
  redactEnv,
  redactPath,
  redactVerdict,
  registryFactFor,
  renderUpgradeImpact,
  renderUpgradeCard,
  renderVerdict,
  resolveDistTagTarget,
  rowTargets,
  upgradeTargetProblem,
  verdictFromAdmission,
  verdictsFromCollisions,
  verdictsFromDuplicateCopies,
  verdictsFromInventory,
  verdictsFromRowAdmission,
  type Conclusion,
  type DistTagTarget,
  type EntryClaim,
  type EnvFingerprint,
  type InventorySnapshot,
  type InventoryPreset,
  type PresetDeclaration,
  type Locale,
  type RowDeclaration,
  type UpgradeBundleInput,
  type UpgradeImpact,
  type UpgradeJudgement,
  type UpgradeRegistryFact,
  type UpgradeRegistryFailure,
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
import { buildMarketIndex, entriesFromEvidence, type MeasuredCandidate } from './index-source.js'
import { findDuplicateCopies, loadComposition, resolveRows } from './load.js'
import { readOutcomeConfig, writeOutcomeMode, type OutcomeMode } from './outcomes/config.js'
import { localPriorFor, renderPrior } from './outcomes/prior.js'
import { outcomeStatus, purgeOutcomes, renderPurge, renderStatus } from './outcomes/purge.js'
import { recordOutcomes } from './outcomes/store.js'
import {
  candidatePackageName,
  normalizeCandidateSpec,
  probeScratchRoot,
  realDshHomeOf,
  realProbeDeps,
  sandboxBundles,
} from './probe-run.js'
import { applyExemptionFixes, planFixes, readProfileDependencies, runtimeSupportsExemptions, undoFix } from './fix.js'
import { startPanel, type AuditSnapshot } from './serve.js'
import { buildProfileSummary, formatProfileSummary } from './summary.js'

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
  /** `fix --apply`: actually write. Without it, `fix` only prints the plan. */
  readonly apply: boolean
  /** `fix --undo <journal>`: restore the files a previous apply changed. */
  readonly undo: string | null
  /** `serve --audit`: expose `GET /api/audit` (read-only). On by default since R49. */
  readonly audit: boolean
  /** `serve --no-audit`: serve artifacts only; `/api/audit` answers 501 and says why. */
  readonly noAudit: boolean
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
  /**
   * `check|probe --outcomes off|local` (M5-a): a per-invocation override of the local outcome
   * switch. Never persisted; `null` means "ask `config.json`, default off" (spec §7).
   */
  readonly outcomes: OutcomeMode | null
  /** `outcomes --enable` / `--disable`: write the switch. */
  readonly enable: boolean
  readonly disable: boolean
  /** `outcomes --purge`: delete the local store (works whether or not recording is on). */
  readonly purge: boolean
  /** `outcomes --status`: how many records exist (the default when no verb is given). */
  readonly status: boolean
  /** `upgrade --to <version>`: the runtime to judge the installed composition against. */
  readonly to: string | null
  /** `upgrade --registry`: look up "is there a published build that declares the target?" (off by default). */
  readonly registry: boolean
  /** `upgrade --card`: paste-ready markdown for the release discussion (`docs/specs/M6-upgrade-day.md`). */
  readonly card: boolean
}

interface Parsed {
  readonly command: string
  readonly positionals: readonly string[]
  readonly flags: Flags
}

const HELP = `dsh-triage — the judgment layer for DeepSeek Harness plugins

Usage
  dsh-triage                         one screen: is this profile broken, which row, what to type
  dsh-triage status                  the same answer, as an explicit command
  dsh-triage env                     environment fingerprint
  dsh-triage why                     why did a plugin silently disappear?
  dsh-triage check <pkg[@version]>   judge a candidate before installing
  dsh-triage audit                   the same answer, plus the full ledger with --all
  dsh-triage probe <pkg[@version]>   print an isolated probe plan (dry-run)
  dsh-triage serve                   open the local panel (127.0.0.1, token-gated)
  dsh-triage badge <pkg[@version]>   shields-style SVG rendered from recorded evidence
  dsh-triage index                   format-1 market index of versions measured "go" here
  dsh-triage outcomes                local outcome store: status / --enable / --disable / --purge
  dsh-triage upgrade --to <version>  which rows/bundles the target dsh would deny, and how to fix
  dsh-triage upgrade --to next|latest  same judgement, with the target resolved from npm dist-tags
  dsh-triage fix                     what can be repaired automatically; --apply writes, --undo reverts
Flags
  --json                machine-readable output
  --all                 include findings that are not blocking (audit: print the full ledger)
  --apply               (fix) actually write the plan; without it nothing is written
  --undo <journal>      (fix) restore the files an earlier --apply changed
  --strict              exit 1 when a conclusion is not "go"
  --profile <name>      profile name (default: web)
  --dsh-home <path>     override $DSH_HOME (default: ~/.dsh)
  --locale <en|zh>      output language (default: zh, or $DSH_TRIAGE_LOCALE)
  --no-redact           keep absolute paths in --json output (default: redact to ~)
  --stamp <iso>         fixed timestamp for reproducible output
  --snapshot <file>     (audit) judge runtime phases from a pluginInventory snapshot
  --snapshot <file>     (upgrade) judge a frozen composition snapshot (schema_version 1)
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
  --out <file>          (badge) write the SVG here; (upgrade --card) write the card here, print the path
  --allow-execute       (serve) enable actions; without it the panel is read-only
  --no-audit            (serve) artifacts only; skip reading the current profile
  --audit               (serve) expose GET /api/audit (current composition, same engine as the CLI)
  --outcomes <mode>     (check, probe) record this verdict locally: off | local (per-run, not saved)
  --enable              (outcomes) opt in to the local outcome store
  --disable             (outcomes) opt out again; existing records are kept until --purge
  --purge               (outcomes) delete every record this tool stored, then the directory
  --status              (outcomes) how many records exist (default when no verb is given)
  --to <version>        (upgrade) target dsh: exact semver (e.g. 0.3.0), or next / latest (resolved from npm)
  --registry            (upgrade) annotate with published builds that declare the target (offline by default)
  --card                (upgrade) paste-ready markdown for the release discussion (four buckets + boundary)
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
    case 'status':
      return commandStatus(flags)
    case 'fix':
      return commandFix(flags)
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
    case 'index':
      return commandIndex(flags)
    case 'serve':
      return commandServe(flags)
    case 'outcomes':
      return commandOutcomes(flags)
    case 'upgrade':
      return commandUpgrade(flags)
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

/**
 * `index [--out <file>]`: emit a format-1 market index containing only versions a recorded run
 * reached `go` on (T-403). Needs the registry for per-version publish times, so it is not pure — but
 * it invents nothing: every version and timestamp comes from a probe artifact plus the packument.
 */
async function commandIndex(flags: Flags): Promise<number> {
  const resultsDir = flags.results === null ? resolve('data', 'results') : resolve(flags.results)
  let entries: string[] = []
  try {
    entries = readdirSync(resultsDir)
  } catch {
    process.stderr.write(`no evidence directory at ${resultsDir}\n`)
    return EXIT_UNAVAILABLE
  }
  const records: { artifact: string; payload: MeasuredCandidate }[] = []
  for (const entry of entries) {
    if (!entry.startsWith('probe-') || !entry.endsWith('.json')) continue
    try {
      records.push({ artifact: entry, payload: JSON.parse(readFileSync(join(resultsDir, entry), 'utf8')) as MeasuredCandidate })
    } catch {
      // Half-written artifacts contribute nothing; they never become a version claim.
    }
  }

  // The registry is only asked about candidates that could appear in the index at all.
  const wanted = new Map<string, Set<string>>()
  for (const record of records) {
    const name = record.payload.candidate?.package
    const version = record.payload.candidate?.resolved?.version
    if (typeof name !== 'string' || typeof version !== 'string') continue
    if (record.payload.candidate?.kind !== 'registry' || record.payload.conclusion !== 'go') continue
    const set = wanted.get(name) ?? new Set<string>()
    set.add(version)
    wanted.set(name, set)
  }
  const publishedAt = new Map<string, Record<string, string>>()
  const engineRanges = new Map<string, Record<string, string | null>>()
  const fetchFailures: { package: string; detail: string }[] = []
  let runtime: string | null = null
  for (const [name, versions] of wanted) {
    // The registry read is stamped with the CLI stamp so the evidence line stays reproducible.
    const packument = await fetchPackument(name, { at: stampOf(flags) })
    if (!packument.ok) {
      fetchFailures.push({ package: name, detail: `${packument.error.code} — ${packument.error.detail}` })
      continue
    }
    publishedAt.set(name, { ...packument.value.publishedAt })
    const ranges: Record<string, string | null> = {}
    for (const version of versions) {
      const manifest = packument.value.versions.get(version)
      const engines = manifest === undefined || manifest === null ? null : (manifest.engines as { dsh?: unknown } | undefined)
      ranges[version] = engines !== undefined && engines !== null && typeof engines.dsh === 'string' ? engines.dsh : null
    }
    engineRanges.set(name, ranges)
  }
  // The runtime the evidence was measured against (newest recorded run wins; it is one sandbox version).
  for (const record of records) {
    const version = record.payload.runtime?.version
    if (typeof version === 'string' && (runtime === null || version > runtime)) runtime = version
  }

  const built = entriesFromEvidence(
    records,
    (name, version) => {
      const iso = publishedAt.get(name)?.[version]
      if (typeof iso !== 'string') return null
      const milliseconds = Date.parse(iso)
      return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null
    },
    (name, version) => engineRanges.get(name)?.[version] ?? null,
  )
  const { document, skipped } = buildMarketIndex(built.entries, { generatedFor: runtime === null ? undefined : `dsh ${runtime}` })
  const payload = {
    schema_version: 1,
    command: 'index',
    format: 1,
    generated_for: runtime,
    plugins: document.plugins.length,
    versions: document.plugins.reduce((total, plugin) => total + plugin.versions.length, 0),
    skipped,
    excluded: built.excluded,
    fetch_failures: fetchFailures,
    document,
  }
  if (flags.out !== null) {
    writeFileSync(flags.out, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    if (!flags.json) {
      process.stdout.write(
        `wrote ${flags.out} · ${payload.plugins} plugins / ${payload.versions} versions · skipped ${skipped.length} · excluded ${built.excluded.length}\n`,
      )
      return EXIT_OK
    }
  }
  if (!flags.json) {
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`)
    return EXIT_OK
  }
  writeJson(payload)
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

/**
 * `upgrade --to <version>`: which loader rows and bundles the **target** runtime would deny
 * (`T-502`, `docs/specs/M5-upgrade.md`).
 *
 * Same engine, one runtime further: every unit is judged by `evaluateAdmission` with `env.dsh`
 * replaced by the target, and the result is the verdict `why` would print on that runtime.
 * Nothing here re-implements a range, and nothing here claims a boot was measured.
 *
 * NOT DONE ON PURPOSE: no profile edit, no automatic pin, no probe run, and no network unless
 * `--registry` is passed or the target is one of the two dist-tag keywords (`next` / `latest`,
 * M6 C9). Registry facts are annotations that cannot move a unit; a dist-tag only decides which
 * exact version gets judged, and then the same engine judges it.
 */
async function commandUpgrade(flags: Flags): Promise<number> {
  // No target, no judgement (M6 C8): the guidance reports what could be read and never invents
  // a target, a bucket or a verdict.
  if (flags.to === null) return commandUpgradeGuidance(flags)
  const stamp = stampOf(flags)
  // Validate BEFORE reading anything: a bad target must be a usage error whether or not the
  // profile exists, and must never reach `satisfies()` (which returns false for garbage and
  // would turn "bad flag" into "everything will break").
  let target = flags.to.trim()
  let distTag: UpgradeDistTagUse | null = null
  const requestedTag = distTagTargetOf(target)
  if (requestedTag !== null) {
    const resolved = await resolveUpgradeTag(requestedTag, stamp)
    if (resolved === null) return EXIT_UNAVAILABLE
    target = resolved.version
    distTag = resolved
    // stdout stays the report — the card gets pasted in public, so the resolution goes to stderr.
    process.stderr.write(`target   ${distTag.tag} → ${distTag.version} (npm ${DIST_TAG_PACKAGE})\n`)
  }
  const problem = upgradeTargetProblem(target)
  if (problem !== null) {
    process.stderr.write(`${problem}\n`)
    return EXIT_USAGE
  }
  const warnings: string[] = []

  let env: EnvFingerprint
  let bundles: readonly UpgradeBundleInput[]
  let rows: readonly RowDeclaration[]
  let profileSource: 'live' | 'snapshot'

  if (flags.snapshot !== null) {
    const snapshot = readCompositionSnapshot(flags.snapshot)
    if (!snapshot.ok) {
      process.stderr.write(`cannot use composition snapshot ${flags.snapshot}: ${snapshot.detail}\n`)
      return EXIT_USAGE
    }
    // A snapshot names the profile it was taken from; the answer belongs to that name, not to
    // whatever `--profile` says (two profiles, two answers — BS-38).
    env = {
      dsh: snapshot.value.dsh,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      profile: snapshot.value.profile,
      profileDir: `<dsh-home>/profiles/${snapshot.value.profile}`,
      bundles: snapshot.value.bundles.map((bundle) => bundle.name),
      installed: [],
    }
    bundles = snapshot.value.bundles
    rows = snapshot.value.rows
    profileSource = 'snapshot'
  } else {
    // Resolve the home first: a *relative* `--dsh-home` would otherwise produce a relative
    // `profileDir` in the embedded verdicts, which redaction cannot match against an absolute
    // root (and `--json` is meant to be pasted into an issue).
    const dshHome = resolve(resolveDshHome(flags))
    const liveEnv = await requireEnv(flags, dshHome)
    if (liveEnv === null) return EXIT_UNAVAILABLE
    const composition = await loadComposition(liveEnv, dshHome)
    const claims = collectClaims(composition, warnings)
    env = liveEnv
    bundles = composition.layers.map((layer) => ({ name: layer.name, version: layer.version, manifest: layer.manifest }))
    rows = await resolveRows(liveEnv, rowTargets(claims))
    profileSource = 'live'
  }

  // "Nothing sampled" is not a green report: an empty impact list would read as "all fine",
  // so the command refuses to print one.
  if (rows.length === 0 && bundles.length === 0) {
    process.stderr.write(
      `nothing sampled: profile "${env.profile}" has no bundle layer and no loader row, so there is no impact to report\n`,
    )
    for (const warning of warnings) process.stderr.write(`warn  ${warning}\n`)
    return EXIT_UNAVAILABLE
  }

  const input = { env, target, bundles, rows, generatedAt: stamp, profileSource } as const
  const first = judgeUpgradeImpact(input)
  if (!first.ok) {
    process.stderr.write(`${first.detail}\n`)
    return EXIT_USAGE
  }

  // The registry is asked only about units that need a version to move to, and only after the
  // first (offline) judgement has decided which those are.
  let judged: UpgradeJudgement = first
  if (flags.registry) {
    const lookup = await registryLookupFor(first.impact, target, stamp)
    judged = judgeUpgradeImpact({ ...input, registry: lookup.facts, registryFailures: lookup.failures })
    if (!judged.ok) {
      process.stderr.write(`${judged.detail}\n`)
      return EXIT_USAGE
    }
    if (lookup.failures.length > 0) {
      process.stderr.write(`registry: ${lookup.failures.length} lookup(s) failed; the report is unchanged\n`)
    }
  }
  const impact = judged.impact

  if (flags.json) {
    // One output per run (M6 N7): `--json` wins, and the ignored `--card` / `--out` are said out loud
    // rather than dropped silently.
    if (flags.card) process.stderr.write('card: ignored because --json was given (one output per run)\n')
    if (flags.out !== null) process.stderr.write('out: ignored because --json was given (one output per run)\n')
    writeJson(upgradeJsonPayload(impact, distTag))
  } else if (flags.card) {
    const card = renderUpgradeCard(impact, {
      locale: flags.locale,
      redactRoots: [homedir(), flags.dshHome ?? resolveDshHome(flags)],
    })
    if (flags.out === null) {
      process.stdout.write(card)
    } else {
      // M6 C10: the file gets the same bytes a bare `--card` prints, written atomically. Nothing
      // half-written is left behind, and stdout carries only the path a user can copy.
      const written = writeCardFile(flags.out, card)
      if (!written.ok) {
        process.stderr.write(`${written.detail}\n`)
        return written.reason === 'exists' ? EXIT_USAGE : EXIT_UNAVAILABLE
      }
      process.stdout.write(`${written.display}\n`)
    }
    // The card is pasted in public, so warnings go to stderr: a `warn` line inside the markdown would be copied too.
    for (const warning of warnings) process.stderr.write(`warn  ${warning}\n`)
  } else {
    process.stdout.write(renderUpgradeImpact(impact, flags.locale))
    for (const warning of warnings) process.stdout.write(`warn  ${warning}\n`)
  }
  return flags.strict && hasNewDenials(impact) ? EXIT_FINDINGS : EXIT_OK
}

/** What a dist-tag target resolved to, kept so the JSON payload can say where the target came from. */
interface UpgradeDistTagUse {
  readonly tag: DistTagTarget | string
  readonly version: string
}

/**
 * Turn `next` / `latest` into the exact version the registry publishes (`T-806`, M6 C9).
 *
 * Two refusals, both exit 3 and both producing **no bucket**: npm did not answer, or the tag exists
 * but does not name an exact version. Neither is a finding about the user's composition, so neither
 * may be reported as one.
 */
async function resolveUpgradeTag(tag: DistTagTarget, stamp: string): Promise<UpgradeDistTagUse | null> {
  const packument = await fetchPackument(DIST_TAG_PACKAGE, { at: stamp })
  if (!packument.ok) {
    process.stderr.write(
      `cannot resolve --to ${tag}: npm did not answer for ${DIST_TAG_PACKAGE} (${packument.error.code}) — ${packument.error.detail}\n`,
    )
    process.stderr.write('hint: pass the exact version instead — that path never touches the network\n')
    return null
  }
  const resolved = resolveDistTagTarget({ requested: tag, distTags: packument.value.distTags })
  if (!resolved.ok) {
    process.stderr.write(`${resolved.detail}\n`)
    process.stderr.write('hint: pass the exact version instead — that path never touches the network\n')
    return null
  }
  return { tag: resolved.tag, version: resolved.version }
}

/**
 * `upgrade` with no `--to` (`T-807`, M6 C8): say what could be read, and refuse to judge.
 *
 * WHY IT STILL EXITS 2: without a target there is nothing to judge, and an empty report would read
 * as "nothing will break". The guidance is on stderr for the same reason every other usage path is:
 * a non-zero exit must never put a report-shaped thing on stdout.
 *
 * WHY IT READS THE REGISTRY ONCE: "your options are next=X / latest=Z" is the whole point of the
 * guidance (a stranger should not have to guess a version string). That single read is bounded and
 * read-only; when it fails the line says `unknown` and no value is invented.
 */
async function commandUpgradeGuidance(flags: Flags): Promise<number> {
  const catalog = catalogFor(flags.locale)
  const line = (id: string, params?: Readonly<Record<string, string | number>>): string => {
    const template = catalog.messages[id]
    return template === undefined ? id : format(template, params)
  }
  const out: string[] = [line('upgrade.guidance.headline')]

  const dshHome = resolve(resolveDshHome(flags))
  const envReading = await loadEnv({ dshHome, profile: flags.profile })
  if (!envReading.ok) {
    out.push(line('upgrade.guidance.current-unknown', { detail: `${envReading.error.code} — ${envReading.error.detail}` }))
  } else {
    const runtime = envReading.value.dsh === null ? null : envReading.value.dsh.trim()
    out.push(
      runtime === null || runtime === ''
        ? line('upgrade.guidance.current-unknown', { detail: 'this profile declares no dsh version' })
        : line('upgrade.guidance.current', { version: runtime, profile: envReading.value.profile }),
    )
  }

  const packument = await fetchPackument(DIST_TAG_PACKAGE, { at: stampOf(flags) })
  if (!packument.ok) {
    out.push(line('upgrade.guidance.targets-unknown', { detail: `npm ${packument.error.code}` }))
  } else {
    const next = packument.value.distTags['next']
    const latest = packument.value.distTags['latest']
    out.push(
      next === undefined && latest === undefined
        ? line('upgrade.guidance.targets-unknown', { detail: `${DIST_TAG_PACKAGE} publishes no next/latest dist-tag` })
        : line('upgrade.guidance.targets', { next: next ?? '—', latest: latest ?? '—', package: DIST_TAG_PACKAGE }),
    )
  }

  out.push(line('upgrade.guidance.next-step'))
  process.stderr.write(`${out.join('\n')}\n`)
  return EXIT_USAGE
}

/**
 * Write the card atomically (`T-808`, M6 C10).
 *
 * Refuses to overwrite (a card is evidence a user may be about to paste; silently replacing it is
 * how two different readings end up in one file), and never leaves a partial file: the text lands
 * in a sibling temp file first and is renamed into place.
 *
 * The printed path is relative when the file is under the current directory: the card's stdout is
 * the thing users copy into a public issue, and `C:\\Users\\<name>` must never ride along.
 */
function writeCardFile(
  rawPath: string,
  text: string,
):
  | { readonly ok: true; readonly display: string }
  | { readonly ok: false; readonly reason: 'exists' | 'unwritable'; readonly detail: string } {
  const target = resolve(rawPath)
  if (existsSync(target)) {
    // A usage error, not an outage: the user picked a path that already holds something.
    return {
      ok: false,
      reason: 'exists',
      detail: `refusing to overwrite existing file: ${rawPath} (move it or pick another path)`,
    }
  }
  const temp = `${target}.tmp-${process.pid}`
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(temp, text, 'utf8')
    renameSync(temp, target)
  } catch (error) {
    // Best effort: a leftover temp file is still a partial artifact on disk.
    try {
      if (existsSync(temp)) unlinkSync(temp)
    } catch {
      /* the original error is the one worth reporting */
    }
    return { ok: false, reason: 'unwritable', detail: `cannot write ${rawPath}: ${error instanceof Error ? error.message : String(error)}` }
  }
  const fromCwd = relative(process.cwd(), target)
  const display = fromCwd !== '' && !fromCwd.startsWith('..') && !isAbsolute(fromCwd) ? fromCwd : target
  return { ok: true, display }
}

/** At most this many registry lookups per run (spec §6 rule 6): a 95-row profile must not fan out. */
const MAX_REGISTRY_LOOKUPS = 12

/**
 * Ask npm for "is there a published build that declares the target?".
 *
 * Secondary evidence only: the caller merges these facts into a second `judgeUpgradeImpact`
 * call where they can only attach annotations (spec §6, N9). A failed lookup is recorded and
 * never changes the exit code.
 */
async function registryLookupFor(
  impact: UpgradeImpact,
  target: string,
  stamp: string,
): Promise<{ facts: readonly UpgradeRegistryFact[]; failures: readonly UpgradeRegistryFailure[] }> {
  const wanted = [
    ...new Set(
      impact.units
        .filter((unit) => (unit.bucket === 'would-be-denied' || unit.bucket === 'cannot-tell') && unit.version !== null)
        .map((unit) => unit.name),
    ),
  ]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .slice(0, MAX_REGISTRY_LOOKUPS)

  const facts: UpgradeRegistryFact[] = []
  const failures: UpgradeRegistryFailure[] = []
  for (const name of wanted) {
    const packument = await fetchPackument(name, { at: stamp })
    if (!packument.ok) {
      failures.push({ package: name, code: packument.error.code, detail: packument.error.detail })
      continue
    }
    const fact = registryFactFor({
      packageName: name,
      versions: packument.value.versions,
      target,
      publishedAt: packument.value.publishedAt,
    })
    if (fact !== null) facts.push(fact)
  }
  return { facts, failures }
}

/**
 * `upgrade --json`: the impact list, with the per-unit judgement **flattened**.
 *
 * WHY NOT THE NESTED VERDICT: on a 190-row profile the full `Verdict` objects are ~1.8 MB,
 * and every field a reader needs (`reasons`, `remediation`, `missing_evidence`) is already on
 * the unit. The nested object duplicates them a second time. `conclusion` / `evidence_tiers`
 * are copied out of it here, so the payload still says which tier the judgement rests on —
 * and no `Verdict` object means no `profileDir` in a file that is meant to be shareable.
 */
function upgradeJsonPayload(impact: UpgradeImpact, distTag: UpgradeDistTagUse | null): Record<string, unknown> {
  return {
    schema_version: 1,
    command: 'upgrade',
    profile: impact.profile,
    profile_source: impact.profile_source,
    current: impact.current,
    current_valid: impact.current_valid,
    target: impact.target,
    // Where the target came from (M6 C9): an exact version is judged offline; a dist-tag says which
    // word was resolved and against which package, so a reader can re-check the registry themselves.
    target_source: distTag === null ? 'explicit' : 'dist-tag',
    dist_tag:
      distTag === null ? null : { tag: distTag.tag, version: distTag.version, package: DIST_TAG_PACKAGE },
    target_relation: impact.target_relation,
    buckets: impact.buckets,
    counts: impact.counts,
    registry: impact.registry,
    units: impact.units.map((unit) => {
      const { verdict, ...rest } = unit
      return {
        ...rest,
        conclusion: verdict === null ? null : verdict.conclusion,
        evidence_tiers:
          verdict === null
            ? []
            : [...new Set(verdict.evidence.map((item) => item.tier))].sort((left, right) => (left < right ? -1 : 1)),
      }
    }),
    generated_at: impact.generated_at,
  }
}

interface CompositionSnapshot {
  readonly profile: string
  readonly dsh: string | null
  readonly bundles: readonly UpgradeBundleInput[]
  readonly rows: readonly RowDeclaration[]
}

type SnapshotReading =
  | { readonly ok: true; readonly value: CompositionSnapshot }
  | { readonly ok: false; readonly detail: string }

/**
 * Read an `upgrade --snapshot` file: a frozen **composition** (declarations), not a runtime
 * inventory. `audit --snapshot` reads the latter; the two share a flag name and nothing else.
 *
 * A rejected snapshot never falls back to the live profile: "I could not read your file" and
 * "your profile is fine" are different sentences.
 */
function readCompositionSnapshot(path: string): SnapshotReading {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { ok: false, detail: `not readable as JSON (${error instanceof Error ? error.message : String(error)})` }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, detail: 'expected a JSON object' }
  }
  const record = raw as Record<string, unknown>
  if (record['schema_version'] !== 1) return { ok: false, detail: 'schema_version must be 1' }

  const profile = record['profile']
  if (typeof profile !== 'string' || profile.trim() === '') {
    return { ok: false, detail: 'profile must be a non-empty string (the answer belongs to that profile)' }
  }

  const dsh = record['dsh']
  if (dsh !== undefined && dsh !== null) {
    if (typeof dsh !== 'string' || upgradeTargetProblem(dsh) !== null) {
      return { ok: false, detail: 'dsh must be an exact version string or null' }
    }
  }

  const rawBundles = record['bundles']
  if (!Array.isArray(rawBundles)) return { ok: false, detail: 'bundles must be an array (may be empty)' }
  const bundles: UpgradeBundleInput[] = []
  for (const [index, entry] of rawBundles.entries()) {
    if (entry === null || typeof entry !== 'object') return { ok: false, detail: `bundles[${index}] is not an object` }
    const bundle = entry as Record<string, unknown>
    if (typeof bundle['name'] !== 'string' || bundle['name'].trim() === '') {
      return { ok: false, detail: `bundles[${index}].name must be a non-empty string` }
    }
    const manifest = bundle['manifest']
    if (manifest === undefined) return { ok: false, detail: `bundles[${index}].manifest is required (null when unknown)` }
    if (manifest !== null && (typeof manifest !== 'object' || Array.isArray(manifest))) {
      return { ok: false, detail: `bundles[${index}].manifest must be an object or null` }
    }
    const version = bundle['version']
    if (version !== undefined && version !== null && typeof version !== 'string') {
      return { ok: false, detail: `bundles[${index}].version must be a string or null` }
    }
    bundles.push({ name: bundle['name'], version: version ?? null, manifest })
  }

  const rawRows = record['rows']
  if (!Array.isArray(rawRows)) return { ok: false, detail: 'rows must be an array (may be empty)' }
  const rows: RowDeclaration[] = []
  for (const [index, entry] of rawRows.entries()) {
    if (entry === null || typeof entry !== 'object') return { ok: false, detail: `rows[${index}] is not an object` }
    const row = entry as Record<string, unknown>
    for (const field of ['rowId', 'module', 'source'] as const) {
      if (typeof row[field] !== 'string' || (row[field] as string).trim() === '') {
        return { ok: false, detail: `rows[${index}].${field} must be a non-empty string` }
      }
    }
    const manifest = row['manifest']
    if (manifest === undefined) return { ok: false, detail: `rows[${index}].manifest is required (null when not installed)` }
    if (manifest !== null && (typeof manifest !== 'object' || Array.isArray(manifest))) {
      return { ok: false, detail: `rows[${index}].manifest must be an object or null` }
    }
    const version = row['version']
    if (version !== undefined && version !== null && typeof version !== 'string') {
      return { ok: false, detail: `rows[${index}].version must be a string or null` }
    }
    rows.push({
      rowId: row['rowId'] as string,
      module: row['module'] as string,
      source: row['source'] as string,
      version: version ?? null,
      manifest,
    })
  }

  return { ok: true, value: { profile: profile.trim(), dsh: typeof dsh === 'string' ? dsh : null, bundles, rows } }
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

  /*
   * M5-a (spec §7/§9): the verdict exists, so it may be recorded - BEFORE anything is printed
   * and without touching the verdict, the output or the exit code. `recordOutcomes` is a
   * no-op unless the user opted in and never throws (control N14).
   *
   * The prior is read BEFORE the record is appended, so the annotation says "this machine said
   * X before this run" and cannot include the run it is annotating (§10.2: a prior is history,
   * not a self-reference). The prior is only read for `--explain` (control N3: without it the
   * output is byte-identical whether or not a prior exists).
   */
  const prior = flags.explain ? localPriorFor({ env, packageName: name, version: targetVersion }) : null

  recordOutcomes({
    source: 'check',
    subjects: [{ verdict, version: targetVersion }],
    at: stamp,
    probe: null,
    flag: flags.outcomes,
    stderr: (line) => process.stderr.write(line),
  })

  if (flags.json) {
    const payload: Record<string, unknown> = {
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
    }
    // A sibling key, never a field of `verdict` (ADR-0011 §4.1).
    if (prior !== null) payload['prior'] = prior
    writeJson(payload)
    return exitFor(flags, [verdict])
  }
  process.stdout.write(`${renderVerdict(verdict, flags.locale)}\n`)
  if (flags.explain) {
    process.stdout.write(`${renderRegistryExplain(drift, flags.locale)}\n`)
  }
  if (prior !== null) {
    process.stdout.write(renderPrior(prior, flags.locale))
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

async function commandStatus(flags: Flags): Promise<number> {
  const env = await requireEnv(flags)
  if (env === null) return EXIT_UNAVAILABLE
  const dshHome = resolveDshHome(flags)
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
  const summary = buildProfileSummary(loaded.data, { locale: flags.locale })
  // Same exit contract as `audit` (one function, not a second opinion).
  const outcome = auditExitOutcome(loaded.data) === 'ok' ? EXIT_OK : EXIT_FINDINGS
  if (flags.json) {
    writeJson({
      schema_version: 1,
      command: 'status',
      env: redactedEnv(env, { noRedact: flags.noRedact, roots: auditRedactRoots(dshHome) }),
      ...summary,
    })
    return outcome
  }
  process.stdout.write(formatProfileSummary(summary, { locale: flags.locale, env }))
  return outcome
}

/**
 * `dsh-triage fix` — the autofix surface (M7, `docs/specs/M7-autofix.md`).
 *
 * Prints a plan by default and writes NOTHING. `--apply` writes only the items the plan marked
 * `ready`, backs the file up first, and records a journal so `--undo` can put it back.
 */
async function commandFix(flags: Flags): Promise<number> {
  if (flags.undo !== null) {
    try {
      const { restored } = undoFix(flags.undo)
      if (flags.json) {
        writeJson({ schema_version: 1, command: 'fix', undo: flags.undo, restored })
      } else {
        process.stdout.write(`restored ${restored.length} file(s):\n`)
        for (const file of restored) process.stdout.write(`  ${file}\n`)
      }
      return EXIT_OK
    } catch (error) {
      process.stderr.write(`cannot undo: ${error instanceof Error ? error.message : String(error)}\n`)
      return EXIT_UNAVAILABLE
    }
  }

  const env = await requireEnv(flags)
  if (env === null) return EXIT_UNAVAILABLE
  const dshHome = resolveDshHome(flags)
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

  const exemptionSupport = runtimeSupportsExemptions(env.profileDir)
  const plan = planFixes(loaded.data, {
    exemptionSupport,
    installable: readProfileDependencies(env.profileDir),
  })

  let run: ReturnType<typeof applyExemptionFixes> = { journal: '', changes: [], skipped: [], dryRun: true }
  if (flags.apply && plan.applicable > 0) {
    try {
      run = applyExemptionFixes(plan, { stamp: stampOf(flags), dryRun: false })
    } catch (error) {
      process.stderr.write(`cannot apply: ${error instanceof Error ? error.message : String(error)}\n`)
      return EXIT_UNAVAILABLE
    }
  }

  if (flags.json) {
    // Same rule as every other command: absolute home paths are redacted unless --no-redact.
    const safePlan = flags.noRedact
      ? plan
      : { ...plan, profileDir: plan.profileDir.replace(/^[A-Za-z]:\\Users\\[^\\]+/u, '~').replace(/^\/home\/[^/]+/u, '~') }
    writeJson({ schema_version: 1, command: 'fix', plan: safePlan, run })
  } else {
    const zh = flags.locale === 'zh'
    if (plan.items.length === 0) {
      process.stdout.write(zh ? '没有需要修复的项。\n' : 'nothing to fix.\n')
    } else {
      process.stdout.write(zh ? `可修复 ${plan.applicable} / ${plan.items.length} 项\n` : `${plan.applicable} of ${plan.items.length} fixable\n`)
      for (const item of plan.items) {
        const mark = item.status === 'ready' ? '✓' : '·'
        process.stdout.write(`  ${mark} ${item.id}  [${item.action}/${item.status}]\n      ${item.detail}\n`)
        if (item.status !== 'ready' && item.command !== null) process.stdout.write(`      ${item.command}\n`)
      }
    }
    if (!plan.exemptionSupport) {
      process.stdout.write(
        zh
          ? `\n本机运行时（dsh ${plan.runtime ?? '?'}）不读取 compatibility.json，因此豁免类修复不可用。\n`
          : `\nthis runtime (dsh ${plan.runtime ?? '?'}) does not read compatibility.json, so exemptions cannot be applied here.\n`,
      )
    }
    if (run.dryRun) {
      if (plan.applicable > 0) {
        process.stdout.write(zh ? '\n只出了计划，没有写任何文件。要执行：dsh-triage fix --apply\n' : '\nplan only — nothing was written. To apply: dsh-triage fix --apply\n')
      }
    } else {
      process.stdout.write(zh ? `\n已写入 ${run.changes.length} 处，撤销：dsh-triage fix --undo ${run.journal}\n` : `\nwrote ${run.changes.length} change(s); undo with: dsh-triage fix --undo ${run.journal}\n`)
    }
  }

  if (plan.items.length === 0) return EXIT_OK
  return run.dryRun ? EXIT_FINDINGS : plan.applicable === run.changes.length ? EXIT_OK : EXIT_FINDINGS
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

  // R49: the human answer first. The ledger below is the evidence, and it is one flag away
  // (`--all`) instead of being the only thing between the user and their answer.
  const summary = buildProfileSummary(data, { locale: flags.locale })
  process.stdout.write(formatProfileSummary(summary, { locale: flags.locale, env }))
  if (!flags.all) {
    process.stdout.write('\n(full ledger behind --all; `audit --json` carries every field)\n')
    return auditExitOutcome(data) === 'ok' ? EXIT_OK : EXIT_FINDINGS
  }
  process.stdout.write(`\ncapability ledger · dsh ${env.dsh ?? 'unknown'} · profile ${env.profile}\n`)
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

  /*
   * M5-a (spec §9): a `probe --execute` records exactly one outcome. The candidate's EXACT
   * version is the key, so a spec that does not name one (a local path, a tag) is skipped
   * rather than guessed. Sum of step durations is the only "total" the run actually measures.
   */
  recordOutcomes({
    source: 'probe',
    subjects: [{ verdict, version: exactVersionOfSpec(spec) }],
    at: stamp,
    probe: {
      totalMs: run.steps.reduce((sum, step) => sum + (Number.isFinite(step.ms) ? step.ms : 0), 0),
      bootMs: run.timings.bootToSampleMs,
      profile: plan.value.profile,
    },
    flag: flags.outcomes,
    stderr: (line) => process.stderr.write(line),
  })

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
  // R49: the panel's whole purpose is the current composition, so it reads the profile by
  // default. `--no-audit` keeps the old artifacts-only mode (and `/api/audit` answers 501,
  // never an empty ledger that looks clean).
  const audit = flags.noAudit
    ? null
    : async (): Promise<AuditSnapshot> => {
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
          // Same object the CLI's first screen prints, from the same scan.
          // The panel has room the terminal does not: show more than the CLI's default so
          // "show all" in the UI is not a lie. The counts are unaffected by the cap.
          summary: buildProfileSummary(loaded.data, { locale: flags.locale, limit: 50 }),
        }
      }
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

/**
 * `outcomes` — the local store's three verbs (M5-a, spec §7 / §11).
 *
 * `--purge` deliberately needs no opt-in: deleting must always be possible, and it must never
 * be the thing that creates the directory (control N5). Text output carries counts only - no
 * record, no package name, no path (control N13).
 */
async function commandOutcomes(flags: Flags): Promise<number> {
  const at = stampOf(flags)
  const verbs = [flags.enable, flags.disable, flags.purge].filter(Boolean).length
  if (verbs > 1) {
    process.stderr.write('usage: dsh-triage outcomes [--status | --enable | --disable | --purge]\n')
    return EXIT_USAGE
  }

  if (flags.purge) {
    const result = purgeOutcomes({ at })
    if (!result.ok) {
      process.stderr.write(`cannot purge the outcome store (${result.detail}); nothing was reported as deleted\n`)
      return EXIT_FINDINGS
    }
    if (flags.json) writeJson(result.report)
    else process.stdout.write(renderPurge(result.report))
    return EXIT_OK
  }

  if (flags.enable || flags.disable) {
    const mode: OutcomeMode = flags.enable ? 'local' : 'off'
    const written = writeOutcomeMode(mode)
    if (!written.ok) {
      process.stderr.write(`cannot write the outcome config (${written.detail})\n`)
      return EXIT_FINDINGS
    }
    if (flags.json) {
      writeJson({ schema_version: 1, mode, changed: written.changed })
    } else {
      process.stdout.write(`outcomes ${mode}${written.changed ? '' : ' (already set)'}\n`)
    }
    return EXIT_OK
  }

  // `--status` is the default verb: "how much is actually stored right now".
  const reading = readOutcomeConfig()
  for (const problem of reading.problems) process.stderr.write(`outcomes: off (${problem})\n`)
  const report = outcomeStatus({})
  if (flags.json) writeJson(report)
  else process.stdout.write(renderStatus(report))
  return EXIT_OK
}

/**
 * The exact version a probe candidate pins, or `null`.
 *
 * WHY NOT ASK THE REGISTRY: a record's key must be the version that was actually installed, and
 * a spec without a version cannot state it. Guessing `latest` would file the measurement under
 * a build that may already be replaced, so the caller skips the record instead.
 */
function exactVersionOfSpec(spec: string): string | null {
  const trimmed = spec.trim()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return null
  const version = trimmed.slice(at + 1)
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? version : null
}

async function requireEnv(flags: Flags, dshHomeOverride?: string): Promise<EnvFingerprint | null> {
  const result = await loadEnv({ dshHome: dshHomeOverride ?? resolveDshHome(flags), profile: flags.profile })
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
  let apply = false
  let undo: string | null = null
  let audit = false
  let noAudit = false
  let readinessTimeoutMs: number | null = null
  let unsettledReadinessMs: number | null = null
  let copyProfile: string | null = null
  let outcomes: OutcomeMode | null = null
  let enable = false
  let disable = false
  let purge = false
  let status = false
  let to: string | null = null
  let registry = false
  let card = false

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
      case '--apply':
        apply = true
        break
      case '--undo': {
        const value = takeValue()
        if (value === null) return null
        undo = value
        break
      }
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
      case '--no-audit':
        noAudit = true
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
      case '--outcomes': {
        const value = takeValue()
        if (value !== 'off' && value !== 'local') return null
        outcomes = value
        break
      }
      case '--enable':
        enable = true
        break
      case '--disable':
        disable = true
        break
      case '--purge':
        purge = true
        break
      case '--status':
        status = true
        break
      case '--to': {
        const value = takeValue()
        if (value === null) return null
        to = value
        break
      }
      case '--registry':
        registry = true
        break
      case '--card':
        card = true
        break
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

  const flags = { json, all, strict, execute, dshHome, profile, stamp, locale, noRedact, snapshot, explain, dshMain, noHttp, browser, port, results, allowExecute, apply, undo, audit, noAudit, readinessTimeoutMs, unsettledReadinessMs, copyProfile, profileExplicit, out, outcomes, enable, disable, purge, status, to, registry, card }
  if (help) return { command: 'help', positionals: [], flags }
  // R49: no subcommand is not an error. It is the question the product exists to answer.
  const command = positionals.shift() ?? 'status'
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
