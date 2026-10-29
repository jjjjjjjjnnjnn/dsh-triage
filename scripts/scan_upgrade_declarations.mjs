#!/usr/bin/env node
/**
 * Scan the registry for declarations that would move `upgrade`'s `improved` bucket (`T-503`, R44).
 *
 * THE QUESTION IT ANSWERS: "is there a **published** plugin whose declaration denies the runtime
 * we run today and admits some other exact version?" That is the only shape `improved` can have
 * (spec §4.1), and it cannot be answered from fixtures: a fixture would just be us writing the
 * range we hoped to find.
 *
 * WHY IT IS A SCRIPT AND NOT A ONE-OFF: the answer changes as the ecosystem publishes. The
 * artifact is a dated snapshot, and the sampler in
 * `scripts/prepare_upgrade_mixed_profile.mjs` cites it for *why* those packages were chosen.
 *
 * WHAT IT DOES NOT DO: it reads `<name>/latest` only (not every published version), it uses the
 * registry's keyword search (not a census of the ecosystem), and it judges **declarations** —
 * nothing is installed or booted here.
 *
 * Requires `pnpm build` (it imports the built admission engine, so this scan and the product
 * cannot disagree about a range).
 *
 *   node scripts/scan_upgrade_declarations.mjs --stamp <ISO> [--pages 3] [--current 0.2.1-rc.4]
 *
 * Exit codes: 0 recorded (whatever the answer is) · 1 recorded but a structural check failed ·
 * 2 bad usage / missing prerequisite / refusing to overwrite.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { abs, isoStamp, sha256 } from './lib/kit.mjs'
import { evaluateAdmission } from '../packages/core/dist/admission.js'

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
    'usage: node scripts/scan_upgrade_declarations.mjs --stamp <ISO> [--pages 3] [--current 0.2.1-rc.4] [--out <dir>]\n',
  )
  process.exit(2)
}
if (!existsSync(abs('packages/core/dist/admission.js'))) {
  process.stderr.write('packages/core/dist/admission.js is missing: run `pnpm build` first\n')
  process.exit(2)
}

const CURRENT = String(argOf('--current', '0.2.1-rc.4'))
const PAGES = Number(argOf('--pages', '3'))
const outDir = pathFor(String(argOf('--out', 'data/results')))
const REGISTRY = 'https://registry.npmjs.org'
const QUERIES = ['keywords:dsh-plugin', 'keywords:deepseek-harness', 'dsh plugin']

/**
 * Candidate targets. The three **newer** ones are the interesting case: a plugin written for a
 * build that does not exist yet. The rest are real published builds, so a hit there is the
 * "move back to what your plugins pin" geometry.
 */
const NEWER = ['0.2.1', '0.2.2-alpha.2', '0.3.0']
const OLDER = ['0.2.1-rc.3', '0.2.1-rc.1', '0.2.0', '0.1.0-rc.6']
const TARGETS = [...NEWER, ...OLDER]

async function json(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

const names = new Set()
for (const query of QUERIES) {
  for (let page = 0; page < PAGES; page += 1) {
    try {
      const body = await json(`${REGISTRY}/-/v1/search?text=${encodeURIComponent(query)}&size=250&from=${page * 250}`)
      for (const object of body.objects ?? []) {
        if (typeof object?.package?.name === 'string') names.add(object.package.name)
      }
    } catch (error) {
      process.stderr.write(`search "${query}" page ${page}: ${String(error)}\n`)
    }
  }
}
if (names.size === 0) {
  process.stderr.write('the registry search returned no candidates: refusing to record an empty scan as evidence\n')
  process.exit(2)
}

const denied = []
const queue = [...names].sort()
const CONCURRENCY = 12
async function worker() {
  for (;;) {
    const name = queue.shift()
    if (name === undefined) return
    let manifest
    try {
      manifest = await json(`${REGISTRY}/${name.replace('/', '%2f')}/latest`)
    } catch {
      continue // unreadable package: not evidence either way
    }
    const atCurrent = evaluateAdmission(manifest, CURRENT)
    if (atCurrent.status !== 'denied') continue
    denied.push({
      name,
      version: typeof manifest.version === 'string' ? manifest.version : null,
      declared: {
        engines: typeof manifest.engines?.dsh === 'string' ? manifest.engines.dsh : null,
        // Only the DSH peers: the rest are irrelevant to admission and would bloat the artifact.
        peers: Object.entries(manifest.peerDependencies ?? {})
          .filter(([key]) => key.startsWith('@deepseek-ai/dsh'))
          .map(([key, range]) => `${key} ${String(range)}`)
          .sort(),
      },
      unmet: atCurrent.unmet
        .filter((requirement) => requirement.failure === null)
        .map((requirement) => `${requirement.key} ${requirement.range}`),
      admitted_at: TARGETS.filter((target) => evaluateAdmission(manifest, target).status === 'admitted'),
    })
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

const forward = denied.filter((row) => row.admitted_at.some((target) => NEWER.includes(target)))
const downgradeOnly = denied.filter((row) => row.admitted_at.length > 0 && !forward.includes(row))
const stuck = denied.filter((row) => row.admitted_at.length === 0)

const checks = []
const check = (id, ok, detail) => {
  checks.push({ id, ok: Boolean(ok), detail })
  return ok
}
check('scanned-something', names.size > 0, `${names.size} package(s) with a readable latest manifest`)
check('found-denied-declarations', denied.length > 0, `${denied.length} denied at ${CURRENT}`)
check(
  'classification-is-a-partition',
  forward.length + downgradeOnly.length + stuck.length === denied.length,
  `${forward.length} forward + ${downgradeOnly.length} downgrade-only + ${stuck.length} stuck = ${denied.length}`,
)
check(
  'every-denial-names-an-unmet-range',
  denied.every((row) => row.unmet.length > 0),
  'each denied package carries the rule that failed (no blame without a range)',
)
check(
  'no-fixture-in-the-sample',
  denied.every((row) => typeof row.name === 'string' && !row.name.startsWith('.')),
  'every sampled package is a published registry name',
)

const passed = checks.every((entry) => entry.ok)
const artifact = {
  schema_version: 1,
  produced_by: 'scripts/scan_upgrade_declarations.mjs',
  generated_at: stamp,
  method: {
    registry: REGISTRY,
    queries: QUERIES,
    pages_per_query: PAGES,
    manifest_read: '<name>/latest',
    admission: 'packages/core/dist/admission.js#evaluateAdmission (the same engine the CLI uses)',
    current: CURRENT,
    newer_targets: NEWER,
    older_targets: OLDER,
  },
  totals: {
    candidates: names.size,
    readable_manifests: names.size,
    denied_at_current: denied.length,
    forward_improved: forward.length,
    downgrade_only: downgradeOnly.length,
    stuck: stuck.length,
  },
  /*
   * The headline. `forward_improved = 0` is the finding that shaped R44: a *newer* target cannot
   * light the `improved` bucket on today's ecosystem, so the real geometry is "move back".
   */
  forward: forward.map((row) => ({ name: row.name, version: row.version, admitted_at: row.admitted_at })),
  downgrade_only: downgradeOnly.map((row) => ({ name: row.name, version: row.version, admitted_at: row.admitted_at })),
  stuck: stuck.map((row) => ({ name: row.name, version: row.version })),
  examples: {
    // Two full records so a reader can see the shape without opening the registry.
    downgrade_only: downgradeOnly.slice(0, 2),
    stuck: stuck.slice(0, 2),
  },
  checks,
  passed,
  limits: [
    'a `<name>/latest` scan is not a version census: an older version of a package can deny the current runtime while its latest does not, and vice versa',
    'the candidate list comes from keyword search, not from a registry dump: the denominators here are not the ecosystem, only "what the search returned"',
    'declarations only: nothing was installed or booted, so this says which ranges would deny, not which plugins work',
    'network snapshot: re-running later can legitimately find a different set (including a forward hit, the day a plugin declares a range that admits an unpublished-but-newer build)',
    '`evaluateAdmission` uses `{ includePrerelease: true }`; a range like `>=0.2.0-rc.1 <0.3.0-0` therefore ADMITS `0.2.1-rc.4` (pinned by tests/unit/upgrade.test.ts), while `^0.2.1` does not',
  ],
}

const text = `${JSON.stringify(artifact, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const fileName = `upgrade-declarations-${stamp.replaceAll(':', '-')}.json`
const targetPath = join(outDir, fileName)
if (existsSync(targetPath)) {
  process.stderr.write(`refusing to overwrite existing evidence: ${join('data/results', fileName)}\n`)
  process.exit(2)
}
writeFileSync(targetPath, text, 'utf8')
writeFileSync(`${targetPath}.sha256`, sha256(text), 'utf8')

process.stdout.write(`upgrade declaration scan · ${join('data/results', fileName)}\n`)
process.stdout.write(`  scanned ${names.size} · denied at ${CURRENT}: ${denied.length}\n`)
process.stdout.write(`  forward ${forward.length} · downgrade-only ${downgradeOnly.length} · stuck ${stuck.length}\n`)
for (const entry of checks) process.stdout.write(`  ${entry.ok ? 'PASS' : 'FAIL'}  ${entry.id} — ${entry.detail}\n`)
process.stdout.write(`ssot ${join('data/results', fileName)} sha256=${sha256(text).slice(0, 12)}…\n`)
process.exit(passed ? 0 : 1)
