#!/usr/bin/env node
/**
 * Gate: the suite is green on an account that has no `~/.dsh` (R107).
 *
 * WHY THIS IS A GATE AND NOT ONLY R106's RECORDER. `scripts/record_ci_shape.mjs` turned the
 * 2026-11-12 incident (public CI run 43315617523: three jobs red for a day while the maintainer's
 * `pnpm run verify` stayed green) into a reading. A reading is only seen by whoever opens it, and
 * `BS-73` says exactly that: no gate ran the shape, so nothing stopped the shape from coming back.
 * This gate is that missing door.
 *
 * WHAT IT RUNS. The two files that read this machine's home (`SKIP_TOLERATED_FILES`), twice:
 *
 *   with_home    — this account as it is: every reading must RUN (0 failed, 0 skipped);
 *   without_home — one fresh empty USERPROFILE/HOME: no test may fail, and something must SKIP.
 *
 * The `with_home` half can only mean something on a machine that HAS a profile, so it is judged as
 * "not applicable" where there is none — otherwise this gate would be red on every CI runner, which
 * is the same mistake in the other direction. On that machine the anti-vacuity check still applies:
 * nothing skipped means the "could not look" path was deleted, not adapted.
 *
 * ZERO DEPENDENCIES on purpose (gate suite rule): `node --test`, TAP text, and an env object. It does
 * need the built `dist/` of the packages (the two files import it), so it declares `requires_build`.
 *
 * Negative control: `--mutate` feeds the judge the verbatim 2026-11-12 CI shape
 * (11 tests / 7 pass / 4 fail / 0 skipped) and the gate MUST go red on it.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { judgeShapes, SKIP_TOLERATED_FILES } from './lib/ci-shape.mjs'
import { abs, repoRoot, runGate } from './lib/kit.mjs'

/** The two files carry 11 tests between them (R106). Fewer means a reading was deleted. */
const MIN_TESTS = 11

const FILES = [...SKIP_TOLERATED_FILES]

/** Run the files with the given environment and read the TAP summary (same parser as the recorder). */
function runSuite(env) {
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...FILES], {
    cwd: repoRoot(),
    encoding: 'utf8',
    env,
    windowsHide: true,
  })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const count = (label) => {
    const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(output)
    return match === null ? null : Number(match[1])
  }
  return {
    exit_code: run.status === null ? -1 : run.status,
    tests: count('tests'),
    pass: count('pass'),
    fail: count('fail'),
    skipped: count('skipped'),
  }
}

/**
 * Does THIS account have a profile the two files can actually read?
 *
 * Mirrors what `loadEnv` needs (`<dshHome>/profiles/<name>/package.json`) instead of importing the
 * engine: the gate may not depend on a build, and "same rule as the loader" is a one-line shape.
 */
function hasProfile() {
  const profiles = join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '', '.dsh', 'profiles')
  try {
    return readdirSync(profiles, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && existsSync(join(profiles, entry.name, 'package.json')),
    )
  } catch {
    /* An unreadable directory is "no profile here", which is a fact about this machine, not a failure. */
    return false
  }
}

await runGate('clean-home', async ({ checks, mutate }) => {
  const present = FILES.filter((file) => existsSync(abs(file)))
  if (!checks.require('files-present', present.length === FILES.length, `${present.length}/${FILES.length} of ${FILES.join(', ')}`)) {
    return
  }

  const baseEnv = { ...process.env }
  delete baseEnv['DSH_HOME']
  const withHome = runSuite(baseEnv)

  const emptyHome = mkdtempSync(join(tmpdir(), 'dsh-triage-clean-home-'))
  let withoutHome
  try {
    withoutHome = runSuite({ ...baseEnv, USERPROFILE: emptyHome, HOME: emptyHome })
  } finally {
    try {
      rmSync(emptyHome, { recursive: true, force: true })
    } catch {
      /* A leftover temp dir is not a verdict: the numbers below already say which run this was. */
    }
  }

  const profilePresent = hasProfile()

  /*
   * THE INJECTION IS THE INCIDENT ITSELF, not a made-up number: `run 43315617523` on 2026-11-12 read
   * 11 tests / 7 pass / 4 fail / 0 skipped on all three jobs. If the judge ever stops calling that
   * red, the gate has stopped guarding the thing it was built for.
   */
  const judged = mutate
    ? { ...withoutHome, tests: 11, pass: 7, fail: 4, skipped: 0 }
    : withoutHome

  const verdict = judgeShapes({ profilePresent, withHome, withoutHome: judged })
  checks.add(
    'shapes-green',
    verdict.ok,
    verdict.problems.length > 0
      ? `${verdict.problems.join(' | ')}${mutate ? ' [injected: the 2026-11-12 CI shape]' : ''}`
      : `with_home ${String(withHome.pass)}/${String(withHome.tests)}${profilePresent ? '' : ' (not applicable: no profile here)'} · ` +
          `without_home ${String(judged.pass)}/${String(judged.tests)} · ${String(judged.fail)} failed · ${String(judged.skipped)} skipped`,
  )

  checks.add(
    'readings-not-deleted',
    (withHome.tests ?? 0) >= MIN_TESTS && (judged.tests ?? 0) >= MIN_TESTS,
    `${FILES.join(', ')} carry ${String(withHome.tests)} / ${String(judged.tests)} tests, floor is ${String(MIN_TESTS)}`,
  )

  /* A run that cannot be parsed is "nothing proven"; `judgeShapes` says so for both sides. */
  checks.add(
    'tap-readable',
    withHome.fail !== null && judged.fail !== null,
    `with_home exit ${String(withHome.exit_code)} · without_home exit ${String(withoutHome.exit_code)}`,
  )
})
