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

### 2026-10-28 R22｜T-304 真实组合复制（`--copy-profile`）：三形状真机产物 + 组合侧归因（构建审批 / 悬空链接 / 未注册）

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- SessionID：主会话（本批未起 subagent；四轴与对抗性由同一会话自查，audit/step_reviews.json R22-S1…S5）
- 范围：`packages/probe/src/{plan,profile-copy（新）,exec,host,index}.ts`、`packages/plugin/src/{cli,probe-run}.ts`、`packages/core/src/messages.ts`、`scripts/record_probe.mjs`、`tests/unit/{probe,probe-profile（新）,probe-exec}.test.ts`、`tests/fixtures/probe/profile-copy/*（新）`、`docs/{specs/M3-probe.md,05-verdict-contract.md,HANDOFF.md,BACKLOG.md}`、`INDEX.md`、`audit/{blind_spots.json（BS-30/BS-31）,step_reviews.json,AUDIT_2026-10-28_R22.md（新）}`、`data/results/{probe-copy-profile-ok-*,probe-copy-profile-unusable-*,probe-copy-profile-dangling-*,gates-*}`
- 起因：HUMAN「同意，继续」→ 按 R21 交接的优先级做 T-304（probe 现在只能回答「加到模板 profile 会不会挂」）
- 结果：① **`--copy-profile <name>`**：只复制四个声明文件（package.json / cordis.yml / cordis.patch.yml / pnpm-workspace.yaml），不搬 node_modules / .plugin-manager / .npmrc；新增 `profile` 步（仅该模式出现），产物记 `sandbox.profile_origin` / `profile_source` / `profile_copy{files,missing,install,pnpm_policy,dangling_links}`。② **两种「副本不可用」只能是 `unknown`**：装不上（`probe.profile-copy-unusable`）、悬空 `link:`（`probe.profile-link-dangling`，install **exit 0** 也抓）——都不跑 `install`/`boot`，断言全 `unmeasured`。③ **两个真归因**：复制真实组合时 pnpm 因**构建审批**退出 1（被拒的是组合自己的 5 个原生包，不是候选）；`plugin add` 在 pnpm 非 0 退出时**只写 dependencies、不写 `dsh.profile.bundles`**（实测），所以「继续 boot」会得到 `row-missing`。④ **解法且不越权**：沙盒 `pnpm-workspace.yaml` 写 `strictDepBuilds: false`（exit 0 且注册 bundle，但**不批准任何构建**，`onlyBuiltDependencies` 仍为空），并读回组合确认 `candidate_registered=true`。⑤ 新盲区 `BS-30`（沙盒不构建原生模块）/ `BS-31`（只搬声明：链接与私有源只能 unknown），新任务 `T-315`（该口径要 ADR）。
- 实测：**263 测试 / 9 门全绿 / `--mutate` 9/9**；三形状真机产物（go / unknown×2）；`registry_auth_used=false`；`profile` 步 18.5–19.7s（首次 138s 是构建审批失败后的重复解析）
- 过程中的真实缺陷（本轮自己抓到，均在提交前修）：把「副本装不上」直接当 `blocked`（会让私有源组合变成「插件坏」）；把 `ERR_PNPM_IGNORED_BUILDS` 一律按 R19 归到候选（复制模式下被拒的是组合）；以为被拒名单能从 `key_line` 读（截断丢名字，改整段解析）；`--profile` 默认值 `web` 会覆盖复制源名（已加 `profileExplicit`）
- 未做：T-314（`boot` 分段计时，仍是首选纯测量项）、T-315 ADR、T-313（其余凭据来源）、T-401 面板契约 spike；阈值（settle 15s / 窗口 20000 / `boot→sample ≤20s`）**一字未动**
### 2026-10-28 R23｜T-314 墙钟分解（差额已解释、口径改正）+ T-315 ADR-0007 + T-313 凭据来源审计（BS-29 收窄）

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- SessionID：主会话（本批未起 subagent；四轴与对抗性由同一会话自查，`audit/step_reviews.json` R23-S1…S6）
- 范围：`packages/probe/src/{host,exec,index}.ts`、`packages/plugin/src/probe-run.ts`、`scripts/{d2_report.mjs,record_probe.mjs,audit_credential_sources.mjs（新）}`、`tests/unit/probe-exec.test.ts`、`docs/{specs/M3-probe.md,adr/0006-probe-budget-promise.md,adr/0004-external-candidate-boundary.md,adr/0007-sandbox-build-policy.md（新）,BACKLOG.md,HANDOFF.md}`、`INDEX.md`、`audit/{blind_spots.json,step_reviews.json,SIGNOFF.md,AUDIT_2026-10-28_R23.md（新）}`、`data/results/{probe-boot-segments-*（3 份）,credential-sources-*,gates-*}`
- 起因：HUMAN「同意，继续，处理所有问题」——处理 R22 交接留下的三项（T-314 / T-315 / T-313）
- 结果：① **T-314**：`boot` 步 10 段计时，**推翻了 R21 自己写的两个数字**——正常候选 15.7–16.2s（render 4.7 + 杀树 2.2–2.7 + 杀后 1.2 主导），不可判 **48.4s**（**替换等待 20.3s** 主导，不是 settle；`wait_ms 16.1s` 已含在 sample 里）。ADR-0006 与 spec §4 改为「可判 ≈16s / 不可判 ≈48s」。② **T-315**：`ADR-0007` 固化沙盒构建审批口径（不批准任何构建、只降错误；源 workspace 不覆盖；必须读回 `dsh.profile.bundles`）。③ **T-313**：探测器从「pnpm 日志」换成「本地假 registry 记 `authorization` 头」，六类来源 × `404`/`401` = 10 组 + 对照组 + 30 次运行全部失败；结论：**只有 user config 会被读**，且两种应答下都不再上网；其余四个旋钮在 launcher 路径下未被读；`BS-29` 由 open 改为 **narrowed**。
- 实测：**265 测试 / 9 门全绿 / `--mutate` 9/9**；三份分段产物 + 一份 10 组凭据审计产物；111 份 SSOT 产物 / 126 步台账
- 过程中的真实缺陷（本轮自己抓到，均在提交前修）：用 pnpm 日志当凭据探测器（实测合成 token 不打印那行 → 假阴性）；`spawnSync` 起同进程假 registry（阻塞事件循环，挂死三次 90s）；被 kill 的 `pnpm add` 残留占着 store 锁（清进程才恢复）；把「旋钮未被读」当成「我们挡住了」（已分 `knob_honored` / `leaks_today` 两列）；审计产物带 home 路径（`results-privacy` 打红，已加脱敏）
- 未做：T-311/T-312（压替换窗口需 ADR + HUMAN 签，阈值一字未动）、`BS-29` 剩余面（硬编码路径/非 Windows/其它版本）、T-315 的 `nodeLinker` / `strictPeerDependencies`、T-401
### 2026-10-28 R24｜ADR-0008：不可判的树要等多久（替换窗口成本量化，默认值未动）

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- SessionID：主会话（本批未起 subagent；四轴与对抗性由同一会话自查，`audit/step_reviews.json` R24-S1…S3）
- 范围：`scripts/report_replacement_window.mjs`（新）、`docs/adr/0008-unsettled-wait.md`（新）、`docs/specs/M3-probe.md` §4、`docs/BACKLOG.md`（T-311/T-312）、`docs/HANDOFF.md`、`INDEX.md`、`audit/{step_reviews.json,AUDIT_2026-10-28_R24.md（新）}`、`data/results/{probe-settle-window-{1s,5s},replacement-window}-*.json`
- 起因：HUMAN「继续」——R23 已把「不可判 ≈48s」归因到替换等待，本轮把「要不要改」变成可签字的题
- 结果：① 同一永不 settle 夹具在 `--unsettled-timeout` 20000/5000/1000 三组真跑，**结论全部 `unknown`**，`boot` 步 48.4/33.9/26.2s，替换等待 20.3/5.3/1.2s；② `scripts/report_replacement_window.mjs` 扫 29 份有相位块的产物：4 次不可判样本的 `attempts`/`applies` **全为 1**（`{error}` 0 次），`measured_saving_ms = 19092`；③ `ADR-0008`（proposed）给出 A/B/C/E 四案与签字区，**推荐 E**（只对 `{error}` 保留等待）；spec §4 与 BACKLOG 同步。**默认值与判据一行未改**
- 实测：265 测试 / 9 门全绿 / `--mutate` 9/9；114 份 SSOT 产物 / 129 步台账
- 过程中的真实缺陷（本轮自己抓到）：第一版临时统计把旧产物的 `undefined` 当成「不可判」，报出 13 次（真实是 4 次）——正式脚本归一为 `null` 并把旧产物单列；1s 那一轮 `url_seen=false` 导致 render 被跳过，若不注明就会把 22s 全算成窗口收益
- 未做：ADR-0008 的签字（HUMAN）、T-312 两阶段、T-315 的 `nodeLinker`/`strictPeerDependencies`、T-401
### 2026-10-28 R25（交接）｜记录 ADR-0008 方案 E 的授权（未实施），代码零变更

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary）
- SessionID：主会话（本次为交接轮，未起 subagent；`audit/step_reviews.json` R25-S1）
- 范围：`docs/HANDOFF.md`、`docs/BACKLOG.md`（T-311）、`docs/adr/0008-unsettled-wait.md`、`audit/{SIGNOFF.md,AUDIT_2026-10-28_R24.md,step_reviews.json}`、`INDEX.md`、`data/results/gates-*`
- 起因：HUMAN「同意。先进行项目交接，即将切换会话」——在切换前授权 `ADR-0008` 方案 E，并要求先交接
- 结果：① 授权记入 `SIGNOFF.md`（原话照录）；② `ADR-0008` 状态改为**已授权、未实施**，新增 `实施清单`（改哪里 / 不要改什么 / 三条缺一即回滚的回归 / 先造 `{error}` 夹具）；③ `HANDOFF` §2/§3/§4、`BACKLOG` T-311、`INDEX`、审核报告 §8 同步。**`packages/` 与 `tests/` 零 diff**，`--unsettled-timeout 20000` / `settle 15s` / readiness 5s 原样
- 实测：265 测试 / 9 门全绿 / `--mutate` 9/9；114 份 SSOT 产物 / 130 步台账
- 过程中的真实缺陷：无（本轮无实现）；交接时特意在四处写明「授权≠已实施」，避免下一位把签字读成「等待已经变短」
- 未做：方案 E 的实现本身、`{error}` 夹具、`nodeLinker` 设置审计、T-401

### 2026-10-28 R26｜实施 `ADR-0008` 方案 E：`settled:false` 不再等替换窗口（判据与阈值一字未动）

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary；未起 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R26-S1…S5）
- 范围：`packages/probe/src/{host,exec,index}.ts`、`packages/plugin/src/probe-run.ts`、`tests/unit/probe-host-sample.test.ts`（新）、`scripts/{record_probe,d2_report,report_replacement_window}.mjs`、`docs/{adr/0008,adr/0006,specs/M3-probe,05-verdict-contract,HANDOFF,BACKLOG,ROADMAP}.md`、`audit/{SIGNOFF.md,blind_spots.json,AUDIT_2026-10-28_R26.md,step_reviews.json}`、`INDEX.md`
- 起因：HUMAN 2026-10-28「同意，继续，处理所有问题」——执行上一轮已授权的 `ADR-0008` 方案 E
- 结果：① 样本循环改为 `readable → timeout → replacedEnough → startupFailed`，`replacedEnough` 只在样本**不可读**（`{error}`）时成立；新增 `isReadableSample()`（`isUsableSample()` 零 diff）；② 产物新增 `inventory.replacement_waited/_waited_ms/_observed/_samples/_policy/_stopped_by`，`probe.tree-not-settled` 的 detail 写明「没有再等替换样本（ADR-0008 E）」；③ 三条回归全过：`slow-overrun` 仍 `unknown` + `missing.inventory`（`boot` 步 48.4s → 28.6s）、`slow-plugin` 仍 `go`、`{error}` 仍等满窗口并能采用替换样本（4 条单测，假 launcher 驱动真实循环）；④ 真实候选 `dsh-status-rotator@0.38.0` 仍 `go`；⑤ `d2_report` 用既有矩阵复算 `gate.passed=true`
- 实测：269 测试 / 9 门全绿 / `--mutate` 9/9；119 份 SSOT 产物 / 135 步台账；墙钟 21.7–28.6s（区间，`BS-32`）
- 过程中的真实缺陷：① 初版把「≈32s」写进 `limits[]` 与文档，而同一夹具第二次真跑是 28.6s —— 已把产物文案改成不含秒数的结构描述，文档统一给区间；② `gate.mjs --record` 第一次在台账补登前跑，录下一份「step-review FAIL」的门禁产物，已删除并用补齐台账后的第二次 `--record` 重录（全绿）
- 未做：真 hook 的 `{error}` 夹具（`T-316`，本轮只有假 launcher 单测）、post-E 矩阵重测（`T-309` 后续）、`--unsettled-timeout` 默认值（仍 20000，改它需新签）

### 2026-10-29 R27｜真 hook 的 `{error}`（T-316）+ `nodeLinker` 补测（T-315）+ post-E 矩阵让 D2 第一次判红

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary；未起 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R27-S1…S7）
- 范围：`packages/probe/src/host.ts`、`packages/plugin/src/probe-run.ts`、`scripts/record_probe.mjs`、`tests/unit/probe-hook-error.test.ts`（新）、`tests/fixtures/probe/profile-copy/node-linker/**`（新）、`docs/{adr/0008,adr/0009,adr/0007,specs/M3-probe,specs/M4-surface,ROADMAP,HANDOFF,BACKLOG}.md`、`audit/{SIGNOFF.md,blind_spots.json,AUDIT_2026-10-29_R27.md,step_reviews.json}`、`INDEX.md`
- 起因：HUMAN 2026-10-29「进行这些问题处理」（T-316 / T-309 / T-311 剩余 / T-401 / T-303）
- 结果：① **T-316 真机完成** —— 诊断开关 `--hook-config`；真实 hook 写出 `{error}/projection-missing`，执行器 `replacement_waited=true`、`waited_ms=5204`（窗口 5000），与 `settled:false` 的 0ms 形成正反对照；另加跑真实 hook 文件的单测。② **T-315 补测** `nodeLinker: hoisted` 复制源 → `go`、行 `active`、`candidate_registered=true`（不打断识别；产物不记布局）。③ **T-309 post-E 矩阵**：n=20 / 真实 13（12 go / 1 blocked）/ 清理 20-20 / 形状 6 / `expectation_misses=0`。④ **D2 首次判红**：`boot-budget` 11/12，`real-mcp-connector` 22.5s；隔离复测 16.0 / 22.5 / 23.8s → 根因是 20s 预算与 `settle ≤15s` 结构重叠，**不是** E。⑤ **T-311 剩余**写成三案并更正自己「A′ 不会误伤」的说法。⑥ **ADR-0009**（proposed）与 **T-401 只读契约 spike**（M4-surface §3.1 C1–C6）。⑦ 新开 `T-317`（`d2_report` 判定失败仍 exit 0）
- 实测：271 测试 / 9 门全绿 / `--mutate` 9/9；142 步 / 127 产物
- 过程中的真实缺陷：① 把「A′ 不会误伤」写进 ADR 后，同轮实测发现 `dsh-mcp-connector` 的 `wait_ms` 是 16.2/18.0s（不是旧批次的 7.7s）——已按证据改写；② `gate.mjs --record` 又在台账补登前跑了一次，产出的红门禁产物已删除重录
- 未做：D2 的预算决定（要签）、`dsh-mcp-connector` 的抖动没有收敛、`T-317` / `T-401` / `T-315` 剩余

### 2026-10-29 R28（交接）｜T-312 两阶段取样（预算改判第一份样本）+ ADR-0009 结论 A

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary；未起 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R28-S1…S5）
- 范围：`packages/probe/hooks/inventory-hook.mjs`、`packages/probe/src/{host,exec,index}.ts`、`packages/plugin/src/probe-run.ts`、`scripts/{record_probe,d2_report}.mjs`、`tests/unit/{probe-host-sample,probe-hook-two-phase}.test.ts`、`docs/{specs/M3-probe,adr/0008,adr/0009,BACKLOG,HANDOFF,ROADMAP}.md`、`audit/{SIGNOFF.md,AUDIT_2026-10-29_R28.md,step_reviews.json}`、`INDEX.md`、`AGENTS.md`
- 起因：HUMAN 2026-10-29「立项 T-312 两阶段」+「ADR-0009：A/B/C。自己分析」
- 结果：① **T-312 已实施** —— hook 先写 `provisional:true`/`settled:false` 再覆盖最终样本；执行器**判第一份**为 20s 预算，最终样本时刻记 `bootToFinalSampleMs`，升级窗口 = 样本自报的 `settle_timeout_ms` + 1s。真机：`slow-plugin` 第一份 **5.4s**（改前 14.7s）/ 最终 10.7s / **仍 `go`**；`slow-overrun` 9.4s（改前 22.7s）/ 24.5s / 仍 `unknown`；真实候选 `dsh-mcp-connector@0.2.83` 10.1s（改前 22.5s）/ 25.2s / `unknown`。② 代价如实记录：不可判墙钟 28.6s → 30.4s。③ **ADR-0009 结论 A**：不为一个补证断言引入读凭据路径 → `T-303`/`T-202a` 收束为「当前不做」，**没有**自签铁律 4 例外
- 实测：274 测试 / 9 门全绿 / `--mutate` 9/9；146 步 / 130 产物
- 过程中的真实缺陷：① 第一版升级窗口用固定 15s，`slow-overrun` 的最终样本 15.25s 才写完 → `upgraded` 误记 `false`；改为从样本自报 `settle_timeout_ms` 推 +1s 后修正；② 改 `exec.ts` 时漏了 `ProbeSampleView.provisional` 的三个返回分支，typecheck 抓到并补全
- 未做：**D2 没有按新口径重跑**（下一位的第一件事）、`T-317`、`T-315` 剩余、`T-401` 的 `client.js`

### 2026-10-28 R29｜D2 按 T-312 新口径重跑两批（`gate.passed=true`）+ `T-317 --strict` + `BS-33` 字段语义修复

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary；未起 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R29-S1…S6）
- 范围：`packages/probe/src/{host,exec}.ts`、`scripts/{d2_report,record_probe}.mjs`、`tests/{unit/probe-host-sample,governance/d2-report}.test.ts`、`docs/{specs/M3-probe,adr/0008,BACKLOG,HANDOFF,ROADMAP}.md`、`audit/{AUDIT_2026-10-28_R29.md,blind_spots.json,step_reviews.json,AI_DISCLOSURE_LOG.md}`、`INDEX.md`
- 起因：HUMAN 会话内「同意，继续，处理所有问题」，范围按 R28 交接单的阶段 0+1+2；两道待签题（`ADR-0008` §剩余项 B、`ADR-0009`）HUMAN 明确**本轮不签**
- 结果：① **D2 按新口径重跑两批**（`matrix-r19.json`，先后于 08:40 与 09:40 UTC）：两批都是 n=20 / 真实 13 / 12 `go` + 1 `blocked` / 清理 20-20 / 形状 6 / `expectation_misses=0`，`boot→sample` 4.6–9.8s 与 4.0–5.5s；`d2_report` 两批 `gate.passed=true`、`boot-budget` **12/12**、可靠性 20/20，产品数字 12/13（Wilson 0.667–0.986）。R27 那条红作为旧口径历史**原样保留**。② **`T-317`**：`d2_report --strict`（产物先落盘再 exit 1），单测 +2。③ **`BS-33`（本轮真发现的缺陷）**：T-312 让 `replacement_waited` 把升级等待记成替换等待（第一批 20/20 都是 `true`，`waited_ms == upgrade_waited_ms`），修法是收窄 `waited` 到不可读样本 + 新增 `replacement_reason` + detail 分开写，**判据与等待一字未动**；修后 20/20 `replacement_waited=false` + `reason=upgrade`，结论逐条相同
- 实测：276 测试 / 9 门全绿 / `--mutate` 9/9；154 步 / 139 产物
- 过程中的真实缺陷：① 我最初相信「`replacement_waited=false` 才是 E 生效」，直到翻开第一批产物的 20 行才发现它在 T-312 之后恒为 `true`——**读产物还是比读自己的文档可靠**；② 新加的 `--strict` 单测第一条把正则写成 `gate {7}PASSED`，实际输出 8 个空格，测试当场红（改成 `\s+`）
- 未做：`T-401` 的 `client.js`（下一位的第一件事）、`T-315` 剩余、`BS-29` 剩余面、`ADR-0008` §剩余项 B 与 `ADR-0009` 的签字（HUMAN 未给）

### 2026-10-28 R30｜代签 `ADR-0008` B / `ADR-0009` A + T-401 浏览器半边 + T-315 布局读数

- 生成者：DeepSeek V4.1 Flash（主会话；代签部分为 HUMAN 明确委托：「进行你自己评估讨论，代我签字，同意」）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R30-S1…S2）
- 范围：`packages/plugin/{client.js,package.json,src/probe-run.ts}`、`packages/probe/src/{host,exec,index}.ts`、`scripts/record_probe.mjs`、`tests/unit/{client-tab,probe-node-layout}.test.ts`、`docs/{specs/M4-surface,BACKLOG,HANDOFF,adr/0008,adr/0009}.md`、`audit/{SIGNOFF.md,AUDIT_2026-10-28_R30.md,step_reviews.json}`、`INDEX.md`
- 起因：HUMAN「必须一起说的诚实边界…进行这些处理，确保稳定…继续 T-401 / T-315…进行你自己评估讨论，代我签字，同意」
- 结果：① **代签两道题都选维持**：`ADR-0008` 勾 B（settle 15s / `--unsettled-timeout 20000` / readiness 5s / `boot→sample ≤20s` 全部不动）、`ADR-0009` 勾 A（`accepted(A)`，不读会话作用域、不读凭据）；两行写进 `SIGNOFF`，含「HUMAN 未逐条复核」与可撤销说明。② **T-401 半交付**：`client.js`（classic script + `__ModuleLoader__.load` + `settings.plugins.tab` + `id=compat-triage`）+ `dsh.client` + 9 条 `node:vm` 契约单测（含「契约不匹配 = 零注册」）；tab **不含任何结论**（只给 CLI 入口 + 宿主行数这一条事实）。**未做**：真机挂载、同源结论。③ **T-315 半交付**：产物新增 `install.node_layout{linker,declared,top_level,pnpm_store}` + 4 条单测；真机模板 run `go`（`boot→sample` 8.1s、`isolated / declared=null / top_level=1`、`replacement_reason=upgrade`）。**仍缺** hoisted 复制 run 与 `strictPeerDependencies`
- 实测：289 测试 / 9 门全绿 / `--mutate` 9/9；156 步 / 141 产物
- 过程中的真实缺陷：① `client-tab` 第一版断言把「apply 的返回值」当成 registration，而 `slots.inject` 是**惰性**的（回调由 Host 在挂载时调用），当场红并改成断言假 ctx 的状态；② 「不 require node 内置模块」的断言第一版用 `source.includes('node:')`，被文件注释里的 `node:vm` 命中——改成只匹配 `require('node:…')`
- 未做：真机挂载 tab、Host 侧只读 Remote、hoisted 复制 run、`strictPeerDependencies`、`BS-29` 剩余面

### 2026-10-28 R31｜稳定性三批分布（T-319）+ T-401 真机注册通过 + T-315 收口（并更正 R30 的读数）

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary；未起 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R31-S1…S8）
- 范围：`scripts/{stability_report,record_client_serve}.mjs`、`scripts/gate_namespace.mjs`、`packages/plugin/{client.js,package.json,cordis.patch.yml,src/index.ts}`、`packages/probe/src/{host,exec}.ts`、`tests/unit/{client-tab,probe-node-layout}.test.ts`、`tests/governance/stability-report.test.ts`、`docs/{HANDOFF,BACKLOG,specs/M4-surface,specs/M3-probe}.md`、`audit/{AUDIT_2026-10-28_R31.md,AUDIT_2026-10-28_R30.md,blind_spots.json,step_reviews.json,AI_DISCLOSURE_LOG.md}`、`INDEX.md`
- 起因：HUMAN「同意，继续，我不在乎时间和投入」（承接 R30 的三项收尾：稳定性、T-401、T-315）
- 结果：① **T-319 稳定性**：三批同 plan 矩阵（15:00/15:30/16:00）→ `stability-2026-10-28T17-00-00.000Z.json`：36 次真实观测 `boot→sample` **3.5–9.6s（median 5.4 / p90 8.2）、0/36 超 20s**、13 个真实候选**三批结论完全一致**；新脚本**拒绝单矩阵**、**不设 gate**。② **T-401 真机通过**：`record_client_serve.mjs` 六步全绿（bundle/install/boot/graph/client/mount/cleanup）——启动图里有 `dsh-triage/client.js`、组合 URL 200 / 2,020,463B、CDP 读到 `window.__dshTriage={registered:true}`；期间修掉两处**静默**发现缺陷：`exports["./client"]` 缺失、patch 行名必须是裸包名（原 `dsh-triage/host` 让浏览器半边永远不进图）。③ **T-315 收口**：模板路径与 hoisted 复制源实测都是 hoisted（195 平铺包）；**R30 的 `isolated` 读数作废**（`BS-34`）。**未做**：设置页可见性、同源结论、`strictPeerDependencies`
- 实测：296 测试 / 9 门全绿 / `--mutate` 9/9；164 步 / 149 产物
- 过程中的真实缺陷：① 布局读数连错两次（R30 的 `.pnpm` 判据 + R31 第一版的「首个条目是否 symlink」），真机对照才暴露；② `record_client_serve` 前 6 次栽在「裸 URL 一律 404，必须用 `?rev=` 组合 URL」；③ cleanup 连续 EPERM 的真因是**先删后杀**（Host 还持有文件），改成先 `killTree` 再删；④ 用 20:00 做 gate stamp 时**覆盖了 R23-S5 的产物**，用 `git checkout` 恢复后改用不冲突的 stamp；⑤ gate_namespace 的 `row-names-resolve` 旧规则强制子路径（正好是会让浏览器半边静默消失的形状），改为「裸包名 main 或 exports 子路径才算可解析」
- 未做：设置页肉眼可见断言、Host 侧只读 Remote、`strictPeerDependencies`、有载/空载对照（`BS-32` 的下一半）、`BS-29` 剩余面

### 2026-10-28 R32｜交接（只交接，不改行为）

- 生成者：DeepSeek V4.1 Flash（主会话）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R32-S1）
- 范围：`docs/HANDOFF.md`（头部 Stand/当前批次、§2 交接行与里程碑、未通过门槛的八条缺口、§3 复核命令新增 `stability_report` 与 `record_client_serve`）、`INDEX.md`（台账计数）、`audit/{step_reviews.json,AI_DISCLOSURE_LOG.md}`
- 起因：HUMAN「同意。先进行项目交接，即将切换会话」
- 结果：**一行代码、一个阈值都没动**；交接把「哪件事是真的、哪件事还没做」分开写：D2 两批通过（旧口径那条红保留为历史）、稳定性 36 次观测但只覆盖空载机、T-401 真机注册通过但**可见性与同源结论未做**、T-315 只剩 `strictPeerDependencies`；两道待签题已于 R30 按委托签完且**可撤销**
- 实测：296 测试 / 9 门全绿 / `--mutate` 9/9；165 步 / 150 产物
- 过程中的真实缺陷：无新增（本轮只有文档）；上一轮自找的 stamp 冲突已在「未通过的门槛」里留档
- 未做：T-401 最后两件、`strictPeerDependencies`、`BS-32` 的有载对照、`BS-29` 剩余面、`BS-35` 的上游漂移预警

### 2026-10-29 R33｜T-401 收口（可见性 + 同源结论）+ T-315 `strictPeerDependencies` + 两条通道的契约探测

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary；未开 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R33-S1…S8）
- 范围：`packages/plugin/src/{host,index,host-audit-route}.ts`、`packages/plugin/client.js`、`scripts/{record_client_serve,record_remote_spike}.mjs`、`scripts/lib/ui-probe.{mjs,d.mts}`、`tests/unit/{client-tab,host-audit-route,ui-probe}.test.ts`、`tests/governance/doc-stand.test.ts`、`docs/{HANDOFF,BACKLOG,specs/M4-surface,ROADMAP,adr/0010-same-source-in-tab}.md`、`audit/{SIGNOFF.md,blind_spots.json,step_reviews.json,AI_DISCLOSURE_LOG.md}`、`INDEX.md`
- 起因：HUMAN「同意，继续，处理所有问题」（R33 计划：「收口 M4-a」+「T-401 ② 先时限 spike 再定」）
- 结果：① **T-401 收口**：`visible`（关首启浮层 → 开设置 → 进「内置插件」→ DOM 出现 `分诊台` + 点击后 tab body 出现 `dsh-triage audit`）与 `same-source`（tab 与 CLI 在**同一 profile** 上同为 192 行 / 0-0-184）都有真机产物；两条负对照各自成产物。② **`ADR-0010`**：两条通道都真机测过——Typert Remote host 侧注册成功、浏览器侧拿不到（声明 `remote.compatSpike` 会让客户端模块不执行）；同源只读路由端到端可用，选后者。③ **T-315 剩余项**：`strictPeerDependencies` 严格 A/B（两组都写 `strictDepBuilds: false`）→ strict `ERR_PNPM_PEER_DEP_ISSUES` / 对照 `go`，两轮复现。④ **新盲区** `BS-36`（源带 workspace 文件即 `pnpm_policy=source`，连带丢构建策略）、`BS-37`（`ctx.baseUrl`/`ctx.webServer` 只能真机试）。⑤ **文档债**：HANDOFF 第 2 行的孤儿表格行已删，INDEX/ROADMAP 的 stand 追到 R33，新增 `tests/governance/doc-stand.test.ts`（不放宽任何门、不碰冻结台账）
- 实测：314 测试 / 9 门全绿 / `--mutate` 9/9 / 173 步 / 157 产物
- 过程中的真实缺陷：① `record_client_serve` 第一版把 `socket.close()` 写在可见性探测之前，评估永不返回 → 15 分钟静默超时（已修，并给每次 CDP 调用加 20s 超时 + `--verbose` 进度）；② 首启浮层绘制晚于首帧采样，导致浮层没关、后面全点空 → 改成「稳定帧」判定；③ `ctx.baseUrl` 是 profile 目录、`ctx.webServer` 需要 `inject` 且默认导出也带 inject —— 两次都表现为同一个 404，靠自打印的 `host_log` 才定位；④ 第一次 `strictPeerDependencies` 的「对照组」多了一个只有注释的 workspace 文件，实际差了构建策略，作废重做（`BS-36`）
- 未做：Typert Remote 的客户端生成链（`T-320`，当前不做）、`BS-32` 的有载对照、`BS-29` 剩余面、M4-b 分发件

### 2026-10-29 R34｜M4-b 徽章交付（T-402）+ format-1 索引源取证（T-403）

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary；未开 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R34-S1…S2）
- 范围：`packages/plugin/src/{badge,cli}.ts`、`scripts/record_badge.mjs`、`tests/unit/badge.test.ts`、`docs/{HANDOFF,BACKLOG,specs/M4-surface,ROADMAP}.md`、`INDEX.md`、`audit/{step_reviews.json,AI_DISCLOSURE_LOG.md}`
- 起因：HUMAN「不管 HUMAN 事项，继续」
- 结果：① 徽章 `dsh-triage badge <pkg[@ver]>` 交付（只读 SSOT、无测量即 `not measured`、不做分数、确定性渲染、8 条单测、真机两例产物）。② format-1 索引源**只取证不实现**：实读上游校验器得到完整规则 + 两条实现约束，写进 spec。③ 又踩一次 stamp 覆盖（R27 的 gates 产物），已恢复并换 stamp 重录。
- 实测：322 测试 / 9 门全绿 / `--mutate` 9/9 / 176 步 / 160 产物
- 未做：T-403 生成器实现、`BS-32` 有载对照、`BS-29` 剩余面、`T-320`（Typert 客户端生成链，当前不做）

#### R34 追加：T-403 索引源交付（同一会话续做）

- 范围：`packages/plugin/src/{index-source,cli}.ts`、`scripts/record_index_source.mjs`、`tests/unit/index-source.test.ts`、`docs/{HANDOFF,BACKLOG,specs/M4-surface}.md`、`INDEX.md`
- 结果：`dsh-triage index [--out]` 只收实测 go 的 registry 版本，`publishTimestamp` 取 registry 逐版本 `time`；**用上游校验器验证**，真机 5 插件 / 5 版本通过；8 条单测。**没做**：把索引托管成公开 URL（需 HUMAN 发布动作）

### 2026-10-29 R35｜交接（只交接，不改行为）

- 生成者：DeepSeek V4.1 Flash（主会话；未开 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R35-S1）
- 范围：`docs/HANDOFF.md`（Stand / 当前批次 / §2 交接行 / 计数）、`INDEX.md`、`docs/ROADMAP.md`、`audit/{step_reviews.json,blind_spots.json,AI_DISCLOSURE_LOG.md}`
- 起因：HUMAN「同意。先进行项目交接，即将切换会话」
- 结果：**一行代码、一个阈值都没动**。交接把三件事分开写清：R33 的 T-401 是**真的收口**（可见性与同源结论都有真机与负对照）、R34 的 M4-b 是**两件交付 + 一件未托管**（索引生成器与上游校验通过，公开 URL 未做）、以及下一步该做的是 `BS-32` 的有载对照而不是再加功能
- 实测：330 测试 / 9 门全绿 / `--mutate` 9/9 / 178 步 / 162 产物
- 过程中的真实缺陷：无新增（本轮只有文档）；上一轮自找的 stamp 覆盖已记在 R34 行与 §4 坑表
### 2026-10-29 R36｜M4-b 收口：compat_verdict Agent 工具（T-404）

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary；未开 subagent）
- SessionID：主会话（无 subagent；udit/step_reviews.json R36-S1…S4）
- 范围：packages/plugin/src/{fit,host-tool,host,index}.ts、packages/plugin/hooks/tool-hook.mjs、packages/core/src/messages.ts、scripts/{record_agent_tool,record_client_serve,gate_verdict_contract}.mjs、scripts/lib/bundle.mjs、	ests/unit/host-tool.test.ts、docs/{HANDOFF,BACKLOG,ROADMAP,specs/M4-surface,05-verdict-contract}.md、INDEX.md、AGENTS.md、udit/{AUDIT_2026-10-29_R36.md,blind_spots.json,step_reviews.json,AI_DISCLOSURE_LOG.md}
- 起因：HUMAN「同意，继续，处理所有问题」（R36 计划：先收口 M4-b 的第三件 T-404）
- 结果：① **T-404 交付**：it.ts（与 check 同一条引擎链）+ host-tool.ts（**纯对象定义**——实测注册表只校验 render/schema/timeoutMs/保留名，无 marker，故**不引上游依赖**）+ row 拆成两半各自 ctx.inject（否则 headless profile 连工具一起不挂）+ 18 条单测；失败一律 unknown + missing.admission + 新命名空间 	ool.*。② **真机**：gent-tool-2026-10-29T12-20-00.000Z.json 十一项全绿——可见性（506 字符描述 / 参数 [package] / 该 profile 2 个可见工具）、三次调用**都走 	ools.execute()**（go / blocked / unknown 三形状）、未注册名负对照、limits[] 四条。③ **回归**：注入形态改造后 R33 八步 client-serve 仍全绿（client-serve-2026-10-29T13-00-00.000Z.json，含 same-source）。④ **新盲区** BS-38（工具回答的是宿主 profile 的运行时；跨 profile 取期望得到假矛盾）、BS-39（ptc 折叠下的回退分支只有代码没有真机见证）。⑤ **旧账点名**：udit/ 里 R32–R35 没有 per-round 报告，INDEX/HANDOFF 改为按事实写，**不补写历史**。
- 实测：348 测试 / 9 门全绿 / --mutate 9/9 / 183 步 / 167 产物
- 过程中的真实缺陷：① 第一次真机期望写错（dsh-status-rotator 不声明任何范围）；② 第二次真机**跨 profile 取期望**（Host 0.2.1-rc.4 vs 操作者 ~/.dsh 0.1.0-rc.6），工具答案正确、期望错误——两份红产物保留并各自成步（R36-S1/S2）
- 未做：BS-32 有载对照（下一轮，独占机器）、BS-39 的 ptc 真机、BS-29/BS-36 剩余面、索引源公开托管（HUMAN）


### 2026-10-29 R37｜`BS-32` 有载对照 + 真发现 T-321（探针自己的临时目录失败被记成插件失败）

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary；未开 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R37-S1…S7）
- 范围：`scripts/{record_probe_matrix,stability_report,record_probe}.mjs`、`packages/probe/src/{host,exec}.ts`、`packages/plugin/src/probe-run.ts`、`packages/core/src/messages.ts`、`tests/unit/probe-exec.test.ts`、`docs/{HANDOFF,BACKLOG,ROADMAP,05-verdict-contract,specs/M3-probe}.md`、`INDEX.md`、`audit/{AUDIT_2026-10-29_R37.md,blind_spots.json,step_reviews.json,AI_DISCLOSURE_LOG.md}`
- 起因：HUMAN「同意，继续，处理所有问题」（R36 收口 M4-b 后，按 HANDOFF §3 的第一优先做有载对照）
- 结果：① **有载对照**：矩阵新增 `--load <n>`（CPU-busy worker + `os.cpus()` 累计时间差算占用率——`os.loadavg()` 在 Windows 恒为 0，用它就是假读数），`stability_report` 新增 `conditions[]`（idle / cpu-load×N / unlabelled）与 `runs_without_artifact`。两批 idle 24 次真实观测 3.7–6.2s（median 4.9s）+ 两批 8-worker 有载（58–62% 占用）24 次 5.8–8.3s（median 7.4s），**两侧 0 次越过 20s**，13 个真实候选结论一致。② **真发现 T-321**：idle 批里 `real-unlag@1.12.5` 被记成 `blocked`，`boot.detail` = `EPERM … triage-live-…`（探针自己的 scratch 被 Windows 锁住）→ 异常逃出 → 判据落到 `probe.boot-timeout`。修法：scratch 准备/清理失败**记录不抛**（`setupError`/`scratchCleanupError`），boot 步异常记 `bootSetupError`，判据新增 `probe.measurement-unavailable` → `unknown` + `missing.probe`，并**不再让清理失败销毁已拿到的样本**；N24/N24b 两条负对照。缺陷产物原样保留作唯一见证。③ **新盲区** `BS-40`（有载 1/40 子进程崩 `0xC0000409`，未复现未归因）、`BS-41`（句柄占用无法按需复现）
- 实测：350 测试 / 9 门全绿 / `--mutate` 9/9 / 190 步 / 174 产物
- 过程中的真实缺陷：① 第一份对照报告的 idle 侧只有 1 批，不足以与 2 批有载并列 → 补跑一批 idle；② 15:10 / 15:50 两份中间报告从未被引用且被 16:30 取代 → 删除（本轮自己刚生成、未入库，同 R31 删中间录制）；③ `stability_report` 第一版把「无产物」折成 `unknown` → 改为 `no-artifact` 单列
- 未做：`BS-40` 的崩溃归因、`BS-41` 的可复现夹具、内存/磁盘/并发探针型载荷、非 Windows、`BS-38`/`BS-39` 的 ptc 真机


### 2026-10-29 R38｜索引源托管成 URL + D3 渠道取证（一个卡点）+ 全面整理 + 15 条通道的真机回归

- 生成者：DeepSeek V4.1 Flash（主会话，兼 implementer / verifier / adversary；未开 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R38-S1…S16）
- 范围：`scripts/{publish_index_source,record_market_channels}.mjs`、`docs/market/{index.json,listing_zh.md,submissions/*}`、`docs/{HANDOFF,AI_HANDOVER,BACKLOG,ROADMAP}.md`、`INDEX.md`、`audit/{blind_spots.json,step_reviews.json,AI_DISCLOSURE_LOG.md}`；真机/复算产物 15 份
- 起因：HUMAN「索引源托管成 URL、D3 两个渠道收录 进行这些，然后维护整理项目文件，全方面模拟测试项目，归档过期和历史文件，确保所有用于你工作的文件为最新不冲突状态」
- 结果：① **索引源已托管**：`publish_index_source.mjs` 先过上游校验器、再发 public gist、再把 URL 抓回来逐字节比对（`index-hosting-2026-10-29T18-10-00.000Z.json`：HTTP 200 / bytes match / cors `*` / 5 插件 5 版本）。② **D3 只差一次可见性决定**：条目已通过 `dsh-community-plugins` **自己的**校验器（148 entries + 9 测试全绿），但实测 `repo.private=true` 且 registry 上 `dsh-triage` 是 404 → `live: 0`；PR 正文与解锁命令已写好（`docs/market/submissions/`），**没有开 PR**（会提交死链）。③ **文件整理**：合并重复 T-310 行、`AI_HANDOVER` 的 R5 过期状态改为指针、`listing_zh` 全面更新、新文档登记 INDEX、清 6 个沙箱残留。④ **全方面模拟测试**：探针绿/红、渲染 blank/rendered、面板冒烟、设置页八步、Agent 工具十一项、D1（9/10）、D2（`gate PASSED`，13 真实 / 预算 12-12）、真实 profile 只读扫描（156 行 / 4 结论）、组合侧 audit —— 15 份产物全部进台账
- 实测：350 测试 / 9 门全绿 / `--mutate` 9/9 / 207 步 / 190 产物
- 过程中的真实缺陷：① `gh api -f q=...` 在 PowerShell 下参数被拆（改用 URL 里的查询串）；② `git clone` 拉 GitHub 超时，但 HTTP 可用 → 改成取 tarball（脚本里也用同一路径，可复现）；③ `record_market_channels` 第一版用 `npm view` 触发 Windows 上的 `shell: true` 弃用告警 → 改为直接问 registry；④ 重跑时留了一份被取代的 `market-channels-18-30`（阻塞文案用词过时）→ 删除；⑤ `INDEX` 新行里的反引号 token（含 `/` 的 `text/plain` 与命令）触发 `governance/index-references` → 改写为纯文本
- 未做：转 public / npm 发布（**需 HUMAN 决定与凭据**）、`BS-39` 的 ptc 真机、`BS-40` 崩溃率、`BS-41` 可复现夹具、`T-501`（M5-a 本地半边）


#### R38 追加：仓库转 public + 两条 PR 已提交（同一会话续做）

- 起因：HUMAN 明确选择「A. 仓库转 public（最快解锁全部渠道）」。
- **可见性变更（外部副作用，已获授权）**：`gh repo edit jjjjjjjjnnjnn/dsh-triage --visibility public --accept-visibility-change-consequences`。变更前做过只读扫描：密钥形状（npm_ / ghp_ / sk- / AKIA / PEM / Slack）**0 命中**；根 `.npmrc` 无 token；唯一发现是历史里 2 个提交含 `C:\Users\rongj\.dsh\profiles\web`（操作者 Windows 用户名），已在提问时如实告知并获选择。
- 结果：① raw URL 立即可读（`docs/market/index.json` 2116B，逐字节一致，`index-hosting-2026-10-29T22-00-00.000Z.json`）。② **两条 PR**：`zhu1090093659/dsh-community-plugins#65`（+12/-0）与 `awesome-deepseekharness/awesome-deepseek-harness#193`（+1/-0）；`market-channels-2026-10-29T22-40-00.000Z.json` 记 `live: 2`。③ dsh.so 仍等 npm 发布。
- 过程中的真实缺陷：`JSON.stringify` 重排导致 diff 混入 4 行无关改动（已重做为文本插入）；`gh api --jq` 输出不是 JSON 导致 fork 轮询空转 20 次（已修）。


### 2026-10-29 R39｜交接（只交接，不改行为）

- 生成者：DeepSeek V4.1 Flash（主会话；未开 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R39-S1）
- 范围：`docs/HANDOFF.md`（Stand / 当前批次 / §2 交接行 / §3 第一件事 / §8 未解除项）、`INDEX.md`、`docs/ROADMAP.md`（Stand）、`audit/{step_reviews.json,AI_DISCLOSURE_LOG.md}`
- 起因：HUMAN「同意。先进行项目交接，即将切换会话」
- 结果：**一行代码、一个阈值都没动**。交接把三件事分开写清：① R36/R37/R38 各自**证明了什么**（工具真机能被调、有载把中位数抬高但没超预算、索引源 URL 可用且两条 PR 已提交）；② **什么是真的没做**（PR 只是 open、npm 未发布 → dsh.so 仍 blocked、`BS-39/40/41`、`T-303`、`T-501` 未开工）；③ **两条新的环境事实**：仓库已 public（进仓即公开，脱敏不能松）、`git push` 在本机要走系统代理。同时修掉一处旧漂移：Stand 行写 R38 而当前批次仍是 R36 的第一件事。
- 实测：350 测试 / 9 门全绿 / `--mutate` 9/9 / 213 步 / 196 产物；`git status` 干净；两条 PR 仍 `open`（`gh api` 实查）
- 过程中的真实缺陷：无代码缺陷（本轮只有文档）；发现并修正了 Stand/当前批次/第一件事三者不一致的历史漂移
- 未做：npm 发布（HUMAN 凭据）、两条 PR 的后续（维护者决定）、`BS-39`/`BS-40`/`BS-41`、`T-501`


### 2026-10-29 R40｜npm 发布落地 + `BS-39` ptc 真机收口

- 生成者：DeepSeek V4.1 Flash（主会话；未开 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R40-S2…S10）
- 范围：`scripts/record_publish.mjs`（新）、`scripts/record_agent_tool.mjs`（`--tools-mode`、模式观察、状态硬断言）、`scripts/record_market_channels.mjs`（PR `review_decision`/`merged_at`）、`packages/probe/src/host.ts`（`ExtraPatchEntry.config`）、`packages/plugin/hooks/tool-hook.mjs`（`describe()`）、`tests/unit/probe-host-sample.test.ts`（+2）、文档与台账
- 起因：HUMAN「继续」+ 已自行完成 `npm login`；此前的计划是 R40 取证收口
- 结果：① **四个包发布**（`@dsh-triage/core|signals|probe` + `dsh-triage@0.1.0`），发布后验证是**匿名安装**（空 `npm_config_userconfig`）+ CLI 真跑 + registry 字节与本地 tarball 逐字节相同；② **dsh.so 由 `blocked` 变 `ready`**；③ **`BS-39` 收口**：ptc 真机三次调用全部被 registry 拒绝并回落到定义，native 对照 3/3 走 `tools.execute()`；④ 三个真发现：npm 不重写 `workspace:*`、ptc 下 `schemas()` 仍列出插件工具、hook 把对象拒因写成 `[object Object]`（外加一个布尔状态静默成 `--`）
- 实测：352 测试（+2）/ 9 门 / `--mutate` 9/9；产物 `publish-2026-10-29T01-40-00.000Z.json`（20 项）、`market-channels-2026-10-29T02-00-00`/`02-10-00`、`agent-tool-ptc-2026-10-29T02-30-00`（首次失败，保留）/ `02-50-00` / `03-05-00`、`agent-tool-native-2026-10-29T03-20-00`
- 未做：npm 发布动作本身由 HUMAN 执行（OTP 不在 agent 手里）；`BS-40`/`BS-41`/`BS-38`/`T-501` 仍未开工

### 2026-10-30 R43｜交接（只交接，不改行为）

- 生成者：DeepSeek V4.1 Flash（主会话；本轮开了 5 个 subagent，见下）
- SessionID：主会话（subagent 会话：`ses_e7aa6757effeSVhSDdXvTZZFkl` README · `ses_e7aa6757bffeb6Qe4timPw4FSE` ADR-0011/M5 spec · `ses_e7aa67579fferGNdbv4z9dsGrN` BS-41 夹具 · `ses_e7a549dd8ffeBnRD20aAhcDX1V` T-501 · `ses_e7a255766ffehyBxZypoN8igyv` T-502；`audit/step_reviews.json` R43-S1）
- 范围：`docs/HANDOFF.md`（Stand / 当前批次 / §3 / §8）、`INDEX.md`、`docs/ROADMAP.md`（Stand）、`AGENTS.md`（Stand / 版本 / 测试数）、`audit/blind_spots.json`（stand）、`audit/AUDIT_2026-10-30_R41-R42.md`（新）、`audit/*` 台账
- 起因：HUMAN「同意。先进行项目交接，即将切换会话」
- 结果：**零代码、零判据改动**。交接把最近三轮讲清：R40 发 npm + `BS-39`/`BS-41` 收口；R41 `T-501` 本地半边 + `ADR-0011` A；R42 `T-502` 升级影响清单 + 0.2.0 四包发布。**真空洞**写进 §8：`improved` 桶无真机见证、`--registry` 成功分支无证据、dsh.so 未提交、M5-a 上传未开工、`BS-40` 1/100 未归因
- 实测：427 测试 / 9 门全绿 / `--mutate` 9/9 / 240 步 / 220 产物；`git status` 干净
- 反思：5 个 subagent 并行确实快，但每个都必须自己跑真机或测试、把边界写回报告；两次真实事故（home 路径进产物、stamp 撞车）都留在轮次报告里，没有抹掉

### 2026-10-29 R44｜T-503 点亮 `improved` + T-504 registry 成功分支 + T-505 渠道刷新

- 生成者：DeepSeek V4.1 Flash（主会话，单会话完成；未开 subagent）
- SessionID：主会话（`audit/step_reviews.json` R44-S1…S5）
- 范围：`scripts/scan_upgrade_declarations.mjs`（新）、`scripts/prepare_upgrade_mixed_profile.mjs`（新）、`scripts/record_upgrade_impact.mjs`（`--expect-improved` / `--registry-live` + 三处缺陷修复）、`tests/unit/upgrade.test.ts`（+3）、`docs/specs/M5-upgrade.md`（N20–N23）、`docs/HANDOFF.md`、`docs/BACKLOG.md`（T-501…T-505）、`INDEX.md`、`docs/ROADMAP.md`、`AGENTS.md`、`audit/blind_spots.json`（BS-42）、`audit/AUDIT_2026-10-29_R44.md`（新）、`audit/step_reviews.json`、`data/results/*`
- 人工决策：HUMAN「同意，继续，处理所有问题」+ 前一轮三选（R44 = A+B+C、R45 = 1.0 + 增长、先跑基线）
- 结果：**判据/阈值一字未动**。① 先扫 registry 取证（1584 包 / 201 今天被拒 / **前向 0** / 降级 114 / 都不放行 87），再用**真实发布的声明**策展 6 个包，真机跑出四桶非空（3 改善）；② registry 成功分支真联网 `facts = 2` 而桶不变；③ 渠道仍 `merged 0`
- 实测：430 测试 / 9 门全绿 / `--mutate` 9/9；新产物 5 份全部带 sha256 并被台账引用
- 反思：**计划里假设的「前向 improved」在真实生态是 0/1584**——如果按原计划直接造一份 `>=0.2.1-rc.6` 的声明，就会用我自己写的区间去证明我自己的分支。先取证再动手，让这一轮从「造一个能让代码变绿的样本」变成「测出生态真实的形状」，代价是多花了一轮扫描。三处记录器缺陷（恒假的检查、离线视角进产物、写死的 composition）没有一处是测试抓到的，都是真跑时看产物发现的——**产物要自己读一遍**，这句话又一次成立

### 2026-10-29 R45｜上架文案 + 第三条渠道 + 三篇案例帖 + 文案检查器

- 生成者：DeepSeek V4.1 Flash（主会话，单会话完成；未开 subagent）
- SessionID：主会话（`audit/step_reviews.json` R45-S1…S4）
- 范围：`docs/posts/`（4 个新文件）· `docs/market/listing_zh.md`（重写）· `docs/market/listing_en.md`（新）· `docs/market/submissions/README.md` / `awesome-lists.md` · `scripts/check_listing.mjs`（新）· `README.md` / `README.zh-CN.md`（版本漂移修复）· `docs/HANDOFF.md` · `INDEX.md` · `docs/ROADMAP.md` · `AGENTS.md` · `docs/BACKLOG.md`（T-601/T-602/T-603）· `audit/blind_spots.json` · `audit/AUDIT_2026-10-29_R45.md`（新）· 仓库设置（topics）
- 人工决策：HUMAN「同意，继续」（指 R45 = 1.0 + 增长）
- 结果：三条 PR 全部在案（新增 `walkinglabs` **#140**），渠道 `live 3 / merged 0`；三篇案例帖（**草稿未发布**）；文案检查器 8 条断言，**第一次跑就抓到三份对外文档残留 `dsh-triage@0.1.0`**
- 实测：430 测试 / 9 门全绿 / `--mutate` 9/9；新增 3 份产物（含 1 份保留的红产物）全部带 sha256 并被台账引用
- 反思：这一轮最值钱的不是文章，是**检查器抓到的那处旧漂移**——R42 发版时同步了 CHANGELOG 和 HANDOFF，唯独没扫对外文案，于是 npm 页面上写着旧版本号。人工 review 连续两轮没看见它，一条 8 行的断言第一次就看见了。另外两个坑（PS 管道把中文变 `??`、Windows clone 把一行改动变成 597 行）都是**会在别人仓里留下痕迹**的错误，已写进 HANDOFF §4

### 2026-10-29 R46｜交接（只交接，不改行为）

- 生成者：DeepSeek V4.1 Flash（主会话，单会话完成；未开 subagent）
- SessionID：主会话（`audit/step_reviews.json` R46-S1）
- 范围：`docs/HANDOFF.md`（Stand / 当前批次 / §3 / §8）、`INDEX.md`、`docs/ROADMAP.md`、`AGENTS.md`、`audit/blind_spots.json`（stands）、`audit/step_reviews.json`（R46-S1）
- 人工决策：HUMAN「同意。先进行项目交接，即将切换会话」
- 结果：**零代码、零判据改动**。交接把最近三轮讲清：R44 点亮 `improved`（扫 1584 包 → 前向 0 → 真实声明策展 6 个包 → 四桶非空）并补 registry 成功分支；R45 三篇案例帖（草稿）+ 上架文案 zh/en + PR #140 + 文案检查器（抓到 `dsh-triage@0.1.0` 旧漂移）；随后的 follow-up 修了 dsh.so 检查的两个反馈，并把 dsh.so 提交做成"人工提交 + 端点探针（404 → `submitted`，不是 `listed`）"
- 实测：430 测试 / 9 门全绿 / `--mutate` 9/9 / 255 步 / 235 产物；`git status` 干净
- 反思：**分发侧已经不在我们手里**（三条 PR + 一条站点提交，`merged 0` / `listed 0`）。交接里最容易犯的错是为了显得有进展，把 `submitted`/`APPROVED` 说成"收录"——这一轮在 HANDOFF §3、§8、INDEX、提交说明与产物 `limits[]` 五处都写成同一句话，就是为了让下一位没有解释空间

### 2026-10-30 R43（补记）

- 备注：R43 的 stand 标的是 2026-10-30，而本机时钟与提交时间都是 2026-10-29（`0210872` `+0800`）。R44 按真实时钟写 stand，并在 HANDOFF 顶部注明这处更正；不追改 R43 的历史文本

### 2026-10-29 R47｜定位重定向：正门改成「升级日」+ 市场基线采证 + 流程分级 + 修数

- 生成者：DeepSeek V4.1 Flash（主会话，单会话完成；未开 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R47-S1…S4）
- 范围：`scripts/record_market_baseline.mjs`（新）· `scripts/check_listing.mjs`（新增第 9 条断言 `listing-1584-is-qualified`）· `docs/ROADMAP.md`（D5 / §7.1 阶梯重写 / §4 指标）· `docs/00-vision.md`（§1b）· `PROJECT_RULES.md`（决策第 4 问 + M6 行）· `AGENTS.md` · `.agents/README.md` §6 · `.agents/rules/execution-playbook.md` §1c · `docs/specs/M6-upgrade-day.md`（新）· `docs/market/listing_zh.md` / `listing_en.md` · `docs/posts/README.md` · `docs/HANDOFF.md` · `INDEX.md` · `audit/blind_spots.json`（BS-43/BS-44）· `audit/AUDIT_2026-10-29_R47.md`（新）· `_archive/2026-10-29_HANDOFF-batch-rows-R29-R36.md`（新）
- 人工决策：HUMAN 三答——「定位走哪条」→ **B 升级日当正门**；「流程要不要分级」→ **分级**；「1584 不是全量，要先修吗」→ **先修数**（`audit/SIGNOFF.md` R47 行）
- 结果：**判据/阈值一字未动**。① 先取证：诊断类目周下载 **1,988**、市场类 380,240、装饰类 411,844、能力类 304,666、harness 540,139；`dsh-triage` **无下载记录**（404 → `no-record`，不写 0）；最近 **842** 条讨论里 **414 条故障（49.2%）**、**278 条（67.2%）零回复**。② 据此把正门换成「升级日」，出口写成可证伪的 **D5**（2 周内 reactions ≥10 / 外部引用 ≥1 / 周下载 ≥20，不达标走 D）。③ 流程分级落地，只降审核成本不降证据要求。④ 修数三处：`1584` 加「npm 关键词命中」限定（catalog 自称 7,557）、`listing` 里 dsh.so 从「尚未提交」改为「已提交未收录」、把对话里手算的 1,932 全部换成产物里的 1,988。⑤ 归档 §2 的 R29–R36 八行（逐行原文）。
- 实测：**430 测试 / 9 门全绿 / `--mutate` 9/9**；新增 4 份产物（`market-baseline-2026-10-29T12-20-00`、`listing-…T12-00-00`（保留的红产物）、`listing-…T12-30-00`、`gates-…T12-40-00`）全部带 sha256 并被台账引用（**259 步 / 239 产物**）
- 反思：这一轮最贵的动作不是写代码，是承认「**做对了的东西可能没人要**」。1,988 这个数字把「再加个功能」这条路堵住了：诊断品类整个加起来不到市场类的一个零头，而我们自己的下载记录是空的。真正救命的不是更严格的判据，而是**换一个门口**——升级日有明确时间点、只有本机能答、每次 rc 复现。另外三处旧漂移全在**对外叙述**里（1584 被当全量、dsh.so 状态过期、手算数字口径不一），没有一处是代码缺陷；抓到它们的办法只有一个：**把它做成脚本**。

### 2026-10-29 R48｜交接：记录 R48 计划 + 归档两份历史文件 + 修掉过期入口

- 生成者：DeepSeek V4.1 Flash（主会话，单会话完成；未开 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R48-S1）
- 范围：`docs/HANDOFF.md`（Stand / §2 新增 R48 行 / §3 重写为 R48 四项 / §8 两条新未决项）· `docs/BACKLOG.md`（新增 `T-806`…`T-810`；「R3–R16 已交付」11 节归档）· `docs/AI_HANDOVER.md`（Stand；§5 的 4 条过期任务入口删除，改为三个指针）· `docs/ROADMAP.md`（Stand；W11 写明 R48 四项）· `INDEX.md` · `AGENTS.md` · `PROJECT_RULES.md`（Stand + M6 状态行）· `audit/blind_spots.json`（stand）· `audit/SIGNOFF.md`（R48 三条口径）· `_archive/2026-10-29_BACKLOG-delivered-R3-R16.md`（新）· `_archive/2026-10-29_HANDOFF-batch-rows-R37-R38.md`（新）· `_archive/ARCHIVE_MANIFEST.md`（+3 行）
- 人工决策：HUMAN 三句——「产品优先」（先做 R48 四项）·「只公开项目，不公开个人」·「同意，记录，更新项目内容，归档过期和历史信息文件」（`audit/SIGNOFF.md` R48 行）
- 结果：**零代码、零判据改动**。① **把 R48 的计划写死而不是记在脑子里**：四项各自有判据 + 负对照 + 产物要求，且明确「四项全绿之前不发任何内容」；② **两份历史归档（逐行原文）**：BACKLOG 257 → 90 行（「R3–R16 已交付」11 节、约 170 行搬走），HANDOFF §2 只留最近十轮 **R39–R48**；③ **修掉一处会误导接手人的过期陈述**：`AI_HANDOVER.md` §5 还写着「M1 收口 / M2 台账 / M3 probe / 分发起草」四个入口——它们全在 R14–R37 做完了；④ 把「playbook 只作渠道、不作收入线」这条判断连同理由（需要流量池，而我们从未推广）记进 SIGNOFF，避免下一轮又被重新讨论一遍。
- 实测：**440 测试 / 9 门全绿 / `--mutate` 9/9**；新产物 `data/results/gates-2026-10-29T14-00-00.000Z.json`（262 步 / 242 产物全部被引用）
- 反思：这一轮没有产出任何功能，但它修掉的是**最贵的两类债**——「清单里混着历史」和「文档写着已经完成的事」。接手的人只会读三份文件，其中任何一份撒谎，整轮都会白跑；而这两类债恰好不会让任何门变红（`archive-manifest` 只查路径存在），只能靠人主动去读一遍。
### 2026-10-29 R48 交付｜升级日入口四项（`--to next|latest` / 无参数引导 / `--card --out` / README 首屏）+ 四包 0.3.0

- 生成者：DeepSeek V4.1 Flash（opencode 主会话，兼 implementer / verifier / adversary）
- 范围：`packages/core/src/{upgrade-target,messages,upgrade,index}.ts` · `packages/plugin/src/cli.ts` · `scripts/record_upgrade_entry.mjs`（新）· `scripts/check_listing.mjs` · `tests/unit/upgrade-target.test.ts`（新）· `tests/e2e/upgrade-cli.test.ts` · `README.md` / `README.zh-CN.md` · `docs/specs/M6-upgrade-day.md`（C8/N8 改写 + 新增 C9/C10 + N14–N18）· `docs/{HANDOFF,BACKLOG}.md` · `INDEX.md` · `AGENTS.md` · `CHANGELOG.md` · `docs/market/{listing_zh,listing_en}.md` · `docs/market/submissions/*` · `packages/*/package.json`（四包 0.3.0）· `audit/{step_reviews,blind_spots,SIGNOFF}.json|md` · `audit/AUDIT_2026-10-29_R48.md`（新）
- 人工决策：HUMAN 三问三答（Plan 模式）——① 无参数引导**允许读一次 dist-tags**；② 「精确 semver 一律离线判定」（含 `9.9.9`），只有 `next`/`latest` 联网；③ 本轮做到「四项绿 + 四包升 0.3.0」，`npm publish` 仍是 HUMAN 动作（`audit/SIGNOFF.md` R48 执行口径行）
- 结果：四项全部落地，**判据一字未动**（四桶 / `improved` 五门槛 / `admission.ts` / `data/gold/` / 20s / settle / readiness / 9 门原样）。① `resolveDistTagTarget` 只认两个关键字，解析值必须**逐字**等于 `dist-tags[tag]` 且是精确 semver（`v0.3.0` 被拒而不是被归一化）；断网/tag 缺失/值不精确 → exit 3 **零桶**。② 无 `--to` 时 stderr 报「当前 + next/latest + 下一步」并**仍 exit 2**，断网写 `未知` 不猜。③ `--card --out` 原子写、拒覆盖 exit 2、写失败 exit 3 无残留、stdout 只打路径。④ 两份 README 首屏放真机卡片，`check_listing` 新增 `readme-shows-real-card`，**数字从被引用的产物读回**逐项比对。
- 实测：`pnpm run verify` **452 测试 / 0 fail / 9 门全绿**；`gate --mutate` **9/9**；`record_upgrade_entry` **26/26**（`data/results/upgrade-entry-2026-10-29T15-50-00.000Z.json`）；离线复算 **3/3**；`check_listing` **11/11**（`listing-2026-10-29T17-00-00.000Z.json`，0.3.0 / 452）
- 过程中自己抓住的三个缺陷：① `record_upgrade_entry` 第一次跑红的 3 条是**断言自己写错**（按英文标签匹配 zh 输出）——红产物 `upgrade-entry-2026-10-29T15-40-00.000Z.json` 保留；② 覆盖拒绝原本返回 exit 3，与「目标已存在 → exit 2」的判据不符，改成分原因映射；③ 用 PowerShell `Get-Content|Set-Content` 造负对照时把中文 README 写坏（ANSIC 往返），那次红产物**作废并删除**，改用专门的编辑工具重做两条负对照
- 新盲区：`BS-45`——`tag-missing`/`tag-not-exact` 只有单测证据（真实 registry 两个 tag 都存在且精确），且「逐字相同」是时点断言，只能靠产物里的快照与离线复算兜住
- SessionID：待 HUMAN 回填（opencode 主会话）
- 备注：`npm publish 0.3.0` 与 `record_publish` 尚未执行，所以 README 里「0.3.0 on npm」在这一刻**领先于 registry**——这是本轮唯一未关闭的窗口，写在 HANDOFF §3 第 1 条

### 2026-10-30 R49｜交付：把「证据浏览器」改成「打开就有一屏答案」+ 面板安全与抗干扰收口

- 生成者：DeepSeek V4.1 Flash（opencode 主会话，兼 implementer / verifier / adversary；未开 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R49-S1）
- 范围：`packages/plugin/src/summary.ts`（新）· `packages/plugin/src/serve.ts`（面板重写 + `/api/summary` + `resolveArtifact` + `singleFlight` + CSP）· `packages/plugin/src/cli.ts`（`commandStatus` / `commandAudit` 摘要 / `commandServe` / HELP / `--no-audit`）· `tests/unit/summary.test.ts`（新）· `tests/unit/serve.test.ts` · `tests/unit/serve-adversarial.test.ts`（新）· `tests/e2e/cli.test.ts` · `tests/e2e/inventory-cli.test.ts` · `scripts/record_serve_smoke.mjs` · `docs/SECURITY.md`（新）· `docs/HANDOFF.md` · `INDEX.md` · `AGENTS.md` · `CHANGELOG.md` · `docs/BACKLOG.md` · `audit/step_reviews.json` · `audit/blind_spots.json` · `audit/SIGNOFF.md` · `audit/AUDIT_2026-10-30_R49.md`（新）
- 人工决策：会话内「继续」——按 R49 既定收口继续（跑门禁 / 落真跑产物 / 同步文档）。**没有**新的产品决策，也没有放宽任何判据
- 结果：**判据/阈值/`audit --json` 一字未动**。① 无参 `dsh-triage` 从「36 行 usage、exit 0」变成 `status` 的一屏答案；② `audit` 默认打摘要（9 行），全台账进 `--all`（170 行）；③ 面板首屏 = 结论横幅 + 六 chip + 问题卡片 + 下一步，证据与原始 JSON 退到两个页签；④ 三个真发现：CSP `default-src 'none'` 连带拦掉页面自己的 `fetch()`（旧面板在真浏览器里从来没加载出表，冒烟脚本写着 `no browser is involved`）、空组合被判「没有问题」、列表路由整份读入任意大小 JSON；⑤ `docs/SECURITY.md` 写清威胁模型与三条红线，`tests/unit/serve-adversarial.test.ts` 11 条拒绝
- 实测：**477 测试 / 0 fail**（452 → 477）· 9 门 ALL GREEN · `--mutate` 9/9 · 面板冒烟 **17/17** + 独立复算 17/17 · `data/results/serve-smoke-2026-10-30T10-30-00.000Z.json`
- 反思：这一轮修的是一类**不会让任何门变红**的错误——「页面看起来正常，其实永远空」。API 层断言全绿，用户看到的却是一个空壳，因为浏览器把页面自己的 `fetch` 拦了。以后改面板必须至少截一张图；同时「沉默 = 通过」这个错误在三个地方各出现了一次（空组合、未声明行、关闭的路由），这次的修法不是加文案，而是让状态码 / 横幅 / 计数三者都可区分。

### 2026-10-30 R49 续｜交付：按用户反馈重做面板（搜索 / 筛选 / 排序 / 详情抽屉 / 主题 / 深链）

- 生成者：DeepSeek V4.1 Flash（opencode 主会话；未开 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R49-S2）
- 范围：`packages/plugin/src/serve.ts`（页面整体重写：应用外壳 / 计数筛选 / 工具栏 / 可排序表 / 抽屉 / 主题 / 快捷键 / 深链；`summarizeArtifact` 增加 `passed`·`ok`·`expectation_met` 三种录法）· `packages/plugin/src/cli.ts`（面板的 summary 上限提到 50，终端仍是 8）· `tests/unit/serve-ui.test.ts`（新，5 条）· `scripts/record_serve_smoke.mjs`（新增 `page-controls`）· `data/results/serve-smoke-2026-10-30T11-40-00.000Z.json`（新）· `docs/{HANDOFF,SECURITY}.md` · `INDEX.md` · `AGENTS.md` · `README*.md` · `CHANGELOG.md` · `audit/{step_reviews}.json` · `audit/AUDIT_2026-10-30_R49.md`（追加 §8）
- 人工决策：用户在会话里直接反馈「控制起来不一目了然，没有适合清爽的 UI，不容易查看和控制」，并附上 `npm publish` 在仓根报 `EPRIVATE` 的截图。据此做两件事：**面板从「能读」做到「能操作」**；**把发布入口写清楚**（根 `package.json` 是 `private: true` 的工作区根，正确入口是 `pnpm -r publish --access public`，已加成 `pnpm run release:publish`）
- 结果：**判据/阈值/`audit --json` 仍未动**。① 六个计数可点，点了就按类型筛「要看的地方」；② 证据页三个筛选（搜索 / 类型 / 结论）+ 六列可排序表头 + 右侧详情抽屉（复制名称 / sha256 / JSON）+「复制这段结论」；③ 主题三态（跟随系统 / 浅 / 深，`localStorage` 记住）、`/` `r` `l` `Esc` 快捷键、`#artifact=` 与 `#theme=` 深链；④ **两处真发现的界面缺陷**：注入的文案表漏 `allKinds` / `allConclusions` / `kbdHint`（下拉框与提示渲染成空，`--dump-dom` 才看见）、`color-scheme: light dark` 让浅色主题的画布仍是深色；⑤ 结论列现在读得出 `passed` / `ok` / `expectation_met`，252 个产物里不再有 200 个写着「没有结论」
- 实测：**482 测试 / 0 fail**（477 → 482）· 9 门 ALL GREEN · 面板冒烟 **18/18**（新增 `page-controls`）· 真浏览器截图 4 张（深色首屏 / 深色证据页 / 详情抽屉 / 浅色首屏）
- 反思：第一次截图「看起来干净」，但两个下拉框是空的——**界面缺陷不会让任何 HTTP 断言变红**，只能靠真的把 DOM 与截图拿出来看。所以这一轮加了一条结构性测试（`COPY.<key>` 全覆盖），把「读一个没注入的键」变成红；这比再写十条「页面含某字符串」有用。

### 2026-10-30 R49 三｜交付：简单模式（人话）+ 发布预检查（把 404 翻成「还没登录」）

- 生成者：DeepSeek V4.1 Flash（opencode 主会话；未开 subagent）
- SessionID：主会话（无 subagent；`audit/step_reviews.json` R49-S3）
- 范围：`packages/plugin/src/summary.ts`（`plain` 结论 + 每条问题的 `plain`，CLI 文本改为「人话在前、精确在后」）· `packages/plugin/src/serve.ts`（简单/详细双视图、主按钮、人话子行）· `packages/{core,plugin,signals,probe}/package.json`（`publishConfig.access=public`）· `package.json`（`release:publish`）· `scripts/release_preflight.mjs`（新）· `tests/unit/{summary,serve-ui}.test.ts` · `scripts/record_serve_smoke.mjs` · `data/results/serve-smoke-2026-10-30T12-10-00.000Z.json`（新）· 文档若干
- 人工决策：用户第二次反馈——「控制面板让人看不懂，希望普通人也能用，最好傻瓜式操作，或者自动执行」，并附 `pnpm -r publish` 的 404。诊断结论：**不是包不存在，是 npm 登录已失效**（`npm whoami` 返回 401；未登录时发布 scoped 包会回 404）
- 结果：**判据/阈值/`audit --json` 仍未动**。① 面板默认**简单模式**：一句话说清「会不会坏」+ 一个主按钮（有修复命令就复制命令，否则复制整份结果）+ 每条问题一句人话；右上角 `简单 / 详细` 切换；② 人话不撒谎：`tone` 非 ok 时 `plain` 禁止出现「一切正常」，154 行未声明仍然要说出来（换成「另外 154 个插件没说自己支持哪些版本，我们判断不了——这不等于它们没问题」）；③ CLI 的结论行也改成人话在前、精确陈述在后；④ 发布链路：`publishConfig.access=public` + `release_preflight.mjs`（登录 / 四包同版本 / 可见性 / 是否 build），把 404 直接翻成「你还没登录（`npm login`）」
- 实测：**484 测试 / 0 fail**（482 → 484）· 9 门 ALL GREEN · 面板冒烟 **18/18**（8 个控件）· 简单模式在浅色/深色各截一张图确认
- 反思：「简单」不是把技术文案删掉，而是**把同一句话换一种说法**——154 行未声明如果从简单模式里消失，那这个模式就是在撒谎。所以 `plain` 是 `summary` 的一部分（可被测试断言），而不是面板里临时拼的字符串。
