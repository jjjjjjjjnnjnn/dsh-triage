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
