/**
 * Types for `scripts/lib/evidence.mjs`, which a governance test imports directly.
 */

export function displayPath(target: string, root?: string): string

export function writeEvidence(input: {
  outDir: string,
  fileName: string,
  text: string,
  root?: string,
}): { ok: true, target: string, display: string, sha256: string } | { ok: false, reason: 'exists', target: string }
