#!/usr/bin/env node
/**
 * Capability diff recorder (M2-a · T-202 narrowed · the primitive T-114 bisect needs).
 *
 * WHAT IT PROVES: "when this row is disabled, which tools leave the registry". It boots
 * the same sandbox Host twice — once as composed, once with a launcher overlay that
 * disables ONE patch row — reads the tool registry through the in-process probe both
 * times, and records the diff.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM:
 * - it does not say a tool "should" exist: upstream plugins declare no tool names
 *   statically, so there is no declared-vs-registered comparison to make (that boundary
 *   is written down in docs/specs/M2-capabilities.md §2);
 * - it does not attribute a disappearance to the disabled row on its own: the caller says
 *   which row was disabled (`--disable`), and the artifact records that as the
 *   experiment's premise. If `--expect` is given, the artifact also records whether the
 *   expectation held — a mismatch is a finding, not an infrastructure error.
 *
 *   node scripts/record_live_capabilities.mjs \
 *     --dsh-home <sandbox>/home --profile upstream --install <sandbox>/install \
 *     --disable tool-fs --expect read,write,edit,read_image --stamp 2026-10-27T23:30:00.000Z
 *
 * Exit codes: 0 sampled (expectation met or none given) · 1 expectation not met
 * · 3 could not sample (artifact records why).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, fileUrl, isoStamp, sha256 } from './lib/kit.mjs'
import { bootAndSample, dshMainOf, makeRedactor, redactDeep } from './lib/live.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = argOf('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601\n`)
  process.exit(2)
}

const profile = String(argOf('--profile', 'upstream'))
const dshHome = pathFor(String(argOf('--dsh-home', join(process.env['USERPROFILE'] ?? homedir(), '.dsh'))))
const installDir = pathFor(String(argOf('--install', '')))
const outDir = pathFor(String(argOf('--out', 'data/results')))
const disableRow = argOf('--disable', null)
const expectRaw = argOf('--expect', null)
const collectTimeoutMs = Number(argOf('--collect-timeout-ms', '180000'))
const settleTimeoutMs = Number(argOf('--settle-timeout-ms', '20000'))

if (disableRow === null) {
  process.stderr.write('usage: node scripts/record_live_capabilities.mjs --disable <patch-row-id> [--expect a,b,c] ...\n')
  process.exit(2)
}

const redact = makeRedactor([abs('.'), homedir(), tmpdir(), dshHome, installDir].filter((root) => root !== ''))
const profileDir = join(dshHome, 'profiles', profile)
const dshMain = dshMainOf(installDir)
const hookSource = abs('scripts/probe_hooks/inventory-hook.mjs')

const blockers = []
const evidence = []
const record = (id, ok, detail) => {
  evidence.push({ id, ok, detail })
  if (!ok) blockers.push({ id, detail })
}

record('profile-manifest', existsSync(join(profileDir, 'package.json')), redact(profileDir))
record('dsh-runtime', dshMain !== '' && existsSync(dshMain), dshMain === '' ? 'no --install directory' : redact(dshMain))
record('hook-present', existsSync(hookSource), redact(hookSource))

const core = await import(fileUrl('packages/core/dist/index.js'))

/* ------------------------------- two samples ------------------------------- */

let baseline = null
let disabled = null
const hosts = {}

if (blockers.length === 0) {
  const common = {
    dshMain,
    dshHome,
    profile,
    profileDir,
    hookSource,
    scratchRoot: resolve(dshHome, '..'),
    timeoutMs: collectTimeoutMs,
    config: { selfId: 'triage-inventory-probe', timeoutMs: settleTimeoutMs },
  }
  const first = await bootAndSample(common)
  hosts.baseline = { ...first.host, first_line: redact(first.host.first_line) }
  record('baseline-sampled', first.payload !== null && first.payload.error === undefined, first.payload === null ? String(first.error) : `entries ${first.payload.snapshot?.entries?.length ?? 0}`)
  if (first.payload !== null && first.payload.error === undefined) baseline = first.payload

  // The overlay targets the *patch* row id (`tool-fs`), while the runtime spells it
  // `include:tool-fs` — the recorder keeps both in the artifact so the experiment can be
  // repeated exactly.
  const second = await bootAndSample({
    ...common,
    extraPatch: [{ id: String(disableRow), disabled: true }],
    config: { ...common.config },
  })
  hosts.disabled = { ...second.host, first_line: redact(second.host.first_line) }
  record('disabled-sampled', second.payload !== null && second.payload.error === undefined, second.payload === null ? String(second.error) : `entries ${second.payload.snapshot?.entries?.length ?? 0}`)
  if (second.payload !== null && second.payload.error === undefined) disabled = second.payload
}

/* ------------------------------- judgement -------------------------------- */

const meta = { sampledAt: stamp }
const before = baseline === null ? null : core.parseCapabilitySnapshot(baseline.capabilities, meta)
const after = disabled === null ? null : core.parseCapabilitySnapshot(disabled.capabilities, meta)
const parseProblems = []
for (const [label, parsed] of [
  ['baseline', before],
  ['disabled', after],
]) {
  if (parsed !== null && !parsed.ok) parseProblems.push(`${label}: ${parsed.error.code} — ${parsed.error.detail}`)
}
if (parseProblems.length > 0) record('capabilities-parse', false, parseProblems.join('; '))

const expectation =
  expectRaw === null
    ? null
    : String(expectRaw)
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '')
        .sort()

let diff = null
let expectationMet = null
if (before?.ok && after?.ok) {
  diff = core.diffCapabilities(before.value, after.value)
  if (expectation !== null) {
    const removed = new Set(diff.removed)
    expectationMet = expectation.every((name) => removed.has(name))
    // Not a blocker: a failed expectation is the experiment's RESULT (this probe path
    // cannot see the tools), and the artifact must record it as a finding instead of
    // pretending the sample never happened.
    evidence.push({
      id: 'expectation',
      ok: expectationMet,
      detail: expectationMet
        ? `every expected tool left the registry: ${expectation.join(', ')}`
        : `expected ${expectation.join(', ')} to leave; actually left ${diff.removed.join(', ') || '(none)'}`,
    })
  }
  record(
    'registry-present',
    before.value.registry === 'tools' && after.value.registry === 'tools',
    `baseline=${String(before.value.registry)} disabled=${String(after.value.registry)}`,
  )
  if (before.value.readError !== null || after.value.readError !== null) {
    record('registry-read', false, `read_error: ${before.value.readError ?? after.value.readError}`)
  }
}

/** The runtime id of the disabled row, as the snapshot spells it (suffix match). */
function runtimeIdOf(payload, patchId) {
  if (payload === null) return null
  const entries = payload.snapshot?.entries ?? []
  const hit = entries.find((entry) => entry.entryId === patchId || entry.entryId.endsWith(`:${patchId}`))
  return hit === undefined ? null : hit.entryId
}

const runtimeId = runtimeIdOf(disabled, String(disableRow)) ?? runtimeIdOf(baseline, String(disableRow))
const disabledPhase =
  disabled === null || runtimeId === null
    ? null
    : ((disabled.snapshot?.entries ?? []).find((entry) => entry.entryId === runtimeId)?.fiberPhase ?? null)

const outcome =
  blockers.length > 0 ? (baseline === null || disabled === null ? 'blocked' : 'blocked') : expectationMet === false ? 'expectation-not-met' : 'sampled'

const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_live_capabilities.mjs',
  generated_at: stamp,
  sample: {
    kind: baseline === null || disabled === null ? 'live-attempt' : 'live',
    profile,
    dsh_home: redact(dshHome),
    transport: before?.ok ? before.value.transport : null,
    registry_scope: 'process-global (the probe context), NOT an agent/preset scope',
    presentation: before?.ok ? before.value.presentation : null,
  },
  experiment: {
    disabled_patch_row: String(disableRow),
    disabled_runtime_entry: runtimeId,
    disabled_phase: disabledPhase,
    expectation: expectation === null ? null : { tools: expectation, source: 'operator (--expect); upstream declares no tool names statically' },
    expectation_met: expectationMet,
  },
  outcome,
  blockers,
  evidence,
  hosts,
  baseline: before?.ok
    ? {
        sampled_at: before.value.sampledAt,
        registry: before.value.registry,
        tools: before.value.tools.map((tool) => tool.name),
        unjudged: before.value.unjudged,
        read_error: before.value.readError,
      }
    : null,
  disabled: after?.ok
    ? {
        sampled_at: after.value.sampledAt,
        registry: after.value.registry,
        tools: after.value.tools.map((tool) => tool.name),
        unjudged: after.value.unjudged,
        read_error: after.value.readError,
      }
    : null,
  diff,
  // A diff answers "what changed", never "what should have been there".
  boundary: {
    cannot_judge: 'declared tool missing from the registry: upstream plugins publish no static tool names',
    cannot_reach:
      'tool plugins register into AGENT/PRESET scopes, so a process-level probe sees only the global layer (measured: 1 tool, `working_directory`); a real session or M3 probe is required to read a preset surface',
    cannot_see_mode:
      'a `ptc` deployment collapses the model-facing surface to `run_code`; the probe forces a native view in its own scope, and records which presentation each sample used',
    reference: 'docs/specs/M2-capabilities.md §2',
  },
}

mkdirSync(outDir, { recursive: true })
const fileName = `capabilities-${stamp.replaceAll(':', '-')}.json`
const target = join(outDir, fileName)
const text = `${JSON.stringify(redactDeep(artifact, redact), null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

process.stdout.write(`wrote ${redact(target)}\n`)
process.stdout.write(
  `outcome ${outcome} · baseline ${artifact.baseline?.tools.length ?? 0} tools · disabled ${artifact.disabled?.tools.length ?? 0} · removed ${diff?.removed.join(',') || '(none)'} · expectation_met ${String(expectationMet)}\n`,
)
if (outcome === 'blocked') {
  for (const blocker of blockers) process.stdout.write(`blocked  ${blocker.id}: ${blocker.detail}\n`)
  process.exit(3)
}
if (expectationMet === false) process.exit(1)
