/**
 * Build a throwaway bundle out of the workspace packages, for scripts that need a REAL Host.
 *
 * WHY THIS IS SHARED (R36): both real-machine recorders (`record_client_serve.mjs` for the settings
 * tab, `record_agent_tool.mjs` for the agent tool) need the same four packages installed into a
 * sandbox profile as `file:` dependencies. Two copies of that rewrite would drift, and the
 * `workspace:` protocol is exactly the kind of thing that fails silently once it drifts (R31 had to
 * rewrite it for EVERY package, not just the plugin).
 *
 * No registry and no credentials are involved: the packages come from this working tree.
 */

import { cpSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** `<directory in the bundle>`, `<path in the repo>`, `<published package name>`. */
export const WORKSPACE_PACKAGES = [
  ['core', 'packages/core', '@dsh-triage/core'],
  ['probe', 'packages/probe', '@dsh-triage/probe'],
  ['signals', 'packages/signals', '@dsh-triage/signals'],
  ['plugin', 'packages/plugin', 'dsh-triage'],
]

/**
 * Copy the packages under `targetRoot`, rewrite their `workspace:` dependencies to `file:`
 * references between the copies, and return the plugin entry point plus what it now depends on.
 *
 * @param {{ targetRoot: string, pathFor: (value: string) => string }} options
 * @returns {{ dir: string, dependencies: Record<string, string> }}
 */
export function buildWorkspaceBundle(options) {
  const { targetRoot, pathFor } = options
  mkdirSync(targetRoot, { recursive: true })
  const copied = []
  for (const [dirName, source, packageName] of WORKSPACE_PACKAGES) {
    cpSync(pathFor(source), join(targetRoot, dirName), {
      recursive: true,
      // Sources and build metadata are not part of what a user installs.
      filter: (from) => !/[\\/](node_modules|src|lib)[\\/]/.test(from) && !from.endsWith('.ts'),
    })
    copied.push({ dirName, packageName })
  }
  const rewrittenByPackage = {}
  for (const { dirName } of copied) {
    const manifestPath = join(targetRoot, dirName, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const rewritten = {}
    for (const [key, value] of Object.entries(manifest.dependencies ?? {})) {
      const match = copied.find((entry) => entry.packageName === key)
      rewritten[key] = match === undefined ? value : `file:../${match.dirName}`
    }
    manifest.dependencies = rewritten
    // Dev dependencies are not installed by a user, and they carry `workspace:` protocols.
    delete manifest.devDependencies
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    rewrittenByPackage[dirName] = rewritten
  }
  return { dir: join(targetRoot, 'plugin'), dependencies: rewrittenByPackage.plugin ?? {} }
}

/**
 * The profile manifest a sandbox needs in order to boot a web Host with our bundle.
 *
 * The three `@deepseek-ai/dsh*` packages are what the probe sandbox already runs; without a base
 * and an app the Host has nothing to serve and never prints a URL (R31 tried).
 */
export function sandboxProfileManifest(options) {
  const { bundleDir, runtimeVersion, name } = options
  return {
    name,
    private: true,
    dependencies: {
      '@deepseek-ai/dsh': runtimeVersion,
      '@deepseek-ai/dsh-base': runtimeVersion,
      '@deepseek-ai/dsh-web-app': runtimeVersion,
      'dsh-triage': `file:${bundleDir.replaceAll('\\', '/')}`,
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-triage'] } },
  }
}

/**
 * The pnpm policy every sandbox uses (`ADR-0007`): `strictDepBuilds: false` turns "unapproved build
 * script" from a fatal error into a warning. It approves and runs nothing.
 */
export const SANDBOX_PNPM_WORKSPACE = [
  '# written by dsh-triage recorders: do not fail the install over unapproved builds.',
  'strictDepBuilds: false',
  '',
].join('\n')
