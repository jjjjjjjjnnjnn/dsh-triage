/** Types for `scripts/lib/publish-target.mjs`. */

export interface PublishVersionInput {
  /** The value of `--version`, already as text (or absent). */
  requested?: unknown
  /** `version` from `packages/plugin/package.json` — the package users install. */
  manifestVersion?: unknown
}

export type PublishVersion =
  | { ok: true; version: string; source: 'argument' | 'manifest' }
  | { ok: false; error: string }

export declare function resolvePublishVersion(input: PublishVersionInput): PublishVersion
