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

/**
 * The declaration files a DSH profile is made of (T-304 / R20 fact F38).
 *
 * WHY THIS EXACT LIST: copying only these four into a sandbox `profiles/<name>` boots the
 * same profile (the Host prints its URL, HTTP answers 401). `node_modules`, `.plugin-manager/`
 * and `.npmrc` are deliberately NOT here: the first is rebuilt by the package manager, and
 * the last can carry a registry token (铁律 4).
 */
export const PROFILE_DECLARATION_FILES = [
  'package.json',
  'cordis.yml',
  'cordis.patch.yml',
  'pnpm-workspace.yaml',
] as const

/**
 * A profile name becomes a directory segment, both inside the sandbox and (for a copy) inside
 * the real DSH home, so `..`, separators and absolute paths are refused rather than sanitised
 * (R14 audit finding F-1).
 */
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Where the sandbox profile's declarations came from (T-304). */
export interface ProbeProfileSource {
  /** Profile name inside the real DSH home. */
  readonly name: string
  /** Absolute path of that profile; published only through the redactor. */
  readonly dir: string
}

export interface ProbePlanInput {
  /** npm spec, git spec, tarball or local path to install in the sandbox. */
  readonly candidate: string
  /** The real `$DSH_HOME` — used only to prove the sandbox is disjoint. */
  readonly realDshHome: string
  /** Profile name to create inside the sandbox, defaults to `web`. */
  readonly profile?: string
  /**
   * Copy this profile's declarations out of the real DSH home before installing (T-304).
   *
   * Without it the probe answers "would this work in the empty template profile?"; with it
   * the probe answers "would this work alongside *my* bundles?".
   */
  readonly copyProfile?: string
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
  /**
   * `template` = the launcher initialises an empty profile; `copy:<name>` = the declarations
   * came from a real profile (T-304). Published in every artifact: a measurement is only
   * meaningful next to the composition it was taken in.
   */
  readonly profileOrigin: string
  readonly profileSource: ProbeProfileSource | null
  readonly port: number
  readonly steps: readonly ProbeStep[]
  readonly assertions: readonly ProbeAssertion[]
  readonly warnings: readonly string[]
}

export type ProbePlanErrorCode =
  | 'invalid-candidate'
  | 'invalid-profile'
  | 'invalid-copy-profile'
  | 'profile-source-overlaps-sandbox'
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
  // A copied profile keeps its own name unless the caller asked for a different sandbox one:
  // the name decides which `profiles/<name>` the launcher reads, and a rename would silently
  // measure a different composition than the one asked for.
  const copyProfile = input.copyProfile?.trim()
  if (copyProfile !== undefined && copyProfile !== '') {
    if (!PROFILE_NAME.test(copyProfile)) {
      return {
        ok: false,
        error: {
          code: 'invalid-copy-profile',
          detail: `copy profile "${copyProfile}" must match ${PROFILE_NAME} — it becomes a directory segment under the real DSH home`,
        },
      }
    }
  }
  const profileFromCopy = copyProfile === undefined || copyProfile === '' ? null : copyProfile
  const profile = input.profile ?? profileFromCopy ?? 'web'
  // A profile name becomes a directory segment under the sandbox home. Anything that can
  // climb out of it (`..`, separators) makes the isolation proof false, so it is refused
  // here instead of being sanitised silently (R14 audit finding F-1).
  if (!PROFILE_NAME.test(profile)) {
    return {
      ok: false,
      error: {
        code: 'invalid-profile',
        detail: `profile "${profile}" must match ${PROFILE_NAME} — it becomes a directory segment inside the sandbox`,
      },
    }
  }
  const sandboxProfileDir = join(sandboxHome, 'profiles', profile)
  const profileSource: ProbeProfileSource | null =
    profileFromCopy === null
      ? null
      : { name: profileFromCopy, dir: join(resolve(input.realDshHome), 'profiles', profileFromCopy) }
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
    profileOrigin: profileSource === null ? 'template' : `copy:${profileSource.name}`,
    profileSource,
    port,
    steps: [
      {
        id: 'runtime',
        argv: [nodeBin, dshBin, '--version'],
        env,
        cwd: sandboxHome,
        note: 'records which runtime the sandbox will boot; an unreadable runtime stops the probe',
      },
      ...(profileSource === null
        ? []
        : [
            {
              id: 'profile',
              // Illustrative only: the real copy + dependency install happen in Node (T-304).
              argv: ['<copy>', ...PROFILE_DECLARATION_FILES, '<source profile>', '→', sandboxProfileDir],
              env,
              cwd: sandboxHome,
              note: `copies ${PROFILE_DECLARATION_FILES.join(' / ')} from profile "${profileSource.name}" — declarations only, no node_modules, no .npmrc, no credentials — then installs the copied dependencies`,
            },
          ]),
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
        id: 'render',
        argv: ['<browser>', '--headless=new', '--remote-debugging-port=0', '<host url from stdout>'],
        env: {},
        cwd: sandboxHome,
        note: 'T-302: reads the mounted DOM over CDP; skipped (reported unmeasured) when no browser is available',
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
      { id: 'client-rendered', expect: 'the page mounts visible DOM (a browser is required; without one this stays unmeasured — BS-03)', measured: true },
      { id: 'namespace-diff', expect: 'tools/commands/settings claimed by the candidate actually appear (agent scope — BS-21)', measured: false },
    ],
    warnings: [
      'installing a candidate may execute third-party build scripts; the plan is dry-run until --execute is passed',
      'the sandbox has no credentials; probing a plugin that requires a key will report a false negative',
      'this plan does not judge security; the render check (T-302) needs a local Chromium-family browser and is reported unmeasured without one',
      ...(profileSource === null
        ? []
        : [
            `the sandbox profile is a copy of "${profileSource.name}" declarations only: node_modules, .plugin-manager and .npmrc are not copied, so a dependency of that profile that only exists on your machine makes this run unknown rather than go`,
          ]),
    ],
  }

  const validation = validateProbePlan({ plan, realDshHome: input.realDshHome })
  if (!validation.ok) return validation
  return { ok: true, value: plan }
}

/**
 * Prove the sandbox is disjoint from the real DSH home — and, when a profile is copied
 * (T-304), from that profile too.
 *
 * WHY THE SECOND CHECK: the copy reads from the real profile, so a sandbox that shares a
 * path with it would let the probe overwrite the very composition it claims to measure.
 * `..` and separators are already refused at build time; this is the belt for symlinks and
 * for callers that assemble a plan by hand.
 */
export function validateProbePlan(input: {
  readonly plan: ProbePlan
  readonly realDshHome: string
}): Result<true, ProbePlanError> {
  const sandbox = resolve(input.plan.sandboxHome)
  const real = resolve(input.realDshHome)
  if (samePath(sandbox, real)) {
    return { ok: false, error: { code: 'sandbox-overlaps-real-home', detail: 'sandbox equals the real DSH home' } }
  }
  if (inside(real, sandbox)) {
    return {
      ok: false,
      error: { code: 'sandbox-overlaps-real-home', detail: `sandbox is nested inside ${real}` },
    }
  }
  const source = input.plan.profileSource
  if (source !== null) {
    const sourceDir = resolve(source.dir)
    if (samePath(sourceDir, sandbox) || inside(sourceDir, sandbox)) {
      return {
        ok: false,
        error: {
          code: 'profile-source-overlaps-sandbox',
          detail: `sandbox is nested inside the source profile "${source.name}"`,
        },
      }
    }
    if (inside(sandbox, sourceDir)) {
      return {
        ok: false,
        error: {
          code: 'profile-source-overlaps-sandbox',
          detail: `the source profile "${source.name}" is nested inside the sandbox`,
        },
      }
    }
  }
  return { ok: true, value: true }
}

/** Case-insensitive on Windows, byte-exact elsewhere: the same directory must compare equal. */
function samePath(left: string, right: string): boolean {
  return comparable(left) === comparable(right)
}

/** Is `child` strictly inside `parent`? */
function inside(parent: string, child: string): boolean {
  const rel = relative(comparable(parent), comparable(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function comparable(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
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
