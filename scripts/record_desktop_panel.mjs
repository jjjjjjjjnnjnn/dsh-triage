#!/usr/bin/env node
/**
 * Read the DESKTOP panel's answer off the running Host — and the CLI's answer for the same profile.
 *
 * WHY (R102): every "the settings page says X" claim in this repository used to be unverifiable. R101
 * wrote that the settings page reported eight blocked plugins; the first time anyone read the route
 * directly, it reported `denied 0` while the CLI reported `blocked 8`. Same machine, same profile,
 * two different compositions (M16).
 *
 * WHAT IT DOES: one GET to the Host's read-only summary route with the marker header the desktop bridge
 * needs (M10-C1 ⑥), and one in-process scan of the same profile through the CLI's own code path. Both
 * readings are written into one SSOT artifact, including the fields that disagree — a single summary
 * would hide exactly the thing this file exists to show.
 *
 * WHAT IT DOES NOT DO: it does not start, stop or modify the Host, does not install anything, and does
 * not decide whether the two answers *should* agree. That is `docs/specs/M16-composition-source.md`.
 *
 *   node scripts/record_desktop_panel.mjs --port 51701 --profile desktop --stamp 2026-11-12T22:00:00.000Z
 *
 * Exit codes: 0 artifact written · 1 the Host did not answer · 2 usage / the artifact already exists.
 */

import { request } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { abs, fileUrl, isoStamp } from './lib/kit.mjs'
import { displayPath, writeEvidence } from './lib/evidence.mjs'
import { judgePanelAgreement } from './lib/panel-agreement.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const rawStamp = argOf('--stamp', new Date().toISOString())
const stamp = isoStamp(rawStamp)
if (stamp === null) {
  process.stderr.write(`invalid --stamp "${rawStamp}": expected ISO-8601 with Z\n`)
  process.exit(2)
}
const port = Number(argOf('--port', '0'))
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  process.stderr.write('usage: node scripts/record_desktop_panel.mjs --port <host port> [--profile desktop] [--stamp <ISO>]\n')
  process.exit(2)
}
const profile = argOf('--profile', 'desktop')
const dshHome = argOf('--dsh-home', join(process.env['USERPROFILE'] ?? homedir(), '.dsh'))
const outDir = argOf('--out', 'data/results')

/** The desktop bridge deletes `origin` / `sec-fetch-site`; the marker header is what it forwards instead (M10). */
const CLIENT_MARKER_HEADER = 'x-dsh-triage-client'
const CLIENT_MARKER_VALUE = 'settings-tab'
const ROUTE = '/compat-triage/summary'

const getJson = (path) =>
  new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { accept: 'application/json', [CLIENT_MARKER_HEADER]: CLIENT_MARKER_VALUE } },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed = null
          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = null
          }
          resolve({ status: res.statusCode ?? 0, text, json: parsed })
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(60_000, () => req.destroy(new Error('the Host did not answer within 60s')))
    req.end()
  })

const core = await import(fileUrl('packages/core/dist/index.js'))
const plugin = await import(fileUrl('packages/plugin/dist/audit-data.js'))
const summaryModule = await import(fileUrl('packages/plugin/dist/summary.js'))

/**
 * Which build is serving the panel?
 *
 * WHY THIS IS IN THE ARTIFACT: the Host reads `dsh.profile.bundles` from the profile's `node_modules`, and
 * that directory can hold an older release than the checkout running the CLI. R102 measured exactly that
 * trap: the panel answered from `0.3.7` (no M16) while the CLI answered from HEAD. Without this field a
 * reader would compare two different programs and call the difference a defect.
 */
async function installedPluginVersion(fromCheckout = false) {
  const manifestPath = fromCheckout
    ? join(abs('..'), 'dsh-triage', 'packages', 'plugin', 'package.json')
    : join(dshHome, 'profiles', profile, 'node_modules', 'dsh-triage', 'package.json')
  try {
    const { readFile: read } = await import('node:fs/promises')
    const parsed = JSON.parse(await read(manifestPath, 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

const panelBuild = await installedPluginVersion()
const cliBuild = await installedPluginVersion(true)

/* ------------------------------- the panel side ------------------------------- */

let host
try {
  host = await getJson(ROUTE)
} catch (error) {
  process.stderr.write(`the Host at 127.0.0.1:${port} did not answer: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
if (host.status !== 200 || host.json === null) {
  process.stderr.write(`the Host answered ${host.status} for ${ROUTE}: ${host.text.slice(0, 300)}\n`)
  process.exit(1)
}

const panelEnv = host.json.env ?? {}
const panelZh = host.json.summary?.zh ?? {}
const panelEn = host.json.summary?.en ?? {}

/* -------------------------------- the CLI side -------------------------------- */

const envResult = await core.loadEnv({ dshHome, profile })
if (!envResult.ok) {
  process.stderr.write(`the CLI could not read the profile: ${envResult.error.code} — ${envResult.error.detail}\n`)
  process.exit(1)
}
const loaded = await plugin.loadAuditData({
  env: envResult.value,
  dshHome,
  stamp,
  snapshotPath: null,
  noRedact: false,
})
if (!loaded.ok) {
  process.stderr.write(`the CLI could not scan the profile: ${loaded.message}\n`)
  process.exit(1)
}
const cliZh = summaryModule.buildProfileSummary(loaded.data, { locale: 'zh' })
const cliEn = summaryModule.buildProfileSummary(loaded.data, { locale: 'en' })
const cliEnv = core.redactEnv(envResult.value, plugin.auditRedactRoots(dshHome))

/*
 * What "the two answers agree" means, in the only terms that are checkable here:
 *   - the runtime VERSION must be the same string (the composition source may differ, which is
 *     exactly M16's point — `kernel` vs `kernel-asar` are two labels for one runtime);
 *   - `denied`, `collisions` and `duplicateCopies` must be the same numbers, because those are the
 *     fields a user acts on;
 *   - the row counts are NOT required to match: the Host sees the kernel layer and the CLI does not.
 *     A difference there is expected and must be reported, not asserted away.
 */
const counts = (summary) => ({
  rows: summary?.counts?.rows ?? null,
  judged: summary?.counts?.judged ?? null,
  go: summary?.counts?.go ?? null,
  denied: summary?.counts?.denied ?? null,
  unknown: summary?.counts?.unknown ?? null,
  collisions: summary?.counts?.collisions ?? null,
  duplicateCopies: summary?.counts?.duplicateCopies ?? null,
  errors: summary?.counts?.errors ?? null,
  actionable: summary?.counts?.actionable ?? null,
  unjudged: summary?.counts?.unjudged ?? null,
})

const panelCounts = counts(panelZh)
const cliCounts = counts(cliZh)
const agreement = judgePanelAgreement(
  { dsh: panelEnv.dsh ?? null, dshSource: panelEnv.dshSource ?? null, counts: panelCounts },
  { dsh: cliEnv.dsh ?? null, dshSource: cliEnv.dshSource ?? null, counts: cliCounts },
)
const rowCountsNote =
  'The Host composes the kernel layer, the CLI only the profile layer; M16-C6 requires the actionable fields to agree and requires this difference to be explained, not removed.'

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_desktop_panel.mjs',
  generated_at: stamp,
  command: 'desktop-panel',
  inputs: {
    host: { address: `127.0.0.1:${port}`, route: ROUTE, marker_header: CLIENT_MARKER_HEADER, profile },
    dsh_home: dshHome === join(process.env['USERPROFILE'] ?? homedir(), '.dsh') ? '~/.dsh' : dshHome,
    // The two readings come from two builds; a reader must be able to see that before comparing them.
    host_plugin_version: panelBuild,
    cli_plugin_version: cliBuild,
  },
  panel: {
    env: {
      dsh: panelEnv.dsh ?? null,
      dshSource: panelEnv.dshSource ?? null,
      profile: panelEnv.profile ?? null,
      platform: panelEnv.platform ?? null,
      arch: panelEnv.arch ?? null,
    },
    zh: { tone: panelZh.tone ?? null, headline: panelZh.headline ?? null, counts: panelCounts, issues: panelZh.issues?.length ?? 0 },
    en: { tone: panelEn.tone ?? null, headline: panelEn.headline ?? null },
    ms: host.json.ms ?? null,
  },
  cli: {
    env: { dsh: cliEnv.dsh, dshSource: cliEnv.dshSource ?? null, profile: cliEnv.profile, platform: cliEnv.platform, arch: cliEnv.arch },
    zh: { tone: cliZh.tone, headline: cliZh.headline, counts: cliCounts, issues: cliZh.issues.length },
    en: { tone: cliEn.tone, headline: cliEn.headline },
  },
  /*
   * `agree` is about the fields a user acts on; `row_counts_differ` records the explainable gap so
   * nobody has to rediscover it. Both are answers, not verdicts: M16-C6 says the collision counts must
   * match, and this artifact is the only place that sentence is measured.
   */
  judgement: {
    ...agreement,
    row_counts_note: rowCountsNote,
  },
  limits: [
    'One scan per side, taken seconds apart. A profile edited in between is a different fact.',
    'The route is read with the marker header the desktop bridge forwards; this is the page\'s call path, not a browser click.',
    'The Host is not started, stopped or modified by this script: whoever owns the desktop app decides when it restarts.',
  ],
}

const fileName = `desktop-panel-${stamp.replaceAll(':', '-')}.json`
const written = writeEvidence({ outDir, fileName, text: `${JSON.stringify(payload, null, 2)}\n`, root: abs('.') })
if (!written.ok) {
  process.stderr.write(`refusing to overwrite ${written.target}\n`)
  process.exit(2)
}

process.stdout.write(`panel  dsh ${String(panelEnv.dsh ?? 'unknown')} (${String(panelEnv.dshSource ?? 'unstated')}) · `)
process.stdout.write(`${panelCounts.rows} rows / ${panelCounts.denied} denied / ${panelCounts.collisions} collisions\n`)
process.stdout.write(`cli    dsh ${cliCounts === null ? '?' : String(cliEnv.dsh ?? 'unknown')} (${String(cliEnv.dshSource ?? 'unstated')}) · `)
process.stdout.write(`${cliCounts.rows} rows / ${cliCounts.denied} denied / ${cliCounts.collisions} collisions\n`)
process.stdout.write(
  `agree: version=${payload.judgement.agree_on_version} actionable=${payload.judgement.agree_on_actionable}` +
    `${agreement.mismatches.length === 0 ? '' : ` · mismatches: ${agreement.mismatches.map((item) => item.field).join(', ')}`}\n`,
)
process.stdout.write(`ssot ${displayPath(written.target, abs('.'))} sha256=${written.sha256.slice(0, 12)}…\n`)
process.exit(0)
