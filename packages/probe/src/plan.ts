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
  /**
   * Whether M3 actually measures it. `false` means the artifact must report
   * `unmeasured` — advertising an assertion the runner cannot answer is how a probe
   * starts lying (BS-03 / BS-21).
   */
  readonly measured: boolean
}

export interface ProbePlan {
  readonly schemaVersion: 1
  readonly candidate: string
  /** Profile name created inside the sandbox home. */
  readonly profile: string
  readonly sandboxHome: string
  readonly sandboxProfileDir: string
  readonly port: number
  readonly steps: readonly ProbeStep[]
  readonly assertions: readonly ProbeAssertion[]
  readonly warnings: readonly string[]
}

export type ProbePlanErrorCode =
  | 'invalid-candidate'
  | 'invalid-profile'
  | 'sandbox-overlaps-real-home'
  | 'invalid-work-root'

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
  // A profile name becomes a directory segment under the sandbox home. Anything that can
  // climb out of it (`..`, separators) makes the isolation proof false, so it is refused
  // here instead of being sanitised silently (R14 audit finding F-1).
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)) {
    return {
      ok: false,
      error: {
        code: 'invalid-profile',
        detail: `profile "${profile}" must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ — it becomes a directory segment inside the sandbox`,
      },
    }
  }
  const sandboxProfileDir = join(sandboxHome, 'profiles', profile)
  const port = input.basePort ?? 53000 + (parseInt(digest.slice(0, 4), 16) % 1000)
  const dshBin = input.dshBin ?? 'dsh'
  const nodeBin = process.execPath.replaceAll('\\', '/')
  const env = { DSH_HOME: sandboxHome } as const

  const plan: ProbePlan = {
    schemaVersion: 1,
    candidate,
    profile,
    sandboxHome,
    sandboxProfileDir,
    port,
    steps: [
      {
        id: 'runtime',
        argv: [nodeBin, dshBin, '--version'],
        env,
        cwd: sandboxHome,
        note: 'records which runtime the sandbox will boot; an unreadable runtime stops the probe',
      },
      {
        id: 'install',
        argv: [nodeBin, dshBin, 'plugin', '--profile', profile, 'add', candidate],
        env,
        cwd: sandboxHome,
        note: 'runs pnpm inside the sandbox profile; third-party install scripts may execute — requires --execute',
      },
      {
        id: 'boot',
        argv: [nodeBin, dshBin, '--profile', profile, '--patch', '<generated overlay>'],
        env,
        cwd: sandboxHome,
        note: 'boots the sandbox profile with a one-row inventory probe overlay; stderr is kept for attribution',
      },
      {
        id: 'http',
        argv: ['<fetch>', `http://127.0.0.1:${port}/`, '--redirect', 'manual'],
        env: {},
        cwd: sandboxHome,
        note: 'a 303 with a token and a 401 without one both count as "something is listening"',
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
      { id: 'boot-sampled', expect: 'the Host writes an inventory sample within the boot budget', measured: true },
      { id: 'http-served', expect: `GET http://127.0.0.1:${port}/ answers at all (2xx/3xx/401)`, measured: true },
      { id: 'inventory-active', expect: 'the candidate row exists exactly once and reports phase "active"', measured: true },
      { id: 'cleanup-complete', expect: 'the sandbox directory is gone and the port no longer answers', measured: true },
      { id: 'client-rendered', expect: 'browser half reports a mounted root (HTTP 200 alone is not enough — BS-03)', measured: false },
      { id: 'namespace-diff', expect: 'tools/commands/settings claimed by the candidate actually appear (agent scope — BS-21)', measured: false },
    ],
    warnings: [
      'installing a candidate may execute third-party build scripts; the plan is dry-run until --execute is passed',
      'the sandbox has no credentials; probing a plugin that requires a key will report a false negative',
      'this plan does not judge security, and it does not check whether the UI renders (assertions marked measured=false)',
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

/**
 * Directory-safe name for the sandbox home.
 *
 * BASENAME ONLY, and deliberately so: the first version slugified the whole candidate
 * spec, which flattened `C:\Users\<name>\…` into `C-Users-<name>-…` and published the
 * user's account name inside every probe artifact. The redactor could not match it
 * because the separators it keys on were gone (R14 audit finding F-2).
 */
function slugify(spec: string): string {
  const bare = spec.replace(/^npm:/, '').replaceAll('\\', '/')
  const base = bare.split('/').filter((part) => part !== '').pop() ?? ''
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (cleaned === '' ? 'candidate' : cleaned).slice(0, 48)
}
