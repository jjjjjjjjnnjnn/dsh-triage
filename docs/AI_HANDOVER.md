# AI_HANDOVER · 接手清单

> **Stand**: v0.1.0-skeleton (2026-10-26)｜读我 → 读 `PROJECT_RULES.md` → 读 `INDEX.md`

## 1. 五分钟检查（禁跳过）

```powershell
git status --short            # 必须干净
pnpm install
pnpm run verify               # 基线必须全绿
node scripts/gate.mjs --mutate  # 每道门都必须 CAUGHT
```

基线不绿 → 先修基线，**不叠加新功能**。

## 2. 接手速览（30 秒）

- **这是什么**：DSH 插件的判断层。回答「该不该装」「装了为什么没反应」「谁把工具吃了」。
- **不做什么**：市场、启动器、安全扫描、装/卸/回滚（上游已接管）。
- **真相源**：
  - admission 语义 → `docs/04-admission-semantics.md` + `data/gold/admission-cases.json`
  - 结论格式 → `docs/05-verdict-contract.md`
  - 失败分类 → `docs/03-failure-taxonomy.md`
  - 信号与许可 → `docs/02-signal-sources.md` + `quarantine/vendor-manifest.json`
  - 工程约定 → `docs/08-conventions.md`
- **当前状态**：M0 完成（骨架 + 7 门 + 引擎 + CLI 基础版），M1 进行中（admission 对等已由金标锁定）。

## 3. 防幻觉规则（本仓特有）

1. **上游语义只能引用文档原文**，不得凭记忆复述；引用必须带包名 + 版本（如 `@deepseek-ai/dsh-app-boot@0.2.1-rc.2`）。
2. **不许把「声明通过」写成「可用」**：`go` 的语义是「按声明可以装」（`docs/05-verdict-contract.md` §4）。
3. **不许编造下载量/星标**：所有对外数字必须来自 npm/GitHub API 快照并注明日期。
4. **第三方 schema 不可信**：读字段必须防御式，未知字段进 `raw`，不猜。
5. **没有证据就写 `unknown`**：这是本项目的产品原则，也是工程原则。

## 4. 冻结区（改之前必须问）

| 区域 | 原因 |
|---|---|
| `data/gold/admission-cases.json` | 金标；改动等于改判据，需要 spec + HUMAN-SIGN |
| `audit/gate_ledger.json` 的 `negative_control` | 负对照是门禁有效性的唯一证明 |
| `packages/core/src/admission.ts` 的规则顺序 | 与上游对等性由金标锁死 |
| `PROJECT_RULES.md` 的铁律 | 工程宪法 |

## 5. 下一步（选一个就能开工）

| 任务 | 入口 | 验收 |
|---|---|---|
| M1 收口 | `docs/specs/M1-why.md` | 21 条金标全绿 + `scan_env` SSOT 落盘 |
| M2 运行时台账 | `docs/02-signal-sources.md` §4 待验证清单 | `pluginInventory` 字段核实 + `audit` 显示相位 |
| M3 probe 执行器 | `packages/probe/src/plan.ts` | 见 `docs/06-roadmap.md` M3 出口门禁 |
| 分发起草 | `docs/06-roadmap.md` §3 | catalog/hub/dsh.so 三份提交文案 |

## 6. 常见错误（会浪费一整轮）

1. 改 `verdict.ts` 却忘了 `messages.ts` → CLI 输出 `?messageId`；
2. 新增结果文件却忘了 `.sha256` → `gate_ssot` 红；
3. 直接在 `data/results/` 手写 JSON → `produced_by` 缺失 → 红；
4. 把 `workspace:*` 依赖指向非 `@dsh-triage/*` 包 → `gate_release` 红；
5. 把 loader 行 id 写成 `plugin-manager` → `gate_namespace` 红（真实后果是整个 profile 起不来）。
