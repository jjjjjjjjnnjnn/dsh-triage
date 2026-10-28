/**
 * DSH loader entry for `dsh-triage`.
 *
 * M0 shipped this as a row that mounted and registered nothing, and said so. The row now carries
 * two independent halves, each mounted only where its own service exists:
 *
 *   1. a read-only HTTP route (`GET /compat-triage/audit`) that answers with the exact payload
 *      `dsh-triage audit --json` prints — same loader, same engine, no second implementation
 *      (`host-audit-route.ts`);
 *   2. a read-only agent tool (`compat_verdict`) that judges one candidate against THIS profile's
 *      runtime with the same engine as `dsh-triage check` (`host-tool.ts` + `fit.ts`).
 *
 * Both are READ-ONLY: no writes, no installs, no credentials, no judgement of their own (铁律 1).
 *
 * WHY PER-HALF INJECTION (R36): until R35 the row declared `inject: ['webServer']`, so a profile
 * without a webserver never mounted it at all. That is the right trade for a browser tab and the
 * wrong one for an agent tool — the profiles where an agent most needs a pre-install judgment are
 * exactly the ones that serve no web surface. `ctx.inject([...], cb)` is Cordis' own mechanism
 * (the same one `dsh-plugin-market` uses) and gives each half its own availability gate.
 *
 * The row id stays `compat-verdict` (铁律 9); the browser half is discovered from this same package
 * (`package.json#dsh.client` + `exports["./client"]`, both measured in R31).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditJsonPayload, auditRedactRoots, loadAuditData } from './audit-data.js'
import { AUDIT_ROUTE_PATH, createAuditRouteHandler } from './host-audit-route.js'
import { createCompatVerdictTool, type CompatVerdictTool, type ToolsRegistryLike } from './host-tool.js'
import { loadEnv } from '@dsh-triage/core'

export interface HostConfig {
  readonly locale?: 'auto' | 'en' | 'zh'
  /**
   * Turns the route off. Default on, because "the tab shows the CLI's own numbers" is the point of
   * the tab; a deployment that does not want a route can say so without unpatching the row.
   */
  readonly auditRoute?: boolean
  /**
   * Turns the agent tool off. Default on: it is read-only and it is the M4-b deliverable. A
   * deployment that does not want the tool in its models' surface can disable this one key.
   */
  readonly agentTool?: boolean
}

/** The narrow slice of the webserver contract we use; upstream owns the rest. */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => unknown
  }): () => void
}

/** The narrow slice of the Cordis context we use. */
export interface HostContext {
  readonly logger?: {
    info?(message: string): void
    warn?(message: string): void
  }
  /** Config-tree anchor: the URL of the profile's own `cordis.yml` (or its directory). */
  readonly baseUrl?: string | URL
  get?(name: string): unknown
  effect?(execute: () => () => void, label?: string): unknown
  /**
   * The webserver service. Read as a PROPERTY first: Cordis exposes services as context accessors,
   * and `ctx.get('webServer')` returned `undefined` on a real Host where `ctx.webServer` exists
   * (measured R33 — the route was skipped and the tab got a 404).
   */
  readonly webServer?: WebServerLike
  /** The tool registry. Same access rule as `webServer`. */
  readonly tools?: ToolsRegistryLike
  /**
   * Cordis' own dependency gate: run `callback` with a context that has `deps` available, and
   * again whenever they come back after an unload.
   */
  inject?(deps: readonly string[], callback: (scope: HostContext) => void): unknown
}

export const name = 'compat-verdict'

/**
 * Which profile is this Host running? Taken from the loader's config anchor rather than from an
 * environment variable, because the launcher sets none that names the profile, and guessing `web`
 * would silently describe the wrong composition (R33).
 */
export function resolveProfileFromBaseUrl(baseUrl: string | URL | undefined): { dshHome: string; profile: string } | null {
  if (baseUrl === undefined) return null
  let path: string
  try {
    path = baseUrl instanceof URL ? fileURLToPath(baseUrl) : fileURLToPath(new URL(baseUrl))
  } catch {
    return null
  }
  /*
   * Two shapes were observed: the URL of the profile's own `cordis.yml`, and the URL of the profile
   * DIRECTORY (what this Cordis version hands a plugin as `ctx.baseUrl` — measured R33: treating it
   * as a file named the profile `web` and the "home" the profiles dir, so the route was skipped).
   */
  const trimmed = path.replace(/[\\/]+$/, '')
  const profileDir = /\.ya?ml$/i.test(trimmed) ? dirname(trimmed) : trimmed
  const profile = basename(profileDir)
  const profilesDir = dirname(profileDir)
  if (profile === '' || basename(profilesDir) !== 'profiles') return null
  return { dshHome: dirname(profilesDir), profile }
}

/** Read one Cordis service without assuming one access style (`ctx.get` is the fallback only). */
function readService<T>(ctx: HostContext, name: string, has: (value: unknown) => value is T): T | undefined {
  try {
    const fromProperty = (ctx as unknown as Record<string, unknown>)[name]
    if (has(fromProperty)) return fromProperty
  } catch {
    // An absent Cordis service can throw on property access; that is still "not available".
  }
  try {
    const fromGet = typeof ctx.get === 'function' ? ctx.get(name) : undefined
    if (has(fromGet)) return fromGet
  } catch {
    // Same reasoning: unreadable means unavailable, and the caller logs which case it was.
  }
  return undefined
}

/** Resolve the webserver service without assuming one access style. */
export function readWebServer(ctx: HostContext): WebServerLike | undefined {
  return readService<WebServerLike>(ctx, 'webServer', (value): value is WebServerLike =>
    typeof (value as WebServerLike | undefined)?.register === 'function',
  )
}

/** Resolve the tool registry the same way. */
export function readTools(ctx: HostContext): ToolsRegistryLike | undefined {
  return readService<ToolsRegistryLike>(ctx, 'tools', (value): value is ToolsRegistryLike =>
    typeof (value as ToolsRegistryLike | undefined)?.register === 'function',
  )
}

/** Console output as well as the logger: a probe/CI reads stdout, not the Host's log sink. */
function announce(ctx: HostContext, message: string): void {
  ctx.logger?.info?.(message)
  console.log(`dsh-triage: ${message}`)
}

/**
 * Mount one half behind its own availability gate.
 *
 * A missing `ctx.inject` is reported, never silently swallowed: a row that mounts nothing looks
 * identical to a row that works, which is the failure class this project exists to attribute.
 */
function mountWhenAvailable(
  ctx: HostContext,
  deps: readonly string[],
  label: string,
  mount: (scope: HostContext) => void,
): void {
  const inject = ctx.inject
  if (typeof inject !== 'function') {
    announce(ctx, `${label} skipped (this Cordis build has no ctx.inject)`)
    return
  }
  try {
    inject.call(ctx, deps, (scope) => {
      try {
        mount(scope)
      } catch (error) {
        // A throwing half must not take the other one down with it.
        const detail = error instanceof Error ? error.message : String(error)
        announce(ctx, `${label} failed to mount: ${detail}`)
      }
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    announce(ctx, `${label} skipped: ${detail}`)
  }
}

export function apply(ctx: HostContext, config: HostConfig = {}): void {
  const bound = resolveProfileFromBaseUrl(ctx.baseUrl)
  if (bound === null) {
    announce(ctx, `mounted without a profile anchor (${String(ctx.baseUrl)}); route and tool are unavailable`)
    return
  }

  if (config.auditRoute !== false) {
    mountWhenAvailable(ctx, ['webServer'], `read-only ${AUDIT_ROUTE_PATH}`, (scope) => {
      const webServer = readWebServer(scope)
      if (webServer === undefined) {
        announce(ctx, `read-only ${AUDIT_ROUTE_PATH} skipped (no webServer service)`)
        return
      }
      const handler = createAuditRouteHandler({
        read: async () => {
          const loaded = await loadEnv({ dshHome: bound.dshHome, profile: bound.profile })
          if (!loaded.ok) return { ok: false, message: `${loaded.error.code} — ${loaded.error.detail}` }
          const data = await loadAuditData({
            env: loaded.value,
            dshHome: bound.dshHome,
            // The payload's timestamp describes the read, not a verdict: one read, one stamp.
            stamp: new Date().toISOString(),
            snapshotPath: null,
            noRedact: false,
          })
          if (!data.ok) return { ok: false, message: data.message }
          return { ok: true, payload: auditJsonPayload(data.data, { noRedact: false, roots: auditRedactRoots(bound.dshHome) }) }
        },
      })
      const register = (): (() => void) => webServer.register({ kind: 'exact', path: AUDIT_ROUTE_PATH, handler })
      const dispose = typeof scope.effect === 'function' ? scope.effect(register, 'compat-triage: audit route') : register()
      announce(ctx, `read-only ${AUDIT_ROUTE_PATH} registered (profile ${bound.profile})`)
      void dispose
    })
  }

  if (config.agentTool !== false) {
    mountWhenAvailable(ctx, ['tools'], 'compat_verdict tool', (scope) => {
      const tools = readTools(scope)
      if (tools === undefined) {
        announce(ctx, 'compat_verdict tool skipped (no tools service)')
        return
      }
      const tool: CompatVerdictTool = createCompatVerdictTool({
        locale: config.locale ?? 'auto',
        redactionRoots: [homedir(), bound.dshHome],
        readEnv: async () => {
          const loaded = await loadEnv({ dshHome: bound.dshHome, profile: bound.profile })
          return loaded.ok ? { ok: true, env: loaded.value } : { ok: false, message: `${loaded.error.code} — ${loaded.error.detail}` }
        },
      })
      const register = (): (() => void) => tools.register(tool)
      const dispose = typeof scope.effect === 'function' ? scope.effect(register, 'compat-triage: compat_verdict tool') : register()
      announce(ctx, `compat_verdict tool registered (profile ${bound.profile})`)
      void dispose
    })
  }
}

/**
 * The loader may treat the module namespace OR its default export as the plugin. Both shapes carry
 * `apply`; there is deliberately no static `inject` any more, because each half gates itself (R36).
 */
const plugin = { name, apply }
export default plugin
