/**
 * Types for `scripts/lib/client-bundle.mjs`, which the packaging unit test imports directly.
 *
 * WHY A HAND-WRITTEN DECLARATION: gate/record scripts are plain `.mjs` (zero dependencies, runnable
 * without a build), while `tsconfig.tests.json` type-checks every test. An `any` on the manifest here
 * would hide exactly the kind of shape drift (`exports` becoming an object with `default`) that this
 * check exists to catch.
 */

export const REQUIRED_SLOT: string
export const REQUIRED_LOADER: string

export interface InstalledFile {
  exists: boolean
  source?: string | null
}

export interface ClientBundleFacts {
  declared: boolean
  platform: string | null
  present: boolean
  loader: boolean
  slot: boolean
}

export interface ClientBundleVerdict {
  ok: boolean
  entry: string | null
  bytes: number
  facts: ClientBundleFacts
  missing: string[]
  detail: string
}

export function resolveClientEntry(manifest: Record<string, unknown> | null | undefined): string | null

export function judgeClientBundle(input: {
  manifest: Record<string, unknown> | null | undefined
  file: InstalledFile | null | undefined
}): ClientBundleVerdict
