/** Types for `scripts/lib/discussion-probe.mjs`. */

export interface ProbeTarget {
  name: string
  pinned: string | null
}

export interface PackageProbe {
  package: string
  state: 'measured' | 'unreadable'
  version?: string
  version_source?: 'thread-pinned' | 'latest'
  target?: string
  admission_status?: 'admitted' | 'denied' | 'unconstrained' | 'indeterminate'
  mode?: string
  admits_target?: boolean
  declared_range?: string | null
  unmet?: string[]
  detail?: string
  verdict: null
}

export declare function pinnedVersions(text: string): Map<string, string>

export declare function selectProbeTargets(
  classification: { packages?: string[] },
  text: string,
  options?: { limit?: number },
): { targets: ProbeTarget[]; omitted: number; packages: string[] }

export declare function packumentFromSnapshot(snapshot: unknown): {
  name: string
  latest: string | null
  versions: Map<string, { version: string; engines?: unknown; peerDependencies?: unknown; deprecated?: string }>
  modified: null
  distTags: Record<string, string>
  publishedAt: Record<string, string>
}

export declare function probePackage(
  name: string,
  target: string,
  options: {
    pinned?: string | null
    loadPackument: (name: string) => Promise<{ ok: boolean; value?: unknown; error?: { code?: string; detail?: string } }>
  },
): Promise<PackageProbe>
