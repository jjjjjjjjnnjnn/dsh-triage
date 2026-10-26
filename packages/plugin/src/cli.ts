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
 * Exit codes: 0 ok · 1 findings (only with --strict) · 2 usage · 3 unavailable
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import {
  evaluateAdmission,
  extractEntryClaims,
  findEntryIdCollisions,
  groupClaimsBySource,
  loadEnv,
  parsePatchYaml,
  renderVerdict,
  verdictFromAdmission,
  verdictsFromCollisions,
  type Conclusion,
  type EntryClaim,
  type EnvFingerprint,
  type Locale,
  type Verdict,
} from '@dsh-triage/core'
import { buildProbePlan } from '@dsh-triage/probe'
import { discoverLocalArtifacts, fetchPackument } from '@dsh-triage/signals'
import { loadComposition } from './load.js'

const EXIT_OK = 0
const EXIT_FINDINGS = 1
const EXIT_USAGE = 2
const EXIT_UNAVAILABLE = 3

interface Flags {
  readonly json: boolean
  readonly all: boolean
  readonly strict: boolean
  readonly execute: boolean
  readonly dshHome: string | null
  readonly profile: string
  readonly stamp: string | null
  readonly locale: Locale
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
  --stamp <iso>         fixed timestamp for reproducible output
  --execute             (probe) really run the plan — not implemented before M3
  --help                this text

Exit codes: 0 ok · 1 findings (with --strict) · 2 usage · 3 unavailable
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
    writeJson({ schema_version: 1, env })
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
      }),
    )
  }

  const bannerErrors: string[] = [...composition.errors]
  const claims = collectClaims(composition, bannerErrors)
  const collisions = findEntryIdCollisions(claims)
  verdicts.push(...verdictsFromCollisions({ env, collisions, generatedAt: stamp }))

  const findings = verdicts.filter((verdict) => (flags.all ? true : verdict.conclusion !== 'go'))

  if (flags.json) {
    writeJson({
      schema_version: 1,
      command: 'why',
      env,
      verdicts: findings,
      errors: bannerErrors,
      scanned: { bundles: composition.layers.length, entries: claims.length },
    })
    return exitFor(flags, findings)
  }

  process.stdout.write(
    `scanned ${composition.layers.length} bundles · ${claims.length} loader rows · dsh ${env.dsh ?? 'unknown'} · profile ${env.profile}\n`,
  )
  for (const error of bannerErrors) process.stdout.write(`warn  ${error}\n`)
  if (findings.length === 0) {
    process.stdout.write('no denials or collisions found in the declared layer.\n')
    process.stdout.write('run `dsh-triage audit` to see the capability ledger, or `dsh-triage check <pkg>` before installing.\n')
    return EXIT_OK
  }
  for (const verdict of findings) {
    process.stdout.write(`${renderVerdict(verdict, flags.locale)}\n\n`)
  }
  if (findings.some((verdict) => verdict.conclusion === 'unknown')) {
    process.stdout.write(
      'note  "unknown" means the plugin declares no DSH version range; admission cannot judge it (see docs/03-failure-taxonomy.md F5).\n',
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
  const verdict = verdictFromAdmission({
    subject: { name, version: targetVersion, kind: 'plugin' },
    env,
    admission,
    generatedAt: stamp,
  })

  if (flags.json) {
    writeJson({ schema_version: 1, command: 'check', verdict, admission })
    return exitFor(flags, [verdict])
  }
  process.stdout.write(`${renderVerdict(verdict, flags.locale)}\n`)
  if (admission.status === 'admitted') {
    process.stdout.write('note  declaration passes; runtime behaviour is still unproven (probe lands in M3).\n')
  }
  return exitFor(flags, [verdict])
}

async function commandAudit(flags: Flags): Promise<number> {
  const env = await requireEnv(flags)
  if (env === null) return EXIT_UNAVAILABLE
  const dshHome = resolveDshHome(flags)
  const composition = await loadComposition(env, dshHome)
  const claims = collectClaims(composition, [])
  const grouped = groupClaimsBySource(claims)
  const collisions = findEntryIdCollisions(claims)
  const artifacts = await discoverLocalArtifacts({ root: env.profileDir })

  if (flags.json) {
    writeJson({
      schema_version: 1,
      command: 'audit',
      env,
      claims: [...grouped.entries()].map(([source, list]) => ({ source, entries: list })),
      collisions,
      localArtifacts: artifacts.map((artifact) => ({
        path: artifact.path,
        kind: artifact.kind,
        bytes: artifact.bytes,
        note: artifact.note,
      })),
      errors: composition.errors,
    })
    return collisions.length === 0 ? EXIT_OK : EXIT_FINDINGS
  }

  process.stdout.write(`capability ledger · dsh ${env.dsh ?? 'unknown'} · profile ${env.profile}\n`)
  for (const [source, list] of grouped) {
    process.stdout.write(`\n${source}  (${list.length} rows)\n`)
    for (const claim of list) {
      const flagsText = [claim.group ? 'group' : null, claim.disabled ? 'disabled' : null].filter(Boolean).join(', ')
      const suffix = flagsText === '' ? '' : `  [${flagsText}]`
      process.stdout.write(`  ${claim.id}${claim.name === null ? '' : `  ->  ${claim.name}`}${suffix}\n`)
    }
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
  return collisions.length === 0 ? EXIT_OK : EXIT_FINDINGS
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
  for (const layer of composition.layers) add(layer.patchText, `bundle:${layer.name}`)
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

  if (help) return { command: 'help', positionals: [], flags: { json, all, strict, execute, dshHome, profile, stamp, locale } }
  const command = positionals.shift() ?? 'help'
  return { command, positionals, flags: { json, all, strict, execute, dshHome, profile, stamp, locale } }
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
