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

### 2026-10-27 R12｜让相位来自真机（T-201 P1 进程内投影 + T-112 preset 维度）+ 两个真 bug

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）+ 独立对抗性复核子会话（只读）
- 范围：`scripts/probe_hooks/inventory-hook.mjs`（新）、`scripts/record_live_inventory.mjs`（新）、`packages/core/src/{inventory,ledger,messages,index}.ts`、`packages/plugin/src/{cli,load}.ts`、`scripts/gate_inventory_contract.mjs`、`tests/{unit/inventory,e2e/inventory-cli}.test.ts`、`tests/fixtures/{inventory/cases.json,env/home/profiles/desktop/package.json}`、`docs/{HANDOFF,BACKLOG,ROADMAP,05-verdict-contract,07-environment,specs/M2-inventory}.md`、`INDEX.md`、`AGENTS.md`、`.agents/prompts/kickoff.md`、`audit/{blind_spots.json,step_reviews.json,AUDIT_2026-10-27_R12.md}`、`data/results/inventory-live-2026-10-27T22-00-00.000Z.json`（新）+ `inventory-2026-10-27T00-00-00.000Z.json`（重放）
- 起因：HUMAN 指令「交接项目过来，进行下一步计划」→ 选定 R12 = P1 真机快照 + T-112 合并；并授权「真机数据与 spec 冲突时只记录、不改判据」
- 结果：① 探针在沙箱 Host 内调用上游导出的 `readPluginInventory(ctx)`（`list()` 内部同一函数），等树稳定后落盘；产物 `transport=in-process-projection`，**不冒充 Remote**；② 记录器串起「挂载 → 采样 → 杀进程树 → CLI 交叉校验 → 脱敏 → SSOT」，`cross_check.agree=true`；③ preset 维度五档判法 + 跨 preset 分歧显式化；④ 真 bug 两个：`dsh.bundle.patch` 数组形态被静默丢弃（`undeclared` 195→4）、loader id 带 `include:` 前缀（`missing` 96→0，新增 `runtime.ambiguous-entry` 不猜归属）
- 实测（0.2.1-rc.4 沙盒）：194 行 = 167 active + 27 disabled；4 个 preset / 98 行；9.2s 起服务、采样 4.8s 稳定；无 failed / broken / conditional 行
- 门禁：`verify` **135 测试 / 9 门全绿**；`--mutate` **9/9 CAUGHT**
- 过程中的真实缺陷：① `dsh web --patch` 被当 app 参数（launcher flag 必须在 profile 名之前）；② 探针裸模块名解析失败（改用 `createRequire(resolveFrom)` 指到运行中的 profile）；③ 交叉校验把「0 条」当 `undefined` 误报不一致；④ `.sha256` 带文件名导致 `gate_ssot` 红；⑤ 脱敏漏掉 `file:///` 百分号编码路径；⑥ 旧合成产物因 preset 命名空间变更被 `verdict-contract` 打红，按同一 stamp 重放并同步 sha256
- 独立复核：只读对抗性会话判 PARTLY CONFIRMED，6 条必须修全部当场修完（详见 udit/AUDIT_2026-10-27_R12.md §8.1）：交叉校验只比计数（翻转 87 条 preset 仍 agree）→ 改按身份比对；探针因子句 id 前缀没被排除 → 从发布快照剔除并加硬断言；id 后缀匹配不看模块名（真缺失被野行抵消）→ 加同包约束；	ransport 自证且不在快照内 → 写进快照 + 门加正向断言 + 未声明不借用 Remote 名；preset 拒绝理由造假 / broken+rows 吞行 / 重复 id → 逐条具体理由 + 拒绝；复核时门不绿 → 收尾按序补齐并重跑（S6/S7）
- 人工决策：HUMAN 选择「P1 真机快照 + T-112 合并」；「spec 冲突只记录不改判据」
- SessionID：待 HUMAN 回填
- 备注：真机样本产地是**仓内沙盒**，不是用户 `~/.dsh`；对外只能说「在一台真起的 0.2.1-rc.4 Host 上实测」。`B3` 仍只有夹具覆盖（`BS-20`），静态侧不全登记 `BS-19`

### 2026-10-27 R13｜能力层取证（T-202 收窄为事实+差分）+ 两命令同源（T-105）

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- 范围：`packages/core/src/{capabilities,index,result}.ts`、`packages/plugin/src/cli.ts`、`scripts/probe_hooks/inventory-hook.mjs`、`scripts/lib/live.mjs`（新）、`scripts/record_live_capabilities.mjs`（新）、`scripts/record_live_inventory.mjs`、`tests/unit/capabilities.test.ts`（新）、`tests/e2e/cli.test.ts`、`docs/specs/M2-capabilities.md`（新）、`docs/{HANDOFF,BACKLOG}.md`、`INDEX.md`、`audit/{blind_spots.json,step_reviews.json,AUDIT_2026-10-27_R13.md}`、`data/results/{capabilities-2026-10-27T23-30-00.000Z,inventory-live-2026-10-27T22-00-00.000Z,gates-2026-10-28T00-10-00.000Z,gates-mutate-2026-10-28T00-15-00.000Z}.json`
- 起因：HUMAN 指令「继续，计划以后，开始继续进行」→ 选 T-202 作为 R13，取证后再定实现边界
- 结果：① 能力层交付**事实 + 差分**（`registry: null` 与空清单严格区分、`read_error` / `presentation` 诚实字段、`diffCapabilities`），**不产出「工具缺失」结论**；② 三条硬边界实测：上游插件不静态声明工具名（`BS-22`）、工具注册在 agent/preset 作用域（进程级探针只见全局层 1 个工具，`BS-21`）、`ptc` 折叠可见面；③ T-202 拆成 T-202a（会话作用域，⛔ 需真实会话/M3）与 T-202b（✅ 本轮）；④ **T-105 完成**：`audit` 与 `why` 行级 admission 同源，e2e 比集合；⑤ 两个 live 记录器共用 `scripts/lib/live.mjs`
- 实测：沙盒 Host 4 次真机启动（8.2–9.5s/次）；能力产物 `outcome=expectation-not-met`（基线/禁用各 1 个工具），这不是故障而是本轮要证明的边界
- 门禁：`verify` **142 测试 / 9 门全绿**；`--mutate` **9/9 CAUGHT**；step_reviews **55 步**
- 过程中的真实缺陷：① `dsh web --patch` 被当 app 参数（launcher flag 顺序）；② 探针裸模块名解析失败 → `createRequire(resolveFrom)`；③ `sha256Of` 在 ESM 里用 `require`（改为顶部 import）；④ 首版把「期望未达成」记成 blocker（outcome=blocked）→ 改为 `expectation-not-met`（发现≠故障）；⑤ `audit` 引入行级结论后，`unknown` 若计入失败会让沙盒真机（72 条 unconstrained）永远 exit 1 → 定规则「unknown 不计入失败」，与 `why` 默认一致，并新增 e2e 交叉断言
- 人工决策：无（本轮无冻结区改动、无判据变更）；T-202a 需要 HUMAN 决定是否允许使用一次真实会话的模型凭据
- SessionID：待 HUMAN 回填
- 备注：本轮**不新增 verdict 命名空间**——没有判据来源就不造结论。对外只能称「工具清单（全局层）与两样本差分可用」，不能说「能判断工具为什么不见了」

### 2026-10-28 R14｜M3 probe 执行器（T-301）+ 金标扩容（T-103）+ roadmap 合并（T-110）

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- 范围：`packages/probe/src/{exec,host,plan,index}.ts`（exec/host 新）、`packages/probe/hooks/inventory-hook.mjs`（自 `scripts/probe_hooks/` 迁入）、`packages/plugin/src/{cli,probe-run}.ts`（probe-run 新）、`scripts/{lib/live.mjs}`（live 改为再导出）、`scripts/gate_namespace.mjs`、`scripts/record_probe.mjs`（新）、`tests/{unit/probe-exec.test.ts,unit/probe.test.ts,e2e/probe-cli.test.ts}`、`tests/fixtures/probe/{ok,broken,throw}-plugin/`（新）、`data/gold/admission-cases.json`（27 条）、`data/results/{probe-ok,probe-red-apply-fail,probe-red-import-fail,inventory-live,gates,gates-mutate}-2026-10-28*.json`、`docs/{specs/M3-probe.md（新）,ROADMAP,05-verdict-contract,HANDOFF,BACKLOG,00-vision,AI_HANDOVER,market/listing_zh}.md`、`_archive/{2026-10-28_06-roadmap-merged-into-ROADMAP.md,ARCHIVE_MANIFEST.md}`、`INDEX.md`、`AGENTS.md`、`audit/{blind_spots.json,step_reviews.json,AUDIT_2026-10-28_R14.md}`
- 起因：HUMAN 指令「交接项目过来，进行下一步计划」→ 给出 R14 三选一，HUMAN 选 A（T-301）并签字三项（T-103 金标扩容 / T-110 roadmap 合并 / 允许 T-202a 凭据方向）
- 结果：① **probe 执行器交付**：六步状态机 + `judgeProbe` 纯函数 + 六断言表（`client-rendered`/`namespace-diff` 恒 `unmeasured`）；② 真机一绿两红：go（boot→sample 11.8s / HTTP 401 / 行 active / 清理双判据）、apply 抛错 → `failed`、import 抛错 → `null`；③ **修掉我们自己的 bundle patch 缺陷**（`- id:` 是 patch 不是 insert，装了不挂载），门 `namespace` 新增 `rows-are-inserted` 并双向自测；④ 起 Host 机械收进 `host.ts` 一处，`scripts/lib/live.mjs` 只再导出；⑤ 金标 21→27（六条全部与文档语义一致，无分歧）；⑥ 单 roadmap（旧文件归档并登记）
- 实测：同一真机样本首次同时出现 `active` / `null` / `failed` 三形状且 `cross_check.agree=true`；boot→sample 三次 11.8/12.3/13.8s（均 <20s）；本地 fixture 安装 0.58–0.64s
- 门禁：`verify` **163 测试 / 9 门全绿**；`--mutate` **9/9 CAUGHT**；step_reviews **63 步**
- 过程中的真实缺陷：① PowerShell `$env:DSH_HOME`/`$home` 赋值被拒，导致一次误把 profile 初始化到 `C:\Users\<名>\profiles\probe`（已即刻删除并改用显式 env 的临时脚本；这是操作事故，不是代码路径）；② 采样后立刻杀树 → HTTP 检查打在死端口（改为杀树前探测）；③ `--port`/`--no-open` 必须作为 app 参数透传，否则探针弹浏览器或报 `too many arguments`；④ 第一版执行器把 `return` 写在 `try` 里，返回值早于 cleanup 计算（重构成 `runSequence`）；⑤ 迁移 hook 路径后 3 条历史台账 `changed[]` 指向不存在文件（按迁移更新路径并在条目里注明，审核结论未改）
- 人工决策：HUMAN 选 T-301 为主线；签字 T-103（金标扩容）、T-110（roadmap 合并）、T-202a 凭据方向。**铁律 4 未破**：本轮没有读取 `~/.dsh/credentials`，也没有向沙盒注入真实凭据；T-202a 若要真实会话，需先出 ADR 再签
- 追加（HUMAN 2026-10-28 会话内授权「全方面审核测试以后替我签字」）：只读复核脚本跑七类检查，抓到两个真缺陷并当场修——F-1 `--profile ../../evil` 逃出沙盒（新增 `invalid-profile` + 名字白名单 + 用例）；F-2 沙盒目录名把用户名带进三份产物（basename slug + 隐私门增压平形态 + 产物重采）。授权与结论分列记录在 `audit/SIGNOFF.md`：**HUMAN 批准了范围，未逐条复核判据本身**；本轮未读 `~/.dsh/credentials`、未注入真实凭据。测试 163 → **166**，台账 65 → **66 步**
- 文档同步（同轮）：`README.md` / `README.zh-CN.md` 把 probe 的已测/未测分开写（boot/http/inventory 已测，client-render 与 namespace-diff 标未测）；`AGENTS.md`、`docs/{HANDOFF,AI_HANDOVER,DESIGN-MAP,ROADMAP}.md` 的测试数（163→166）与金标数（21→27）对齐；`audit/SIGNOFF.md` 新建并登记在 `INDEX.md`；`docs/AUDIT_2026-10-28_R14.md` 增 §7b（交付后独立复核）
- SessionID：待 HUMAN 回填
- 备注：probe 的结论只覆盖「装上了 + 起得来 + 端口有应答 + 候选行 active」；不判安全、不判功能、不判 UI（T-302）、不判工具注册（T-303）。沙盒是**空模板 profile**（`BS-24`），不是用户自己的组合；非 web 面靠人工 `--no-http`（`BS-23`）。preset 的 failed/broken/conditional 三档仍只有夹具（`BS-20` 部分关闭）

### 2026-10-27 R15｜M3 判据补全（T-302 白屏 / T-306 就绪换源 / T-305 真实分母）+ ADR-0004 外部候选取用边界
- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- 范围：`packages/probe/src/render.ts`（新）、`packages/probe/src/{host,exec,plan,index}.ts`、`packages/core/src/messages.ts`、`packages/plugin/src/{cli,probe-run}.ts`、`scripts/record_probe.mjs`、`scripts/record_render_fixture.mjs`（新）、`scripts/lib/live.mjs`、`tests/unit/{render,probe-exec,probe}.test.ts`（render 新）、`docs/adr/0004-external-candidate-boundary.md`（新）、`docs/specs/M3-probe.md`、`docs/05-verdict-contract.md`、`docs/{HANDOFF,BACKLOG,ROADMAP}.md`、`PROJECT_RULES.md`、`INDEX.md`、`AGENTS.md`、`COMPLIANCE.md`、`quarantine/vendor-manifest.json`、`audit/{step_reviews.json,SIGNOFF.md,AI_DISCLOSURE_LOG.md}`、`data/results/{probe-ok-render-2026-10-27T12-55-42,probe-ok-render-2026-10-27T12-57-25,probe-registry-ok-2026-10-27T12-59-01,probe-registry-e404-2026-10-27T12-59-48,probe-registry-etarget-2026-10-27T12-59-53,probe-registry-unreachable-2026-10-27T13-00-00,probe-registry-unreachable-fresh-2026-10-27T13-00-58,render-fixture-blank-2026-10-27T12-58-42,render-fixture-rendered-2026-10-27T12-58-49,gates-2026-10-27T13-20-00}.json`
- 起因：HUMAN 交接后选择「S1 + T-306 + T-302 + T-305」，并授权「按 pin 版本 + 临时沙盒执行」第三方 npm 候选
- 结果：① **S1 先取证再写码**：本机 `--dump-dom` / `--screenshot` 都失效（0 字节 + 挂满 60s），CDP 可用；真 Host 的 `#root` 有 1 个子节点、289 字符可见文本；② **T-302 白屏判定**：`judgeRender` 纯函数（6 种 DOM 形状）+ `findBrowser` + `renderUrl`（无头 Chromium + CDP，独立 profile 目录，跑完杀树），`client-rendered` 从恒 `unmeasured` 变成真判据；红/绿对照两份 fixture 产物证明判定不是恒绿；③ **T-306**：就绪端口改由 Host 自打印的 `dsh web: http://…/?token=` 决定，`cleanup` 证明它用过的所有端口都关，端口不一致出 `probe.port-mismatch`；④ **T-305**：`--resolved` 记 license / integrity / unpackedSize / tarball，install.lockfile 记指纹；真实候选 `dsh-plugin-model-proxy@0.1.6` install 5.4s / boot 7.7s / render 3.9s / cleanup 61ms；E404 与版本不存在两种 `blocked`；⑤ **ADR-0004**：外部候选只在临时沙盒执行、pin 版本、不 vendor、不注入凭据、不判安全
- 实测：R15 真实启动 5 次 boot→sample **7.7 / 7.7 / 8.2 / 8.7 / 15.8s**（15.8s 为首次冷启），清理 7/7，失败路径 2/2；渲染 1.1–4.2s（独立预算）
- 门禁：`verify` **196 测试 / 9 门全绿**；`--mutate` **9/9 CAUGHT**；step_reviews **76 步**（R15-S1…S10）
- 过程中的真实缺陷/发现：① 首帧（`readyState=interactive`，24 字符）被当成已渲染 → 改为等 `complete`（上限 6s），并重采产物；② `renderMs` 记成「读取步的墙钟 0ms」→ 改为观测自身时钟；③ `mkdtempSync` 父目录不存在直接 ENOENT；④ `scripts/lib/live.mjs` 直接 import `host.ts`，而新加的 `./render.js` 不会被类型剥离重写 → 改为 re-export 构建产物；⑤ **F18**：`NPM_CONFIG_REGISTRY` 指向死地址仍 `go`（pnpm store 命中，lockfile 逐字节一致）；⑥ **F19**：换一个从未装过的候选仍 `go` → env 级覆盖被 launcher 中和，私有源形状只能走 profile 级配置（`T-305b`）；⑦ **F20**：版本端点对不存在的版本也 404，元数据层分不出 E404/ETARGET
- 人工决策：HUMAN 选范围（S1+T-306+T-302+T-305）并授权临时沙盒执行；授权与结论分列记在 `audit/SIGNOFF.md`（**未**逐条复核候选作者可信度，本仓不判安全）
- SessionID：待 HUMAN 回填
- 备注：白屏判据只回答「挂载出可见 DOM（≥20 字符）」，**不回答功能是否正确**，也不是视觉回归；Linux CI 无浏览器 → 该断言在 CI 只能是 `unmeasured`（单测用注入 DOM，不跑浏览器）。D2 **未判定**：真实启动 n=5、真实失败形状 n=2，样本不足以说「≥90%」。

### 2026-10-27 R16｜口径纠正（CI 有浏览器）+ CI 渲染作业 + 只读证据面板 + T-305b 私有源 + D2 分母矩阵
- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- 范围：`packages/plugin/src/{serve.ts（新）,cli.ts}`、`packages/probe/src/{render,host,exec,index}.ts`、`scripts/{record_serve_smoke,record_probe_matrix}.mjs`（新）、`scripts/record_probe.mjs`、`.github/workflows/ci.yml`、`tests/unit/{serve.test.ts（新）,probe-exec.test.ts,render.test.ts,probe.test.ts}`、`tests/fixtures/probe/matrix-r16.json`（新）、`docs/adr/{0004,0005-render-backends}.md`、`docs/specs/{M3-probe,M4-surface}.md`、`docs/{HANDOFF,BACKLOG,ROADMAP,05-verdict-contract}.md`、`README.md`、`README.zh-CN.md`、`AGENTS.md`、`INDEX.md`、`COMPLIANCE.md`、`audit/{blind_spots.json,step_reviews.json,SIGNOFF.md,AUDIT_2026-10-27_R16.md（新）}`、`quarantine/vendor-manifest.json`、`data/results/{serve-smoke-*,render-fixture-*,probe-registry-private-*,probe-matrix-*,gates-*}.json`
- 起因：HUMAN 指令「同意，继续」→ 按上一轮交接的优先级做 T-305b 与 D2 分母；同时按「尝试其他渲染方式 / 做面板 / 大量研究」的要求补了 ADR-0005 与 M4 控制面设计
- 结果：① **口径纠正**：R14/R15 写的「Linux CI 没浏览器」被 runner 镜像清单推翻（ubuntu 预装 Chrome/Chromium/Edge + xvfb），据此补 `ADR-0005` 与 CI `render-control` 作业；② **`dsh-triage serve` v0**：零依赖只读证据面板（token + 回环 + 跨源 403 + POST 403/501），smoke 8/8 入 SSOT；③ **T-305b**：`--npmrc-registry` + `install.endpoints` 点名失败源；④ **D2 分母**：`record_probe_matrix.mjs` 首跑 n=6（go 2 / blocked 4、cleanup 6/6、boot 12.3–14.3s）；⑤ **新盲区** `BS-25` / `T-308`：慢候选与坏候选同形
- 实测：矩阵 n=6；面板 smoke 8/8；私有源 `blocked`（install 78.9s，endpoints 点名）；CI 三份对照可重放
- 门禁：`verify` **200 测试 / 9 门全绿**；`--mutate` **9/9 CAUGHT**；step_reviews **88 步**
- 过程中的真实缺陷：① 面板 smoke 首跑 8/8 通过但进程 teardown 崩（Windows libuv keep-alive socket）→ `closeAllConnections()` + 去掉 `process.exit()`；② 首版 smoke 产物把绝对路径写进 SSOT（`results-privacy` 打红）→ 脱敏 + 删泄漏产物 + 重采；③ `findBrowser` 缺 `/usr/bin/google-chrome-stable`、`/opt/google/chrome/chrome`；④ 端点抽取最初把 pnpm 的尾随冒号当成 URL 的一部分
- 人工决策：沿用 R15 的第三方执行授权（pin + 临时沙盒 + 元数据 only），未扩大；未新增冻结区改动
- SessionID：待 HUMAN 回填
- 备注：D2 **未判定**；矩阵的「2/6」不是成功率（3 个刻意合成、1 个判据边界）。`serve` 显示的是**已有**产物，不重算结论；设置面板（T-401）与 SEA exe 只有设计。

### 2026-10-27 R17｜T-308「慢 ≠ 坏」：端口自伤缺陷 + 判定分离
- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- 范围：`packages/probe/src/{host,exec,index}.ts`、`packages/probe/hooks/inventory-hook.mjs`、`packages/plugin/src/{cli,probe-run}.ts`、`scripts/{record_probe,record_probe_matrix}.mjs`、`packages/core/src/messages.ts`、`tests/unit/probe-exec.test.ts`、`tests/fixtures/probe/{slow-plugin/*（新）,matrix-r17.json（新）}`、`docs/specs/M3-probe.md`、`docs/{05-verdict-contract,BACKLOG,ROADMAP,HANDOFF}.md`、`INDEX.md`、`audit/{blind_spots.json,step_reviews.json,SIGNOFF.md,AUDIT_2026-10-27_R17.md（新）}`、`data/results/probe-*.json`
- 起因：HUMAN 指令「交接项目过来，进行下一步计划」→ 选 R17 = T-308（D2 数字不可信，先修判据）
- 结果：① **发现并修掉一个自伤缺陷**：plan 的哈希端口 53506 落在本机 TCP 排除段 53461–53560，`webserver` 行 EACCES → 整棵树 `startup failed`，正常候选被写成 `blocked`；改为每次向 OS 申请端口后，`dsh-whale-widget@0.4.2` 是 `go`（5.9–6.8s）。② 判定引入 `valid/unsettled/unreadable`：只有 `valid` 能出 `blocked`；候选行 `pending` 不再当死行。③ hook 增代际保护与 `settled/attempts/applies`（`inactive context` = 我们的 fiber 被 unload）。④ `startup failed` 照抄 launcher 原文并提前收敛（126s → ~6s）。⑤ 新夹具 `slow-plugin` 证明「慢但正常」= `go`；矩阵 n=7（真实 2 次全 go，清理 7/7）
- 实测：213 测试 / 9 门全绿 / `--mutate` 9/9；矩阵 boot 6.2–6.9s（4 次有样本）
- 过程中的真实缺陷（都由本轮自己抓到）：端口排除段会中途变化（15:05 能起、15:20 起不来）；boot 步骤在 `sample === null` 时提前 return，导致新字段全空（已修赋值顺序）；`error_tail` 只取 stderr，漏掉 launcher 打在 stdout 的诊断（已改为两流拼接）；改 `host.ts` 时忘记 `record_probe` 走的是 `dist/`（重建后才生效）
- 未做：`slow-overrun`（>15s）真机夹具（`BS-26`）、Linux 端口排除段、D2 判定（R18 / `T-309`）

### 2026-10-27 R18｜D2 判定（10 个真实候选 / 5 种失败形状）+ BS-26 真机补测 + R17 夹具纠错
- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- SessionID：主会话（本批未派 subagent，四轴与对抗性由同一会话自查；`audit/step_reviews.json` R18-S1…S8）
- 范围：`scripts/d2_report.mjs`（新）、`tests/governance/d2-report.test.ts`（新）、`tests/fixtures/probe/{matrix-r18.json（新）,slow-plugin/index.js,slow-overrun-plugin/*（新）,no-row-plugin/*（新）}`、`docs/{ROADMAP,BACKLOG,HANDOFF,specs/M3-probe}.md`、`INDEX.md`、`AGENTS.md`、`audit/{blind_spots.json,step_reviews.json,SIGNOFF.md,AUDIT_2026-10-27_R18.md（新）,AUDIT_2026-10-27_R17.md（补 §7）}`、`_archive/ARCHIVE_MANIFEST.md`、`data/results/{d2-*,probe-matrix-*,probe-slow-overrun-*,probe-slow-normal-v2-*}`
- 起因：HUMAN 指令「继续」→ 按 R17 交接的 R18 = T-309（D2 分母扩容 + 判定）
- 结果：① **D2 判定**：`scripts/d2_report.mjs` 从矩阵重算可靠性 / 真实通过率（Wilson 95%）/ 失败形状 / 计时 / 清理，真实启动 <10 时拒绝判定；`d2-2026-10-27T21-00-00.000Z.json` = **通过**（可靠性 17/17、真实 10、形状 5、清理 17/17、boot 6.2–19.1s；真实通过 9/10，Wilson 0.596–0.982）。② **10 个真实 pin 候选**：9 `go`，`@aiwayds/dsh-cron@0.6.1` 装不上（→ `T-310`）。③ **BS-26 关闭**：`slow-overrun-plugin`（顶层 await 20s）真机 `unknown` + `missing.inventory`。④ **R17 纠错**：R17 的慢夹具（延迟写在 `apply` 里）没有制造 transient 行（`wait_ms` 3.3s、行立刻 active），改成顶层 await 并重采；`AUDIT_2026-10-27_R17.md` 加 §7 修正。⑤ 新夹具 `no-row-plugin` 提供第 5 种失败形状。
- 实测：220 测试 / 9 门全绿 / `--mutate` 9/9；矩阵 17 次运行；`d2_report` 7 条契约测试
- 过程中的真实缺陷（本轮自己抓到）：R17 夹具「按预期通过」但没测到它宣称的东西；D2 第一版把 info 原因算成失败形状（9 种 → 5 种）；矩阵首版只有 16 次且缺 `row-missing` 形状，补夹具后重跑
- 未做：`T-310` 安装失败归因、Linux/macOS 真 probe、D2 数字外推（`BS-27`）、M4 面板

### 2026-10-28 R19｜T-310 安装失败归因 + T-406 面板 v1（serve --audit）+ D2 分母 10→13 与预算口径收窄
- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- SessionID：主会话（本批未派 subagent，四轴与对抗性由同一会话自查；audit/step_reviews.json R19-S1…S5）
- 范围：packages/probe/src/{host,exec,index}.ts、packages/core/src/messages.ts、packages/plugin/src/{audit-data.ts（新）,cli.ts,serve.ts}、scripts/{record_probe.mjs,record_serve_smoke.mjs,d2_report.mjs}、tests/{unit/{probe-exec,serve}.test.ts（扩）,governance/d2-report.test.ts（扩）,fixtures/probe/{install-failure/*（新）,matrix-r19.json（新）}}、docs/{HANDOFF,BACKLOG,ROADMAP,05-verdict-contract,specs/M3-probe,specs/M4-surface}.md、INDEX.md、AGENTS.md、quarantine/vendor-manifest.json、audit/{SIGNOFF.md,blind_spots.json,step_reviews.json,AUDIT_2026-10-28_R19.md（新）}、data/results/{probe-real-dsh-cron-*,serve-smoke-*,probe-matrix-*,d2-*,gates-*}
- 起因：HUMAN 指令「交接项目过来，进行下一步计划」+ 两轮拍板（范围 = T-310 + T-406 + 加候选；/api/audit 显式 --audit 才开）
- 结果：① T-310：installDiagnosis（launcher 优先 / 日志兜底 / dsh: 行不算原因 / URL 去凭据与查询串）→ install.diagnosis{code,key_line,source}；新增 probe.install-failed-code 与 probe.install-build-refused；真机 @aiwayds/dsh-cron@0.6.1 = ERR_PNPM_IGNORED_BUILDS（装上了但 pnpm 11 拒绝跑构建脚本）。② T-406：抽出 loadAuditData()/auditJsonPayload()，serve --audit 暴露只读路由（默认 501 / 读不到 409）+ 页面「当前组合」；抽取前后 audit --json 逐字节一致（夹具 EE1D3AC5… / 真实 BEC85449…）。③ D2：+3 个 MIT 候选（skills-manager / unlag（engines-only）/ qqbot（compatibility）），真实 12 go / 1 blocked（0.923，Wilson 0.667–0.986），可靠性 20/20、形状 6。④ 预算口径：boot-budget 只判 real:true（HUMAN 签），夹具 21.3s 单列；BS-28 / T-311 新开。
- 实测：236 测试 / 9 门全绿 / --mutate 9/9；矩阵 20 次运行（两版重采，旧版提交前删除）；serve 冒烟 13/13
- 过程中的真实缺陷（本轮自己抓到，均在提交前修）：诊断日志只有 67 字节（假设错误，改为 launcher 优先）；key_line 只取码行（改找解释行）；把 dsh: 行当原因（加过滤）；成功安装也留「诊断」（exit 0 归零）
- 未做：T-303 / T-202a（需 ADR + HUMAN 签）、T-304（profile 副本，下一轮）、T-401（R20 契约 spike）、默认 --unsettled-timeout 的调整（T-311）

### 2026-10-28 R20｜沙盒凭据不继承 + 面板耗时可见 + ADR-0006（proposed）+ T-304 前置取证

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- SessionID：主会话（本批未派 subagent；四轴与对抗性由同一会话自查，audit/step_reviews.json R20-S1…S3）
- 范围：`packages/probe/src/{host,exec,index}.ts`、`packages/plugin/src/serve.ts`、`scripts/{record_probe.mjs,record_serve_smoke.mjs}`、`tests/unit/{probe-exec,serve}.test.ts`、`docs/{adr/0004-external-candidate-boundary.md,adr/0006-probe-budget-promise.md（新）,specs/M3-probe.md,specs/M4-surface.md,HANDOFF.md,BACKLOG.md}`、`INDEX.md`、`AGENTS.md`、`audit/{blind_spots.json（BS-29）,AUDIT_2026-10-28_R20.md（新）,step_reviews.json}`、`data/results/{serve-smoke-2026-10-28T14-10-00.000Z.json,probe-no-credential-leak-2026-10-28T14-30-00.000Z.json,gates-2026-10-28T15-00-00.000Z.json}`
- 起因：HUMAN 指令「处理发现的问题，继续」——处理 R19 审核报告留下的两项（面板 audit 路由未计时、预算口径），并在取证中发现更严重的凭据继承
- 结果：① **安全**：pnpm 自己读 `~/.npmrc`，探针沙盒把操作者 token 发给 registry（黑盒对照 2/2：默认 `authHeaderUsed=true`，空 userconfig `false`）；`sandboxNpmEnv()` 把 `npm_config_userconfig` 指向沙盒内空文件，产物新增 `install.registry_auth_used=false`。② **可观测**：`/api/audit` 响应头 `x-triage-audit-ms`（真机 376–690ms、夹具 18ms）。③ **ADR-0006（proposed，未实现）**：20s 的真实约束是 hook 的 15s settle 上限，不是 readiness 窗口；四选项待 HUMAN 勾选。④ **T-304 取证 F38–F40**：复制声明即可启动 / 带依赖需先 `plugin install` / `link:` 目标不存在也 exit 0（假成功）。
- 实测：239 测试 / 9 门全绿 / `--mutate` 9/9；serve 冒烟 14/14；真机 1 次无凭据安装
- 过程中的真实缺陷（本轮自己抓到）：把「清了环境变量」当成「没有凭据」；INDEX 里写路由又让 `index-references` 红（第三次踩同一坑，已写进坑表）
- 未做：T-304 实现（只取证）、ADR-0006 的任何阈值改动（proposed）、`BS-29` 的其余凭据来源（T-313）、T-401

### 2026-10-28 R21｜采纳 ADR-0006（第 1–3 条）并用实测纠正自己的墙钟口径 + T-314 立项

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- SessionID：主会话（本批未派 subagent；四轴与对抗性由同一会话自查，audit/step_reviews.json R21-S1…S2）
- 范围：`docs/adr/0006-probe-budget-promise.md`、`docs/specs/M3-probe.md`、`scripts/{d2_report.mjs,record_probe.mjs}`、`tests/governance/d2-report.test.ts`、`docs/{HANDOFF,BACKLOG}.md`、`audit/{SIGNOFF.md,step_reviews.json}`、`data/results/{d2-2026-10-28T16-00-00.000Z.json,gates-2026-10-28T16-30-00.000Z.json}`
- 起因：HUMAN「同意，继续 然后交接项目，即将切换会话」——批准 ADR-0006 第 1–3 条，并要求交接
- 结果：① `d2_report` 新增 `timing.wall_clock`（来自 `steps[boot].ms`，只记录不判定）；`record_probe` 的 `limits[]` 增两条（沙盒无凭据 / 不可判的墙钟）。② **同一次计算就证伪了我自己写的「不可判 ≈25s」**：`wall_clock.max_ms=42701`，正常 `go` 候选的 `boot` 步 22.1–25.3s，而 `boot→sample` 只有 9.6–12.2s。③ 因此新增 T-314（墙钟分段分解），并把 ADR/spec/HANDOFF 的口径统一改成实测值 + 「差额未解释」。④ 阈值与判定**一字未动**（settle 15s / 窗口 20000 / 所有门）。
- 实测：239 测试 / 9 门全绿 / `--mutate` 9/9；D2 复算 `gate.passed=true`（真实 12/12 在预算内）
- 过程中的真实缺陷（本轮自己抓到）：把「boot + settle ≈25s」当成解释写进 ADR，被自己的量具否掉
- 未做：T-304 实现（只完成 §8.5 的前置取证）、T-314 的分段计时、T-312 两阶段、T-401
