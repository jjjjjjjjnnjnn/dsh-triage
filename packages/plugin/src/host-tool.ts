/**
 * The `compat_verdict` agent tool (T-404) — the Host half that lets an agent ask this
 * project's question before adding a plugin.
 *
 * WHY THIS IS A PLAIN OBJECT AND NOT `defineTool`: the tool registry validates four things
 * (measured in R36 against `@deepseek-ai/dsh-tools/lib/index.js#register`): `output.render`
 * must be a function, `output.schema` must belong to the supported JSON-Schema subset,
 * `timeoutMs` must be positive, and the name must not be the reserved `run_code`. There is no
 * marker or brand. `defineTool` only compiles the author-facing schema DSL and adds argument
 * validation — which we get by writing the JSON Schema directly and validating the one
 * argument ourselves. So this package keeps its zero-upstream-dependency shape (the same
 * decision `ADR-0010` made for `client.js`).
 *
 * WHAT THE MODEL SEES is `schemas()`: name, description, parameters. Everything else
 * (timeout, render) stays local, so the description is the whole contract the model reads —
 * which is why it says what this does NOT prove.
 *
 * WHAT IT WILL NOT DO: install, run candidate code, read credentials, or claim a plugin is
 * safe. It reads ONE published manifest and runs the same declaration engine as
 * `dsh-triage check` (`fit.ts`).
 */

import { homedir } from 'node:os'
import type { EnvFingerprint, Locale, Verdict } from '@dsh-triage/core'
import { redactVerdict, renderVerdict } from '@dsh-triage/core'
import { judgeFit, splitCandidateSpec, unavailableFit, type FitResult } from './fit.js'

/** The name the model calls. Stable: it is in the docs and in `schemas()`. */
export const TOOL_NAME = 'compat_verdict'

/** How long one call may take. Declared AND honoured: `execute` forwards `exec.signal`. */
export const TOOL_TIMEOUT_MS = 20_000

/** Output is a JSON document; the model gets the same string the render callback returns. */
export const TOOL_OUTPUT_SCHEMA = { type: 'string' } as const

/**
 * One parameter, and `additionalProperties: false`: a model that invents a second argument
 * gets refused by us instead of being silently ignored (the registry does not validate a
 * plain object's arguments).
 */
export const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    package: {
      type: 'string',
      description: 'npm package name, optionally pinned: "dsh-status-rotator" or "dsh-status-rotator@0.38.0".',
    },
  },
  required: ['package'],
  additionalProperties: false,
} as const

export const TOOL_DESCRIPTION =
  'Judge whether one npm plugin package fits THIS profile\'s DSH runtime, using the same declaration engine as ' +
  '`dsh-triage check`. Returns JSON: conclusion (go | risky | blocked | unknown), the reasons, the evidence tiers, ' +
  'and what to do next. `go` means only that the published declaration admits this runtime — it does not prove the ' +
  'plugin runs, and this is not a security judgement. It never installs, never executes candidate code and never ' +
  'reads credentials. Use it before adding a plugin to this profile.'

/** The narrow slice of the tool registry this module uses (upstream owns the rest). */
export interface ToolsRegistryLike {
  register(definition: CompatVerdictTool): () => void
  get?(name: string): CompatVerdictTool | undefined
  schemas?(): readonly { readonly name?: string }[]
}

/** The definition shape the registry accepts; only what we set is listed. */
export interface CompatVerdictTool {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
  readonly timeoutMs?: number
  readonly output: {
    readonly schema: unknown
    readonly render: (args: unknown, value: string) => readonly { readonly type: 'text'; readonly text: string }[]
  }
  execute(args: unknown, exec?: { readonly signal?: AbortSignal }): Promise<string>
}

export interface CompatVerdictToolOptions {
  /** Read the profile this Host is serving. Failures become an `unknown` verdict. */
  readonly readEnv: () => Promise<{ readonly ok: true; readonly env: EnvFingerprint } | { readonly ok: false; readonly message: string }>
  /** Injected for deterministic tests and reproducible artifacts. */
  readonly stamp?: () => string
  /** `auto` follows `$DSH_TRIAGE_LOCALE`, then falls back to the CLI's default (`zh`). */
  readonly locale?: 'auto' | 'en' | 'zh'
  /** Paths replaced by `~` before anything leaves the Host. */
  readonly redactionRoots?: readonly string[]
  /** Injectable so tests can run this offline with a fake registry. */
  readonly judge?: (input: Parameters<typeof judgeFit>[0]) => Promise<FitResult>
}

/** A verdict is shown through the SAME renderer the CLI uses, so both surfaces cannot drift. */
export function resolveLocale(locale: 'auto' | 'en' | 'zh' | undefined, env: NodeJS.ProcessEnv = process.env): Locale {
  if (locale === 'en' || locale === 'zh') return locale
  const configured = (env['DSH_TRIAGE_LOCALE'] ?? '').trim().toLowerCase()
  return configured === 'en' ? 'en' : 'zh'
}

/**
 * The JSON the model receives.
 *
 * THREE PARTS, on purpose: `summary` is prose a model can quote (localized, same lines the
 * CLI prints); `verdict` is the contract object a program can check; `limits` restates what
 * a `go` does not mean, because tool output is read out of context more often than CLI output.
 */
export function buildToolPayload(input: {
  readonly result: FitResult
  readonly at: string
  readonly locale: Locale
  readonly redactionRoots: readonly string[]
}): Record<string, unknown> {
  const { result, at, locale, redactionRoots } = input
  const verdict: Verdict = redactVerdict(result.verdict, redactionRoots)
  return {
    schema_version: 1,
    tool: TOOL_NAME,
    generated_at: at,
    subject: { name: result.name, version: result.version },
    conclusion: verdict.conclusion,
    summary: renderVerdict(result.verdict, locale).split('\n'),
    verdict,
    admission:
      result.ok === true
        ? { status: result.admission.status, mode: result.admission.mode }
        : null,
    registry:
      result.ok === true
        ? {
            latest: result.drift.latest,
            next: result.drift.next,
            newest: result.drift.newest,
            newest_stable: result.drift.newestStable,
            standing: result.drift.standing,
            detail: result.drift.detail,
          }
        : null,
    error: result.ok === true ? null : { kind: result.error.kind, code: result.error.code, detail: result.error.detail },
    limits: [
      'declaration layer only: `go` means the published manifest admits this runtime, not that the plugin runs',
      'no installation, no candidate code executed, no credentials read',
      'not a security judgement — this tool never says a plugin is safe',
      'one runtime (the profile this Host serves) on one machine',
    ],
  }
}

/** Pull the single argument out without trusting its shape (the registry does not validate us). */
export function readPackageArgument(args: unknown): string {
  if (args === null || typeof args !== 'object') return ''
  const value = (args as { package?: unknown }).package
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Build the tool definition.
 *
 * `execute` is total: every path returns a JSON string. A throwing tool shows the model a
 * stack trace instead of an answer, which is strictly worse than an honest `unknown`.
 */
export function createCompatVerdictTool(options: CompatVerdictToolOptions): CompatVerdictTool {
  const stamp = options.stamp ?? ((): string => new Date().toISOString())
  const judge = options.judge ?? judgeFit
  const locale = resolveLocale(options.locale)
  const roots = options.redactionRoots ?? [homedir()]
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    timeoutMs: TOOL_TIMEOUT_MS,
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const at = stamp()
      const spec = readPackageArgument(args)
      const loaded = await options.readEnv()
      if (loaded.ok === false) {
        /*
         * The profile could not be read, so there is no runtime to judge against. This is the
         * one failure that happens BEFORE the candidate is looked at, and it must not be
         * reported as a candidate problem (the same discipline as probe's "measurement failure
         * ≠ plugin failure"). No registry read either: with no runtime, a manifest would not
         * answer the question.
         */
        const { name } = splitCandidateSpec(spec)
        const result = unavailableFit({
          name,
          version: null,
          env: unreadableEnv(loaded.message),
          at,
          error: { kind: 'internal', code: 'profile-unreadable', detail: loaded.message },
        })
        return JSON.stringify(buildToolPayload({ result, at, locale, redactionRoots: roots }), null, 2)
      }
      const signal = exec?.signal
      const result = await judge({
        spec,
        env: loaded.env,
        at,
        ...(signal === undefined ? {} : { signal }),
      })
      return JSON.stringify(buildToolPayload({ result, at, locale, redactionRoots: roots }), null, 2)
    },
  }
}

/**
 * A placeholder fingerprint for the one case where the real profile could not be read.
 *
 * It exists so the verdict still satisfies the contract (`env` is required) instead of
 * throwing. Every field says "unknown": a synthetic profile name would be a small lie that a
 * reader could not distinguish from a real one.
 */
function unreadableEnv(message: string): EnvFingerprint {
  return {
    dsh: null,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    profile: '<unreadable>',
    profileDir: `<unreadable: ${message}>`,
    bundles: [],
    installed: [],
  }
}
