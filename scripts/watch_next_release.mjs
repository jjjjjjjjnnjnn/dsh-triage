#!/usr/bin/env node
/**
 * "Upstream published a new rc" is the one signal this product cannot afford to miss (R64).
 *
 * WHY THIS EXISTS: every upgrade-day card so far was produced by hand, after a human happened to read
 * the Discussions. The value of the front door peaks in the first hour of a new runtime — that is when
 * people's plugins start disappearing — and a product whose trigger is "someone noticed" has a trigger
 * that fires whenever someone notices.
 *
 * This script does exactly one job: read `dist-tags.next` for `@deepseek-ai/dsh`, compare it with the
 * last observation recorded under `data/results/`, and answer `changed` / `unchanged` / `unmeasured`.
 * It does not run the card, does not post, does not decide anything about your profile.
 *
 *   node scripts/watch_next_release.mjs
 *   node scripts/watch_next_release.mjs --stamp 2026-11-03T09:00:00.000Z
 *
 * Exit codes:
 *   0 the registry answered (whether or not anything changed)
 *   2 the registry could not be read, or bad usage — **no artifact is written**
 *
 * Why exit 2 on an unreadable registry instead of writing a "no update" artifact: R52 recorded
 * `threads: 0` from a 403 and it read as "nobody has this problem", and R51 recorded `pending` as an
 * answer. A watcher that cannot see npm must not report calm.
 *
 * Why `process.exitCode` and not `process.exit()`: on Windows, exiting while undici's sockets are still
 * closing trips `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in libuv and the process ends
 * with code 1 — the first real run of this script (2026-11-02, R64) did exactly that, so a successful
 * read would have looked like a failure to any caller. Let the event loop drain; set the code.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { judgeNextChange } from './lib/next-release.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${String(argOf('--stamp', ''))}": expected ISO-8601\n`)
  process.exitCode = 2
} else {
  await main()
}

async function main() {
  const registry = String(argOf('--registry', 'https://registry.npmjs.org')).replace(/\/+$/, '')
  const outDir = pathFor(String(argOf('--out', 'data/results')))
  const upstream = String(argOf('--package', '@deepseek-ai/dsh'))
  const tag = String(argOf('--tag', 'next'))

  const previous = lastObservation(outDir)
  const current = await readNextTag({ registry, upstream, tag })
  const verdict = judgeNextChange({
    previous: previous === null ? null : { version: previous.version, at: previous.at },
    current,
  })

  if (verdict.state === 'unmeasured') {
    process.stderr.write(`watch-next: ${verdict.detail}\n`)
    process.stderr.write('watch-next: nothing recorded — an unreadable registry is not "no update"\n')
    process.exitCode = 2
    return
  }

  if (verdict.state === 'unchanged') {
    process.stdout.write(`watch-next: ${verdict.detail}\n`)
    process.stdout.write('watch-next: nothing recorded, nothing to publish\n')
    return
  }

  const payload = {
    schema_version: 1,
    produced_by: 'scripts/watch_next_release.mjs',
    generated_at: stamp,
    upstream: { package: upstream, registry, tag, http_status: current.status, dist_tags: current.distTags },
    previous: previous === null ? null : { version: previous.version, at: previous.at, artifact: previous.file },
    next: { version: verdict.to },
    change: {
      state: verdict.state,
      changed: verdict.changed,
      from: verdict.from,
      to: verdict.to,
      detail: verdict.detail,
    },
    /*
     * The card is NOT run here on purpose: its numbers come from the profile on this machine, and running
     * it inside a watcher would make it look like a statement about everyone's machine. The command is the
     * output; a human (or the next agent) runs it and decides whether to publish.
     */
    suggested: [`dsh-triage upgrade --to ${tag} --card`, `dsh-triage upgrade --to ${verdict.to} --card --out upgrade-${verdict.to}.md`],
    limits: [
      'this is one registry read at one timestamp: it says what dist-tags said here and now, not what npm serves every region',
      'changed includes a rollback — the two versions are reported verbatim and no semver ordering is claimed',
      "the card numbers come from this machine's profile; re-run the card before quoting it anywhere",
      'this script posts nothing and writes nothing outside data/results',
    ],
  }

  const fileName = `next-release-${stamp.replaceAll(':', '-')}.json`
  const target = join(outDir, fileName)
  mkdirSync(outDir, { recursive: true })
  if (existsSync(target)) {
    process.stderr.write(`refusing to overwrite existing evidence: ${fileName}\n`)
    process.exitCode = 2
    return
  }
  const text = `${JSON.stringify(payload, null, 2)}\n`
  writeFileSync(target, text, 'utf8')
  writeFileSync(`${target}.sha256`, sha256(text), 'utf8')

  process.stdout.write(`watch-next: ${verdict.detail}\n`)
  // Print the path that was actually written: the first version of this line hard-coded `data/results`
  // while honouring `--out`, so a control run pointed at a temp dir reported the wrong file (R64).
  const root = abs('.')
  const display = target.startsWith(root) ? target.slice(root.length + 1).replaceAll('\\', '/') : target
  process.stdout.write(`ssot ${display} sha256=${sha256(text).slice(0, 12)}…\n`)
  for (const line of payload.suggested) process.stdout.write(`  next: ${line}\n`)
  process.stdout.write("  note: the card reads THIS machine's profile — re-run it before quoting it\n")
}

/** The newest observation this script itself wrote. Other artifacts are not a baseline. */
function lastObservation(outDir) {
  if (!existsSync(outDir)) return null
  return (
    readdirSync(outDir)
      .filter((name) => name.startsWith('next-release-') && name.endsWith('.json'))
      .map((name) => {
        try {
          const value = JSON.parse(readFileSync(join(outDir, name), 'utf8'))
          return value?.produced_by === 'scripts/watch_next_release.mjs' && typeof value?.generated_at === 'string' && typeof value?.next?.version === 'string'
            ? { file: name, at: value.generated_at, version: value.next.version }
            : null
        } catch {
          return null
        }
      })
      .filter((entry) => entry !== null)
      .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0))[0] ?? null
  )
}

async function readNextTag({ registry, upstream, tag }) {
  const encoded = upstream.replace('/', '%2f')
  try {
    const response = await fetch(`${registry}/${encoded}`, { headers: { accept: 'application/json' } })
    if (!response.ok) return { ok: false, version: null, detail: `HTTP ${response.status}`, status: response.status, distTags: null }
    const body = await response.json()
    const distTags = body?.['dist-tags'] ?? {}
    const value = typeof distTags?.[tag] === 'string' ? distTags[tag] : null
    return value === null
      ? { ok: false, version: null, detail: `no "${tag}" tag on ${upstream}`, status: response.status, distTags }
      : { ok: true, version: value, detail: null, status: response.status, distTags }
  } catch (error) {
    const detail = `network error (${String(error?.code ?? error?.message ?? 'unknown')})`
    return { ok: false, version: null, detail, status: null, distTags: null }
  }
}
