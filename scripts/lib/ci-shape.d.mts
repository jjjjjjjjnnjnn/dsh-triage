/**
 * Types for `scripts/lib/ci-shape.mjs`.
 *
 * Kept hand-written (like the other `.d.mts` files here) so `tsc -p tsconfig.tests.json` can type the
 * pure part of the CI-shape recorder without giving the plain-JS helper a build step.
 */

export declare const SKIP_TOLERATED_FILES: readonly string[]

export declare interface SuiteShape {
  readonly tests: number | null
  readonly pass: number | null
  readonly fail: number | null
  readonly skipped: number | null
}

export declare interface ShapeVerdict {
  readonly ok: boolean
  readonly problems: readonly string[]
}

/**
 * Judge one run of the suite by its own counts, not by a hoped-for outcome.
 *
 * @param name which shape this is (`with_home` / `without_home`) — the rules differ
 * @param shape the TAP counts, `null` where the line was unreadable
 */
export declare function judgeShape(name: 'with_home' | 'without_home', shape: SuiteShape): ShapeVerdict

/**
 * Judge both shapes together, including whether the `with_home` half could mean anything on this
 * machine (R107 uses this as a gate, not only as a recording).
 */
export declare function judgeShapes(shapes: {
  readonly profilePresent: boolean
  readonly withHome: SuiteShape
  readonly withoutHome: SuiteShape
}): ShapeVerdict
