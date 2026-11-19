#!/usr/bin/env node
/**
 * "What does the installed build actually offer when a profile's official pins go stale?" (R122)
 *
 * WHY THIS EXISTS: two upstream reports on 2026-11-19 (`#13730` macOS, `#13748` Windows) describe the
 * same failure — the app updates its runtime to a new rc and leaves the profile's exact
 * `@deepseek-ai/*` pins behind, so the startup preflight denies a row and a required service never
 * appears. `#13730` concludes "the only supported way out is the compatibility exemption" and says it
 * must be re-granted after every runtime update. That conclusion is checkable against the build we
 * have installed, and it is wrong in two ways:
 *
 *   1. the bundled CLI runs the ordinary `dsh` CLI with `manageDesktopProfile: true`, which is exactly
 *      the flag that lifts the "profile desktop is managed exclusively by the Electron application"
 *      refusal — so the reserved profile *is* reachable for `plugin add`, which aligns the pins
 *      instead of exempting them;
 *   2. the same CLI ships `plugin allow-version` / `revoke-version` / `version-exemptions`, i.e. a
 *      supported way to write and undo the very `compatibility.json` entry `#13730` hand-edits.
 *
 * The alternative — repeating someone else's shell transcript — is what this repository calls an
 * unmeasured claim. So the readings are taken from the archive itself: which markers exist, which call
 * sites of the refusal are guarded, and what this machine's own profile looks like (a negative
 * control: it boots on the same runtime with zero official pins).
 *
 * WHAT IT IS NOT: it does not run the CLI (that would touch a profile), does not decide whether the
 * command succeeds on the reporter's OS, and says nothing about any machine but this one.
 *
 *   node scripts/record_updater_drift.mjs
 *   node scripts/record_updater_drift.mjs --asar "C:/path/to/resources/app.asar" --profile desktop
 *
 * EXIT: 0 artifact written · 2 usage, or nothing measurable (no archive and no profile is not a "no").
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { writeEvidence } from './lib/evidence.mjs'
import { fileUrl, isoStamp } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601\n`)
  process.exit(2)
}
const outDir = String(argOf('--out', 'data/results'))
const profileName = String(argOf('--profile', 'desktop')).trim()
if (!/^[A-Za-z0-9._-]+$/.test(profileName)) {
  process.stderr.write('usage: node scripts/record_updater_drift.mjs [--asar <path>] [--profile <name>] [--out <dir>] [--stamp <iso>]\n')
  process.exit(2)
}

const defaultAsar = () => {
  const override = process.env.DSH_DESKTOP_ASAR
  if (typeof override === 'string' && override.length > 0) return override
  if (process.platform !== 'win32') return null
  const local = process.env.LOCALAPPDATA
  if (typeof local !== 'string' || local.length === 0) return null
  return join(local, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar')
}
const asarPath = String(argOf('--asar', defaultAsar() ?? ''))

const core = await import(fileUrl('packages/core/dist/index.js'))

/**
 * Read the archive and answer four questions about the shipped CLI surface.
 *
 * Markers are searched across every `lib/*.js` of `@deepseek-ai/dsh` because the build renames its
 * chunks per release (`bin-CwxESKe-.js`, `plugin-DC80YBt4.js`); a recorder that hard-codes those names
 * would silently report "absent" on the next rc and read like a finding.
 */
const readInstallation = () => {
  if (asarPath === '' || !existsSync(asarPath)) {
    return { state: 'unreadable', detail: asarPath === '' ? 'no --asar given and no default archive found' : `no archive at ${asarPath}` }
  }
  const archive = core.openAsar(asarPath)
  if ('code' in archive) return { state: 'unreadable', detail: `${archive.code}: ${archive.detail}` }

  const packages = core.asarKernelPackages(archive)
  const host = packages.get('@deepseek-ai/dsh-desktop-host')
  const dshDir = ['dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib']
  const dirNode = core.asarLookup(archive, dshDir)
  const chunks = dirNode !== null && 'files' in dirNode ? Object.keys(dirNode.files ?? {}).filter((name) => name.endsWith('.js')) : []
  const sources = new Map(
    chunks.map((name) => {
      const buffer = core.asarReadFile(archive, [...dshDir, name])
      return [name, buffer === null ? '' : buffer.toString('utf8')]
    }),
  )
  const all = [...sources.values()].join('\n')

  const cliPath = ['dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js']
  const cliBuffer = core.asarReadFile(archive, cliPath)
  const cliText = cliBuffer === null ? '' : cliBuffer.toString('utf8')

  /* The refusal itself, and which call sites guard it behind `manageDesktopProfile`. */
  const refusalPattern = /rejectElectronProfile\(\s*(\w+)\s*,\s*([^)]*)\)/g
  const calls = []
  for (const match of all.matchAll(refusalPattern)) {
    const before = all.slice(Math.max(0, match.index - 90), match.index)
    // The declaration has the same shape as the boot-site call (`program, profile`): skip it by name.
    if (/\bfunction\s+$/.test(before)) continue
    calls.push({
      program: match[1],
      guarded_by_manage_desktop_profile: /if\s*\(\s*!\s*manageDesktopProfile\s*\)\s*$/.test(before),
      verbatim: `${before.trim().slice(-70)}${match[0]}`.replace(/\s+/g, ' '),
    })
  }
  const refused = all.indexOf('is managed exclusively by the Electron application')
  const bootCall = calls.find((call) => call.program === 'program') ?? null
  const pluginCall = calls.find((call) => call.program === 'plugin') ?? null

  const findIn = (needle) => [...sources.entries()].filter(([, text]) => text.includes(needle)).map(([name]) => name)

  const excerpt = (needle, span = 170) => {
    const at = all.indexOf(needle)
    return at === -1 ? null : all.slice(at, at + span).replace(/\s+/g, ' ')
  }
  const cliExcerpt = (() => {
    const at = cliText.indexOf('runCli({')
    return at === -1 ? null : cliText.slice(Math.max(0, at - 40), at + 150).replace(/\s+/g, ' ')
  })()

  return {
    state: 'measured',
    archive_bytes: archive.buffer.length,
    archive_sha256: createHash('sha256').update(archive.buffer).digest('hex'),
    kernel_packages: packages.size,
    desktop_host_version: host === undefined ? null : (host['version'] ?? null),
    chunks_scanned: chunks.length,
    cli_entry: {
      present: cliBuffer !== null,
      bytes: cliBuffer === null ? 0 : cliBuffer.length,
      manage_desktop_profile: /manageDesktopProfile\s*:\s*true/.test(cliText),
      verbatim: cliExcerpt,
    },
    reserved_profile_refusal: {
      message_present: refused !== -1,
      verbatim: refused === -1 ? null : all.slice(Math.max(0, refused - 42), refused + 52).replace(/\s+/g, ' '),
      call_sites: calls,
      shape: {
        boot_refused_always: bootCall === null ? null : bootCall.guarded_by_manage_desktop_profile === false,
        plugin_refused_unless_manage_desktop_profile: pluginCall === null ? null : pluginCall.guarded_by_manage_desktop_profile === true,
      },
    },
    plugin_surface: {
      allow_version: findIn('allow-version'),
      revoke_version: findIn('revoke-version'),
      version_exemptions: findIn('version-exemptions'),
      set_profile_version_exemption: findIn('setProfileVersionExemption'),
      require_desktop_profile: findIn('requireDesktopProfile'),
      pnpm_forwarded_verbatim: findIn('add <pkg>, remove <pkg>, why <pkg>'),
      help_line: excerpt('dsh plugin --profile <name> <pnpm-args...>'),
      accept_risk_warning: excerpt('allowing incompatible plugin versions can break'),
      remediation_hint: excerpt('to accept the risk, run:'),
    },
  }
}

/** What this machine's own profile looks like: the control that explains why nothing broke here. */
const readLocalProfile = () => {
  const homeSource = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0 ? 'DSH_HOME' : 'default'
  const dshHome = homeSource === 'DSH_HOME' ? String(process.env.DSH_HOME) : join(homedir(), '.dsh')
  const dir = join(dshHome, 'profiles', profileName)
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    return { state: 'unreadable', detail: `no profile manifest at ~/.dsh/profiles/${profileName}/package.json`, home_source: homeSource }
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return { state: 'unreadable', detail: error instanceof Error ? error.message : String(error), home_source: homeSource }
  }
  const dependencies = manifest?.dependencies !== null && typeof manifest?.dependencies === 'object' ? Object.keys(manifest.dependencies) : []
  const officialPins = dependencies.filter((name) => name.startsWith('@deepseek-ai/'))
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles.map(String) : []
  return {
    state: 'measured',
    home_source: homeSource,
    profile: profileName,
    profile_dir: `~/.dsh/profiles/${profileName}`,
    dependencies: dependencies.length,
    official_pins: officialPins,
    official_pin_count: officialPins.length,
    bundles: bundles.length,
    official_bundles: bundles.filter((name) => name.startsWith('@deepseek-ai/')).length,
    compatibility_json: existsSync(join(dir, 'compatibility.json')),
  }
}

const installation = readInstallation()
const localProfile = readLocalProfile()

if (installation.state !== 'measured' && localProfile.state !== 'measured') {
  process.stderr.write('nothing was measured, so nothing is written (an unreadable archive is not a "no")\n')
  process.exit(2)
}

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_updater_drift.mjs',
  generated_at: stamp,
  question:
    'when an app update moves the runtime but leaves a profile\'s exact @deepseek-ai/* pins behind, what does the installed build offer — and does this machine\'s profile have that shape?',
  installation,
  local_profile: localProfile,
  limits: [
    'one build on one machine: the archive proves which surfaces ship, not that the command succeeds on another OS',
    'the CLI is read, never executed — running `plugin` would write to a profile, and this recorder is read-only',
    'local_profile is a negative control for this machine only; zero official pins is why the rc.3 → rc.5 update here produced no denial',
    'markers are searched across every `dsh/lib/*.js` chunk because the build renames them per release; a marker hit means the string is in the shipped code, nothing about reachability',
  ],
}

const result = writeEvidence({
  outDir,
  fileName: `updater-drift-${stamp.replace(/[:.]/g, '-')}.json`,
  text: `${JSON.stringify(payload, null, 2)}\n`,
})
if (!result.ok) {
  process.stderr.write(`refusing to overwrite existing evidence: ${result.target}\n`)
  process.exit(2)
}

if (installation.state === 'measured') {
  process.stdout.write(
    `installation: dsh-desktop-host ${String(installation.desktop_host_version)} · ${installation.kernel_packages} kernel packages · cli manageDesktopProfile=${String(installation.cli_entry.manage_desktop_profile)}\n`,
  )
  for (const call of installation.reserved_profile_refusal.call_sites) {
    process.stdout.write(`  refusal call ${call.program}: guarded=${String(call.guarded_by_manage_desktop_profile)}\n`)
  }
  process.stdout.write(`  plugin surface: allow-version=${installation.plugin_surface.allow_version.length > 0} revoke-version=${installation.plugin_surface.revoke_version.length > 0} version-exemptions=${installation.plugin_surface.version_exemptions.length > 0}\n`)
} else {
  process.stdout.write(`installation: unreadable (${installation.detail})\n`)
}
if (localProfile.state === 'measured') {
  process.stdout.write(
    `local profile ${localProfile.profile}: ${localProfile.dependencies} dep(s), ${localProfile.official_pin_count} official pin(s), ${localProfile.bundles} bundle(s) (${localProfile.official_bundles} official), compatibility.json=${String(localProfile.compatibility_json)}\n`,
  )
} else {
  process.stdout.write(`local profile: unreadable (${localProfile.detail})\n`)
}
process.stdout.write(`ssot ${result.display} sha256=${result.sha256.slice(0, 12)}…\n`)
