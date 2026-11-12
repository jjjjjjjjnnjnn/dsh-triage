/**
 * `packages/core/src/asar.ts` — read a `package.json` out of an Electron `app.asar`.
 *
 * WHY THIS EXISTS (M14, R101): the CLI reported `dsh 0.1.0-rc.6 (inferred)` because it read the pnpm
 * hoisted shared cache, while the Host actually loads `0.2.2-rc.1` from `app.asar`. Eight installed
 * plugins were then reported BLOCKED, confidently and wrongly (`audit/RECON_2026-11-12_desktop-misreport.md`).
 *
 * R91 wrote that "plain Node cannot read asar" — that was measured on a MOUNTED asar path, which is
 * Electron-only. The container itself is an ordinary file: 16-byte header, a JSON directory, then a
 * 4-byte-aligned data section. Reading it needs nothing but `Buffer`.
 *
 * WHAT THIS MODULE IS: pure parsing. It takes a `Buffer` (or a path) and answers "what does this package's
 * manifest say". No Electron API, no writes, no third-party dependency (M14-C7).
 *
 * WHAT IT DOES NOT DO: it does not decide which version to trust (that is `env.ts`, M14-C1), does not fall
 * back to a heuristic when the archive is malformed (M14-C4), and does not read the mounted path at all.
 */

import { readFileSync } from 'node:fs'

/** asar layout, as Chromium writes it: uint32 header-size, JSON directory, padded data section. */
const SIZE_FIELD = 8
const HEADER_JSON_OFFSET = 16

export interface AsarFileEntry {
  readonly size: number
  readonly offset: string | number
  readonly integrity?: { readonly algorithm?: string; readonly hash?: string }
}

export interface AsarDirectoryEntry {
  readonly files?: Readonly<Record<string, AsarNode>>
  readonly link?: string
}

export type AsarNode = AsarFileEntry | AsarDirectoryEntry

export interface AsarHeader {
  readonly files: Readonly<Record<string, AsarNode>>
}

export interface AsarArchive {
  readonly buffer: Buffer
  readonly header: AsarHeader
  /** Absolute byte where the data section starts (header JSON + 4-byte alignment). */
  readonly dataBase: number
}

export type AsarError =
  | { readonly code: 'too-small'; readonly detail: string }
  | { readonly code: 'header-unreadable'; readonly detail: string }
  | { readonly code: 'header-not-directory'; readonly detail: string }

/**
 * Parse the directory of an asar image.
 *
 * A malformed archive is an ANSWER, not an exception (M14-C4/N5): the caller records `unreadable` and
 * falls back to the old behaviour, which is strictly better than guessing a version.
 */
export function parseAsarArchive(buffer: Buffer): AsarArchive | AsarError {
  if (buffer.length < HEADER_JSON_OFFSET + 4) {
    return { code: 'too-small', detail: `need at least ${HEADER_JSON_OFFSET + 4} bytes, got ${buffer.length}` }
  }
  // Layout: uint32 sizeField, then uint32 directorySize, then that many bytes of JSON, then the data
  // section padded to a multiple of 4. The two leading size fields are what Chromium's writer emits; the
  // directory JSON always begins at byte 16 (M14-N5 covers a truncated image).
  const directorySize = buffer.readUInt32LE(12)
  if (!Number.isFinite(directorySize) || directorySize <= 0) {
    return { code: 'header-unreadable', detail: `directory size ${String(directorySize)} is not usable` }
  }
  const jsonStart = HEADER_JSON_OFFSET
  const jsonEnd = jsonStart + directorySize
  if (jsonEnd > buffer.length) {
    return { code: 'header-unreadable', detail: `directory ends at ${jsonEnd}, past ${buffer.length}` }
  }
  let header: unknown
  try {
    header = JSON.parse(buffer.subarray(jsonStart, jsonEnd).toString('utf8'))
  } catch (error) {
    return { code: 'header-unreadable', detail: error instanceof Error ? error.message : String(error) }
  }
  if (header === null || typeof header !== 'object' || Array.isArray(header)) {
    return { code: 'header-not-directory', detail: 'directory JSON is not an object' }
  }
  const files = (header as { files?: unknown }).files
  if (files === null || typeof files !== 'object' || Array.isArray(files)) {
    return { code: 'header-not-directory', detail: 'directory JSON carries no `files` map' }
  }
  const dataBase = Math.ceil(jsonEnd / 4) * 4
  return { buffer, header: { files: files as Record<string, AsarNode> }, dataBase }
}

/** Walk `files` maps by path parts; returns `null` for any miss. */
export function asarLookup(archive: AsarArchive, path: readonly string[]): AsarNode | null {
  let node: AsarNode | undefined = { files: archive.header.files }
  for (const part of path) {
    const files: Readonly<Record<string, AsarNode>> | undefined = (node as AsarDirectoryEntry | undefined)?.files
    if (files === undefined) return null
    node = files[part]
    if (node === undefined) return null
  }
  return node
}

const isFileEntry = (node: AsarNode | null): node is AsarFileEntry =>
  node !== null && typeof (node as AsarFileEntry).size === 'number' && (node as AsarFileEntry).offset !== undefined

/**
 * Read one file's bytes. A directory node, a missing entry, or an out-of-range offset is `null` — never
 * a synthesized value (M14-C4).
 */
export function asarReadFile(archive: AsarArchive, path: readonly string[]): Buffer | null {
  const node = asarLookup(archive, path)
  if (!isFileEntry(node)) return null
  const start = archive.dataBase + Number(node.offset)
  const end = start + node.size
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end > archive.buffer.length || end <= start) return null
  return archive.buffer.subarray(start, end)
}

/** Read and parse a `package.json` inside the archive. `null` when anything is missing or malformed. */
export function asarReadManifest(archive: AsarArchive, path: readonly string[]): Record<string, unknown> | null {
  const bytes = asarReadFile(archive, path)
  if (bytes === null) return null
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Every `@deepseek-ai/*` package inside the kernel's own `dsh/node_modules`, keyed by its manifest `name`.
 *
 * The scope directory is `dsh/node_modules/@deepseek-ai`; each child is one package with a `package.json`.
 * Packages whose manifest is unreadable are skipped, so a caller never sees a name with no version.
 */
export function asarKernelPackages(archive: AsarArchive): Map<string, Record<string, unknown>> {
  const packages = new Map<string, Record<string, unknown>>()
  const scope = asarLookup(archive, ['dsh', 'node_modules', '@deepseek-ai'])
  if (scope === null) return packages
  const files = (scope as AsarDirectoryEntry).files
  if (files === undefined) return packages
  for (const name of Object.keys(files)) {
    const manifest = asarReadManifest(archive, ['dsh', 'node_modules', '@deepseek-ai', name, 'package.json'])
    if (manifest === null) continue
    const declared = typeof manifest['name'] === 'string' ? manifest['name'] : `@deepseek-ai/${name}`
    packages.set(declared, manifest)
  }
  return packages
}

/** Convenience for callers that already know the file path. */
export function openAsar(path: string): AsarArchive | AsarError {
  let buffer: Buffer
  try {
    buffer = readFileSync(path)
  } catch (error) {
    return { code: 'header-unreadable', detail: error instanceof Error ? error.message : String(error) }
  }
  return parseAsarArchive(buffer)
}
