/**
 * Two-phase sampling in the shipped hook (T-312).
 *
 * WHY: the judged budget is "spawn → first sample". A tree that needs 10–18s to settle used to
 * push that number to 16–23s even though the phase table was readable almost immediately. The
 * hook now publishes a `provisional: true` / `settled: false` sample as soon as phase 1 succeeds
 * and overwrites it with the settled one. This test runs the **real hook file** and asserts both
 * writes happen, with the markers the executor keys on.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { isProvisionalSample, isUsableSample } from '@dsh-triage/probe'

const here = dirname(fileURLToPath(import.meta.url))
const HOOK = join(here, '..', '..', 'packages', 'probe', 'hooks', 'inventory-hook.mjs')

/** A projection whose only row is `loading` for the first read and `active` afterwards. */
function treeWithSettlingProjection(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-hook-two-phase-'))
  const packageDir = join(root, 'node_modules', '@deepseek-ai', 'dsh-host-plugin-inventory')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(
    join(packageDir, 'package.json'),
    `${JSON.stringify({ name: '@deepseek-ai/dsh-host-plugin-inventory', version: '0.0.0', type: 'module', main: 'index.js' }, null, 2)}\n`,
    'utf8',
  )
  writeFileSync(
    join(packageDir, 'index.js'),
    [
      'let reads = 0',
      'export async function readPluginInventory() {',
      '  reads += 1',
      '  return {',
      "    entries: [{ entryId: 'include:candidate', moduleName: 'candidate', enabled: true, fiberPhase: reads === 1 ? 'loading' : 'active' }],",
      '    agentPresets: [],',
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )
  return root
}

test('T-312: the shipped hook publishes a provisional sample, then the settled one', async () => {
  const tree = treeWithSettlingProjection()
  const out = join(tree, 'sample.json')
  const hook = (await import(pathToFileURL(HOOK).href)) as { apply: (ctx: unknown, config: Record<string, unknown>) => void }
  hook.apply(
    { fiber: { state: 2, store: { loader: {} } }, get: () => null },
    {
      out,
      resolveFrom: tree,
      retryMs: 1,
      timeoutMs: 2_000,
      // Long enough that the provisional write is observable, short enough for a fast test.
      intervalMs: 120,
      profile: 'web',
    },
  )

  const seen: boolean[] = []
  let last: Record<string, unknown> | null = null
  const started = Date.now()
  while (Date.now() - started < 5_000) {
    try {
      const payload = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>
      if (last === null || JSON.stringify(payload) !== JSON.stringify(last)) {
        seen.push(isProvisionalSample(payload))
        last = payload
      }
      // The final write is the one that says the tree settled.
      if (payload['provisional'] === false && payload['settled'] === true) break
    } catch {
      // Not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  assert.ok(last !== null, 'the hook wrote nothing')
  assert.ok(seen.includes(true), `expected a provisional write, saw ${JSON.stringify(seen)}`)
  assert.equal(last?.['provisional'], false, 'the final sample must not claim to be provisional')
  assert.equal(last?.['settled'], true)
  assert.equal(isUsableSample(last), true, 'the settled sample is what a verdict may rest on')

  const snapshot = last?.['snapshot'] as Record<string, unknown> | undefined
  const rows = (snapshot?.['entries'] ?? []) as Array<Record<string, unknown>>
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.['fiberPhase'], 'active', 'the final sample carries the settled phase table')
})
