/**
 * The agent tool `compat_verdict` (T-404, R36).
 *
 * TWO KINDS OF CLAIM ARE PINNED HERE:
 *
 *  1. the DEFINITION is one the real registry accepts — measured in R36 against
 *     `@deepseek-ai/dsh-tools/lib/index.js#register`: `output.render` must be a function,
 *     `output.schema` must be inside the supported JSON-Schema subset, `timeoutMs` positive, and
 *     the name must not be the reserved `run_code`. There is no brand/marker, which is what lets
 *     this package stay free of upstream dependencies (`ADR-0010`'s reasoning, applied again);
 *  2. the ANSWER degrades honestly. A missing manifest, an unpublished version, an aborted call
 *     and malformed arguments all end in an `unknown` verdict with `missing.admission` — never a
 *     throw, because a model that receives a stack trace cannot report anything useful.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import type { EnvFingerprint } from '@dsh-triage/core'
import {
  TOOL_DESCRIPTION,
  TOOL_NAME,
  TOOL_PARAMETERS,
  TOOL_TIMEOUT_MS,
  buildToolPayload,
  createCompatVerdictTool,
  readPackageArgument,
  resolveLocale,
} from '../../packages/plugin/dist/host-tool.js'
import { judgeFit } from '../../packages/plugin/dist/fit.js'
import { apply } from '../../packages/plugin/dist/host.js'

const stamp = '2026-10-29T12:00:00.000Z'

const env: EnvFingerprint = {
  dsh: '0.2.1-rc.4',
  node: '24.15.0',
  platform: 'win32',
  arch: 'x64',
  profile: 'web',
  // A real absolute path, so the "nothing leaves the Host unredacted" test is not vacuous.
  profileDir: 'C:/Users/test/.dsh/profiles/web',
  bundles: ['@deepseek-ai/dsh-base'],
  installed: [{ name: '@deepseek-ai/dsh', version: '0.2.1-rc.4' }],
}

/** A packument-shaped body, so the test exercises the real parser instead of a stub object. */
function packumentOf(versions: Record<string, unknown>, latest?: string): string {
  return JSON.stringify({
    name: 'example-plugin',
    'dist-tags': { latest: latest ?? Object.keys(versions).at(-1) ?? '1.0.0' },
    versions,
    time: Object.fromEntries(Object.keys(versions).map((version) => [version, '2026-10-01T00:00:00.000Z'])),
  })
}

/** A registry double: `status` 404 exercises the not-found path, a body exercises the parser. */
function registryOf(body: string | null, status = 200) {
  return async () => ({ ok: status === 200, status, text: async () => body ?? '' })
}

const toolWith = (options: Parameters<typeof createCompatVerdictTool>[0] = { readEnv: async () => ({ ok: true, env }) }) =>
  createCompatVerdictTool({
    stamp: () => stamp,
    redactionRoots: ['C:/Users/test'],
    ...options,
  })

/* ------------------------------ the definition ------------------------------ */

test('the definition is one the tool registry accepts', () => {
  const tool = toolWith()
  assert.equal(tool.name, TOOL_NAME)
  assert.equal(tool.name, 'compat_verdict')
  // `run_code` is the one reserved name; anything else is ours to take.
  assert.notEqual(tool.name, 'run_code')
  assert.ok(tool.description.length > 120, 'the description is the whole contract the model reads')
  assert.match(tool.description, /declaration/i)
  // The claim that matters: the description may not imply a security verdict or an install.
  assert.match(TOOL_DESCRIPTION, /not a security judgement/i)
  assert.match(TOOL_DESCRIPTION, /never installs/i)
  assert.equal(TOOL_TIMEOUT_MS > 0, true)
  assert.equal(tool.timeoutMs, TOOL_TIMEOUT_MS)
  assert.deepEqual(tool.output.schema, { type: 'string' })
  assert.equal(typeof tool.output.render, 'function')
  const rendered = tool.output.render({}, '{"a":1}')
  assert.deepEqual(rendered, [{ type: 'text', text: '{"a":1}' }])
})

test('the parameter schema stays inside the supported subset and names its one argument', () => {
  assert.equal(TOOL_PARAMETERS.type, 'object')
  assert.deepEqual(TOOL_PARAMETERS.required, ['package'])
  assert.deepEqual(Object.keys(TOOL_PARAMETERS.properties), ['package'])
  assert.equal(TOOL_PARAMETERS.additionalProperties, false, 'an invented argument must be refused, not ignored')
  const supported = new Set(['type', 'properties', 'required', 'additionalProperties', 'description', 'items', 'enum', 'const', 'oneOf'])
  for (const key of Object.keys(TOOL_PARAMETERS)) assert.ok(supported.has(key), `unsupported keyword ${key}`)
  for (const key of Object.keys(TOOL_PARAMETERS.properties.package)) assert.ok(supported.has(key), `unsupported keyword ${key}`)
})

test('the argument is read defensively', () => {
  assert.equal(readPackageArgument({ package: ' a@1.0.0 ' }), 'a@1.0.0')
  assert.equal(readPackageArgument({ package: 42 }), '')
  assert.equal(readPackageArgument({}), '')
  assert.equal(readPackageArgument(null), '')
  assert.equal(readPackageArgument('package=foo'), '')
})

test('the locale follows the CLI instead of inventing a third one', () => {
  assert.equal(resolveLocale('zh'), 'zh')
  assert.equal(resolveLocale('en'), 'en')
  assert.equal(resolveLocale('auto', {}), 'zh', 'the CLI default is zh')
  assert.equal(resolveLocale('auto', { DSH_TRIAGE_LOCALE: 'en' }), 'en')
  assert.equal(resolveLocale('auto', { DSH_TRIAGE_LOCALE: 'fr' }), 'zh', 'an unknown locale falls back, never guesses')
})

/* -------------------------------- the answer -------------------------------- */

test('a candidate whose declaration admits this runtime comes back go, with the CLI renderer', async () => {
  const result = await judgeFit({
    spec: 'example-plugin',
    env,
    at: stamp,
    fetchImpl: registryOf(packumentOf({ '1.0.0': { engines: { dsh: '>=0.2.0-rc.1 <0.3.0-0' } } })),
  })
  assert.equal(result.ok, true)
  assert.equal(result.verdict.conclusion, 'go')
  const payload = buildToolPayload({ result, at: stamp, locale: 'en', redactionRoots: ['C:/Users/test'] })
  assert.equal(payload['conclusion'], 'go')
  const summary = payload['summary'] as string[]
  assert.match(summary[0] ?? '', /^\[GO\] example-plugin@1\.0\.0/)
  assert.deepEqual(payload['admission'], { status: 'admitted', mode: 'engines' })
})

test('a denied declaration is blocked and carries a fix, not a prose apology', async () => {
  const result = await judgeFit({
    spec: 'example-plugin@1.0.0',
    env,
    at: stamp,
    fetchImpl: registryOf(packumentOf({ '1.0.0': { peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.2.0-rc.2 <0.2.1-0' } } })),
  })
  assert.equal(result.verdict.conclusion, 'blocked')
  assert.ok(result.verdict.remediation.length > 0)
  assert.ok(result.verdict.remediation.every((item) => item.note.length > 0))
})

test('a registry that cannot answer becomes unknown with a catalogue id, never an exception', async () => {
  const result = await judgeFit({ spec: 'no-such-plugin', env, at: stamp, fetchImpl: registryOf(null, 404) })
  assert.equal(result.ok, false)
  assert.equal(result.verdict.conclusion, 'unknown')
  const reason = result.verdict.reasons[0]
  assert.equal(reason?.messageId, 'tool.verdict-unavailable')
  assert.match(String(reason?.params?.detail), /not-found/)
  assert.deepEqual(result.verdict.missingEvidence, ['missing.admission'])
  assert.equal(result.error.kind, 'registry')
})

test('a version the registry never published is named, not rounded to the latest', async () => {
  const result = await judgeFit({
    spec: 'example-plugin@9.9.9',
    env,
    at: stamp,
    fetchImpl: registryOf(packumentOf({ '1.0.0': { engines: { dsh: '>=0.2.0 <0.3.0-0' } } })),
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.kind, 'version-not-published')
  assert.match(result.error.detail, /9\.9\.9/)
  assert.equal(result.verdict.conclusion, 'unknown')
})

test('a cancelled call says it was cancelled, not that the registry is broken', async () => {
  const result = await judgeFit({
    spec: 'example-plugin',
    env,
    at: stamp,
    signal: AbortSignal.abort(),
    fetchImpl: async () => {
      throw new Error('aborted by caller')
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.kind, 'internal')
  assert.equal(result.error.code, 'aborted')
})

/* --------------------------------- the tool --------------------------------- */

test('malformed arguments are refused by us: the registry does not validate a plain definition', async () => {
  const replies: string[] = []
  for (const args of [{}, { package: 42 }, null, 'example-plugin', { package: '   ' }]) {
    replies.push(await toolWith().execute(args))
  }
  for (const reply of replies) {
    const payload = JSON.parse(reply)
    assert.equal(payload.conclusion, 'unknown')
    assert.equal(payload.error.code, 'empty-spec')
    assert.match(String(payload.error.detail), /no package name/)
  }
})

test('an unreadable profile is not reported as a candidate problem', async () => {
  const tool = toolWith({ readEnv: async () => ({ ok: false, message: 'profile-not-found — no such profile' }) })
  const reply = await tool.execute({ package: 'example-plugin' })
  const payload = JSON.parse(reply)
  assert.equal(payload.conclusion, 'unknown')
  assert.equal(payload.error.code, 'profile-unreadable')
  assert.equal(payload.verdict.env.profile, '<unreadable>')
  // No registry read happens without a runtime to judge against; nothing claims a manifest was seen.
  assert.equal(payload.admission, null)
  assert.equal(payload.registry, null)
})

test('nothing that leaves the Host carries an absolute home path', async () => {
  const tool = toolWith({
    readEnv: async () => ({ ok: true, env }),
    judge: async () =>
      judgeFit({
        spec: 'example-plugin',
        env,
        at: stamp,
        fetchImpl: registryOf(packumentOf({ '1.0.0': { engines: { dsh: '>=0.2.0 <0.3.0-0' } } })),
      }),
  })
  const reply = await tool.execute({ package: 'example-plugin' })
  assert.equal(reply.includes('C:/Users/test'), false, 'the profile directory must be redacted')
  const payload = JSON.parse(reply)
  assert.equal(payload.verdict.env.profileDir, '~/.dsh/profiles/web')
})

test('the payload states what a go does not mean', async () => {
  const result = await judgeFit({
    spec: 'example-plugin',
    env,
    at: stamp,
    fetchImpl: registryOf(packumentOf({ '1.0.0': { engines: { dsh: '>=0.2.0 <0.3.0-0' } } })),
  })
  const payload = buildToolPayload({ result, at: stamp, locale: 'zh', redactionRoots: ['C:/Users/test'] })
  const limits = payload['limits'] as string[]
  assert.ok(limits.some((line) => /not that the plugin runs/i.test(line)))
  assert.ok(limits.some((line) => /not a security judgement/i.test(line)))
  // The zh summary is localized but keeps the structure the CLI prints.
  assert.match((payload['summary'] as string[])[0] ?? '', /^\[GO\] example-plugin@1\.0\.0/)
})

/* ------------------------------- the mounting ------------------------------- */

interface MountHarness {
  readonly ctx: Record<string, unknown>
  readonly logs: string[]
  readonly registrations: Array<{ name: string; parameters: unknown; description: string }>
  readonly routes: string[]
}

/** A Cordis double: `inject` only calls back for services that exist, like the real one. */
function harness(services: Record<string, unknown>): MountHarness {
  const logs: string[] = []
  const registrations: MountHarness['registrations'] = []
  const routes: string[] = []
  const ctx: Record<string, unknown> = {
    baseUrl: pathToFileURL('C:/dsh-home/profiles/web/'),
    logger: { info: (message: string) => logs.push(message) },
    effect: (execute: () => () => void) => execute(),
    inject: (deps: string[], callback: (scope: Record<string, unknown>) => void) => {
      if (deps.every((name) => services[name] !== undefined)) callback({ ...ctx, ...services })
      return {}
    },
    ...services,
  }
  const tools = services['tools'] as { register: (definition: { name: string }) => () => void } | undefined
  if (tools !== undefined) {
    services['tools'] = {
      ...tools,
      register: (definition: { name: string; parameters: unknown; description: string }) => {
        registrations.push(definition)
        return () => undefined
      },
    }
    ctx['tools'] = services['tools']
  }
  const webServer = services['webServer'] as { register: (route: { path: string }) => () => void } | undefined
  if (webServer !== undefined) {
    services['webServer'] = {
      ...webServer,
      register: (route: { path: string }) => {
        routes.push(route.path)
        return () => undefined
      },
    }
    ctx['webServer'] = services['webServer']
  }
  return { ctx, logs, registrations, routes }
}

/** `apply` announces on stdout as well; keep the test output readable. */
function quietly(run: () => void): void {
  const original = console.log
  console.log = () => undefined
  try {
    run()
  } finally {
    console.log = original
  }
}

test('a profile with a tool registry gets the tool even when it has no web server', () => {
  const h = harness({ tools: { register: () => () => undefined } })
  quietly(() => apply(h.ctx as never, {}))
  assert.equal(h.registrations.length, 1)
  assert.equal(h.registrations[0]?.name, 'compat_verdict')
  assert.deepEqual(h.routes, [], 'no webServer means no route, and that is not an error')
})

test('a profile with a web server still gets the route when it has no tool registry', () => {
  const h = harness({ webServer: { register: () => () => undefined } })
  quietly(() => apply(h.ctx as never, {}))
  assert.deepEqual(h.routes, ['/compat-triage/audit', '/compat-triage/summary'], 'R51: the tab reads the summary route; both are registered together')
  assert.equal(h.registrations.length, 0)
})

test('a profile with neither service mounts nothing, and says why', () => {
  const h = harness({})
  quietly(() => apply(h.ctx as never, {}))
  assert.equal(h.registrations.length, 0)
  assert.deepEqual(h.routes, [])
  assert.equal(h.logs.length, 0, 'two gates that never became available say nothing; the anchor did resolve')
})

test('the tool can be turned off without unpatching the row', () => {
  const h = harness({ tools: { register: () => () => undefined }, webServer: { register: () => () => undefined } })
  quietly(() => apply(h.ctx as never, { agentTool: false }))
  assert.equal(h.registrations.length, 0)
  assert.deepEqual(h.routes, ['/compat-triage/audit', '/compat-triage/summary'], 'the other half keeps working')
})

test('an unanchored profile mounts neither half and says so', () => {
  const h = harness({ tools: { register: () => () => undefined }, webServer: { register: () => () => undefined } })
  h.ctx['baseUrl'] = pathToFileURL('C:/elsewhere/cordis.yml')
  quietly(() => apply(h.ctx as never, {}))
  assert.equal(h.registrations.length, 0)
  assert.deepEqual(h.routes, [])
  assert.match(h.logs.join(' '), /without a profile anchor/)
})
