/**
 * The reading rule for `scripts/record_ci_shape.mjs` (R106).
 *
 * WHY IT IS A FUNCTION AND NOT THREE `if`s IN THE RECORDER: the pair of shapes is the evidence.
 * `with_home` proves the readings still RUN on the machine that has a profile; `without_home`
 * proves they STOP instead of failing where there is none. Either alone is satisfiable by a
 * vacuous change:
 *
 *   - deleting the readings      → with_home.skipped 0 (green), without_home.tests shrinks (green)
 *   - converting them to skips   → with_home.skipped > 0 (RED here)
 *   - keeping the failing forms  → without_home.fail > 0 (RED here)
 *
 * Tests assert all three (tests/unit/ci-shape.test.ts). The recorder only prints.
 */

/** A suite that needs this machine's `~/.dsh`. Listed here so the recorder and the test cannot disagree. */
export const SKIP_TOLERATED_FILES = Object.freeze([
  'tests/unit/composition-source.test.ts',
  'tests/unit/desktop-misreport.test.ts',
])

/**
 * @param {'with_home' | 'without_home'} name
 * @param {{ tests: number | null, pass: number | null, fail: number | null, skipped: number | null }} shape
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function judgeShape(name, shape) {
  const problems = []
  const labels = name === 'with_home' ? 'on the machine that HAS the profile' : 'on an account with no profile'

  if (
    shape.tests === null ||
    shape.pass === null ||
    shape.fail === null ||
    shape.skipped === null
  ) {
    /* An unreadable summary is not a green run: it is a run nobody can point at. */
    return { ok: false, problems: [`${name}: the TAP summary was unreadable, so nothing is proven`] }
  }
  if (shape.fail > 0) {
    problems.push(`${name}: ${shape.fail} test(s) failed ${labels} — a reading is not a failure`)
  }
  if (name === 'with_home' && shape.skipped > 0) {
    /* This is the "turned a reading into a skip" shape: it hides the check on the only machine that can run it. */
    problems.push(`with_home: ${shape.skipped} test(s) skipped on the machine that HAS the profile`)
  }
  if (name === 'without_home' && shape.skipped === 0) {
    /* And this is the "deleted the readings" shape: nothing was left to skip. */
    problems.push('without_home: nothing skipped, so this run did not exercise the skip path (0 tests deleted?)')
  }
  return { ok: problems.length === 0, problems }
}

/**
 * The pair rule `scripts/gate_clean_home.mjs` enforces (R107).
 *
 * `judgeShape` answers "is this ONE shape green". A gate also has to answer "was this shape allowed
 * to be green here", because the `with_home` half can only mean something on a machine that has a
 * profile:
 *
 *   - machine HAS a profile  → `with_home` must run (0 failed, 0 skipped) AND `without_home` must stop;
 *   - machine has NO profile → both runs see the same empty home, so demanding `with_home` skips 0
 *                              would make the gate red on every CI runner (that is the R106 incident
 *                              in reverse). What must still hold is that the readings STOP there:
 *                              zero skips would mean the "could not look" path was deleted.
 *
 * @param {{
 *   profilePresent: boolean,
 *   withHome: { tests: number | null, pass: number | null, fail: number | null, skipped: number | null },
 *   withoutHome: { tests: number | null, pass: number | null, fail: number | null, skipped: number | null },
 * }} shapes
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function judgeShapes({ profilePresent, withHome, withoutHome }) {
  const problems = []

  if (profilePresent) {
    problems.push(...judgeShape('with_home', withHome).problems)
  } else if (withHome.tests === null || withHome.pass === null || withHome.fail === null || withHome.skipped === null) {
    /* Both runs use the same empty home here, so an unreadable summary is still "nothing proven". */
    problems.push('this machine has no profile, and the same-home run was unreadable, so nothing is proven')
  } else if (withHome.skipped === 0 && withHome.fail === 0) {
    /*
     * No profile, and nothing stopped: the files no longer exercise the "could not look" path at
     * all. That is the "deleted the readings" shape wearing the other machine's clothes.
     */
    problems.push(
      'this machine has no profile, but nothing skipped: the readings were deleted rather than adapted, ' +
        'so the CI shape is no longer being exercised',
    )
  }

  problems.push(...judgeShape('without_home', withoutHome).problems)
  return { ok: problems.length === 0, problems }
}
