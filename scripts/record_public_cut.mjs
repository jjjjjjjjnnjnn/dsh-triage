#!/usr/bin/env node
/**
 * Is the public repository still exactly the container's `dsh-triage/` subtree? (R93)
 *
 * WHY THIS EXISTS: the R93 delivery was cut into the public repo `jjjjjjjjnnjnn/dsh-triage` by hand
 * (`git rev-parse main:dsh-triage` → `commit-tree` → push), and the trees were compared **once, in a
 * transcript**. That comparison is the only thing standing between "the npm page describes this
 * repository" and "the npm page describes a repository that stopped existing at R92", and it has to be
 * repeated after every push. So it becomes an artifact instead of a habit.
 *
 * The judgement (in-sync / behind / drift / unmeasured) lives in `scripts/lib/public-cut.mjs`; this file
 * only runs git and writes down where each value came from. `behind` exists because the ordinary state of
 * this machine between a round's commits and its push is "the public repo is the cut of an older commit" —
 * reporting that as a failure would make the honest answer indistinguishable from the broken one.
 *
 * WHAT IT CANNOT SEE: a forced push (rewritten history, identical tree), commits the public repo has that
 * the container never had, or what GitHub serves right now — it reads the locally fetched `origin/<ref>`.
 *
 *   node scripts/record_public_cut.mjs --stamp 2026-11-10T18:20:00.000Z
 *
 * EXIT CODES: 0 in-sync · 1 behind · 3 drift · 2 unmeasured / bad usage (no artifact written).
 */

import { spawnSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'

import { writeEvidence } from './lib/evidence.mjs'
import { abs, isoStamp, repoRoot } from './lib/kit.mjs'
import { judgePublicCut } from './lib/public-cut.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = String(argOf('--stamp', new Date().toISOString()))
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(
    'usage: node scripts/record_public_cut.mjs --stamp <ISO> [--branch main] [--prefix dsh-triage] [--remote origin] [--public-ref main] [--out <dir>]\n',
  )
  process.exit(2)
}

const root = repoRoot()
const branch = String(argOf('--branch', 'main'))
const prefix = String(argOf('--prefix', 'dsh-triage'))
const remote = String(argOf('--remote', 'origin'))
const publicRef = String(argOf('--public-ref', 'main'))
const outDir = pathFor(argOf('--out', 'data/results'))

/*
 * One reader for git. It returns `null` instead of throwing: "git could not answer" is a different outcome
 * from "the trees differ", and merging them would either invent drift on a machine that never fetched the
 * ref, or — worse — let two empty reads compare equal and print "in sync".
 */
const git = (...args) => {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (run.status !== 0) return null
  return String(run.stdout ?? '').trim()
}

const head = git('rev-parse', branch)
const headSubtreeTree = git('rev-parse', `${branch}:${prefix}`)
const rootTree = git('rev-parse', `${branch}^{tree}`)
const publicHead = git('rev-parse', `${remote}/${publicRef}`)
const publicTree = publicHead === null ? null : git('rev-parse', `${remote}/${publicRef}^{tree}`)

/*
 * Which container commit did the public tree come from? Only commits that touched the subtree can produce a
 * different subtree tree, so `git rev-list <branch> -- <prefix>` is the complete candidate set — no scan of
 * the whole history, and no chance of missing the one that matters. The first match walking backwards is the
 * newest one, which is the answer a reader wants ("cut at commit X").
 */
/*
 * The pathspec is `.` because this script runs from the container's subtree itself: git resolves a
 * relative pathspec against the working directory, so `dsh-triage` would be looked up *inside*
 * `dsh-triage/` and the candidate list would come back empty — a silent "no container commit matches",
 * i.e. drift, on a repository that is perfectly in sync.
 */
const candidates = (git('rev-list', branch, '--', '.') ?? '').split('\n').filter((line) => line.length > 0)
let matchingCommit = null
let matchingIndex = -1
if (publicTree !== null) {
  for (const [index, commit] of candidates.entries()) {
    if (git('rev-parse', `${commit}:${prefix}`) === publicTree) {
      matchingCommit = commit
      matchingIndex = index
      break
    }
  }
}
const commitsBehind =
  matchingCommit === null ? null : Number(git('rev-list', '--count', `${matchingCommit}..${branch}`) ?? Number.NaN)

const ref = `${remote}/${publicRef}`
const verdict = judgePublicCut({ headSubtreeTree, head, publicTree, publicHead, matchingCommit, commitsBehind, ref, rootTree })

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_public_cut.mjs',
  generated_at: stamp,
  question: 'is the public repository exactly the container\'s subtree, re-rooted?',
  container: { branch, prefix, head, subtree_tree: headSubtreeTree, root_tree: rootTree, commits_touching_subtree: candidates.length },
  public: { remote, ref: publicRef, head: publicHead, tree: publicTree },
  comparison: {
    trees_equal: headSubtreeTree !== null && publicTree !== null && headSubtreeTree === publicTree,
    /*
     * The "wrong push" shape, recorded next to the right answer: a public tree equal to the container's ROOT
     * tree means every path gained the `dsh-triage/` prefix. A single boolean could not say both things.
     */
    public_equals_container_root: rootTree !== null && publicTree !== null && publicTree === rootTree,
    /*
     * Where the public tree came from, when it came from somewhere: `null` with a non-null tree is the drift
     * case (a tree this repository never had). Recording both the commit and the distance is what turns "differs"
     * into something a reader can act on.
     */
    matching_container_commit: matchingCommit,
    commits_behind: Number.isInteger(commitsBehind) ? commitsBehind : null,
  },
  status: verdict.status,
  problems: verdict.problems,
  limits: [
    'a tree comparison says nothing about history: a force-push to a rewritten commit with the same content looks identical here',
    'it cannot see commits the public repository has and the container does not (the public repo is cut from it, never merged back)',
    'it is a statement about the moment the ref was last fetched on this machine, not about what GitHub serves now',
  ],
}

const text = `${JSON.stringify(payload, null, 2)}\n`
const written = writeEvidence({ outDir, fileName: `public-cut-${stamp.replaceAll(':', '-')}.json`, text, root })
if (!written.ok) {
  process.stderr.write(`refusing to overwrite ${written.target}\n`)
  process.exit(2)
}

process.stdout.write(
  `public-cut · ${payload.status} · subtree ${String(headSubtreeTree).slice(0, 7)} · public ${String(publicHead).slice(0, 7)} ` +
    `· trees-equal ${String(payload.comparison.trees_equal)}` +
    `${matchingCommit === null ? '' : ` · cut at ${matchingCommit.slice(0, 7)} · behind ${String(commitsBehind)}`}\n`,
)
for (const problem of payload.problems) process.stdout.write(`  ${problem}\n`)
process.stdout.write(`  ${written.display} · ${String(written.sha256).slice(0, 16)}\n`)
process.exitCode = { 'in-sync': 0, behind: 1, drift: 3, unmeasured: 2 }[verdict.status] ?? 2
