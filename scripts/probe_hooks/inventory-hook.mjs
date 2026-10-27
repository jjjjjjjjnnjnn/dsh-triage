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

export function apply(ctx, config = {}) {
  const out = config.out ?? null
  if (out === null) throw new Error('triage-inventory-probe needs config.out')

  const selfId = config.selfId ?? 'triage-inventory-probe'
  const timeoutMs = Number(config.timeoutMs ?? 15000)
  const intervalMs = Number(config.intervalMs ?? 250)
  /** Resolve upstream's projection from the tree that is actually running, not from ours. */
  const resolveFrom = config.resolveFrom ?? null
  const started = Date.now()

  const write = (payload) => {
    writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }

  // Deliberately not awaited: awaiting inside `apply` would keep our own root fiber in
  // `loading`, and then "no transient entries" could never become true.
  void (async () => {
    try {
      const { readPluginInventory } = await loadProjection(resolveFrom)
      let snapshot = null
      let selfEntryId = null
      for (;;) {
        snapshot = await readPluginInventory(ctx)
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
        if ((moving.length === 0 && movingPresets.length === 0) || Date.now() - started >= timeoutMs) break
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
      }
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
      })
    } catch (error) {
      try {
        write({
          kind: 'live',
          sampled_at: new Date().toISOString(),
          transport: 'in-process-projection',
          method: 'readPluginInventory',
          profile: config.profile ?? null,
          wait_ms: Date.now() - started,
          error: {
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
            stack_first_line: error instanceof Error ? (error.stack ?? '').split('\n')[0] : '',
          },
        })
      } catch {
        // Nothing more we can do without a writable out path; the recorder reports the
        // missing file as a blocker rather than pretending a sample happened.
      }
    }
  })()
}

/** Our own composed entry id, matched by suffix because the loader prefixes group paths. */
function findSelfEntryId(entries, selfId) {
  const hit = entries.find((entry) => entry.entryId === selfId || entry.entryId.endsWith(`:${selfId}`))
  return hit === undefined ? null : hit.entryId
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
