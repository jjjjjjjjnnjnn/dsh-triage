/**
 * dsh-triage · browser half (DSH Settings → Plugins tab).
 *
 * WHY THIS FILE IS HAND-WRITTEN AND LOADED AS A CLASSIC SCRIPT: the Host serves it at
 * `/plugins/<pkg>/client.js` and the browser executes it as a plain script that must call
 * `window.__ModuleLoader__.load({ id, factory })` itself (documented contract C1). A bundler
 * would only add a build step that can drift from the contract, so the file is plain JS that
 * also happens to be runnable under `node:vm` in a unit test (see tests/unit/client-tab.test.ts).
 *
 * CONTRACT (verified against DSH 0.2.1-rc.4, see docs/specs/M4-surface.md §3.1):
 *   C1 loader wrapper + factory(require)
 *   C2 the plugins slot is `settings.plugins.tab`; register via ctx.slots.inject(...)
 *   C3 a tab gets its data from the `inject` callback, never from importing host modules
 *   C4 services: slots, locale, remote, remote.pluginInventory, modules
 *   C5 copy goes through ctx.locale.register + bind, side effects through ctx.effect
 *   C6 a READ-ONLY tab is an accepted shape upstream, so we do not compete for a slot
 *
 * WHAT THIS TAB DELIBERATELY DOES NOT DO: it renders no verdicts. Judgement ("go / blocked /
 * unknown") is computed by the CLI and by the local `serve` panel from recorded evidence; a
 * settings tab cannot read `data/results` and must not invent a conclusion from what little the
 * browser can see (铁律 1: no evidence → no claim). So the tab shows (a) how to get the answer,
 * and (b) one honest fact it *can* verify: how many rows the Host reports (row count only,
 * labelled as a fact, never as a verdict).
 *
 * DEGRADATION IS THE DEFAULT: every registration is wrapped, and the tab is only registered
 * when the whole contract is present (slots.inject, slots.register, locale.register, a renderer).
 * A missing piece means ZERO registrations — no half-rendered tab, no error page.
 */
window.__ModuleLoader__.load({
  id: 'dsh-triage',
  factory: (require) => {
    /** Owned dictionary + registration namespace. Row id is also the settings namespace (C3/S3). */
    const NS = 'compat-triage'
    /** Services this tab needs; the loader only exposes these to `require`/ctx (C4). */
    const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory', 'modules']

    const zh = {
      tab: '分诊台',
      title: '分诊台 · 装之前判断，坏之后定位',
      hint: '结论由命令行给出（同一份证据、同一条 messageId）。这里只显示宿主事实与入口。',
      command: 'dsh-triage audit',
      commandHint: '在本机终端运行；加 --json 可拿到逐行结论。',
      rows: '宿主报告 {count} 行插件',
      rowsUnknown: '没拿到宿主插件清单（Remote 不可用）',
      rowsFact: '行数是事实，不是结论。',
      reload: '刷新',
      failed: '读取失败',
      panel: '也可以开本地面板：dsh-triage serve',
    }
    const en = {
      tab: 'Triage',
      title: 'Triage · judge before install, attribute after breakage',
      hint: 'Verdicts come from the CLI (same evidence, same messageId). This tab shows host facts and entry points only.',
      command: 'dsh-triage audit',
      commandHint: 'Run it in a local terminal; add --json for per-row verdicts.',
      rows: 'The host reports {count} plugin rows',
      rowsUnknown: 'Host plugin inventory unavailable (Remote not available)',
      rowsFact: 'A row count is a fact, not a verdict.',
      reload: 'Refresh',
      failed: 'Read failed',
      panel: 'Local panel: dsh-triage serve',
    }

    /**
     * Build the tab component. Returns null when the renderer is unavailable — a component we
     * cannot render must not be registered at all.
     */
    function makeTab(react, jsxRuntime) {
      if (react === null || jsxRuntime === null) return null
      const { useState, useEffect, useCallback } = react
      const jsx = jsxRuntime.jsx
      const jsxs = jsxRuntime.jsxs
      return function CompatTriageTab(props) {
        const copy = props.copy
        const [state, setState] = useState({ status: 'idle', count: null, detail: null })
        const load = useCallback(() => {
          let cancelled = false
          setState((previous) => ({ ...previous, status: 'loading' }))
          Promise.resolve()
            .then(() => props.load())
            .then((result) => {
              if (cancelled) return
              setState({ status: result.ok ? 'ready' : 'failed', count: result.count ?? null, detail: result.detail ?? null })
            })
            .catch((error) => {
              if (cancelled) return
              setState({ status: 'failed', count: null, detail: String((error && error.message) || error) })
            })
          return () => {
            cancelled = true
          }
        }, [props])
        useEffect(() => load(), [load])
        const rowsText =
          state.count === null
            ? copy.rowsUnknown
            : copy.rows.replace('{count}', String(state.count))
        return jsxs('div', {
          children: [
            jsx('h3', { children: copy.title }),
            jsx('p', { children: copy.hint }),
            jsxs('p', {
              children: [
                jsx('code', { children: copy.command }),
                jsx('span', { children: ` — ${copy.commandHint}` }),
              ],
            }),
            jsx('p', { children: copy.panel }),
            jsx('p', { children: rowsText }),
            jsx('p', { children: copy.rowsFact }),
            state.status === 'failed' && state.detail !== null
              ? jsx('p', { children: `${copy.failed}: ${state.detail}` })
              : null,
            jsx('button', { type: 'button', onClick: load, children: copy.reload }),
          ],
        })
      }
    }

    /**
     * Register the tab. Returns the registration (or null when nothing was registered), so the
     * unit test can assert "contract mismatch = zero registration" instead of "it threw".
     */
    function register(ctx, require) {
      if (ctx === null || typeof ctx !== 'object') return null
      const slots = ctx.slots
      const locale = ctx.locale
      if (slots === null || typeof slots !== 'object') return null
      if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') return null
      if (locale === null || typeof locale !== 'object' || typeof locale.register !== 'function') return null
      let react = null
      let jsxRuntime = null
      try {
        react = require('react')
        jsxRuntime = require('react/jsx-runtime')
      } catch {
        // The module registry of this Host does not expose React: nothing to render, so nothing
        // is registered. This is the shape a future rc that renames the module would produce.
        return null
      }
      const Tab = makeTab(react, jsxRuntime)
      if (Tab === null) return null
      const effect = typeof ctx.effect === 'function' ? ctx.effect : null
      const registerDictionaries = () => locale.register(NS, { zh, en })
      if (effect !== null) effect(registerDictionaries, 'compat-triage:dictionaries')
      else registerDictionaries()
      const t = locale.bind(NS)
      const injected = () => ({
        copy: {
          tab: t('tab'),
          title: t('title'),
          hint: t('hint'),
          command: t('command'),
          commandHint: t('commandHint'),
          rows: t('rows'),
          rowsUnknown: t('rowsUnknown'),
          rowsFact: t('rowsFact'),
          reload: t('reload'),
          failed: t('failed'),
          panel: t('panel'),
        },
        /** Facts only. A failure is reported as `{ok:false}` so the tab can say so out loud. */
        load: async () => {
          const remote = ctx.remote
          const list = remote === null || remote === undefined ? undefined : remote.pluginInventory
          if (list === undefined || list === null || typeof list.list !== 'function') {
            return { ok: false, count: null, detail: 'remote.pluginInventory.list is not available' }
          }
          try {
            const result = await list.list()
            if (!result || result.ok !== true) {
              const error = (result && result.error) || {}
              return { ok: false, count: null, detail: `${error.code || 'error'}: ${error.message || ''}`.trim() }
            }
            const value = result.value || {}
            const entries = Array.isArray(value.entries) ? value.entries : null
            return { ok: true, count: entries === null ? null : entries.length, detail: null }
          } catch (error) {
            return { ok: false, count: null, detail: String((error && error.message) || error) }
          }
        },
      })
      let registration = null
      slots.inject('settings.plugins.tab', () => {
        registration = slots.register(
          {
            name: 'settings.plugins.tab',
            id: NS,
            order: 90,
            label: () => t('tab'),
            locale: NS,
            inject: injected,
          },
          Tab,
        )
        return registration
      })
      return registration
    }

    function apply(ctx) {
      try {
        return register(ctx, require)
      } catch {
        // Never let a tab break the settings page: an unexpected contract shape means the user
        // simply does not see triage in DSH (the CLI is still there).
        return null
      }
    }

    return { NS, inject, apply, register }
  },
})
