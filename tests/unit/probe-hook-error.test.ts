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
    /*
     * T-840: this used to be `retryMs: 1`, which made the attempt count a race against the
     * clock. The loop breaks on `Date.now() - started >= retryMs`, so a first attempt that
     * lands in the same millisecond as `started` sees `0 >= 1` = false, sleeps 250ms and
     * tries again: measured on 2026-11-03, 27 of 40 runs produced TWO attempts with
     * `retryMs: 1` and 13 produced one. The CI red was that coin landing on 2.
     * A zero budget says what this test actually means — "one attempt, then report" — and
     * makes it a fact instead of a coin flip. The retry path itself is pinned by the next
     * test, so nothing is lost by removing the ambiguity here.
     */
    retryMs: 0,
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
  const attempts = payload['attempts'] as Array<Record<string, unknown>>
  assert.ok(Array.isArray(attempts), 'attempts must be a list')
  // The message prints the attempts: the CI red said only "falsy", so the actual count was
  // unrecoverable from the log. A red must be diagnosable without a rerun.
  assert.equal(attempts.length, 1, `a zero retry budget must stop after the first attempt: ${JSON.stringify(attempts)}`)
  assert.equal(attempts[0]?.['code'], 'inactive-context')
  assert.equal(error['attempts'], 1, 'the error block and the attempt list must agree')
})

test('T-840: a non-zero retry budget really retries (the stop condition is the budget, not the first failure)', async () => {
  /*
   * The other half of the contract. Without this test, `retryMs: 0` above could be read as
   * "the loop never retries"; with it, both directions are pinned: zero budget -> one
   * attempt, positive budget -> the loop tries again and stops when the budget is spent.
   */
  const tree = treeWithThrowingProjection('cannot get required service "loader" in inactive context')
  const out = join(tree, 'sample.json')
  const hook = await loadHook()
  hook.apply(activeCtx(), { out, resolveFrom: tree, retryMs: 50, timeoutMs: 1_000, profile: 'web' })
  const payload = JSON.parse(await waitForFile(out)) as Record<string, unknown>
  const attempts = payload['attempts'] as Array<Record<string, unknown>>
  assert.ok(attempts.length >= 2, `a 50ms budget must be spent on retries, got ${JSON.stringify(attempts)}`)
  for (const attempt of attempts) assert.equal(attempt['code'], 'inactive-context')
  assert.equal((payload['error'] as Record<string, unknown>)['attempts'], attempts.length)
  assert.equal(payload['settled'], false)
})

test('T-316: a tree without the projection package yields code projection-missing, still unreadable', async () => {
  // No `node_modules` at all: `loadProjection()` throws MODULE_NOT_FOUND and the hook has to
  // report a measurement failure instead of pretending it read zero rows.
  const tree = mkdtempSync(join(tmpdir(), 'dsh-triage-hook-missing-'))
  const out = join(tree, 'sample.json')
  const hook = await loadHook()
  hook.apply(activeCtx(), { out, resolveFrom: tree, retryMs: 0, timeoutMs: 1_000, profile: 'web' })
  const payload = JSON.parse(await waitForFile(out)) as Record<string, unknown>
  const error = payload['error'] as Record<string, unknown>
  assert.equal(error['code'], 'projection-missing')
  assert.equal(payload['settled'], false)
  assert.equal(isReadableSample(payload), false)
  assert.equal(isUsableSample(payload), false)
})
