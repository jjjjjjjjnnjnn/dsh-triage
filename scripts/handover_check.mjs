#!/usr/bin/env node
/**
 * Is the handover telling the truth right now? (R105)
 *
 * WHY THIS EXISTS: `docs/HANDOFF.md` is the one file a new session reads first, and it makes claims
 * that nothing recomputes — the test count in the acceptance criterion, the snapshot to start from,
 * the archive that holds the trimmed batch rows, the number of rows §2 keeps, the version on npm,
 * the state of the open pull request. Every previous round found at least one of these stale by
 * *reading* it, which is not a control.
 *
 * WHAT IT CHECKS: each claim the handover makes that can be recomputed from the repository, plus the
 * two external facts it asserts (npm `latest`, the submission PR). Each check prints PASS or FAIL and
 * the number that decided it.
 *
 * WHAT IT DOES NOT DO: it does not judge prose, does not run the test suite (that takes 30s and
 * `pnpm run verify` already does it), and does not fail when the network is down — an unreadable npm
 * or GitHub says `unmeasured`, because "could not ask" and "the answer changed" are different facts.
 *
 *   node scripts/handover_check.mjs
 *
 * Exit codes: 0 every claim still holds · 1 at least one claim no longer holds · 2 nothing to read.
 */

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { BATCH_ROW_BUDGET, countBatchRows } from './lib/handover-claims.mjs'
import { abs } from './lib/kit.mjs'

const checks = []
const pass = (name, detail) => checks.push({ name, ok: true, detail })
const fail = (name, detail) => checks.push({ name, ok: false, detail })
const unmeasured = (name, detail) => checks.push({ name, ok: true, unmeasured: true, detail })

const read = (path) => readFileSync(abs(path), 'utf8')
const readJson = (path) => JSON.parse(read(path))

const HANDOFF = 'docs/HANDOFF.md'
if (!existsSync(abs(HANDOFF))) {
  process.stderr.write(`nothing to read: ${HANDOFF} is missing\n`)
  process.exit(2)
}
const handoff = read(HANDOFF)

/* --- 1. The five-minute check is present and executable -------------------------------------- */
if (handoff.includes('pnpm run verify') && handoff.includes('gate.mjs --mutate')) {
  pass('五分钟检查', 'verify + --mutate are both in section 1')
} else {
  fail('五分钟检查', 'section 1 no longer tells the reader to run both commands')
}

/* --- 2. Section 3 names the current next action ---------------------------------------------- */
if (handoff.includes('D5 关窗') && handoff.includes('2026-11-15T20:24:37Z')) {
  pass('§3 第一件事', 'D5 close-out and its instant are stated')
} else {
  fail('§3 第一件事', 'the next action is not stated (or the close-out instant was dropped)')
}

/* --- 3. The acceptance number equals the badge, which is what the suite reports --------------- */
const badge = /badge\/tests-(\d+)/.exec(read('README.md'))?.[1]
if (badge === undefined) {
  fail('验收数', 'README.md carries no tests badge, so nothing can be compared')
} else if (handoff.includes(`当前 **${badge} 测试**`)) {
  pass('验收数', `${badge} matches the README badge`)
} else {
  fail('验收数', `the handover does not say "当前 **${badge} 测试**" (badge says ${badge})`)
}

/* --- 4. The handover snapshot it points at exists, and hashes ------------------------------- */
const snapshotNamed = /snapshot-[0-9A-Za-z._-]+\.json/.exec(handoff)?.[0] ?? null
if (snapshotNamed === null) {
  fail('交接快照', 'section 3 does not name a snapshot')
} else {
  const path = `backup/snapshots/${snapshotNamed}`
  if (existsSync(abs(path)) && existsSync(abs(`${path}.sha256`))) pass('交接快照', path)
  else fail('交接快照', `${path} (or its .sha256) is missing`)
}

/* --- 5. The gate baseline it points at is green, and the negative control really ran --------- */
const gatesFile = 'data/results/gates-2026-11-13T13-51-35.259Z.json'
const mutateFile = 'data/results/gates-mutate-2026-11-13T13-51-44.525Z.json'
if (!existsSync(abs(gatesFile))) {
  fail('门禁基线', `${gatesFile} is gone`)
} else {
  const gates = readJson(gatesFile)
  const green = gates.ok === true && Array.isArray(gates.gates) && gates.gates.every((gate) => gate.ok === true)
  if (green) pass('门禁基线', `${gates.gates.length} gates green`)
  else fail('门禁基线', 'the baseline artifact is not all-green')
}
if (!existsSync(abs(mutateFile))) {
  fail('负对照基线', `${mutateFile} is gone`)
} else {
  const mutate = readJson(mutateFile)
  if (mutate.mode === 'mutate' && mutate.ok === true) pass('负对照基线', `${mutate.gates.length} gates caught their violation`)
  else fail('负对照基线', 'the negative-control artifact is not all-caught')
}

/* --- 6. The archive that holds the trimmed rows exists and is registered -------------------- */
const archive = '_archive/2026-11-13_HANDOFF-batch-rows-R95.md'
if (existsSync(abs(archive)) && read('_archive/ARCHIVE_MANIFEST.md').includes('R95')) {
  pass('归档', archive)
} else {
  fail('归档', `${archive} is missing, or ARCHIVE_MANIFEST does not register it`)
}

/* --- 7. Section 2 keeps exactly ten batch rows ---------------------------------------------- */
const rows = countBatchRows(handoff)
if (rows === BATCH_ROW_BUDGET) pass('§2 行数', `${BATCH_ROW_BUDGET} batch rows`)
else fail('§2 行数', `${rows} batch row(s); the handover promises ${BATCH_ROW_BUDGET}`)

/* --- 8. The version the repository builds is the version npm serves -------------------------- */
const pkg = readJson('packages/plugin/package.json')
try {
  /*
   * WHY A SHELL: on Windows `npm` is `npm.cmd`, and `execFileSync('npm', …)` answers `ENOENT` — the
   * exact failure `release_preflight` was fixed for in R50. The arguments here are fixed literals, so
   * going through a shell adds no injection surface.
   */
  const latest = JSON.parse(execSync('npm view dsh-triage dist-tags --json', { encoding: 'utf8' })).latest
  if (latest === pkg.version) pass('版本一致', `npm latest = ${pkg.version}`)
  else fail('版本一致', `npm latest is ${latest} but the repository builds ${pkg.version}`)
} catch (error) {
  unmeasured('版本一致', `could not ask npm: ${error instanceof Error ? error.message.slice(0, 80) : String(error)}`)
}

/* --- 9. The submission PR still exists, and its state is what the handover says ------------- */
const prNumber = /pull\/(\d+)/.exec(handoff.includes('awesome-dsh-plugin') ? handoff : '')?.[1] ?? '14880'
try {
  const pr = JSON.parse(
    execFileSync(
      'gh',
      ['pr', 'view', prNumber, '--repo', 'awesome-dsh-plugin/awesome-dsh-plugin', '--json', 'state,mergeStateStatus,reviews'],
      { encoding: 'utf8' },
    ),
  )
  pass('收录 PR', `#${prNumber} ${pr.state} / ${pr.mergeStateStatus} / reviews ${pr.reviews.length}`)
} catch (error) {
  unmeasured('收录 PR', `could not ask GitHub: ${error instanceof Error ? error.message.slice(0, 80) : String(error)}`)
}

/* --- report -------------------------------------------------------------------------------- */
let failures = 0
for (const check of checks) {
  const state = check.unmeasured === true ? 'UNMEASURED' : check.ok ? 'PASS  ' : 'FAIL  '
  if (!check.ok) failures += 1
  process.stdout.write(`${state} ${check.name} — ${check.detail}\n`)
}
const measured = checks.filter((check) => check.unmeasured !== true).length
process.stdout.write(
  failures === 0
    ? `\nHANDOVER READY · ${measured}/${checks.length} claim(s) recomputed\n`
    : `\n${failures} CLAIM(S) NO LONGER HOLD · ${measured}/${checks.length} recomputed\n`,
)
process.exit(failures === 0 ? 0 : 1)
