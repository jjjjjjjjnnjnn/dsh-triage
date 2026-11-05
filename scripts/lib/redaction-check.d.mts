/** Types for `scripts/lib/redaction-check.mjs`. */

/** R88 / X1-A: which absolute-path classes appear in this text, and whether it names a profile. */
export declare function findAbsolutePaths(text: string): { leaks: string[]; homeRelative: boolean }
