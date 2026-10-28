/**
 * A format-1 plugin-market index built from OUR OWN measurements (M4-b / T-403).
 *
 * WHY THIS IS ONLY A FILTER: the format has no verdict field — unknown members are dropped by the
 * upstream validator (measured: `@deepseek-ai/dsh-plugin-market-index@0.2.1-rc.4`). So the only honest
 * difference this project can make in an index is WHICH versions appear: versions a recorded probe
 * reached `go` on, for a dsh range that covers the runtime it was measured against. Everything else
 * (title, versions, timestamps) is declared metadata copied from the registry, never invented here.
 *
 * WHAT IT REFUSES TO DO: invent a `publishTimestamp` (the validator wants per-version integer seconds
 * and the registry is the only source), list a version nobody measured, or carry a verdict in a field
 * the format does not define.
 */

/** One eligible version, assembled by the caller from evidence + registry metadata. */
export interface IndexEntry {
  readonly name: string
  readonly version: string
  /** Unix seconds, from the registry's per-version `time`. Never derived from something else. */
  readonly publishTimestamp: number
  /** The `engines.dsh` range the package declared for this version, when it declared one. */
  readonly dshRange: string | null
  readonly title?: { readonly en: string; readonly zh?: string }
}

export interface MarketIndexDocument {
  readonly format: 1
  readonly title: { readonly en: string; readonly zh: string }
  readonly description: { readonly en: string; readonly zh: string }
  readonly metadata: { readonly categories: Record<string, unknown>; readonly labels: Record<string, unknown>; readonly sortKeys: Record<string, unknown> }
  readonly plugins: readonly {
    readonly name: string
    readonly title?: { readonly en: string; readonly zh?: string }
    readonly metadata: { readonly keywords: readonly string[] }
    readonly versions: readonly {
      readonly version: string
      readonly publishTimestamp: number
      readonly source: { readonly type: 'npm' }
      readonly engines?: { readonly dsh?: string }
    }[]
  }[]
}

/** Only exact SemVer may appear in an index (the validator rejects ranges and tags). */
const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

/** A `workspace:` range is invalid in a published index, and an empty one says nothing. */
function usableRange(range: string | null): string | null {
  if (range === null) return null
  const trimmed = range.trim()
  if (trimmed === '' || trimmed.startsWith('workspace:')) return null
  return trimmed
}

/**
 * Build the document. Entries that cannot be stated exactly (bad SemVer, no timestamp) are dropped and
 * reported, because a skipped entry is a fact about the evidence while a fabricated one is a lie.
 */
export function buildMarketIndex(
  entries: readonly IndexEntry[],
  options: { readonly generatedFor?: string } = {},
): { document: MarketIndexDocument; skipped: { name: string; version: string; reason: string }[] } {
  const skipped: { name: string; version: string; reason: string }[] = []
  const byName = new Map<string, IndexEntry[]>()
  for (const entry of entries) {
    if (!EXACT_SEMVER.test(entry.version)) {
      skipped.push({ name: entry.name, version: entry.version, reason: 'not an exact SemVer version' })
      continue
    }
    if (!Number.isInteger(entry.publishTimestamp) || entry.publishTimestamp <= 0) {
      skipped.push({ name: entry.name, version: entry.version, reason: 'no per-version publish timestamp' })
      continue
    }
    const list = byName.get(entry.name) ?? []
    list.push(entry)
    byName.set(entry.name, list)
  }

  const plugins = [...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, list]) => {
      const versions = [...list]
        .sort((left, right) => (left.version === right.version ? 0 : left.version < right.version ? 1 : -1))
        .map((entry) => {
          const dsh = usableRange(entry.dshRange)
          return {
            version: entry.version,
            publishTimestamp: entry.publishTimestamp,
            source: { type: 'npm' as const },
            ...(dsh === null ? {} : { engines: { dsh } }),
          }
        })
      const first = list[0]!
      return {
        name,
        ...(first.title === undefined ? {} : { title: first.title }),
        metadata: { keywords: ['dsh-plugin'] },
        versions,
      }
    })

  const forRuntime = options.generatedFor ?? 'the local runtime'
  return {
    document: {
      format: 1,
      title: { en: 'Triage-verified DSH plugins', zh: '分诊台实测通过的 DSH 插件' },
      description: {
        en: `Only versions a local dsh-triage run reached "go" on, measured against ${forRuntime}. An absent package was never measured here — not a judgement.`,
        zh: `只收录在本地 dsh-triage 实测得到 go 的版本，测量基准是 ${forRuntime}。没出现的包=这里没测过，不是判定。`,
      },
      metadata: { categories: {}, labels: {}, sortKeys: {} },
      plugins,
    },
    skipped,
  }
}

/** The subset of a probe artifact this module reads. */
export interface MeasuredCandidate {
  readonly generated_at?: unknown
  readonly conclusion?: unknown
  readonly candidate?: {
    readonly package?: unknown
    readonly kind?: unknown
    readonly resolved?: { readonly version?: unknown } | null
  }
  readonly runtime?: { readonly version?: unknown } | null
  readonly sandbox?: { readonly hook_config?: unknown } | null
}

/**
 * Turn recorded runs into index entries: newest `go` per package, registry candidates only (a local
 * directory has no npm version to publish), diagnostics excluded (R26 rule).
 */
export function entriesFromEvidence(
  records: readonly { readonly artifact: string; readonly payload: MeasuredCandidate }[],
  publishTimes: (name: string, version: string) => number | null,
  ranges: (name: string, version: string) => string | null,
): { entries: IndexEntry[]; excluded: { package: string; reason: string }[] } {
  const newest = new Map<string, { version: string; generatedAt: string }>()
  /** Why a package did NOT make it in; only reported when it contributes no entry at all. */
  const reasons = new Map<string, string>()
  for (const record of records) {
    const name = record.payload.candidate?.package
    if (typeof name !== 'string') continue
    const version = record.payload.candidate?.resolved?.version
    const generatedAt = String(record.payload.generated_at ?? '')
    const reason =
      record.payload.candidate?.kind !== 'registry'
        ? 'not a registry candidate (no npm version to list)'
        : record.payload.sandbox?.hook_config !== undefined && record.payload.sandbox?.hook_config !== null
          ? 'recorded through a diagnostic hook'
          : record.payload.conclusion !== 'go'
            ? `conclusion was ${String(record.payload.conclusion)}`
            : typeof version !== 'string'
              ? 'no resolved version recorded'
              : null
    if (reason !== null) {
      // The newest record explains the CURRENT state; an older failure does not describe today.
      const previousAt = newest.get(`${name}|why`)?.generatedAt ?? ''
      if (generatedAt >= previousAt) {
        reasons.set(name, reason)
        newest.set(`${name}|why`, { version: '', generatedAt })
      }
      continue
    }
    const current = newest.get(name)
    if (current === undefined || generatedAt > current.generatedAt) newest.set(name, { version: version as string, generatedAt })
  }

  const entries: IndexEntry[] = []
  const excluded: { package: string; reason: string }[] = []
  for (const [name, chosen] of [...newest.entries()].filter(([key]) => !key.endsWith('|why')).sort(([left], [right]) => left.localeCompare(right))) {
    const publishTimestamp = publishTimes(name, chosen.version)
    if (publishTimestamp === null) {
      excluded.push({ package: name, reason: 'the registry published no timestamp for that version' })
      continue
    }
    entries.push({ name, version: chosen.version, publishTimestamp, dshRange: ranges(name, chosen.version) })
  }
  // A package that never reached `go` is reported once, with its newest reason.
  for (const [name, reason] of [...reasons.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (entries.some((entry) => entry.name === name)) continue
    excluded.push({ package: name, reason })
  }
  return { entries, excluded }
}
