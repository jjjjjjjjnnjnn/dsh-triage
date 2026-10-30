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
 *
 * R51 ADDED A SECOND PROPERTY: the tab may only show what the Host payload said. Four different
 * failures (no route / unreadable profile / no summary field / dead process) each get their own
 * sentence and none of them may render as a table of zeros — a zero-filled table reads as "fine".
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

interface Views {
  readonly summaryView: (summary: unknown, copy: Record<string, string>, onRefresh: () => void) => Record<string, unknown>
  readonly failureView: (result: unknown, copy: Record<string, string>, onRefresh: () => void) => Record<string, unknown>
}

interface Exports {
  readonly NS: string
  readonly inject: readonly string[]
  readonly apply: (ctx: unknown) => unknown
  readonly register: (ctx: unknown, require: (id: string) => unknown) => unknown
  readonly views: () => Views | null
}

/** Execute the shipped file with a fake loader and return what the factory exported. */
function loadBundle(options: { react?: boolean; fetch?: (url: string, init?: unknown) => Promise<unknown> } = {}) {
  const source = readFileSync(SOURCE_PATH, 'utf8')
  const loaded: Array<{ id: string; factory: (require: (id: string) => unknown) => Exports }> = []
  const sandbox: { window: Record<string, unknown> } = {
    window: {
      __ModuleLoader__: {
        load: (entry: { id: string; factory: (require: (id: string) => unknown) => Exports }) => {
          loaded.push(entry)
        },
      },
    },
  }
  /*
   * The tab reads the Host's read-only route over `fetch` (R33), so the vm sandbox gets a `fetch`
   * like a browser would. Default: a failing fetch, so a test that forgets to provide one cannot
   * accidentally look like a healthy Host.
   */
  ;(sandbox as unknown as Record<string, unknown>).fetch =
    options.fetch ??
    (async () => ({ ok: false, status: 599, json: async () => ({ error: 'no fetch configured in this test' }) }))
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
  return { exports: entry.factory(requireFake), requireFake, source, window: sandbox.window as Record<string, unknown> }
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
    ['locale', 'modules', 'slots'],
    'C4: the tab needs the slot + locale; the Host facts arrive over the read-only route, not a Remote',
  )
  assert.equal(typeof exports.apply, 'function')
})

test('the tab is registered with the plugins slot when the whole contract is present', () => {
  const { exports } = loadBundle()
  const fake = fakeContext()
  const registered = exports.apply(fake.ctx)
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
  assert.equal(registered, true, 'the Host accepted the registration; it mounts lazily')
})

test('apply publishes a marker so a real page can be asked whether the tab registered', () => {
  // R31: "the Host serves the bundle" and "the tab registered" are different claims. The marker
  // is what lets a CDP check read the second one instead of guessing from the DOM.
  const { exports, window } = loadBundle()
  const fake = fakeContext()
  exports.apply(fake.ctx)
  const marker = window.__dshTriage as { registered: boolean; slot: string; id: string; route: string }
  assert.equal(marker.registered, true)
  assert.equal(marker.slot, 'settings.plugins.tab')
  assert.equal(marker.id, 'compat-triage')
  assert.equal(marker.route, '/compat-triage/summary', 'R51: the marker names the route the tab reads')

  const refused = loadBundle()
  const withoutSlots = fakeContext({ slots: false })
  refused.exports.apply(withoutSlots.ctx)
  const refusedMarker = refused.window.__dshTriage as { registered: boolean; reason: string }
  assert.equal(refusedMarker.registered, false, 'a refusal is published too, with its reason')
  assert.equal(refusedMarker.reason, 'contract-missing')
})

test('a missing slots service registers nothing instead of half-rendering a tab', () => {
  const { exports } = loadBundle()
  const fake = fakeContext({ slots: false })
  assert.equal(exports.apply(fake.ctx), false)
  assert.equal(fake.registrations.length, 0)
  assert.equal(fake.dictionaryCalls.length, 0, 'not even the dictionaries: the whole block is skipped')
})

test('a missing locale service registers nothing', () => {
  const { exports } = loadBundle()
  const fake = fakeContext({ locale: false })
  assert.equal(exports.apply(fake.ctx), false)
  assert.equal(fake.registrations.length, 0)
})

test('a host that cannot expose react registers nothing (no error page, no tab)', () => {
  const { exports } = loadBundle({ react: false })
  const fake = fakeContext()
  assert.equal(exports.apply(fake.ctx), false)
  assert.equal(fake.registrations.length, 0)
  assert.equal(fake.dictionaryCalls.length, 0)
})

test('an unexpected contract shape throws inside apply and is swallowed', () => {
  const { exports, window } = loadBundle()
  const hostile = new Proxy(
    {},
    {
      get: () => {
        throw new Error('boom')
      },
    },
  )
  assert.equal(exports.apply(hostile), false, 'apply must never propagate a contract error')
  // The marker is created inside the vm realm, so compare fields rather than prototypes.
  const marker = window.__dshTriage as { registered: boolean; reason: string; id: string }
  assert.equal(marker.registered, false)
  assert.equal(marker.reason, 'contract-mismatch')
  assert.equal(marker.id, 'compat-triage')
})

/** What the tab's `inject()` hands the component (C3). */
interface LoadedSummary {
  readonly tone: string
  readonly headline: string
  readonly plain: string
  readonly counts: Record<string, number>
  readonly issues: ReadonlyArray<Record<string, unknown>>
  readonly more: number
  readonly next: ReadonlyArray<Record<string, string>>
}

interface InjectedTab {
  readonly locale: string
  readonly copy: Record<string, string>
  readonly load: () => Promise<{ ok: boolean; kind: string | null; detail: string | null; summary: LoadedSummary | null }>
}

/** Mount the tab the way the Host does: invoke the lazy injection, then read its props. */
function mountTab(fake: FakeContext, exports: Exports): {
  Component: (props: unknown) => Record<string, unknown>
  injected: InjectedTab
  views: Views
} {
  fake.invokeInjection()
  const registration = fake.registrations[0]
  assert.ok(registration, 'the slot registration must exist')
  const inject = registration.inject
  assert.equal(typeof inject, 'function')
  const injected = (inject as () => InjectedTab)()
  const component = fake.components[0]
  assert.equal(typeof component, 'function', 'C2: slots.register receives the component as its second argument')
  const views = exports.views()
  assert.ok(views, 'the pure views are exposed once the tab renders (test seam only)')
  /*
   * The fake `locale.bind` resolves to `ns:key` placeholders, so use the registered English
   * dictionary here: the assertions below are about real sentences, not about the binding.
   */
  const dictionary = fake.dictionaryCalls[0]?.copy.en as Record<string, string> | undefined
  assert.ok(dictionary, 'C5: the dictionary is registered before the tab is injected')
  return {
    Component: component as (props: unknown) => Record<string, unknown>,
    injected: { ...injected, copy: dictionary },
    views,
  }
}

test('the tab reads the summary projection and never invents a number', async () => {
  const summary = {
    tone: 'broken',
    headline: '2 rows will break',
    plain: 'Two of your plugins will break on this version.',
    counts: { rows: 7, judged: 5, go: 3, denied: 2, unknown: 0, collisions: 0, duplicateCopies: 0, errors: 0 },
    issues: [
      {
        id: 'dsh-mcp-connector',
        kind: 'denied',
        line: 'declared 0.2.1-rc.4',
        plain: 'cannot load here',
        fix: 'dsh-triage fix dsh-mcp-connector',
      },
    ],
    more: 1,
    next: [{ label: 'why', command: 'dsh-triage why' }],
  }
  const payload = { env: { dsh: '0.2.1-rc.4', profile: 'web' }, summary: { zh: summary, en: summary }, ms: 12 }

  const good = loadBundle({ fetch: async () => ({ ok: true, status: 200, json: async () => payload }) })
  const goodFake = fakeContext()
  good.exports.apply(goodFake.ctx)
  const { injected } = mountTab(goodFake, good.exports)
  const loaded = await injected.load()
  assert.equal(loaded.ok, true)
  assert.equal(injected.locale, 'en', 'the payload locale follows the Host binding, not navigator')
  // Spread first: the object is created inside the vm realm, so only its fields may be compared.
  assert.deepEqual({ ...loaded.summary!.counts }, summary.counts, 'counts are the payload verbatim')

  /*
   * THE FOUR FAILURES HAVE FOUR MEANINGS. Collapsing them into "0 rows" is precisely the mistake
   * this repository exists to attribute, so each is pinned separately.
   */
  const cases: Array<{ name: string; plugin: ReturnType<typeof loadBundle>; kind: string; detail?: RegExp }> = [
    {
      name: 'the profile serves no web surface',
      plugin: loadBundle({ fetch: async () => ({ ok: false, status: 404, json: async () => ({ error: 'not found' }) }) }),
      kind: 'route-missing',
    },
    {
      name: 'the profile could not be read',
      plugin: loadBundle({
        fetch: async () => ({ ok: false, status: 409, json: async () => ({ error: 'profile-not-found — no such profile' }) }),
      }),
      kind: 'http',
      detail: /profile-not-found/,
    },
    {
      name: 'the route answered without a summary field',
      plugin: loadBundle({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ env: {} }) }) }),
      kind: 'no-summary',
    },
    {
      name: 'the route was not there at all',
      plugin: loadBundle({
        fetch: async () => {
          throw new Error('failed to fetch')
        },
      }),
      kind: 'thrown',
    },
  ]
  for (const entry of cases) {
    const fake = fakeContext()
    entry.plugin.exports.apply(fake.ctx)
    const loadedCase = await mountTab(fake, entry.plugin.exports).injected.load()
    assert.equal(loadedCase.ok, false, entry.name)
    assert.equal(loadedCase.kind, entry.kind, entry.name)
    if (entry.detail !== undefined) assert.match(String(loadedCase.detail), entry.detail, entry.name)
  }
})

test('the tab renders the payload sentence and never a hard-coded figure', () => {
  const { exports, source } = loadBundle()
  const fake = fakeContext()
  exports.apply(fake.ctx)
  const { injected, views } = mountTab(fake, exports)
  const summary: LoadedSummary = {
    tone: 'attention',
    headline: '184 rows declare nothing',
    plain: 'We cannot tell whether 184 of your plugins will load.',
    counts: { rows: 156, judged: 2, go: 1, denied: 0, unknown: 1, collisions: 0, duplicateCopies: 0, errors: 0 },
    issues: [
      { id: 'dsh-status-rotator', kind: 'unknown', line: 'declares no range', plain: 'we cannot judge this one', fix: null },
    ],
    more: 0,
    next: [{ label: 'why', command: 'dsh-triage why' }],
  }
  const tree = views.summaryView(summary, injected.copy, () => {})
  const text = JSON.stringify(tree)
  assert.match(text, /will this setup break/, 'the tab renders its own copy')
  assert.match(text, /cannot tell whether 184/, 'the plain sentence is the payload sentence, verbatim')
  assert.match(text, /dsh-status-rotator/, 'and it names the row the engine named')
  assert.match(text, /dsh-triage why/, 'the next step is the engine step, not ours')
  assert.match(text, /156/, 'the numbers shown come from the payload')
  assert.match(text, /compat-triage\/summary/, 'and it says which route answered')

  // The bundle must not import host-side modules (S2): only react + the jsx runtime are allowed.
  const requires = [...source.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((match) => match[2])
  assert.deepEqual([...new Set(requires)].sort(), ['react', 'react/jsx-runtime'])
  assert.ok(!source.includes('@dsh-triage/'), 'the browser half must not reference our host packages')
  assert.ok(!/require\((['"])node:/.test(source), 'the browser half must not require node builtins')
})

test('a failed read says "no conclusion", not a table of zeros', () => {
  const { exports } = loadBundle()
  const fake = fakeContext()
  exports.apply(fake.ctx)
  const { injected, views } = mountTab(fake, exports)
  const sentences: Record<string, RegExp> = {
    'route-missing': /serves no web surface/,
    'no-summary': /returned no summary/,
    thrown: /did not answer/,
  }
  for (const kind of Object.keys(sentences)) {
    const tree = views.failureView({ ok: false, kind, summary: null, detail: 'HTTP 404' }, injected.copy, () => {})
    const text = JSON.stringify(tree)
    assert.doesNotMatch(text, /"0"/, `${kind}: no zero-filled count is rendered`)
    assert.doesNotMatch(text, /Nothing here needs your hands/, `${kind}: an unreadable profile is not a clean one`)
    assert.match(text, sentences[kind]!, `${kind}: each failure gets its own sentence`)
  }
})

test('an empty profile is called out as a wrong home, not a clean one', () => {
  const { exports } = loadBundle()
  const fake = fakeContext()
  exports.apply(fake.ctx)
  const { injected, views } = mountTab(fake, exports)
  const summary: LoadedSummary = {
    tone: 'attention',
    headline: 'no rows',
    plain: 'This profile yielded zero plugin rows.',
    counts: { rows: 0, judged: 0, go: 0, denied: 0, unknown: 0, collisions: 0, duplicateCopies: 0, errors: 0 },
    issues: [],
    more: 0,
    next: [],
  }
  const text = JSON.stringify(views.summaryView(summary, injected.copy, () => {}))
  assert.match(text, /--dsh-home/, 'R49 lesson: zero rows usually means the wrong home, and the tab says so')
})

test('the manifest declares the browser half exactly the way the Host discovers it', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    files: string[]
    exports: Record<string, unknown>
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
  /*
   * R31, measured against a real Host: `dsh-client-modules` resolves the bundle through
   * `package.json#exports["./client"]` and throws `client-modules: <pkg> declares dsh.client but
   * exports no "./client" bundle` when it is missing — the module is then silently absent from
   * the page (the HTTP asset 404s). Declaring `dsh.client` without this export is a no-op.
   */
  assert.equal(manifest.exports['./client'], './client.js', 'the Host finds the bundle through exports["./client"]')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml', 'the host half is unchanged')
})
