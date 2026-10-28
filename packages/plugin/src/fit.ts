/**
 * "Would this candidate fit THIS profile?" — one judgment, two callers.
 *
 * WHY THIS MODULE EXISTS (T-404):
 * `dsh-triage check` answers the question from a terminal, and the Host-side `compat_verdict`
 * tool answers it from inside an agent session. Two implementations would drift; one module
 * that both consume cannot. It composes the SAME engine functions `check` already uses —
 * `fetchPackument` → `evaluateAdmission` → `judgeVersionDrift` → `verdictFromAdmission` — and
 * adds no rule of its own.
 *
 * WHAT IT IS NOT: it does not install, does not execute candidate code, does not read
 * credentials, and does not answer "is this safe". A `go` here means "the published
 * declaration admits this runtime", nothing more (铁律 1 / 严禁行为 2).
 *
 * The failure path is a first-class verdict, not an exception: a tool that throws gives the
 * model nothing to report, so every way of not being able to judge ends in `unknown` +
 * `missing.admission` + a reason that names the real cause (BACKLOG T-404 acceptance).
 */

import type { AdmissionResult, EnvFingerprint, Verdict, VersionDrift } from '@dsh-triage/core'
import { evaluateAdmission, judgeVersionDrift, verdictFromAdmission } from '@dsh-triage/core'
import type { FetchLike, NpmPackument } from '@dsh-triage/signals'
import { fetchPackument } from '@dsh-triage/signals'

/** Why a candidate could not be judged. Machine-readable: callers must not parse prose. */
export type FitFailureKind = 'registry' | 'no-published-version' | 'version-not-published' | 'internal'

export interface FitFailure {
  readonly kind: FitFailureKind
  /** The registry's own error code when it answered, else the internal code. */
  readonly code: string
  readonly detail: string
}

export interface FitJudged {
  readonly ok: true
  readonly name: string
  readonly version: string
  readonly packument: NpmPackument
  readonly admission: AdmissionResult
  readonly drift: VersionDrift
  /** The verdict both callers show, built once. */
  readonly verdict: Verdict
}

export interface FitUnavailable {
  readonly ok: false
  readonly name: string
  readonly version: string | null
  readonly error: FitFailure
  /** An `unknown` verdict carrying the reason — never null, never a throw. */
  readonly verdict: Verdict
}

export type FitResult = FitJudged | FitUnavailable

export interface FitInput {
  /** `name` or `name@version`. */
  readonly spec: string
  /** The runtime to judge against — read from the profile this process is serving. */
  readonly env: EnvFingerprint
  /** ISO timestamp for the evidence; injected so the same input yields the same output. */
  readonly at: string
  /** Registry override; the CLI's tests use this to stay offline. */
  readonly registry?: string
  readonly fetchImpl?: FetchLike
  readonly timeoutMs?: number
  /** Caller cancellation (a tool call's `exec.signal`). Forwarded into the registry read. */
  readonly signal?: AbortSignal
}

/**
 * Split `name@version`, keeping scoped names (`@scope/name@1.2.3`) intact.
 *
 * Kept here (and mirrored by the CLI, which must not change its published output for this
 * refactor) so both halves agree on what a spec means.
 */
export function splitCandidateSpec(spec: string): { readonly name: string; readonly version: string | null } {
  const trimmed = spec.trim()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return { name: trimmed, version: null }
  return { name: trimmed.slice(0, at), version: trimmed.slice(at + 1) || null }
}

/** Combine two cancellation sources without losing either (`AbortSignal.any` where present). */
function mergeSignals(first: AbortSignal | undefined, second: AbortSignal | undefined): AbortSignal | undefined {
  if (first === undefined) return second
  if (second === undefined) return first
  const anyOf = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any
  if (typeof anyOf === 'function') return anyOf([first, second])
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  if (first.aborted || second.aborted) controller.abort()
  else {
    first.addEventListener('abort', abort, { once: true })
    second.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
}

/**
 * Wrap a fetch implementation so the caller's signal cancels the registry read too.
 *
 * WHY: `fetchPackument` owns its own timeout (15s) but knows nothing about a tool call being
 * cancelled. Without this wrapper an aborted call would keep a socket open for the whole
 * timeout, and the model would see a result nobody is waiting for.
 */
function withSignal(base: FetchLike | undefined, signal: AbortSignal | undefined): FetchLike | undefined {
  if (signal === undefined) return base
  return (url, init) => {
    const impl = base ?? (globalThis.fetch as unknown as FetchLike)
    return impl(url, { signal: mergeSignals(init?.signal, signal) })
  }
}

/**
 * An `unknown` verdict that names why nothing could be read.
 *
 * `tier: 'inferred'` on purpose: no manifest was parsed, so nothing here is even `declared`
 * evidence. The evidence item records the ATTEMPT, and its `method` says which read failed.
 */
export function unavailableFit(input: {
  readonly name: string
  readonly version: string | null
  readonly env: EnvFingerprint
  readonly at: string
  readonly error: FitFailure
}): FitUnavailable {
  const { name, version, env, at, error } = input
  const verdict: Verdict = {
    schemaVersion: 1,
    subject: { name, version, kind: 'plugin' },
    env,
    conclusion: 'unknown',
    confidence: { level: 'low', basis: 'inferred' },
    reasons: [
      {
        code: `tool-${error.kind}`,
        severity: 'warn',
        messageId: 'tool.verdict-unavailable',
        params: { detail: `${error.code}: ${error.detail}` },
      },
    ],
    evidence: [
      {
        id: 'candidate-metadata',
        tier: 'inferred',
        source: 'npm registry',
        method: `${error.kind} (no manifest was read)`,
        at,
      },
    ],
    remediation: [
      {
        kind: 'report',
        messageId: 'remediation.report',
        note: 'no manifest was read, so retry when the registry answers, or name the exact version to judge',
      },
    ],
    missingEvidence: ['missing.admission'],
    generatedAt: at,
  }
  return { ok: false, name, version, error, verdict }
}

/**
 * Judge one candidate against one runtime.
 *
 * Never throws for a candidate problem: a 404, an unpublished version, an abort and an
 * unexpected error all come back as `ok: false` with a verdict the caller can show. Only a
 * programming error inside the engine itself would propagate, and that must surface loudly.
 */
export async function judgeFit(input: FitInput): Promise<FitResult> {
  const { name, version } = splitCandidateSpec(input.spec)
  const fail = (error: FitFailure): FitUnavailable =>
    unavailableFit({ name, version, env: input.env, at: input.at, error })

  if (name === '') {
    return fail({ kind: 'internal', code: 'empty-spec', detail: 'no package name was given' })
  }

  let packument: Awaited<ReturnType<typeof fetchPackument>>
  try {
    packument = await fetchPackument(name, {
      at: input.at,
      ...(input.registry === undefined ? {} : { registry: input.registry }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(() => {
        const wrapped = withSignal(input.fetchImpl, input.signal)
        return wrapped === undefined ? {} : { fetchImpl: wrapped }
      })(),
    })
  } catch (error) {
    // `fetchPackument` returns its errors; a throw here is not a candidate problem.
    return fail({ kind: 'internal', code: 'registry-adapter-threw', detail: error instanceof Error ? error.message : String(error) })
  }
  if (packument.ok === false) {
    if (input.signal?.aborted === true) {
      return fail({ kind: 'internal', code: 'aborted', detail: 'the caller cancelled the read' })
    }
    return fail({ kind: 'registry', code: packument.error.code, detail: packument.error.detail })
  }

  const targetVersion = version ?? packument.value.latest
  if (targetVersion === null) {
    return fail({ kind: 'no-published-version', code: 'latest-missing', detail: `npm resolves no version for ${name}` })
  }
  const manifest = packument.value.versions.get(targetVersion)
  if (manifest === undefined) {
    return fail({
      kind: 'version-not-published',
      code: 'version-missing',
      detail: `npm has no version ${targetVersion} for ${name} (${packument.value.versions.size} known)`,
    })
  }

  const admission = evaluateAdmission(manifest, input.env.dsh)
  // Same order as `check` (T-109 / CASE-10849): the dist-tag decides which build a bare
  // `install <name>` gets, so the tag is judged before the declaration layer speaks.
  const drift = judgeVersionDrift({
    latest: packument.value.latest,
    next: packument.value.distTags['next'] ?? null,
    versions: [...packument.value.versions.keys()],
    publishedAt: packument.value.publishedAt,
    // A deprecated build must never be recommended as "the newer one".
    deprecated: [...packument.value.versions.values()]
      .filter((entry) => entry.deprecated !== undefined)
      .map((entry) => entry.version),
  })
  const verdict = verdictFromAdmission({
    subject: { name, version: targetVersion, kind: 'plugin' },
    env: input.env,
    admission,
    generatedAt: input.at,
    manifest,
    registryDrift: drift,
    rangeAdvice: true,
  })

  return { ok: true, name, version: targetVersion, packument: packument.value, admission, drift, verdict }
}
