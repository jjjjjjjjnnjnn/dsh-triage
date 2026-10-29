#!/usr/bin/env node
/**
 * Does a real Host actually give the model a `compat_verdict` tool, and does one call answer?
 * (T-404, R36)
 *
 * WHY THIS SCRIPT EXISTS: `tests/unit/host-tool.test.ts` proves the definition shape and every
 * degradation path against fakes. It cannot prove the three things a user pays for:
 *
 *   1. the row mounts in a profile and the tool reaches the REGISTRY (not just `apply` running);
 *   2. `tools.schemas()` — the allowlisted projection upstream sends to the model — carries our
 *      name, description and parameter, so a model could actually call it;
 *   3. one call on a REAL profile, with a REAL registry read, comes back with a verdict, and a
 *      package that does not exist comes back as an honest `unknown` instead of a throw.
 *
 * HOW: the four workspace packages are installed into a throwaway DSH home as `file:`
 * dependencies (no registry, no credentials), the Host is booted with a one-row `--patch` overlay
 * that mounts `packages/plugin/hooks/tool-hook.mjs`, and the hook asks the registry the questions
 * above and writes the answers where this script can read them.
 *
 *   node scripts/record_agent_tool.mjs --dsh-main <...>/lib/bin.js --stamp 2026-10-29T12:00:00.000Z
 *
 * Exit codes: 0 the artifact says every claim passed · 1 a claim failed · 2 bad usage
 * · 3 nothing was sampled (the artifact records why).
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { SANDBOX_PNPM_WORKSPACE, buildWorkspaceBundle, sandboxProfileManifest } from './lib/bundle.mjs'
import { abs, isoStamp } from './lib/kit.mjs'
import { bootAndSample } from './lib/live.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
const dshMain = pathFor(String(argOf('--dsh-main', '')))
const outDir = pathFor(argOf('--out', 'data/results'))
const label = String(argOf('--label', 'agent-tool')).replace(/[^a-zA-Z0-9._-]+/g, '-')
const bootTimeoutMs = Number(argOf('--boot-timeout-ms', '180000'))
const runtimeVersion = String(argOf('--dsh-version', '0.2.1-rc.4'))
/**
 * `native` (default) is the deployment the R36 artifact measured: the model calls the
 * tool directly and `tools.execute()` answers.
 *
 * `ptc` puts the `tools` row in `mode: ptc`, where the model only gets `run_code` and a
 * model-direct call is refused by policy. That refusal is the branch `BS-39` says had
 * never been seen on a real Host — the hook falls back to the registered definition and
 * records `registry_refusal` (packages/plugin/hooks/tool-hook.mjs).
 */
const toolsMode = String(argOf('--tools-mode', 'native'))
if (!['native', 'ptc'].includes(toolsMode)) {
  process.stderr.write(`invalid --tools-mode "${toolsMode}": expected native or ptc\n`)
  process.exit(2)
}
/** A name npm cannot have. The negative control has to be impossible, not merely unlikely. */
const absentPackage = String(argOf('--absent', 'dsh-triage-no-such-plugin-9f3a2c'))
/*
 * THREE CALLS, THREE SHAPES. The expectations were measured before the run with
 * `check --dsh-home <the same sandbox home> --profile web`, i.e. against the SAME runtime the Host
 * will report (0.2.1-rc.4):
 *   `@lolkda/dsh-skills-manager@0.3.1` declares @deepseek-ai/dsh* peers that admit 0.2.1-rc.4 → go
 *   `dsh-cost-meter@1.7.43`           declares a range that rejects it                    → blocked
 *   a name npm cannot have                                                                → unknown
 *
 * WHY THE RUNTIME MATTERS (found while writing this): the same `dsh-mcp-connector@0.2.83` is `go`
 * at 0.2.1-rc.4 and `blocked` at the operator's 0.1.0-rc.6. The tool answers about the profile the
 * Host serves — that is the point of asking it from inside an agent session — so a CLI run against
 * a different home is not a contradiction, it is a different question.
 *
 * Pinned specs on purpose (`docs/adr/0004`): two runs must be comparable. If a publisher changes
 * these declarations, the claim fails here instead of being silently re-narrated.
 */
const CALLS = [
  { id: 'call-go', spec: String(argOf('--call-go', '@lolkda/dsh-skills-manager@0.3.1')), expect: 'go' },
  { id: 'call-blocked', spec: String(argOf('--call-blocked', 'dsh-cost-meter@1.7.43')), expect: 'blocked' },
  { id: 'call-unknown', spec: absentPackage, expect: 'unknown' },
]

if (stamp === null || !existsSync(dshMain)) {
  process.stderr.write(
    'usage: node scripts/record_agent_tool.mjs --dsh-main <install>/node_modules/@deepseek-ai/dsh/lib/bin.js --stamp <iso>\n',
  )
  process.exit(2)
}

const root = join(tmpdir(), 'dsh-triage-agent-tool', `${label}-${Date.now().toString(36)}`)
const home = join(root, 'home')
const profileDir = join(home, 'profiles', 'web')
const bundleRoot = join(profileDir, '.tool-bundle')
const steps = []
let verbose = argv.includes('--verbose')

const redactRoots = [abs('.'), homedir(), tmpdir()]
const clean = (value) => {
  let text = String(value ?? '')
  for (const item of redactRoots) {
    for (const variant of [item, item.replaceAll('\\', '/')]) {
      text = text.split(variant).join(item === abs('.') ? '<repo>' : '~')
    }
  }
  return text
}
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const record = (id, status, detail, extra = {}) => {
  /*
   * R40: a boolean passed where a status string belonged produced a step with status `true`,
   * which the reporter printed as `--` and the outcome calculation ignored — a silently
   * unreviewed step inside a "passed" artifact. Refuse anything that is not a real verdict.
   */
  if (status !== 'passed' && status !== 'failed') {
    throw new Error(`record(${id}) got status ${JSON.stringify(status)}: only 'passed' or 'failed' are verdicts`)
  }
  steps.push({ id, status, detail: clean(detail), ...extra })
  if (verbose) process.stderr.write(`  ${id}: ${status}\n`)
}

function run(command, args, options) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 600_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
  })
}

async function main() {
  const bundle = buildWorkspaceBundle({ targetRoot: bundleRoot, pathFor })
  record('bundle', 'passed', `${Object.keys(bundle.dependencies).length} workspace deps rewritten to file:`, {
    dependencies: bundle.dependencies,
  })

  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify(
      sandboxProfileManifest({ bundleDir: bundle.dir, runtimeVersion, name: 'dsh-profile-agent-tool' }),
      null,
      2,
    )}\n`,
    'utf8',
  )
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n', 'utf8')
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), SANDBOX_PNPM_WORKSPACE, 'utf8')

  const env = {
    ...process.env,
    DSH_HOME: home,
    // Never inherit an npm credential (rule 4): the sandbox gets an empty user config.
    npm_config_userconfig: join(root, 'empty-npmrc'),
  }
  writeFileSync(join(root, 'empty-npmrc'), '', 'utf8')

  const installed = await run(process.execPath, [dshMain, 'plugin', '--profile', 'web', 'install'], {
    cwd: home,
    env,
    timeoutMs: 600_000,
  })
  if (installed.code !== 0) {
    record('install', 'failed', `${installed.stdout}\n${installed.stderr}`.trim().slice(-800) || `exit ${installed.code}`)
    return await finish(null, { sampled: false, reason: 'install failed' })
  }
  record('install', 'passed', `${installed.stdout}\n${installed.stderr}`.trim().split('\n').slice(-2).join(' · ') || 'exit 0')

  const hookSource = abs('packages/plugin/hooks/tool-hook.mjs')
  if (!existsSync(hookSource)) {
    record('hook', 'failed', `${clean(hookSource)} is missing`)
    return await finish(null, { sampled: false, reason: 'probe hook missing' })
  }

  const sample = await bootAndSample({
    dshMain,
    dshHome: home,
    profile: 'web',
    profileDir,
    hookSource,
    scratchRoot: root,
    timeoutMs: bootTimeoutMs,
    env,
    appArgs: ['--port', '0', '--no-open'],
    extraPatch: toolsMode === 'ptc' ? [{ id: 'tools', config: { mode: 'ptc' } }] : [],
    config: {
      profile: 'web',
      runtimeVersion,
      // The probe waits this long for our row to register: both rows mount at boot and the
      // order is not ours to choose.
      waitMs: 60_000,
      calls: CALLS.map((call) => call.spec),
    },
  })
  const payload = sample.payload
  record(
    'boot',
    payload === null ? 'failed' : 'passed',
    payload === null
      ? `no sample: ${clean(String(sample.error))}`
      : `Host answered in ${sample.seconds}s (stopped by ${sample.replacement.stoppedBy})`,
    { payload_bytes: payload === null ? 0 : JSON.stringify(payload).length },
  )
  if (payload === null) return await finish(null, { sampled: false, reason: 'the probe wrote no sample' })

  /* ------------------------------- the claims ------------------------------- */

  const tool = payload.tool ?? {}
  const visible = payload.model_visible ?? {}
  const calls = Array.isArray(payload.calls) ? payload.calls : []
  const ptc = toolsMode === 'ptc'

  record('tools-mode', 'passed', `the probe asked the Host for mode=${toolsMode}`, { tools_mode: toolsMode })

  record('registered', tool.registered === true ? 'passed' : 'failed', `registered=${String(tool.registered)} · waited ${tool.registration_waited_ms}ms`, {
    registration_waited_ms: tool.registration_waited_ms ?? null,
    definition_timeout_ms: tool.definition_timeout_ms ?? null,
  })
  /*
   * The model-facing projection is the claim that matters: a tool the registry holds but does not
   * publish to the model is a tool nobody can call.
   *
   * R40 MEASURED SOMETHING DIFFERENT FROM WHAT WE EXPECTED, so the assertion follows the
   * measurement: under `mode: ptc` this Host's `schemas()` STILL lists the plugin tools
   * (`compat_verdict`, `working_directory`) and ADDS `run_code`. What changes is the call path,
   * not the projection. Requiring our tool to vanish would have failed a correct deployment.
   */
  const schemaNames = Array.isArray(visible.schema_names) ? visible.schema_names : []
  record(
    'tools-mode-observed',
    (ptc ? schemaNames.includes('run_code') : !schemaNames.includes('run_code')) ? 'passed' : 'failed',
    ptc
      ? `ptc is really active: schemas() = [${schemaNames.join(', ')}]`
      : `native is really active: schemas() = [${schemaNames.join(', ')}] (no run_code)`,
    { schema_names: schemaNames },
  )
  record(
    'model-visible',
    visible.in_schemas === true ? 'passed' : 'failed',
    visible.in_schemas === true
      ? `${payload.tool?.name} is in schemas(): ${String(visible.description_chars)} description chars, parameters [${visible.parameter_keys.join(', ')}] (${visible.tool_count} tools visible${ptc ? ', ptc adds run_code' : ''})`
      : `not in tools.schemas(): ${String(visible.error ?? 'absent')}`,
    {
      parameter_keys: visible.parameter_keys ?? [],
      required: visible.required ?? [],
      tool_count: visible.tool_count ?? null,
      schema_names: schemaNames,
    },
  )

  /*
   * BS-39: WHICH PATH ANSWERED. In `native` the call must go through `tools.execute()`
   * (pre-execute policy, guards, timeout wrappers — the pipeline a model really uses). In
   * `ptc` the registry refuses model-direct calls, so the hook must fall back to the
   * definition WITH a recorded refusal reason. Either way the branch is named in the
   * artifact instead of being inferred from the conclusion.
   */
  const expectedVia = ptc ? 'definition' : 'registry'
  const viaMismatch = calls.filter((call) => call?.via !== expectedVia)
  const missingRefusal = ptc ? calls.filter((call) => typeof call?.registry_refusal !== 'string' || call.registry_refusal.length === 0) : []
  record(
    `fallback-witness-${toolsMode}`,
    calls.length === CALLS.length && viaMismatch.length === 0 && missingRefusal.length === 0 ? 'passed' : 'failed',
    ptc
      ? `${calls.filter((call) => call?.via === 'definition').length}/${calls.length} call(s) answered by the registered definition after the registry refused: ${calls.map((call) => String(call?.registry_refusal ?? '')).find((text) => text.length > 0)?.slice(0, 100) ?? 'no refusal recorded'}`
      : `${calls.filter((call) => call?.via === 'registry').length}/${calls.length} call(s) went through tools.execute()`,
    {
      expected_via: expectedVia,
      actual_via: calls.map((call) => call?.via ?? null),
      registry_refusals: calls.map((call) => call?.registry_refusal ?? null),
    },
  )
  record(
    'negative-control-absent',
    payload.negative_control?.found === false ? 'passed' : 'failed',
    payload.negative_control?.found === false
      ? `${String(payload.negative_control?.name)} is absent from the registry (so "visible" is not an always-true reading)`
      : `the absent name was found: ${String(payload.negative_control?.found)}`,
  )

  for (const [index, call] of CALLS.entries()) {
    const answer = calls[index] ?? null
    record(
      call.id,
      answer !== null && answer.is_error === false && answer.conclusion === call.expect ? 'passed' : 'failed',
      answer === null
        ? `the probe made no call for ${call.spec}`
        : `${answer.spec} → ${String(answer.conclusion)} via ${String(answer.via)}${answer.registry_refusal === undefined ? '' : ` (registry refused: ${String(answer.registry_refusal).slice(0, 80)})`}`,
      {
        expected: call.expect,
        actual: answer?.conclusion ?? null,
        via: answer?.via ?? null,
        admission: answer?.admission ?? null,
        reason_message_ids: answer?.reason_message_ids ?? [],
      },
    )
  }
  /*
   * The tool may not answer without saying what a `go` does not mean: output is quoted far from
   * the docs that qualify it.
   */
  const limits = Array.isArray(calls[0]?.payload?.limits) ? calls[0].payload.limits : []
  record(
    'limits-stated',
    limits.length >= 3 ? 'passed' : 'failed',
    `${limits.length} limit line(s) in the model-facing payload`,
  )

  return await finish(payload, { sampled: true })
}

async function finish(payload, outcome) {
  const failed = steps.filter((step) => step.status === 'failed')
  /*
   * EVERY verdict the tool produced is lifted to the top level (`verdict` + `verdicts[]`) on
   * purpose: `gate_verdict_contract` validates both keys, so the tool's answers are held to the
   * same contract as every other artifact in `data/results/` instead of being an unvalidated blob
   * nested inside a probe sample. The three shapes (go / blocked / unknown) exercise the
   * remediation and missingEvidence assertions for free.
   */
  const verdicts = (Array.isArray(payload?.calls) ? payload.calls : [])
    .map((call) => call?.payload?.verdict)
    .filter((value) => value !== null && value !== undefined)
  const artifact = {
    schema_version: 1,
    produced_by: 'scripts/record_agent_tool.mjs',
    generated_at: stamp,
    label,
    outcome: outcome.sampled !== true ? 'blocked' : failed.length === 0 ? 'passed' : 'failed',
    sandbox: {
      home: clean(home),
      profile: 'web',
      runtime_version: runtimeVersion,
      tools_mode: toolsMode,
      bundle: 'file:packages/* (workspace rewritten)',
      calls: CALLS.map((call) => ({ spec: call.spec, expected: call.expect })),
      probe: 'packages/plugin/hooks/tool-hook.mjs via a one-row --patch overlay',
    },
    steps,
    // The tool's own answers, under the keys the contract gate reads.
    verdict: verdicts[0] ?? null,
    verdicts,
    probe_sample: payload,
    limits: [
      'the row is installed from local directories with workspace deps rewritten to file: — no registry and no credentials are involved',
      'the registry read inside the tool is real (npm); every candidate is pinned so two runs are comparable',
      'the tool answers about the runtime of the profile this Host serves — a `check` run against a different DSH home asks a different question and may legitimately disagree',
      'the probe calls the tool either through `tools.execute()` or, when the registry refuses (e.g. a ptc deployment), through the registered definition — `calls[].via` says which',
      'under `--tools-mode ptc` the probe patches the `tools` row to `mode: ptc`; the patch replaces that row config wholesale (dsh-app-boot applies a shallow override), and the artifact records the mode instead of assuming the rest survived',
      'in ptc mode the model-facing projection is `run_code` only, so "the tool is not in schemas()" is the expected shape, not a defect — callability from a `run_code` program is NOT tested here',
      'this proves registration, model visibility and three answered calls on one Windows machine and one runtime; it is not proof that a model would choose the tool, nor a security judgement',
    ],
  }

  // Kill anything still holding the sandbox before deleting it (R31: a retry loop chased a lock).
  let removed = false
  for (let attempt = 0; attempt < 10 && !removed; attempt += 1) {
    try {
      rmSync(root, { recursive: true, force: true })
      removed = true
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    }
  }
  record('cleanup', removed ? 'passed' : 'failed', removed ? 'sandbox removed' : 'leaked: the sandbox directory could not be removed', {
    removed,
  })
  artifact.outcome = outcome.sampled !== true ? 'blocked' : steps.some((step) => step.status === 'failed') ? 'failed' : 'passed'

  mkdirSync(outDir, { recursive: true })
  const text = `${JSON.stringify(artifact, null, 2)}\n`
  const target = join(outDir, `${label}-${stamp.replaceAll(':', '-')}.json`)
  writeFileSync(target, text, 'utf8')
  writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

  const relative = target.replaceAll('\\', '/').split('/data/results/').pop()
  process.stdout.write(`${artifact.outcome} · ${basename(target)}\n`)
  for (const step of steps) process.stdout.write(`  ${step.status === 'passed' ? 'ok  ' : step.status === 'failed' ? 'FAIL' : '--  '} ${step.id}: ${step.detail}\n`)
  process.stdout.write(`  ${relative}\n`)
  process.exitCode = artifact.outcome === 'passed' ? 0 : artifact.outcome === 'blocked' ? 3 : 1
}

await main()
