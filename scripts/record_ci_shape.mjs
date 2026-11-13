#!/usr/bin/env node
/**
 * The "CI shape": typecheck passes, AND the suite is green on an account with no `~/.dsh` (R106).
 *
 * WHY THIS EXISTS. `pnpm run verify` (build → typecheck → test → gate) was RED at the commit this
 * round inherited, while the nine gates and the four-hundred-artifact ledger were green:
 *
 *   1. `tsc -p tsconfig.tests.json --noEmit` failed on `tests/governance/handover-claims.test.ts`
 *      (`match[1]` is `string | undefined` under `noUncheckedIndexedAccess`). `node --test` strips
 *      types, so all 980 tests still passed. **No gate runs tsc** — the nine gates are built-in-only
 *      by design — so a round that records only `gate.mjs --record` hands over a tree where the
 *      command the handover tells you to run (`pnpm run verify`) is red.
 *   2. Four unit tests read THIS machine's `~/.dsh`. On any runner without the maintainer's profile
 *      they failed instead of skipping: public CI run 43315617523 (2026-11-12, three jobs) was red
 *      for a day, while `pnpm run verify` here was green. A test that needs this machine must say so
 *      and stop — "could not look" is not "agrees".
 *
 * WHAT IT MEASURES, both sides of the same files:
 *   - `with_home`    — the real account: the readings must RUN (skips 0, failures 0);
 *   - `without_home` — a fresh empty HOME/USERPROFILE: no test may fail, and at least one must SKIP
 *                      (a zero-skip run there would mean the files got deleted, not adapted).
 * Turning a reading into a skip on this machine would show up as `with_home.skipped > 0`; deleting
 * the reading would show up as `without_home.tests` shrinking. Both are recorded, not judged.
 *
 * WHAT IT IS NOT: it is not a gate (it needs `node_modules/typescript`, and the gate suite may not
 * depend on anything). It records a state; `pnpm run verify` remains the authority.
 *
 *   node scripts/record_ci_shape.mjs --stamp 2026-11-13T10:00:00.000Z
 *   node scripts/record_ci_shape.mjs --out %TEMP%          # control run, writes nothing to SSOT
 *
 * EXIT CODES: 0 green · 1 red (artifact still written) · 2 could not measure (zero artifact).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
// @ts-ignore -- evidence.mjs is plain ESM without a .d.mts on purpose (the scripts are not typechecked).
import { writeEvidence } from './lib/evidence.mjs'
import { judgeShape, SKIP_TOLERATED_FILES } from './lib/ci-shape.mjs'
import { abs, isoStamp, repoRoot } from './lib/kit.mjs'

/** The files that read this machine's home, and therefore may skip where there is none. */
const FILES = [...SKIP_TOLERATED_FILES]

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-11-13T10:00:00.000Z\n`)
  process.exit(2)
}

const root = repoRoot()
const outDir = String(argOf('--out', 'data/results'))
/* An absolute `--out` is the caller's path, not a repo-relative one (R97's `release_preflight` checks this). */
const outDirAbs = isAbsolute(outDir) ? outDir : abs(outDir)

/** Run the two files with the given environment and read the TAP summary. */
function runSuite(env) {
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...FILES], {
    cwd: root,
    encoding: 'utf8',
    env,
    windowsHide: true,
  })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const count = (label) => {
    const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(output)
    return match === null ? null : Number(match[1])
  }
  const counts = { tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped') }
  return {
    exit_code: run.status === null ? -1 : run.status,
    ...counts,
    // A run we cannot parse is not a green run.
    readable: counts.tests !== null && counts.pass !== null && counts.fail !== null && counts.skipped !== null,
    tail: output.trimEnd().split(/\r?\n/).slice(-6).join('\n'),
  }
}

/* --- 1. typecheck: the half no gate covers --------------------------------------------------- */
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tsc)) {
  process.stderr.write(
    'cannot measure: node_modules/typescript is missing, so the typecheck half would be a guess\n' +
      '  run `pnpm install` first (this recorder is not a gate: it may use the dev dependency)\n',
  )
  process.exit(2)
}
const check = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.tests.json', '--noEmit'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
})
const checkOutput = `${check.stdout ?? ''}${check.stderr ?? ''}`
const typecheck = {
  ok: check.status === 0,
  exit_code: check.status === null ? -1 : check.status,
  errors: checkOutput
    .split(/\r?\n/)
    .filter((line) => /error TS\d+/u.test(line))
    .slice(0, 10),
}

/* --- 2. the two shapes of the same files ------------------------------------------------------ */
const baseEnv = { ...process.env, DSH_HOME: '' }
delete baseEnv.DSH_HOME
const withHome = runSuite(baseEnv)

const emptyHome = mkdtempSync(join(tmpdir(), 'dsh-triage-ci-shape-'))
let withoutHome
try {
  withoutHome = runSuite({ ...baseEnv, USERPROFILE: emptyHome, HOME: emptyHome })
} finally {
  try {
    rmSync(emptyHome, { recursive: true, force: true })
  } catch {
    /* A leftover temp dir is not a measurement failure; the artifact already says which run it was. */
  }
}

/* --- 3. the two conditions, stated before the numbers ----------------------------------------- */
const problems = []
if (!typecheck.ok) problems.push(`typecheck is red (${typecheck.errors[0] ?? 'no error line parsed'})`)
for (const [name, shape] of [
  ['with_home', withHome],
  ['without_home', withoutHome],
]) {
  const verdict = judgeShape(name, shape)
  problems.push(...verdict.problems)
}

const ok = problems.length === 0
const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_ci_shape.mjs',
  generated_at: stamp,
  ok,
  problems,
  typecheck,
  shapes: {
    with_home: withHome,
    without_home: { ...withoutHome, home: '<fresh empty HOME/USERPROFILE, removed after the run>' },
  },
  inputs: { files: FILES, tsc: 'node_modules/typescript/bin/tsc', home_policy: 'USERPROFILE and HOME point at one empty temp dir; DSH_HOME removed' },
  limits: [
    'not a gate: it needs node_modules/typescript, and the gate suite must stay dependency-free',
    '`pnpm run verify` is still the authority; this records the two shapes that verify does not separate: a runner without the maintainer profile, and typecheck',
    'the with_home run uses whatever `~/.dsh` this machine has; the numbers describe THIS account, not a clean install',
    'skips are counted, not explained: which test skipped is in the TAP output of the run, not in this artifact',
  ],
}

const written = writeEvidence({ outDir: outDirAbs, fileName: `ci-shape-${stamp.replaceAll(':', '-')}.json`, text: `${JSON.stringify(payload, null, 2)}\n`, root })
if (written.ok !== true) {
  process.stderr.write(`refusing to overwrite ${written.target}\n`)
  process.exit(2)
}

process.stdout.write(
  `ssot ${written.display} sha256=${written.sha256.slice(0, 12)}…\n` +
    `  typecheck   ${typecheck.ok ? 'green' : `RED (${typecheck.errors.length} error line(s))`}\n` +
    `  with_home   ${withHome.pass}/${withHome.tests} pass · ${withHome.skipped} skipped · ${withHome.fail} failed\n` +
    `  without_home ${withoutHome.pass}/${withoutHome.tests} pass · ${withoutHome.skipped} skipped · ${withoutHome.fail} failed\n`,
)
if (!ok) process.stdout.write(`  ${problems.join('\n  ')}\n`)
process.exit(ok ? 0 : 1)
