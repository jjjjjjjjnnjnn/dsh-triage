#!/usr/bin/env node
/**
 * Does the "answer kit" actually work on this machine, and is it safe to paste? (R88 / X1-A)
 *
 * WHY: `docs/specs/X1-reply-command-pack.md` proposes a 0-code distribution artefact — three
 * commands a reporter runs and pastes into a thread. A document like that decays in one direction
 * only: someone edits the commands, nobody re-runs them, and the next person discovers it by
 * following a step that no longer works. This recorder is the part that can go red.
 *
 * WHAT IT CHECKS, per command:
 *   1. it exits 0 (a kit whose commands fail is not a kit);
 *   2. its output carries no absolute path — no drive letter, no /home/<user>, no /Users/<user>;
 *      `~\profiles\web` is allowed and is reported separately, because it is relative to the
 *      reader's home and still names their profile;
 *   3. the output fits in a forum post (line and byte budget).
 *
 * WHAT IT IS NOT: it does not judge whether the *content* is a good answer, and it does not prove
 * "it will work after upgrading" — that is `probe`, and the kit says so in its own words.
 *
 *   node scripts/record_answer_kit.mjs --stamp 2026-11-05T18:00:00.000Z
 *   node scripts/record_answer_kit.mjs --stamp … --to 0.2.2-rc.1     # offline: an exact semver never reads the network
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

import { findAbsolutePaths } from './lib/redaction-check.mjs'
import { writeEvidence } from './lib/evidence.mjs'
import { abs, isoStamp } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-11-05T18:00:00.000Z\n`)
  process.exit(2)
}

const CLI = 'packages/plugin/dist/cli.js'
if (!existsSync(abs(CLI))) {
  process.stderr.write(`${CLI} is missing — run \`pnpm run build\` first\n`)
  process.exit(2)
}

const SELF_TEST = argv.includes('--self-test')
const to = String(argOf('--to', 'next'))
const outDir = pathFor(
  SELF_TEST ? String(argOf('--out', join(process.env.TEMP ?? '.', 'answer-kit-selftest'))) : String(argOf('--out', 'data/results')),
)

/** A paste is a post, not a log dump: this is the size the kit promises to stay inside. */
const LINE_BUDGET = 60
const BYTE_BUDGET = 8192

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

const run = (args) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: abs('.') })
  const stdout = String(result.stdout ?? '')
  const stderr = String(result.stderr ?? '')
  return { status: result.status, stdout, stderr }
}

/*
 * Every command the kit tells a reporter to run. `allowedExit` is per command because the exit code
 * carries meaning beyond success/failure — measured, not assumed: `why` is 0 on this machine and only
 * `why --strict` turns a non-`go` verdict into 1 (`exitFor()` in `packages/plugin/src/cli.ts`).
 */
const COMMANDS = [
  { id: 'help', args: ['--help'], allowedExit: [0], why: 'confirms the tool is installed' },
  { id: 'status', args: ['status'], allowedExit: [0], why: 'one screen: what this machine has and what looks wrong' },
  { id: 'why', args: ['why'], allowedExit: [0], why: 'row-by-row attribution; `--strict` is what turns a non-go verdict into exit 1' },
  { id: 'audit', args: ['audit'], allowedExit: [0], why: 'the same summary, plus the pointer to the full ledger' },
  { id: 'upgrade-card', args: ['upgrade', '--to', to, '--card'], allowedExit: [0], why: 'what would break if this machine moved to the named target' },
]

const results = []
let failed = false
for (const command of COMMANDS) {
  const executed = run(command.args)
  /*
   * `--self-test` replaces one command's stdout with text that DOES contain an absolute path. Without
   * it, the "no leaks" claim would only ever be evaluated against output that already has no leaks, and
   * a checker wired to always return "clean" would look exactly like a correct one.
   */
  const { status, stdout, stderr } = SELF_TEST && command.id === 'status'
    ? { ...executed, stdout: `分诊台 · profile web · C:\\Users\\alice\\profiles\\web\n` }
    : executed
  const { leaks, homeRelative } = findAbsolutePaths(stdout)
  const lines = stdout.split('\n').filter((line) => line.length > 0).length
  const bytes = Buffer.byteLength(stdout, 'utf8')
  const withinBudget = lines <= LINE_BUDGET && bytes <= BYTE_BUDGET
  /*
   * A failed command or a leaked path is a defect in the kit. Being longer than the budget is not:
   * a profile with forty plugins legitimately prints a longer card, and the kit tells the reader to
   * paste the part they need. The size is reported, not enforced.
   */
  const ok = command.allowedExit.includes(status) && leaks.length === 0
  if (!ok) failed = true
  results.push({
    id: command.id,
    command: `dsh-triage ${command.args.join(' ')}`,
    why: command.why,
    exit_code: status,
    allowed_exit: command.allowedExit,
    lines,
    bytes,
    within_budget: withinBudget,
    absolute_path_leaks: leaks,
    carries_home_relative_path: homeRelative,
    stdout_sha256: sha256(stdout),
    // The first lines are the pasteable shape; the hash is what a reader can re-derive.
    head: stdout.split('\n').slice(0, 6),
    ...(stderr.trim() === '' ? {} : { stderr_head: stderr.split('\n').slice(0, 4) }),
    ok,
  })
}

const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_answer_kit.mjs',
  generated_at: stamp,
  inputs: {
    cli: CLI,
    target: to,
    profile: 'the default profile of the machine that ran this',
    budgets: { lines: LINE_BUDGET, bytes: BYTE_BUDGET },
    kit: 'docs/distribution/answer-kit.md',
  },
  commands: results,
  summary: {
    commands: results.length,
    ok: results.filter((entry) => entry.ok).length,
    any_absolute_path: results.some((entry) => entry.absolute_path_leaks.length > 0),
    any_over_budget: results.some((entry) => !entry.within_budget),
    any_unexpected_exit: results.some((entry) => !entry.allowed_exit.includes(entry.exit_code)),
  },
  limits: [
    'this runs the kit\'s commands on the machine that ran the recorder; another profile can print different counts',
    'it checks shape, not meaning: a command can pass here and still not answer a specific thread',
    'it does not prove that upgrading to the target works — only `probe --execute` in an isolated DSH_HOME can say that',
    'the target defaults to `next`, which reads the registry; pass an exact semver to run fully offline',
    '`carries_home_relative_path` is informational: `~\\profiles\\<name>` names the reader\'s profile, not their home directory',
    '`within_budget` is informational: a profile with many plugins prints a longer card, and that is not a defect',
  ],
}

const text = `${JSON.stringify(artifact, null, 2)}\n`
const result = writeEvidence({ outDir, fileName: `answer-kit-${stamp.replaceAll(':', '-')}.json`, text })
if (!result.ok) {
  process.stderr.write(`refusing to overwrite existing evidence: ${join(outDir, 'answer-kit')}\n`)
  process.exit(2)
}

process.stdout.write(`ssot ${result.display} sha256=${result.sha256.slice(0, 12)}…\n`)
for (const entry of results) {
  process.stdout.write(
    `  ${entry.ok ? 'PASS' : 'FAIL'}  ${entry.command.padEnd(38)} ${String(entry.lines).padStart(3)} lines · ` +
      `${String(entry.bytes).padStart(5)} B · leaks ${entry.absolute_path_leaks.join(',') || 'none'}\n`,
  )
}
if (SELF_TEST) {
  // In a self-test the desired outcome is the opposite: the leak must be caught.
  const leaks = results.flatMap((entry) => entry.absolute_path_leaks)
  process.stdout.write(leaks.length > 0 ? 'NEGATIVE CONTROL PASSED · the leak was caught\n' : 'NEGATIVE CONTROL FAILED · the leak went through\n')
  process.exitCode = leaks.length > 0 ? 0 : 1
} else if (failed) {
  process.exitCode = 1
}
