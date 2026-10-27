/**
 * Shared live-sampling helpers for the repo scripts.
 *
 * The boot machinery now lives in `packages/probe/src/host.ts` — the M3 executor needed
 * the same code, and a third copy of "spawn → wait for the sample → kill the tree" is
 * exactly the drift R13 paid for. This file keeps the script-facing names and the
 * redaction helpers; it does not re-implement the Host.
 *
 * It re-exports the BUILT package (`dist/`), not the `.ts` source: since R15 `host.ts`
 * imports `./render.js`, and Node's type stripping does not rewrite a `.js` specifier to
 * a sibling `.ts` file. Run `pnpm build` before the live recorders (playbook §1).
 */

import { resolve } from 'node:path'
import { bootAndSampleHost, dshMainOf, killTree, sha256Of } from '../../packages/probe/dist/host.js'

export { dshMainOf, killTree, sha256Of }

/**
 * Boot the Host with a one-entry launcher overlay that mounts `hookSource`, wait for the
 * hook to write `samplePath`, then kill the whole process tree.
 *
 * @returns `{ payload, host, error }` — `payload` is null when the hook wrote nothing.
 */
export async function bootAndSample(options) {
  return bootAndSampleHost(options)
}

/**
 * Redact a path that may arrive as native (backslashes), POSIX-ish (forward slashes) or a
 * percent-encoded `file:///` URL — the loader spells our own probe row as the last one,
 * and missing that shape published `C:/Users/<name>/...` in a first draft.
 */
export function makeRedactor(roots) {
  const label = (root) => (root === roots[0] ? '<repo>' : '~')
  return (value) => {
    let text = String(value)
    if (text.includes('%')) {
      try {
        text = decodeURIComponent(text)
      } catch {
        // Not percent-encoded after all; keep the original.
      }
    }
    for (const root of roots) {
      if (root === '') continue
      for (const variant of [root, root.replaceAll('\\', '/')]) text = text.split(variant).join(label(root))
    }
    return text
  }
}

/** Recursively redact every string in a JSON-ish value. */
export function redactDeep(value, redact) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = redactDeep(item, redact)
    return out
  }
  return value
}

/** Resolve a caller-supplied path against the repo root unless it is already absolute. */
export function pathFor(value, repoRoot) {
  return resolve(repoRoot, String(value))
}
