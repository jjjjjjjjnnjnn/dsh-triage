/**
 * dsh.so registry adapter.
 *
 * Licensing (COMPLIANCE.md §4): dsh.so data is CC BY 4.0. Any surface that shows
 * it MUST attribute dsh.so, and MUST NOT reword its verdicts (e.g. turning
 * "L4 sandbox install passed" into "verified working on your machine").
 *
 * Blind spot (BS-06): L4/L5 are clean-sandbox measurements on one fixed
 * environment. They are `measured-registry`, never `measured-local`.
 */

import type { Evidence } from '@dsh-triage/core'
import type { FetchLike, SignalError } from './npm.js'

export type InstallVerificationState = 'passed' | 'failed' | 'unknown' | 'stale' | 'untested'

export interface InstallVerification {
  readonly name: string
  readonly version: string | null
  readonly dshVersion: string | null
  readonly state: InstallVerificationState
  /** Highest level reported by the registry, e.g. `L5`. */
  readonly level: string | null
  readonly verifiedAt: string | null
  readonly raw: unknown
}

export interface DshSoOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: FetchLike
  readonly timeoutMs?: number
}

const DEFAULT_BASE = 'https://www.dsh.so'

/**
 * Read the install-verification record for one plugin.
 *
 * The endpoint shape is intentionally treated as untrusted input: unknown fields
 * are preserved in `raw` and never guessed into strong claims.
 */
export async function fetchInstallVerification(
  name: string,
  options: DshSoOptions = {},
): Promise<{ ok: true; value: InstallVerification } | { ok: false; error: SignalError }> {
  const base = options.baseUrl ?? DEFAULT_BASE
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  const encoded = name.startsWith('@') ? name.replace('/', '%2F') : name
  const url = `${base}/data/install/${encoded}.json`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  try {
    const response = await fetchImpl(url, { signal: controller.signal })
    if (response.status === 404) {
      return { ok: false, error: { code: 'not-found', detail: `no install record for ${name}`, source: url } }
    }
    if (!response.ok) {
      return { ok: false, error: { code: 'network-error', detail: `HTTP ${response.status}`, source: url } }
    }
    const parsed: unknown = JSON.parse(await response.text())
    return { ok: true, value: projectInstallVerification(name, parsed) }
  } catch (error) {
    return {
      ok: false,
      error: { code: 'invalid-json', detail: error instanceof Error ? error.message : String(error), source: url },
    }
  } finally {
    clearTimeout(timer)
  }
}

const STATES: readonly InstallVerificationState[] = ['passed', 'failed', 'unknown', 'stale', 'untested']

/** Pure projection with defensive field reading (the API is third-party). */
export function projectInstallVerification(name: string, raw: unknown): InstallVerification {
  const record = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const stateRaw = record['state'] ?? record['status']
  const state = typeof stateRaw === 'string' && (STATES as readonly string[]).includes(stateRaw)
    ? (stateRaw as InstallVerificationState)
    : 'unknown'
  return {
    name,
    version: stringOrNull(record['version']),
    dshVersion: stringOrNull(record['dshVersion'] ?? record['dsh']),
    state,
    level: stringOrNull(record['level']),
    verifiedAt: stringOrNull(record['verifiedAt'] ?? record['checkedAt']),
    raw,
  }
}

export function dshSoEvidence(record: InstallVerification, at: string): Evidence {
  return {
    id: `dshso-${record.version ?? 'unknown'}`,
    tier: 'measured-registry',
    source: `dsh.so:${record.name}${record.version === null ? '' : `@${record.version}`}`,
    method: 'registry-install-verification',
    at,
    detail: `${record.level ?? 'L?'} ${record.state}${record.dshVersion === null ? '' : ` on dsh ${record.dshVersion}`}`,
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
