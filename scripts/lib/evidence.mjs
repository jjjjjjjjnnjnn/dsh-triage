/**
 * One writer for evidence artifacts — because "the path I printed" and "the path I wrote" have silently
 * disagreed twice in one day (R64 `watch_next_release.mjs`, R65 `record_usability_smoke.mjs`).
 *
 * THE BUG CLASS: a recorder accepts `--out <dir>`, writes to that dir, and then prints
 * `ssot data/results/<file>` with a hard-coded prefix. With the default `--out` the lie is invisible; the
 * moment a negative control points `--out` at a temp dir, the tool reports a file that does not exist and
 * omits the one it just wrote. Both times it was found by a control, not by reading the code.
 *
 * WHAT THIS GUARANTEES:
 *   - the printed path is derived from the path actually written (repo-relative when inside the repo, so a
 *     published artifact never carries an absolute home path);
 *   - `.sha256` is written beside the file from the same bytes;
 *   - an existing file is never overwritten (callers turn that into exit 2, per the repo's convention).
 *
 * WHAT IT DOES NOT DO: it does not decide the file name, the stamp or the schema — those stay in the
 * recorders, where the claims are.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/**
 * @param {{
 *   outDir: string,
 *   fileName: string,
 *   text: string,
 *   root?: string,
 * }} input
 * @returns {{ ok: true, target: string, display: string, sha256: string } | { ok: false, reason: 'exists', target: string }}
 */
export function writeEvidence(input) {
  const root = input?.root ?? process.cwd()
  const outDir = isAbsolute(String(input?.outDir ?? '')) ? String(input.outDir) : resolve(root, String(input?.outDir ?? 'data/results'))
  const fileName = String(input?.fileName ?? '')
  if (fileName.length === 0) throw new Error('writeEvidence needs a file name')
  const target = join(outDir, fileName)
  mkdirSync(outDir, { recursive: true })
  if (existsSync(target)) return { ok: false, reason: 'exists', target }

  const text = String(input?.text ?? '')
  writeFileSync(target, text, 'utf8')
  const digest = sha256(text)
  writeFileSync(`${target}.sha256`, digest, 'utf8')

  const rel = relative(root, target)
  // Repo-relative when it is inside the repo; absolute only when the caller wrote outside it (a control
  // run into %TEMP%), because those two cases must not look alike in a transcript.
  const display = rel.startsWith('..') || isAbsolute(rel) ? target.replaceAll('\\', '/') : rel.replaceAll('\\', '/')
  return { ok: true, target, display, sha256: digest }
}
