#!/usr/bin/env node
/**
 * Publish the format-1 market index at a stable URL (T-403 residual: "托管成 URL").
 *
 * WHY THIS IS SEPARATE FROM `record_index_source.mjs`: generating + validating the document is one
 * claim ("the market's own validator accepts these bytes"); PUTTING IT SOMEWHERE A STRANGER CAN
 * FETCH is a different claim, and it needs its own evidence — a URL nobody verified is a hope.
 *
 * WHAT IT DOES, IN ORDER:
 *   1. reads the newest (or `--artifact`) validated index artifact and refuses anything whose
 *      `validation.status` is not `passed` (an unvalidated document is not publishable);
 *   2. writes the document, byte for byte as recorded, to `docs/market/index.json` (the canonical
 *      copy inside the repo, so the published bytes are reviewable in git);
 *   3. optionally uploads it as a PUBLIC gist (`--gist`) — a real public HTTPS URL that needs no
 *      repository visibility change — and then FETCHES that URL back, comparing bytes.
 *
 * WHY A GIST AND NOT RAW GITHUB: the repository is still private, so a `raw.githubusercontent.com`
 * URL answers 404 to everyone else. A gist is public immediately, serves `text/plain` with CORS `*`,
 * and is reproducible from the same document. The trade-off is recorded in `limits`: a gist is not a
 * site, has no uptime promise, and the URL changes if the document is re-published.
 *
 *   node scripts/publish_index_source.mjs --base-url https://triage.invalid/index.json --gist --stamp 2026-10-29T18:10:00.000Z
 *
 * Exit codes: 0 published and verified · 1 the document failed a check · 2 bad usage · 3 upload failed.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
const outDir = pathFor(argOf('--out', 'data/results'))
const repoCopy = pathFor(argOf('--repo-copy', 'docs/market/index.json'))
const validatorDir = pathFor(
  argOf('--validator', 'sandbox/upstream/0.2.1-rc.4/install/node_modules/@deepseek-ai/dsh-plugin-market-index'),
)
const wantGist = argv.includes('--gist')
if (stamp === null) {
  process.stderr.write('usage: node scripts/publish_index_source.mjs [--artifact <file>] [--gist] [--stamp <iso>]\n')
  process.exit(2)
}

/** Newest validated index artifact, unless the caller named one. */
function newestArtifact() {
  const dir = pathFor('data/results')
  const candidates = readdirSync(dir)
    .filter((name) => /^index-source-.*\.json$/.test(name))
    .sort()
    .reverse()
  if (candidates.length === 0) return null
  return join(dir, candidates[0])
}

const artifactPath = pathFor(String(argOf('--artifact', newestArtifact() ?? '')))
if (artifactPath === '' || !existsSync(artifactPath)) {
  process.stderr.write('no index-source artifact: run scripts/record_index_source.mjs first\n')
  process.exit(2)
}
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
if (artifact.validation?.status !== 'passed') {
  process.stderr.write(`refusing to publish: validation is "${String(artifact.validation?.status)}", not passed\n`)
  process.exit(1)
}

/* ------------------------------- the document ------------------------------- */

const document = artifact.document
const documentText = `${JSON.stringify(document, null, 2)}\n`
/** The digest the generating artifact recorded, recomputed the way it was computed there. */
const recomputed = createHash('sha256').update(JSON.stringify(document)).digest('hex')
if (recomputed !== artifact.document_sha256) {
  process.stderr.write(`refusing to publish: the document drifted from its record (${recomputed} vs ${artifact.document_sha256})\n`)
  process.exit(1)
}

mkdirSync(resolve(repoCopy, '..'), { recursive: true })
writeFileSync(repoCopy, documentText, 'utf8')

/*
 * Re-validate the exact bytes we are about to publish, with the market's own validator. Validating
 * the in-memory object and then publishing a re-serialized file would be two documents; this is one.
 */
let revalidation = { status: 'unmeasured', detail: 'validator absent', plugins: null }
if (existsSync(join(validatorDir, 'lib', 'index.js'))) {
  try {
    const module = await import(pathToFileURL(join(validatorDir, 'lib', 'index.js')).href)
    const parsed = module.parseMarketIndex(JSON.parse(documentText), String(argOf('--base-url', 'https://triage.invalid/index.json')))
    revalidation = { status: 'passed', detail: 'the published bytes parse with the upstream validator', plugins: parsed.plugins.length }
  } catch (error) {
    revalidation = { status: 'failed', detail: error instanceof Error ? error.message : String(error), plugins: null }
  }
}

/* -------------------------------- the hosting ------------------------------- */

const publish = { storage: 'repo-only', verified: false, gist_url: null, raw_url: null, upload: null, fetch: null }

if (wantGist) {
  const login = spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8', windowsHide: true })
  if (login.status !== 0 || login.stdout.trim() === '') {
    process.stderr.write(`gh is not usable for uploading: ${String(login.stderr).slice(-300)}\n`)
    process.exit(3)
  }
  const created = spawnSync(
    'gh',
    [
      'gist',
      'create',
      '--public',
      '--desc',
      'dsh-triage format-1 market index — only versions a recorded probe reached "go" on',
      repoCopy,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  const text = `${created.stdout ?? ''}${created.stderr ?? ''}`
  const match = /https:\/\/gist\.github\.com\/[^\s]+/.exec(text)
  if (created.status !== 0 || match === null) {
    process.stderr.write(`gist upload failed (exit ${String(created.status)}): ${text.slice(-400)}\n`)
    process.exit(3)
  }
  const gistUrl = match[0]
  const id = gistUrl.split('/').pop()
  const rawUrl = `https://gist.githubusercontent.com/${login.stdout.trim()}/${id}/raw/index.json`
  publish.storage = 'public-gist'
  publish.gist_url = gistUrl
  publish.raw_url = rawUrl
  publish.upload = { exit: created.status, gist_id: id, account: login.stdout.trim() }

  /*
   * Verify by fetching what a stranger would fetch. Gist raw endpoints can lag a second or two, so
   * retry — but a persistent mismatch is a failure, not something to round up to "published".
   */
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(rawUrl, { redirect: 'follow' })
    const body = response.status === 200 ? await response.text() : ''
    const contentType = response.headers.get('content-type')
    const matches = body === documentText
    publish.fetch = {
      status: response.status,
      content_type: contentType,
      bytes: body.length,
      matches_repo_copy: matches,
      cors: response.headers.get('access-control-allow-origin'),
      attempts: attempt + 1,
    }
    if (response.status === 200 && matches) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 1500))
  }
  publish.verified = publish.fetch?.status === 200 && publish.fetch?.matches_repo_copy === true
}

/* --------------------------------- artifact -------------------------------- */

const localBytes = readFileSync(repoCopy)
const payload = {
  schema_version: 1,
  produced_by: 'scripts/publish_index_source.mjs',
  generated_at: stamp,
  source_artifact: {
    path: displayPath(artifactPath),
    sha256: sha256(readFileSync(artifactPath, 'utf8')),
    validated_by: artifact.validation.validator ?? null,
    generated_at: artifact.generated_at ?? null,
  },
  document: {
    path: displayPath(repoCopy),
    sha256: sha256(localBytes.toString('utf8')),
    bytes: localBytes.length,
    plugins: artifact.outcome?.plugins ?? null,
    versions: artifact.outcome?.versions ?? null,
  },
  revalidation,
  publish,
  limits: [
    'the index lists ONLY versions a recorded probe reached "go" on; a package that is absent was never measured here, which is not a judgement',
    'format 1 has no verdict field, so this index filters and never scores; unknown members are dropped by the validator',
    'a public gist is a real HTTPS URL but not a site: no uptime promise, no custom domain, and re-publishing produces a NEW URL',
    'nothing here proves the DSH market UI accepts the URL: adding it in Discover is a separate, human action',
  ],
}

function displayPath(path) {
  const root = abs('.')
  const normalized = path.replaceAll('\\', '/')
  const base = root.replaceAll('\\', '/')
  return normalized.startsWith(base) ? normalized.slice(base.length + 1) : normalized
}

const text = `${JSON.stringify(payload, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const target = join(outDir, `index-hosting-${stamp.replaceAll(':', '-')}.json`)
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

process.stdout.write(
  `${publish.verified ? 'published+verified' : publish.storage} · ${documentText.length}B · ${String(payload.document.plugins)} plugins / ${String(payload.document.versions)} versions\n`,
)
process.stdout.write(`  repo copy ${payload.document.path} · sha ${payload.document.sha256.slice(0, 12)}\n`)
if (publish.raw_url !== null) process.stdout.write(`  url ${publish.raw_url}\n  fetch ${publish.fetch.status} · ${String(publish.fetch.content_type)} · bytes match ${String(publish.fetch.matches_repo_copy)}\n`)
process.stdout.write(`  ${displayPath(target).split('/data/results/').pop()}\n`)
process.exitCode = wantGist && !publish.verified ? 1 : 0
