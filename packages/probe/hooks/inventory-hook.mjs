/**
 * In-process inventory probe (T-201 P1 · input side of B1/B2).
 *
 * WHY THIS FILE LIVES IN THE REPO BUT RUNS INSIDE THE SANDBOX HOST: the phase layer
 * (`packages/core/src/inventory.ts`) is only proven on synthetic samples. The honest
 * way to close that gap is to read the phases where they exist — inside a mounted
 * Host — without inventing a second truth. Upstream exports exactly the function its
 * own Remote method calls:
 *
 *     // @deepseek-ai/dsh-host-plugin-inventory/lib/index.js
 *     async list() { return readPluginInventory(this.ctx) }
 *
 * So this hook calls `readPluginInventory(ctx)` and writes the payload verbatim. It
 * is NOT a `pluginInventory/list` Remote call, and the artifacts it feeds must say so
 * (`transport: 'in-process-projection'`) — see tests/unit/inventory.test.ts.
 *
 * HOW IT IS MOUNTED: `scripts/record_live_inventory.mjs` copies this file to
 * `<profile>/.triage-probe/inventory-hook.mjs` and passes a one-entry `--patch`
 * overlay (`{ insert: [{ id, name: './.triage-probe/inventory-hook.mjs', config }] }`).
 * Cordis resolves a `./` module name against the include file's directory, so the
 * probe never touches the profile manifest and never survives the run.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 * - it never mutates the tree, never enables/disables anything;
 * - it never reports a snapshot it did not read: a throw writes `{error}` and the
 *   recorder turns that into `outcome: blocked`, never into zero rows;
 * - it never resolves a transient phase into a conclusion: it waits until no entry is
 *   `pending`/`loading` (or a timeout) and records how long that took (`wait_ms`), so
 *   a `null` phase in the artifact is a settled fact, not a race.
 */

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Cordis metadata: this row needs the Loader service to project. */
export const name = 'triage-inventory-probe'
export const inject = ['loader']

/** Phases that mean "the tree is still moving"; a sample taken now would be a race. */
const TRANSIENT = new Set(['pending', 'loading', 'unloading'])

/**
 * How many times Cordis applied this plugin in this Host process.
 *
 * WHY IT MATTERS (R17): when a fiber's injected services change, Cordis unloads it
 * (`fiber.store` becomes `undefined`) and, when they are available again, **re-runs
 * `apply`**. A task started by an earlier apply therefore keeps running against a dead
 * context while a newer one is already sampling. Two rules follow:
 *
 *   1. a task may only write while its own fiber is still active (`fiber.state === 2`);
 *   2. only the newest generation may write — otherwise a dying task would overwrite a
 *      healthy sample with its own error.
 */
let applyCount = 0
let newestGeneration = 0

export function apply(ctx, config = {}) {
  const out = config.out ?? null
  if (out === null) throw new Error('triage-inventory-probe needs config.out')

  const selfId = config.selfId ?? 'triage-inventory-probe'
  const settleTimeoutMs = Number(config.timeoutMs ?? 15000)
  const intervalMs = Number(config.intervalMs ?? 250)
  /** Budget for "the context is not usable yet"; Cordis re-applies when it becomes usable. */
  const retryMs = Number(config.retryMs ?? 20000)
  /** Resolve upstream's projection from the tree that is actually running, not from ours. */
  const resolveFrom = config.resolveFrom ?? null
  const started = Date.now()
  const generation = ++applyCount
  newestGeneration = generation
  const attempts = []

  const write = (payload) => {
    writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }
  const isNewest = () => generation === newestGeneration

  // Deliberately not awaited: awaiting inside `apply` would keep our own root fiber in
  // `loading`, and then "no transient entries" could never become true.
  void (async () => {
    // Phase 1: wait until the projection can be read at all. A read can throw because the
    // tree is still composing (`inactive context`), which is a MEASUREMENT failure, not a
    // candidate failure -- the artifact has to be able to say that.
    let projection = null
    let snapshot = null
    for (;;) {
      try {
        if (projection === null) projection = await loadProjection(resolveFrom)
        snapshot = await projection.readPluginInventory(ctx)
        attempts.push({ n: attempts.length + 1, ms: Date.now() - started, ok: true, fiber_state: fiberStateOf(ctx) })
        break
      } catch (error) {
        attempts.push(attemptEntry(attempts.length + 1, Date.now() - started, error, ctx))
        // A dead context cannot be revived from inside this task: retrying it would only
        // spin until the budget. The observable facts (state, remaining budget) are kept
        // so the artifact can say "not measured" instead of "budget exceeded".
        if (fiberStateOf(ctx) !== 2 || Date.now() - started >= retryMs) break
        await sleep(Math.min(2_000, 250 * 2 ** Math.min(attempts.length - 1, 3)))
      }
    }

    if (snapshot === null) {
      writeFailure(config, { out, started, attempts, generation, isNewest, settleTimeoutMs, write })
      return
    }

    // Phase 2: wait until no entry is transient. The budget starts at the first successful
    // read, not at apply time: the retry above already consumed part of the wall clock.
    const settleStarted = Date.now()
    let selfEntryId = null
    let settled = false
    for (;;) {
      // Our own row is spelled by the loader, not by us: on a bundled profile it is
      // `include:triage-inventory-probe`. Matching it by exact id left the probe in the
      // scored rows (the adversary caught this), so match the tail too.
      selfEntryId = findSelfEntryId(snapshot.entries, selfId)
      const moving = snapshot.entries.filter(
        (entry) => entry.entryId !== selfEntryId && TRANSIENT.has(entry.fiberPhase),
      )
      // Preset rows need the same settling condition: a `pending` preset row is just as
      // transient as a `pending` loader row, and judging it would report a race.
      const movingPresets = (snapshot.agentPresets ?? []).flatMap((preset) =>
        (preset.rows ?? []).filter((row) => TRANSIENT.has(row.fiberPhase)),
      )
      settled = moving.length === 0 && movingPresets.length === 0
      if (settled || Date.now() - settleStarted >= settleTimeoutMs) break
      await sleep(intervalMs)
      if (!isNewest() || fiberStateOf(ctx) !== 2) break
      try {
        snapshot = await readPluginInventoryFrom(projection, ctx)
      } catch (error) {
        // Losing the context mid-settle is a measurement failure: keep the last readable
        // snapshot but mark it unsettled, never as "the tree settled and the row is dead".
        attempts.push(attemptEntry(attempts.length + 1, Date.now() - started, error, ctx))
        break
      }
    }

    // A newer apply owns the file from here on.
    if (!isNewest()) return

    const sampledAt = new Date().toISOString()
    const published = withoutProbe(snapshot, selfEntryId)
    write({
      kind: 'live',
      sampled_at: sampledAt,
      // Who answered, so the artifact never claims a Remote it did not use.
      transport: 'in-process-projection',
      method: 'readPluginInventory',
      profile: config.profile ?? null,
      runtime_version: config.runtimeVersion ?? null,
      wait_ms: Date.now() - started,
      applies: generation,
      attempts,
      // `settled: false` means the sample was taken while rows were still moving. The
      // executor must not read a transient phase as a dead plugin (R17 / BS-25).
      settled,
      settle_timeout_ms: settleTimeoutMs,
      // The published snapshot must be the deployment, not the deployment plus our
      // instrument: the probe row is recorded here instead of being scored.
      excluded:
        selfEntryId === null
          ? []
          : [
              {
                entryId: selfEntryId,
                reason: 'the probe row itself, mounted through a launcher --patch overlay for this sample only',
              },
            ],
      snapshot: {
        ...published,
        // Inside the snapshot on purpose: `audit --snapshot` reads the transport from
        // here, and a provenance field that only lives beside the data is one nobody
        // reads (the adversary showed the artifact audited as "unstated").
        transport: 'in-process-projection',
      },
      host_summary: summarize(published),
      // Facts, not judgements: the registry's own list, plus what this build does not
      // read yet. `registry: null` means "no tool service composed", which is not the
      // same answer as "a registry with zero tools".
      capabilities: readCapabilities(ctx, sampledAt),
    })
  })()
}

/** Read through the projection we already resolved (kept separate so the catch is explicit). */
function readPluginInventoryFrom(projection, ctx) {
  return projection.readPluginInventory(ctx)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Cordis fiber states: 0 pending · 1 loading · 2 active · 3 error · 5 unloading. */
function fiberStateOf(ctx) {
  const fiber = ctx?.fiber
  return typeof fiber?.state === 'number' ? fiber.state : null
}

/**
 * Why a read failed, in a shape the executor can decide on.
 *
 * `inactive-context` is Cordis saying "this context cannot resolve its injected services
 * right now" -- a measurement failure. Everything else is left unclassified rather than
 * guessed into a verdict.
 */
function classifyError(error) {
  const message = describe(error)
  if (/inactive context/i.test(message)) return 'inactive-context'
  if (/Cannot find module|ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED/i.test(message)) return 'projection-missing'
  return 'other'
}

function attemptEntry(n, ms, error, ctx) {
  const fiber = ctx?.fiber
  return {
    n,
    ms,
    ok: false,
    code: classifyError(error),
    error: describe(error).slice(0, 240),
    fiber_state: fiberStateOf(ctx),
    // Whether this context still holds the injected service. A `false` here is the
    // difference between "the tree is still composing" and "the projection is missing".
    store_has_loader:
      fiber?.store !== undefined && fiber?.store !== null && Object.prototype.hasOwnProperty.call(fiber.store, 'loader'),
  }
}

function writeFailure(config, { started, attempts, generation, isNewest, settleTimeoutMs, write }) {
  if (!isNewest()) return
  const last = attempts[attempts.length - 1] ?? null
  try {
    write({
      kind: 'live',
      sampled_at: new Date().toISOString(),
      transport: 'in-process-projection',
      method: 'readPluginInventory',
      profile: config.profile ?? null,
      runtime_version: config.runtimeVersion ?? null,
      wait_ms: Date.now() - started,
      applies: generation,
      attempts,
      // Never `true`: nothing was settled, so nothing may be judged from this sample.
      settled: false,
      settle_timeout_ms: settleTimeoutMs,
      error: {
        name: last?.code ?? 'measurement',
        message: last?.error ?? 'inventory projection could not be read',
        // Machine-readable, so the executor does not parse prose.
        code: last?.code ?? 'other',
        attempts: attempts.length,
        fiber_state: last?.fiber_state ?? null,
        stack_first_line: '',
      },
    })
  } catch {
    // Nothing more we can do without a writable out path; the recorder reports the
    // missing file as a blocker rather than pretending a sample happened.
  }
}

/** Our own composed entry id, matched by suffix because the loader prefixes group paths. */
function findSelfEntryId(entries, selfId) {
  const hit = entries.find((entry) => entry.entryId === selfId || entry.entryId.endsWith(`:${selfId}`))
  return hit === undefined ? null : hit.entryId
}

/**
 * Read the tool registry that the mounted Host actually serves.
 *
 * FACTS ONLY. Upstream plugins never declare their tool names statically (no `dsh` field
 * in `dsh-tool-bash`'s package.json; `bash` exists only inside `defineTool({ name })` in
 * the built code), so "this plugin declared X and X is missing" is not derivable without
 * shipping a hand-written mapping table. The list below is what the registry itself says.
 */
function readCapabilities(ctx, sampledAt) {
  const base = {
    sampled_at: sampledAt,
    transport: 'in-process-projection',
    // Channels a deployment may compose that this build does not read yet.
    unjudged: ['commands', 'skills', 'settings'],
  }
  let registry
  try {
    registry = ctx.get('tools')
  } catch (error) {
    return { ...base, registry: null, tools: [], read_error: `ctx.get('tools') threw: ${describe(error)}` }
  }
  if (registry === null || registry === undefined) return { ...base, registry: null, tools: [] }
  // A `ptc` deployment collapses the model-facing surface to `run_code` only, so a plain
  // `schemas()` call reports ONE tool on a host that has dozens. `presentAs('native')` is
  // the public, scope-local way to ask for the uncollapsed view; it is disposed right
  // after the read so the deployment is untouched.
  let presentation = 'deployment-default'
  let presentationError = null
  let disposePresentation = null
  try {
    const dispose = typeof registry.presentAs === 'function' ? registry.presentAs('native') : null
    if (typeof dispose === 'function') {
      presentation = 'native (forced by the probe, then disposed)'
      disposePresentation = dispose
    } else {
      presentationError = 'tools.presentAs() is not available in this build'
    }
  } catch (error) {
    presentationError = `tools.presentAs('native') threw: ${describe(error)}`
  }
  try {
    const schemas = typeof registry.schemas === 'function' ? registry.schemas() : null
    if (!Array.isArray(schemas)) {
      return { ...base, registry: 'tools', tools: [], presentation, presentation_error: presentationError, read_error: 'tools.schemas() did not return an array' }
    }
    const tools = schemas
      .map((schema) => ({
        name: typeof schema?.name === 'string' ? schema.name : '',
        description: typeof schema?.description === 'string' && schema.description !== '' ? schema.description : null,
      }))
      .filter((tool) => tool.name !== '')
    return { ...base, registry: 'tools', tools, presentation, presentation_error: presentationError }
  } catch (error) {
    return { ...base, registry: 'tools', tools: [], presentation, presentation_error: presentationError, read_error: `tools.schemas() threw: ${describe(error)}` }
  } finally {
    if (typeof disposePresentation === 'function') {
      try {
        disposePresentation()
      } catch {
        // A failed disposal must not discard the sample we already took.
      }
    }
  }
}

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Drop the probe row from every list we publish, without mutating upstream's snapshot. */
function withoutProbe(snapshot, selfEntryId) {
  if (selfEntryId === null) return snapshot
  return {
    ...snapshot,
    entries: snapshot.entries.filter((entry) => entry.entryId !== selfEntryId),
  }
}

/**
 * Load upstream's own projection module.
 *
 * The probe file lives in a scratch directory, so a bare `import()` would resolve
 * against the wrong `node_modules` (or none). `resolveFrom` names the tree that is
 * actually booting — the profile directory — and we import that exact file, so a
 * version mismatch between our probe and the running Host cannot be papered over.
 */
async function loadProjection(resolveFrom) {
  if (resolveFrom !== null) {
    const require = createRequire(join(resolveFrom, '__triage_probe__.cjs'))
    const resolved = require.resolve('@deepseek-ai/dsh-host-plugin-inventory')
    return import(pathToFileURL(resolved).href)
  }
  return import('@deepseek-ai/dsh-host-plugin-inventory')
}

/**
 * The Host's own reading of the same rows, computed here so the recorder can compare it
 * with what the CLI says offline (`cross_check`).
 *
 * IDENTITY, NOT COUNTS: the first version only carried counts, and the adversary showed
 * a mutation that flipped 87 preset rows to `failed` while leaving every count intact
 * still passed the cross-check. So every row's id and phase is listed here.
 */
function summarize(snapshot) {
  const byPhase = {}
  for (const entry of snapshot.entries) {
    const key = entry.fiberPhase ?? 'null'
    byPhase[key] = (byPhase[key] ?? 0) + 1
  }
  return {
    entries: snapshot.entries.length,
    by_phase: byPhase,
    /** entryId → phase (`none` for null), so a rename or a swap cannot pass. */
    phases: Object.fromEntries(
      [...snapshot.entries]
        .sort((left, right) => left.entryId.localeCompare(right.entryId))
        .map((entry) => [entry.entryId, entry.fiberPhase ?? 'none']),
    ),
    failed: snapshot.entries.filter((entry) => entry.enabled && entry.fiberPhase === 'failed').map((entry) => entry.entryId).sort(),
    no_fiber_enabled: snapshot.entries
      .filter((entry) => entry.enabled && entry.fiberPhase === null)
      .map((entry) => entry.entryId)
      .sort(),
    disabled: snapshot.entries.filter((entry) => !entry.enabled).map((entry) => entry.entryId).sort(),
    presets: Array.isArray(snapshot.agentPresets)
      ? {
          groups: snapshot.agentPresets.length,
          broken: snapshot.agentPresets.filter((preset) => preset.broken !== undefined).map((preset) => preset.id),
          rows: snapshot.agentPresets.reduce((total, preset) => total + (preset.rows?.length ?? 0), 0),
          conditional: snapshot.agentPresets.flatMap((preset) =>
            (preset.rows ?? [])
              .filter((row) => row.enabled === 'conditional')
              .map((row) => `${preset.id}:${row.entryId ?? row.moduleName}`),
          ),
          /** preset id → row id/module → phase, so two presets can be told apart. */
          by_preset: Object.fromEntries(
            [...snapshot.agentPresets]
              .sort((left, right) => left.id.localeCompare(right.id))
              .map((preset) => [
                preset.id,
                Object.fromEntries(
                  (preset.rows ?? [])
                    .map((row) => [
                      row.entryId ?? row.moduleName,
                      `${row.enabled === true ? 'on' : row.enabled === false ? 'off' : 'conditional'}:${row.fiberPhase ?? 'none'}`,
                    ])
                    .sort(([left], [right]) => String(left).localeCompare(String(right))),
                ),
              ]),
          ),
        }
      : null,
  }
}
