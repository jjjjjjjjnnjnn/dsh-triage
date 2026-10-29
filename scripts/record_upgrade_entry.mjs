#!/usr/bin/env node
/**
 * Record the two new entry points of `upgrade` against the real registry and the real sandbox
 * profile (`docs/specs/M6-upgrade-day.md` C8 / C9 / C10, `T-806` / `T-807` / `T-808`).
 *
 * WHY A RECORDER AND NOT MORE UNIT TESTS: the interesting claims are all about the *seam* —
 * "the value we judged is verbatim what npm's `dist-tags` said", "an unreachable registry produces
 * no bucket", "the file on disk is byte-identical to what a bare `--card` prints". A unit test can
 * pin the resolver; only a real run pins the seam.
 *
 * WHAT IT DOES
 *   1. reads `@deepseek-ai/dsh` from npm **itself** (not through the CLI), so the comparison has two
 *      independent sides, and caches the raw answer under `data/fixtures/`;
 *   2. runs `upgrade` with no `--to` three ways (live / no network / no profile) and asserts the
 *      guidance never invents a version and never produces a bucket;
 *   3. runs `--to next` and `--to latest` live, then **re-judges the same composition with the
 *      resolved exact version** and asserts every bucket and count is identical — a dist-tag decides
 *      which version is judged, never how;
 *   4. runs `--to next` with no network (exit 3, no stdout) and `--to canary` (exit 2, no lookup);
 *   5. runs `--card --out` and asserts: same sha256 as stdout, refusing to overwrite (exit 2), an
 *      unwritable target (exit 3, no temp file left), and a relative path when the file is under
 *      the working directory.
 *
 *   node scripts/record_upgrade_entry.mjs --stamp 2026-10-29T14:00:00.000Z \
 *     [--profile upstream] [--dsh-home sandbox/upstream/0.2.1-rc.4/home]
 *
 * OFFLINE RECOMPUTE (only the network-derived claims):
 *   node scripts/record_upgrade_entry.mjs --stamp <ISO> --fixtures data/fixtures/upgrade-entry/<stamp>
 *     [--artifact data/results/upgrade-entry-<stamp>.json]
 *
 * Exit codes: 0 all checks passed · 1 a check failed (artifact written first) · 2 bad usage / refusing
 * to overwrite / missing inputs.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { loadEnv } from '../packages/core/dist/index.js'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const rawStamp = argOf('--stamp', null)
const stamp = rawStamp === null ? null : isoStamp(String(rawStamp))
if (stamp === null) {
  process.stderr.write(
    'usage: node scripts/record_upgrade_entry.mjs --stamp <ISO> [--profile <name>] [--dsh-home <path>] [--out <dir>] [--fixtures <dir>] [--artifact <file>]\n',
  )
  process.exit(2)
}

const profile = String(argOf('--profile', 'upstream'))
const dshHome = pathFor(String(argOf('--dsh-home', 'sandbox/upstream/0.2.1-rc.4/home')))
const outDir = pathFor(String(argOf('--out', 'data/results')))
const fixturesDir = pathFor(String(argOf('--fixtures', join('data/fixtures/upgrade-entry', stamp.replaceAll(':', '-')))))
const offline = argOf('--fixtures', null) !== null
const cli = abs('packages/plugin/dist/cli.js')
const DSH_PACKAGE = '@deepseek-ai/dsh'

const checks = []
const check = (id, ok, detail) => {
  checks.push({ id, ok: Boolean(ok), detail })
  return ok
}

/* ------------------------------------------------------------- redaction */

const HOME_PATTERNS = [
  /[A-Za-z]:\\Users\\[^\\\s]+/g,
  /\/home\/[a-z0-9._-]+/gi,
  /\/Users\/[A-Za-z0-9._-]+/g,
  /[A-Za-z]-Users-[A-Za-z0-9._-]{2,}/g,
]
const REPO = abs('.')
const TEMP = tmpdir()

/** Nothing that lands in `data/results/` may carry a home path (`results-privacy` gate). */
function scrub(value) {
  let text = String(value)
  for (const [root, label] of [
    [dshHome, '<dsh-home>'],
    [REPO, '<repo>'],
    [TEMP, '<tmp>'],
    [homedir(), '<home>'],
  ]) {
    if (typeof root === 'string' && root.length > 3) text = text.split(root).join(label)
    text = text.split(root.replaceAll('\\', '/')).join(label)
  }
  for (const pattern of HOME_PATTERNS) text = text.replace(pattern, '<home>')
  return text
}

/* ------------------------------------------------------------ offline mode */

if (offline) {
  const cachePath = join(fixturesDir, 'dsh-dist-tags.json')
  if (!existsSync(cachePath)) {
    process.stderr.write(`missing cached registry answer: ${cachePath}\n`)
    process.exit(2)
  }
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
  const tags = cache.body?.['dist-tags'] ?? {}
  const artifactArg = argOf('--artifact', null)
  const artifactPath =
    artifactArg !== null
      ? pathFor(String(artifactArg))
      : (() => {
          const candidates = existsSync(outDir)
            ? readdirSync(outDir)
                .filter((name) => name.startsWith('upgrade-entry-') && name.endsWith('.json'))
                .sort()
            : []
          return candidates.length === 0 ? null : join(outDir, candidates[candidates.length - 1])
        })()
  if (artifactPath === null || !existsSync(artifactPath)) {
    process.stderr.write('no upgrade-entry artifact to recompute; pass --artifact <file>\n')
    process.exit(2)
  }
  const artifactText = readFileSync(artifactPath, 'utf8')
  const artifact = JSON.parse(artifactText)
  const sibling = `${artifactPath}.sha256`
  const recorded = artifact.registry ?? {}

  check(
    'recompute-artifact-sha256',
    existsSync(sibling) && readFileSync(sibling, 'utf8').trim() === sha256(artifactText),
    existsSync(sibling) ? 'the artifact still matches its recorded sha256' : 'no sibling .sha256',
  )
  check(
    'recompute-resolved-equals-cache',
    recorded.dist_tags?.next === tags.next && recorded.dist_tags?.latest === tags.latest,
    `cached next=${tags.next ?? '—'} latest=${tags.latest ?? '—'}`,
  )
  const nextRun = (artifact.runs ?? []).find((run) => run.id === 'tag-next')
  check(
    'recompute-tag-version-equals-cache',
    nextRun !== undefined && nextRun.dist_tag_version === tags.next,
    `artifact judged ${nextRun?.dist_tag_version ?? '—'} for "next"`,
  )

  const passed = checks.every((entry) => entry.ok)
  const text = `${JSON.stringify(
    {
      schema_version: 1,
      produced_by: 'scripts/record_upgrade_entry.mjs',
      generated_at: stamp,
      offline_recompute: true,
      inputs: {
        fixture: scrub(join('data/fixtures/upgrade-entry', stamp.replaceAll(':', '-'), 'dsh-dist-tags.json')),
        artifact: scrub(artifactPath),
      },
      checks,
      passed,
      limits: [
        'only the network-derived claims are re-derived here (the resolved value is verbatim what npm said); the CLI runs are not re-executed offline',
        'the guidance and card checks are deterministic given a profile and a version, and are covered by tests/e2e/upgrade-cli.test.ts',
      ],
    },
    null,
    2,
  )}\n`
  mkdirSync(outDir, { recursive: true })
  const fileName = `upgrade-entry-recompute-${stamp.replaceAll(':', '-')}.json`
  const targetPath = join(outDir, fileName)
  if (existsSync(targetPath)) {
    process.stderr.write(`refusing to overwrite existing evidence: ${fileName}\n`)
    process.exit(2)
  }
  writeFileSync(targetPath, text, 'utf8')
  writeFileSync(`${targetPath}.sha256`, `${sha256(text)}\n`, 'utf8')
  process.stdout.write(`upgrade entry · recompute ${fileName}\n`)
  for (const entry of checks) process.stdout.write(`  ${entry.ok ? 'PASS' : 'FAIL'}  ${entry.id} — ${entry.detail}\n`)
  process.exit(passed ? 0 : 1)
}

/* --------------------------------------------------------------- live mode */

if (!existsSync(cli)) {
  process.stderr.write(`missing ${cli}: run \`pnpm build\` first\n`)
  process.exit(2)
}
if (!existsSync(dshHome)) {
  process.stderr.write(`missing dsh home ${dshHome}: run \`node scripts/bootstrap_upstream.mjs\` first\n`)
  process.exit(2)
}

const NO_NETWORK = { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' }

const run = (args, options = {}) => {
  const child = spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd ?? abs('.'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, DSH_TRIAGE_LOCALE: 'zh', ...(options.env ?? {}) },
    timeout: 300_000,
  })
  return { status: child.status, stdout: child.stdout ?? '', stderr: child.stderr ?? '' }
}

const base = ['--dsh-home', dshHome, '--profile', profile]
const runs = []
const record = (id, args, result, extra = {}) => {
  runs.push({
    id,
    command: scrub(['dsh-triage', ...args].join(' ')),
    exit: result.status,
    stdout_bytes: Buffer.byteLength(result.stdout, 'utf8'),
    stderr_head: scrub(result.stderr).split('\n').slice(0, 4).join('\n').slice(0, 600),
    ...extra,
  })
  return result
}

/* 1. Independent registry read: the other side of "verbatim". */
const registryUrl = `https://registry.npmjs.org/${DSH_PACKAGE.replace('/', '%2F')}`
let registry = null
try {
  const response = await fetch(registryUrl, { headers: { accept: 'application/json' } })
  const text = await response.text()
  const body = JSON.parse(text)
  registry = { url: registryUrl, status: response.status, fetched_at: stamp, body: { 'dist-tags': body['dist-tags'] ?? {} } }
} catch (error) {
  registry = { url: registryUrl, status: 0, fetched_at: stamp, error: scrub(error instanceof Error ? error.message : String(error)) }
}
const distTags = registry.body?.['dist-tags'] ?? {}
check(
  'registry-answers',
  registry.status === 200 && typeof distTags.next === 'string' && typeof distTags.latest === 'string',
  `status ${registry.status} · next ${distTags.next ?? '—'} · latest ${distTags.latest ?? '—'}`,
)
if (registry.status !== 200) {
  // A missing registry is a missing input, not a failed check: the live half cannot be recorded at
  // all, and writing an artifact with every seam-check failed would look like a finding.
  process.stderr.write(`the registry did not answer (${registry.status}); the live half cannot be recorded\n`)
  process.exit(2)
}

const envReading = await loadEnv({ dshHome, profile })
const currentRuntime = envReading.ok ? envReading.value.dsh : null
check('profile-is-readable', envReading.ok, envReading.ok ? `dsh ${String(currentRuntime)}` : envReading.error.detail)

/* 2. Guidance, three paths (M6 C8). */
const guidance = record('guidance-live', ['upgrade', ...base], run(['upgrade', ...base]))
check('guidance-exit-2', guidance.status === 2, `exit ${String(guidance.status)} (no target is a usage error)`)
check('guidance-stdout-empty', guidance.stdout.trim() === '', 'stdout stays empty: guidance is not a report')
check(
  'guidance-current-equals-profile',
  currentRuntime !== null && guidance.stderr.includes(`${currentRuntime} · profile ${profile}`),
  `expected the running runtime ${String(currentRuntime)} next to profile ${profile}`,
)
check(
  'guidance-targets-equal-registry',
  guidance.stderr.includes(`next ${distTags.next}`) && guidance.stderr.includes(`latest ${distTags.latest}`),
  `expected next ${distTags.next} · latest ${distTags.latest}`,
)

const guidanceNoNetwork = record(
  'guidance-no-network',
  ['upgrade', ...base],
  run(['upgrade', ...base], { env: NO_NETWORK }),
)
check('guidance-no-network-exit-2', guidanceNoNetwork.status === 2, `exit ${String(guidanceNoNetwork.status)}`)
check(
  'guidance-no-network-does-not-guess',
  /未知|unknown/i.test(guidanceNoNetwork.stderr) && !/next \d+\.\d+\.\d+/.test(guidanceNoNetwork.stderr),
  'an unreachable registry says "unknown" and names no version (M6 N8)',
)

const guidanceNoProfile = record(
  'guidance-no-profile',
  ['upgrade', '--dsh-home', dshHome, '--profile', 'does-not-exist'],
  run(['upgrade', '--dsh-home', dshHome, '--profile', 'does-not-exist'], { env: NO_NETWORK }),
)
check('guidance-no-profile-exit-2', guidanceNoProfile.status === 2, `exit ${String(guidanceNoProfile.status)}`)
check(
  'guidance-no-profile-says-unknown',
  /读不到|unknown/i.test(guidanceNoProfile.stderr) && /profile-not-found/.test(guidanceNoProfile.stderr),
  'an unreadable profile is never reported as a version',
)

/* 3. Dist-tag keywords (M6 C9). */
const readJson = (result) => {
  try {
    return JSON.parse(result.stdout)
  } catch {
    return null
  }
}

const nextRun = record('tag-next', ['upgrade', '--to', 'next', ...base, '--json'], run(['upgrade', '--to', 'next', ...base, '--json']))
const nextJson = readJson(nextRun)
if (nextJson !== null) runs[runs.length - 1].dist_tag_version = nextJson.dist_tag?.version ?? null
check('tag-next-exit-0', nextRun.status === 0 && nextJson !== null, `exit ${String(nextRun.status)}`)
check(
  'tag-next-resolved-verbatim',
  nextJson !== null && nextJson.dist_tag?.version === distTags.next && nextJson.target === distTags.next,
  `judged ${nextJson?.target ?? '—'} · registry said ${distTags.next}`,
)
check('tag-next-declares-its-source', nextJson?.target_source === 'dist-tag', `target_source ${String(nextJson?.target_source)}`)

// The same composition, judged with the resolved exact version: every bucket and count must match.
const explicitRun = record(
  'tag-next-as-explicit-version',
  ['upgrade', '--to', String(distTags.next), ...base, '--json'],
  run(['upgrade', '--to', String(distTags.next), ...base, '--json']),
)
const explicitJson = readJson(explicitRun)
check(
  'tag-next-does-not-move-a-bucket',
  explicitJson !== null &&
    nextJson !== null &&
    JSON.stringify(explicitJson.counts) === JSON.stringify(nextJson.counts) &&
    explicitJson.target_source === 'explicit',
  'a dist-tag decides which version is judged, never how it is bucketed',
)

const latestRun = record('tag-latest', ['upgrade', '--to', 'latest', ...base, '--json'], run(['upgrade', '--to', 'latest', ...base, '--json']))
const latestJson = readJson(latestRun)
check(
  'tag-latest-resolved-verbatim',
  latestRun.status === 0 && latestJson !== null && latestJson.dist_tag?.version === distTags.latest,
  `judged ${latestJson?.target ?? '—'} · registry said ${distTags.latest}`,
)

const tagNoNetwork = record(
  'tag-no-network',
  ['upgrade', '--to', 'next', ...base, '--json'],
  run(['upgrade', '--to', 'next', ...base, '--json'], { env: NO_NETWORK }),
)
check('tag-no-network-exit-3', tagNoNetwork.status === 3, `exit ${String(tagNoNetwork.status)}`)
check('tag-no-network-no-bucket', tagNoNetwork.stdout.trim() === '', 'a failed resolution produces no report at all')

const unknownKeyword = record(
  'tag-unknown-keyword',
  ['upgrade', '--to', 'canary', ...base, '--json'],
  run(['upgrade', '--to', 'canary', ...base, '--json'], { env: NO_NETWORK }),
)
check(
  'tag-unknown-keyword-is-usage-not-lookup',
  unknownKeyword.status === 2 && /exact semver version/.test(unknownKeyword.stderr),
  `exit ${String(unknownKeyword.status)}: an unknown word never becomes a registry read`,
)

/* 4. Card landing on disk (M6 C10). */
const cardStamp = stamp
const exactTarget = String(distTags.next)
const cardBase = ['upgrade', '--to', exactTarget, ...base, '--stamp', cardStamp]
const cardPlain = record('card-stdout', [...cardBase, '--card'], run([...cardBase, '--card']))
check('card-plain-exit-0', cardPlain.status === 0, `exit ${String(cardPlain.status)}`)

const scratchRoot = join(tmpdir(), `dsh-triage-card-${process.pid}`)
mkdirSync(join(scratchRoot, 'nested'), { recursive: true })
const cardFile = join(scratchRoot, 'nested', 'card.md')
const cardOut = record('card-out', [...cardBase, '--card', '--out', scrub(cardFile)], run([...cardBase, '--card', '--out', cardFile], { cwd: scratchRoot }))
check('card-out-exit-0', cardOut.status === 0, `exit ${String(cardOut.status)}`)
check(
  'card-out-prints-a-relative-path',
  cardOut.stdout.trim() === join('nested', 'card.md'),
  `stdout was "${cardOut.stdout.trim()}"`,
)
const onDisk = existsSync(cardFile) ? readFileSync(cardFile, 'utf8') : null
check(
  'card-out-matches-stdout',
  onDisk !== null && sha256(onDisk) === sha256(cardPlain.stdout),
  onDisk === null ? 'no file was written' : `sha256 ${sha256(onDisk).slice(0, 12)}…`,
)

const overwrite = record('card-out-overwrite', [...cardBase, '--card', '--out', '<tmp>/nested/card.md'], run([...cardBase, '--card', '--out', cardFile], { cwd: scratchRoot }))
check('card-out-refuses-overwrite', overwrite.status === 2 && /refusing to overwrite/.test(overwrite.stderr), `exit ${String(overwrite.status)}`)
check(
  'card-out-overwrite-keeps-bytes',
  existsSync(cardFile) && sha256(readFileSync(cardFile, 'utf8')) === sha256(cardPlain.stdout),
  'the refusal must not touch the existing file',
)

// Windows does not enforce a read-only *directory* for its owner, so the honest equivalent is a
// parent path that cannot be a directory (it is a regular file). Nothing half-written may survive.
const blocker = join(scratchRoot, 'blocker')
writeFileSync(blocker, 'not a directory\n')
const unwritable = record(
  'card-out-unwritable',
  [...cardBase, '--card', '--out', '<tmp>/blocker/card.md'],
  run([...cardBase, '--card', '--out', join(blocker, 'card.md')], { cwd: scratchRoot }),
)
check('card-out-unwritable-exit-3', unwritable.status === 3, `exit ${String(unwritable.status)}`)
const leftovers = readdirSync(scratchRoot).filter((name) => name.includes('.tmp-'))
check(
  'card-out-unwritable-leaves-nothing',
  leftovers.length === 0 && !existsSync(join(blocker, 'card.md')),
  leftovers.length === 0 ? 'no temp file, no partial card' : `left behind: ${leftovers.join(', ')}`,
)

/* 5. Cache the raw registry answer so the network-derived claim can be re-derived offline. */
mkdirSync(fixturesDir, { recursive: true })
const cachePath = join(fixturesDir, 'dsh-dist-tags.json')
if (existsSync(cachePath)) {
  process.stderr.write(`refusing to overwrite cached registry answer: ${scrub(cachePath)}\n`)
} else {
  writeFileSync(cachePath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
}

const passed = checks.every((entry) => entry.ok)
const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_upgrade_entry.mjs',
  generated_at: stamp,
  inputs: {
    profile,
    dsh_home: '<dsh-home>',
    current_runtime: currentRuntime,
    locale: 'zh',
    fixtures: scrub(join('data/fixtures/upgrade-entry', stamp.replaceAll(':', '-'))),
    card_target: exactTarget,
    card_sha256: sha256(cardPlain.stdout),
    card_bytes: Buffer.byteLength(cardPlain.stdout, 'utf8'),
  },
  registry: {
    package: DSH_PACKAGE,
    url: registry.url,
    status: registry.status,
    fetched_at: registry.fetched_at,
    dist_tags: distTags,
  },
  runs,
  checks,
  passed,
  limits: [
    'the registry answer is a snapshot: `--fixtures` re-derives only the claims that depend on it',
    'tag-missing and tag-not-exact are covered by tests/unit/upgrade-target.test.ts: the live registry publishes both tags, so a real-run witness for those refusals does not exist yet',
    'the profile is the in-repo sandbox (0.2.1-rc.4), not a user machine',
    '`improved` is still only witnessed in the downgrade geometry (BS-42); nothing here changes that',
    'an unwritable *directory* cannot be simulated on Windows for its owner, so the negative control uses a parent path that is a regular file (ENOTDIR/EEXIST) instead',
  ],
}

const text = `${JSON.stringify(artifact, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const fileName = `upgrade-entry-${stamp.replaceAll(':', '-')}.json`
const targetPath = join(outDir, fileName)
if (existsSync(targetPath)) {
  process.stderr.write(`refusing to overwrite existing evidence: ${fileName}\n`)
  process.exit(2)
}
writeFileSync(targetPath, text, 'utf8')
writeFileSync(`${targetPath}.sha256`, `${sha256(text)}\n`, 'utf8')

process.stdout.write(`upgrade entry · ${fileName}\n`)
process.stdout.write(`  registry next ${distTags.next} · latest ${distTags.latest} · profile ${profile}\n`)
process.stdout.write(`  ${checks.filter((entry) => entry.ok).length}/${checks.length} checks · sha256 ${sha256(text).slice(0, 12)}…\n`)
for (const entry of checks.filter((candidate) => !candidate.ok)) process.stdout.write(`  FAIL ${entry.id} — ${entry.detail}\n`)
process.exit(passed ? 0 : 1)
