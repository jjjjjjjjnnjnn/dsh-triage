# 05 · Verdict 契约

> **Stand**: R9 (2026-10-27) | 实现：`packages/core/src/verdict.ts` + `types.ts` | 门禁：`scripts/gate_verdict_contract.mjs`

## 1. 为什么要有契约

判断层的产品价值 = 结论的可信度。为了让它无法悄悄退化成「一个看起来很专业的分数」，结论结构被门禁锁死：

- 只有四态结论；
- 每条结论必须带证据与置信度；
- `blocked` / `risky` 必须给替代方案；
- `unknown` 必须写清缺什么证据；
- 用户可见文案只能来自 messageId 目录，不得内联写死。

## 2. Verdict JSON

```jsonc
{
  "schemaVersion": 1,
  "subject": { "name": "dsh-web-search-pro", "version": "1.4.2", "kind": "plugin" },
  "env": {
    "dsh": "0.2.1-rc.2",
    "node": "24.15.0",
    "platform": "win32",
    "arch": "x64",
    "profile": "web",
    "profileDir": "C:/Users/me/.dsh/profiles/web",
    "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
    "installed": [{ "name": "@deepseek-ai/dsh", "version": "0.2.1-rc.2" }]
  },
  "conclusion": "blocked",
  "confidence": { "level": "high", "basis": "declared" },
  "reasons": [
    {
      "code": "admission-denied-peer",
      "severity": "block",
      "messageId": "admission.unmet.peer",
      "params": { "key": "@deepseek-ai/dsh-tools", "range": ">=0.2.0-rc.2 <0.2.1-0", "runtime": "0.2.1-rc.2" }
    }
  ],
  "evidence": [
    { "id": "admission", "tier": "declared", "source": "dsh-web-search-pro@1.4.2", "method": "declared-range", "at": "2026-10-26T00:00:00.000Z" },
    { "id": "runtime", "tier": "measured-local", "source": "C:/Users/me/.dsh/profiles/web", "method": "profile-scan", "at": "2026-10-26T00:00:00.000Z" }
  ],
  "remediation": [
    {
      "kind": "allow-version",
      "command": "dsh plugin --profile web allow-version dsh-web-search-pro@1.4.2 --dsh-version 0.2.1-rc.2 --accept-risk",
      "note": "explicit exemption for this exact plugin version and runtime version"
    }
  ],
  "missingEvidence": [],
  "generatedAt": "2026-10-26T00:00:00.000Z"
}
```

## 2b. 行级 verdict（R4 起，`kind: "entry"`）

上游是按 **loader row 的模块**做 admission 的，所以「bundle 通过」不等于「行能跑」。行级 verdict 的形态：

```jsonc
{
  "subject": { "name": "@deepseek-ai/dsh-hooks-claude-code", "version": "0.2.1-rc.2", "kind": "entry" },
  "conclusion": "blocked",
  "confidence": { "level": "high", "basis": "declared" },
  "reasons": [
    { "code": "admission-row-scope", "severity": "info", "messageId": "admission.row-scope",
      "params": { "rows": "hooks-claude-code", "module": "@deepseek-ai/dsh-hooks-claude-code", "source": "patch:profile" } },
    { "code": "admission-denied-peer", "severity": "block", "messageId": "admission.unmet.peer",
      "params": { "key": "@deepseek-ai/dsh-llm", "range": "0.2.1-rc.2", "runtime": "0.2.1-rc.3" } }
  ],
  "evidence": [
    { "id": "admission", "tier": "declared", "source": "@deepseek-ai/dsh-hooks-claude-code@0.2.1-rc.2", "method": "declared-range", "at": "…" },
    { "id": "row", "tier": "declared", "source": "patch:profile", "method": "patch-parse", "detail": "row(s) hooks-claude-code", "at": "…" },
    { "id": "runtime", "tier": "measured-local", "source": "<profileDir>", "method": "profile-scan", "at": "…" }
  ],
  "remediation": [
    { "kind": "allow-version", "command": "dsh plugin --profile <p> allow-version …" },
    { "kind": "disable-entry", "params": { "id": "hooks-claude-code", "owners": "patch:profile" } }
  ],
  "missingEvidence": []
}
```

规则：

- 同一模块被多行引入 → **一个** verdict，`reasons[0].params.rows` 列出全部 row id（不刷屏，但可定位）；
- 模块未安装 → `unknown` + `missingEvidence: ["missing.row-module"]`，禁止判 `go`；
- 声明满足当前运行时 → **不产生** verdict（「没消息」不是 finding）；
- **没有任何声明 ≠ 声明满足**（R9 / T-107）：行的模块既无 `engines.dsh` 也无 `@deepseek-ai/dsh*` peer 时，必须出 `unknown` + `missingEvidence: ["missing.peer-declaration"]`，文案点名 row 与 module。沉默是不可接受的输出，因为用户读不出「沉默」与「没问题」的差别（CASE-7590 曾因此产出 0 条结论）；
- **运行时版本读不到时，行级仍然整段静默**（刻意）：此时每一行都只能是 `unknown`，而行级 80 行的重复没有信息量；bundle 级已经给出一次 `unknown` + `missing.runtime`。这是**唯一的**允许静默的情形，且有单测钉住（`tests/unit/rows.test.ts` 的 "without a runtime version row-level attribution stays silent"）；
- `severity: info` 的 `admission-row-scope` 必须排第一，保证文本渲染（只显示前 3 条）时行号不会被截掉。

## 2c. 次要通道：`dsh.compatibility`（R9 / T-108）

插件的 `dsh.compatibility`（`dsh` 精确钉定 / `dshReleases` 逐版本状态 / `profiles`）**只作为次要证据**读进来：

| 规则 | 实现 |
|---|---|
| 只加 `declared` 级证据（`evidence[].id = "compat-channel"`）+ 一条 `info`/`warn` 原因 | `packages/core/src/compat-channel.ts`，由 `verdict.ts#compatSurfacing` 挂载 |
| **不得单独判 `blocked`** | 最坏情况是 `unknown`（`tests/unit/compat-channel.test.ts` 负对照） |
| **不得把 `unknown` 升为 `go`** | 同上：自报 ≠ 实测 |
| 与 peer 结论**分列** | 独立的 reason / evidence，不合并进 `admission.unmet.*` |
| **bundle 级**：没有 peer 区间（`unconstrained`）出 `info`；与 peer 结论相左（`mismatch`）出 `warn`；一致时只留证据 | `verdictFromAdmission` |
| **行级**：**只在 `unconstrained` 行**挂载（避免每行都刷一条 warn）；「行级 peer 通过但 compat 不符」目前**不提示**，登记为 T-117 | `verdictsFromRowAdmission` |

`dshReleases` 里的键按「作者可能怎么写」比较（去空白、去 `v`/`=` 前缀、过 `semver.valid`），因为手写清单里出现 `v0.1.7-alpha.2` 是常态；比较失败会退化到更宽的 `dsh` 声明，从而把作者标注为不兼容的版本读成兼容——这是本通道唯一绝不能错的方向（R9 复核抓到，已修）。

`dshReleases` 里出现的未知状态（不是 `compatible`/`ok`/… 的字符串）按 **不兼容** 读——保守方向只能是「更不确定」，不能是「更乐观」。

## 3. 强制不变量
| 不变量 | 门禁检查 |
|---|---|
| `conclusion ∈ {go, risky, blocked, unknown}` | 枚举 |
| `evidence` 非空，每项含 `tier/source/method/at` | 字段完整性 |
| `tier ∈ {inferred, declared, scanned, measured-registry, measured-local}` | 枚举 |
| `confidence.level ∈ {low, medium, high}` 且 `basis` 是 tier | 枚举 |
| `reasons[].messageId` 形如 `admission.* / collision.* / runtime.* / remediation.* / missing.*` | 正则（禁内联散文）；`runtime.*` 是 M2-a 相位层的命名空间（见 `docs/specs/M2-inventory.md` §3） |
| 文案里的每个 `{占位符}` 必须由该条 `params` 提供（`reasons[]` 与 `remediation[]` 同规则） | 门 `verdict-contract` 的 `placeholder-params-required`：缺 key / `null` / 空串都算缺失；并带**双向自测**（缺即红 + 补齐即绿），防断言空转 |
| `missing.*` / `conclusion.*` 的文案**不得**含 `{占位符}`（这两条渲染路径根本不传 params） | 门 `verdict-contract` 的 `no-placeholders-without-params`（R9 复核后补：此前只盖住 reasons/remediation） |
| 行级 verdict：`subject.kind === "entry"` 时 `reasons` 必含 `admission-row-scope`，且其 `params.rows` 非空 | 单测 `tests/unit/rows.test.ts` |
| `blocked` / `risky` ⇒ `remediation.length ≥ 1` 且每项有 `note` | 条件断言 |
| `unknown` ⇒ `missingEvidence.length ≥ 1` | 条件断言 |
| 输出确定性：同输入同输出（时间戳由调用方注入 `generatedAt`） | 单测重复渲染比对 |

## 4. 置信度口径（禁止黑箱分数）

| level | 何时使用 | basis |
|---|---|---|
| `high` | 声明明确判定为 `denied`（可由宿主复现）；或本机实测失败 | `declared` / `measured-local` |
| `medium` | 仅声明层通过（**运行期行为未实测**） | `declared` |
| `low` | 需要推断，或依赖第三方 registry 结论 | `inferred` / `measured-registry` |

> `go` 的含义是「按声明可以装」，不是「已验证能跑」。运行期结论只有 probe 能给（M3）。

## 5. 渲染

- CLI 文本由 `renderVerdict(verdict, locale)` 生成，locale ∈ `en | zh`。
- 文案集中在 `packages/core/src/messages.ts`；新增原因码 = 新增 messageId + 两个语言条目。门 `verdict-contract` 现在检查两件事：① messageId 必须在目录里；② 文案里的每个 `{占位符}` 必须由该条 `params` 提供（R9 / T-116 起），缺一即红。
- Web 面板（M4）必须复用同一 `messageId`，不得自己编文案。
