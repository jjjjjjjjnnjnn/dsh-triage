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
