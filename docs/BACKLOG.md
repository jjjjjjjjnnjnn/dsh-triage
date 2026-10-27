# BACKLOG · 可领取任务清单

> 规则：一个任务 = 一个可验收产物 + 一个角色 + 一个判据来源。领取前先读 `docs/HANDOFF.md`。
> 状态：`⬜ 待领` / `🟨 进行中` / `✅ 完成` / `⛔ 阻塞`（阻塞必须写 owner + 退出条件）

| ID | 任务 | 里程碑 | 角色 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|---|---|
| T-101 | 真实案例验收：把「插件静默消失」案例跑通 `why` 并落 SSOT | M1 | verifier + adversary | — | 点名行 = 真实根因；`data/results/why-case-*.json` 的 `hit.verdict=hit` | ✅ **D1 通过：10/10 例，9 命中 / 1 有意 miss**（`data/results/d1-2026-10-26T12-00-00.000Z.json` → `gate.passed=true`） |
| T-104 | 再收 6 例真实案例（把 D1 门槛凑到 10 例 ≥8 命中） | M1 | researcher + verifier | — | 每例 `record_case` 可复现；命中率 ≥80% | ✅ 2026-10-26 收齐：CASE-10201/10759/10364/8751/8220（hit）+ CASE-7590（miss 负样本）；R6 审核见 `audit/AUDIT_2026-10-26_R6.md` |
| T-107 | 行级 `unknown`：admission 为 indeterminate 的行不得静默 | M2-a | implementer | — | 不声明任何 `@deepseek-ai/dsh*` peer 的行产出 `unknown` + `missingEvidence`；负对照：静默即红 | ✅ **R9 完成**：`verdictsFromRowAdmission` 对 `unconstrained` 行出 `unknown` + `missing.peer-declaration`；CASE-7590 由 0 verdict 变 2 verdict（`data/results/why-case-CASE-7590-2026-10-27T15-00-00.000Z.json`） |
| T-109 | npm dist-tag 失步信号进 `check --explain`（T-701 子项） | M2 | implementer | — | 能显示「latest=X / next=Y / 已发布最新=Z」并标 tier；不得据此越级判 blocked | ✅ **R10 完成**：`packages/core/src/version-drift.ts` + `check --explain` + `--json registry`；真机证据 `data/results/registry-2026-10-27T19-00-00.000Z.json`（三个上游包 latest 全落后） |
| T-108 | 读 `dsh.compatibility.dsh` / `dshReleases` 作为**次要证据** | M2-a | implementer | — | verdict 中与 peer 结论分列；tier 不得越级、不得单独判 blocked；CASE-7590 由 miss 升为 `unknown` + `missingEvidence` | ✅ **R9 完成**：`packages/core/src/compat-channel.ts` + `verdict.ts#compatSurfacing`；CASE-7590 仍判 miss，但 `miss_kind=explicit-unknown`（`data/results/d1-2026-10-27T15-00-00.000Z.json`） |
| T-111 | label 独立签署：`label_verified_by` 字段 + 独立 verifier 流程 | 流程 | verifier + implementer | — | R7 起新案例先由独立上下文复核并签署；`d1_report` 输出已签/未签比例 | ⬜ R6 独立复核发现 A9 / `BS-14`（D1 目前是自证） |
| T-113 | attw 式「入口可加载性矩阵」：按解析模式 × 入口判定候选包会不会 import 失败 | M2-b | implementer | — | 先在沙箱实测 loader 的解析模式（两种），再实现矩阵；否则会造出假警告 | ⬜ R8 借鉴台账（`docs/09`，attw 仅设计） |
| T-114 | `triage bisect`：禁用一半行 → 重启 → 收敛（VS Code Extension Bisect 思路） | M3 | implementer | T-301 | 需要稳定启停一次 boot；输出「坏行 + 时间线证据」 | ⬜ R8 借鉴台账（`docs/09`） |
| T-115 | 版本区间对齐建议：peer 精确钉定 → 上游每次 patch 都会打挂（syncpack 思路） | M2 | implementer | T-109 | 与 T-109 合并设计；只提示不阻断 | ✅ **R10 完成**（与 T-109 同一轮）：`judgeRangeShape` + `admission.range-exact-pin` / `admission.range-unbounded`；仅 `check --explain` 出现，`conclusion` 不变 |
| T-116 | `messageId` 的 `{占位符}` 必须由 `reasons[].params` 提供，缺一即红 | 流程 | implementer | — | `gate_verdict_contract` 新增占位符完整性断言 + 负对照；现状只校验 messageId/severity | ✅ **R9 完成**：门新增 `placeholder-params-required`（双向自测：缺即红、补齐即绿，`reasons[]` 与 `remediation[]` 同规则）+ `--mutate` 注入第二类违规 |
| T-117 | 行级「peer 通过但 `dsh.compatibility` 相左」是否提示（`BS-17`） | M2-a | implementer | T-108 | 先定粒度（每模块一条）与是否进 `unknown`，再实现；在此之前文档明确「行级只在 `unconstrained` 时挂兼容通道」 | ⬜ R9 独立复核发现（行级相左目前不提示） |
| T-102 | `why` 支持 stderr 归因（import/apply 失败 → 行） | M2-b | implementer | T-201 | 3 类真实故障都能点名 | ⬜ |
| T-103 | 补 6 条金标：`workspace:` peer、`engines` 畸形、`^0.2.0` prerelease 边界 | M1 | implementer | — | parity 门绿 + 夹具 `why` 说明 | ⬜ |
| T-201 | 接入 `pluginInventory/list`（相位）到 `audit`/`why` | M2-a | implementer | — | 契约已在 `docs/specs/M2-inventory.md` 锁定（B1–B5）；实现走 P1 进程内 + P2 快照文件 | ✅ **R12 完成 P1（进程内投影）+ P2**：沙箱 Host 内 `readPluginInventory(ctx)` 真采样 → `data/results/inventory-live-2026-10-27T22-00-00.000Z.json`（`sample.kind=live`，195 行，`cross_check.agree=true`，B1/B2 关闭）；**Remote 客户端（真 `pluginInventory/list`）留作 P3** |
| T-112 | `agentPresets` 维度：同一 entry 在不同 preset 下相位不同，必须分开出结论 | M2-a | implementer | T-201 | 不取「最乐观值」；只有 `conditional` 的 preset 行标 `unknown` + 需会话上下文 | ✅ **R12 完成**：preset 分行判（`conditional` / `failed` / `no-fiber` / `broken` / 跨 preset 分歧五档），真机样本 4 个 preset / 98 行；`runtime.preset-*` 命名空间三处同改 |
| T-202 | 运行时命名空间快照（tools/commands/settings/skills） | M2-a | implementer | T-201 | 快照落 `data/results/ns-*.json` + 哈希 | ⬜ |
| T-203 | 冲突分级 v2：service / tool / command / slot / theme 权重表 | M2-a | implementer | T-202 | 单测覆盖 5 类；文档 `docs/03` F4 更新 | ⬜ |
| T-105 | `audit` 与 `why` 结论同源：`audit` 也要给出行级 admission 结论 | M2-a | implementer | T-201 | 同一 profile 下两命令交叉一致（e2e 断言） | ⬜ R4 审核遗留（`audit/AUDIT_2026-10-26_R4.md` §5） |
| T-106 | `step-review` 升级：结论必须引用具体反例命令/路径的结构化字段 | 流程 | implementer | — | 套话无法通过（新增结构化断言 + 负对照） | ⬜ 对应 BS-09 |
| T-301 | probe 执行器（boot/http 两段） | M3 | implementer | T-201 | 单次 ≤20s；失败清理；dry-run 默认 | ⬜ |
| T-302 | probe 的 client-rendered 断言（BS-03） | M3 | implementer | T-301 | 能识别「HTTP 200 但白屏」 | ⬜ |
| T-303 | probe 的 namespace-diff 断言 | M3 | verifier | T-202, T-301 | 声明了但未注册的工具能被列出 | ⬜ |
| T-401 | Web 面板骨架（`settings.plugins.tab`） | M4-a | implementer | 上游 cordis 类型 | 面板显示与 CLI 同源结论 | ⬜ |
| T-402 | 徽章服务（SVG，插件×dsh×os） | M4-b | implementer | — | 徽章可按 SSOT 渲染；带 dsh.so 署名 | ⬜ |
| T-403 | format-1 索引源生成器 | M4-b | implementer | T-402 | 输出通过 `format:1` 字段校验；可在 Discover 添加 | ⬜ |
| T-404 | `compat_verdict` Agent 工具 | M4-b | implementer | T-201 | 工具返回 verdict JSON；失败降级 `unknown` | ⬜ |
| T-501 | 回流 schema + opt-in 开关 + 删除路径 | M5-a | implementer + reviewer(合规) | — | 0 PII；可删除；文档说明 | ⬜ |
| T-502 | 升级影响清单生成器（给定目标 dsh 版本） | M5-b | implementer | T-201 | 24h 内产出；含修复建议 | ⬜ |
| T-601 | 上架文案（zh/en）+ 提交 3 渠道 | 1.0 | arbiter | 功能完成 | `gate_release --publish` 绿 + 2 渠道收录 | ⬜ |
| T-602 | 案例帖 ×3（消失的工具 / 白屏 / 升级后起不来） | 增长 | researcher | T-101 | 每篇含真实 SSOT 证据 | ⬜ |
| T-701 | 把 `dsh.so` 数据接入 `check`（作为先验，tier 不得越级） | M2 | implementer | — | `--explain` 显示 registry 先验与本地结论差异 | ⬜ |

---

## R12 已交付（本轮，证据见 `data/results/inventory-live-2026-10-27T22-00-00.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| T-201 P1 | `scripts/probe_hooks/inventory-hook.mjs`：在沙箱 Host 内调上游导出的 `readPluginInventory(ctx)`，等树稳定（无 pending/loading）后落盘；`scripts/record_live_inventory.mjs` 负责挂载/采样/杀树/交叉校验/脱敏 | ✅ |
| T-112 | preset 维度：`InventoryPreset`/`InventoryPresetRow` 解析 + 五档判法（`preset-conditional` / `preset-fiber-failed` / `preset-no-fiber` / `preset-unjudged` / `preset-divergence`）；禁用的 preset 行不刷屏 | ✅ |
| NEW | `transport` 字段进快照契约（`remote` / `in-process-projection`），证据 `method` 随传输变化；fixture `projection-never-claims-the-remote` 锁死 | ✅ |
| NEW | id 形态解析：`include:tool-bash` ≡ 声明行 `tool-bash`（唯一后缀），两候选 → `runtime.ambiguous-entry`（不猜）；新原因 `missing.row-identity` | ✅ |
| FIX | `dsh.bundle.patch` 支持**数组**（上游默认形态）：此前只读字符串分支，`dsh-web-app` 整层被静默跳过。修后真机 `undeclared` 195 → 3 | ✅ |
| FIX | preset 声明读取：`config.plugins` 里的组合行（`extractPresetDeclarations`），而不是把 preset 载体行当成 1 条声明 | ✅ |
| 真机发现 | 沙箱 Host：194 行 = 167 active + 27 disabled（27 条全是 disabled）；4 个 preset / 98 行；无 failed、无 broken、无 conditional | ✅ |
| 测试 | +8（`tests/unit/inventory.test.ts` 22 条），总 **135**；9 门 / `--mutate` 9/9 | ✅ |
| 重放 | `data/results/inventory-2026-10-27T00-00-00.000Z.json`（R7 合成样本）用当前引擎重放：preset 档位变了，夹具未改；sha256 同步进 `audit/step_reviews.json` | ✅ |

---

## R10 已交付（证据见 `data/results/registry-2026-10-27T19-00-00.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| T-109 | 新模块 `packages/core/src/version-drift.ts`：同通道比较 dist-tag（`latest` 是预发布→比最新已发布；是稳定版→只比最新稳定版，更新的预发布另报 `prerelease-ahead`）；`check --explain` 打印 `latest`/`next`/已发布最新，`--json` 另有 `registry.drift` | ✅ |
| T-115 | `judgeRangeShape`：`exact` / `unbounded` / `bounded` / `unusable` / `absent`；`check` 时出 `admission.range-exact-pin`（info）与 `admission.range-unbounded`（warn），**不改变结论** | ✅ |
| NEW | 命名空间 `registry.*`（`registry.latest-behind` / `prerelease-ahead` / `latest-missing` / `tags` / `drift-none` / `drift-unknown`）；门 `verdict-contract` 白名单 + `docs/05` §3 三处同改 | ✅ |
| NEW | `scripts/record_registry.mjs`：真查 npm 并把 drift 判断落成 SSOT（`registry-*.json`，元数据 only，不下载 tarball） | ✅ |
| 真机发现 | 三个上游核心包的 `latest` 全落后：`dsh-tools` / `dsh-base` = `0.0.1-rc.1`，`dsh` = `0.2.1-rc.2`，三者 `next` = `0.2.1-rc.4` | ✅ |
| 测试 | +14 单测（`tests/unit/version-drift.test.ts`），总 **124**；9 门 / `--mutate` 9/9 | ✅ |

---

## R9 已交付（本轮，证据见 `data/results/d1-2026-10-27T15-00-00.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| T-116 | 门 `verdict-contract` 增 `placeholder-params-required`：文案里的 `{占位符}` 必须由 `params` 提供（缺 key / `null` / 空串都算缺），带双向自测 + `--mutate` 第二类注入 | ✅ |
| T-107 | 行级 `unconstrained` 由「静默」改为 `unknown` + `missing.peer-declaration`；CASE-7590 从 0 verdict 变 2 verdict | ✅ |
| T-108 | 新模块 `packages/core/src/compat-channel.ts`：读 `dsh.compatibility` / `dshReleases` / `profiles` 作 `declared` 级次要证据；三条 tier 纪律负对照 | ✅ |
| D1 口径 | `scripts/d1_report.mjs` 增 `miss_kind`（`silent` / `explicit-unknown` / `explicit-other`）+ `totals.miss_by_kind`；**不改任何 label**，只加派生分类；`tests/governance` 两条新断言 | ✅ |
| NEW | `scripts/probe_live_sample.mjs`：0.2.x 沙盒真机采样的**尝试台账**（`outcome=blocked` 也落盘，`sample.kind=live-attempt`），当前 blocker = 沙盒 profile 未装依赖 | ✅ |
| 真机复跑 | `data/results/why-2026-10-27T18-20-00.000Z.json`：本机 0.1.0-rc.6 / 156 行 → 4 条结论（2 `go` + 2 行级 `unknown`），证明 T-107 在真实 profile 上不刷屏 | ✅ |
| 测试 | +14（单测 12 + 治理 2），总 **110**；9 门 / `--mutate` 9/9 | ✅ |
| 独立复核 | 只读对抗性会话（`ses_e8440b560ffej1y7jzfl0ofsii`）判定 PARTLY CONFIRMED，4 个必须修的洞全部当场修（占位符只盖 reasons/remediation、CLI note 自相矛盾、live 脚本死分支+硬编码原因、mutate 注入可静默跳过）；另修 4 处口径并新增 `BS-17` / T-117 | ✅ 见 `audit/AUDIT_2026-10-27_R9.md` §8 |
| 未做 | T-109 dist-tag、T-111 label 独立签署、T-112 preset 维度、T-202 快照、P1 相位 | ⬜ 见 `audit/AUDIT_2026-10-27_R9.md` §4 |

---

## R8 已交付（证据见 `data/results/audit-2026-10-27T12-00-00.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| 借鉴台账 | `docs/09-open-source-borrowing.md`：14 个来源，分「已落地 / 只设计 / 明确不做」三档，含许可与证据等级 | ✅ |
| NEW | **副本来源归因**（借 npm `explain` + Maven「paths to dependency」）：行被拒时点名「这份副本来自 `dsh-pdf@0.1.0` 的 `dependencies`」 | ✅ |
| NEW | **重复副本检测**（借 Maven `dependencyConvergence`）：同名不同版本 → `collision-duplicate-copy`，两条路径 + 两个版本；同版本硬链不算 | ✅ |
| NEW | `scripts/record_audit.mjs`：把一次 audit（行 + 来源 + 重复副本 + 结论）写成 SSOT | ✅ |
| 测试 | +15（单测 9 + e2e 3 + 其他回归），总 **91**；9 门 / `--mutate` 9/9 | ✅ |
| 复核修正 | 独立对抗性会话（只读、不看实现）判定 PARTLY CONFIRMED，抓出 5 个必须当场修的洞：同版本双副本仍被上报、`devDependencies` 被当来源（依赖方 devDeps 根本不装）、软链/`link:` 目录被当成不存在、未知版本被当版本比较、嵌套副本必须先有根副本；另把「gate 锁死 params」的过度声称改成事实 | ✅ 见 `audit/AUDIT_2026-10-27_R8.md` §7 |
| 登记 | 只设计：T-113（attw 矩阵）、T-114（bisect）、T-115（区间对齐）、T-116（占位符完整性）；明确不做：`npm audit` 式漏洞扫描、作者侧打包 lint | ✅ |

---

## R7 已交付（证据见 `data/results/inventory-2026-10-27T00-00-00.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| T-201 P2 | 相位层：`packages/core/src/inventory.ts`（防御式解析 + 相位→结论映射 + 声明/运行 diff） | ✅ |
| CLI | `dsh-triage audit --snapshot <file>`：行旁相位、missing/undeclared 两段、结论卡；无 `--snapshot` 时行为不变 | ✅ |
| NEW | 门 **`inventory-contract`**（9 门）：fixtures 逐行回放 spec §3 + 上游 `fiberPhase` 枚举比对 + 中英文案存在性；`--mutate` 可打红 | ✅ |
| NEW | `scripts/render_inventory.mjs`：把一次相位判定写成 SSOT（`sample.kind` 自曝 synthetic/live） | ✅ |
| 测试 | +13（单测 10 + e2e 3），总 **75**；套件 9 门 / `--mutate` 9/9 | ✅ |
| 未做 | P1（Host 内取相位）、真机样本、`agentPresets` 维度（T-112） | ⬜ 见 `audit/AUDIT_2026-10-27_R7.md` §3 |
| 复核修正 | 独立对抗性会话（只读、不看实现）判定 PARTLY CONFIRMED，抓出 3 个必须当场修的洞：**门没真正绑定 spec 表**（改一行结论仍全绿）、**`agentPresets` 被静默吞掉**（failed 的 preset 行完全不可见）、**`sample.kind` 是自由文本且默认值与文档不符**；另改 4 处口径（B3 拆分、禁用行不判“在跑”、`--json` 多字段、无 module 行计数） | ✅ 见 `audit/AUDIT_2026-10-27_R7.md` §8 |

---

## R6 已交付（证据见 `data/results/d1-2026-10-26T12-00-00.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| T-104 | **+6 例真实案例**：10201 / 10759 / 10364 / 8751 / 8220 全命中，7590 为有意保留的 miss 负样本 | ✅ |
| D1 | **9/10 hit = 90% ≥ 80%**，判定由 `scripts/d1_report.mjs` 从产物汇总（不再手写数字） | ✅ |
| NEW | `scripts/d1_report.mjs`：D1 命中率 → `data/results/d1-*.json` + `.sha256`；含 `label_key_sources` 分层（report-explicit / derived / unstated） | ✅ |
| NEW | `tests/governance/d1-report.test.ts`（5 条）：反向点数、重复产物去重、非法 hit 值拒绝、短样本必红、同 stamp 逐字节一致 | ✅ |
| FIX | R5 对 #10364 的「嵌套 `node_modules` 不可见」判断被实抓正文证伪（实为 hoist 到 profile 层，可见）→ 修正为 `BS-11` | ✅ |
| NEW | 盲区 `BS-10`（无声明行静默 → T-107）/ `BS-11`（遮蔽可见性边界）/ `BS-12`（命中 key 的证据强度分层） | ✅ |
| 复核 | **独立对抗性会话**（只读、不看实现）逐字节重放全部产物：D1 结论 CONFIRMED；另抓 3 项当场修 —— CASE-11080 旧产物不可重放（已用当前脚本重放，R6-S10）、「dsh-im 什么都不声明」过强（实际带 `dsh.compatibility` 通道 → `BS-13`/T-108）、2 例来源日期与 1 例作者名 | ✅ 见 `audit/AUDIT_2026-10-26_R6.md` §10 |

---

## R4 已交付（证据见 `data/results/why-case-CASE-11080-*.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| NEW | **门 `step-review`**（7→8 门）：每一步必须有四轴 + 对抗性结论，且 real_test 产物 sha256 可重算；`data/results` 不得有孤儿产物 | ✅ |
| NEW | `node scripts/gate.mjs --record --stamp <iso>`：把整轮门禁结果写成 `data/results/gates-*.json`，「全绿」变成可重算证据 | ✅ |
| NEW | `audit/step_reviews.json` + `PROJECT_RULES` 铁律 11 + playbook §1b：每步必审 + 真实模拟测试（机器强制） | ✅ |
| FIX | R4 审核发现的 7 项真实缺陷（行级假阴、相对路径误判、BOM、autocrlf 哈希漂移、沙盒过度声明、文本刷屏、空包名） | ✅ 见 `audit/AUDIT_2026-10-26_R4.md` |
| T-101 | 真实案例命中：升级后 `cordis.patch.yml` 的行被静默禁用（peer 钉旧版本） | ✅ |
| A7/A8 | **行级 admission 归因**：此前只按 bundle 判，patch 里的 row 逃检（假阴）；未安装模块只能 `unknown` | ✅ |
| NEW | `scripts/record_case.mjs`：案例输入固化 + 隔离复现 + 机器可算命中判定 + SSOT | ✅ |
| NEW | `scripts/bootstrap_upstream.mjs`：0.2.x 隔离运行时（不写 `~/.dsh`）+ 契约实测 SSOT | ✅ |
| NEW | `docs/specs/M2-inventory.md`：`pluginInventory` 契约、相位映射、P1/P2/P3 传输路径、负对照 | ✅ |
| 测试 | +4 单测（`tests/unit/rows.test.ts`）+3 e2e（row 命中、相对路径 row、缺失包不判 go）= 56 条 | ✅ |

---

## R3 已修（证据见 `audit/AUDIT_2026-10-26_R3.md`）

| 审核 ID | 内容 | 状态 |
|---|---|---|
| A1 | SSOT 泄露 home 路径（`evidence[].source`）→ `redactVerdict` + `results-privacy` 门 | ✅ |
| A2 | 删除会撒谎的公开 API `readDshPeerRequirements` | ✅ |
| A3 | admitted verdict 重复渲染同一文案 → 新增 `admission.declared-only` | ✅ |
| A4 | 修复文案硬编码英文 → `Remediation.messageId/params` + 本地化渲染 | ✅ |
| A5 | 门禁校验 messageId 必须存在于 `messages.ts` | ✅ |
| A6 | `gate_ssot` 校验 `produced_by` 指向真实脚本 | ✅ |
| A7 | probe 首步语义修正（`runtime-check`） | ✅ |
| A8 | `.npmrc` 去掉 pnpm 专属键（消除 npm 告警） | ✅ |
| A9 | 新门 `release-pack`：实测 `npm pack` 内容 | ✅ |
| A10 | CI 增加 Windows job | ✅ |
| A11 | 新增 e2e CLI 测试（含脱敏断言） | ✅ |
| A12 | 坑表补 3 条真实故障 | ✅ |

---

## 领取流程（3 步）

1. 把状态改 `🟨 进行中` 并写上自己的名字/agent 名（同一提交）；
2. 按 `.agents/prompts/task-packet.md` 自查边界（允许改哪些文件）；
3. 完成后：`pnpm run verify` + `node scripts/gate.mjs --mutate` → 更新状态为 `✅` 并在 `audit/AI_DISCLOSURE_LOG.md` 留痕。

## 禁止事项

- 禁同时领取两个有文件重叠的任务（同文件禁并行）；
- 禁跳过依赖（例：没接 T-201 就做 T-301）；
- 禁把「未做完」标成 `✅`（可标 `⛔` 并写清退出条件）。
