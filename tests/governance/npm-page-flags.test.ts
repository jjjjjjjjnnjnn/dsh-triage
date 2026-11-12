/**
 * R97-S10: the npm page's flag table is a third home for the flag set.
 *
 * The help-parity test compares HELP_EN and HELP_ZH. But `packages/plugin/README.md` is what
 * `npm view dsh-triage readme` serves, and its table listed 8 of 37 flags — a reader who never runs
 * `--help` would not know `--execute`, `--results`, `--out` or the outcomes verbs exist. Adding the
 * assertion without fixing that table would leave the third home drifting, which is the S1 lesson.
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
  return src.slice(open + 1, close)
}

const helpFlags = (text: string) =>
  [...new Set(text.split('\n').map((l) => /^\s{2}(--?[\w-]+)(?:[ <])/.exec(l)?.[1]).filter((f): f is string => !!f))]

/**
 * Flags a table row claims to document.
 *
 * A row may name one flag (`| \`--json\` | … |`) or two (`| \`--enable\` / \`--disable\` | … |`), and
 * the argument may live inside the same backticks (`\`--undo <journal>\``), so every backticked span
 * that starts with a dash counts — taking its leading flag, not the whole span.
 */
function documentedFlags(page: string): string[] {
  const found = new Set<string>()
  for (const line of page.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const span = match[1]
      if (typeof span !== 'string') continue
      const flag = /^(--?[a-zA-Z][\w-]*)/.exec(span.trim())?.[1]
      if (flag !== undefined && (flag.startsWith('--') || flag === '-h')) found.add(flag)
    }
  }
  return [...found]
}

test('R97: the npm page documents every flag the CLI accepts', () => {
  const documented = new Set(documentedFlags(read('packages/plugin/README.md')))
  const accepted = helpFlags(helpText('HELP_EN')).filter((f) => f !== '--help' && f !== '-h')
  const missing = accepted.filter((flag) => !documented.has(flag))
  assert.deepEqual(missing, [], `these flags are accepted but absent from the npm page's table: ${missing.join(', ')}`)
})

test('R97: the npm page does not document a flag the CLI does not accept', () => {
  const documented = new Set(documentedFlags(read('packages/plugin/README.md')))
  const accepted = new Set([...helpFlags(helpText('HELP_EN')), ...helpFlags(helpText('HELP_ZH'))])
  const invented = [...documented].filter((flag) => flag.startsWith('--') && !accepted.has(flag))
  assert.deepEqual(invented, [], `the npm page names flags that do not exist: ${invented.join(', ')}`)
})
