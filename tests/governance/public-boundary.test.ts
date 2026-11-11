/**
 * The public boundary sentence must match what the code does (R94).
 *
 * WHY THIS EXISTS: for about ninety rounds the README, both listings and the npm README said
 * "read-only, never modifies ~/.dsh". That stopped being true in R49 (`fix --apply` writes
 * `<profile>/compatibility.json`) and R82 (`rescue --apply` writes `dsh.profile.bundles`). No test
 * watched the sentence, so it aged from a claim into a lie while every gate stayed green.
 *
 * WHAT IT CHECKS: the documents a stranger reads must (a) still say the default is read-only and
 * (b) name the two seams that `--apply` may touch, with the backup/undo guarantee. It does NOT
 * require any particular wording beyond those tokens, so copy can still be rewritten.
 *
 * WHAT IT CANNOT CHECK: that the code really only touches those two files — `fix.ts` / `rescue.ts`
 * own that, and their own tests pin it (`read_only` / `byte_exact_restore` by sha256).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

const DOCUMENTS = ['README.md', 'README.zh-CN.md', 'packages/plugin/README.md', 'docs/market/listing_zh.md']

test('the boundary sentence names the two seams an explicit --apply may touch', () => {
  for (const file of DOCUMENTS) {
    const text = read(file)
    assert.ok(/compatibility\.json/.test(text), `${file}: must name compatibility.json as a writable seam`)
    assert.ok(/dsh\.profile\.bundles/.test(text), `${file}: must name dsh.profile.bundles as a writable seam`)
    assert.ok(/--undo/.test(text), `${file}: must state that the write can be undone`)
  }
})

test('the boundary sentence no longer claims it never modifies ~/.dsh', () => {
  const forbidden = [
    '绝不修改用户的 `~/.dsh` 配置',
    '绝不修改 `~/.dsh` 配置',
    '只读检查，不修改任何现有配置',
  ]
  for (const file of DOCUMENTS) {
    const text = read(file)
    for (const phrase of forbidden) {
      assert.ok(!text.includes(phrase), `${file}: still claims "${phrase}" — fix.ts and rescue.ts write with --apply`)
    }
  }
})

test('NEGATIVE CONTROL: the default mode is still described as read-only', () => {
  // A fix that made every command writable would also pass the checks above. This one refuses that.
  for (const file of DOCUMENTS) {
    const text = read(file)
    assert.ok(/默认(只读|零写盘)|默认只读|不写盘/.test(text), `${file}: must still say the default writes nothing`)
  }
})
