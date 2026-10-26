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
  const text = readFileSync(abs(join(caseDir, fileName)), 'utf8')
  inputs.push({ file: `${caseDir}/${fileName}`, sha256: sha256(text) })
  return text
}

writeFileSync(join(profileDir, 'package.json'), readInput(spec.inputs.profile_manifest), 'utf8')
writeFileSync(join(profileDir, 'cordis.patch.yml'), readInput(spec.inputs.profile_patch), 'utf8')

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
installManifest(spec.inputs.runtime_manifest)
for (const fileName of Object.values(spec.inputs.plugin_manifests ?? {})) installManifest(fileName)

/* -------------------------------- verdicts -------------------------------- */

const env = await core.loadEnv({ dshHome, profile: profileName })
if (!env.ok) {
  process.stderr.write(`the reproduced profile is unreadable: ${env.error.code} — ${env.error.detail}\n`)
  process.exit(3)
}
const realEnv = env.value
const redactRoots = [homedir(), tmpdir(), dshHome]
const fingerprint = core.redactEnv(realEnv, redactRoots)
const composition = await plugin.loadComposition(realEnv, dshHome)

const claims = []
for (const layer of composition.layers) {
  if (layer.patchText === null) continue
  const parsed = core.parsePatchYaml(layer.patchText)
  if (!parsed.ok) continue
  claims.push(...core.extractEntryClaims(parsed.value, `bundle:${layer.name}`))
}
for (const [text, source] of [
  [composition.profilePatch.text, 'patch:profile'],
  [composition.homePatch.text, 'patch:home'],
]) {
  if (text === null) continue
  const parsed = core.parsePatchYaml(text)
  if (!parsed.ok) continue
  claims.push(...core.extractEntryClaims(parsed.value, source))
}

const verdicts = composition.layers.map((layer) =>
  core.verdictFromAdmission({
    subject: { name: layer.name, version: layer.version, kind: 'plugin' },
    env: fingerprint,
    admission: core.evaluateAdmission(layer.manifest, realEnv.dsh),
    generatedAt: stamp,
  }),
)
const collisions = core.findEntryIdCollisions(claims)
verdicts.push(...core.verdictsFromCollisions({ env: fingerprint, collisions, generatedAt: stamp }))
const rows = await plugin.resolveRows(realEnv, core.rowTargets(claims))
verdicts.push(...core.verdictsFromRowAdmission({ env: fingerprint, rows, generatedAt: stamp }))

/* ------------------------------ hit judgement ------------------------------ */

/**
 * The label is machine-checkable on purpose: a reviewer (or an adversary) can
 * recompute this from the JSON without trusting the prose in `report.md`.
 */
function judgeHit(label) {
  const index = verdicts.findIndex((verdict) => {
    const scope = verdict.reasons.find((reason) => reason.messageId === 'admission.row-scope')
    const rowsNamed = String(scope?.params?.['rows'] ?? '')
      .split(', ')
      .filter((rowId) => rowId !== '')
    return (
      verdict.conclusion === 'blocked' &&
      verdict.subject.name === label.module &&
      rowsNamed.includes(label.entry_id) &&
      verdict.reasons.some(
        (reason) => reason.code === label.reason_code && reason.params?.['key'] === label.requirement_key,
      )
    )
  })
  if (index === -1) {
    return {
      verdict: 'miss',
      expected: label,
      matched: null,
      why: 'no blocked verdict named the labelled row with the labelled unmet requirement',
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
    why: 'the labelled row is named and the labelled requirement is the one that failed',
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
  command: 'why',
  status: 'ok',
  case: {
    id: spec.id,
    title: spec.title,
    source: spec.source,
    reported: spec.reported,
    deviations: spec.deviations ?? [],
    reproduced: { dsh_home: core.redactPath(dshHome, redactRoots), profile: profileName, bundles: fingerprint.bundles },
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
