# 模板 · Task Packet（派活给 subagent）

## 模板

```markdown
## 任务
<一句话：要产出什么，可验收的形态>

## 上下文（只给必需，勿倒整仓）
- 相关文件：<路径列表，≤5 个>
- 必须遵守：<spec 判据编号 / 角色卡路径>
- 已知事实：<3~5 条，带文件:行或 SSOT 路径>
- 明确不知道：<避免 agent 编造>

## 边界
- 允许改动：<精确文件清单>
- 禁止触碰：`data/gold/**`、`audit/gate_ledger.json` 的 negative_control、`packages/core/src/admission.ts` 规则顺序
- 禁联网 / 允许联网：<二选一>

## 输出格式（缺一项视为未完成）
1. 结论 ≤5 行
2. 证据 ≤10 条（文件:行 或 命令 + 输出片段）
3. 改动清单（文件 → 改了什么）
4. 未解决 / 风险 ≤3 条

## 验收命令
```powershell
pnpm run verify
node scripts/gate.mjs --mutate
```
```

## 使用注意

- 一个 subagent 只给一个任务；不要把「调研 + 实现 + 审核」混在一个包里；
- 同文件禁并行；只读审核可按轴并行；
- 返回摘要，不贴大段原文；主会话负责拼图与仲裁。
