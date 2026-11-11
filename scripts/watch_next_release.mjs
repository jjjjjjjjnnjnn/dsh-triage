#!/usr/bin/env node
/**
 * "Upstream published a new rc" is the one signal this product cannot afford to miss (R64).
 *
 * WHY THIS EXISTS: every upgrade-day card so far was produced by hand, after a human happened to read
 * the Discussions. The value of the front door peaks in the first hour of a new runtime — that is when
 * people's plugins start disappearing — and a product whose trigger is "someone noticed" has a trigger
 * that fires whenever someone notices.
 *
 * This script does exactly one job: read `dist-tags.next` **and `dist-tags.latest`** for
 * `@deepseek-ai/dsh`, compare them with the last observation recorded under `data/results/`, and answer
 * `changed` / `unchanged` / `unmeasured` for each. It does not run the card, does not post, does not
 * decide anything about your profile.
 *
 * R94 — WHY `latest` IS READ TOO: until this round the watcher read `next` only, and on 2026-11-05T13:21:52Z
 * upstream promoted `0.2.2-rc.1` to `latest` — the actual upgrade day for everyone on the default channel.
 * `next` had not moved, so every six-hour run reported `unchanged` and the front door never fired. Both
 * tags now come from **one** registry read, so the two verdicts describe the same instant.
 * The `next` verdict keeps its four states, its wording and its exit-code rule; the `latest` verdict is
 * additive (`promoted` / `latest-moved` / `baseline` / `unchanged` / `unmeasured`).
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
import { isAbsolute, basename, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { judgeLatestTag, judgeNextChange, pickNewestObservation } from './lib/next-release.mjs'

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

  /*
   * Where else may the previous observation live? (R71)
   *
   * Locally the artifacts sit in `data/results` and `--out` is that same directory, so this is invisible.
   * In CI `--out` has to be `$RUNNER_TEMP` (CI must never write SSOT), and without `--baseline` every run
   * would answer `baseline` — a watcher that has amnesia, reported as calm.
   */
  const baselineDirs = String(argOf('--baseline', ''))
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map(pathFor)
  const scanDirs = [outDir, ...baselineDirs.filter((dir) => dir !== outDir)]
  const observations = collectObservations(scanDirs)
  const { previous, previousLatest, ignored } = observations
  if (ignored > 0) process.stderr.write(`watch-next: ignored ${ignored} unparseable observation(s)\n`)
  /*
   * ONE registry read, two verdicts (R94). Two separate reads could straddle a publish and produce a
   * "next and latest disagree" claim that never existed.
   */
  const current = await readNextTag({ registry, upstream, tag })
  const latestVersion = typeof current.distTags?.latest === 'string' ? current.distTags.latest : null
  const verdict = judgeNextChange({
    previous: previous === null ? null : { version: previous.version, at: previous.at },
    current,
  })
  const latestVerdict = judgeLatestTag({
    previous: previousLatest === null ? null : { version: previousLatest.version, at: previousLatest.at },
    current: {
      ok: current.ok === true,
      version: latestVersion,
      next: typeof current.version === 'string' ? current.version : null,
      detail: latestVersion === null && current.ok === true ? `no "latest" tag on ${upstream}` : current.detail,
    },
  })

  if (verdict.state === 'unmeasured') {
    process.stderr.write(`watch-next: ${verdict.detail}\n`)
    process.stderr.write('watch-next: nothing recorded — an unreadable registry is not "no update"\n')
    process.exitCode = 2
    return
  }

  /*
   * The default channel is the one most users are on. If it cannot be read, saying nothing about it is
   * *also* a claim, so this run fails like the `next` half does — but only after the `next` half produced
   * its evidence, which is why the artifact below is written first.
   */
  if (latestVerdict.state === 'unmeasured') {
    process.stderr.write(`watch-next: ${latestVerdict.detail}\n`)
    process.stderr.write('watch-next: the default channel was not measured — that is not "no change there"\n')
  }

  if (verdict.state === 'unchanged' && latestVerdict.state === 'unchanged') {
    process.stdout.write(`watch-next: ${verdict.detail}\n`)
    process.stdout.write(`watch-latest: ${latestVerdict.detail}\n`)
    process.stdout.write('watch-next: nothing recorded, nothing to publish\n')
    return
  }
  if (verdict.state === 'unchanged' && !latestVerdict.writesArtifact) {
    process.stdout.write(`watch-next: ${verdict.detail}\n`)
    process.stderr.write(`watch-latest: ${latestVerdict.detail}\n`)
    process.stdout.write('watch-next: nothing recorded — a default channel that could not be read is not "no change"\n')
    process.exitCode = 2
    return
  }

  const payload = {
    schema_version: 1,
    produced_by: 'scripts/watch_next_release.mjs',
    generated_at: stamp,
    upstream: { package: upstream, registry, tag, http_status: current.status, dist_tags: current.distTags },
    previous: previous === null ? null : { version: previous.version, at: previous.at, artifact: previous.file, source: displayPath(previous.dir) },
    next: { version: verdict.to },
    change: {
      state: verdict.state,
      changed: verdict.changed,
      from: verdict.from,
      to: verdict.to,
      detail: verdict.detail,
    },
    /*
     * R94: the default channel, judged in the same read. `promoted` is the upgrade day; `agreesWithNext`
     * answers "are the canary and the default channel the same build right now", which is the question a
     * reader actually has and which neither tag alone can answer.
     */
    latest: { version: latestVerdict.to, tag: 'latest' },
    previous_latest: previousLatest === null
      ? null
      : { version: previousLatest.version, at: previousLatest.at, artifact: previousLatest.file, source: displayPath(previousLatest.dir) },
    change_latest: {
      state: latestVerdict.state,
      changed: latestVerdict.changed,
      from: latestVerdict.from,
      to: latestVerdict.to,
      agrees_with_next: latestVerdict.agreesWithNext,
      detail: latestVerdict.detail,
    },
    /*
     * The card is NOT run here on purpose: its numbers come from the profile on this machine, and running
     * it inside a watcher would make it look like a statement about everyone's machine. The command is the
     * output; a human (or the next agent) runs it and decides whether to publish.
     */
    suggested: latestVerdict.agreesWithNext === true
      ? [
          'dsh-triage upgrade --to latest --card',
          `dsh-triage upgrade --to ${String(latestVerdict.to)} --card --out upgrade-${String(latestVerdict.to)}.md`,
        ]
      : [`dsh-triage upgrade --to ${tag} --card`, `dsh-triage upgrade --to ${String(verdict.to)} --card --out upgrade-${String(verdict.to)}.md`],
    limits: [
      'this is one registry read at one timestamp: it says what dist-tags said here and now, not what npm serves every region',
      'changed includes a rollback — the two versions are reported verbatim and no semver ordering is claimed',
      "the card numbers come from this machine's profile; re-run the card before quoting it anywhere",
      'this script posts nothing and writes nothing outside data/results',
      '`promoted` says the `latest` tag now equals `next`; it does not say the upgrade is safe, nor that every user moved',
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
  process.stdout.write(`watch-latest: ${latestVerdict.detail}\n`)
  if (previous !== null) process.stdout.write(`watch-next: baseline ${previous.version} from ${displayPath(previous.dir) ?? 'unknown'}/${previous.file ?? 'unknown'}\n`)
  if (previousLatest !== null) process.stdout.write(`watch-latest: baseline ${previousLatest.version} from ${displayPath(previousLatest.dir) ?? 'unknown'}/${previousLatest.file ?? 'unknown'}\n`)
  // Print the path that was actually written: the first version of this line hard-coded `data/results`
  // while honouring `--out`, so a control run pointed at a temp dir reported the wrong file (R64).
  const root = abs('.')
  const display = target.startsWith(root) ? target.slice(root.length + 1).replaceAll('\\', '/') : target
  process.stdout.write(`ssot ${display} sha256=${sha256(text).slice(0, 12)}…\n`)
  for (const line of payload.suggested) process.stdout.write(`  next: ${line}\n`)
  process.stdout.write("  note: the card reads THIS machine's profile — re-run it before quoting it\n")
}

/**
 * Every observation this script itself wrote, across the directories we were told to look in (R71).
 * Other artifacts are not a baseline: `produced_by` is checked, not assumed from the file name.
 *
 * R94: the same artifacts are read twice — once for `next` and once for `latest`. Artifacts written before
 * this round have no `latest` block, and those are deliberately **not** a `latest` baseline: claiming
 * "latest has not moved since 11-05" from an artifact that never looked at `latest` is the exact false
 * calm this watcher exists to prevent. A missing `latest` observation therefore reads as `baseline` on
 * the first run after this round, not as `unchanged`.
 */
function collectObservations(dirs) {
  const candidates = []
  const latestCandidates = []
  let ignoredCount = 0
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir).filter((entry) => entry.startsWith('next-release-') && entry.endsWith('.json'))) {
      let value = null
      try {
        value = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      } catch {
        ignoredCount += 1
        continue
      }
      if (value?.produced_by !== 'scripts/watch_next_release.mjs') continue
      if (typeof value?.generated_at !== 'string' || typeof value?.next?.version !== 'string') {
        ignoredCount += 1
        continue
      }
      candidates.push({ file: name, dir, at: value.generated_at, version: value.next.version })
      const latest = value?.latest?.version
      if (typeof latest === 'string' && latest.trim().length > 0) {
        latestCandidates.push({ file: name, dir, at: value.generated_at, version: latest })
      }
    }
  }
  return {
    previous: withSource(candidates, pickNewestObservation(candidates)),
    previousLatest: withSource(latestCandidates, pickNewestObservation(latestCandidates)),
    ignored: ignoredCount,
  }
}

/** Keep the file (and the directory it came from) attached: a baseline you cannot locate is not auditable. */
function withSource(candidates, picked) {
  if (picked === null) return null
  const match = candidates.find((entry) => entry.version === picked.version && entry.at === picked.at) ?? null
  return { version: picked.version, at: picked.at, file: match?.file ?? null, dir: match?.dir ?? null }
}

/**
 * Repo-relative when inside the repo, and **only the directory name** when a control run pointed outside
 * it. R67 already paid for this: a `%TEMP%` path in an artifact put `C:\Users\<name>` into a public repo
 * (`results-privacy` failed on it). A path that is useful for debugging and a path that leaks the user
 * name are the same string unless you cut it here.
 */
function displayPath(target) {
  if (target === null) return null
  const root = abs('.')
  if (target.startsWith(root)) return target.slice(root.length + 1).replaceAll('\\', '/')
  return `(external)/${basename(target)}`
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
