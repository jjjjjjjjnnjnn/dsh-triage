/**
 * Shared live-sampling machinery for the Host probes.
 *
 * WHY IT IS SHARED: two recorders now boot the same sandbox Host (`record_live_inventory`
 * for phases, `record_live_capabilities` for the tool registry). Two copies of
 * "write overlay → spawn → wait for the hook → kill the tree → prove the port closed"
 * would drift, and the drift would be invisible until one of them sampled a different
 * moment than the other.
 *
 * Every function here is deliberately dumb: it starts a process, waits for a file, and
 * kills the tree. Judging what came back is the caller's job.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Redact a path that may arrive as native (backslashes), POSIX-ish (forward slashes) or a
 * percent-encoded `file:///` URL — the loader spells our own probe row as the last one,
 * and missing that shape published `C:/Users/<name>/...` in a first draft.
 */
export function makeRedactor(roots) {
  const label = (root) => (root === roots[0] ? '<repo>' : '~')
  return (value) => {
    let text = String(value)
    if (text.includes('%')) {
      try {
        text = decodeURIComponent(text)
      } catch {
        // Not percent-encoded after all; keep the original.
      }
    }
    for (const root of roots) {
      if (root === '') continue
      for (const variant of [root, root.replaceAll('\\', '/')]) text = text.split(variant).join(label(root))
    }
    return text
  }
}

/** Recursively redact every string in a JSON-ish value. */
export function redactDeep(value, redact) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = redactDeep(item, redact)
    return out
  }
  return value
}

/**
 * Boot the Host with a one-entry launcher overlay that mounts `hookSource`, wait for the
 * hook to write `samplePath`, then kill the whole process tree.
 *
 * @returns `{ payload, host, error }` — `payload` is null when the hook wrote nothing.
 */
export async function bootAndSample(options) {
  const {
    dshMain,
    dshHome,
    profile,
    profileDir,
    hookSource,
    scratchRoot,
    config = {},
    extraPatch = [],
    timeoutMs = 180000,
  } = options
  mkdirSync(scratchRoot, { recursive: true })
  const probeDir = mkdtempSync(join(scratchRoot, 'triage-live-'))
  const samplePath = join(probeDir, 'sample.json')
  const patchPath = join(probeDir, 'overlay.patch.yml')
  const hookPath = join(probeDir, 'inventory-hook.mjs')
  let child = null
  try {
    copyFileSync(hookSource, hookPath)
    const configLines = [
      `        out: '${samplePath.replaceAll('\\', '/')}'`,
      `        resolveFrom: '${profileDir.replaceAll('\\', '/')}'`,
      `        profile: '${profile}'`,
      ...Object.entries(config).map(([key, value]) => `        ${key}: ${JSON.stringify(value)}`),
    ]
    writeFileSync(
      patchPath,
      [
        '- insert:',
        '    - id: triage-inventory-probe',
        "      name: './inventory-hook.mjs'",
        '      config:',
        ...configLines,
        // Experiment overlays come after the probe so a row the probe targets is already
        // composed when the overlay patches it (the launcher applies them in order).
        ...extraPatch.flatMap((entry) => [
          `- id: ${entry.id}`,
          ...(entry.name === undefined ? [] : [`  name: '${entry.name}'`]),
          ...(entry.disabled === undefined ? [] : [`  disabled: ${entry.disabled}`]),
        ]),
        '',
      ].join('\n'),
      'utf8',
    )

    const started = Date.now()
    child = spawn(process.execPath, [dshMain, '--profile', profile, '--patch', patchPath], {
      env: { ...process.env, DSH_HOME: dshHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    while (Date.now() - started < timeoutMs && !existsSync(samplePath)) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    }
    const collected = existsSync(samplePath)
    const seconds = Math.round((Date.now() - started) / 100) / 10
    killTree(child)
    await new Promise((resolveWait) => setTimeout(resolveWait, 1200))

    const host = {
      status: collected ? 'sampled' : 'no-sample',
      seconds,
      log_sha256: sha256Of(`${stdout}\n${stderr}`),
      first_line: (stderr.trimEnd().split(/\r?\n/)[0] ?? stdout.trimEnd().split(/\r?\n/)[0] ?? '').slice(0, 240),
      // Kept short and only on failure: a blocked boot must explain itself, but a healthy
      // one should not carry a log into a publishable artifact.
      error_tail: collected ? null : stderr.trimEnd().slice(-1500),
    }
    if (!collected) return { payload: null, host, error: 'the hook wrote nothing within the timeout' }
    const payload = JSON.parse(readFileSync(samplePath, 'utf8').replace(/^\uFEFF/, ''))
    return { payload, host, error: null }
  } finally {
    if (child !== null) killTree(child)
    rmSync(probeDir, { recursive: true, force: true })
  }
}

/** On Windows the Host keeps helper processes alive; kill the tree, not the parent. */
export function killTree(child) {
  try {
    child.kill()
  } catch {
    // Already gone.
  }
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { encoding: 'utf8' })
  }
}

/** Deterministic digest used in artifacts instead of storing logs. */
export function sha256Of(text) {
  return createHash('sha256').update(String(text)).digest('hex')
}

/** The dsh CLI entry inside an install directory, or '' when it is not there. */
export function dshMainOf(installDir) {
  return installDir === '' ? '' : join(installDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/** Resolve a caller-supplied path against the repo root unless it is already absolute. */
export function pathFor(value, repoRoot) {
  return resolve(repoRoot, String(value))
}
