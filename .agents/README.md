# .agents · Agent 工作框架（交接入口）

> 目的：任何 agent（人或模型）进来，**不读全仓也能开工**；任何 agent 离开，**下一个人能无损接手**。
> 上层宪法：`PROJECT_RULES.md`（10 条铁律）· `AGENTS.md`（架构图 + 工作流）· `docs/08-conventions.md`（代码约定）

---

## 1. 三个入口

| 你的处境 | 先读 | 再读 |
|---|---|---|
| **第一次接手** | `docs/HANDOFF.md` §1（5 分钟检查） | `.agents/rules/execution-playbook.md` |
| **要领一个任务** | `docs/BACKLOG.md`（可领取清单） | `.agents/prompts/task-packet.md` |
| **要审核别人的产出** | `.agents/roles/reviewer.md` | `.agents/prompts/review-packet.md` |

## 2. 角色卡（`.agents/roles/`）

| 角色 | 职责一句话 | 禁区一句话 |
|---|---|---|
| `researcher.md` | 卡住先外部取证（≥2 角度），产出带引用等级的结论 | 禁写实现代码 |
| `implementer.md` | 按 spec 写码 + 先写断言 | 禁改判据、禁跳门禁 |
| `verifier.md` | 独立重建环境、只看产物复算 | 禁看实现过程、禁复述实现者结论 |
| `reviewer.md` | 四轴审核（正确/可复现/合规/SSOT） | 禁跨轴改结论、禁只报「看起来没问题」 |
| `adversary.md` | 专门证明「这个门/结论可以被骗过」 | 禁以「没找到反例」代替构造 |
| `arbiter.md` | 主会话仲裁，矛盾不解决不过门 | 禁跳过任一轴直接放行 |

并发规则见 `.agents/rules/agent_collaboration.md`；对抗性要求见 `.agents/rules/adversarial_review.md`。

## 3. 三个模板（`.agents/prompts/`）

- `task-packet.md`：派活给 subagent 的最小任务包（防上下文污染）；
- `review-packet.md`：审核包（只读 + findings + verdict）；
- `handoff-packet.md`：交接包（本轮到哪、下一步、坑、证据）。

## 4. 硬性要求（机器校验）

以下由 `scripts/gate_governance.mjs` 与 `tests/governance/ledgers.test.ts` 强制，缺一即红：

1. 每个角色卡必须含 `## 输入` / `## 输出` / `## 禁区` / `## 验收` 四节；
2. 每个模板必须含 `## 模板` 一节；
3. `AGENTS.md` 必须链接到本文件；
4. `docs/HANDOFF.md` 必须含「当前批次」与「下一位 agent 的第一件事」；
5. `audit/AI_DISCLOSURE_LOG.md` 必须逐轮登记（含 SessionID 字段）。

## 5. 一句话原则

> **判据先行、证据落盘、负对照先行、交接可读。**
> 任何「我说做好了」都不算完成；能在干净机器上复现的门禁绿灯才算。
