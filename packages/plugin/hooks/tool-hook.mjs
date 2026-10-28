/**
 * In-process agent-tool probe (T-404, R36).
 *
 * WHY THIS FILE RUNS INSIDE THE SANDBOX HOST: `tests/unit/host-tool.test.ts` proves the definition
 * shape and the degradation rules against fakes. It cannot prove the one thing a user pays for:
 * that a REAL Host, running a REAL profile, exposes `compat_verdict` to the model and that one
 * call comes back with a verdict. So this probe is mounted through a launcher `--patch` overlay
 * (never in the profile manifest), asks the registry what the model can see, then calls the tool.
 *
 * WHAT IT REPORTS, AND WHAT IT DOES NOT:
 *  - `model_visible` is read from `tools.schemas()` — the exact allowlisted projection upstream
 *    sends to the model (name / description / parameters). If our tool is absent there, the model
 *    cannot call it no matter what `register()` returned.
 *  - `calls[].via` says which path answered: `registry` means the call went through
 *    `tools.execute()` (pre-execute policy, guards, timeout wrappers and all); `definition` means
 *    the registry refused it (e.g. a `ptc` deployment denies model-direct calls) and the probe
 *    invoked the registered definition directly. Both are recorded, neither is presented as the
 *    other.
 *  - It never mutates the profile, never installs anything, and never writes outside `config.out`.
 */

import { writeFileSync } from 'node:fs'

/** Cordis metadata: this row needs the tool registry, and mounts only once it exists. */
export const name = 'triage-tool-probe'
export const inject = ['tools']

/** One generation guard: only the newest apply may write (the R17 lesson, kept). */
let applyCount = 0
let newestGeneration = 0

export function apply(ctx, config = {}) {
  const out = config.out ?? null
  if (out === null) throw new Error('triage-tool-probe needs config.out')
  const toolName = config.toolName ?? 'compat_verdict'
  const calls = Array.isArray(config.calls) ? config.calls : []
  /** How long to wait for the row to register: both rows mount at boot, order is not guaranteed. */
  const waitMs = Number(config.waitMs ?? 30000)
  const started = Date.now()
  const generation = ++applyCount
  newestGeneration = generation
  const isNewest = () => generation === newestGeneration
  const write = (payload) => writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  // Not awaited: holding our own fiber in `loading` would delay the very registration we wait for.
  void (async () => {
    let definition = null
    let waited = 0
    for (;;) {
      try {
        definition = typeof ctx.tools.get === 'function' ? ctx.tools.get(toolName) : null
      } catch {
        definition = null
      }
      if (definition !== null && definition !== undefined) break
      waited = Date.now() - started
      if (waited >= waitMs) break
      await sleep(250)
      if (!isNewest()) return
    }

    let schemas = []
    let schemasError = null
    try {
      const read = typeof ctx.tools.schemas === 'function' ? ctx.tools.schemas() : null
      if (Array.isArray(read)) schemas = read
      else schemasError = 'tools.schemas() did not return an array'
    } catch (error) {
      schemasError = describe(error)
    }
    const visible = schemas.find((schema) => schema?.name === toolName) ?? null

    const results = []
    for (const [index, spec] of calls.entries()) {
      results.push(await callOnce(ctx, definition, toolName, spec, index))
      if (!isNewest()) return
    }

    /*
     * Negative control, in the same run: a name that is not registered must be absent from both
     * views. Without it, "the tool is visible" could be a registry that reports everything.
     */
    let absent = null
    try {
      const missing = typeof ctx.tools.get === 'function' ? ctx.tools.get(`${toolName}__not_registered`) : undefined
      absent = { name: `${toolName}__not_registered`, found: missing !== undefined && missing !== null }
    } catch (error) {
      absent = { name: `${toolName}__not_registered`, found: null, error: describe(error) }
    }

    write({
      kind: 'agent-tool',
      settled: true,
      sampled_at: new Date().toISOString(),
      profile: config.profile ?? null,
      runtime_version: config.runtimeVersion ?? null,
      wait_ms_wall_clock: Date.now() - started,
      tool: {
        name: toolName,
        registered: definition !== null && definition !== undefined,
        registration_waited_ms: waited,
        definition_has_execute: typeof definition?.execute === 'function',
        definition_timeout_ms: typeof definition?.timeoutMs === 'number' ? definition.timeoutMs : null,
      },
      model_visible: {
        in_schemas: visible !== null,
        description_chars: typeof visible?.description === 'string' ? visible.description.length : 0,
        parameter_keys: isRecord(visible?.parameters?.properties) ? Object.keys(visible.parameters.properties) : [],
        required: Array.isArray(visible?.parameters?.required) ? visible.parameters.required : [],
        tool_count: schemas.length,
        schema_names: schemas.map((schema) => schema?.name).filter((value) => typeof value === 'string').slice(0, 60),
        error: schemasError,
      },
      calls: results,
      negative_control: absent,
    })
  })()
}

/**
 * Call the tool once, preferring the registry pipeline.
 *
 * `tools.execute()` is what a model's call actually goes through, so it is tried first. It can
 * legitimately refuse (a `ptc` deployment denies model-direct names) — that refusal is recorded
 * and the definition is invoked directly, because "the definition answers in this Host" is still
 * a real claim, just a narrower one.
 */
async function callOnce(ctx, definition, toolName, spec, index) {
  const args = { package: spec }
  const base = { spec, index }
  if (definition === null || definition === undefined) {
    return { ...base, via: 'none', is_error: true, detail: 'the tool never registered in this Host' }
  }
  const signal = AbortSignal.timeout(60_000)
  const startedAt = Date.now()
  if (typeof ctx.tools.execute === 'function') {
    try {
      const result = await ctx.tools.execute({ callId: `triage-probe-${index}`, name: toolName, arguments: args, signal })
      const value = result?.isError === true ? null : result?.value
      if (typeof value === 'string') {
        return { ...base, via: 'registry', is_error: false, ms: Date.now() - startedAt, ...summarize(value) }
      }
      const failure = result?.isError === true ? describe(result.error ?? result) : 'tools.execute() returned no value'
      // Fall through to the definition: a refusal by policy is a fact to record, not a dead end.
      const fallback = await callDefinition(definition, args, startedAt)
      return { ...base, ...fallback, registry_refusal: failure.slice(0, 240) }
    } catch (error) {
      const refusal = describe(error)
      const fallback = await callDefinition(definition, args, startedAt)
      return { ...base, ...fallback, registry_refusal: refusal.slice(0, 240) }
    }
  }
  return { ...base, ...(await callDefinition(definition, args, startedAt)) }
}

async function callDefinition(definition, args, startedAt) {
  try {
    const value = await definition.execute(args, { signal: AbortSignal.timeout(60_000) })
    if (typeof value !== 'string') {
      return { via: 'definition', is_error: true, ms: Date.now() - startedAt, detail: 'execute() did not return a string' }
    }
    return { via: 'definition', is_error: false, ms: Date.now() - startedAt, ...summarize(value) }
  } catch (error) {
    return { via: 'definition', is_error: true, ms: Date.now() - startedAt, detail: describe(error).slice(0, 400) }
  }
}

/** Only the fields an artifact needs: the model-facing answer, parsed, plus its headline. */
function summarize(value) {
  let payload = null
  try {
    payload = JSON.parse(value)
  } catch {
    return { is_error: true, detail: 'the tool returned a non-JSON string' }
  }
  return {
    conclusion: payload?.conclusion ?? null,
    subject: payload?.subject ?? null,
    admission: payload?.admission ?? null,
    reason_message_ids: Array.isArray(payload?.verdict?.reasons)
      ? payload.verdict.reasons.map((reason) => reason?.messageId).filter((id) => typeof id === 'string')
      : [],
    missing_evidence: Array.isArray(payload?.verdict?.missingEvidence) ? payload.verdict.missingEvidence : [],
    limits: Array.isArray(payload?.limits) ? payload.limits.length : 0,
    payload_bytes: value.length,
    payload,
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}
