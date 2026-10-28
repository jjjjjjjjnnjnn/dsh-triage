#!/usr/bin/env node
/**
 * `dsh-triage serve` smoke recorder (M4 form A).
 *
 * Starts the real panel over the repo's `data/results`, walks the routes a human would use,
 * and writes ONE artifact describing what answered what. No screenshots, no browser: the
 * panel is plain HTTP + inline HTML by design (`docs/adr/0003` discipline).
 *
 * T-406 adds the second half: `--audit` is opt-in, so this script proves BOTH states
 * (501 when off, 200 when on) and then compares `/api/audit` with `audit --json` on the same
 * profile — the panel and the CLI must not be able to disagree.
 *
 *   node scripts/record_serve_smoke.mjs --stamp 2026-10-27T14:10:00.000Z
 *
 * Exit codes: 0 every expectation met · 1 an expectation failed · 2 bad usage.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { makeRedactor, redactDeep } from './lib/live.mjs'
import { auditJsonPayload, auditRedactRoots, loadAuditData } from '../packages/plugin/dist/audit-data.js'
import { startPanel } from '../packages/plugin/dist/serve.js'
import { loadEnv } from '../packages/core/dist/index.js'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}
const pathFor = (value) => (isAbsolute(value) ? value : resolve(abs('.'), value))

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
if (stamp === null) {
  process.stderr.write('invalid --stamp; expected ISO-8601, e.g. 2026-10-27T14:10:00.000Z\n')
  process.exit(2)
}
const resultsDir = pathFor(String(argOf('--results', 'data/results')))
const outDir = pathFor(String(argOf('--out', 'data/results')))
// The audit half reads a FIXTURE profile by default: a smoke artifact must be reproducible and
// must not publish the operator's real composition. The synthetic inventory snapshot gives the
// judgment something to say, so "parity" is not a comparison of two empty lists.
const auditHome = pathFor(String(argOf('--audit-home', 'tests/fixtures/env/home')))
const auditProfile = String(argOf('--audit-profile', 'desktop'))
const auditSnapshot = pathFor(String(argOf('--audit-snapshot', 'data/fixtures/inventory/desktop-web-2026-10-26.json')))
// Same redaction discipline as every other recorder: the artifact may say WHICH directory,
// never the absolute path (R14 F-2 / `results-privacy` gate).
const redact = makeRedactor([abs('.'), homedir(), tmpdir()])

const checks = []
const check = (id, ok, detail) => checks.push({ id, ok, detail })

const get = async (port, path, init) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init)
  const text = await response.text()
  return { status: response.status, text, headers: response.headers }
}

/** Start, exercise, always close (fetch keeps sockets alive; a plain close aborts on Windows). */
async function withPanel(options, body) {
  const panel = await startPanel(options)
  try {
    await body(panel)
  } finally {
    panel.server.closeAllConnections?.()
    await new Promise((resolveClose) => panel.server.close(() => resolveClose()))
  }
}

/* ------------------------------ read-only panel ---------------------------- */

await withPanel({ resultsDir, locale: 'zh' }, async (panel) => {
  const anonymous = await get(panel.port, '/')
  check('token-required', anonymous.status === 401, `GET / without token → ${anonymous.status}`)

  const page = await get(panel.port, `/?token=${panel.token}`)
  check(
    'page-renders',
    page.status === 200 && page.text.includes('证据面板') && page.text.includes('/api/artifacts'),
    `GET / → ${page.status}, ${page.text.length} bytes`,
  )

  const health = await get(panel.port, `/api/health?token=${panel.token}`)
  const healthBody = JSON.parse(health.text)
  check(
    'health',
    health.status === 200 && healthBody.ok === true && healthBody.audit === false,
    `ok=${healthBody.ok} readOnly=${healthBody.readOnly} audit=${healthBody.audit}`,
  )

  const listing = await get(panel.port, `/api/artifacts?token=${panel.token}`)
  const list = JSON.parse(listing.text)
  check(
    'artifacts-listed',
    listing.status === 200 && list.count > 0,
    `${list.count} artifacts · kinds ${Object.entries(list.byKind ?? {}).map(([k, v]) => `${k}:${v}`).join(' ')}`,
  )

  const firstProbe = (list.artifacts ?? []).find((item) => item.kind === 'probe')
  if (firstProbe === undefined) {
    check('artifact-detail', false, 'no probe artifact to open')
  } else {
    const detail = await get(panel.port, `/api/artifact?token=${panel.token}&name=${encodeURIComponent(firstProbe.name)}`)
    const body = JSON.parse(detail.text)
    check(
      'artifact-detail',
      detail.status === 200 && typeof body.payload === 'object' && body.payload !== null,
      `${firstProbe.name} → ${detail.status}, sha256=${String(body.sha256 ?? 'none').slice(0, 12)}`,
    )
  }

  const traversal = await get(panel.port, `/api/artifact?token=${panel.token}&name=${encodeURIComponent('../package.json')}`)
  check('traversal-refused', traversal.status === 400, `../package.json → ${traversal.status}`)

  const crossOrigin = await get(panel.port, `/api/artifacts?token=${panel.token}`, { headers: { origin: 'http://evil.example' } })
  check('cross-origin-refused', crossOrigin.status === 403, `Origin: evil → ${crossOrigin.status}`)

  const post = await get(panel.port, `/api/probe?token=${panel.token}`, { method: 'POST' })
  check('post-read-only', post.status === 403, `POST /api/probe → ${post.status}`)

  // T-406: without --audit the route must say so, not answer with an empty ledger.
  const auditOff = await get(panel.port, `/api/audit?token=${panel.token}`)
  check('audit-off-501', auditOff.status === 501, `GET /api/audit without --audit → ${auditOff.status}`)
})

/* --------------------------- audit-enabled panel (T-406) ------------------- */

let auditFacts = null

await withPanel(
  {
    resultsDir,
    locale: 'zh',
    audit: async () => {
      const loadedEnv = await loadEnv({ dshHome: auditHome, profile: auditProfile })
      if (!loadedEnv.ok) {
        return { ok: false, message: `cannot read the profile: ${loadedEnv.error.code} — ${loadedEnv.error.detail}` }
      }
      const loaded = await loadAuditData({
        env: loadedEnv.value,
        dshHome: auditHome,
        stamp,
        snapshotPath: auditSnapshot,
        noRedact: false,
      })
      if (!loaded.ok) return { ok: false, message: loaded.message }
      return { ok: true, payload: auditJsonPayload(loaded.data, { noRedact: false, roots: auditRedactRoots(auditHome) }) }
    },
  },
  async (panel) => {
    const response = await get(panel.port, `/api/audit?token=${panel.token}`)
    const payload = response.status === 200 ? JSON.parse(response.text) : null
    const verdicts = payload?.row_verdicts ?? []
    const inventoryVerdicts = payload?.inventory?.verdicts ?? []
    check(
      'audit-enabled',
      response.status === 200 && payload?.command === 'audit' && Array.isArray(verdicts),
      `GET /api/audit → ${response.status}, ${verdicts.length} row + ${inventoryVerdicts.length} inventory verdict(s), ${response.headers.get('x-triage-audit-ms') ?? '?'}ms`,
    )
    check(
      'audit-timed',
      /^\d+$/.test(response.headers.get('x-triage-audit-ms') ?? ''),
      `x-triage-audit-ms=${response.headers.get('x-triage-audit-ms') ?? 'missing'} (a scan that costs real time must say so)`,
    )
    check(
      'audit-redacted',
      typeof payload?.env?.profileDir === 'string' && payload.env.profileDir.startsWith('~'),
      `env.profileDir=${String(payload?.env?.profileDir)}`,
    )

    // Parity: the same profile + snapshot through the CLI, compared as sets (timestamps differ).
    const cli = spawnSync(
      process.execPath,
      [
        join(abs('.'), 'packages/plugin/dist/cli.js'),
        'audit',
        '--json',
        '--stamp',
        stamp,
        '--dsh-home',
        auditHome,
        '--profile',
        auditProfile,
        '--snapshot',
        auditSnapshot,
      ],
      { encoding: 'utf8', timeout: 120_000 },
    )
    let cliPayload = null
    try {
      cliPayload = JSON.parse(cli.stdout)
    } catch {
      cliPayload = null
    }
    const key = (verdict) => `${verdict.subject?.name ?? '?'}|${verdict.conclusion ?? '?'}`
    const pair = (rows, inventory) => ({
      rows: [...rows].map(key).sort(),
      inventory: [...inventory].map(key).sort(),
    })
    const panelKeys = pair(verdicts, inventoryVerdicts)
    const cliKeys =
      cliPayload === null ? null : pair(cliPayload.row_verdicts ?? [], cliPayload.inventory?.verdicts ?? [])
    const same =
      cliKeys !== null &&
      panelKeys.rows.length === cliKeys.rows.length &&
      panelKeys.inventory.length === cliKeys.inventory.length &&
      panelKeys.rows.every((value, index) => value === cliKeys.rows[index]) &&
      panelKeys.inventory.every((value, index) => value === cliKeys.inventory[index])
    check(
      'audit-parity',
      same,
      cliKeys === null
        ? `CLI audit failed (exit ${String(cli.status)})`
        : `${panelKeys.rows.length} row + ${panelKeys.inventory.length} inventory verdict(s) identical to \`audit --json\``,
    )
    check(
      'audit-has-evidence',
      panelKeys.rows.length + panelKeys.inventory.length > 0,
      'the fixture profile + synthetic snapshot must produce at least one judgment, or parity proves nothing',
    )
    auditFacts = {
      home: redact(auditHome),
      profile: auditProfile,
      snapshot: redact(auditSnapshot),
      row_verdicts: panelKeys.rows.length,
      inventory_verdicts: panelKeys.inventory.length,
      by_conclusion: [...verdicts, ...inventoryVerdicts].reduce((out, verdict) => {
        out[verdict.conclusion] = (out[verdict.conclusion] ?? 0) + 1
        return out
      }, {}),
      parity: same ? 'identical to `audit --json` on the same profile and snapshot' : 'MISMATCH',
    }
  },
)

const failed = checks.filter((item) => !item.ok)
const artifact = {
  schema_version: 1,
  produced_by: 'scripts/record_serve_smoke.mjs',
  generated_at: stamp,
  panel: { results_dir: redact(resultsDir), port: null, read_only: true, url_shape: 'http://127.0.0.1:<port>/?token=<token>' },
  audit: auditFacts,
  checks: redactDeep(checks, redact),
  passed: failed.length === 0,
  limits: [
    'this proves the panel answers and refuses the ways it claims to; it is not a UI review',
    'no browser is involved: the page is inline HTML and the API is plain JSON',
    'the token and port are not written to this artifact',
    'the audit half reads a fixture profile (tests/fixtures/env/home), not the operator machine',
  ],
}

mkdirSync(outDir, { recursive: true })
const target = join(outDir, `serve-smoke-${stamp.replaceAll(':', '-')}.json`)
const text = `${JSON.stringify(artifact, null, 2)}\n`
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${sha256(text)}\n`, 'utf8')

for (const item of checks) process.stdout.write(`${item.ok ? 'ok  ' : 'FAIL'} ${item.id.padEnd(20)} ${item.detail}\n`)
process.stdout.write(`wrote ${target}\n`)
// No `process.exit()`: let the loop drain, otherwise Windows can abort while a socket is
// still closing (measured in this script's first run).
process.exitCode = failed.length === 0 ? 0 : 1
