/**
 * `audit --registry` is opt-in (M9-C5 / N6).
 *
 * The promise being tested is negative: mounting publish-order evidence must not change the default
 * `audit` at all. Everything downstream (the panel's `/api/audit`, the `--json` contract, CI) reads
 * that default, so a new key appearing there would be a silent contract change, not a feature.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const CLI = join(repoRoot, 'packages', 'plugin', 'dist', 'cli.js')

function fixture(): { root: string; dshHome: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-triage-audit-registry-'))
  const dshHome = join(root, 'home', '.dsh')
  const profileDir = join(dshHome, 'profiles', 'web')
  const shared = join(dshHome, 'profiles', 'node_modules')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(join(shared, '@deepseek-ai', 'dsh'), { recursive: true })
  mkdirSync(join(shared, 'local-bundle'), { recursive: true })
  writeFileSync(
    join(shared, '@deepseek-ai', 'dsh', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.4' }),
  )
  writeFileSync(join(shared, 'local-bundle', 'package.json'), JSON.stringify({ name: 'local-bundle', version: '1.0.0' }))
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'dsh-profile-web',
        private: true,
        dependencies: { 'local-bundle': '1.0.0' },
        dsh: { profile: { bundles: ['local-bundle'] } },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  return { root, dshHome }
}

test('the default audit payload carries no update-order key', () => {
  const { root, dshHome } = fixture()
  try {
    const run = spawnSync(process.execPath, [CLI, 'audit', '--json', '--dsh-home', dshHome, '--locale', 'en'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    assert.ok(run.status === 0 || run.status === 1, `unexpected exit ${String(run.status)}: ${run.stderr ?? ''}`)
    const payload = JSON.parse(run.stdout) as Record<string, unknown>
    assert.equal(Object.hasOwn(payload, 'update_order'), false, 'publish-order evidence must stay behind --registry')
    // The rest of the contract is unchanged: these are the keys the panel and the tests read.
    for (const key of ['schema_version', 'command', 'env', 'claims', 'collisions', 'duplicates', 'rows', 'row_verdicts', 'inventory', 'errors']) {
      assert.ok(Object.hasOwn(payload, key), `default payload lost ${key}`)
    }
    assert.equal(payload['command'], 'audit')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
