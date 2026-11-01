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
 * R51 — WHAT CHANGED, AND WHY: until R50 this tab showed a row count, a verdict tally and the
 * sentence "run `dsh-triage audit` in a terminal". The rule it respected was real (the browser
 * cannot compute a verdict), but the conclusion had become reachable by then: R33 opened a
 * read-only route, so the answer could be *computed on the host, by the CLI's own engine*, and
 * merely *displayed* here. The tab now asks `/compat-triage/summary` for
 * `buildProfileSummary()`'s output — the same projection `dsh-triage status` and `serve` print —
 * and renders it. It still decides nothing: every number and every sentence below comes from the
 * payload, and when the payload is missing it says so instead of rendering zeros.
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
    /** The read-only route built in R51. One place, so a rename cannot drift between halves. */
    const SUMMARY_URL = '/compat-triage/summary'
    /** How many issues a settings tab may show before it stops being a settings tab. */
    const ISSUES_SHOWN = 3
    /**
     * The pure views, kept so the vm test can render them without a React runtime (see
     * `views()` at the bottom). They are NOT part of the Host contract: the Host only calls
     * `apply`, and everything else here is for our own assertions.
     */
    let lastViews = null

    const zh = {
      tab: '分诊台',
      title: '分诊台 · 这套装会不会坏',
      hint: '结论由命令行同一引擎在宿主侧算好，这里只负责显示。',
      counts: '行 {rows} · 有判定 {judged} · 正常 {go} · 会坏 {denied} · 判不了 {unknown}',
      /** Count table (R55): one row per number, so a reader compares values instead of parsing a sentence. */
      countColumns: ['项目', '数量', '含义'],
      countLabels: {
        rows: '行',
        judged: '有判定',
        go: '正常',
        denied: '会坏',
        unknown: '判不了',
      },
      countMeanings: {
        rows: '声明过的行',
        judged: '给出了结论',
        go: '确认放行',
        denied: '会被摘掉',
        unknown: '不算通过',
      },
      issueColumns: ['#', '插件', '结论', '修复'],
      nextColumns: ['想做什么', '命令'],
      none: '—',
      issues: '要看的地方',
      noIssues: '没有需要你动手的行。',
      reason: '原因',
      unknownSuffix: '不声明支持区间的行不算通过，只能算判不了。',
      more: '还有 {n} 条没在这里列出。',
      next: '下一步',
      source: '数据来自宿主只读路由 /compat-triage/summary，与 `dsh-triage status` 同源。',
      reload: '刷新',
      copy: '复制',
      failed: '读取失败',
      pending: '正在读宿主…',
      unreachable: '拿不到结论（只读路由没回答）——这不是「没问题」。',
      noWeb: '这个 profile 没有 web 服务，所以没有这条路由；请在终端用 `dsh-triage status`。',
      empty: '这个 home/profile 里一行插件都没有——通常是 --dsh-home / --profile 指错了。',
      errorEmpty: '路由没有返回 summary 字段，因此不显示任何数字。',
    }
    const en = {
      tab: 'Triage',
      title: 'Triage · will this setup break?',
      hint: 'The conclusion is computed on the host by the same engine as the CLI; this tab only displays it.',
      counts: 'rows {rows} · judged {judged} · fine {go} · will break {denied} · cannot tell {unknown}',
      countColumns: ['Item', 'Count', 'Meaning'],
      countLabels: {
        rows: 'rows',
        judged: 'judged',
        go: 'fine',
        denied: 'will break',
        unknown: 'cannot tell',
      },
      countMeanings: {
        rows: 'declared',
        judged: 'judged',
        go: 'admitted',
        denied: 'dropped at start-up',
        unknown: 'not a pass',
      },
      issueColumns: ['#', 'Plugin', 'Conclusion', 'Fix'],
      nextColumns: ['If you want', 'Run'],
      none: '—',
      issues: 'What needs you',
      noIssues: 'Nothing here needs your hands.',
      reason: 'reason',
      unknownSuffix: 'Rows that declare no version range are not a pass — they are "cannot tell".',
      more: '{n} more not listed here.',
      next: 'Next step',
      source: 'Read from the host route /compat-triage/summary, the same projection `dsh-triage status` prints.',
      reload: 'Refresh',
      copy: 'Copy',
      failed: 'Read failed',
      pending: 'Reading the host…',
      unreachable: 'No conclusion (the read-only route did not answer) — that is not "all good".',
      noWeb: 'This profile serves no web surface, so the route does not exist. Use `dsh-triage status` in a terminal.',
      empty: 'This home/profile yields zero plugin rows — usually --dsh-home / --profile points somewhere else.',
      errorEmpty: 'The route returned no summary field, so no numbers are shown.',
    }

    /** Fill `{name}` placeholders. A missing value becomes `?`, never `0`. */
    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : '?',
      )
    }

    /** A clipboard we do not have is a no-op, not a fake "copied". */
    function copyText(text) {
      const report = (ok, error) => {
        try {
          if (typeof window === 'object' && window !== null) {
            window.__dshTriage = { ...(window.__dshTriage || {}), clipboard: { ok, error: error ?? null } }
          }
        } catch {
          // Recording the outcome is a nicety; the button still works without it.
        }
      }
      try {
        if (typeof navigator === 'object' && navigator !== null && navigator.clipboard) {
          navigator.clipboard.writeText(String(text)).then(
            () => report(true, null),
            // The failure is published, not swallowed: a button that cannot copy must be visible as
            // such to the probe (R51 user test), not merely unhelpful to the person clicking it.
            (error) => report(false, String((error && error.message) || error)),
          )
          return
        }
        report(false, 'navigator.clipboard is unavailable')
      } catch (error) {
        report(false, String((error && error.message) || error))
      }
    }

    /**
     * The two pure views. Everything they print comes from `copy` (the Host's localization) and
     * `summary` (the Host's projection); nothing here counts, ranks or fills a missing field.
     */
    function makeViews(jsxRuntime) {
      const jsx = jsxRuntime.jsx
      const jsxs = jsxRuntime.jsxs

      /**
       * ONE TABLE PRIMITIVE (R55). The Host's stylesheet does not style our markup, and a borderless
       * table with no padding renders as run-together columns, so a minimal amount of layout is
       * inlined here. Inline styles are presentation only: if the page's CSP drops them, the table
       * is still a table (thead/tbody/tr/th/td) and every number is still in its own cell.
       */
      const CELL = { padding: '4px 10px 4px 0', textAlign: 'left', verticalAlign: 'top' }
      const HEAD = { ...CELL, fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid rgba(127,127,127,0.35)' }

      function matrix(headers, rows, attrs) {
        return jsxs('table', {
          ...(attrs || {}),
          style: { borderCollapse: 'collapse', margin: '4px 0 10px', width: '100%' },
          children: [
            jsx('thead', {
              children: jsx('tr', {
                children: headers.map((label, column) =>
                  jsx('th', { 'data-col': String(column), style: HEAD, children: String(label) }),
                ),
              }),
            }),
            jsx('tbody', {
              children: rows.map((cells, index) =>
                jsx('tr', {
                  'data-row': String(index),
                  children: cells.map((cell, column) => jsx('td', { 'data-col': String(column), style: CELL, children: cell })),
                }),
              ),
            }),
          ],
        })
      }

      /**
       * Counts as three columns. `data-count-label` / `data-count-value` let the recorder read the
       * numbers back as pairs instead of scraping a sentence — the old single-line form is what made
       * "行 219 · 有判定 184 · …" the only machine-readable shape.
       */
      function countsTable(counts, copy) {
        const rows = ['rows', 'judged', 'go', 'denied', 'unknown']
          .filter((key) => typeof counts[key] === 'number')
          .map((key) => [
            jsx('span', { 'data-count-label': key, children: copy.countLabels[key] }),
            jsx('strong', { 'data-count-value': key, children: String(counts[key]) }),
            jsx('span', { 'data-count-meaning': key, children: copy.countMeanings[key] }),
          ])
        return matrix(copy.countColumns, rows, { 'data-triage-counts': '1' })
      }

      /**
       * One row per issue: what it is, then the engine's own reason on a second line inside the same
       * cell. Five columns did not fit a settings dialog; the reason belongs under the conclusion it
       * explains, not in a column of its own.
       */
      function issuesTable(issues, copy) {
        const rows = issues.map((issue, index) => [
          String(index + 1),
          jsx('code', { children: String(issue.id) }),
          jsxs('span', {
            'data-issue-kind': String(issue.kind),
            children: [
              jsx('span', { children: String(issue.plain) }),
              typeof issue.line === 'string' && issue.line !== ''
                ? jsx('span', {
                    style: { display: 'block', opacity: 0.75, fontSize: '0.9em' },
                    children: `${copy.reason}: ${issue.line}`,
                  })
                : null,
            ].filter((node) => node !== null),
          }),
          typeof issue.fix === 'string' && issue.fix !== ''
            ? jsx('button', {
                type: 'button',
                'data-copy-fix': String(issue.id),
                style: { whiteSpace: 'nowrap' },
                onClick: () => copyText(issue.fix),
                children: copy.copy,
              })
            : copy.none,
        ])
        return matrix(copy.issueColumns, rows, { 'data-triage-issues': String(issues.length) })
      }

      /** Two columns: what you want to do, and the command. No prose in between. */
      function nextTable(steps, copy) {
        const rows = steps.map((step) => [String(step.label), jsx('code', { children: String(step.command) })])
        return matrix(copy.nextColumns, rows)
      }

      function summaryView(summary, copy, onRefresh) {
        const counts = summary && summary.counts ? summary.counts : null
        const children = [jsx('h3', { children: copy.title }), jsx('p', { children: copy.hint })]
        children.push(
          jsx('p', {
            'data-triage-tone': String(summary && summary.tone ? summary.tone : 'unknown'),
            children: jsx('strong', { children: String((summary && summary.plain) || (summary && summary.headline) || '') }),
          }),
        )
        if (counts !== null) {
          children.push(countsTable(counts, copy))
          // Zero rows is not a clean profile: it is usually the wrong home. Say so (R49's lesson).
          if (counts.rows === 0) children.push(jsx('p', { children: copy.empty }))
        }
        const issues = summary && Array.isArray(summary.issues) ? summary.issues.slice(0, ISSUES_SHOWN) : []
        if (issues.length === 0) children.push(jsx('p', { children: copy.noIssues }))
        else {
          children.push(jsx('h4', { children: copy.issues }))
          children.push(issuesTable(issues, copy))
          if (summary.more > 0) children.push(jsx('p', { children: fill(copy.more, { n: summary.more }) }))
        }
        if (counts !== null && counts.unknown > 0) children.push(jsx('p', { children: copy.unknownSuffix }))
        if (summary && Array.isArray(summary.next) && summary.next.length > 0) {
          children.push(jsx('h4', { children: copy.next }))
          children.push(nextTable(summary.next, copy))
        }
        children.push(jsx('p', { children: copy.source }))
        children.push(jsx('button', { type: 'button', onClick: onRefresh, children: copy.reload }))
        return jsxs('div', { 'data-triage-tab': 'summary', children })
      }

      /**
       * FOUR FAILURES, FOUR SENTENCES. "No route" is a profile shape, "unreadable" is a profile
       * state, "no summary field" is a version skew, "thrown" is a dead process — and none of them
       * is "no problems", which is what a zero-filled table would say.
       */
      function failureView(result, copy, onRefresh) {
        const kind = result === null ? 'pending' : result.kind
        const children = [jsx('h3', { children: copy.title }), jsx('p', { children: copy.hint })]
        if (kind === 'route-missing') children.push(jsx('p', { children: copy.noWeb }))
        else if (kind === 'no-summary') children.push(jsx('p', { children: copy.errorEmpty }))
        else if (kind === 'pending') children.push(jsx('p', { children: copy.pending }))
        else children.push(jsx('p', { children: copy.unreachable }))
        if (result !== null && result.detail) {
          children.push(jsx('p', { children: `${copy.failed}: ${String(result.detail)}` }))
        }
        children.push(jsx('button', { type: 'button', onClick: onRefresh, children: copy.reload }))
        return jsxs('div', { 'data-triage-tab': 'error', 'data-triage-kind': String(kind), children })
      }

      return { summaryView, failureView }
    }

    /**
     * Build the tab component. Returns null when the renderer is unavailable — a component we
     * cannot render must not be registered at all.
     */
    function makeTab(react, jsxRuntime) {
      if (react === null || jsxRuntime === null) return null
      const { useState, useEffect, useCallback } = react
      const views = makeViews(jsxRuntime)
      lastViews = views
      return function CompatTriageTab(props) {
        const copy = props.copy
        const [state, setState] = useState({ status: 'idle', result: null })
        const load = useCallback(() => {
          let cancelled = false
          setState((previous) => ({ ...previous, status: 'loading' }))
          Promise.resolve()
            .then(() => props.load())
            .then((result) => {
              if (cancelled) return
              setState({ status: result && result.ok ? 'ready' : 'failed', result })
            })
            .catch((error) => {
              if (cancelled) return
              setState({
                status: 'failed',
                result: { ok: false, kind: 'thrown', detail: String((error && error.message) || error) },
              })
            })
          return () => {
            cancelled = true
          }
        }, [props])
        useEffect(() => load(), [load])
        const result = state.result
        if (state.status !== 'ready' || result === null || result.ok !== true || result.summary === null) {
          return views.failureView(state.status === 'idle' ? null : result, copy, load)
        }
        return views.summaryView(result.summary, copy, load)
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
      /*
       * WHICH LOCALE THE PAYLOAD SHOULD BE READ IN: ask the Host's own binding, do not sniff the
       * browser. `t('tab')` resolving to the zh dictionary means this page is being shown in
       * Chinese, so the Chinese sentences are the correct ones; anything else (a third locale, or
       * a test double) falls back to English, which is also what `summary.en` is for.
       */
      const activeLocale = t('tab') === zh.tab ? 'zh' : 'en'
      /*
       * STRUCTURED COPY COMES FROM THE DICTIONARY, NOT FROM `t()` (R55): `t()` is the Host's string
       * binding — feeding it arrays and objects to get column labels back would be relying on
       * behaviour nobody promised. Tables need labels, so they are read from the dictionary this
       * plugin registered, for the same locale `t()` just reported.
       */
      const dict = activeLocale === 'zh' ? zh : en
      const injected = () => ({
        locale: activeLocale,
        copy: {
          tab: t('tab'),
          title: t('title'),
          hint: t('hint'),
          counts: t('counts'),
          countColumns: dict.countColumns,
          countLabels: dict.countLabels,
          countMeanings: dict.countMeanings,
          issueColumns: dict.issueColumns,
          nextColumns: dict.nextColumns,
          none: dict.none,
          issues: t('issues'),
          noIssues: t('noIssues'),
          reason: t('reason'),
          unknownSuffix: t('unknownSuffix'),
          more: t('more'),
          next: t('next'),
          source: t('source'),
          reload: t('reload'),
          copy: t('copy'),
          failed: t('failed'),
          pending: t('pending'),
          unreachable: t('unreachable'),
          noWeb: t('noWeb'),
          empty: t('empty'),
          errorEmpty: t('errorEmpty'),
        },
        /*
         * FACTS FROM THE HOST, NOT JUDGEMENTS MADE HERE (铁律 1). The route answers with the
         * projection `dsh-triage status` prints, built by `buildProfileSummary()` from the same
         * `loadAuditData()` the CLI calls. This function only picks a locale and forwards the
         * failure: it counts nothing and never fills a missing field with a plausible value.
         */
        load: async () => {
          /** Publish what the tab just showed, so a real page can be asked for it (R33 same-source). */
          const publishData = (result) => {
            try {
              if (typeof window === 'object' && window !== null) {
                window.__dshTriage = {
                  ...(window.__dshTriage || {}),
                  data: {
                    ok: result.ok,
                    kind: result.kind ?? null,
                    tone: result.summary && result.summary.tone ? result.summary.tone : null,
                    counts: result.summary && result.summary.counts ? result.summary.counts : null,
                  },
                }
              }
            } catch {
              // A frozen window only costs the diagnostic marker, never the tab.
            }
            return result
          }
          let response
          try {
            response = await fetch(SUMMARY_URL, {
              credentials: 'include',
              headers: { accept: 'application/json' },
            })
          } catch (error) {
            // A dead route is a fact to report, not an exception to render: `load` never throws.
            return publishData({ ok: false, kind: 'thrown', summary: null, detail: String((error && error.message) || error) })
          }
          if (!response.ok) {
            // 404 is the one failure with its own meaning: this profile serves no web surface.
            const kind = response.status === 404 ? 'route-missing' : 'http'
            let detail = `HTTP ${response.status}`
            try {
              const body = await response.json()
              if (body && typeof body.error === 'string') detail = `${response.status}: ${body.error}`
            } catch {
              // A non-JSON error body is still an error; the status is the fact we have.
            }
            return publishData({ ok: false, kind, summary: null, detail })
          }
          const payload = await response.json()
          const summary = payload && payload.summary ? payload.summary[activeLocale] || payload.summary.en || null : null
          if (summary === null) {
            return publishData({ ok: false, kind: 'no-summary', summary: null, detail: null })
          }
          return publishData({ ok: true, kind: null, summary, detail: null })
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
            ? { registered: true, slot: 'settings.plugins.tab', id: NS, route: SUMMARY_URL }
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

    /** Test seam: the pure views, available after a successful registration. */
    function views() {
      return lastViews
    }

    return { NS, inject, apply, register, views }
  },
})
