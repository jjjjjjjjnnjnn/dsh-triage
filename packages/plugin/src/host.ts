/**
 * DSH loader entry for `dsh-triage`.
 *
 * M0 shipped this as a row that mounted and registered nothing, and said so. M4-a adds the two
 * things the settings tab needs from the Host side:
 *
 *   1. a read-only HTTP route (`GET /compat-triage/audit`) that answers with the exact payload
 *      `dsh-triage audit --json` prints — same loader, same engine, no second implementation
 *      (`host-audit-route.ts`);
 *   2. nothing else. No tools, no writes, no credentials, no judgement of its own (铁律 1).
 *
 * The row id stays `compat-verdict` (铁律 9); the browser half is discovered from this same package
 * (`package.json#dsh.client` + `exports["./client"]`, both measured in R31).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditJsonPayload, auditRedactRoots, loadAuditData } from './audit-data.js'
import { AUDIT_ROUTE_PATH, createAuditRouteHandler } from './host-audit-route.js'
import { loadEnv } from '@dsh-triage/core'

export interface HostConfig {
  readonly locale?: 'auto' | 'en' | 'zh'
  /**
   * Turns the route off. Default on, because "the tab shows the CLI's own numbers" is the point of
   * the tab; a deployment that does not want a route can say so without unpatching the row.
   */
  readonly auditRoute?: boolean
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
  /** Config-tree anchor: the URL of the profile's own `cordis.yml`. */
  readonly baseUrl?: string | URL
  get?(name: string): unknown
  effect?(execute: () => () => void, label?: string): unknown
  /**
   * The webserver service. Read as a PROPERTY first: Cordis exposes services as context accessors,
   * and `ctx.get('webServer')` returned `undefined` on a real Host where `ctx.webServer` exists
   * (measured R33 — the route was skipped and the tab got a 404).
   */
  readonly webServer?: WebServerLike
}

export const name = 'compat-verdict'

/**
 * Injected on purpose: this Cordis version applies a plugin only after its declared services exist,
 * and reading the service at apply time without injecting returned `undefined` on a real Host
 * (measured R33: the route was skipped and the tab got a 404). A profile without a webserver simply
 * never mounts this row, which is the honest outcome for a browser-only feature.
 */
export const inject = ['webServer']

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

/**
 * Resolve the webserver service without assuming one access style. `ctx.get` is tried as a fallback
 * only: on a real Host it returned `undefined` while the property accessor worked (R33).
 */
export function readWebServer(ctx: HostContext): WebServerLike | undefined {
  try {
    const fromProperty = ctx.webServer
    if (fromProperty !== undefined && fromProperty !== null && typeof fromProperty.register === 'function') {
      return fromProperty
    }
  } catch {
    // An absent Cordis service can throw on property access; that is still "not available".
  }
  try {
    const fromGet = typeof ctx.get === 'function' ? (ctx.get('webServer') as WebServerLike | undefined) : undefined
    if (fromGet !== undefined && fromGet !== null && typeof fromGet.register === 'function') return fromGet
  } catch {
    // Same reasoning: unreadable means unavailable, and the caller logs which case it was.
  }
  return undefined
}

export function apply(ctx: HostContext, config: HostConfig = {}): void {
  const bound = resolveProfileFromBaseUrl(ctx.baseUrl)
  const webServer = readWebServer(ctx)
  const enabled = config.auditRoute !== false
  if (!enabled || bound === null || webServer === undefined || typeof webServer.register !== 'function') {
    const reason = !enabled ? 'disabled by config' : bound === null ? `no profile anchor (${String(ctx.baseUrl)})` : 'no webServer service'
    ctx.logger?.info?.(`dsh-triage mounted (audit route unavailable: ${reason}; locale=${config.locale ?? 'auto'})`)
    // stdout as well: the launcher's own log capture is what a probe/CI can see (R33 needed it).
    console.log(`dsh-triage: audit route skipped (${reason})`)
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
  const register = () => webServer.register({ kind: 'exact', path: AUDIT_ROUTE_PATH, handler })
  const dispose = typeof ctx.effect === 'function' ? ctx.effect(register, 'compat-triage: audit route') : register()
  ctx.logger?.info?.(`dsh-triage mounted (read-only ${AUDIT_ROUTE_PATH} on profile ${bound.profile})`)
  console.log(`dsh-triage: audit route registered at ${AUDIT_ROUTE_PATH} (profile ${bound.profile})`)
  void dispose
}

/**
 * Both shapes carry `inject`: the loader may treat the module namespace OR its default export as the
 * plugin, and an object default without `inject` silently mounts before the service exists (R33).
 */
const plugin = { name, inject, apply }
export default plugin
