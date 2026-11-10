#!/usr/bin/env node
/**
 * Is our fork's `community.json` exactly "upstream main + our one entry, inserted at its id position"?
 *
 * WHY THIS EXISTS: on 2026-11-10 the maintainer of `zhu1090093659/dsh-community-plugins` switched the
 * index from "append at the end" to "sorted by id", then rebuilt our pull-request branch himself
 * ("合入当前 main，并把条目插到它的 id 位置") and asked us to sync with pull/fetch + merge, NOT force push.
 *
 * Two things follow, and neither is checkable by looking at the PR page:
 *
 *   1. our branch must be a function of upstream main, not a stale copy with a hand-placed line —
 *      the question is whether `insertByEntryId(main, entry)` reproduces their branch BYTE FOR BYTE;
 *   2. if it does, there is nothing for us to push, so "do not force push" is satisfied by doing
 *      nothing — which is a claim that has to be measured, not assumed.
 *
 * WHAT IT CANNOT DO: it cannot see a merged PR (a merged `community.json` already contains the entry),
 * and it cannot prove a maintainer will accept the entry. It only compares two files fetched from
 * the two public branches named on the command line.
 *
 *   node scripts/record_index_sync.mjs --stamp 2026-11-10T14:05:00.000Z
 *
 * Exit codes: 0 in sync · 1 drift (artifact written either way) · 2 bad usage.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

import { assertAscendingIds, insertByEntryId } from './lib/index-order.mjs'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
if (stamp === null) {
  process.stderr.write('usage: node scripts/record_index_sync.mjs --stamp <iso> [--head <branch>] [--entry-id <id>]\n')
  process.exit(2)
}

const outDir = pathFor(argOf('--out', 'data/results'))
const upstream = { owner: 'zhu1090093659', repo: 'dsh-community-plugins', ref: String(argOf('--upstream', 'main')) }
const fork = { owner: 'jjjjjjjjnnjnn', repo: 'dsh-community-plugins', ref: String(argOf('--head', 'feat/community-plugins-dsh-triage')) }
const entryFile = pathFor(argOf('--entry', 'docs/market/submissions/community-plugins-entry.json'))
const entryId = String(argOf('--entry-id', JSON.parse(readFileSync(entryFile, 'utf8')).id))

const rawUrl = (spec) => `https://raw.githubusercontent.com/${spec.owner}/${spec.repo}/${spec.ref}/community.json`

/** One branch's index, read exactly as GitHub serves it (bytes kept, so the comparison can be byte-level). */
const readIndex = async (spec) => {
  const url = rawUrl(spec)
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (response.status !== 200) throw new Error(`${url} answered HTTP ${response.status}`)
  const text = await response.text()
  return { url, text, sha256: sha256(text), entries: JSON.parse(text) }
}

const payload = {
  /*
   * schema_version stays 1: gate_ssot accepts nothing else, and the field set grew without changing the
   * meaning of any existing field (R93 added entry.taken_from / entry.local_copy). The growth is recorded
   * in artifact_revision so a reader can tell this artifact from the R93-1 shape without a gate exception.
   */
  schema_version: 1,
  artifact_revision: 2,
  produced_by: 'scripts/record_index_sync.mjs',
  generated_at: stamp,
  question: 'is the fork branch exactly "upstream main + one entry at its ascending id position"?',
  upstream: { ...upstream, url: rawUrl(upstream), sha256: null, entries: null, has_entry: null },
  fork: { ...fork, url: rawUrl(fork), sha256: null, entries: null, entry_index: null, neighbours: null, ascending: null },
  rebuilt: { entries: null, sha256: null, byte_equal_to_fork: null, deep_equal_to_fork: null },
  /*
   * WHERE THE ENTRY CAME FROM IS NOT WHERE THE FILE LIVES (R93). The comparison takes the entry from the
   * FORK's community.json — that is the only way to ask "is their branch the deterministic result of this
   * entry" — but the old field said `source: community-plugins-entry.json`, which reads as "the local copy
   * was inserted". The local copy is a different object: R93 measured that our docs copy and the branch copy
   * differ in wording ("不安装到你的 profile" vs "不安装", "installs into your profile" vs "installs"), so
   * naming one and using the other is exactly the kind of quiet mismatch this artifact exists to prevent.
   */
  entry: {
    id: entryId,
    taken_from: `${fork.owner}/${fork.ref} community.json`,
    local_copy: { file: entryFile.replaceAll('\\', '/').split('/').slice(-2).join('/'), sha256: null, identical_to_fork_entry: null, differing_keys: [] },
  },
  status: 'unmeasured',
  blocker: null,
  limits: [
    'it compares two public branches, not a merge: an accepted entry is only proven by a merged pull request',
    'it says nothing about whether the maintainer will accept the entry, only that our branch follows the current rule',
    'the rule itself can change again; this artifact pins what the rule produced on this day',
  ],
}

try {
  const main = await readIndex(upstream)
  const head = await readIndex(fork)
  payload.upstream.sha256 = main.sha256
  payload.upstream.entries = main.entries.length
  payload.upstream.has_entry = main.entries.some((item) => item?.id === entryId)
  payload.fork.sha256 = head.sha256
  payload.fork.entries = head.entries.length

  /*
   * The entry is taken from the FORK, not from our local copy: the question is whether their branch is the
   * deterministic result of inserting that entry into their main, so the entry under test must be the one
   * already on the branch. A local copy could differ and the comparison would then answer a different
   * question ("would our newer copy be inserted correctly?").
   */
  const entry = head.entries.find((item) => item?.id === entryId)
  if (entry === undefined) throw new Error(`${fork.owner}/${fork.ref} has no entry with id ${entryId}`)

  /*
   * Record how the branch's entry differs from our docs copy, without letting the difference change the
   * comparison: if the two disagree, the branch is still a valid function of the entry it carries — the
   * disagreement is a fact about our working copy, and it belongs in the artifact where a reader will see it.
   */
  const localEntry = JSON.parse(readFileSync(entryFile, 'utf8'))
  payload.entry.local_copy.sha256 = sha256(JSON.stringify(localEntry))
  payload.entry.local_copy.identical_to_fork_entry = JSON.stringify(localEntry) === JSON.stringify(entry)
  payload.entry.local_copy.differing_keys = Object.keys({ ...localEntry, ...entry }).filter(
    (key) => JSON.stringify(localEntry[key]) !== JSON.stringify(entry[key]),
  )
  if (!payload.entry.local_copy.identical_to_fork_entry) {
    payload.limits.push(
      'the entry under test came from the fork branch; our docs copy of the same registration differs in ' +
        (payload.entry.local_copy.differing_keys.join(', ') || 'unknown keys') +
        " — syncing the branch means carrying the branch's wording, not ours",
    )
  }

  const ordered = insertByEntryId(main.entries, entry)
  assertAscendingIds(ordered)
  assertAscendingIds(head.entries)
  payload.fork.ascending = true

  const rebuiltText = `${JSON.stringify(ordered, null, 2)}\n`
  payload.rebuilt.entries = ordered.length
  payload.rebuilt.sha256 = sha256(rebuiltText)
  payload.rebuilt.byte_equal_to_fork = rebuiltText === head.text
  payload.rebuilt.deep_equal_to_fork = JSON.stringify(ordered) === JSON.stringify(head.entries)

  const index = ordered.findIndex((item) => item?.id === entryId)
  payload.fork.entry_index = index
  payload.fork.neighbours = {
    previous: index > 0 ? (ordered[index - 1]?.id ?? null) : null,
    next: index + 1 < ordered.length ? (ordered[index + 1]?.id ?? null) : null,
  }

  const inSync = payload.rebuilt.byte_equal_to_fork && payload.rebuilt.deep_equal_to_fork
  payload.status = inSync ? 'in-sync' : 'drift'
  if (!inSync) {
    payload.blocker =
      'the fork branch is not what inserting the entry into upstream main produces: either the entry differs, ' +
      'or upstream moved after their rebuild. Re-read both branches before touching anything, and never force push.'
  }
} catch (error) {
  payload.status = 'unmeasured'
  payload.blocker = error instanceof Error ? error.message : String(error)
}

const text = `${JSON.stringify(payload, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const target = join(outDir, `index-sync-${stamp.replaceAll(':', '-')}.json`)
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

process.stdout.write(
  `index-sync · ${payload.status} · upstream ${String(payload.upstream.entries)} + 1 = ${String(payload.rebuilt.entries)} · ` +
    `fork ${String(payload.fork.entries)} · byte-equal ${String(payload.rebuilt.byte_equal_to_fork)} · index ${String(payload.fork.entry_index)}\n`,
)
if (payload.status === 'drift') process.stdout.write(`  ${String(payload.blocker)}\n`)
process.stdout.write(`  ${target.replaceAll('\\', '/').split('/data/results/').pop()}\n`)
process.exitCode = payload.status === 'drift' ? 1 : 0
