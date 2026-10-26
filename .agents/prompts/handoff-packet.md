# 模板 · Handoff Packet（交接包）

## 模板

```markdown
## 交接包 <日期> <轮次ID>｜<一句话主题>

### 1. 到哪了
- 里程碑状态：M0 ✅ / M1 🟡 / M2 ⬜（以 PROJECT_RULES.md 路线表为准）
- 本轮做了什么：<3 条以内>
- 证据：<SSOT 路径 + sha256 前 12 位 + 测试/门禁数字>

### 2. 下一位 agent 的第一件事
<一条命令 + 一句验收标准。必须能在 10 分钟内看到结果。>

### 3. 坑（真实踩过的）
| 症状 | 原因 | 处置 |
|---|---|---|
| ... | ... | ... |

### 4. 未完成 / 已知风险
- [ ] <项> — owner: <角色> — 退出条件: <可验证条件>

### 5. 冻结区提醒
`data/gold/**`、`audit/gate_ledger.json#negative_control`、`packages/core/src/admission.ts` 规则顺序、`PROJECT_RULES.md` 铁律

### 6. 环境
- Node / pnpm / dsh 版本（见 docs/07-environment.md）
- 本机特殊情况：<无则写「无」>
```

## 硬性要求

1. 「下一位 agent 的第一件事」必须是**单条可执行命令**，不能是「理解一下架构」；
2. 证据必须落盘（SSOT + 哈希），禁只贴 stdout；
3. 未完成项必须带 owner 与退出条件，否则等于把缺陷合法化；
4. 交接包同时写入 `docs/HANDOFF.md` 的「当前批次」小节，并追加 `audit/AI_DISCLOSURE_LOG.md`。
