/** Types for `scripts/lib/discussion-probe.mjs`. */

export interface ProbeTarget {
  name: string
  pinned?: string | null
  probeable?: boolean
  reason?: string | null
}

export interface RejectedName {
  name: string
  reason: string
}

export interface NameVerdict {
  probeable: boolean
  reason: string | null
}

export type ProbePlanItem =
  | { kind: 'fetch'; name: string; pinned: string | null }
  | { kind: 'rejected'; name: string; record: PackageProbe }

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

/** R88 / X2: can this token even be an npm package name? */
export declare function judgePackageName(name: string): NameVerdict

export declare function selectProbeTargets(
  classification: { packages?: string[] },
  text: string,
  options?: { limit?: number },
): { targets: ProbeTarget[]; rejected: RejectedName[]; omitted: number; packages: string[] }

/** R88 / X2: the exact sequence of records and requests, with no I/O. */
export declare function planProbeTargets(targets: readonly ProbeTarget[]): ProbePlanItem[]

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
