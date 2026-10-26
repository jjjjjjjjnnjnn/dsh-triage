/**
 * Local artifacts produced by *other* tools (guard incidents, vet reports, snapshots).
 *
 * Status: discovery only (M0/M1). Nothing here feeds a verdict yet, because the
 * schemas are third-party and unverified — see `audit/blind_spots.json` BS-04.
 * Reading them is still useful: `dsh-triage audit` lists what evidence already
 * exists on this machine, so M2 can start consuming the stable ones.
 *
 * Hard rule: read-only, bounded (no recursive walks outside the candidate list),
 * and tolerant of broken JSON (reported, never thrown).
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type LocalArtifactKind = 'guard-incident' | 'vet-result' | 'savepoint' | 'unknown'

export interface LocalArtifact {
  readonly path: string
  readonly kind: LocalArtifactKind
  /** Parsed JSON when available; `null` when the file is not valid JSON. */
  readonly raw: unknown
  readonly bytes: number
  readonly note: string
}

export interface DiscoverOptions {
  /** Directory that contains the artifacts (usually the profile directory). */
  readonly root: string
  readonly maxFiles?: number
}

interface Candidate {
  readonly relative: string
  readonly kind: LocalArtifactKind
  readonly directory: boolean
}

const CANDIDATES: readonly Candidate[] = [
  { relative: '.guard/incidents', kind: 'guard-incident', directory: true },
  { relative: 'incidents', kind: 'guard-incident', directory: true },
  { relative: '.vetting/vet-result.json', kind: 'vet-result', directory: false },
  { relative: '.vetting/vet-report.md', kind: 'vet-result', directory: false },
  { relative: '.savepoints', kind: 'savepoint', directory: true },
]

/** Discover known artifacts under `root`; missing paths are simply absent. */
export async function discoverLocalArtifacts(options: DiscoverOptions): Promise<readonly LocalArtifact[]> {
  const maxFiles = options.maxFiles ?? 40
  const found: LocalArtifact[] = []

  for (const candidate of CANDIDATES) {
    const path = join(options.root, candidate.relative)
    if (candidate.directory) {
      const names = await safeReaddir(path)
      for (const name of names.sort((a, b) => a.localeCompare(b)).slice(0, maxFiles)) {
        if (!/\.(json|jsonl|md)$/i.test(name)) continue
        const artifact = await readArtifact(join(path, name), candidate.kind)
        if (artifact !== null) found.push(artifact)
      }
    } else {
      const artifact = await readArtifact(path, candidate.kind)
      if (artifact !== null) found.push(artifact)
    }
  }

  return found.sort((a, b) => a.path.localeCompare(b.path))
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  } catch {
    return []
  }
}

async function readArtifact(path: string, kind: LocalArtifactKind): Promise<LocalArtifact | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > 4 * 1024 * 1024) {
      return {
        path,
        kind,
        raw: null,
        bytes: info.size,
        note: 'skipped: not a regular file under 4 MiB',
      }
    }
    const text = await readFile(path, 'utf8')
    if (/\.md$/i.test(path)) {
      return { path, kind, raw: null, bytes: info.size, note: 'markdown report (not parsed in M0)' }
    }
    try {
      const parsed: unknown = JSON.parse(text)
      return { path, kind, raw: parsed, bytes: info.size, note: 'parsed json (schema unverified)' }
    } catch {
      return { path, kind, raw: null, bytes: info.size, note: 'invalid json; kept for manual inspection only' }
    }
  } catch {
    return null
  }
}
