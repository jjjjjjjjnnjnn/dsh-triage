/**
 * Shared helpers for the gate scripts.
 *
 * HARD RULE: gates use Node built-ins only. A gate that cannot run because a
 * dependency is missing is worse than no gate — it silently turns "unknown" into
 * "green". Keep this file dependency-free.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

export function abs(relativePath) {
  return join(repoRoot(), relativePath)
}

export function readText(relativePath) {
  return readFileSync(abs(relativePath), 'utf8')
}

export function readJson(relativePath) {
  return JSON.parse(readText(relativePath))
}

export function exists(relativePath) {
  return existsSync(abs(relativePath))
}

export function isDirectory(relativePath) {
  try {
    return statSync(abs(relativePath)).isDirectory()
  } catch {
    return false
  }
}

export function listDir(relativePath) {
  try {
    return readdirSync(abs(relativePath), { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
    }))
  } catch {
    return []
  }
}

export function listFilesRecursive(relativePath) {
  const out = []
  const walk = (current) => {
    for (const entry of listDir(current)) {
      const next = relativePath === '' ? entry.name : `${relativePath}/${entry.name}`
      if (entry.isDirectory) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
        walk(next)
      } else if (entry.isFile) {
        out.push(next)
      }
    }
  }
  walk(relativePath)
  return out
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function relFromRoot(absolutePath) {
  return relative(repoRoot(), absolutePath).replaceAll('\\', '/')
}

export function fileUrl(relativePath) {
  return pathToFileURL(abs(relativePath)).href
}

/** Structural check collector with deterministic JSON output. */
export class Checks {
  constructor(gate) {
    this.gate = gate
    this.items = []
  }

  add(id, ok, detail = '') {
    this.items.push({ id, ok: Boolean(ok), detail })
    return ok
  }

  /** Soft assertion promoted to a hard failure: returns the value for chaining. */
  require(id, condition, detail = '') {
    this.add(id, condition, detail)
    return condition
  }

  get failed() {
    return this.items.filter((item) => !item.ok)
  }
}

/**
 * Run a gate with consistent CLI semantics.
 *
 * - `--json` prints `{gate, ok, checks[]}`;
 * - `--mutate` asks the gate to inject a known violation: the run MUST fail.
 *   CI calls every gate in mutate mode and asserts a non-zero exit, which is how
 *   we prove a gate is not vacuously green.
 */
export async function runGate(name, buildChecks) {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  const mutate = argv.includes('--mutate')
  const strict = argv.includes('--strict')

  const checks = new Checks(name)
  let fatal = null
  try {
    await buildChecks({ checks, mutate, strict })
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error)
    checks.add('gate-executed', false, fatal)
  }

  const ok = checks.failed.length === 0
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ gate: name, ok, mutate, checks: checks.items, fatal }, null, 2)}\n`,
    )
  } else {
    for (const item of checks.items) {
      process.stdout.write(`${item.ok ? 'PASS' : 'FAIL'}  ${name}/${item.id}${item.detail ? ` — ${item.detail}` : ''}\n`)
    }
    process.stdout.write(`${ok ? 'OK' : 'FAILED'}  ${name}${mutate ? ' (mutate)' : ''}\n`)
  }
  process.exitCode = ok ? 0 : 1
}
