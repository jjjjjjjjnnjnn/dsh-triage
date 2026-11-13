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
import { assertAscendingIds, insertByEntryId } from './lib/index-order.mjs'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { displayPath } from './lib/evidence.mjs'

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
  how: 'insert one object at its ascending id position in community.json (single source of the Workshop store list and the dsh-market.com manifest)',
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

  /*
   * Insert the entry AT ITS ASCENDING-ID POSITION, then run THEIR gate: the same command their CONTRIBUTING names.
   *
   * WHY NOT `push`: on 2026-11-10 upstream switched `community.json` to "sorted by id" and their gate now answers
   * `community.json: entries must be sorted by id: slumberpavilion comes before dsh-triage`. Appending therefore
   * made this recorder report `rejected` for a perfectly legal entry — a red we caused ourselves (`scripts/lib/index-order.mjs`).
   */
  const indexPath = join(root, 'community.json')
  const entries = JSON.parse(readFileSync(indexPath, 'utf8'))
  const ordered = insertByEntryId(entries, entry)
  assertAscendingIds(ordered)
  const insertIndex = ordered.indexOf(entry)
  if (insertIndex === -1) throw new Error(`inserted entry ${String(entry.id)} is missing from the ordered index`)
  writeFileSync(indexPath, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8')
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
    stdout: String(check.stdout ?? '').trim().slice(0, 600),
    stderr: String(check.stderr ?? '').trim().slice(0, 600),
    entries_after: ordered.length,
    insert_index: insertIndex,
    tests: {
      exit: test.status,
      /*
       * `node --test` now reports `(info) tests 10 / (info) pass 10 / (info) fail 0`; the old `# pass` regex recorded
       * `summary: null` on a run that passed 10 of 10 (2026-11-10). A field that means "the tests passed" must not
       * go null because the reporter changed its prefix, so both forms are accepted and the counts are kept too.
       */
      summary: /(?:#|\u2139) (?:pass \d+[\s\S]*?(?:#|\u2139) fail \d+)/.exec(String(test.stdout ?? ''))?.[0] ?? null,
      counts: /(?:#|\u2139) pass (\d+)[\s\S]*?(?:#|\u2139) fail (\d+)/.exec(String(test.stdout ?? ''))?.slice(1).map(Number) ?? null,
    },
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
    channel: 'awesome-dsh-plugin/awesome-dsh-plugin',
    entry_point: 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin',
    how: 'one PR adding one file: data/plugins/<owner>__<repo>.yml (the two READMEs are generated from it, so a PR never conflicts)',
    requirement:
      'quoted from its contributing.md: package.json must declare `dsh.bundle` (dsh.client alone is not installable), repo at least 1 day old, the `dsh-plugin` topic set, description must be accurate against the code (no superlatives, no counts that do not exist), at most 3 entries per PR, and no meta-packages',
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

/**
 * Read one pull request WITHOUT the operator's token.
 *
 * WHY THIS EXISTS (R93): GitHub's computed mergeability depends on who asks. With our token, PR #65 in
 * `zhu1090093659/dsh-community-plugins` answers `mergeable_state: "blocked"` (the repository's ruleset wants
 * a status check plus the review it is waiting for); the anonymous call to the same URL answers `"clean"`.
 * Recording only the authenticated word would make a vantage-dependent number look like a property of the
 * pull request. Recording both makes the discrepancy visible, which is the honest artifact.
 *
 * Returns `{status, mergeable, mergeable_state, error}`; a failure is data (`error` string), never a throw,
 * because a PR whose anonymous read fails should still be recorded with its authenticated reading.
 */
const readAnonymously = async (owner, repoName, number) => {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/pulls/${String(number)}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-triage' },
    })
    if (response.status !== 200) return { status: response.status, mergeable: null, mergeable_state: null, error: `HTTP ${String(response.status)}` }
    const pull = await response.json()
    return {
      status: 200,
      mergeable: typeof pull.mergeable === 'boolean' ? pull.mergeable : null,
      mergeable_state: pull.mergeable_state ?? null,
      error: null,
    }
  } catch (error) {
    return { status: null, mergeable: null, mergeable_state: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/*
 * Submitted PRs (R38): `--pr channel=<pull-url>` records the LIVE state of each one. A submission is
 * not done because the command exited 0 — an OPEN pull request is, and a closed one is not.
 */
const submitted = []
for (const [index, value] of argv.entries()) {
  if (value !== '--pr') continue
  const spec = String(argv[index + 1] ?? '')
  const match = /^([^=]+)=https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(spec)
  if (match === null) {
    /*
     * A MALFORMED `--pr` USED TO BE RECORDED INSTEAD OF REFUSED (R93): `--pr channel=` (value forgotten)
     * wrote a row whose `channel` was the literal word "channel" and whose `state` was "unparsed", and the
     * artifact still counted it — a wrong reading that looks like a measurement. Bad usage is exit 2 now.
     */
    process.stderr.write(`usage: --pr <channel>=https://github.com/<owner>/<repo>/pull/<number> (got "${spec}")\n`)
    process.exit(2)
  }
  const [, channel, owner, repo, number] = match
  const url = `https://github.com/${owner}/${repo}/pull/${number}`
  const fetched = spawnSync('gh', ['api', `repos/${owner}/${repo}/pulls/${number}`], { encoding: 'utf8', windowsHide: true })
  let state = 'unreadable'
  let detail = {
    title: null,
    changed_files: null,
    additions: null,
    deletions: null,
    base: null,
    head: null,
    merged_at: null,
    mergeable_state: null,
  }
  if (fetched.status === 0) {
    try {
      const pull = JSON.parse(String(fetched.stdout))
      state = String(pull.state ?? 'unknown').toLowerCase()
      detail = {
        title: pull.title ?? null,
        changed_files: pull.changed_files ?? null,
        additions: pull.additions ?? null,
        deletions: pull.deletions ?? null,
        base: pull.base?.ref ?? null,
        head: pull.head?.ref ?? null,
        merged_at: pull.merged_at ?? null,
        mergeable_state: pull.mergeable_state ?? null,
      }
    } catch (error) {
      state = `unparsed-response: ${error instanceof Error ? error.message : String(error)}`
    }
  } else {
    state = `gh-failed: ${String(fetched.stderr ?? '').trim().slice(-120)}`
  }
  /*
   * REVIEW DECISION IS A SEPARATE FACT FROM STATE (R40). `state: open` plus
   * `review_decision: APPROVED` is a different situation from `state: open` with no
   * review — and "approved" is still not "merged", which is the only word that means
   * "listed". The pulls API does not carry it, so ask `gh pr view` for it and record
   * `null` when the question cannot be answered rather than guessing.
   */
  const reviewed = spawnSync('gh', ['pr', 'view', url, '--json', 'reviewDecision,mergeStateStatus,isDraft'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  let review = { review_decision: null, merge_state_status: null, is_draft: null }
  if (reviewed.status === 0) {
    try {
      const fields = JSON.parse(String(reviewed.stdout))
      review = {
        review_decision: fields.reviewDecision === '' ? null : (fields.reviewDecision ?? null),
        merge_state_status: fields.mergeStateStatus ?? null,
        is_draft: typeof fields.isDraft === 'boolean' ? fields.isDraft : null,
      }
    } catch {
      review = { review_decision: null, merge_state_status: null, is_draft: null }
    }
  }
  /*
   * THE SAME PR CAN REPORT TWO DIFFERENT `mergeable_state`s (R93, measured): called with the operator's
   * token, #65 answers `blocked`; called anonymously against the same URL, it answers `clean`. The
   * authenticated view is the one merge actually consults (the ruleset's required status check and the
   * review it demands), so `mergeable_state` stays the authenticated reading — but a reading whose
   * vantage changes the answer must not look unconditional. Both are recorded, and when they disagree
   * the disagreement itself is the field, not a footnote.
   */
  const anonymous = await readAnonymously(owner, repo, number)
  const vantagesDiffer = anonymous.mergeable_state !== null && detail.mergeable_state !== null && anonymous.mergeable_state !== detail.mergeable_state
  submitted.push({
    channel,
    url,
    state,
    ...detail,
    ...review,
    mergeable_state_by_vantage: { authenticated: detail.mergeable_state, anonymous: anonymous.mergeable_state },
    mergeable_state_disagrees: vantagesDiffer,
    anonymous_read: anonymous.error === null ? { mergeable: anonymous.mergeable, http_status: anonymous.status } : { error: anonymous.error },
  })
}

/*
 * Site submissions (R45): dsh.so has no API for "did my submission arrive?". The honest way to
 * record one is:
 *
 *   - the submission itself is a HUMAN action and is recorded as such (`submitted_by`), because a
 *     form POST here cannot be verified by us;
 *   - what CAN be verified is whether the registry already lists the plugin, via its public
 *     per-plugin JSON (`/plugin/@author/<name>.json`). A 404 means "not listed right now" — it is
 *     neither a rejection nor a promise, so the channel status becomes `submitted`, never `listed`
 *     until the probe answers 200.
 */
const siteSubmissions = []
const pluginManifest = JSON.parse(readFileSync(abs('packages/plugin/package.json'), 'utf8'))
for (const [index, value] of argv.entries()) {
  if (value !== '--site') continue
  const spec = String(argv[index + 1] ?? '')
  const [siteChannel, ...who] = spec.split('=')
  if (siteChannel !== 'dsh.so') {
    process.stderr.write(`unsupported site channel "${String(siteChannel)}": only dsh.so has a form without an API\n`)
    process.exit(2)
  }
  const owner = /github\.com[/:]([^/]+)\//.exec(String(pluginManifest.repository?.url ?? ''))?.[1] ?? null
  const pluginName = String(pluginManifest.name ?? '')
  const endpoints = [
    `https://www.dsh.so/plugin/@${String(owner)}/${pluginName}.json`,
    `https://www.dsh.so/artifact/@${String(owner)}/${pluginName}.json`,
    `https://www.dsh.so/data/install/@${String(owner)}/${pluginName}.json`,
  ]
  const probes = []
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { headers: { accept: 'application/json' } })
      probes.push({ endpoint, http_status: response.status, content_type: response.headers.get('content-type') })
      // Drain the body so the connection can be reused; the payload itself is not evidence we keep.
      await response.arrayBuffer()
    } catch (error) {
      probes.push({ endpoint, http_status: null, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const indexed = probes.some((probe) => probe.http_status === 200)
  siteSubmissions.push({
    channel: 'dsh.so',
    submitted_by: who.join('=') || 'human',
    submitted_at: stamp,
    // The reachable entry point, not a receipt: dsh.so files submissions in its own backend.
    entry_point: 'https://dsh.so/submit/',
    indexed,
    index_probe: { checked_at: stamp, endpoints: probes },
  })
  const target = others.find((channel) => channel.channel === 'dsh.so')
  if (target !== undefined) {
    target.status = indexed ? 'listed' : 'submitted'
    target.blocker = null
    target.submission = siteSubmissions.at(-1)
  }
}

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_market_channels.mjs',
  generated_at: stamp,
  prerequisites,
  channels: [...channels, ...others],
  submitted,
  site_submissions: siteSubmissions,
  summary: {
    validated_locally: channels.filter((channel) => channel.status === 'validated').length,
    ready_to_submit: [...channels, ...others].filter((channel) => channel.status === 'validated' || channel.status === 'ready').length,
    live: submitted.filter((pull) => pull.state === 'open').length,
    site_submitted: siteSubmissions.length,
    listed: siteSubmissions.filter((entry) => entry.indexed === true).length,
    one_blocker: publicSourceMissing,
  },
  limits: [
    'running a channel\'s own validator proves the entry is well-formed, NOT that a maintainer will accept it',
    'submitting is a pull request, not a merge: `live` counts OPEN pulls, and a maintainer can still decline them',
    'a site submission (dsh.so) has **no machine-verifiable receipt**: what is recorded is the human report plus a live probe of the registry\'s per-plugin JSON. `indexed: false` means "not listed right now", not "rejected"',
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
process.stdout.write(`  ${displayPath(target)}\n`)
process.exitCode = channels.some((channel) => channel.status === 'rejected') ? 1 : 0
