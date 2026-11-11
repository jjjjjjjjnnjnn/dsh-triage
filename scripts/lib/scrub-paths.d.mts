/**
 * Types for `scripts/lib/scrub-paths.mjs` (R94).
 *
 * WHY A HAND-WRITTEN DECLARATION: the recorder is plain `.mjs`, while the test that pins this
 * scrub is type-checked. Without it the import collapses to `any` and the difference that matters —
 * "a string with a home path" versus "the same string with it removed" — stops being checked.
 */

export function scrubAbsolutePaths(value: unknown, home: string): unknown
