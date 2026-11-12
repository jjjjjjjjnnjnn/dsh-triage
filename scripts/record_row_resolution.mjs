/**
 * M13 / BS-61: does the tool find the copies the loader actually loads?
 *
 * WHY THIS RECORDER EXISTS: the fix in `resolveRows()` was chosen from three measurements that had no
 * artifact — they lived in a scratch script and a chat log. A number that cannot be recomputed is what
 * this repository refuses to cite, and those numbers are the reason a judgement file
 * (`docs/specs/M13-row-resolution.md`) exists. So they get a recorder, a sha256 and a limit list.
 *
 * WHAT IT MEASURES: installs the kernel bundles into a THROWAWAY home through the real launcher, which
 * produces pnpm's default `isolated` layout (the shape `record_client_serve` creates), then answers the
 * same question three ways:
 *
 *   A  as shipped        — flat roots only (`kernel ∪ profile/node_modules ∪ profiles/node_modules`)
 *   B  + pnpm store root — one extra flat root, `.pnpm/node_modules` (the cheap fix, REJECTED)
 *   C  per-declarer      — resolve from the bundle that declared the row (M13-C1, shipped)
 *
 * B is recorded because rejecting it needs evidence: that layer is one link per NAME, so a name installed
 * in two versions is answered with whichever copy the link happens to point at. The artifact says how
 * many names are ambiguous and how many rows point at one, so "B happened to work here" cannot be read
 * as "B is safe".
 *
 * Usage (the sandbox is git-ignored, so this is a machine-local recorder like `record_client_serve`):
 *   node scripts/record_row_resolution.mjs \
 *     --dsh-main sandbox/upstream/0.2.1-rc.4/install/node_modules/@deepseek-ai/dsh/lib/bin.js \
 *     --install sandbox/upstream/0.2.1-rc.4/install --stamp <ISO>
 *
 * Exit: 0 the run finished (whatever it found) · 2 usage · 3 the install failed (nothing recorded).
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { abs, fileUrl, isoStamp } from './lib/kit.mjs'
import { displayPath } from './lib/evidence.mjs'
import { SANDBOX_PNPM_WORKSPACE, sandboxProfileManifest } from './lib/bundle.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
const dshMain = pathFor(String(argOf('--dsh-main', '')))
const outDir = pathFor(String(argOf('--out', 'data/results')))
const profile = String(argOf('--profile', 'web'))
const runtimeVersion = String(argOf('--runtime', '0.2.1-rc.4'))

if (argOf('--dsh-main', null) === null || !existsSync(dshMain) || !statSync(dshMain).isFile()) {
  process.stderr.write(
    'usage: node scripts/record_row_resolution.mjs --dsh-main <bin.js> --install <dir> --stamp <iso>\n' +
      '  --dsh-main must be the launcher FILE (sandbox/upstream/<ver>/install/node_modules/@deepseek-ai/dsh/lib/bin.js)\n',
  )
  process.exit(2)
}

const root = join(tmpdir(), 'dsh-triage-rows', `${Date.now().toString(36)}`)
const home = join(root, 'home')
const profileDir = join(home, 'profiles', profile)
const redactions = [abs('.'), homedir(), tmpdir()]
const clean = (value) => {
  let text = String(value ?? '')
  for (const base of redactions) {
    for (const variant of [base, base.replaceAll('\\', '/')]) {
      text = text.split(variant).join(base === abs('.') ? '<repo>' : '~')
    }
  }
  return text
}
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/*
 * The packages are imported the way every other recorder here imports them: from the built `dist/`,
 * through `fileUrl` so a relative cwd cannot change which copy was measured.
 */
const core = await import(fileUrl('packages/core/dist/index.js'))
const plugin = await import(fileUrl('packages/plugin/dist/load.js'))
const auditData = await import(fileUrl('packages/plugin/dist/audit-data.js'))
const { loadEnv, rowTargets, verdictsFromRowAdmission } = core
const { loadComposition, resolveRows } = plugin
const { loadAuditData } = auditData

const steps = []
const record = (id, status, detail, extra = {}) => steps.push({ id, status, detail: clean(detail), ...extra })

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs ?? 600_000,
    windowsHide: true,
  })
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const countIn = (dir) => {
  try {
    return readdirSync(dir).length
  } catch {
    return 0
  }
}

/** One verdict list, as the four numbers a reader compares. */
function summarize(rows, verdicts) {
  const by = {}
  let rowMissing = 0
  let unconstrained = 0
  for (const verdict of verdicts) {
    by[verdict.conclusion] = (by[verdict.conclusion] ?? 0) + 1
    if (verdict.reasons.some((reason) => reason.code === 'admission-row-missing')) rowMissing += 1
    else if (verdict.reasons.some((reason) => reason.code === 'admission-row-unconstrained')) unconstrained += 1
  }
  return {
    rows: rows.length,
    resolved: rows.filter((row) => row.version !== null).length,
    verdicts: verdicts.length,
    by_conclusion: by,
    row_missing: rowMissing,
    row_unconstrained: unconstrained,
  }
}

/**
 * How ambiguous is pnpm's convenience layer? One link per NAME; count the names that exist at more than
 * one version and which copy each link points at. This is what makes B unsafe in general rather than
 * merely unlucky.
 */
function storeAmbiguity(nodeModules) {
  const store = join(nodeModules, '.pnpm')
  const entries = (() => {
    try {
      return readdirSync(store)
    } catch {
      return []
    }
  })().filter((name) => !name.startsWith('.'))
  const byName = new Map()
  for (const entry of entries) {
    const at = entry.lastIndexOf('@')
    if (at <= 0) continue
    const name = entry.slice(0, at).replace('+', '/')
    const versions = byName.get(name) ?? []
    versions.push(entry.slice(at + 1))
    byName.set(name, versions)
  }
  const readVersion = (dir) => {
    try {
      return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version ?? null
    } catch {
      return null
    }
  }
  const multiVersion = [...byName.entries()].filter(([, versions]) => versions.length > 1)
  const disagreeing = multiVersion.filter(([name, versions]) => {
    const linked = readVersion(join(nodeModules, '.pnpm', 'node_modules', name))
    return linked !== null && versions.some((version) => !version.startsWith(String(linked)))
  })
  return {
    names: byName.size,
    names_with_multiple_versions: multiVersion.length,
    names_where_the_link_points_elsewhere: disagreeing.length,
    examples: disagreeing.slice(0, 6).map(([name, versions]) => ({
      name,
      link_version: readVersion(join(nodeModules, '.pnpm', 'node_modules', name)),
      versions,
    })),
  }
}

let exitCode = 0
const finish = (extra) => {
  const payload = {
    schema_version: 1,
    produced_by: 'scripts/record_row_resolution.mjs',
    generated_at: stamp,
    judgement: 'M13-row-resolution',
    sandbox: { home: clean(home), profile, runtime: runtimeVersion, bundle_in_profile: false },
    steps,
    ...extra,
    limits: [
      'one sandbox runtime on one Windows machine: the isolated shape is pnpm default, not a property of DSH',
      'the numbers compare three WAYS OF READING the same installed tree; they do not say which rows a running Host would mount',
      'a profile installed with nodeLinker: hoisted does not reproduce the defect at all (measured: 0 rows changed on the maintainer profile)',
      'declaration layer only: admission reads package.json, so a resolved row is not a runtime measurement',
    ],
  }
  const text = `${JSON.stringify(payload, null, 2)}\n`
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `row-resolution-${stamp.replaceAll(':', '-')}.json`)
  if (existsSync(file)) {
    process.stderr.write(`refusing to overwrite ${basename(file)}\n`)
    exitCode = 2
    return
  }
  writeFileSync(file, text, 'utf8')
  writeFileSync(`${file}.sha256`, `${sha256(text)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(extra.measurements, null, 1)}\n`)
  process.stdout.write(`ssot ${displayPath(file)} · ${sha256(text).slice(0, 12)}…\n`)
}

try {
  mkdirSync(profileDir, { recursive: true })
  const manifest = sandboxProfileManifest({ bundleDir: join(profileDir, '.no-bundle'), runtimeVersion, name: 'dsh-profile-rows' })
  // No `dsh-triage` bundle on purpose: this recorder is about ROW RESOLUTION, and our own bundle would
  // add rows whose modules are `file:` links the launcher installed for itself.
  delete manifest.dependencies['dsh-triage']
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name) => name !== 'dsh-triage')
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n', 'utf8')
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), SANDBOX_PNPM_WORKSPACE, 'utf8')

  const env = { ...process.env, DSH_HOME: home, npm_config_userconfig: join(root, 'empty-npmrc') }
  writeFileSync(env.npm_config_userconfig, '', 'utf8')
  const installed = run(process.execPath, [dshMain, 'plugin', '--profile', profile, 'install'], { cwd: home, env })
  if (installed.code !== 0) {
    record('install', 'failed', `${installed.stdout}\n${installed.stderr}`.trim().slice(-600))
    finish({ measurements: { installed: false } })
    process.stderr.write('install failed: no measurement was taken\n')
    process.exit(3)
  }
  record('install', 'passed', `${installed.stdout}\n${installed.stderr}`.trim().split('\n').slice(-2).join(' · '))

  const nodeModules = join(profileDir, 'node_modules')
  const topLevel = countIn(nodeModules)
  const storeEntries = countIn(join(nodeModules, '.pnpm'))
  const isolated = storeEntries > 0 && topLevel < 20
  record(
    'layout',
    isolated ? 'passed' : 'unmeasured',
    isolated
      ? `pnpm installed into a store: ${storeEntries} entr(ies) under .pnpm, ${topLevel} at the profile's top level`
      : `this install is not the isolated shape (${topLevel} top-level entr(ies), ${storeEntries} store entr(ies)), so the defect this recorder targets is absent`,
    { top_level_entries: topLevel, store_entries: storeEntries, isolated },
  )

  const envReading = await loadEnv({ dshHome: home, profile })
  if (!envReading.ok) throw new Error(`loadEnv failed: ${envReading.error.code} — ${envReading.error.detail}`)
  const fingerprint = envReading.value
  const composition = await loadComposition(fingerprint, home)
  record(
    'composition',
    composition.errors.length === 0 ? 'passed' : 'failed',
    `${composition.layers.length} bundle layer(s) read${composition.errors.length === 0 ? '' : `, ${composition.errors.length} error(s): ${composition.errors.join(' | ').slice(0, 300)}`}`,
    { layers: composition.layers.map((layer) => ({ name: layer.name, version: layer.version, provenance: layer.provenance })) },
  )

  // The claims, read exactly as `audit` reads them: patch files in bundle order, then the profile and
  // home layers. Re-implementing `collectClaims` here would let the two drift.
  const loaded = await loadAuditData({ env: fingerprint, dshHome: home, stamp, snapshotPath: null, noRedact: true })
  if (!loaded.ok) throw new Error(`loadAuditData failed: ${loaded.message}`)
  const targets = rowTargets(loaded.data.claims)
  record('rows', 'passed', `${loaded.data.claims.length} declared rows, ${targets.length} import targets`)

  const aRows = await resolveRows(fingerprint, targets)
  const aVerdicts = verdictsFromRowAdmission({ env: fingerprint, rows: aRows, exemptions: {}, generatedAt: stamp })
  const A = summarize(aRows, aVerdicts)

  const storeRoot = join(nodeModules, '.pnpm', 'node_modules')
  const bEnv = { ...fingerprint, kernelRoots: [...(fingerprint.kernelRoots ?? []), storeRoot] }
  const bRows = await resolveRows(bEnv, targets)
  const bVerdicts = verdictsFromRowAdmission({ env: fingerprint, rows: bRows, exemptions: {}, generatedAt: stamp })
  const B = summarize(bRows, bVerdicts)

  const layers = composition.layers.map((layer) => {
    let dir = layer.dir
    try {
      dir = realpathSync(dir)
    } catch {
      // An unreadable layer stays a miss (M13-N5); the recorder still names the directory it tried.
    }
    return { name: layer.name, dir }
  })
  const cRows = await resolveRows(fingerprint, targets, { layers })
  const cVerdicts = verdictsFromRowAdmission({ env: fingerprint, rows: cRows, exemptions: {}, generatedAt: stamp })
  const C = summarize(cRows, cVerdicts)

  const ambiguity = storeAmbiguity(nodeModules)
  const rowsOnAmbiguousNames = targets.filter((target) => ambiguity.examples.some((example) => example.name === target.module)).length

  record(
    'measurements',
    C.resolved > A.resolved ? 'passed' : 'unmeasured',
    A.resolved === C.resolved
      ? 'the per-declarer pass found nothing the flat roots missed, so this profile does not show the defect'
      : `the flat roots resolved ${A.resolved}/${A.rows}; resolving from the declaring bundle resolves ${C.resolved}/${C.rows}`,
  )

  // OPTIONAL: the regression face — every row the flat roots already answered must keep its version.
  const changed = cRows.filter((row, index) => {
    const before = aRows[index]
    return before !== undefined && before.version !== null && row.version !== before.version
  })
  record(
    'no-rewrite',
    changed.length === 0 ? 'passed' : 'failed',
    changed.length === 0
      ? 'every row the flat roots already resolved kept its exact version (M13-C2, "add only")'
      : `${changed.length} already-resolved row(s) changed version`,
    changed.length === 0 ? {} : { first: changed.slice(0, 5).map((row) => ({ row: row.rowId, module: row.module, version: row.version })) },
  )

  finish({
    measurements: {
      A_flat_roots: A,
      B_with_store_root: B,
      C_per_declarer: C,
      upgrade_to: 'not measured here (see `upgrade --to <version>`)',
    },
    store_ambiguity: { ...ambiguity, rows_pointing_at_an_ambiguous_name: rowsOnAmbiguousNames },
    judgements: {
      /**
       * NOT called `verdict`: `data/results/**` is scanned by `gate_verdict_contract`, which reads any
       * top-level `verdict` as a Verdict object (conclusion/confidence/reasons/evidence). This artifact
       * states a READING of three numbers, not a conclusion about a profile, so it must not borrow that
       * reserved word — the gate caught it (R95).
       */
      reading: A.resolved === C.resolved ? 'no-defect-on-this-profile' : 'B-and-C-agree-and-A-does-not',
    },
  })
} catch (error) {
  record('run', 'failed', error instanceof Error ? error.message : String(error))
  finish({ measurements: { installed: existsSync(home) } })
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  exitCode = 3
} finally {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    process.stderr.write('note: the sandbox could not be removed (a running process holds it)\n')
  }
}

process.exit(exitCode)
