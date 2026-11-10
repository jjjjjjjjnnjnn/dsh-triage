/**
 * Types for `scripts/lib/index-order.mjs`.
 *
 * WHY HAND-WRITTEN: the recorder is plain `.mjs`; the tests are type-checked. Without this file the test import
 * resolves to `any` and the one thing worth pinning — that the entry really carries a string `id` — stops being
 * checked. `assertAscendingIds` stays `unknown[]` because it must be able to refuse malformed input.
 */

export type CommunityEntry = Record<string, unknown>

/**
 * Returns a new array containing `entry`; never mutates `entries`.
 * Throws when `entries` is not an array, when `entry.id` is not a non-empty string, or when the id is already present.
 */
export declare function insertByEntryId<E extends CommunityEntry>(entries: readonly E[], entry: E): E[]

/**
 * Throws unless every pair of adjacent string ids is ascending (`previous > current` is the only refusal).
 */
export declare function assertAscendingIds(entries: readonly unknown[]): void
