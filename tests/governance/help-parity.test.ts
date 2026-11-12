/**
 * R97: the two help texts must document the same flags.
 *
 * WHY: `HELP_ZH` and `HELP_EN` are two hand-maintained lists in one file. Since R15 every probe /
 * serve / outcomes flag was added to the English list only, so the Chinese list drifted to 18 flags
 * against 37 — a zh-locale stranger could not discover `--execute`, `--snapshot`, `--results`, `--out`
 * or the entire outcomes verb set, while every gate stayed green. Same shape as the badge drift R96
 * caught: one fact, two homes, nobody comparing them.
 *
 * WHAT IT CHECKS: every long flag named in `HELP_EN` is named in `HELP_ZH` (the reverse is also
 * checked). It does NOT judge wording — translations may say whatever reads best.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

function helpText(name: 'HELP_EN' | 'HELP_ZH'): string {
  const src = read('packages/plugin/src/cli.ts')
  const start = src.indexOf(`const ${name} = \``)
  assert.notEqual(start, -1, `${name} must exist in cli.ts`)
  const open = src.indexOf('`', start)
  const close = src.indexOf('`', open + 1)
  assert.ok(close > open, `${name} must be a single template literal`)
  return src.slice(open + 1, close)
}

const flagOf = (line: string) => /^\s{2}(--?[\w-]+)(?:[ <])/.exec(line)?.[1] ?? null
const flagsIn = (text: string) => [...new Set(text.split('\n').map(flagOf).filter((f): f is string => f !== null))]

test('R97: both help texts document the same flags', () => {
  const en = flagsIn(helpText('HELP_EN'))
  const zh = flagsIn(helpText('HELP_ZH'))
  assert.ok(en.length >= 30, `the English help must stay substantial, found ${en.length} flag(s)`)
  assert.deepEqual(
    en.filter((f) => !zh.includes(f)),
    [],
    'these flags are documented in HELP_EN but missing from HELP_ZH',
  )
  assert.deepEqual(
    zh.filter((f) => !en.includes(f)),
    [],
    'these flags are documented in HELP_ZH but missing from HELP_EN',
  )
})

test('R97: every flag the parser accepts is documented somewhere', () => {
  const src = read('packages/plugin/src/cli.ts')
  const parsed = [
    ...new Set(
      [...src.matchAll(/case '(--[\w-]+)':/g)]
        .map((m) => m[1])
        .filter((flag): flag is string => typeof flag === 'string'),
    ),
  ]
  const documented = new Set([...flagsIn(helpText('HELP_EN')), ...flagsIn(helpText('HELP_ZH'))])
  const undocumented = parsed.filter((flag) => !documented.has(flag) && flag !== '--help')
  assert.deepEqual(undocumented, [], `these flags are parsed but appear in neither help text: ${undocumented.join(', ')}`)
})
