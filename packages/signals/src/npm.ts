/**
 * npm registry adapter (metadata only).
 *
 * Contract:
 * - We read `version`, `engines`, `peerDependencies`, `deprecated`, `time`.
 * - We never download or execute tarballs here; that belongs to `probe`, behind
 *   an explicit opt-in and the `quarantine/` gate.
 * - `fetch` is injected so tests never touch the network.
 *
 * Evidence tier: `declared` (what the author published), not `measured-*`.
 */

import type { Evidence } from '@dsh-triage/core'

export interface NpmVersionManifest {
  readonly version: string
  readonly engines?: unknown
  readonly peerDependencies?: unknown
  readonly deprecated?: string
}

export interface NpmPackument {
  readonly name: string
  readonly latest: string | null
  readonly versions: ReadonlyMap<string, NpmVersionManifest>
  readonly modified: string | null
  /**
   * Every dist-tag the author publishes (`latest`, `next`, `rc`, …).
   *
   * WHY (T-109 / CASE-10849): `@deepseek-ai/dsh-tools` had `latest` pointing at
   * `0.0.1-rc.1` while `0.2.1-rc.x` was already published. A user who installs the
   * bare name gets the stale build and is then denied by admission — the failure
   * starts in the tag, not in the range. Reading only `latest` made that invisible.
   */
  readonly distTags: Readonly<Record<string, string>>
  /** Publish timestamps per version (`time` minus `created`/`modified`), ISO strings. */
  readonly publishedAt: Readonly<Record<string, string>>
}

export type SignalErrorCode = 'network-error' | 'not-found' | 'invalid-json' | 'invalid-payload' | 'unsupported'

export interface SignalError {
  readonly code: SignalErrorCode
  readonly detail: string
  /** Where the request went, for reporting. */
  readonly source: string
}

export type FetchLike = (url: string, init?: { readonly signal?: AbortSignal }) => Promise<{
  readonly ok: boolean
  readonly status: number
  text(): Promise<string>
}>

export interface NpmAdapterOptions {
  readonly registry?: string
  readonly fetchImpl?: FetchLike
  readonly timeoutMs?: number
  /** ISO timestamp for evidence; injected so output stays deterministic. */
  readonly at: string
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

/** URL-safe encoding for scoped names (`@scope/pkg` -> `@scope%2Fpkg`). */
export function encodePackageName(name: string): string {
  return name.replace('/', '%2F')
}

export async function fetchPackument(name: string, options: NpmAdapterOptions) {
  const registry = options.registry ?? DEFAULT_REGISTRY
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  const url = `${registry}/${encodePackageName(name)}`
  const timeoutMs = options.timeoutMs ?? 15_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { signal: controller.signal })
    if (response.status === 404) {
      return { ok: false as const, error: { code: 'not-found' as const, detail: `npm has no package ${name}`, source: url } }
    }
    if (!response.ok) {
      return {
        ok: false as const,
        error: { code: 'network-error' as const, detail: `HTTP ${response.status}`, source: url },
      }
    }
    const text = await response.text()
    const parsed = parsePackument(text)
    if (!parsed.ok) return parsed
    return { ok: true as const, value: parsed.value }
  } catch (error) {
    return {
      ok: false as const,
      error: {
        code: 'network-error' as const,
        detail: error instanceof Error ? error.message : String(error),
        source: url,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Pure JSON -> packument projection. Exported for tests and offline fixtures. */
export function parsePackument(text: string):
  | { readonly ok: true; readonly value: NpmPackument }
  | { readonly ok: false; readonly error: SignalError } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      error: { code: 'invalid-json', detail: error instanceof Error ? error.message : String(error), source: 'npm' },
    }
  }
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: { code: 'invalid-payload', detail: 'packument is not an object', source: 'npm' } }
  }
  const record = raw as Record<string, unknown>
  const name = typeof record['name'] === 'string' ? record['name'] : ''
  const distTagsRaw = record['dist-tags']
  const distTags: Record<string, string> = {}
  if (distTagsRaw !== null && typeof distTagsRaw === 'object') {
    for (const [tag, version] of Object.entries(distTagsRaw as Record<string, unknown>)) {
      // `dist-tags` is author-controlled JSON: keep only well-formed entries.
      if (typeof version === 'string' && version.trim() !== '') distTags[tag] = version.trim()
    }
  }
  const latest = distTags['latest'] ?? null

  const versionsRaw = record['versions']
  const versions = new Map<string, NpmVersionManifest>()
  if (versionsRaw !== null && typeof versionsRaw === 'object') {
    for (const [version, manifest] of Object.entries(versionsRaw as Record<string, unknown>)) {
      if (manifest === null || typeof manifest !== 'object') continue
      const manifestRecord = manifest as Record<string, unknown>
      versions.set(version, {
        version,
        engines: manifestRecord['engines'],
        peerDependencies: manifestRecord['peerDependencies'],
        deprecated: manifestRecord['deprecated'] === undefined
          ? undefined
          : typeof manifestRecord['deprecated'] === 'string' && manifestRecord['deprecated'].trim() !== ''
            ? manifestRecord['deprecated']
            : undefined,
      })
    }
  }

  const time = record['time']
  const modified =
    time !== null && typeof time === 'object' && typeof (time as Record<string, unknown>)['modified'] === 'string'
      ? ((time as Record<string, unknown>)['modified'] as string)
      : null

  const publishedAt: Record<string, string> = {}
  if (time !== null && typeof time === 'object') {
    for (const [version, value] of Object.entries(time as Record<string, unknown>)) {
      // `created` / `modified` are package-level keys, not versions.
      if (version === 'created' || version === 'modified') continue
      if (typeof value === 'string' && value.trim() !== '') publishedAt[version] = value
    }
  }

  return { ok: true, value: { name, latest, versions, modified, distTags, publishedAt } }
}

/** Evidence describing the npm facts that a verdict rested on. */
export function npmEvidence(packument: NpmPackument, version: string, at: string): Evidence {
  return {
    id: `npm-${version}`,
    tier: 'declared',
    source: `npm:${packument.name}@${version}`,
    method: 'registry-metadata',
    at,
    detail: packument.modified === null ? undefined : `packument modified ${packument.modified}`,
  }
}
