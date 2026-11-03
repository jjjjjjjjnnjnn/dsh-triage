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
    /** T-818: the on-demand four-bucket answer, selected by a query on the route that works. */
    const UPGRADE_URL = '/compat-triage/summary?upgrade=1'
    /** How many issues a settings tab may show before it stops being a settings tab. */
    const ISSUES_SHOWN = 3
    /** T-818: the four buckets and the count field each one reads. */
    const UPGRADE_COUNT_KEY = {
      'would-be-denied': 'would_be_denied',
      'cannot-tell': 'cannot_tell',
      improved: 'improved',
      'likely-fine': 'likely_fine',
    }
    /**
     * The pure views, kept so the vm test can render them without a React runtime (see
     * `views()` at the bottom). They are NOT part of the Host contract: the Host only calls
     * `apply`, and everything else here is for our own assertions.
     */
    let lastViews = null

    const zh = {
      tab: '分诊台',
      title: '插件分诊台 · 本地兼容性诊断',
      hint: '由本地诊断引擎提供分析结果，与终端 CLI 输出保持同源。',
      counts: '配置项 {rows} · 已分析 {judged} · 正常 {go} · 存在异常 {denied} · 未明确 {unknown}',
      /** Count table (R55): one row per number, so a reader compares values instead of parsing a sentence. */
      countColumns: ['诊断项', '数量', '说明'],
      countLabels: {
        rows: '配置项总数',
        judged: '已分析',
        go: '正常',
        denied: '存在异常',
        unknown: '未明确',
        collisions: '标识冲突',
        duplicates: '多版本重复',
      },
      countMeanings: {
        rows: '已在 Profile 中声明的插件配置条目',
        judged: '具备依赖声明并已完成推演的条目',
        go: '版本规则匹配正常，可正常加载',
        denied: '依赖版本不满足，启动加载时将被拦截',
        unknown: '未显式声明依赖区间（不作盲目推断）',
        collisions: '多个插件争抢同一 Entry ID',
        duplicates: '同一插件检测到多个不同版本副本',
      },
      issueColumns: ['#', '插件', '结论', '修复'],
      nextColumns: ['操作项', '执行命令'],
      none: '—',
      issues: '待处理问题',
      noIssues: '未检测到兼容性异常或冲突。',
      reason: '原因',
      unknownSuffix: '注：未显式声明依赖区间的插件按规则归入“未明确”，不盲目推定为兼容。',
      more: '另有 {n} 项未在当前摘要中显示。',
      next: '下一步建议',
      source: '数据来源于本地只读接口 /compat-triage/summary，与 `dsh-triage status` 同源。',
      reload: '刷新',
      copy: '复制',
      copyFallback: '复制不可用，请手动选中这条命令：',
      failed: '读取失败',
      pending: '正在加载诊断数据…',
      unreachable: '未能获取诊断结果（本地接口无响应），请检查服务状态。',
      noWeb: '当前环境未启用 Web 模块，请在终端执行 `dsh-triage status`。',
      empty: '未检测到已安装插件，通常是主目录或 Profile 路径指定有误。',
      errorEmpty: '诊断接口未返回 summary 数据，暂无法展示指标。',
      upgradeButton: '升级预检',
      upgradeTitle: '升级预检 · 目标 {version}',
      upgradeHint: '点击后才读取 npm 的 next 标签；只判声明层，不是运行期实测。',
      upgradePending: '正在读取 npm 并推演…',
      upgradeOffline: '读取 npm 失败（离线或网络不可用）——不显示任何桶，避免把“读不到”当成“不会坏”。',
      upgradeBucketColumns: ['桶', '数量', '意思'],
      upgradeBucketLabels: {
        'would-be-denied': '会被拒',
        'cannot-tell': '判不了',
        improved: '会变好',
        'likely-fine': '像没事',
      },
      upgradeBucketMeanings: {
        'would-be-denied': '目标版本的准入规则会拒绝这一行/包',
        'cannot-tell': '声明不足或目标还没发布，证据不够',
        improved: '今天被拒、目标放行——目标版本会放行它',
        'likely-fine': '声明上不冲突——不等于升级后能跑',
      },
      upgradeMore: '另有 {n} 个单元未列出。',
      upgradeBoundary: '只判声明层；不是运行期实测，也不改你的 profile。',
      upgradeSource: '数据来源于本地只读接口 /compat-triage/upgrade（点击后读取 npm next）。',
      upgradeBack: '返回现状',
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
        collisions: 'collisions',
        duplicates: 'duplicates',
      },
      countMeanings: {
        rows: 'declared',
        judged: 'judged',
        go: 'admitted',
        denied: 'dropped at start-up',
        unknown: 'not a pass',
        collisions: 'two plugins claim one row id',
        duplicates: 'the same package installed twice',
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
      copyFallback: 'Copying is unavailable — select this command instead:',
      failed: 'Read failed',
      pending: 'Reading the host…',
      unreachable: 'No conclusion (the read-only route did not answer) — that is not "all good".',
      noWeb: 'This profile serves no web surface, so the route does not exist. Use `dsh-triage status` in a terminal.',
      empty: 'This home/profile yields zero plugin rows — usually --dsh-home / --profile points somewhere else.',
      errorEmpty: 'The route returned no summary field, so no numbers are shown.',
      upgradeButton: 'Upgrade check',
      upgradeTitle: 'Upgrade check · target {version}',
      upgradeHint: 'The npm next tag is read only after you click; this judges the declaration layer, not a runtime measurement.',
      upgradePending: 'Reading npm and judging the target…',
      upgradeOffline: 'The npm read failed (offline or unreachable). No buckets are shown: "could not read" is not "nothing will break".',
      upgradeBucketColumns: ['Bucket', 'Count', 'Meaning'],
      upgradeBucketLabels: {
        'would-be-denied': 'will be denied',
        'cannot-tell': 'cannot tell',
        improved: 'improved',
        'likely-fine': 'likely fine',
      },
      upgradeBucketMeanings: {
        'would-be-denied': 'the target runtime would deny this row/package',
        'cannot-tell': 'not enough declaration or the target is unpublished',
        improved: 'denied today, admitted at the target — the target would let it through',
        'likely-fine': 'no declaration conflict — not a promise that it runs',
      },
      upgradeMore: '{n} more units not listed.',
      upgradeBoundary: 'Declaration layer only; not a runtime measurement, and it does not touch your profile.',
      upgradeSource: 'Read from /compat-triage/upgrade after a click; the host reads the npm next tag.',
      upgradeBack: 'Back to status',
    }

    /** Fill `{name}` placeholders. A missing value becomes `?`, never `0`. */
    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : '?',
      )
    }

    /**
     * A clipboard we do not have is a no-op, not a fake "copied".
     *
     * T-844: the outcome goes two places. `window.__dshTriage.clipboard` is for the probe (R51 showed
     * the marker is how "the button did nothing" becomes observable), and `onResult` is for the tab,
     * because a marker nobody renders leaves the person clicking with no way to get the command at all:
     * the button is the only place the command text exists.
     */
    function copyText(text, onResult) {
      const report = (ok, error) => {
        try {
          if (typeof window === 'object' && window !== null) {
            window.__dshTriage = { ...(window.__dshTriage || {}), clipboard: { ok, error: error ?? null } }
          }
        } catch {
          // Recording the outcome is a nicety; the button still works without it.
        }
        // The tab's own reaction is separate from the marker: a Host that froze `window` must still
        // get the on-screen fallback.
        try {
          if (typeof onResult === 'function') onResult({ ok, error: error === undefined ? null : error })
        } catch {
          // A renderer that throws here must not turn a failed copy into a successful one.
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
       * numbers back as pairs instead of scraping a sentence.
       *
       * COLLISIONS AND DUPLICATES ONLY APPEAR WHEN THEY EXIST (R55): the headline counts them as
       * "things that will go wrong" ("有 2 个东西会出问题"), so a table that only showed `会坏 1`
       * contradicted the sentence above it — found by looking at the mixed demo, not by a test.
       */
      function countsTable(counts, copy) {
        const order = [
          ['rows', counts.rows],
          ['judged', counts.judged],
          ['go', counts.go],
          ['denied', counts.denied],
          ['unknown', counts.unknown],
          ['collisions', counts.collisions],
          ['duplicates', counts.duplicateCopies],
        ].filter(([, value]) => typeof value === 'number')
        const rows = order
          .filter(([key, value]) => (key === 'collisions' || key === 'duplicates') ? Number(value) > 0 : true)
          .map(([key, value]) => [
            jsx('span', { 'data-count-label': key, children: copy.countLabels[key] }),
            jsx('strong', { 'data-count-value': key, children: String(value) }),
            jsx('span', { 'data-count-meaning': key, children: copy.countMeanings[key] }),
          ])
        return matrix(copy.countColumns, rows, { 'data-triage-counts': '1' })
      }

      /**
       * One row per issue: what it is, then the engine's own reason on a second line inside the same
       * cell. Five columns did not fit a settings dialog; the reason belongs under the conclusion it
       * explains, not in a column of its own.
       *
       * T-844: on a FAILED copy the command itself is printed under the button as selectable text.
       * Before this, `client.js` rendered only the button, so on a browser without a clipboard the
       * command existed nowhere in the DOM — a dead end for the person and unreadable for any probe.
       * The fallback appears only after the failure: the normal screen still has no copy of the
       * command, which is what keeps "the button copies the engine's own line" checkable.
       */
      function issuesTable(issues, copy, feedback) {
        const state = feedback && feedback.state ? feedback.state : null
        const onCopy = feedback && typeof feedback.onCopy === 'function' ? feedback.onCopy : null
        const rows = issues.map((issue, index) => {
          const failed = state !== null && state.id === String(issue.id) && state.ok === false
          const fixCell = []
          if (typeof issue.fix === 'string' && issue.fix !== '') {
            fixCell.push(
              jsx('button', {
                type: 'button',
                'data-copy-fix': String(issue.id),
                style: { whiteSpace: 'nowrap' },
                /*
                 * The click reports to the tab when it can (so the screen can show the command), and
                 * falls back to the bare call when a test mounts the view directly.
                 */
                onClick: () => (onCopy === null ? copyText(issue.fix) : onCopy(String(issue.id), issue.fix)),
                children: copy.copy,
              }),
            )
            if (failed) {
              fixCell.push(
                jsxs('span', {
                  'data-copy-fallback': String(issue.id),
                  style: { display: 'block', marginTop: '4px', opacity: 0.85, fontSize: '0.9em' },
                  children: [
                    jsx('span', { style: { display: 'block' }, children: copy.copyFallback }),
                    jsx('code', { style: { userSelect: 'all' }, children: String(issue.fix) }),
                  ],
                }),
              )
            }
          } else {
            fixCell.push(copy.none)
          }
          return [
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
            fixCell.length === 1 ? fixCell[0] : fixCell,
          ]
        })
        return matrix(copy.issueColumns, rows, { 'data-triage-issues': String(issues.length) })
      }

      /** Two columns: what you want to do, and the command. No prose in between. */
      function nextTable(steps, copy) {
        const rows = steps.map((step) => [String(step.label), jsx('code', { children: String(step.command) })])
        return matrix(copy.nextColumns, rows)
      }

      function summaryView(summary, copy, onRefresh, onUpgrade, feedback) {
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
          children.push(issuesTable(issues, copy, feedback))
          if (summary.more > 0) children.push(jsx('p', { children: fill(copy.more, { n: summary.more }) }))
        }
        if (counts !== null && counts.unknown > 0) children.push(jsx('p', { children: copy.unknownSuffix }))
        if (summary && Array.isArray(summary.next) && summary.next.length > 0) {
          children.push(jsx('h4', { children: copy.next }))
          children.push(nextTable(summary.next, copy))
        }
        children.push(jsx('p', { children: copy.source }))
        // T-818: the second screen is on demand. This button is the only thing that reads npm.
        children.push(
          jsx('button', {
            type: 'button',
            'data-triage-action': 'upgrade',
            onClick: onUpgrade,
            children: copy.upgradeButton,
          }),
        )
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

      /**
       * T-818: four buckets, each with `data-upgrade-bucket` / `data-upgrade-count` so the recorder
       * can read them as pairs. The words come from the Host's copy; nothing is counted here.
       */
      function upgradeView(result, copy, onBack) {
        const upgrade = result && result.upgrade ? result.upgrade : null
        const target = upgrade && upgrade.target && upgrade.target.version ? String(upgrade.target.version) : '?'
        const children = [jsx('h3', { children: fill(copy.upgradeTitle, { version: target }) }), jsx('p', { children: copy.upgradeHint })]
        if (upgrade && upgrade.counts) {
          const rows = ['would-be-denied', 'cannot-tell', 'improved', 'likely-fine'].map((bucket) => {
            const count = upgrade.counts[UPGRADE_COUNT_KEY[bucket]] ?? 0
            return [
              jsx('span', { 'data-upgrade-label': bucket, children: copy.upgradeBucketLabels[bucket] }),
              jsx('strong', { 'data-upgrade-bucket': bucket, 'data-upgrade-count': String(count), children: String(count) }),
              jsx('span', { children: copy.upgradeBucketMeanings[bucket] }),
            ]
          })
          children.push(matrix(copy.upgradeBucketColumns, rows, { 'data-triage-upgrade': '1' }))
          if (upgrade.more > 0) children.push(jsx('p', { children: fill(copy.upgradeMore, { n: upgrade.more }) }))
        }
        children.push(jsx('p', { children: copy.upgradeBoundary }))
        children.push(jsx('p', { children: copy.upgradeSource }))
        children.push(jsx('button', { type: 'button', onClick: onBack, children: copy.upgradeBack }))
        return jsxs('div', { 'data-triage-tab': 'upgrade', children })
      }

      /** Offline / unreadable is its own sentence, never a zero-filled bucket table. */
      function upgradeFailureView(status, result, copy, onBack) {
        const loading = status === 'loading'
        const children = [jsx('h3', { children: copy.upgradeButton }), jsx('p', { children: copy.upgradeHint })]
        if (loading) children.push(jsx('p', { children: copy.upgradePending }))
        else children.push(jsx('p', { children: copy.upgradeOffline }))
        if (result && result.detail) children.push(jsx('p', { children: `${copy.failed}: ${String(result.detail)}` }))
        children.push(jsx('button', { type: 'button', onClick: onBack, children: copy.upgradeBack }))
        /*
         * R62: "still reading the registry" and "the read failed" used to share one mark
         * (`data-triage-tab="upgrade-error"`), so any observer that asked "is there an error view?"
         * answered yes while the answer was still on the wire — the R61 harness did exactly that and
         * reported a hung fetch. Two states, two marks. The kind attribute keeps `loading` as well,
         * so a probe that only reads `data-triage-kind` still cannot mistake it for a verdict.
         */
        return jsxs('div', {
          'data-triage-tab': loading ? 'upgrade-loading' : 'upgrade-error',
          'data-triage-kind': String(result && result.kind ? result.kind : status),
          children,
        })
      }

      return { summaryView, failureView, upgradeView, upgradeFailureView }
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
        const [screen, setScreen] = useState('summary')
        const [upgrade, setUpgrade] = useState({ status: 'idle', result: null })
        /*
         * T-844: what the last copy attempt did, so the screen can print the command when the copy
         * failed. Without it the command lives only inside the button's closure — on a browser
         * without a clipboard the fix is simply unreachable.
         */
        const [clipboard, setClipboard] = useState(null)
        const onCopy = useCallback((id, fix) => {
          copyText(fix, (outcome) => setClipboard({ id, ok: outcome.ok, error: outcome.error }))
        }, [])
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
        /*
         * T-818: the upgrade screen is opened by the button, never by mount. Calling this function is
         * the only thing in the tab that causes an npm read.
         */
        const loadUpgrade = useCallback(() => {
          let cancelled = false
          setScreen('upgrade')
          setUpgrade({ status: 'loading', result: null })
          Promise.resolve()
            .then(() => props.loadUpgrade())
            .then((result) => {
              if (cancelled) return
              setUpgrade({ status: result && result.ok ? 'ready' : 'failed', result })
            })
            .catch((error) => {
              if (cancelled) return
              setUpgrade({ status: 'failed', result: { ok: false, kind: 'thrown', detail: String((error && error.message) || error) } })
            })
          return () => {
            cancelled = true
          }
        }, [props])
        useEffect(() => load(), [load])
        if (screen === 'upgrade') {
          if (upgrade.status !== 'ready' || upgrade.result === null || upgrade.result.ok !== true || !upgrade.result.upgrade) {
            return views.upgradeFailureView(upgrade.status, upgrade.result, copy, () => setScreen('summary'))
          }
          return views.upgradeView(upgrade.result, copy, () => setScreen('summary'))
        }
        const result = state.result
        if (state.status !== 'ready' || result === null || result.ok !== true || result.summary === null) {
          return views.failureView(state.status === 'idle' ? null : result, copy, load)
        }
        return views.summaryView(result.summary, copy, load, loadUpgrade, { state: clipboard, onCopy })
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
          upgradeButton: t('upgradeButton'),
          upgradeTitle: t('upgradeTitle'),
          upgradeHint: t('upgradeHint'),
          upgradePending: t('upgradePending'),
          upgradeOffline: t('upgradeOffline'),
          upgradeBucketColumns: dict.upgradeBucketColumns,
          upgradeBucketLabels: dict.upgradeBucketLabels,
          upgradeBucketMeanings: dict.upgradeBucketMeanings,
          upgradeMore: t('upgradeMore'),
          upgradeBoundary: t('upgradeBoundary'),
          upgradeSource: t('upgradeSource'),
          upgradeBack: t('upgradeBack'),
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
        /*
         * T-818: fetched only when the person clicks "升级预检". A route that is missing (404) or a
         * registry that cannot be read (502/504) produces a sentence, never a zero-filled bucket table.
         */
        loadUpgrade: async () => {
          const publishUpgrade = (result) => {
            try {
              if (typeof window === 'object' && window !== null) {
                window.__dshTriage = {
                  ...(window.__dshTriage || {}),
                  upgrade: {
                    ok: result.ok,
                    kind: result.kind ?? null,
                    target: result.upgrade && result.upgrade.target ? result.upgrade.target.version : null,
                    counts: result.upgrade && result.upgrade.counts ? result.upgrade.counts : null,
                  },
                }
              }
            } catch {
              // The marker is diagnostic only; the screen still works without it.
            }
            return result
          }
          let response
          try {
            response = await fetch(UPGRADE_URL, {
              credentials: 'include',
              headers: { accept: 'application/json' },
            })
          } catch (error) {
            return publishUpgrade({ ok: false, kind: 'thrown', upgrade: null, detail: String((error && error.message) || error) })
          }
          if (!response.ok) {
            const kind = response.status === 404 ? 'route-missing' : 'http'
            let detail = `HTTP ${response.status}`
            try {
              const body = await response.json()
              if (body && typeof body.error === 'string') detail = `${response.status}: ${body.error}`
            } catch {
              // A non-JSON error body is still an error; the status is the fact we have.
            }
            return publishUpgrade({ ok: false, kind, upgrade: null, detail })
          }
          const payload = await response.json()
          if (!payload || !payload.counts || !payload.target) {
            return publishUpgrade({ ok: false, kind: 'no-upgrade', upgrade: null, detail: null })
          }
          return publishUpgrade({ ok: true, kind: null, upgrade: payload, detail: null })
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
            ? { registered: true, slot: 'settings.plugins.tab', id: NS, route: SUMMARY_URL, upgrade: UPGRADE_URL }
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
