# AI 使用登记（AI_DISCLOSURE_LOG）

> 规则：凡非人类手写模块（源码 / 门禁 / spec / 文档）必须登记；每轮 subagent 的 SessionID 必须落在本文件，禁写「见提交信息」。

## 格式

```
### <日期> <轮次ID>｜<一句话主题>
- 生成者：<模型/agent 名称>
- 范围：<文件或目录清单>
- 人工决策：<HUMAN 拍板的点，无则写「无」>
- 审核：<角色 × 结论（READY / NEEDS WORK）>
- SessionID：<必填>
- 备注：<诚实边界>
```

---

### 2026-10-26 R0｜M0 骨架落地

- 生成者：DeepSeek V4.1 Flash（主会话）
- 范围：仓根治理文件（AGENTS/PROJECT_RULES/INDEX/COMPLIANCE/README×2/LICENSE）、`.agents/rules/*`、`audit/*`、`backup/*`、`_archive/*`、`quarantine/*`、`docs/*`、`packages/*`、`scripts/gate_*.mjs`、`tests/*`
- 人工决策：项目定位（判断层）、产品名 `dsh-triage`、技术栈（TS + pnpm workspace + node:test）、治理范式沿用工作区同级项目
- 审核：单轮自审（正确性 + 可复现 + 合规 + SSOT 一致）；对抗性审核待 M1 前补齐
- SessionID：待 HUMAN 回填（本轮为骨架首建，未启用 subagent）
- 备注：M0 只承诺「可构建 + 门禁可跑通 + admission 对等」；Web 面板/probe 执行器/回流均为后续里程碑，README 已如实标注

### 2026-10-26 R1｜entry id 假阳性修复（27 → 0）

- 生成者：DeepSeek V4.1 Flash（主会话）
- 范围：`packages/core/src/ledger.ts`、`packages/core/src/verdict.ts`、`packages/core/src/messages.ts`、`tests/unit/ledger.test.ts`、`tests/unit/verdict.test.ts`、`docs/03-failure-taxonomy.md`、`docs/adr/0002-override-is-not-a-collision.md`
- 起因：首版 `findEntryIdCollisions` 按 id 分组计数，在本机**标准 profile** 上输出 27 条 blocked（`hmr`/`plan-mode`/`system-prompt` 等）。实读上游 patch 后发现 `- id: hmr` + `disabled: true` 是**覆写**而非重复定义
- 修复：冲突判定只统计「带 name/group 的行定义」；同 id 同模块视为合法重述；同 id 不同模块才 block。新增回归测试两条
- 证据：`data/results/why-2026-10-26T00-00-00.000Z.json`（collisions=0，sha256 随行）
- 审核：主会话自审（正确性 + 可复现 + SSOT 一致）；对抗性审核已记入 ADR 0002「测量 ≠ 结论」条款
- 人工决策：无（按 `integrity.md` 既有条款修正）
- SessionID：待 HUMAN 回填
- 备注：此轮暴露的通用风险已登记为 `audit/blind_spots.json` BS-04（静态提取看不到运行期注册），并推动「预期 FAIL 的负对照」写进铁律 4

### 2026-10-26 R2｜命名 + 仓库 + 路线 + Agent 框架

- 生成者：DeepSeek V4.1 Flash（主会话）
- 范围：`docs/ROADMAP.md`、`docs/BACKLOG.md`、`docs/HANDOFF.md`、`.agents/{README,roles/*,prompts/*,rules/adversarial_review}.md`、`AGENTS.md`、`INDEX.md`、`scripts/gate_governance.mjs`、`tests/governance/ledgers.test.ts`、四个 `package.json` 的 repository 字段、双 README 品牌行
- 命名决策：产品/仓名 **dsh-triage**，中文品牌「分诊台」；理由=语义精确（分诊=判断严重度与优先级）、短、可发音、npm 未占用
- 框架：6 张角色卡（researcher/implementer/verifier/reviewer/adversary/arbiter）+ 3 个模板 + 对抗性四反假设；**框架完整性进机器校验**（角色四节、模板一节、交接两节、SessionID 槽位）
- 参考来源：`oh_my_3Dcharacter/.agents/rules/*`、`Jufo-2026-ContextRobustness/.agents/rules/*`（仅借鉴结构，未复制代码；许可见 `quarantine/vendor-manifest.json`）
- 审核：主会话自审；`gate_governance` 新增 5 类校验并通过 --mutate 负对照
- 人工决策：HUMAN 指定「起名 + private 仓库 + 路线 + agent 框架」
- SessionID：待 HUMAN 回填
- 备注：仓库为 private；首推后仍需 HUMAN 决定是否转 public 与 npm 发布时机

### 2026-10-27 R8｜开源借鉴：副本来源归因 + 重复副本检测 + 借鉴台账

- 生成者：DeepSeek V4.1 Flash（主会话，兼 researcher / implementer / verifier / adversary）
- 范围：`packages/core/src/{duplicates,verdict,index,messages}.ts`、`packages/plugin/src/{load,cli}.ts`、`scripts/record_audit.mjs`（新）、`tests/{unit/duplicates,unit/rows-origin,e2e/duplicates-cli}.test.ts`（新）、`docs/09-open-source-borrowing.md`（新）、`data/results/{audit,gates,gates-mutate}-2026-10-27T12*.json`、`audit/{step_reviews,AUDIT_2026-10-27_R8}.json|md`、`docs/{HANDOFF,BACKLOG,AI_HANDOVER}.md`、`AGENTS.md`、`INDEX.md`、`README*.md`
- 取证：本轮实抓 7 份权威页面/仓库原文（npm explain、Maven dependencyConvergence、pip check、attw、publint、cargo-semver-checks、VS Code Extension Bisect）；其余来源标 B 级（不作实测证据）
- 结果：① npm `explain` 式来源归因（`admission-row-declared-by` + `remediation.declared-by`）；② Maven `dependencyConvergence` 式重复副本（`collision-duplicate-copy`，同名不同版本才报，两条路径 + 两个版本）；③ 台账把「已落地 / 只设计 / 明确不做」分档（不做 `npm audit` 式安全扫描、不做作者侧打包 lint）
- 人工决策：HUMAN 要求「大量借鉴开源逻辑融合进项目」；据此明确**只借机制不抄代码**（若抄须先 quarantine + vendor-manifest）
- 审核：`audit/AUDIT_2026-10-27_R8.md`（6 向对抗性反例：单副本 / 同版本 / peer 来源 / 假称已做 attw / 假称做安全扫描 / 绝对路径入 SSOT）
- 门禁：`verify` **91 测试 / 9 门全绿**；`--mutate` **9/9 CAUGHT**；`audit/step_reviews.json` 共 29 步
- 过程中的真实缺陷：`findDuplicateCopies` 一开始把 `env.profileDir` 当 `node_modules` 扫描 → 0 条命中；e2e 直接红，修后单测补上该回归。另两次 `node -e` 在 PowerShell 里被引号吃掉 → 已写入坑表
- 独立复核：另起只读 adversary 会话 → **PARTLY CONFIRMED**；当轮修 5 个真缺陷：同版本双副本仍被上报、依赖方 `devDependencies` 被当来源、软链/`link:` 目录被忽略、未知版本被当版本比较、嵌套副本必须先有根副本；另纠正「gate 锁死 params」的过度声称（改登记 T-116），并把产物/步骤数字按实测改写（23/30）
- SessionID：待 HUMAN 回填
- 备注：attw 矩阵 / `triage bisect` / 区间对齐都**只是设计**（T-113/T-114/T-115），前置条件写在 `docs/09` §3，别当成已交付

### 2026-10-27 R7｜M2-a P2 相位层落地（`audit --snapshot` + 新门 `inventory-contract`）

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- 范围：`packages/core/src/{inventory,index,messages,result}.ts`、`packages/plugin/src/cli.ts`、`scripts/{gate_inventory_contract,render_inventory}.mjs`（新）、`tests/{unit/inventory,e2e/inventory-cli}.test.ts`（新）、`tests/fixtures/inventory/cases.json`、`data/fixtures/inventory/desktop-web-2026-10-26.json`、`data/results/{inventory,gates,gates-mutate}-2026-10-27*.json`、`audit/{step_reviews,gate_ledger,blind_spots,AUDIT_2026-10-27_R7}.json|md`、`docs/{HANDOFF,BACKLOG,ROADMAP,06-roadmap,08-conventions,05-verdict-contract,AI_HANDOVER}.md`、`docs/specs/M2-inventory.md`、`AGENTS.md`、`INDEX.md`、`README*.md`、`.agents/prompts/kickoff.md`
- 取证：相位映射逐行照抄 `docs/specs/M2-inventory.md` §3（该表在 R4 已锁定）；上游枚举来自 `data/results/upstream-*.json`（沙箱实测 `fiber_phase` 五个值）
- 结果：**P2 交付**——`audit --snapshot` 能按行显示相位、列出「声明了但没跑」与「在跑但没人声明」，空快照/未知相位/缺名字都**报错或 unknown，绝不静默**
- 人工决策：HUMAN 同意「npm 占位发布由本人执行、仓库暂不转 public、本轮不碰 T-103/T-110」；未新增授权
- 审核：`audit/AUDIT_2026-10-27_R7.md`（B1–B5 逐条对照、3 条偏差、6 向对抗性反例）
- 门禁：`verify` **75 测试 / 9 门全绿**；`--mutate` **9/9 CAUGHT**；`audit/step_reviews.json` 共 24 步
- 过程中的真实缺陷：新结论用了 `runtime.*` 命名空间，被 `verdict-contract` 门的 messageId 白名单当场拦下 → 同步 `docs/05` 契约表 + 门正则（对齐 R4 已锁 spec，不是放宽阈值）；另修了一个 `for (const [a, b] of …)` 漏括号的语法错
- 独立复核：另起只读、不看实现的 adversary 会话 → **PARTLY CONFIRMED**；当场修 3 个洞：门未真正绑定 spec 表（改一行仍全绿）、`agentPresets` 被静默吞掉、`sample.kind` 自由文本且与文档不符；另改 4 处口径（B3 拆分、禁用行不判“在跑”、`--json` 新增字段、无 module 行计数）
- SessionID：待 HUMAN 回填
- 备注：**P1 与真机采样仍阻塞**（无 0.2.x 可启动 profile，`BS-15`）；对外只能说「相位表已实现」，不能说「实测过这台机器」

### 2026-10-26 R6｜D1 案例补齐（10 例 / 9 命中）+ 命中率脚本化 + 盲区修正

- 生成者：DeepSeek V4.1 Flash（主会话，兼 researcher / implementer / verifier / adversary）
- 范围：`data/cases/CASE-{10201,10759,10364,8751,8220,7590}/*`（新，共 13 份 npm 真实 manifest + 4 份 profile 重建层）、`scripts/d1_report.mjs`（新）、`tests/governance/d1-report.test.ts`（新，5 条）、`data/results/{d1,gates,gates-mutate,why-case-*}-2026-10-26T12-00-00.000Z.json`、`audit/step_reviews.json`（R6-S1…S9）、`audit/AUDIT_2026-10-26_R6.md`、`audit/blind_spots.json`（BS-10/11/12 + stand）、`docs/{HANDOFF,ROADMAP,BACKLOG,AI_HANDOVER}.md`、`AGENTS.md`、`INDEX.md`、`README.md`、`README.zh-CN.md`
- 取证：6 篇上游 Discussions（作者/日期/正文逐条抄进 `case.json#source`、`#reported`），其中 #10364 的回复是源码级定位（profile-resolution 优先级），用于纠正 R5 的过强判断
- 结果：**D1 通过 9/10**（`gate.passed=true`，`hit_rate=0.9`）；1 个 miss 是**有意保留**的负样本（CASE-7590：两个插件不声明任何 peer，失败在运行期 API 漂移）
- 人工决策：HUMAN 选择「按 6 例方案推进」「D1 若 7/10 则如实报不达标并回退 F2/F3」「签字项由 agent 按项目状态自行裁定」；据此裁定：**本轮不授权 T-103 金标扩容（冻结区）与 T-110 双 roadmap 合并**，npm 占位发布 / 仓库转 public 留给 HUMAN 且不阻塞 D1
- 审核：`audit/AUDIT_2026-10-26_R6.md`（5 项发现 + 8 条风险登记 + 6 向对抗性反例）；证据强度分层 `label_key_sources` 进产物（report-explicit 4 / derived 2 / unstated 4）
- 独立复核：另起只读、不看实现的 adversary 会话逐字节重放全部产物 → **CONFIRMED**；当场修 3 项（CASE-11080 旧产物不可重放 → 用当前脚本重放并保留旧产物；「dsh-im 什么都不声明」过强 → 补 `BS-13`/T-108；2 例日期 + 1 例作者名）；结构性限制登记为 `BS-14`/T-111（label 目前自证），对外口径改为「机器可复算的命中率」
- 门禁：`verify` 62 测试 / 8 门全绿；`--mutate` 8/8 CAUGHT；`audit/step_reviews.json` 共 19 步
- SessionID：待 HUMAN 回填
- 备注：不得把「9/10」写成「归因已完全成立」——miss 揭示的是声明层的信息上限；T-107（无声明行不得静默）与 T-109（dist-tag 失步信号）是它直接产出的需求

### 2026-10-26 R5｜案例扩容到 4 例（全命中）+ 过期信息清理 + 交接

- 生成者：DeepSeek V4.1 Flash（主会话，兼 researcher / implementer / verifier / adversary）
- 范围：`scripts/record_case.mjs`（candidate 模式）、`data/cases/CASE-{11012,8202,10849}/*`（新）、`data/results/why-case-*.json`（3 个新证据）、`audit/step_reviews.json`（R5-S1…S4）、`audit/AUDIT_2026-10-26_R5.md`、`_archive/2026-10-26_stale-status-before-R5.md` + `ARCHIVE_MANIFEST.md`、19 个文件的 Stand 行、`docs/{06-roadmap,AI_HANDOVER,HANDOFF,ROADMAP,BACKLOG}.md`、`PROJECT_RULES.md`、`AGENTS.md`、`INDEX.md`、`README.md`、`README.zh-CN.md`、`audit/gate_ledger.json`、`quarantine/vendor-manifest.json`
- 取证：全部来自上游 Discussions（该仓 issues 关闭）；每个案例的输入是 npm registry 的**真实已发布 manifest**，逐字固化进仓
- 结果：4 例全部命中，覆盖四种形态（行被禁用 / 传递依赖漂移 / 代际不兼容 / 装前被拒）
- 人工决策：**HUMAN 明确「不破例」**（D1 未达 10 例不进 M2）；追加要求「阶段结束做全方面审核 + 更新 + 过期信息归档 + 交接」
- 审核：`audit/AUDIT_2026-10-26_R5.md`（5 项本轮问题已修 + 5 项遗留带 owner）；对抗性：改版本、改 peer、换 label key 三向反例，命中均消失
- 门禁：`verify` 57 测试 / 8 门全绿；`--mutate` 8/8 CAUGHT；`audit/step_reviews.json` 共 10 步
- SessionID：待 HUMAN 回填
- 备注：**D1 仍差 6 例**（4/10）。候选池与预期命中/未命中已写进 R5 审核报告 §4；三例预计 miss 的（嵌套依赖 / 缺 name 行 / Desktop 平台维度）正是 M2/M3 的需求来源，不得为了凑数把 miss 写成 hit

### 2026-10-26 R4｜真实案例命中 + 行级 admission 归因 + 0.2.x 解阻塞

- 生成者：DeepSeek V4.1 Flash（主会话，兼 researcher / implementer / adversary 三职）
- 范围：`packages/core/src/{verdict,ledger,messages,index}.ts`、`packages/plugin/src/{load,cli}.ts`、`tests/unit/rows.test.ts`（新）、`tests/e2e/cli.test.ts`、`scripts/{record_case,bootstrap_upstream}.mjs`（新）、`scripts/scan_env.mjs`、`data/cases/CASE-11080/*`（新）、`data/results/*`、`docs/{HANDOFF,ROADMAP,BACKLOG,INDEX,02-signal-sources,07-environment}.md`、`docs/specs/{M1-why,M2-inventory}.md`、`quarantine/vendor-manifest.json`、`AGENTS.md`、本文件
- 取证：上游仓库 **issues 关闭、仅 Discussions**（`has_issues:false`）→ 从 discussions 首页取到 CASE-11080（作者 Yebeimu，2026-10-26）；插件/运行时 manifest 直接取 npm registry 原文并固化进仓（MIT，见 vendor-manifest `upstream-dsh`）
- 关键发现：**只按 bundle 判 admission 是结构性假阴**——`cordis.patch.yml` 里挂的行永远不会进 `why`。案例复现的第一版输出正是 "no denials or collisions found"（假阴性实证），修完才有行级 `blocked`
- 门禁：**7 → 8 门**（新增 `step-review`：每步四轴 + 对抗性 + 产物 sha256 重算 + 无孤儿产物；负对照 8/8 CAUGHT）；未放宽任何既有阈值；新增 messageId 全部落在 `admission.*` / `remediation.*` / `missing.*` 命名空间内（`gate_verdict_contract` 的 id 白名单）
- 人工决策：HUMAN 三轮拍板（A+C 并行轨道 / 由 agent 去社区取案例 / 授权 `%TEMP%` 隔离安装并固化成脚本）；**HUMAN 追加常设指令（2026-10-26）：「以后每个步骤做完都要审核，并且真实模拟测试」→ 已落为铁律 11 + 门 `step-review`（不是口头约定）**
- 审核：主会话自审（正确性 + 可复现 + 合规许可 + SSOT 一致）；对抗性：把「命中」写成机器可算指纹（`label.reason_code + requirement_key + entry_id`），`record_case` 只输出 hit/miss，不接受人工裁定
- SessionID：待 HUMAN 回填
- 备注：**D1 门槛未达**（1/10 例）。本轮不主张 D1 通过；若要按路线图进 M2，需 HUMAN 在 `HANDOFF §2` 写明破例理由（见 `ROADMAP §2` D1 现状）。三处诚实边界：案例是声明层复现（非真机）、bundles 置空、无法验证「修复后症状消失」
- 追加（同轮 HUMAN 指令「每步必审 + 真实模拟测试」后）：8 项真实缺陷已修（见 `audit/AUDIT_2026-10-26_R4.md` §1，含 R4-8 `--stamp` 校验）；`audit/step_reviews.json` 6 个步骤条目；`data/results/gates-mutate-*.json` 连跑两次哈希一致

### 2026-10-26 R3｜项目审核 + 交接（14 项修复）

- 生成者：DeepSeek V4.1 Flash（主会话，四轴 + 对抗性自查）
- 范围：见 `audit/AUDIT_2026-10-26_R3.md` §6 改动面（core 5 文件 / probe / plugin CLI / 4 个 gate 脚本 / 新门 release-pack / e2e 测试 / NOTICE / kickoff 模板 / .npmrc 与 pnpm-workspace / CI Windows job）
- 关键发现：**A1 SSOT 泄露 home 路径**（`evidence[].source` 未脱敏）——由新加的 e2e 测试当场抓到；修法 = 序列化边界 `redactVerdict` + `gate_governance#results-privacy`
- 其它：删除会撒谎的公开 API（A2）、重复 reason（A3）、英文修复文案（A4）、门禁不校验文案 id（A5）、`produced_by` 未校验（A6）、probe 首步语义（A7）、`.npmrc` npm 告警（A8）、无打包内容校验（A9）、CI 无 Windows（A10）、无 e2e（A11）、坑表缺失（A12）
- 审核：四轴 READY；对抗性四反假设逐条回答（见审核报告 §3）
- 人工决策：无（均按既有铁律修复）；4 项 blocked 需 HUMAN（npm 登录 / 转 public / 真实案例 / 0.2.x 真机）
- SessionID：待 HUMAN 回填
- 备注：门禁由 6 → 7；测试 44 → 47；SSOT 重新生成并脱敏（sha256 `19d71672c033…`）

### 2026-10-27 R9｜不静默一轮：占位符门 + 行级不静默 + 读 dsh.compatibility

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- 范围：`packages/core/src/{compat-channel(新),verdict,messages,index}.ts`、`packages/plugin/src/cli.ts`、`scripts/{gate_verdict_contract,d1_report,probe_live_sample(新)}.mjs`、`tests/{unit/rows,unit/compat-channel(新),governance/d1-report}.test.ts`、`data/results/{why-case-CASE-7590-2026-10-27T15-00-00.000Z,d1-2026-10-27T15-00-00.000Z,ns-live-attempt-2026-10-27T16-00-00.000Z,gates-2026-10-27T17-00-00.000Z,gates-mutate-2026-10-27T17-10-00.000Z}.json`、`audit/{AUDIT_2026-10-27_R9.md(新),step_reviews.json,blind_spots.json,gate_ledger.json}`、`docs/{05-verdict-contract,HANDOFF,BACKLOG}.md`、`docs/specs/M1-why.md`、`AGENTS.md`、`INDEX.md`
- 起因：R8 复核登记 T-116（文档曾声称 params 已锁死，实际没有）与 R6 登记的 BS-10（无声明行静默）/ BS-13（`dsh.compatibility` 未读）——三处都是「我们会说错话」
- 结果：① 门 `verdict-contract` 新增 `placeholder-params-required`（缺 key / `null` / 空串都算缺；双向自测：缺即红、补齐即绿；`remediation[]` 同规则）；② 行级 `unconstrained` 不再静默 → `unknown` + `missing.peer-declaration`（CASE-7590 由 0 verdict 变 2 verdict）；③ 新模块 `compat-channel.ts` 把 `dsh.compatibility.dsh` / `dshReleases` / `profiles` 读成 `declared` 级**次要**证据，三条 tier 纪律负对照（不得单独 blocked、不得把 unknown 升 go、未知状态按不兼容读）；④ `d1_report` 增 `miss_kind`（silent / explicit-unknown / explicit-other），**不改 label**；⑤ `probe_live_sample.mjs` 把「想采真机相位」的尝试落成台账（`outcome=blocked`，blocker = 沙盒 profile 未装依赖）
- 门禁：`verify` **110 测试 / 9 门全绿**；`--mutate` **9/9 CAUGHT**；`audit/step_reviews.json` 35 步
- 对抗性反例（全部真跑）：pset-unjudged 丢 `{rows}` → 门红；peer 通过而兼容通道不符 → 仍 `go`（只多 warn）；兼容通道匹配而 peer 拒绝 → 仍 `blocked`；只有兼容通道 → 最坏 `unknown`；未知 release 状态 → 按不兼容；CASE-7590 重放 → 2 条 unknown
- 真实缺陷（过程中）：PowerShell 里 `node -e` 带中文与引号再次被吃掉（改用临时 `.mjs`，已补坑表）；`dsh --dump-config` 因 `| Select-Object -First N` 提前关管道而「看起来 exit 1」，实际 exit 0
- 人工决策：HUMAN 选定 R9 范围（T-116 + T-107 + T-108）并批准「额外的 live 采样步，只作旁证、不影响主结论」
- SessionID：待 HUMAN 回填
- 备注：CASE-7590 **仍是 miss**；本轮只把失败方式从「静默」变成「显式 unknown + 点名作者自报通道」。`sample.kind=live` 仍未拿到，P1/B1/B2 阻塞未解除（见 `docs/HANDOFF.md` §8）

### 2026-10-27 R10｜让版本信号说真话：dist-tag 失步 + 区间形状

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- 范围：`packages/core/src/{version-drift(新),verdict,messages,index}.ts`、`packages/signals/src/npm.ts`（dist-tags + time）、`packages/plugin/src/cli.ts`（`check --explain` / `--json registry`）、`scripts/{record_registry(新),gate_verdict_contract}.mjs`、`tests/unit/version-drift.test.ts`（新）、`data/results/registry-2026-10-27T19-00-00.000Z.json`、`audit/{AUDIT_2026-10-27_R10.md(新),blind_spots.json,step_reviews.json}`、`docs/{05-verdict-contract,HANDOFF,BACKLOG}.md`、`AGENTS.md`、`INDEX.md`
- 起因：R6 登记的 F2（`dsh-tools` latest=0.0.1-rc.1 而 0.2.1-rc.x 已发布）与 R8 借鉴台账里的 T-115（syncpack 思路）；CASE-10849 / CASE-10201 两例的失败点都在「装裸包名拿到旧构建」这一步
- 结果：① `judgeVersionDrift` 同通道比较（`latest` 是预发布就比最新已发布；是稳定版就只比最新稳定版，更新的预发布另报 `prerelease-ahead`；`deprecated` 版本排除）；② `judgeRangeShape`（exact / unbounded / bounded / unusable / absent）；③ 新命名空间 `registry.*`（messages + 门白名单 + docs/05 三处同改），`check --explain` 出 registry 事实块、`--json` 出结构化 `registry.drift`；④ `admission.range-exact-pin`（info）/ `admission.range-unbounded`（warn）只在 `check` 出现；⑤ `scripts/record_registry.mjs` 把真机 registry 事实落成 SSOT
- 真机发现：`@deepseek-ai/dsh-tools` / `dsh-base` 的 latest 停在 0.0.1-rc.1、`@deepseek-ai/dsh` 停在 0.2.1-rc.2，三者 next 均为 0.2.1-rc.4（三个核心包全落后，工具自身也在内）
- 门禁：`verify` **124 测试 / 9 门全绿**；`--mutate` **9/9 CAUGHT**
- 过程中的真实缺陷：① 用 `semver.rcompare(a,b) > 0` 判「a 更新」——`rcompare` 是反向语义，方向写反，单测 8 条当场抓到（改用 `compare` + `rsort`）；② 第一版测试把 `0.1.7-alpha.2` 当成稳定版 `latest`，被自己的语义打回（改为真稳定版 0.1.7）；③ 用 PowerShell `Set-Content -Encoding utf8` 改 `.ts` 写出 BOM，已剥除并写进坑表
- 对抗性反例：稳定 latest + 更新预发布 → `prerelease-ahead` 不算失步；deprecated 的最新版 → 排除；latest 缺失/非法/无版本 → missing/unknown；registry 失步 + admission 通过 → 仍 `go`；registry 失步 + admission 拒绝 → 仍 `blocked`；`why`/`audit` 不传 registry 事实 → 旧产物逐字节不变
- 人工决策：HUMAN 只说「继续」，范围由 HANDOFF §3 的三选一确定（T-202 / T-109+T-115 / T-112，本轮在环境可信后选第二条）
- SessionID：待 HUMAN 回填
- 备注：registry 事实是**快照**，不解释「为什么标签是旧的」，也不能说明最新构建在你的运行时上能用；`deprecated` 只排除、不解释原因（登记 `BS-18`）

### 2026-10-27 R11｜环境解锁：DSH 本体 + 依赖装进仓内沙盒，并把 Host 真切起来一次

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- 范围：`scripts/{bootstrap_upstream,probe_live_sample}.mjs`、`.gitignore`（新增 `sandbox/`）、`docs/07-environment.md`、`docs/HANDOFF.md`、`INDEX.md`、`AGENTS.md`、`audit/step_reviews.json`、`data/results/{upstream-0.2.1-rc.4-2026-10-27T21-00-00.000Z,ns-live-attempt-2026-10-27T21-10-00.000Z,gates-2026-10-27T21-30-00.000Z,gates-mutate-2026-10-27T21-35-00.000Z}.json`
- 起因：HUMAN 指令「先下载依赖以及 DSH 本体用于测试；所有项目文件必须放在项目文件夹中」
- 结果：① 沙盒从 `%TEMP%` 迁到 `<repo>/sandbox/upstream/<version>/`（git 忽略，可随时删）；② `bootstrap_upstream.mjs` 新增 `--root` 与 `--with-profile-deps`（后者装 profile 自己的 `node_modules`，即 R9 记录的 mount blocker），并新增 compose 条目数与 `profile-dependencies` 两项证据；③ `probe_live_sample.mjs` 新增 `--boot`：真起 `dsh web`、抽 URL、探 HTTP、`taskkill /T` 收尾，`outcome` 增 `mounted-host`、`sample.kind=live-mount`
- 实测（0.2.1-rc.4）：runtime + profile 依赖装好（compose **191** 条）→ Host **11.8s** 起服务 → 带 token **303**（token→cookie 重定向）、无 token **401** → 端口干净关闭
- 关键结论：blocker 从「环境不可挂载」推进到「缺 `pluginInventory/list` 的 Remote 客户端」；**相位行仍未读到**（产物 `rows: []`，不冒充 live 样本）
- 门禁：`verify` **124 测试 / 9 门全绿**；`--mutate` **9/9 CAUGHT**；`step_reviews` **43 步**
- 过程中的真实缺陷：① 探 HTTP 跟随重定向（303+Set-Cookie → 假 401），改 `redirect: 'manual'`；② Windows 上 `child.kill()` 杀不掉 `dsh web`（端口仍监听），改 `taskkill /pid … /T /F` 并以「端口不再应答」为判据；③ 无 token 的 URL 用错正则拼出 `//` 得到 400，已修；④ `INDEX.md` 写了占位路径 `sandbox/upstream/<version>/` 被 `governance/index-references` 打红，已改
- 人工决策：HUMAN 指定「下载依赖 + DSH 本体用于测试」「所有项目文件放仓内」
- SessionID：待 HUMAN 回填
- 备注：沙盒不入库；session token 不进产物（`token=<token>`）；`~/.dsh` 未被读写；`mounted-host` ≠ 相位采样，B1/B2 仍未关闭
