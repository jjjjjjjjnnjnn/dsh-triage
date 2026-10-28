#!/usr/bin/env node
/**
 * Record a format-1 market index built from our own evidence, VALIDATED by the upstream validator
 * (M4-b / T-403).
 *
 * WHY THE UPSTREAM VALIDATOR: DSH's plugin market parses indexes with
 * `@deepseek-ai/dsh-plugin-market-index`; re-implementing the format here would be a second engine that
 * drifts (the same rule this repo applies to verdicts). So the script runs our generator, then hands
 * the document to the real validator read from the sandbox install. If the validator is absent the
 * result is `unmeasured` — "we could not check" is never "it is valid".
 *
 *   node scripts/record_index_source.mjs --validator <dir> --stamp <iso>
 *
 * Exit codes: 0 artifact written · 1 the document failed validation · 2 bad usage.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { abs, isoStamp } from './lib/kit.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const stamp = isoStamp(String(argOf('--stamp', new Date().toISOString())))
const label = String(argOf('--label', 'index-source')).replace(/[^a-zA-Z0-9._-]+/g, '-')
const resultsDir = String(argOf('--results', 'data/results'))
const outDir = String(argOf('--out', 'data/results'))
const validatorDir = String(
  argOf('--validator', 'sandbox/upstream/0.2.1-rc.4/install/node_modules/@deepseek-ai/dsh-plugin-market-index'),
)
const indexUrl = String(argOf('--index-url', 'https://triage.invalid/index.json'))
if (stamp === null) {
  process.stderr.write('usage: node scripts/record_index_source.mjs --validator <dir> --stamp <iso>\n')
  process.exit(2)
}

/** Ask the CLI (the user-facing surface) for the document, not an internal function. */
function runCli() {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [abs('packages/plugin/dist/cli.js'), 'index', '--json', '--results', resultsDir],
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
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
  })
}

const cli = await runCli()
let record = null
try {
  record = JSON.parse(cli.stdout)
} catch {
  record = null
}
if (cli.code !== 0 || record === null) {
  process.stderr.write(`the generator did not produce an index: exit ${cli.code} ${cli.stderr.slice(-400)}\n`)
  process.exit(2)
}

/*
 * Validate with the validator the market itself uses. Imported by absolute path from the sandbox: the
 * product must not depend on an upstream package it does not ship, and a missing sandbox is a fact we
 * record rather than a reason to skip the check silently.
 */
let validation = { status: 'unmeasured', detail: `no validator at ${validatorDir}`, validator: null }
if (existsSync(join(validatorDir, 'lib', 'index.js'))) {
  try {
    const module = await import(pathToFileURL(join(validatorDir, 'lib', 'index.js')).href)
    const parsed = module.parseMarketIndex(record.document, indexUrl)
    validation = {
      status: 'passed',
      detail: `${parsed.plugins.length} plugins accepted by ${join(validatorDir, 'lib', 'index.js')}`,
      validator: JSON.parse(readFileSync(join(validatorDir, 'package.json'), 'utf8')).version ?? null,
      index_url: indexUrl,
    }
  } catch (error) {
    validation = {
      status: 'failed',
      detail: String(error && error.message ? error.message : error),
      validator: null,
      index_url: indexUrl,
    }
  }
}

const payload = {
  schema_version: 1,
  produced_by: 'scripts/record_index_source.mjs',
  generated_at: stamp,
  label,
  outcome: { plugins: record.plugins, versions: record.versions, validation: validation.status },
  validation,
  skipped: record.skipped ?? [],
  excluded: record.excluded ?? [],
  fetch_failures: record.fetch_failures ?? [],
  // The document itself, so the artifact can be diffed and re-validated without re-running.
  document: record.document,
  document_sha256: createHash('sha256').update(JSON.stringify(record.document)).digest('hex'),
  limits: [
    'the index contains ONLY versions a recorded probe reached "go" on; absent plugins were never measured here, which is not a judgement about them',
    'format 1 has no verdict field — unknown members are dropped by the validator — so this index filters, it never scores',
    'publishTimestamp comes from the registry per-version time; a version without one is excluded instead of guessed',
    'validated against the upstream validator in the sandbox; when it is absent the result is "unmeasured", never "valid"',
  ],
}

const text = `${JSON.stringify(payload, null, 2)}\n`
mkdirSync(outDir, { recursive: true })
const target = join(outDir, `${label}-${stamp.replaceAll(':', '-')}.json`)
writeFileSync(target, text, 'utf8')
writeFileSync(`${target}.sha256`, `${createHash('sha256').update(text).digest('hex')}\n`, 'utf8')
process.stdout.write(
  `${validation.status} · ${record.plugins} plugins / ${record.versions} versions · ${resolve(target).replaceAll('\\', '/').split('/data/results/').pop()}\n`,
)
process.exitCode = validation.status === 'failed' ? 1 : 0
