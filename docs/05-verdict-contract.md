# 05 · Verdict 契约

> **Stand**: R10 (2026-10-27) | 实现：`packages/core/src/verdict.ts` + `types.ts` | 门禁：`scripts/gate_verdict_contract.mjs`

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

## 2d. Registry 事实：dist-tag 失步与区间形状（R10 / T-109 / T-115）
`check` 除了判「声明 vs 运行时」，还要回答一个更早的问题：**你装的是哪个构建**。

| 判据 | 规则 | 证据等级 |
|---|---|---|
| `latest` 是否落后 | `latest` 是**预发布**时，与「最新已发布（含 nightly/rc）」比；`latest` 是**稳定版**时只与「最新稳定版」比，更新的预发布另报 `prerelease-ahead`（**不算**失步）。注意：这里只区分「稳定 / 预发布」两类，不细分 rc 与 nightly 通道（见 `BS-18`） | `measured-registry` |
| tag 本身的完整性 | `latest` 缺失 → `latest-missing`；指向未发布版本 → `latest-unpublished`（装裸包名根本解析不出来）；指向作者已弃用的构建 → `latest-deprecated`；值非法 → `unknown` | `measured-registry` |
| 区间形状 | `exact`（`0.2.1-rc.2`、`=0.2.1-rc.2`）/ `unbounded`（`*`、裸 `>=x`、`>=1 \|\| >=2`）/ `bounded`（`^`、`~`、`1.x`、`>=x <y`、精确版并集）/ `unusable` / `absent` | `declared` |

强制规则（接线在 `verdict.ts#registrySurfacing` / `rangeShapeReasons`）：

- **不得越级**：registry 事实只能加 `info`/`warn` 原因与 `measured-registry` 证据，**永不改变 `conclusion` / `confidence`**；区间形状同理（作者侧建议，不是用户侧结论）；
- **只在 `check` 出现**：`why`/`audit` 描述的是已装集合，dist-tag 与它们无关（`registryDrift` / `rangeAdvice` 不传即不出现，旧产物逐字节不变）；
- `check` 的 verdict **默认**就带区间形状建议（`--json` 也有），`--explain` 额外打印 registry 事实块；`why` / `audit` 两者都不带；
- 终端渲染按 `block > warn > info` 稳定排序（`admission-row-scope` 仍钉在最前），保证「本轮头条」这类 warn 不会被两条 info 挤掉（R10 复核发现）。

真机复核（2026-10-27）：`@deepseek-ai/dsh-tools` / `dsh-base` 的 `latest` 停在 `0.0.1-rc.1`，`@deepseek-ai/dsh` 停在 `0.2.1-rc.2`，三者 `next` 都是 `0.2.1-rc.4` —— 证据 `data/results/registry-2026-10-27T19-00-00.000Z.json`。

## 2e. Probe：隔离实测的结论口径（R14 / T-301，R15 / T-302 扩）
probe 是唯一能出 `measured-local` 级「装得上、起得来」结论的通道，因此它的口径必须比声明层更窄，而不是更宽：

| 规则 | 实现 / 门 |
|---|---|
| `go` **只**表示「候选装上了 + Host 起了 + 端口应答了 + 候选行 active（+ 页面挂载出可见 DOM）」 | `packages/probe/src/exec.ts#judgeProbe`；文案 `probe.served` / `probe.row-active` / `probe.render-ok` |
| 不判安全、不判功能、不判 UI 可用 | `namespace-diff` 仍**必须**是 `unmeasured`（T-303）；`client-rendered` 自 R15 起**可测**（真浏览器 + CDP），无浏览器时必须 `unmeasured`，不许写成 passed |
| 有应答但页面没挂载出内容（白屏）→ `blocked`（`probe.render-blank`） | T-302；渲染判定是纯函数 `judgeRender`，单测钉住挂载点存在性、空根、零文本、错误页四种形状 |
| 渲染检查得不出结论（浏览器崩了/超时/浏览器错误页/无挂载点）→ 至多 `unknown` + `missing.render`（`probe.render-unmeasured`），不允许判 `go` | 无证据只能 unknown（铁律 1）；R15 复核实测：把 body 子节点当判据会让 Chrome 自己的错误页拿到 `rendered` |
| 候选行必须**唯一**：0 行 → `blocked`（`probe.row-missing`）；≥2 行 → `unknown`（`probe.row-ambiguous`） | 不猜归属（与 `runtime.ambiguous-entry` 同一条纪律） |
| 候选行存在但相位不是 `active` → `blocked`（`probe.row-inactive`），并点名相位 | `failed` 与 `null` 是两种失败形状，不许合并成「没起来」 |
| **测量失败 ≠ 插件失败**（R17 / BS-25）：hook 读不到树（`inactive context`）或树仍在动（`settled:false`）→ `unknown` + `missing.inventory`（`probe.tree-not-settled`），**禁止**判 `blocked`。**`ADR-0008` E（R26）只改等待、不改判据**：`settled:false` 立即收敛（`inventory.replacement_waited=false`，detail 里写明「没有再等替换样本」），`{error}` 仍等满窗口——两种形状的结论一模一样，都是 `unknown` | 只有 `valid` 读数（读到、无 error、`settled:true`）才能把失败归给候选；候选行相位仍是 `pending/loading/unloading` 时同样只能 `unknown`（N19 / N21） |
| 探针自己的临时目录准备/删除失败（R37：Windows 句柄 → `EPERM`）→ `unknown` + `missing.probe`（`probe.measurement-unavailable`） | 清理失败还**不许**销毁已经拿到的样本；`boot` 步抛任何异常都记成 `bootSetupError`，不再落到 `probe.boot-timeout`（N24 / N24b） |
| 树已稳定但端口窗口内无应答 → 仍 `blocked`（`probe.http-unreachable`） | 负对照 N20：防止本行上一条把「全都变 unknown」 || 清理不干净 → `risky`（`probe.cleanup-incomplete`），但测量结论不变 | 清理失败不是测量失败 |
| 实测运行时不在候选声明区间 → 降为 `unknown`（`probe.runtime-mismatch`） | 结论不可外推到没跑过的运行时 |
| `evidence[].method` 必须写真实传输 | `boot + <transport> inventory sample`；探针行自身从评分行里剔除 |

命名空间成员：`probe.served` / `probe.row-active` / `probe.row-inactive` / `probe.row-missing` / `probe.row-ambiguous` / `probe.install-failed` / `probe.install-failed-code` / `probe.install-build-refused` / `probe.boot-timeout` / `probe.http-unreachable` / `probe.runtime-unavailable` / `probe.runtime-mismatch` / `probe.sample-unreadable` / `probe.tree-not-settled` / `probe.startup-failed` / `probe.port-unavailable` / `probe.measurement-unavailable`（R37） / `probe.cleanup-incomplete` / `probe.render-ok` / `probe.render-blank` / `probe.render-unmeasured` / `probe.port-mismatch` / `probe.profile-copy-unusable` / `probe.profile-link-dangling` / `probe.profile-build-refused`。

> `probe.profile-*` 三条（R22 / T-304）都属于**组合侧**而非候选侧：前两条只能伴随 `unknown` + `missing.probe`，第三条是 `warn`（可以出现在 `go` 旁边，用来声明「沙盒跳过了组合自身的构建脚本」）。判据表见 `docs/specs/M3-probe.md` §3 与 §8.5。

## 2f. Agent 工具 `compat_verdict`（R36 / T-404）

工具的回答也是 verdict，所以它受同一份契约约束（真机产物 `data/results/agent-tool-2026-10-29T12-20-00.000Z.json` 的 `verdict` / `verdicts[]` 由本门直接校验）：

| 规则 | 实现 / 门 |
|---|---|
| 成功路径与 `check` 同源：`evaluateAdmission` → `judgeVersionDrift` → `verdictFromAdmission` | `packages/plugin/src/fit.ts#judgeFit`；工具**不含**第二条判定链 |
| 读不到 manifest（registry 不可达 / 包不存在 / 版本未发布 / 调用被取消 / profile 读不出来）→ `unknown` + `missingEvidence: ['missing.admission']` + `tool.verdict-unavailable`（`{detail}` 写真实原因） | 绝不抛；`evidence[].tier = inferred`（**没有**任何 manifest 被读到，就不许借 `declared`） |
| 工具回答的是**它服务的那个 profile** 的运行时 | `loadEnv({ dshHome, profile })` 由 loader 的 `ctx.baseUrl` 推出（R33 同一规则）；换一个 `--dsh-home` 的 CLI 结果与它不一致**不是**矛盾 |
| `go` 只表示声明层接受这个运行时 | 输出里的 `limits[]` 每次都写明：不安装、不执行候选代码、不读凭据、不判安全 |
| 参数由工具自己校验（注册表校验的是定义形状，不是调用参数） | `readPackageArgument`：非字符串 / 缺省 / 空白一律走 `empty-spec` → `unknown` |

命名空间成员：`tool.verdict-unavailable`（**新增命名空间**，与 R10 的 `registry.*`、R14 的 `probe.*` 同属「三处同改」：`messages.ts` 中英 + 门 `verdict-contract` 白名单 + 本节）。

## 3. 强制不变量
| 不变量 | 门禁检查 |
|---|---|
| `conclusion ∈ {go, risky, blocked, unknown}` | 枚举 |
| `evidence` 非空，每项含 `tier/source/method/at` | 字段完整性 |
| `tier ∈ {inferred, declared, scanned, measured-registry, measured-local}` | 枚举 |
| `confidence.level ∈ {low, medium, high}` 且 `basis` 是 tier | 枚举 |
| `reasons[].messageId` 形如 `admission.* / collision.* / registry.* / runtime.* / remediation.* / missing.* / probe.* / tool.* / prior.* / upgrade.*` | 正则（禁内联散文）；`runtime.*` 是 M2-a 相位层的命名空间（见 `docs/specs/M2-inventory.md` §3 与 §3.1），`registry.*` 是 R10 引入的 registry 事实命名空间，`probe.*` 是 M3 隔离实测的命名空间（见 §2e），`tool.*` 是 R36 的 Agent 工具命名空间（见 §2f），`prior.*` 是 M5-a（`ADR-0011` A 案）的先验注解命名空间：**只出现在 `check --explain` 的 `prior.note_id`，永不进 `conclusion` / `confidence` / `evidence[]` / `reasons[]`**，先验不改变 `conclusion`；`upgrade.*` 是 M5-b 升级影响清单的**标签**命名空间（见 `docs/specs/M5-upgrade.md` §6）：只出现在 `dsh-triage upgrade` 的文本输出与 registry 注解，**不进任何 `reasons[]`**，也不改变分桶 |

`runtime.*` 的完整成员（R12 起含 preset 维度）：`fiber-failed` / `no-fiber` / `disabled` / `missing-entry` / `ambiguous-entry` / `undeclared-entry` / `preset-unjudged` / `preset-conditional` / `preset-fiber-failed` / `preset-no-fiber` / `preset-divergence`。新增成员必须三处同改：`messages.ts` 文案（中英）、门 `verdict-contract` 白名单、本节与 `docs/specs/M2-inventory.md` §3。

`evidence[].method` 必须与真实传输一致：`plugin-inventory/list` 只用于真的走 Remote 的采样；进程内投影写 `readPluginInventory (in-process projection)`；文件未声明传输写 `inventory snapshot (transport unstated)`（刻意不借用 Remote 端点名）。门的 fixture `projection-never-claims-the-remote` 锁死这一条。
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
