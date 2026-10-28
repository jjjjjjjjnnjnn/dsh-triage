#!/usr/bin/env node
/**
 * Record what the distribution channels actually require, and how far we can get TODAY.
 *
 * WHY THIS IS A SCRIPT AND NOT A CHECKLIST: a submission packet that nobody re-ran is prose. This
 * runs the same entry through the CHANNEL'S OWN validator (downloaded from its repository, not
 * re-implemented here) and writes down, per channel, either "ready" or the exact requirement we
 * cannot meet yet — plus the two facts that decide it (`repo private?`, `npm published?`).
 *
 * WHAT IT CANNOT DO: press submit. Every channel below needs either a public source repository or a
 * published npm package; both are recorded here as measured facts rather than assumed.
 *
 *   node scripts/record_market_channels.mjs --stamp 2026-10-29T18:30:00.000Z
 *
 * Exit codes: 0 artifact written · 1 the channel's own validator rejected our entry · 2 bad usage.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
const outDir = pathFor(argOf('--out', 'data/results'))
const entryFile = pathFor(argOf('--entry', 'docs/market/submissions/community-plugins-entry.json'))
const repo = String(argOf('--repo', 'jjjjjjjjnnjnn/dsh-triage'))
const npmName = String(argOf('--npm', 'dsh-triage'))
if (stamp === null) {
  process.stderr.write('usage: node scripts/record_market_channels.mjs [--stamp <iso>] [--repo owner/name]\n')
  process.exit(2)
}
if (!existsSync(entryFile)) {
  process.stderr.write(`no entry file at ${entryFile}\n`)
  process.exit(2)
}

const entry = JSON.parse(readFileSync(entryFile, 'utf8'))
const channels = []

/* --------------------- channel 1: dsh-community-plugins --------------------- */

const COMMUNITY_REPO = 'zhu1090093659/dsh-community-plugins'
const tarballUrl = `https://codeload.github.com/${COMMUNITY_REPO}/tar.gz/refs/heads/main`
const scratch = mkdtempSync(join(tmpdir(), 'triage-channel-'))
const community = {
  channel: 'dsh-community-plugins',
  entry_point: `https://github.com/${COMMUNITY_REPO}`,
  how: 'append one object to community.json (single source of the Workshop store list and the dsh-market.com manifest)',
  source: { tarball: tarballUrl, tarball_sha256: null, package_version: null },
  entry,
  validator: null,
  status: 'unknown',
  blocker: null,
}

try {
  const response = await fetch(tarballUrl, { redirect: 'follow' })
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  community.source.tarball_sha256 = createHash('sha256').update(bytes).digest('hex')
  const archive = join(scratch, 'channel.tgz')
  writeFileSync(archive, bytes)
  const extracted = spawnSync('tar', ['-xzf', archive, '-C', scratch], { encoding: 'utf8', windowsHide: true })
  if (extracted.status !== 0) throw new Error(`tar failed: ${String(extracted.stderr).slice(-200)}`)
  const root = join(scratch, `${COMMUNITY_REPO.split('/')[1]}-main`)
  community.source.package_version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? null

  // Add the entry, then run THEIR gate: the same command their CONTRIBUTING names.
  const indexPath = join(root, 'community.json')
  const entries = JSON.parse(readFileSync(indexPath, 'utf8'))
  if (entries.some((item) => item.id === entry.id)) throw new Error(`entry id ${entry.id} already present upstream`)
  entries.push(entry)
  writeFileSync(indexPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  const check = spawnSync(process.execPath, [join(root, 'scripts', 'community-index.cjs'), '--check'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  const test = spawnSync(process.execPath, ['--test', join(root, 'scripts', 'community-index.test.mjs')], {
    encoding: 'utf8',
    windowsHide: true,
  })
  community.validator = {
    command: 'node scripts/community-index.cjs --check',
    exit: check.status,
    stdout: String(check.stdout ?? '').trim().slice(-300),
    stderr: String(check.stderr ?? '').trim().slice(-300),
    entries_after: entries.length,
    tests: { exit: test.status, summary: /# pass (\d+)[\s\S]*# fail (\d+)/.exec(String(test.stdout ?? ''))?.[0] ?? null },
  }
  community.status = check.status === 0 && test.status === 0 ? 'validated' : 'rejected'
  if (community.status === 'rejected') community.blocker = community.validator.stderr || community.validator.stdout
} catch (error) {
  community.status = 'unmeasured'
  community.blocker = error instanceof Error ? error.message : String(error)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
channels.push(community)

/* ------------------------ the two facts that decide it ---------------------- */

const repoPrivate = spawnSync('gh', ['api', `repos/${repo}`, '--jq', '.private'], { encoding: 'utf8', windowsHide: true })
/*
 * Ask the registry directly instead of `npm view`: the CLI needs no shell (which spawns a
 * DeprecationWarning on Windows) and the HTTP status answers the only question here — is there a
 * published package at all — without requiring the operator to be logged in.
 */
const npmPublished = await (async () => {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(npmName).replace('%40', '@')}`, {
      headers: { accept: 'application/json' },
    })
    if (response.status === 404) return { published: false, version: null, status: 404, detail: 'the registry has no such package' }
    if (response.status !== 200) return { published: null, version: null, status: response.status, detail: `registry answered HTTP ${response.status}` }
    const packument = await response.json()
    return { published: true, version: packument?.['dist-tags']?.latest ?? null, status: 200, detail: null }
  } catch (error) {
    return { published: null, version: null, status: null, detail: error instanceof Error ? error.message : String(error) }
  }
})()
const prerequisites = {
  repo: {
    name: repo,
    private: repoPrivate.status === 0 ? String(repoPrivate.stdout).trim() === 'true' : null,
    detail: repoPrivate.status === 0 ? null : String(repoPrivate.stderr).trim().slice(-200),
  },
  npm: {
    name: npmName,
    published: npmPublished.published,
    version: npmPublished.version,
    registry_status: npmPublished.status,
    detail: npmPublished.detail,
  },
}

/**
 * The other channels, with the requirement each one states in its own contribution rules.
 *
 * WHY THEY ARE `blocked` AND NOT SKIPPED: the same underlying gap (nothing public to link to) keeps
 * them shut, and a reader must be able to see that the blocker is ONE decision, not three bugs.
 */
const publicSourceMissing =
  prerequisites.repo.private === true && prerequisites.npm.published === false
    ? 'the source repository is private and the npm package is not published: every channel below requires at least one public artifact to link to'
    : null

const others = [
  {
    channel: 'dsh-market (Workshop store)',
    entry_point: 'https://github.com/zhu1090093659/dsh-web → community-plugins (channel above)',
    how: 'the store list is generated from community.json, so this channel is closed once channel 1 lands',
    requirement: 'plugin authors register through dsh-community-plugins; direct PRs to dsh-web are restricted to content contributions',
    status: publicSourceMissing === null ? 'ready-after-channel-1' : 'blocked',
    blocker: publicSourceMissing,
  },
  {
    channel: 'awesome-deepseekharness/awesome-deepseek-harness',
    entry_point: 'https://github.com/awesome-deepseekharness/awesome-deepseek-harness',
    how: 'add one line in the plugin section (alphabetical) via PR',
    requirement: 'entry must link a source repository or primary-source page and state DSH compatibility',
    status: publicSourceMissing === null ? 'ready' : 'blocked',
    blocker: publicSourceMissing,
  },
  {
    channel: 'walkinglabs/awesome-deepseek-harness-plugins',
    entry_point: 'https://github.com/walkinglabs/awesome-deepseek-harness-plugins',
    how: 'add one line `- [Project](url) - what it provides and its DSH compatibility.`',
    requirement: 'quoted from its CONTRIBUTING.md: entries must be "publicly accessible and reasonably maintained"',
    status: publicSourceMissing === null ? 'ready' : 'blocked',
    blocker: publicSourceMissing,
  },
  {
    channel: 'dsh.so',
    entry_point: 'https://dsh.so',
    how: 'submission form on the site (no API): needs a published npm package to point at',
    requirement: 'a published package; the site indexes npm metadata',
    status: prerequisites.npm.published === true ? 'ready' : 'blocked',
    blocker:
      prerequisites.npm.published === true
        ? null
        : `no published package: the registry answers ${String(prerequisites.npm.registry_status)} for ${npmName}`,
  },
]

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_market_channels.mjs',
  generated_at: stamp,
  prerequisites,
  channels: [...channels, ...others],
  summary: {
    validated_locally: channels.filter((channel) => channel.status === 'validated').length,
    ready_to_submit: [...channels, ...others].filter((channel) => channel.status === 'validated' || channel.status === 'ready').length,
    live: 0,
    one_blocker: publicSourceMissing,
  },
  limits: [
    'running a channel\'s own validator proves the entry is well-formed, NOT that a maintainer will accept it',
    'nothing here presses submit: `live` stays 0 until either the repository is public or the package is on npm',
    'channel requirements were read from each repository on the day of this artifact; they can change',
    'the tarball hash pins what was validated, not what upstream will look like tomorrow',
  ],
}

const text = `${JSON.stringify(payload, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const target = join(outDir, `market-channels-${stamp.replaceAll(':', '-')}.json`)
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

process.stdout.write(`channels · validated ${payload.summary.validated_locally} · ready ${payload.summary.ready_to_submit} · live ${payload.summary.live}\n`)
for (const channel of payload.channels) {
  process.stdout.write(`  ${String(channel.status).padEnd(20)} ${channel.channel}${channel.blocker === null ? '' : ` — ${String(channel.blocker).slice(0, 120)}`}\n`)
}
process.stdout.write(`  ${target.replaceAll('\\', '/').split('/data/results/').pop()}\n`)
process.exitCode = channels.some((channel) => channel.status === 'rejected') ? 1 : 0
