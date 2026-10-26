/**
 * Probe plan builder (M3 executor consumes this).
 *
 * Why a plan instead of direct execution:
 * - plans are pure data, so they can be diffed, reviewed and unit-tested offline;
 * - the default CLI path is `--dry-run`: printing the plan is already useful
 *   ("this is exactly what would touch your machine");
 * - execution needs an isolated `DSH_HOME`, and the plan is the place where that
 *   isolation is proven before anything runs.
 *
 * HARD INVARIANT: the sandbox home must never be the real DSH home, nor live
 * inside it. {@link validateProbePlan} enforces this and the CLI refuses to run an
 * invalid plan.
 */

import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Result } from '@dsh-triage/core'

export interface ProbePlanInput {
  /** npm spec, git spec, tarball or local path to install in the sandbox. */
  readonly candidate: string
  /** The real `$DSH_HOME` — used only to prove the sandbox is disjoint. */
  readonly realDshHome: string
  /** Profile name to create inside the sandbox, defaults to `web`. */
  readonly profile?: string
  /** Parent directory for sandbox homes, defaults to the OS temp directory. */
  readonly workRoot: string
  readonly basePort?: number
  /** Executable used to drive DSH; injected so tests can assert argv. */
  readonly dshBin?: string
}

export interface ProbeStep {
  readonly id: string
  readonly argv: readonly string[]
  /** Extra environment for this step only. */
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
  readonly note: string
}

export interface ProbeAssertion {
  readonly id: string
  /** Human-readable expectation; the M3 runner maps these to machine checks. */
  readonly expect: string
}

export interface ProbePlan {
  readonly schemaVersion: 1
  readonly candidate: string
  readonly sandboxHome: string
  readonly sandboxProfileDir: string
  readonly port: number
  readonly steps: readonly ProbeStep[]
  readonly assertions: readonly ProbeAssertion[]
  readonly warnings: readonly string[]
}

export type ProbePlanErrorCode = 'invalid-candidate' | 'sandbox-overlaps-real-home' | 'invalid-work-root'

export interface ProbePlanError {
  readonly code: ProbePlanErrorCode
  readonly detail: string
}

export function buildProbePlan(input: ProbePlanInput): Result<ProbePlan, ProbePlanError> {
  const candidate = input.candidate.trim()
  if (candidate === '') {
    return { ok: false, error: { code: 'invalid-candidate', detail: 'candidate spec is empty' } }
  }
  if (!isAbsolute(input.workRoot)) {
    return { ok: false, error: { code: 'invalid-work-root', detail: 'workRoot must be an absolute path' } }
  }

  const digest = createHash('sha256').update(candidate).digest('hex').slice(0, 8)
  const slug = slugify(candidate)
  const sandboxHome = join(resolve(input.workRoot), `${slug}-${digest}`)
  const profile = input.profile ?? 'web'
  const sandboxProfileDir = join(sandboxHome, 'profiles', profile)
  const port = input.basePort ?? 53000 + (parseInt(digest.slice(0, 4), 16) % 1000)
  const dshBin = input.dshBin ?? 'dsh'
  const env = { DSH_HOME: sandboxHome } as const

  const plan: ProbePlan = {
    schemaVersion: 1,
    candidate,
    sandboxHome,
    sandboxProfileDir,
    port,
    steps: [
      {
        id: 'sandbox-init',
        argv: [dshBin, 'plugin', '--profile', profile, '--version'],
        env,
        cwd: sandboxHome,
        note: 'initializes an empty sandbox profile without touching the real one',
      },
      {
        id: 'install',
        argv: [dshBin, 'plugin', '--profile', profile, 'add', candidate],
        env,
        cwd: sandboxHome,
        note: 'runs pnpm inside the sandbox; third-party install scripts may execute — requires --execute',
      },
      {
        id: 'boot',
        argv: [dshBin, '--profile', profile, 'web', '--port', String(port)],
        env,
        cwd: sandboxHome,
        note: 'boots the sandboxed profile; capture stderr for attribution',
      },
      {
        id: 'cleanup',
        argv: ['<rm>', sandboxHome],
        env: {},
        cwd: sandboxHome,
        note: 'always runs; the sandbox home is cache, never evidence',
      },
    ],
    assertions: [
      { id: 'boot-exit-zero', expect: 'the dsh process stays alive past the readiness window' },
      { id: 'http-served', expect: `GET http://127.0.0.1:${port}/ answers 200` },
      { id: 'client-rendered', expect: 'browser half reports a mounted root (HTTP 200 alone is not enough — BS-03)' },
      { id: 'inventory-active', expect: 'the candidate row reports phase "active" in pluginInventory' },
      { id: 'namespace-diff', expect: 'tools/commands/settings namespaces claimed by the candidate actually appear' },
    ],
    warnings: [
      'installing a candidate may execute third-party build scripts; the plan is dry-run until --execute is passed',
      'the sandbox has no credentials; probing a plugin that requires a key will report a false negative',
      'this plan does not judge security; see COMPLIANCE.md §5',
    ],
  }

  const validation = validateProbePlan({ plan, realDshHome: input.realDshHome })
  if (!validation.ok) return validation
  return { ok: true, value: plan }
}

/** Prove the sandbox is disjoint from the real DSH home. */
export function validateProbePlan(input: {
  readonly plan: ProbePlan
  readonly realDshHome: string
}): Result<true, ProbePlanError> {
  const sandbox = resolve(input.plan.sandboxHome)
  const real = resolve(input.realDshHome)
  if (sandbox === real) {
    return { ok: false, error: { code: 'sandbox-overlaps-real-home', detail: 'sandbox equals the real DSH home' } }
  }
  const rel = relative(real, sandbox)
  if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
    return {
      ok: false,
      error: { code: 'sandbox-overlaps-real-home', detail: `sandbox is nested inside ${real}` },
    }
  }
  return { ok: true, value: true }
}

function slugify(spec: string): string {
  const base = spec.replace(/^npm:/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (base === '' ? 'candidate' : base).slice(0, 48)
}
