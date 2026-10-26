/**
 * DSH loader entry for `dsh-triage`.
 *
 * Scope of M0: prove the row mounts and that our patch layer does not collide
 * with upstream ids. No tools, services or browser slots are registered yet —
 * claiming otherwise would be dishonest, and `gate_namespace` exists to keep the
 * row from stealing a core id by accident.
 *
 * M4 will mount a browser tab via `settings.plugins.tab` and register a read-only
 * `compat_verdict` tool for agents. Both need the real cordis types, which are
 * added deliberately (not as `any`) when that milestone starts.
 */

/** Minimal surface we rely on today; intentionally narrow. */
export interface HostContext {
  readonly logger?: {
    info?(message: string): void
  }
}

export interface HostConfig {
  readonly locale?: 'auto' | 'en' | 'zh'
}

export const name = 'compat-verdict'

export function apply(ctx: HostContext, config: HostConfig = {}): void {
  ctx.logger?.info?.(
    `dsh-triage mounted (M0 skeleton, no tools registered; locale=${config.locale ?? 'auto'})`,
  )
}

const plugin = { name, apply }
export default plugin
