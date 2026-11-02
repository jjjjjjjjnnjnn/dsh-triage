/**
 * Types for `scripts/lib/channels.mjs` (R73).
 *
 * WHY HAND-WRITTEN: recorders and the checker are plain `.mjs`; the tests are type-checked. The one thing
 * this module must not allow is a sloppy `platform` winning an `any` comparison — the whole point is that a
 * Reddit link and a GitHub discussion are counted differently.
 */

export const CHANNEL_PLATFORMS: Readonly<Record<string, RegExp>>
export const CHANNEL_EVIDENCE: ReadonlyArray<string>

export interface ChannelVerdict {
  ok: boolean
  problems: string[]
  counted: string | null
}

export function judgeChannels(input: {
  channels: unknown
  now: string | number | Date
  registryUrl?: string | null
  registryPostedOn?: string | null
}): ChannelVerdict
