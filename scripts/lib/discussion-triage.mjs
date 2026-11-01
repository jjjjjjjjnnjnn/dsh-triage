/**
 * Can this upstream thread be answered by *this* tool? (R57)
 *
 * WHY A PURE FUNCTION: the tempting answer is "yes, everything is a plugin problem". That is how a
 * diagnostic tool starts lying. The honest split is by **layer**, because each layer needs different
 * evidence:
 *
 *   admission   — declared ranges vs the running/target runtime. We answer this offline, for any
 *                 package we can read from the registry ("this row would be denied at rc.5").
 *   composition — two rows claiming one id, duplicate copies, shadowed packages. We answer this from
 *                 the profile's own files, but only if we can see the profile.
 *   upgrade     — "after I moved to rc.5 my plugin vanished". Same machinery as `upgrade --to`.
 *   runtime     — a service that never registered, a gateway that answers 503, cookies piling up,
 *                 an installer holding a write lock. **Not ours.** We can rule the declaration layer
 *                 out; we cannot fix these, and pretending otherwise wastes the reporter's time.
 *
 * The classifier only reads text. Whatever it decides is checked against real evidence afterwards
 * (`--probe`), and a thread with no package name is `needs-their-profile`, never `answerable`.
 */

/** Layers, in the order a reader should care about them. */
export const LAYERS = Object.freeze(['admission', 'upgrade', 'composition', 'runtime', 'unknown'])
export const VERDICTS = Object.freeze(['answerable', 'partially-answerable', 'needs-their-profile', 'not-ours'])

/*
 * SIGNAL TABLES. Each entry is [layer, regex, weight]; the classifier sums weights per layer and the
 * heaviest layer wins. Weights exist because a single word ("incompatible") shows up in runtime
 * reports too, while `service-unavailable` never shows up in a declaration problem.
 */
const SIGNALS = [
  ['runtime', /service-unavailable|gateway\/|workspaceController|sessionController|typert/i, 5],
  ['runtime', /cookie|Web authentication|认证/i, 4],
  ['runtime', /写锁|write lock|bundle-in-use|安装器|installer|安装目录/i, 4],
  ['runtime', /崩溃.*启动|启动.*崩溃|无法启动|unavailable|crash/i, 2],
  ['admission', /not activate|did not activate|未激活|\bpeer\b|peerDependencies|engines\.dsh/i, 4],
  ['admission', /incompatible|不兼容|版本不符|版本区间|依赖版本/i, 4],
  ['admission', /dist-tags?|latest tag|npm .*tag/i, 4],
  ['admission', /被禁用|禁用.*插件|插件.*消失|silently disables|静默/i, 3],
  ['composition', /duplicate|重复|两份|shadow|抢先|覆盖|entry id|标识冲突|同一.*位置/i, 4],
  ['upgrade', /升级.*(之后|后)|after (the )?upgrade|升到|updated? to|rc\.\d.*插件/i, 3],
  ['upgrade', /upgrade broke|升级破坏|回退/i, 2],
]

/** Packages a reader could check with `dsh-triage check <pkg>`; `/`-scoped or `dsh-*` shaped. */
const PACKAGE_PATTERN = /@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|\bdsh-[a-z0-9][a-z0-9._-]*\b/gi

/** Words that look like a package but are an upstream built-in or a path fragment. */
const NOT_A_PACKAGE = new Set([
  'dsh-plugin',
  'dsh-plugins',
  'dsh-triage',
  'dsh-base',
  'dsh-web-app',
  'dsh-agent',
  'dsh-tools',
  'dsh-doctor',
])

/**
 * @param {string} text
 * @returns {string[]} unique package names, in first-seen order
 */
export function extractPackages(text) {
  const source = String(text ?? '')
  const found = []
  const seen = new Set()
  for (const match of source.matchAll(PACKAGE_PATTERN)) {
    const raw = String(match[0]).replace(/[.,;:)]+$/, '')
    /*
     * `@deepseek-ai/dsh-mcp-client` must not also yield `dsh-mcp-client`: the bare form would be
     * probed against a *different* registry entry (or nothing), and a wrong package silently
     * produces a wrong verdict. A `dsh-*` match preceded by `/` or an alphanumeric is a fragment.
     */
    if (/^dsh-/i.test(raw)) {
      const before = match.index === undefined ? '' : source[match.index - 1] ?? ''
      if (before === '/' || /[A-Za-z0-9]/.test(before)) continue
    }
    const name = raw.toLowerCase()
    if (NOT_A_PACKAGE.has(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    found.push(raw)
  }
  return found
}

/**
 * @param {{ title?: unknown, body?: unknown, category?: unknown }} thread
 * @returns {{
 *   layer: string,
 *   verdict: string,
 *   reason: string,
 *   signals: string[],
 *   packages: string[],
 *   answerableWith: string | null,
 * }}
 */
export function classifyThread({ title = '', body = '', category = '' }) {
  const text = `${String(title)}\n${String(body)}`
  const scores = new Map(LAYERS.map((layer) => [layer, 0]))
  const signals = []
  for (const [layer, pattern, weight] of SIGNALS) {
    if (pattern.test(text)) {
      scores.set(layer, (scores.get(layer) ?? 0) + weight)
      signals.push(layer)
    }
  }

  const packages = extractPackages(text)
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['unknown', 0]
  const [layer, score] = best
  const categoryName = String(category)

  /* No signal at all: say so instead of defaulting to "probably a plugin". */
  if (score === 0) {
    return {
      layer: 'unknown',
      verdict: 'not-ours',
      reason: 'no declaration, composition or upgrade signal in the text — nothing here we could judge',
      signals,
      packages,
      answerableWith: null,
    }
  }

  if (layer === 'runtime') {
    /*
     * Even a runtime report has a declaration-layer question hiding in it ("did a row fail to load?").
     * That is why this is `partially-answerable` and not `not-ours` when a package is named: we can
     * rule our layer in or out, and then say plainly that the fix is upstream.
     */
    return {
      layer,
      verdict: 'partially-answerable',
      reason:
        'the symptom is runtime (a service/gateway/installer failure). We can rule the declaration layer in or out — if a row is denied, `why` names it — but a healthy row plus a missing service is upstream work, not ours',
      signals,
      packages,
      answerableWith: 'dsh-triage why / dsh-triage audit',
    }
  }

  if (layer === 'admission' || layer === 'upgrade') {
    if (packages.length === 0) {
      return {
        layer,
        verdict: 'needs-their-profile',
        reason:
          'the layer is ours, but no package name is in the thread — the answer depends on which ranges their rows declare, so it needs `dsh-triage audit` on their profile',
        signals,
        packages,
        answerableWith: 'dsh-triage audit (their profile)',
      }
    }
    return {
      layer,
      verdict: 'answerable',
      reason:
        'declaration-layer question with a named package: fetch its published manifest and evaluate the range against the target runtime — no profile needed',
      signals,
      packages,
      answerableWith: layer === 'upgrade' ? 'dsh-triage upgrade --to <version> / check <pkg>' : 'dsh-triage check <pkg>',
    }
  }

  if (layer === 'composition') {
    return {
      layer,
      verdict: packages.length === 0 ? 'needs-their-profile' : 'partially-answerable',
      reason:
        'duplicate copies and entry-id collisions are visible in the profile ledger, but only if we can read that profile; without it we can only describe the shape',
      signals,
      packages,
      answerableWith: 'dsh-triage audit --all',
    }
  }

  return {
    layer,
    verdict: categoryName === 'Q&A' ? 'needs-their-profile' : 'not-ours',
    reason: 'the text did not land in a layer we can evidence',
    signals,
    packages,
    answerableWith: null,
  }
}
