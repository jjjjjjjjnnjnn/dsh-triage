/**
 * The browser half of T-401 (`packages/plugin/client.js`).
 *
 * WHY `node:vm` AND NOT A BUNDLER: the Host serves `client.js` as a CLASSIC script that must call
 * `window.__ModuleLoader__.load({ id, factory })` itself (contract C1 in docs/specs/M4-surface.md
 * §3.1). There is nothing to import, so the only honest way to test it is to execute the shipped
 * file with a fake loader and a fake `ctx` — exactly what the test below does.
 *
 * THE PROPERTY THIS FILE EXISTS TO PIN: a contract mismatch must produce ZERO registrations.
 * A half-registered tab (or a thrown error) would break the settings page of a user whose DSH is
 * newer than the contract we verified against. "Nothing happens" is the correct failure mode.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOURCE_PATH = join(repoRoot, 'packages', 'plugin', 'client.js')
const MANIFEST_PATH = join(repoRoot, 'packages', 'plugin', 'package.json')

interface Exports {
  readonly NS: string
  readonly inject: readonly string[]
  readonly apply: (ctx: unknown) => unknown
  readonly register: (ctx: unknown, require: (id: string) => unknown) => unknown
}

/** Execute the shipped file with a fake loader and return what the factory exported. */
function loadBundle(options: { react?: boolean } = {}) {
  const source = readFileSync(SOURCE_PATH, 'utf8')
  const loaded: Array<{ id: string; factory: (require: (id: string) => unknown) => Exports }> = []
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (entry: { id: string; factory: (require: (id: string) => unknown) => Exports }) => {
          loaded.push(entry)
        },
      },
    },
    Promise,
    String,
    Array,
    Object,
  }
  vm.runInNewContext(source, sandbox, { filename: SOURCE_PATH })
  assert.equal(loaded.length, 1, 'the bundle must register itself exactly once with the loader')
  const entry = loaded[0]!
  assert.equal(entry.id, 'dsh-triage')
  const requireFake = (id: string): unknown => {
    if (options.react === false) throw new Error(`module "${id}" is not available`)
    if (id === 'react') {
      return {
        useState: (initial: unknown) => [initial, () => {}],
        useEffect: () => {},
        useCallback: (fn: unknown) => fn,
      }
    }
    if (id === 'react/jsx-runtime') return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) }
    throw new Error(`unexpected require("${id}")`)
  }
  return { exports: entry.factory(requireFake), requireFake, source }
}

interface FakeContext {
  registrations: Array<Record<string, unknown>>
  components: unknown[]
  dictionaryCalls: Array<{ ns: string; copy: Record<string, unknown> }>
  injectSlot: string | null
  invokeInjection: () => unknown
  ctx: Record<string, unknown>
}

function fakeContext(options: { slots?: boolean; locale?: boolean; effect?: boolean; remote?: unknown } = {}): FakeContext {
  const registrations: Array<Record<string, unknown>> = []
  const components: unknown[] = []
  const dictionaryCalls: Array<{ ns: string; copy: Record<string, unknown> }> = []
  const state = { injectSlot: null as string | null, callback: null as null | (() => unknown) }
  const slots =
    options.slots === false
      ? {}
      : {
          inject: (slot: string, callback: () => unknown) => {
            state.injectSlot = slot
            state.callback = callback
          },
          register: (registration: Record<string, unknown>, component: unknown) => {
            registrations.push(registration)
            components.push(component)
            return registration
          },
        }
  const locale =
    options.locale === false
      ? {}
      : {
          register: (ns: string, copy: Record<string, unknown>) => {
            dictionaryCalls.push({ ns, copy })
          },
          bind: (ns: string) => (key: string) => `${ns}:${key}`,
        }
  const ctx: Record<string, unknown> = {
    slots,
    locale,
    remote: options.remote,
    ...(options.effect === false ? {} : { effect: (fn: () => void) => fn() }),
  }
  return {
    registrations,
    components,
    dictionaryCalls,
    get injectSlot() {
      return state.injectSlot
    },
    invokeInjection: () => (state.callback === null ? undefined : state.callback()),
    ctx,
  }
}

test('the bundle registers with the documented loader id and declares the services it needs', () => {
  const { exports } = loadBundle()
  assert.equal(exports.NS, 'compat-triage', 'the row id is also the settings namespace (S3)')
  assert.deepEqual(
    [...exports.inject].sort(),
    ['locale', 'modules', 'remote', 'remote.pluginInventory', 'slots'],
    'C4: the exact client services the upstream inventory tab injects',
  )
  assert.equal(typeof exports.apply, 'function')
})

test('the tab is registered with the plugins slot when the whole contract is present', () => {
  const { exports } = loadBundle()
  const fake = fakeContext()
  const registration = exports.apply(fake.ctx)
  assert.equal(fake.injectSlot, 'settings.plugins.tab', 'C2: the plugins tab slot, not a private one')
  assert.equal(fake.dictionaryCalls.length, 1, 'C5: one dictionary registration')
  assert.equal(fake.dictionaryCalls[0]!.ns, 'compat-triage')
  assert.ok(fake.dictionaryCalls[0]!.copy.zh && fake.dictionaryCalls[0]!.copy.en, 'both locales are shipped')
  assert.equal(fake.registrations.length, 0, 'C2: registration happens inside the slot injection')
  assert.equal(fake.invokeInjection(), fake.registrations[0])
  const first = fake.registrations[0]!
  assert.equal(first.name, 'settings.plugins.tab')
  assert.equal(first.id, 'compat-triage', '铁律 9: our row ids are compat- prefixed')
  assert.equal(first.order, 90)
  assert.equal(first.locale, 'compat-triage')
  assert.equal(typeof first.label, 'function')
  assert.equal(typeof first.inject, 'function')
  assert.equal(registration, null, 'injection is lazy: the Host decides when the tab is mounted')
})

test('a missing slots service registers nothing instead of half-rendering a tab', () => {
  const { exports } = loadBundle()
  const fake = fakeContext({ slots: false })
  assert.equal(exports.apply(fake.ctx), null)
  assert.equal(fake.registrations.length, 0)
  assert.equal(fake.dictionaryCalls.length, 0, 'not even the dictionaries: the whole block is skipped')
})

test('a missing locale service registers nothing', () => {
  const { exports } = loadBundle()
  const fake = fakeContext({ locale: false })
  assert.equal(exports.apply(fake.ctx), null)
  assert.equal(fake.registrations.length, 0)
})

test('a host that cannot expose react registers nothing (no error page, no tab)', () => {
  const { exports } = loadBundle({ react: false })
  const fake = fakeContext()
  assert.equal(exports.apply(fake.ctx), null)
  assert.equal(fake.registrations.length, 0)
  assert.equal(fake.dictionaryCalls.length, 0)
})

test('an unexpected contract shape throws inside apply and is swallowed', () => {
  const { exports } = loadBundle()
  const hostile = new Proxy(
    {},
    {
      get: () => {
        throw new Error('boom')
      },
    },
  )
  assert.equal(exports.apply(hostile), null, 'apply must never propagate a contract error')
})

test('the injected loader reports failure instead of inventing an inventory count', async () => {
  const { exports } = loadBundle()

  const noRemote = fakeContext({ remote: {} })
  exports.apply(noRemote.ctx)
  noRemote.invokeInjection()
  const missing = await (noRemote.registrations[0]!.inject as () => { load: () => Promise<{ ok: boolean; count: number | null; detail: string | null }> })().load()
  assert.equal(missing.ok, false, 'no Remote means "I cannot see it", not "0 rows"')
  assert.equal(missing.count, null)
  assert.match(String(missing.detail), /pluginInventory/)

  const good = fakeContext({ remote: { pluginInventory: { list: async () => ({ ok: true, value: { entries: [{}, {}, {}] } }) } } })
  exports.apply(good.ctx)
  good.invokeInjection()
  const ok = await (good.registrations[0]!.inject as () => { load: () => Promise<{ ok: boolean; count: number | null }> })().load()
  assert.equal(ok.ok, true)
  assert.equal(ok.count, 3)

  const failing = fakeContext({ remote: { pluginInventory: { list: async () => ({ ok: false, error: { code: 'unavailable', message: 'host busy' } }) } } })
  exports.apply(failing.ctx)
  failing.invokeInjection()
  const failed = await (failing.registrations[0]!.inject as () => { load: () => Promise<{ ok: boolean; count: number | null; detail: string | null }> })().load()
  assert.equal(failed.ok, false)
  assert.equal(failed.count, null)
  assert.match(String(failed.detail), /unavailable/)
})

test('the tab component renders from injected props and never touches host modules', () => {
  const { exports, source } = loadBundle()
  const fake = fakeContext()
  exports.apply(fake.ctx)
  fake.invokeInjection()
  const Component = fake.components[0] as (props: unknown) => Record<string, unknown>
  assert.equal(typeof Component, 'function', 'C2: slots.register receives the component as its second argument')
  const copy = {
    tab: 'Triage',
    title: 'Triage title',
    hint: 'hint',
    command: 'dsh-triage audit',
    commandHint: 'run it',
    rows: 'rows: {count}',
    rowsUnknown: 'no inventory',
    rowsFact: 'a count is a fact',
    reload: 'Refresh',
    failed: 'Read failed',
    panel: 'panel',
  }
  const tree = Component({ copy, load: async () => ({ ok: true, count: 2, detail: null }) })
  const text = JSON.stringify(tree)
  assert.match(text, /Triage title/, 'the tab renders its own copy')
  assert.match(text, /dsh-triage audit/, 'and it points the user at the CLI, which owns the verdicts')
  assert.match(text, /no inventory/, 'with no count yet it says so instead of showing 0')

  // The bundle must not import host-side modules (S2): only react + the jsx runtime are allowed.
  const requires = [...source.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((match) => match[2])
  assert.deepEqual([...new Set(requires)].sort(), ['react', 'react/jsx-runtime'])
  assert.ok(!source.includes('@dsh-triage/'), 'the browser half must not reference our host packages')
  assert.ok(!/require\((['"])node:/.test(source), 'the browser half must not require node builtins')
})

test('the manifest declares the browser half exactly the way the Host discovers it', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    files: string[]
    dsh: { bundle: { patch: string }; client: { platform: string; inject: string[] } }
  }
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-api-remotes',
  ])
  assert.ok(manifest.files.includes('client.js'), 'the packed tarball must ship the browser half')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml', 'the host half is unchanged')
})
