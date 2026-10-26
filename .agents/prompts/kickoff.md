# 模板 · Kickoff Packet（新会话开工指令）

## 模板

把下面整块内容粘到新会话的第一条消息里（按需替换 `<任务ID>`）：

```text
【项目】dsh-triage（分诊台）— DSH 插件的判断层。仓库 https://github.com/jjjjjjjjnnjnn/dsh-triage（private, main）
【工作目录】C:\Users\rongj\Desktop\项目开发\DSH-Addition
【上游基线】@deepseek-ai/dsh 0.2.1-rc.2（本机 profile 实测 0.1.0-rc.6）
【当前状态】M0 ✅（75 测试 / 9 门 / 负对照 9-9）· M1 金标对等 ✅ · M1 真实案例验收 ✅ D1 通过（10 例 / 9 命中 / 1 有意 miss）· M2-a **P2 已交付**（`audit --snapshot` + 相位契约门）/ P1 待真机

【开工三步，先跑再动手】
1) git status --short && git log --oneline -3
2) pnpm install --frozen-lockfile && pnpm run verify
3) node scripts/gate.mjs --mutate
期望：第 2 步 ALL GREEN · 9 gates；第 3 步最后一行 NEGATIVE CONTROL PASSED · 9/9。
任一不满足 → 先修基线，不叠加新功能。

【必读（按顺序，约 10 分钟）】
docs/HANDOFF.md → PROJECT_RULES.md → INDEX.md → docs/08-conventions.md
然后按需：docs/03-failure-taxonomy.md（失败机制）、docs/05-verdict-contract.md（结论契约）、docs/ROADMAP.md（阶段与决策门）

【本轮任务】<任务ID，默认 T-201>
- 判据与验收：docs/BACKLOG.md 对应行 + 相关 docs/specs/*.md
- 允许改动的文件：先在回复里列出来（同文件禁并行）
- 冻结区（禁止修改）：data/gold/**、audit/gate_ledger.json#negative_control、packages/core/src/admission.ts 的规则顺序、PROJECT_RULES.md 铁律、packages/plugin/cordis.patch.yml 的行 id

【硬边界】
- 本机 ~/.dsh 只读；probe 只在独立 DSH_HOME 下操作且默认 dry-run
- 禁读凭据；禁把第三方产物直接跑起来（先 quarantine/ 双门制）
- 禁为了变绿放宽门禁；改判据/阈值需 spec + HUMAN-SIGN
- 禁删除文件（只能 git mv 进 _archive/ 并登记）
- **每完成一步就追加 audit/step_reviews.json（四轴 + 对抗性 + real_test 产物 sha256），并跑 node scripts/gate_step_review.mjs**；漏登记 = `pnpm run verify` 红

【交付格式】
1) 改动清单（文件 → 改了什么）
2) 证据：pnpm run verify 输出摘要 + gate --mutate 的 8/8 + SSOT 路径与 sha256 前 12 位
3) 每一步的 step_reviews 条目（四轴结论 + 你真实构造的反例）
4) 未完成/风险 ≤3 条（带 owner + 退出条件）
5) 交接包：按 .agents/prompts/handoff-packet.md 写，并更新 docs/HANDOFF.md §2/§3

【禁止】
- 不要重写架构、不要顺手改无关文件
- 不要在对话里下结论而不落文档/SSOT
- 不要 force-push
```

## 使用注意

1. **一次只开一个任务**：多任务会破坏「同文件禁并行」的边界；
2. 如果第一步就红（例如依赖没装），先做基线修复并单独提交，再开始任务；
3. 新会话的第一次回复请包含：基线状态（三步结果）+ 允许改动清单 + 你的执行计划（≤5 行）。
