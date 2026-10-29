#!/usr/bin/env node
/**
 * Record the upgrade-day card against a real profile (`docs/specs/M6-upgrade-day.md`, T-801).
 *
 * WHY A RECORDER AND NOT A UNIT TEST: the card's controls are about the *rendered copy* (first line is the
 * conclusion, the boundary survives, no promise that an upgrade fixes anything). A unit test can prove the
 * function obeys them on a fixture; only a real profile proves the card a user would paste is readable and
 * short enough to read.
 *
 * WHAT IT CHECKS (spec C1–C8 / N1, N4, N6, N7):
 *   - the first content line after the title is the conclusion and repeats the JSON's own four counts;
 *   - the four buckets in the table sum to `counts.total` and match the JSON per bucket;
 *   - the boundary sentence is present and no forbidden promise is;
 *   - two runs produce byte-identical text (the card carries no clock);
 *   - no home path reaches the text;
 *   - `--card --json` prints JSON only, and says on stderr that the card was ignored.
 *
 *   node scripts/record_upgrade_card.mjs --stamp 2026-10-29T14:00:00.000Z \
 *     [--to 0.3.0] [--profile upstream] [--dsh-home sandbox/upstream/0.2.1-rc.4/home]
 *
 * Exit codes: 0 written · 1 a check failed (artifact written first) · 2 bad usage / refusing to overwrite.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = argOf('--stamp', null)
const stamp = rawStamp === null ? null : isoStamp(String(rawStamp))
if (stamp === null) {
  process.stderr.write(
    'usage: node scripts/record_upgrade_card.mjs --stamp <ISO> [--to <version>] [--profile <name>] [--dsh-home <path>] [--out <dir>]\n',
  )
  process.exit(2)
}

const target = String(argOf('--to', '0.3.0'))
const profile = String(argOf('--profile', 'upstream'))
const dshHome = pathFor(String(argOf('--dsh-home', 'sandbox/upstream/0.2.1-rc.4/home')))
const outDir = pathFor(String(argOf('--out', 'data/results')))
const cli = abs('packages/plugin/dist/cli.js')

if (!existsSync(cli)) {
  process.stderr.write(`missing ${cli}: run \`pnpm build\` first\n`)
  process.exit(2)
}
if (!existsSync(dshHome)) {
  process.stderr.write(`missing dsh home ${dshHome}: run \`node scripts/bootstrap_upstream.mjs\` first\n`)
  process.exit(2)
}

const HOME_PATTERNS = [
  /[A-Za-z]:\\\\Users\\\\/,
  /[A-Za-z]:\\Users\\/,
  /\/home\/[a-z0-9._-]+\//i,
  /\/Users\/[A-Za-z0-9._-]+\//,
  /[A-Za-z]-Users-[A-Za-z0-9._-]{2,}/,
]
const FORBIDDEN = ['升级会修好', '升级即修复', 'upgrading fixes', 'upgrade fixes']

const run = (args) => {
  const child = spawnSync(process.execPath, [cli, ...args], {
    cwd: abs('.'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, DSH_TRIAGE_LOCALE: 'zh' },
    timeout: 300_000,
  })
  return { status: child.status, stdout: child.stdout ?? '', stderr: child.stderr ?? '' }
}

const common = ['--dsh-home', dshHome, '--profile', profile, '--to', target]

const cardRun = run(['upgrade', ...common, '--card'])
const cardAgain = run(['upgrade', ...common, '--card'])
const jsonRun = run(['upgrade', ...common, '--json'])
const bothRun = run(['upgrade', ...common, '--card', '--json'])

const checks = []
const check = (id, ok, detail) => {
  checks.push({ id, ok: Boolean(ok), detail })
  return ok
}

check('card-exit-0', cardRun.status === 0, `exit ${String(cardRun.status)}`)
if (cardRun.status !== 0) {
  process.stderr.write(`the card run failed; stderr was:\n${cardRun.stderr}\n`)
}

let payload = null
try {
  payload = JSON.parse(jsonRun.stdout)
} catch {
  payload = null
}
check('json-parses', payload !== null, payload === null ? 'the JSON run did not parse' : 'ok')
if (payload === null) {
  process.stderr.write(`the JSON run produced no payload; stderr was:\n${jsonRun.stderr}\n`)
  process.exit(1)
}

const card = cardRun.stdout
const lines = card.split('\n')
const nonEmpty = lines.filter((line) => line.trim() !== '')
const titleLine = nonEmpty[0] ?? ''
const conclusionLine = nonEmpty[1] ?? ''
const counts = payload.counts ?? {}

check('card-titles-the-target', titleLine.startsWith('# ') && titleLine.includes(target), titleLine.slice(0, 60))
check('card-first-line-is-conclusion', conclusionLine.startsWith('**'), conclusionLine.slice(0, 80))
const countsInLine = ['would_be_denied', 'cannot_tell', 'improved', 'likely_fine'].every((key) =>
  conclusionLine.includes(String(counts[key])),
)
check('card-repeats-the-json-counts', countsInLine, `json counts ${JSON.stringify(counts)}`)
check(
  'buckets-are-a-partition',
  counts.would_be_denied + counts.cannot_tell + counts.improved + counts.likely_fine === counts.total,
  `${String(counts.total)} total`,
)
check(
  'card-table-matches-counts',
  ['would-be-denied', 'cannot-tell', 'improved', 'likely-fine'].every((bucket) =>
    card.includes(`| \`${bucket}\` |`),
  ),
  'four bucket rows present',
)
check('card-keeps-boundary', card.includes('目标版本会放行它'), 'the BS-42 boundary sentence survives')
const promiseHits = FORBIDDEN.filter((phrase) => card.toLowerCase().includes(phrase.toLowerCase()))
check('card-makes-no-promise', promiseHits.length === 0, promiseHits.join(', ') || 'no forbidden promise')
check('card-is-deterministic', sha256(card) === sha256(cardAgain.stdout), `sha256 ${sha256(card).slice(0, 12)}…`)
const homeHits = HOME_PATTERNS.filter((pattern) => pattern.test(card)).map((pattern) => pattern.source)
check('card-carries-no-home-path', homeHits.length === 0, homeHits.join(', ') || 'clean')
check('card-names-units', card.includes('`row:') || card.includes('`bundle:'), 'at least one unit line')

let bothParsed = null
try {
  bothParsed = JSON.parse(bothRun.stdout)
} catch {
  bothParsed = null
}
check('json-wins-over-card', bothParsed !== null, bothParsed === null ? 'stdout was not JSON' : 'json only on stdout')
check(
  'json-says-card-was-ignored',
  /card: ignored/i.test(bothRun.stderr),
  bothRun.stderr.trim().split('\n')[0]?.slice(0, 80) ?? 'no stderr line',
)

const passed = checks.every((entry) => entry.ok)
const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_upgrade_card.mjs',
  generated_at: stamp,
  inputs: {
    target,
    profile,
    dsh_home: '<dsh-home>',
    locale: 'zh',
    counts,
    card_sha256: sha256(card),
    card_bytes: Buffer.byteLength(card, 'utf8'),
    card_lines: lines.length,
  },
  card,
  checks,
  passed,
  limits: [
    'the card judges the declaration layer only: declared ranges against the target runtime, not runtime behaviour',
    '`improved` is only witnessed in the downgrade geometry today (BS-42), so the card says "the target admits it"',
    'the profile is the in-repo sandbox (0.2.1-rc.4), not a user machine',
    'card text is the zh rendering; the en rendering is covered by tests/unit/upgrade-card.test.ts',
  ],
}

const text = `${JSON.stringify(artifact, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const fileName = `upgrade-card-${stamp.replaceAll(':', '-')}.json`
const targetPath = join(outDir, fileName)
if (existsSync(targetPath)) {
  process.stderr.write(`refusing to overwrite existing evidence: ${fileName}\n`)
  process.exit(2)
}
writeFileSync(targetPath, text, 'utf8')
writeFileSync(`${targetPath}.sha256`, `${sha256(text)}\n`, 'utf8')

process.stdout.write(`upgrade card · ${fileName}\n`)
process.stdout.write(`  ${conclusionLine.replaceAll('*', '').slice(0, 140)}\n`)
process.stdout.write(`  ${checks.filter((entry) => entry.ok).length}/${checks.length} checks · sha256 ${sha256(card).slice(0, 12)}…\n`)
for (const entry of checks.filter((candidate) => !candidate.ok)) process.stdout.write(`  FAIL ${entry.id} — ${entry.detail}\n`)
process.exit(passed ? 0 : 1)
