/**
 * Hand-written types for `scripts/lib/handover-claims.mjs`.
 *
 * The helper is plain JS (it must run without a build step); the tests are TS. Without this file
 * `tsc -p tsconfig.tests.json` refuses the import with an implicit `any`.
 */

export declare const BATCH_ROW_BUDGET: number
export declare function countBatchRows(handoff: string): number
export declare function acceptanceTestCount(handoff: string): number | null
export declare function handoverSnapshotName(handoff: string): string | null
