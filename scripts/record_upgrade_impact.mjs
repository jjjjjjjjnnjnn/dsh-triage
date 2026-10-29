#!/usr/bin/env node
/**
 * M5-b real run recorder (`T-502`, `docs/specs/M5-upgrade.md` §12).
 *
 * WHAT IT DOES: runs the real CLI three times against the in-repo sandbox runtime —
 *
 *   1. `upgrade --to <target>`      the impact list this task exists for;
 *   2. `upgrade --to <current>`     the control: same rows, same declarations, runtime unchanged;
 *   3. `why --json --all`           what the existing attribution command says right now.
 *
 * (2) and (3) are the interesting comparison. (2) must report ZERO new denials, because nothing
 * moved; (3) must name the same denied/unconstrained modules as (2). If the impact list were
 * derived from its own private range logic instead of `evaluateAdmission`, (1) and (2) could
 * both look plausible while (3) disagreed — that is the failure this run is designed to catch.
 *
 * WHAT THE ARTIFACT KEEPS: counts, the unit identities, the message ids of the reasons, the
 * fix kinds, the unmet declared ranges. NOT the full remediation prose (that lives in
 * `dsh-triage upgrade --json`, ~800 KB on a 190-row profile) and NOT any path.
 *
 * WHAT IT DOES NOT DO: no `--registry` (the default is offline and this run stays offline), no
 * probe, no profile edit. The target version's *existence* is not verified — see `limits[]`.
 *
 *   node scripts/record_upgrade_impact.mjs --stamp 2026-10-30T03:10:00.000Z \
 *     [--to 0.3.0] [--dsh-home sandbox/upstream/0.2.1-rc.4/home] [--profile upstream] [--out data/results]
 *     [--expect-improved] [--registry-live]
 *
 * `--expect-improved` is for the curated mixed-declaration profile built by
 * `scripts/prepare_upgrade_mixed_profile.mjs`: it asserts the `improved` bucket is non-empty and
 * that every unit in it carries both sides of the evidence (R44 / `T-503`).
 * `--registry-live` exercises the successful registry branch instead of the dead-proxy one
 * (R44 / `T-504`). Both change only which assertions run and how the artifact is named — never a
 * judgement, a threshold, or a bucket.
 *
 * Requires `pnpm build`. Exit codes: 0 recorded and all checks passed · 1 recorded but a check
 * failed · 2 bad usage / missing prerequisite / refusing to overwrite.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = argOf('--stamp', null)
const stamp = rawStamp === null ? null : isoStamp(String(rawStamp))
if (stamp === null) {
  process.stderr.write(
    'usage: node scripts/record_upgrade_impact.mjs --stamp <ISO> [--to <version>] [--dsh-home <path>] [--profile <name>] [--out <dir>] [--expect-improved] [--registry-live] [--json]\n',
  )
  process.exit(2)
}

const target = String(argOf('--to', '0.3.0'))
const profile = String(argOf('--profile', 'upstream'))
const dshHome = pathFor(String(argOf('--dsh-home', 'sandbox/upstream/0.2.1-rc.4/home')))
const outDir = pathFor(String(argOf('--out', 'data/results')))
const asJson = argv.includes('--json')
/**
 * `--expect-improved` asserts the **`improved` bucket is non-empty** and that each of its units
 * carries both sides of the evidence. The in-repo sandbox cannot produce this: every package
 * there pins the running runtime, so R42's real 192-unit run measured `improved = 0`. The
 * curated profile from `scripts/prepare_upgrade_mixed_profile.mjs` is what makes it observable.
 */
const expectImproved = argv.includes('--expect-improved')
/** `--registry-live` exercises the *successful* registry branch instead of the dead-proxy one. */
const registryLive = argv.includes('--registry-live')
const CLI = abs('packages/plugin/dist/cli.js')

if (!existsSync(CLI)) {
  process.stderr.write(`${CLI} is missing: run \`pnpm build\` first\n`)
  process.exit(2)
}
if (!existsSync(join(dshHome, 'profiles', profile, 'package.json'))) {
  process.stderr.write(
    `no profile "${profile}" under ${dshHome}; run \`node scripts/bootstrap_upstream.mjs\` first (it is git-ignored)\n`,
  )
  process.exit(2)
}

const runs = []
/**
 * Home-shaped paths that must never reach committed evidence (`gate_governance#results-privacy`).
 * The first attempt at this artifact recorded the resolved `--dsh-home` inside `runs[].command`,
 * which the gate caught — so the recorder now checks its own bytes and refuses to write them.
 */
const HOME_PATTERNS = [
  /[A-Za-z]:\\\\Users\\\\/,
  /[A-Za-z]:\\Users\\/,
  /\/home\/[a-z0-9._-]+\//i,
  /\/Users\/[A-Za-z0-9._-]+\//,
  /[A-Za-z]-Users-[A-Za-z0-9._-]{2,}/,
]
const homePathHits = (text) => HOME_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source)

function runCli(id, args, extraEnv = {}) {
  const started = Date.now()
  const child = spawnSync(process.execPath, [CLI, ...args], {
    cwd: abs('.'),
    encoding: 'utf8',
    // The impact payload of a 190-row profile is ~800 KB; the default 1 MB buffer truncates a
    // slightly bigger profile silently, so give it room and treat a parse failure as a failure.
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, DSH_TRIAGE_LOCALE: 'en', ...extraEnv },
    timeout: 600_000,
  })
  const ms = Date.now() - started
  const stdout = child.stdout ?? ''
  const stderr = child.stderr ?? ''
  let payload = null
  let parseError = null
  try {
    payload = stdout.trim() === '' ? null : JSON.parse(stdout)
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error)
  }
  const entry = {
    id,
    // The command shape, with the machine-specific home replaced: this file is published.
    command: args
      .filter((token) => token !== '--json' && token !== '--stamp' && token !== stamp)
      .map((token) => (token === dshHome ? '<dsh-home>' : token))
      .join(' '),
    exit: child.status,
    ms,
    stdout_bytes: Buffer.byteLength(stdout, 'utf8'),
    stderr_lines: stderr.trim() === '' ? 0 : stderr.trim().split('\n').length,
    parsed: payload !== null,
    payload_sha256: payload === null ? null : sha256(JSON.stringify(payload)),
    parse_error: parseError,
  }
  runs.push(entry)
  return { entry, payload, stdout, stderr }
}

const checks = []
const check = (id, ok, detail) => {
  checks.push({ id, ok: Boolean(ok), detail })
  return ok
}

const common = ['--dsh-home', dshHome, '--profile', profile, '--stamp', stamp]

// 1. The impact list this task exists for.
const impactRun = runCli('impact', ['upgrade', '--to', target, ...common, '--json'])
check('impact-exit-0', impactRun.entry.exit === 0, `exit ${String(impactRun.entry.exit)}`)
check('impact-parses', impactRun.entry.parsed, String(impactRun.entry.parse_error ?? 'ok'))
const impact = impactRun.payload

if (impact === null) {
  process.stderr.write(`the impact run produced no JSON; stderr was:\n${impactRun.stderr}\n`)
  process.exit(1)
}

check('impact-names-the-profile', impact.profile === profile, String(impact.profile))
check('impact-names-the-target', impact.target === target, String(impact.target))
check(
  'impact-sampled-something',
  typeof impact.counts?.total === 'number' && impact.counts.total > 0,
  `${String(impact.counts?.total)} unit(s)`,
)
check(
  'counts-are-a-partition',
  impact.counts.would_be_denied + impact.counts.cannot_tell + impact.counts.improved + impact.counts.likely_fine ===
    impact.counts.total,
  JSON.stringify(impact.counts),
)
check(
  'units-are-uniquely-identified',
  new Set(impact.units.map((unit) => unit.id)).size === impact.units.length,
  `${impact.units.length} unit(s)`,
)
check(
  'every-unit-has-a-known-bucket',
  impact.units.every((unit) => impact.buckets.includes(unit.bucket)),
  JSON.stringify(impact.buckets),
)
check(
  'denials-carry-a-fix',
  impact.units
    .filter((unit) => unit.bucket === 'would-be-denied')
    .every((unit) => Array.isArray(unit.remediation) && unit.remediation.length > 0),
  'every would-be-denied unit has at least one remediation',
)
check(
  'cannot-tell-says-what-is-missing',
  impact.units
    .filter((unit) => unit.bucket === 'cannot-tell')
    .every((unit) => Array.isArray(unit.missing_evidence) && unit.missing_evidence.length > 0),
  'every cannot-tell unit says which evidence would resolve it',
)
check(
  'denials-name-the-row',
  impact.units
    .filter((unit) => unit.bucket === 'would-be-denied' && unit.kind === 'row')
    .every((unit) =>
      unit.reasons.some((reason) => reason.messageId === 'admission.row-scope' && reason.params?.rows === unit.row_ids[0]),
    ),
  'row-scope carries the row id the user must disable',
)

// 2. Determinism: same command, same stamp, same bytes.
const repeatRun = runCli('impact-repeat', ['upgrade', '--to', target, ...common, '--json'])
check(
  'deterministic-payload',
  repeatRun.entry.payload_sha256 !== null && repeatRun.entry.payload_sha256 === impactRun.entry.payload_sha256,
  `${String(impactRun.entry.payload_sha256).slice(0, 12)}… vs ${String(repeatRun.entry.payload_sha256).slice(0, 12)}…`,
)

// 3. The control: the same profile judged against the runtime it already runs.
const current = typeof impact.current === 'string' ? impact.current : null
const controlRun = current === null ? null : runCli('control', ['upgrade', '--to', current, ...common, '--json'])
check('control-ran', controlRun !== null && controlRun.entry.exit === 0, current === null ? 'no current runtime read' : `exit ${String(controlRun?.entry.exit)}`)
const control = controlRun?.payload ?? null
check('control-improved-empty', control?.counts?.improved === 0, String(control?.counts?.improved))
check('control-relation-same', control?.target_relation === 'same', String(control?.target_relation))
/*
 * "No NEW denials" is not "zero denials": a unit that is already denied by the running runtime
 * shows up in `would-be-denied` at every target, including the current one. The invariant that
 * actually holds is that nothing *becomes* denied — every denial at target==current carries
 * `already_denied_at_current: true`. (R42's template profile had zero denials anyway, so the
 * weaker form passed vacuously; the mixed profile is what makes the distinction observable.)
 */
const controlNewDenials = (control?.units ?? []).filter(
  (unit) => unit.bucket === 'would-be-denied' && unit.already_denied_at_current !== true,
)
check(
  'control-has-no-new-denials',
  control !== null && controlNewDenials.length === 0,
  control === null
    ? 'no control run'
    : `${String(controlNewDenials.length)} newly denied at target==current (${String(control.counts.would_be_denied)} denied in total, all already denied today)`,
)

// 4. Cross-check against `why`, which is the command users already trust.
const whyRun = runCli('why', ['why', ...common, '--json', '--all'])
check('why-exit-0', whyRun.entry.exit === 0, `exit ${String(whyRun.entry.exit)}`)
const why = whyRun.payload
const whyEntry = (why?.verdicts ?? []).filter((verdict) => verdict.subject?.kind === 'entry')
const whyDenied = new Set(whyEntry.filter((verdict) => verdict.conclusion === 'blocked').map((verdict) => verdict.subject.name))
const whyUnknown = new Set(whyEntry.filter((verdict) => verdict.conclusion === 'unknown').map((verdict) => verdict.subject.name))
const unitNames = (bucket) =>
  new Set((control?.units ?? []).filter((unit) => unit.kind === 'row' && unit.bucket === bucket).map((unit) => unit.name))
const controlDenied = unitNames('would-be-denied')
const controlUnknown = unitNames('cannot-tell')
const setDiff = (left, right) => [...left].filter((name) => !right.has(name)).sort()
const deniedDiff = [...setDiff(controlDenied, whyDenied), ...setDiff(whyDenied, controlDenied)]
const unknownDiff = [...setDiff(controlUnknown, whyUnknown), ...setDiff(whyUnknown, controlUnknown)]
check('why-denied-matches-upgrade-control', deniedDiff.length === 0, deniedDiff.slice(0, 5).join(', ') || `${controlDenied.size} module(s)` )
check('why-unknown-matches-upgrade-control', unknownDiff.length === 0, unknownDiff.slice(0, 5).join(', ') || `${controlUnknown.size} module(s)`)

/*
 * Whether that comparison actually STRUCK anything. On the template profile `why` reports zero
 * denied rows (everything pins the running build correctly), so "the sets are equal" is true but
 * empty. The artifact says so instead of presenting an empty comparison as proof.
 */
const deniedComparisonVacuous = whyDenied.size === 0 && controlDenied.size === 0
/*
 * The list has to move when the target moves, and it can move in two directions: rows the target
 * denies that it did not deny before, or rows it admits that are denied today (`improved`). The
 * first version of this check only looked at denials, which is exactly the shape the template
 * profile produces — on a mixed profile a row can be denied at BOTH targets, so a pure denial
 * delta would read as "the target does not matter" while three units flip to `improved`.
 */
const discriminates =
  impact.counts.would_be_denied !== (control?.counts?.would_be_denied ?? -1) ||
  impact.counts.improved !== (control?.counts?.improved ?? -1)
check(
  'target-change-moves-the-list',
  discriminates,
  `${String(impact.counts?.would_be_denied)} denied + ${String(impact.counts?.improved)} improved at ${target} vs ${String(control?.counts?.would_be_denied)} + ${String(control?.counts?.improved)} at ${current ?? 'unknown'}`,
)

/*
 * 4b. The `improved` bucket, when this profile is supposed to contain one.
 *
 * `improved` is the easiest bucket to fake (spec §4.1 lists five conditions for that reason), so
 * this does not just count units: each unit must carry the denial that exists TODAY and the
 * admission at the TARGET, computed on the same installed version.
 */
if (expectImproved) {
  const improved = impact.units.filter((unit) => unit.bucket === 'improved')
  check('improved-non-empty', improved.length > 0, `${improved.length} improved unit(s) at ${target}`)
  check(
    'improved-names-both-sides',
    improved.every(
      (unit) =>
        unit.current.status === 'denied' &&
        (unit.current.unmet ?? []).some((requirement) => requirement.failure === null) &&
        unit.target.status === 'admitted',
    ),
    'every improved unit: denied today (a real range miss) and admitted at the target, same version',
  )
  check(
    'improved-was-denied-today',
    improved.every((unit) => unit.already_denied_at_current === true),
    'an "it got better" claim requires that it was worse before',
  )
  check(
    'improved-single-version',
    improved.every((unit) => typeof unit.version === 'string' && unit.version !== ''),
    'both sides were judged on one installed version',
  )
  check(
    'all-four-buckets-non-empty',
    impact.buckets.every((bucket) => impact.counts[bucket.replaceAll('-', '_')] > 0),
    JSON.stringify(impact.counts),
  )
  check(
    'improved-carries-no-registry-annotation',
    improved.every((unit) => (unit.suggestions ?? []).length === 0),
    'registry notes attach to denied/cannot-tell units only; a note must never be what makes a unit "improved"',
  )
}

// 5. Privacy: the payload is meant to be paste-safe.
const impactText = JSON.stringify(impact)
check('no-home-path-in-payload', homePathHits(impactText).length === 0, 'no home-shaped path in the impact payload')

/*
 * 6. `--registry` is secondary evidence: the same units judged with the registry path ON must
 * keep every bucket and count.
 *
 * TWO BRANCHES, and the artifact must say which one it saw:
 * - default (offline): the child is pointed at a proxy that refuses connections (127.0.0.1:9), so
 *   what is proven is the *failure* path — 12 lookups fail and nothing moves. This is what R42
 *   recorded, and it is why "the success branch has no evidence" stayed open.
 * - `--registry-live`: real lookups against the registry. This proves the other half: facts are
 *   attached as annotations and STILL cannot move a unit. Network content is a snapshot of the
 *   run's moment, so the artifact says the facts are not byte-reproducible.
 */
const REGISTRY_BLOCKED_ENV = { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' }
const registryRun = runCli(
  registryLive ? 'registry-live' : 'registry',
  ['upgrade', '--to', target, ...common, '--json', '--registry'],
  registryLive ? {} : REGISTRY_BLOCKED_ENV,
)
const registry = registryRun.payload
const bucketShape = (payload) => (payload?.units ?? []).map((unit) => `${unit.id}|${unit.bucket}|${unit.cause}`)
const registryFailures = registry?.registry?.failures?.length ?? 0
const registryFacts = registry?.registry?.facts ?? 0
check('registry-exit-0', registryRun.entry.exit === 0, `exit ${String(registryRun.entry.exit)} (a failed lookup is not a failed run)`)
check(
  'registry-cannot-move-a-unit',
  JSON.stringify(bucketShape(registry)) === JSON.stringify(bucketShape(impact)),
  'every unit keeps its bucket/cause with the registry path on',
)
check('registry-cannot-move-a-count', JSON.stringify(registry?.counts ?? null) === JSON.stringify(impact.counts), JSON.stringify(registry?.counts ?? null))
check(
  'registry-notes-are-annotations',
  (registry?.units ?? []).every((unit) =>
    (unit.suggestions ?? []).every((note) => note.annotation_only === true && note.tier === 'measured-registry'),
  ),
  'every suggestion is annotation_only + measured-registry',
)
check(
  'registry-path-actually-ran',
  registryFailures + registryFacts > 0,
  `${registryFacts} fact(s), ${registryFailures} failure(s)`,
)
if (registryLive) {
  // A live run that found nothing would look identical to a blocked one in every other check,
  // so the success branch gets its own assertion instead of being inferred from "exit 0".
  check(
    'registry-live-found-facts',
    registryFacts > 0,
    `${registryFacts} published build(s) answered "does your declaration admit ${target}?"; ${registryFailures} lookup(s) failed`,
  )
  check(
    'registry-live-attached-something',
    (registry?.units ?? []).some((unit) => (unit.suggestions ?? []).length > 0),
    'at least one denied/cannot-tell unit carries the annotation',
  )
}

/* --------------------------------- artifact --------------------------------- */

/** Per-unit projection: identity, judgement, ids. Prose stays in the CLI payload. */
function projectUnit(unit) {
  // `improved` units have to carry both sides in the artifact itself: the range that fails
  // TODAY and the admission at the target. Without the first half the bucket is unverifiable.
  const currentUnmet = (unit.current.unmet ?? [])
    .filter((requirement) => requirement.failure === null)
    .map((requirement) => ({ key: requirement.key, range: requirement.range }))
  return {
    id: unit.id,
    kind: unit.kind,
    name: unit.name,
    version: unit.version,
    row_ids: unit.row_ids,
    source: unit.source,
    bucket: unit.bucket,
    cause: unit.cause,
    already_denied_at_current: unit.already_denied_at_current,
    conclusion: unit.conclusion,
    current: {
      runtime: unit.current.runtime,
      status: unit.current.status,
      ...(currentUnmet.length === 0 ? {} : { unmet_at_current: currentUnmet }),
    },
    target: { runtime: unit.target.runtime, status: unit.target.status },
    // Every declared requirement that failed at the target: this is the fact the user acts on.
    unmet: (unit.target.unmet ?? []).map((requirement) => ({ key: requirement.key, range: requirement.range })),
    missing_evidence: unit.missing_evidence,
    reason_ids: [...new Set((unit.reasons ?? []).map((reason) => reason.messageId))].sort(),
    fix_kinds: [...new Set((unit.remediation ?? []).map((item) => item.kind))].sort(),
    suggestion_versions: (unit.suggestions ?? []).map((note) => `${note.version}:${note.admits_target}`),
  }
}

/**
 * The pins the profile declares, read from its own manifest.
 *
 * WHY IN THE ARTIFACT: the mixed profile is a *curated selection* of real packages, so which
 * packages are in it is part of the claim. Recording names+versions (never the path) lets a
 * reader see that the declarations were not edited — the versions are the published ones.
 */
function declaredDependencies() {
  const manifestPath = join(dshHome, 'profiles', profile, 'package.json')
  if (!existsSync(manifestPath)) return null
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const dependencies = manifest?.dependencies
    if (dependencies === null || typeof dependencies !== 'object') return null
    return Object.entries(dependencies)
      .filter(([, range]) => typeof range === 'string')
      .map(([name, range]) => `${name}@${range}`)
      .sort()
  } catch {
    return null
  }
}

const passed = checks.every((entry) => entry.ok)
/*
 * WHICH VIEW GOES IN THE FILE.
 *
 * With `--registry` the CLI re-judges with annotations attached, so the payload the user would
 * actually see is the second one. The first (offline) judgement stays as the comparison baseline
 * and is recorded as `offline_counts` — R42's artifact recorded the offline view, which meant the
 * file never contained the annotations it claimed to prove. `units`/`impact` now describe the run
 * that was made; the invariants are still checked between the two payloads.
 */
const view = registry !== null && registry !== undefined ? registry : impact
const declared = declaredDependencies()
const compositionIsCurated = declared !== null && declared.length > 0
const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_upgrade_impact.mjs',
  generated_at: stamp,
  source: {
    // Which runtime and which profile: every conclusion in this file belongs to this pair.
    runtime: current,
    // The sandbox path is deliberately NOT recorded: it is a machine-specific path (iron law 5).
    profile,
    profile_source: impact.profile_source,
    runtime_provenance: 'in-repo sandbox (sandbox/upstream/<version>/home), git-ignored',
    // `null` = the profile has no manifest of its own dependencies (the template case).
    declared_dependencies: declared,
    composition: compositionIsCurated
      ? 'curated: real published packages installed at pinned versions via scripts/prepare_upgrade_mixed_profile.mjs; no package manifest was edited'
      : 'in-repo sandbox template profile',
    registry_consulted: view.registry?.consulted === true,
    registry_live: registryLive,
    target_verified_to_exist: false,
  },
  impact: {
    profile: view.profile,
    current: view.current,
    current_valid: view.current_valid,
    target: view.target,
    target_relation: view.target_relation,
    bucket_order: view.buckets,
    counts: view.counts,
    // The same units judged with the registry path OFF: the baseline the invariants are checked
    // against. Equal to `counts` when no lookup ran or when every lookup failed.
    offline_counts: impact.counts,
    registry: view.registry,
  },
  units: view.units.map(projectUnit),
  self_check: {
    control_target: current,
    control_counts: control?.counts ?? null,
    why_scanned: why?.scanned ?? null,
    why_entry_verdicts: whyEntry.length,
    why_denied_modules: whyDenied.size,
    why_unknown_modules: whyUnknown.size,
    control_denied_modules: controlDenied.size,
    control_unknown_modules: controlUnknown.size,
    denied_sets_equal: deniedDiff.length === 0,
    unknown_sets_equal: unknownDiff.length === 0,
    denied_comparison_vacuous: deniedComparisonVacuous,
    target_change_moves_the_list: discriminates,
    improved_units: impact.units.filter((unit) => unit.bucket === 'improved').map((unit) => `${unit.name}@${String(unit.version)}`),
    buckets_non_empty: impact.buckets.filter((bucket) => impact.counts[bucket.replaceAll('-', '_')] > 0),
    expect_improved: expectImproved,
    registry: {
      consulted: registry?.registry?.consulted ?? null,
      live: registryLive,
      facts: registryFacts,
      failures: registryFailures,
      network_blocked_on_purpose: !registryLive && registryFailures > 0,
      buckets_identical_to_offline_run: JSON.stringify(bucketShape(registry)) === JSON.stringify(bucketShape(impact)),
      counts_identical_to_offline_run: JSON.stringify(registry?.counts ?? null) === JSON.stringify(impact.counts),
    },
    note: 'the control run (target == running runtime) must deny nothing new and must name the same modules as `why`; a vacuous comparison is reported as vacuous',
  },
  runs,
  checks,
  passed,
  limits: [
    `this is a DECLARATION-layer judgement: nothing here booted ${impact.target}, so it says which rows would be denied, not whether the plugins work`,
    `the target version was not verified to exist: the run is offline by construction (no --registry), so a hypothetical target is legitimate input and an unverified one`,
    `one profile (${impact.profile}) on one machine: the answer does not transfer to another profile, another dsh home, or another os/arch (BS-38)`,
    `only units that are installed here were judged; a plugin that is not in this profile has no row and no answer`,
    'remediation prose and reason prose are not copied into this artifact; per-unit message ids (`reason_ids`) and fix kinds (`fix_kinds`) are, and `dsh-triage upgrade --json` carries the full lists',
    deniedComparisonVacuous
      ? 'the `why` cross-check is VACUOUS on this profile: nothing is denied at the running runtime, so "the sets are equal" proves only that both are empty; the discriminating evidence is the same rows going 0 → N when the target moves'
      : 'the `why` cross-check compared non-empty denied-module sets',
    '`unmet` lists the declared requirements that failed, capped by nothing: a plugin with 29 pinned peers contributes 29 rows here',
    expectImproved
      ? `the composition is CURATED: ${String(declared?.length ?? 0)} real published package(s) were installed at pinned versions to cover all four buckets; the package manifests are the published ones (never edited), but which packages are in the profile is our choice — this is not a random sample of the ecosystem`
      : compositionIsCurated
        ? `the composition is CURATED (${String(declared?.length ?? 0)} pinned package(s)); see \`declared_dependencies\` — the manifests are published, the selection is ours`
        : 'the composition is the in-repo sandbox template profile: every package pins the running runtime, so `improved` is structurally empty here',
    `the target is ${String(view.target_relation)} relative to the running runtime: ${String(view.current)} → ${String(view.target)}. Today no published plugin declares a range that denies ${String(view.current)} and is admitted by a NEWER build (scripts/scan_upgrade_declarations.mjs scanned the registry and found none), so the real shape of "improved" is "move back to the build your plugins pin"`,
    registryLive
      ? 'the `--registry` run reached the registry: the facts in it are a snapshot of the moment it ran, so re-running can legitimately attach different annotations; what is stable is that no unit changed bucket or count'
      : registryFailures > 0
        ? 'the `--registry` run was made unreachable on purpose (HTTP(S)_PROXY → 127.0.0.1:9), so what it proves is the failure path: the same units kept every bucket and count and the lookups were recorded as annotations; what a *successful* registry lookup would suggest is not evidenced here'
        : 'the `--registry` run reached npm; the suggestions in it are registry metadata (the author’s declaration), not a measurement of the target runtime',
  ],
}

const text = `${JSON.stringify(artifact, null, 2)}\n`
// The recorder checks its own bytes: an artifact that would make the privacy gate red must not
// be written at all. (This is not theoretical — `runs[].command` leaked the home directory in
// the first attempt, and `gate_governance#results-privacy` caught it.)
const leaks = homePathHits(text)
if (leaks.length > 0) {
  process.stderr.write(`refusing to write evidence that contains a home-shaped path: ${leaks.join(', ')}\n`)
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
// The file name says which shape produced it: a mixed-profile run, a live-registry run, or the
// default offline template run. Three different claims must not share one prefix.
const filePrefix = expectImproved ? 'upgrade-mixed' : registryLive ? 'upgrade-registry-live' : 'upgrade'
const fileName = `${filePrefix}-${stamp.replaceAll(':', '-')}.json`
const targetPath = join(outDir, fileName)
if (existsSync(targetPath)) {
  process.stderr.write(
    `refusing to overwrite existing evidence: ${join('data/results', fileName)}\n` +
      '  a stamp identifies an artifact; pick a stamp this round has not used yet\n',
  )
  process.exit(2)
}
writeFileSync(targetPath, text, 'utf8')
writeFileSync(`${targetPath}.sha256`, sha256(text), 'utf8')

if (asJson) {
  process.stdout.write(text)
} else {
  process.stdout.write(`M5-b upgrade impact · ${join('data/results', fileName)}\n`)
  process.stdout.write(`  profile  ${impact.profile} · dsh ${String(current)} → ${impact.target} (${impact.target_relation})\n`)
  process.stdout.write(
    `  counts   ${impact.counts.total} unit(s) · would-be-denied ${impact.counts.would_be_denied} · cannot-tell ${impact.counts.cannot_tell} · improved ${impact.counts.improved} · likely-fine ${impact.counts.likely_fine}\n`,
  )
  for (const entry of runs) {
    process.stdout.write(`  ${entry.exit === 0 ? 'ok  ' : 'FAIL'} ${entry.id.padEnd(14)} exit ${entry.exit} · ${entry.ms}ms · ${entry.stdout_bytes}B\n`)
  }
  for (const entry of checks) process.stdout.write(`  ${entry.ok ? 'PASS' : 'FAIL'}  ${entry.id} — ${entry.detail}\n`)
  process.stdout.write(`  verdict  ${passed ? 'all checks passed' : 'CHECK FAILED (artifact written anyway)'}\n`)
  process.stdout.write(`ssot ${join('data/results', fileName)} sha256=${sha256(text).slice(0, 12)}…\n`)
}

process.exit(passed ? 0 : 1)
