/**
 * The real inventory hook writes a real `{error}` payload (T-316).
 *
 * WHY THIS FILE EXISTS: ADR-0008 E keeps the replacement window **only** for an unreadable
 * sample, so "the hook can actually produce one" stopped being a detail and became a load
 * bearing assumption. Until now that branch was exercised by a fake launcher writing a
 * hand-made payload — which proves the loop, not the instrument. This test runs the **shipped
 * hook file** (`packages/probe/hooks/inventory-hook.mjs`) with a projection stub that throws
 * the two errors the executor distinguishes, and asserts the payload it writes is the shape the
 * loop and the judge key on.
 *
 * WHAT IT STILL DOES NOT PROVE (stated so nobody rounds it up): the Host is not booted here.
 * A real Cordis tree producing an *inactive context* on demand is not reproducible in a unit
 * test; what is proven is that the hook classifies the error, keeps its own generation guard,
 * writes `{error}` with `settled: false`, and that the resulting payload is exactly what
 * `bootAndSampleHost` refuses to accept (so the window opens) and what `judgeProbe` may never
 * turn into `blocked`.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { isReadableSample, isUsableSample } from '@dsh-triage/probe'

const here = dirname(fileURLToPath(import.meta.url))
const HOOK = join(here, '..', '..', 'packages', 'probe', 'hooks', 'inventory-hook.mjs')

interface LoadedHook {
  readonly apply: (ctx: unknown, config: Record<string, unknown>) => void
}

async function loadHook(): Promise<LoadedHook> {
  return (await import(pathToFileURL(HOOK).href)) as LoadedHook
}

/** The smallest ctx the hook actually touches: `fiber.state` and `fiber.store.loader`. */
function activeCtx(): unknown {
  return { fiber: { state: 2, store: { loader: {} } } }
}

function waitForFile(path: string, timeoutMs = 5_000): Promise<string> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      try {
        const text = readFileSync(path, 'utf8')
        if (text !== '') return resolve(text)
      } catch {
        // Not written yet.
      }
      if (Date.now() - started >= timeoutMs) return reject(new Error(`no sample at ${path} within ${timeoutMs}ms`))
      setTimeout(poll, 25)
    }
    poll()
  })
}

/** A throwaway tree whose `@deepseek-ai/dsh-host-plugin-inventory` throws on read. */
function treeWithThrowingProjection(message: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-hook-error-'))
  const packageDir = join(root, 'node_modules', '@deepseek-ai', 'dsh-host-plugin-inventory')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(
    join(packageDir, 'package.json'),
    `${JSON.stringify({ name: '@deepseek-ai/dsh-host-plugin-inventory', version: '0.0.0', type: 'module', main: 'index.js' }, null, 2)}\n`,
    'utf8',
  )
  writeFileSync(
    join(packageDir, 'index.js'),
    `export async function readPluginInventory() {\n  throw new Error(${JSON.stringify(message)})\n}\n`,
    'utf8',
  )
  return root
}

test('T-316: the shipped hook writes {error} with code inactive-context and settled:false', async () => {
  const tree = treeWithThrowingProjection('cannot get required service "loader" in inactive context')
  const out = join(tree, 'sample.json')
  const hook = await loadHook()
  hook.apply(activeCtx(), {
    out,
    resolveFrom: tree,
    // One retry attempt is enough for the assertion; the default 20s backoff is the product
    // behaviour for a tree that may still recover, not something a unit test should wait for.
    retryMs: 1,
    timeoutMs: 1_000,
    profile: 'web',
  })
  const payload = JSON.parse(await waitForFile(out)) as Record<string, unknown>
  const error = payload['error'] as Record<string, unknown>
  assert.equal(error['code'], 'inactive-context', 'the executor keys on this code, not on prose')
  assert.equal(payload['settled'], false, 'an error sample must never claim the tree settled')
  // THE CONTRACT THE LOOP READS: unreadable (so the replacement window opens) and not usable
  // (so no verdict can rest on it).
  assert.equal(isReadableSample(payload), false)
  assert.equal(isUsableSample(payload), false)
  // The generation guard still applies: this task wrote because it was the newest apply.
  assert.equal(payload['applies'], 1)
  assert.ok(Array.isArray(payload['attempts']) && payload['attempts'].length === 1)
  assert.equal((payload['attempts'] as Array<Record<string, unknown>>)[0]?.['code'], 'inactive-context')
})

test('T-316: a tree without the projection package yields code projection-missing, still unreadable', async () => {
  // No `node_modules` at all: `loadProjection()` throws MODULE_NOT_FOUND and the hook has to
  // report a measurement failure instead of pretending it read zero rows.
  const tree = mkdtempSync(join(tmpdir(), 'dsh-triage-hook-missing-'))
  const out = join(tree, 'sample.json')
  const hook = await loadHook()
  hook.apply(activeCtx(), { out, resolveFrom: tree, retryMs: 1, timeoutMs: 1_000, profile: 'web' })
  const payload = JSON.parse(await waitForFile(out)) as Record<string, unknown>
  const error = payload['error'] as Record<string, unknown>
  assert.equal(error['code'], 'projection-missing')
  assert.equal(payload['settled'], false)
  assert.equal(isReadableSample(payload), false)
  assert.equal(isUsableSample(payload), false)
})
