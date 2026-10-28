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
    const inject = ['slots', 'locale', 'modules']

    const zh = {
      tab: '分诊台',
      title: '分诊台 · 装之前判断，坏之后定位',
      hint: '结论由命令行的同一个引擎给出（同一份证据、同一条 messageId）。这里只显示宿主事实与入口。',
      command: 'dsh-triage audit',
      commandHint: '在本机终端运行；加 --json 可拿到逐行结论。',
      rows: '宿主报告 {count} 行插件',
      rowsUnknown: '没拿到宿主插件清单（只读路由不可用）',
      rowsFact: '行数是事实，不是结论。',
      verdicts: 'CLI 同一引擎的结论：{go} go · {blocked} blocked · {unknown} unknown',
      verdictsUnknown: '没拿到结论（只读路由不回答）',
      source: '数据来自宿主只读路由 /compat-triage/audit，与 dsh-triage audit --json 同源。',
      reload: '刷新',
      failed: '读取失败',
      panel: '也可以开本地面板：dsh-triage serve',
    }
    const en = {
      tab: 'Triage',
      title: 'Triage · judge before install, attribute after breakage',
      hint: 'Verdicts come from the same engine as the CLI (same evidence, same messageId). This tab shows host facts and entry points only.',
      command: 'dsh-triage audit',
      commandHint: 'Run it in a local terminal; add --json for per-row verdicts.',
      rows: 'The host reports {count} plugin rows',
      rowsUnknown: 'Host plugin inventory unavailable (read-only route not answering)',
      rowsFact: 'A row count is a fact, not a verdict.',
      verdicts: 'Conclusions from the CLI engine: {go} go · {blocked} blocked · {unknown} unknown',
      verdictsUnknown: 'No conclusions (the read-only route did not answer)',
      source: 'Read from the host route /compat-triage/audit, the same payload as dsh-triage audit --json.',
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
        const [state, setState] = useState({ status: 'idle', count: null, verdicts: null, detail: null })
        const load = useCallback(() => {
          let cancelled = false
          setState((previous) => ({ ...previous, status: 'loading' }))
          Promise.resolve()
            .then(() => props.load())
            .then((result) => {
              if (cancelled) return
              setState({
                status: result.ok ? 'ready' : 'failed',
                count: result.count ?? null,
                verdicts: result.verdicts ?? null,
                detail: result.detail ?? null,
              })
            })
            .catch((error) => {
              if (cancelled) return
              setState({ status: 'failed', count: null, verdicts: null, detail: String((error && error.message) || error) })
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
        const verdictsText =
          state.verdicts === null
            ? copy.verdictsUnknown
            : copy.verdicts
                .replace('{go}', String(state.verdicts.go))
                .replace('{blocked}', String(state.verdicts.blocked))
                .replace('{unknown}', String(state.verdicts.unknown))
        return jsxs('div', {
          children: [
            jsx('h3', { children: copy.title }),
            jsx('p', { children: copy.hint }),
            jsx('p', { children: rowsText }),
            jsx('p', { children: verdictsText }),
            jsx('p', { children: copy.source }),
            jsx('p', { children: copy.rowsFact }),
            jsx('p', {
              children: [
                jsx('code', { children: copy.command }),
                jsx('span', { children: ` — ${copy.commandHint}` }),
              ],
            }),
            jsx('p', { children: copy.panel }),
            state.status === 'failed' && state.detail !== null
              ? jsx('p', { children: `${copy.failed}: ${state.detail}` })
              : null,
            jsx('button', { type: 'button', onClick: load, children: copy.reload }),
          ],
        })
      }
    }

    /**
     * Publish a tiny, read-only marker for diagnostics (R31).
     *
     * WHY: "the Host serves the bundle" and "the tab actually registered in the page" are two
     * different claims. Without a marker the second one is unobservable from outside, and the
     * honest answer would stay "served, unknown whether mounted". The marker carries no user data
     * and no behaviour: `{registered, slot, id}` (plus a reason when registration was refused).
     */
    function publishMarker(marker) {
      try {
        if (typeof window === 'object' && window !== null) window.__dshTriage = marker
      } catch {
        // A frozen/blocked window is not our problem: the tab itself was already decided.
      }
    }

    /**
     * Register the tab. Returns `true` when the tab was handed to the slot, `false` when the
     * contract was not satisfied — never a thrown error, and never a half registration.
     *
     * NOTE ON THE RETURN VALUE: `ctx.slots.inject(slot, cb)` is LAZY — the Host calls `cb` when it
     * mounts the page. So `true` means "this Host accepted our registration request", which is the
     * most a plugin can observe at apply time.
     */
    function register(ctx, require) {
      if (ctx === null || typeof ctx !== 'object') return false
      const slots = ctx.slots
      const locale = ctx.locale
      if (slots === null || typeof slots !== 'object') return false
      if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') return false
      if (locale === null || typeof locale !== 'object' || typeof locale.register !== 'function') return false
      let react = null
      let jsxRuntime = null
      try {
        react = require('react')
        jsxRuntime = require('react/jsx-runtime')
      } catch {
        // The module registry of this Host does not expose React: nothing to render, so nothing
        // is registered. This is the shape a future rc that renames the module would produce.
        return false
      }
      const Tab = makeTab(react, jsxRuntime)
      if (Tab === null) return false
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
          verdicts: t('verdicts'),
          verdictsUnknown: t('verdictsUnknown'),
          source: t('source'),
          reload: t('reload'),
          failed: t('failed'),
          panel: t('panel'),
        },
        /*
         * FACTS FROM THE HOST, NOT JUDGEMENTS MADE HERE (铁律 1). Since R33 the tab reads the Host's
         * read-only route, which answers with the exact payload `dsh-triage audit --json` prints —
         * built by the same `loadAuditData()`/`auditJsonPayload()` the CLI uses. The tab only counts
         * what the payload says; it never decides a conclusion and never guesses a missing field.
         */
        load: async () => {
          /** Publish what the tab just showed, so a real page can be asked for it (R33 same-source). */
          const publishData = (result) => {
            try {
              if (typeof window === 'object' && window !== null) {
                window.__dshTriage = { ...(window.__dshTriage || {}), data: { ok: result.ok, rows: result.count, verdicts: result.verdicts, detail: result.detail ?? null } }
              }
            } catch {
              // A frozen window only costs the diagnostic marker, never the tab.
            }
            return result
          }
          let response
          try {
            response = await fetch('/compat-triage/audit', {
              credentials: 'include',
              headers: { accept: 'application/json' },
            })
          } catch (error) {
            // A dead route is a fact to report, not an exception to render: `load` never throws.
            return publishData({ ok: false, count: null, verdicts: null, detail: String((error && error.message) || error) })
          }
          if (!response.ok) {
            let detail = `HTTP ${response.status}`
            try {
              const body = await response.json()
              if (body && typeof body.error === 'string') detail = `${response.status}: ${body.error}`
            } catch {
              // A non-JSON error body is still an error; the status is the fact we have.
            }
            return publishData({ ok: false, count: null, verdicts: null, detail })
          }
          const payload = await response.json()
          const rows = Array.isArray(payload?.rows) ? payload.rows.length : null
          const verdicts = Array.isArray(payload?.row_verdicts) ? payload.row_verdicts : null
          const tally = verdicts === null ? null : { go: 0, blocked: 0, unknown: 0 }
          if (verdicts !== null) {
            for (const verdict of verdicts) {
              const conclusion = verdict && verdict.conclusion
              if (conclusion === 'go') tally.go += 1
              else if (conclusion === 'blocked') tally.blocked += 1
              else tally.unknown += 1
            }
          }
          return publishData({ ok: true, count: rows, verdicts: tally, detail: null })
        },
      })
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          {
            name: 'settings.plugins.tab',
            id: NS,
            order: 90,
            label: () => t('tab'),
            locale: NS,
            inject: injected,
          },
          Tab,
        ),
      )
      return true
    }

    function apply(ctx) {
      try {
        const registered = register(ctx, require)
        publishMarker(
          registered
            ? { registered: true, slot: 'settings.plugins.tab', id: NS }
            : { registered: false, reason: 'contract-missing', id: NS },
        )
        return registered
      } catch (error) {
        publishMarker({ registered: false, reason: 'contract-mismatch', id: NS })
        // Never let a tab break the settings page: an unexpected contract shape means the user
        // simply does not see triage in DSH (the CLI is still there).
        return false
      }
    }

    return { NS, inject, apply, register }
  },
})
