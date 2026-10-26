#!/usr/bin/env node
/**
 * Record one real-world case as hash-locked SSOT (T-101).
 *
 * A case is a directory under `data/cases/<ID>/` that holds:
 *   - `case.json`               provenance + the machine-checkable label
 *   - `profile-package.json`    the reproduced profile manifest
 *   - `profile-cordis.patch.yml` the reproduced patch rows
 *   - `runtime-dsh.json`        the real published manifest of the running dsh
 *   - `plugin-*.json`           the real published manifests of the rows' modules
 *
 * The script materialises those inputs into an isolated `$DSH_HOME` under the
 * system temp directory, computes verdicts with the same engine the CLI uses,
 * and writes `data/results/why-case-<ID>-<stamp>.json` + `.sha256`.
 *
 *   node scripts/record_case.mjs --case CASE-11080
 *   node scripts/record_case.mjs --case CASE-11080 --stamp 2026-10-26T00:00:00.000Z --keep
 *
 * Rules honoured here: never writes to a real profile, never reads credentials,
 * redacts every path that reaches disk, and never upgrades a `miss` to a `hit`.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { abs, fileUrl, isoStamp, sha256 } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const caseId = argOf('--case', null)
const rawStamp = argOf('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
const keepSandbox = argv.includes('--keep')

if (caseId === null || caseId.trim() === '') {
  process.stderr.write('usage: node scripts/record_case.mjs --case <ID> [--stamp <iso>] [--keep]\n')
  process.exit(2)
}
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601, e.g. 2026-10-26T00:00:00.000Z\n`)
  process.exit(2)
}

const caseDir = `data/cases/${caseId}`
let spec
try {
  spec = JSON.parse(readFileSync(abs(join(caseDir, 'case.json')), 'utf8'))
} catch (error) {
  process.stderr.write(`cannot read ${caseDir}/case.json: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}

const core = await import(fileUrl('packages/core/dist/index.js'))
const plugin = await import(fileUrl('packages/plugin/dist/load.js'))

/**
 * Two shapes of case:
 *  - `profile`   an existing installation (default): reproduce the declared layer
 *                and run the full `why` engine (bundle + row + collision).
 *  - `candidate` a pre-install rejection (`dsh plugin add` refused): there is no
 *                profile row, so the verdict is admission on the candidate manifest.
 */
const mode = spec.mode === 'candidate' ? 'candidate' : 'profile'

/* ------------------------------ sandbox build ------------------------------ */

const sandbox = join(tmpdir(), 'dsh-triage-case', caseId)
rmSync(sandbox, { recursive: true, force: true })
const dshHome = join(sandbox, 'home')
const profileName = spec.profile?.name ?? caseId.toLowerCase()
const profileDir = join(dshHome, 'profiles', profileName)

mkdirSync(profileDir, { recursive: true })
mkdirSync(join(dshHome, 'profiles', 'node_modules'), { recursive: true })

const inputs = []
const readInput = (fileName) => {
  if (typeof fileName !== 'string') throw new Error(`case.json references a missing input file: ${String(fileName)}`)
  const text = readFileSync(abs(join(caseDir, fileName)), 'utf8')
  inputs.push({ file: `${caseDir}/${fileName}`, sha256: sha256(text) })
  return text
}

/** Write one published manifest into the layout a real import would resolve. */
const installManifest = (fileName) => {
  const text = readInput(fileName)
  const manifest = JSON.parse(text)
  if (typeof manifest.name !== 'string' || manifest.name === '') {
    throw new Error(`${fileName} has no package name`)
  }
  const dir = join(profileDir, 'node_modules', ...manifest.name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), text, 'utf8')
}

const redactRoots = [homedir(), tmpdir(), sandbox]
let realEnv
let fingerprint
let verdicts = []
let collisions = []
let rows = []
let claims = []
let composition = { layers: [], profilePatch: { text: null }, homePatch: { text: null }, errors: [] }

if (mode === 'profile') {
  writeFileSync(join(profileDir, 'package.json'), readInput(spec.inputs.profile_manifest), 'utf8')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), readInput(spec.inputs.profile_patch), 'utf8')
  installManifest(spec.inputs.runtime_manifest)
  for (const fileName of Object.values(spec.inputs.plugin_manifests ?? {})) installManifest(fileName)
}

/* -------------------------------- verdicts -------------------------------- */

if (mode === 'profile') {
  const env = await core.loadEnv({ dshHome, profile: profileName })
  if (!env.ok) {
    process.stderr.write(`the reproduced profile is unreadable: ${env.error.code} — ${env.error.detail}\n`)
    process.exit(3)
  }
  realEnv = env.value
  fingerprint = core.redactEnv(realEnv, redactRoots)
  composition = await plugin.loadComposition(realEnv, dshHome)

  claims = collectClaims(composition)
  verdicts = composition.layers.map((layer) =>
    core.verdictFromAdmission({
      subject: { name: layer.name, version: layer.version, kind: 'plugin' },
      env: fingerprint,
      admission: core.evaluateAdmission(layer.manifest, realEnv.dsh),
      generatedAt: stamp,
    }),
  )
  collisions = core.findEntryIdCollisions(claims)
  verdicts.push(...core.verdictsFromCollisions({ env: fingerprint, collisions, generatedAt: stamp }))
  rows = await plugin.resolveRows(realEnv, core.rowTargets(claims))
  verdicts.push(...core.verdictsFromRowAdmission({ env: fingerprint, rows, generatedAt: stamp }))
} else {
  // Candidate mode: no installation exists, so there is no profile to read.
  const runtimeText = readInput(spec.inputs.runtime_manifest)
  const runtimeManifest = JSON.parse(runtimeText)
  const runtimeVersion = typeof runtimeManifest.version === 'string' ? runtimeManifest.version : null
  realEnv = {
    dsh: runtimeVersion,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    // The reporter's profile name (so the fix command is copy-pasteable); a
    // candidate has no profile of its own, hence the explicit placeholder.
    profile: spec.reported?.profile ?? '<profile>',
    profileDir: redactRoots[2],
    bundles: [],
    installed: runtimeVersion === null ? [] : [{ name: '@deepseek-ai/dsh', version: runtimeVersion }],
  }
  fingerprint = core.redactEnv(realEnv, redactRoots)

  for (const fileName of Object.values(spec.inputs.plugin_manifests ?? {})) {
    const manifestText = readInput(fileName)
    const manifest = JSON.parse(manifestText)
    verdicts.push(
      core.verdictFromAdmission({
        subject: { name: String(manifest.name), version: typeof manifest.version === 'string' ? manifest.version : null, kind: 'plugin' },
        env: fingerprint,
        admission: core.evaluateAdmission(manifest, runtimeVersion),
        generatedAt: stamp,
      }),
    )
  }
}

function collectClaims(layer) {
  const collected = []
  for (const bundle of layer.layers) {
    if (bundle.patchText === null) continue
    const parsed = core.parsePatchYaml(bundle.patchText)
    if (!parsed.ok) continue
    collected.push(...core.extractEntryClaims(parsed.value, `bundle:${bundle.name}`))
  }
  for (const [text, source] of [
    [layer.profilePatch.text, 'patch:profile'],
    [layer.homePatch.text, 'patch:home'],
  ]) {
    if (text === null) continue
    const parsed = core.parsePatchYaml(text)
    if (!parsed.ok) continue
    collected.push(...core.extractEntryClaims(parsed.value, source))
  }
  return collected
}


/* ------------------------------ hit judgement ------------------------------ */

/**
 * The label is machine-checkable on purpose: a reviewer (or an adversary) can
 * recompute this from the JSON without trusting the prose in `report.md`.
 */
function judgeHit(label) {
  const index = verdicts.findIndex((verdict) => {
    if (verdict.conclusion !== 'blocked' || verdict.subject.name !== label.module) return false
    // A profile case must name the row; a candidate case has no row by definition.
    if (label.entry_id !== undefined) {
      const scope = verdict.reasons.find((reason) => reason.messageId === 'admission.row-scope')
      const rowsNamed = String(scope?.params?.['rows'] ?? '')
        .split(', ')
        .filter((rowId) => rowId !== '')
      if (!rowsNamed.includes(label.entry_id)) return false
    }
    return verdict.reasons.some(
      (reason) => reason.code === label.reason_code && reason.params?.['key'] === label.requirement_key,
    )
  })
  if (index === -1) {
    return {
      verdict: 'miss',
      expected: label,
      matched: null,
      why:
        label.entry_id === undefined
          ? 'no blocked verdict named the labelled module with the labelled unmet requirement'
          : 'no blocked verdict named the labelled row with the labelled unmet requirement',
    }
  }
  const matchedVerdict = verdicts[index]
  return {
    verdict: 'hit',
    expected: label,
    matched: {
      verdict_index: index,
      conclusion: matchedVerdict.conclusion,
      subject: matchedVerdict.subject,
      reasons: matchedVerdict.reasons.map((reason) => ({
        code: reason.code,
        messageId: reason.messageId,
        params: reason.params ?? {},
      })),
    },
    why: 'the labelled target is named and the labelled requirement is the one that failed',
  }
}

const hit = judgeHit(spec.label)
const summary = verdicts.reduce(
  (acc, verdict) => ({ ...acc, [verdict.conclusion]: (acc[verdict.conclusion] ?? 0) + 1 }),
  {},
)

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_case.mjs',
  generated_at: stamp,
  command: mode === 'candidate' ? 'check' : 'why',
  mode,
  status: 'ok',
  case: {
    id: spec.id,
    title: spec.title,
    source: spec.source,
    reported: spec.reported,
    deviations: spec.deviations ?? [],
    reproduced:
      mode === 'candidate'
        ? { runtime: fingerprint.dsh, profile: '(candidate: no installation existed)' }
        : { dsh_home: core.redactPath(dshHome, redactRoots), profile: profileName, bundles: fingerprint.bundles },
  },
  inputs,
  env: fingerprint,
  verdicts: verdicts.map((verdict) => core.redactVerdict(verdict, redactRoots)),
  collisions,
  scanned: { bundles: composition.layers.length, entries: claims.length, rows: rows.length },
  summary,
  hit,
  errors: composition.errors,
}

const fileName = `why-case-${spec.id}-${fileStamp(stamp)}.json`
mkdirSync(abs('data/results'), { recursive: true })
const target = abs(join('data/results', fileName))
const text = `${JSON.stringify(payload, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, sha256(text), 'utf8')

process.stdout.write(
  `case ${spec.id}: ${hit.verdict.toUpperCase()} · ${verdicts.length} verdict(s) · ${rows.length} row(s) · ${JSON.stringify(summary)}\n`,
)
process.stdout.write(`ssot data/results/${fileName} sha256=${sha256(text).slice(0, 12)}…\n`)
for (const verdict of payload.verdicts) {
  process.stdout.write(`${core.renderVerdict(verdict, 'en')}\n\n`)
}

if (!keepSandbox) rmSync(sandbox, { recursive: true, force: true })
else process.stdout.write(`sandbox kept at ${sandbox}\n`)

function fileStamp(iso) {
  return iso.replaceAll(':', '-')
}

void dirname
