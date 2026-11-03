/**
 * Which `Host` values this panel is allowed to answer (ADR-0014, T-811).
 *
 * WHY A PURE FUNCTION: the rule decides whether a request from a page that *thinks* it is talking
 * to `evil.com` reaches the panel. A DNS-rebinding attack works because the browser sends
 * `Host: evil.com:<port>` while the TCP connection lands on 127.0.0.1 — and because a same-origin
 * navigation may carry **no** `Origin` header at all, the Origin check alone cannot see it. The
 * rule is small enough to test exhaustively, so it lives here instead of inside the request
 * handler where only an integration test could reach it.
 *
 * THREE PROPERTIES THAT MUST HOLD:
 *   1. the default binding (127.0.0.1) keeps working with no configuration;
 *   2. matching is **exact** — `127.0.0.1.evil.com` and a wrong port are both refused;
 *   3. a refusal is a readable sentence, because "Host mismatch" and "bad token" are different
 *      problems and confusing them sends the user to the wrong fix (R50's lesson).
 */

/** Names that always mean "this machine", whatever `--host` says. */
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'] as const

/** Bind addresses that mean "every interface"; they are not themselves a Host value. */
const WILDCARD_BIND = new Set(['0.0.0.0', '::', '[::]'])

export interface HostInput {
  /** `Host` header as the browser sent it (`name:port`). */
  readonly host?: string
  /** The address the server was told to bind (defaults to 127.0.0.1). */
  readonly boundHost?: string
  /** The port the server is actually listening on (0 before `listen`). */
  readonly port: number
  /** Extra names from `--allow-host`, each `name` or `name:port`. */
  readonly allowHosts?: readonly string[]
}

export interface HostJudgement {
  readonly ok: boolean
  readonly reason: string | null
}

/** Lowercase, trim, and drop the single trailing dot a FQDN may carry (`localhost.` / `localhost.:80`). */
function normalise(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.(?=:|$)/, '')
}

/** True when the entry already carries a port (`name:80`, `[::1]:80`). */
function hasPort(entry: string): boolean {
  return /^\[[^\]]+\]:\d+$/.test(entry) || /^[^:]+:\d+$/.test(entry)
}

/**
 * The exact strings this panel accepts, sorted so a refusal message is stable and diffable.
 * Exported because the refusal sentence quotes it and the tests assert on it.
 */
export function allowedHosts(input: HostInput): string[] {
  const port = input.port
  const bound = normalise(input.boundHost ?? '127.0.0.1')
  const allowed = new Set<string>(LOOPBACK_HOSTS.map((name) => `${name}:${port}`))
  if (!WILDCARD_BIND.has(bound) && bound !== '') allowed.add(`${bound}:${port}`)
  for (const raw of input.allowHosts ?? []) {
    const entry = normalise(raw)
    if (entry === '') continue
    allowed.add(hasPort(entry) ? entry : `${entry}:${port}`)
  }
  return [...allowed].sort()
}

/**
 * Judge one request. `port` is the port the socket is bound to, not the one in `Host`: that is
 * what makes "the page is talking to my address" checkable rather than self-declared.
 */
export function judgeHost(input: HostInput): HostJudgement {
  const host = typeof input.host === 'string' ? normalise(input.host) : ''
  if (host === '') {
    return { ok: false, reason: 'request carries no Host header; a browser always sends one' }
  }
  const allowed = allowedHosts(input)
  if (allowed.includes(host)) return { ok: true, reason: null }
  /*
   * A browser OMITS the port when it is the scheme default: `http://localhost:80/` sends
   * `Host: localhost`. Without this, `--port 80` would refuse every request and the panel would be
   * dead on a legitimate configuration (found by an independent reviewer, R75). Only the default
   * port gets this treatment — for any other port the header always carries it, so a missing port
   * there is not a browser we know how to serve.
   */
  if (!hasPort(host) && input.port === 80 && allowed.includes(`${host}:80`)) return { ok: true, reason: null }
  return {
    ok: false,
    reason: `Host ${JSON.stringify(host)} is not the address this panel is bound to; expected one of ${allowed.join(', ')} (a DNS-rebinding page sends its own name here — see docs/adr/0014-host-header-allowlist.md)`,
  }
}
