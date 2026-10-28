#!/usr/bin/env node
/**
 * Record what `dsh-triage badge` renders for a package WITH evidence and for one WITHOUT (M4-b / T-402).
 *
 * WHY RUN THE CLI AND NOT THE FUNCTION: the claim is "an author can put this SVG in a README", so the
 * artifact must come from the command a user types, not from an internal call. Both cases are recorded
 * because the interesting half of the claim is the second one: no evidence must render `not measured`,
 * never a guess.
 *
 *   node scripts/record_badge.mjs --stamp <iso>
 *
 * Exit codes: 0 artifact written · 1 a case did not produce a badge · 2 bad usage.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { abs, isoStamp } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
const label = String(argOf('--label', 'badge')).replace(/[^a-zA-Z0-9._-]+/g, '-')
const resultsDir = String(argOf('--results', 'data/results'))
const outDir = String(argOf('--out', 'data/results'))
if (stamp === null) {
  process.stderr.write('usage: node scripts/record_badge.mjs --stamp <iso>\n')
  process.exit(2)
}

/** One package with a recorded measurement, and one that has never been measured. */
const CASES = [
  { id: 'measured', subject: 'dsh-status-rotator', expect: { conclusion: 'go' } },
  { id: 'not-measured', subject: 'triage-no-such-package', expect: { conclusion: null } },
]

function runCli(subject) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [abs('packages/plugin/dist/cli.js'), 'badge', subject, '--json', '--results', resultsDir],
      { cwd: abs('.'), windowsHide: true },
    )
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
  })
}

const cases = []
let failures = 0
for (const entry of CASES) {
  const result = await runCli(entry.subject)
  let payload = null
  try {
    payload = JSON.parse(result.stdout)
  } catch {
    payload = null
  }
  const ok = result.code === 0 && payload !== null
  const conclusion = payload?.evidence?.conclusion ?? null
  const expected = entry.expect.conclusion
  const matched = ok && conclusion === expected
  if (!matched) failures += 1
  cases.push({
    id: entry.id,
    subject: entry.subject,
    status: matched ? 'passed' : 'failed',
    expected_conclusion: expected,
    evidence: payload?.evidence ?? null,
    svg_sha256: payload?.svg_sha256 ?? null,
    // Keep the bytes: a badge that cannot be diffed is a badge nobody can audit.
    svg: payload?.svg ?? null,
    stderr: result.stderr.trim() === '' ? null : result.stderr.trim().slice(0, 400),
  })
}

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_badge.mjs',
  generated_at: stamp,
  label,
  outcome: { cases: cases.length, passed: cases.filter((entry) => entry.status === 'passed').length },
  evidence_dir: resultsDir,
  cases,
  limits: [
    'a badge restates a RECORDED run: it reads probe-* artifacts only, never the registry and never the network',
    'runs recorded through a diagnostic hook (sandbox.hook_config) are excluded, so a hook experiment cannot become a public claim',
    'the badge names the dsh version it was measured against; it is not portable to another runtime',
    'no measurement renders "not measured" — there is no fallback to "probably fine"',
  ],
}

const text = `${JSON.stringify(payload, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const target = join(outDir, `${label}-${stamp.replaceAll(':', '-')}.json`)
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${createHash('sha256').update(text).digest('hex')}\n`, 'utf8')
process.stdout.write(
  `${cases.map((entry) => `${entry.id}:${entry.status}`).join(' ')} · ${target.replaceAll('\\', '/').split('/data/results/').pop()}\n`,
)
process.exitCode = failures === 0 ? 0 : 1
