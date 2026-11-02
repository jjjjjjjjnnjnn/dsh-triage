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
 * SIGNAL TABLES. Each entry is [layer, regex, weight]; the classifier sums weights per layer and
 * the heaviest layer wins. Weights exist because a single word ("incompatible") shows up in runtime
 * reports too, while `service-unavailable` never shows up in a declaration problem.
 *
 * TWO TABLES, ONE PRODUCTION CLASSIFIER:
 *   - `SIGNALS` / `classifyThread` is v1 and remains the production classifier. The R59 coverage
 *     headline (74/1545 = 4.8%) was measured with it; changing it would silently change that number.
 *   - `SIGNALS_V2` / `classifyThreadV2` is the R60 experiment. It was designed from the 20 v1 review
 *     errors and reached 20/20 on that development set, but only 12/20 on a disjoint holdout
 *     (v1: 7/20). That is below the 80% bar in `docs/specs/question-coverage.md` §8, so it is kept
 *     as a reproducible experiment, not adopted. See `audit/RECON_2026-11-02_classifier-v2.md`.
 */
const SIGNALS_V1 = [
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

/**
 * v2 weights: a concrete runtime shape (5) > a declaration/composition statement (4) > a generic
 * failure verb (3) > a weak lexical hint (2). Ties go to the layer order in `LAYERS` (admission
 * first), which is why "install fails: peer ..." stays admission.
 */
export const SIGNALS_V2 = [
  // runtime — concrete shapes
  ['runtime', /service-unavailable|gateway\/|workspaceController|sessionController|typert/i, 5],
  ['runtime', /0xC000|SEC_E_|TRANSPORT|ECONN|EACCES|EPERM|permission denied|access denied|沙箱|sandbox|ACL/i, 5],
  ['runtime', /白屏|blank screen|\bfreeze\b|卡死|卡住|\bhang\b|\btimeout\b|超时|WebSocket|socket closed|502|503/i, 4],
  ['runtime', /cookie|Web authentication|认证|登录|login|token|localStorage|certificate|证书/i, 4],
  ['runtime', /写锁|write lock|bundle-in-use|安装器|installer|安装目录/i, 4],
  // runtime — generic failure verbs (the class v1 missed)
  ['runtime', /\bcrash\b|崩溃|闪退|\bexception\b|stack trace|\bpanic\b/i, 3],
  ['runtime', /\bfail(?:s|ed|ure)?\b|\berror\b|报错|失败|异常|\bcannot\b|can't|does not work|not working|\bbroken\b|无法|不能|不可用/i, 3],
  // admission
  ['admission', /not activate|did not activate|未激活|\bpeer\b|peerDependencies|engines\.dsh/i, 4],
  ['admission', /incompatible|不兼容|版本不符|版本区间|依赖版本/i, 4],
  ['admission', /dist-tags?|latest tag|npm .*tag/i, 4],
  ['admission', /被禁用|禁用.*插件|插件.*消失|silently disables|静默/i, 3],
  ['admission', /\binstall(?:ed|ing)?\b|安装|dependency|依赖|\bversion\b|版本/i, 2],
  // composition — overrides, duplicate copies, bundle/profile wiring
  ['composition', /duplicate|重复|两份|shadow|抢先|覆盖|fork|same name|同名|entry id|标识冲突|命名冲突|slot|槽位/i, 4],
  ['composition', /bundle patch|硬依赖|FIBER_PENDING|optional inject|inject.*optional|dsh\.bundle\.patch/i, 4],
  ['composition', /link:|node_modules|inject|manifest|dsh\.profile\.bundles|prune/i, 3],
  ['composition', /preset-(?:standard|ptc|minimal|cordis)|agent preset/i, 3],
  // upgrade
  ['upgrade', /升级.*(之后|后)|after (the )?upgrade|升到|updated? to|rc\.\d.*插件/i, 3],
  ['upgrade', /upgrade broke|升级破坏|回退/i, 2],
]

/** Production table (v1). `signalSnippets()` and the coverage projection use this one. */
export const SIGNALS = SIGNALS_V1

/**
 * v3 (R61 candidate): v2 + the shapes its holdout missed (Chinese "卡着/卡顿", 401/403,
 * INVALID_REQUEST/400, corruption, elevation, symlink, "no text block") plus a question/feature
 * veto in `classifyThreadV3`. The veto is what v2 lacked: `不能` inside a methodology paragraph made
 * a model-behaviour study look like a runtime failure.
 */
export const SIGNALS_V3 = [
  // runtime — concrete shapes
  ['runtime', /service-unavailable|gateway\/|workspaceController|sessionController|typert/i, 5],
  ['runtime', /0xC000|SEC_E_|TRANSPORT|ECONN|EACCES|EPERM|permission denied|access denied|沙箱|sandbox|ACL/i, 5],
  ['runtime', /白屏|blank screen|\bfreeze\b|卡死|卡住|卡着|卡顿|卡了|\bhang\b|\btimeout\b|超时|WebSocket|socket closed|50[23]|40[13]/i, 4],
  ['runtime', /cookie|Web authentication|认证|登录|login|token|localStorage|certificate|证书/i, 4],
  ['runtime', /写锁|write lock|bundle-in-use|安装器|installer|安装目录/i, 4],
  ['runtime', /INVALID_REQUEST|Content Exists Risk|HTTP 400|损坏|corrupt|提权|权限|elevation/i, 4],
  ['runtime', /no (?:text|reply)|nothing to display|empty (?:reply|message)|no content/i, 4],
  // runtime — generic failure verbs (the class v1 missed)
  ['runtime', /\bcrash\b|崩溃|闪退|\bexception\b|stack trace|\bpanic\b/i, 3],
  ['runtime', /\bfail(?:s|ed|ure)?\b|\berror\b|报错|失败|异常|\bcannot\b|can't|does not work|not working|\bbroken\b|无法|不能|不可用/i, 3],
  // admission
  ['admission', /not activate|did not activate|未激活|\bpeer\b|peerDependencies|engines\.dsh/i, 4],
  ['admission', /incompatible|不兼容|版本不符|版本区间|依赖版本/i, 4],
  ['admission', /dist-tags?|latest tag|npm .*tag/i, 4],
  ['admission', /被禁用|禁用.*插件|插件.*消失|silently disables|静默/i, 3],
  ['admission', /\binstall(?:ed|ing)?\b|安装|dependency|依赖|\bversion\b|版本/i, 2],
  // composition
  ['composition', /duplicate|重复|两份|shadow|抢先|覆盖|fork|same name|同名|entry id|标识冲突|命名冲突|slot|槽位/i, 4],
  ['composition', /bundle patch|硬依赖|FIBER_PENDING|optional inject|inject.*optional|dsh\.bundle\.patch/i, 4],
  ['composition', /symlink|module-fallback|healProfilesModuleFallback/i, 5],
  ['composition', /link:|node_modules|inject|manifest|dsh\.profile\.bundles|prune/i, 3],
  ['composition', /preset-(?:standard|ptc|minimal|cordis)|agent preset/i, 3],
  // upgrade
  ['upgrade', /升级.*(之后|后)|after (the )?upgrade|升到|updated? to|rc\.\d.*插件/i, 3],
  ['upgrade', /upgrade broke|升级破坏|回退/i, 2],
]

/** A question/feature request, not a failure report (used only by v3's veto). */
const QUESTION_PATTERN = /please add|can you add|能不能|能否|如何|怎么|求教|小白|想请教|why does|how do i|is it possible|有没有办法|请问/i
/** A concrete failure shape that overrides the veto (a question quoting an error is still a failure). */
const CONCRETE_FAILURE_PATTERN = /0xC000|SEC_E_|TRANSPORT|ECONN|EACCES|EPERM|\berror\b|\bcrash\b|\bexception\b|\bfail(?:s|ed|ure)?\b|失败|崩溃|无法|白屏|卡顿|卡着|卡死|卡住|卡了|\btimeout\b|超时|沙箱|ACL|损坏|corrupt|40[13]|symlink|INVALID_REQUEST/i

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
 * @param {ReadonlyArray<readonly [string, RegExp, number]>} signalsTable
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
function classifyWith(signalsTable, { title = '', body = '', category = '' }) {
  const text = `${String(title)}\n${String(body)}`
  const scores = new Map(LAYERS.map((layer) => [layer, 0]))
  const signals = []
  for (const [layer, pattern, weight] of signalsTable) {
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

/** Production classifier (v1): the table the R59 coverage headline was measured with. */
export function classifyThread(input) {
  return classifyWith(SIGNALS_V1, input)
}

/** R60 experiment (v2): not adopted — 12/20 on a disjoint holdout, below the 80% bar. */
export function classifyThreadV2(input) {
  return classifyWith(SIGNALS_V2, input)
}

/**
 * R61 candidate (v3): v2 + the missed shapes, and a question/feature-request veto. A question that
 * quotes no concrete failure shape (`怎么用`, `能不能加个开关`, a model-behaviour study using
 * `不能` in a caveat) is `not-ours` even if it contains a generic failure word.
 */
export function classifyThreadV3(input) {
  const text = `${String(input?.title ?? '')}\n${String(input?.body ?? '')}`
  if (QUESTION_PATTERN.test(text) && !CONCRETE_FAILURE_PATTERN.test(text)) {
    return {
      layer: 'unknown',
      verdict: 'not-ours',
      reason: 'the text reads as a question or feature request, and carries no concrete failure shape',
      signals: [],
      packages: extractPackages(text),
      answerableWith: null,
    }
  }
  return classifyWith(SIGNALS_V3, input)
}
