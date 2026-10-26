# BACKLOG · 可领取任务清单

> 规则：一个任务 = 一个可验收产物 + 一个角色 + 一个判据来源。领取前先读 `docs/HANDOFF.md`。
> 状态：`⬜ 待领` / `🟨 进行中` / `✅ 完成` / `⛔ 阻塞`（阻塞必须写 owner + 退出条件）

| ID | 任务 | 里程碑 | 角色 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|---|---|
| T-101 | 真实案例验收：把「MCP 工具静默消失」案例跑通 `why` 并落 SSOT | M1 | verifier + adversary | — | 点名行 = 真实根因；修复后症状消失；`data/results/why-case-*.json` | ⬜ |
| T-102 | `why` 支持 stderr 归因（import/apply 失败 → 行） | M2-b | implementer | T-201 | 3 类真实故障都能点名 | ⬜ |
| T-103 | 补 6 条金标：`workspace:` peer、`engines` 畸形、`^0.2.0` prerelease 边界 | M1 | implementer | — | parity 门绿 + 夹具 `why` 说明 | ⬜ |
| T-201 | 接入 `pluginInventory/list`（相位）到 `audit`/`why` | M2-a | implementer | — | `audit` 显示 active/failed/null；与静态声明交叉校验 | ⬜ |
| T-202 | 运行时命名空间快照（tools/commands/settings/skills） | M2-a | implementer | T-201 | 快照落 `data/results/ns-*.json` + 哈希 | ⬜ |
| T-203 | 冲突分级 v2：service / tool / command / slot / theme 权重表 | M2-a | implementer | T-202 | 单测覆盖 5 类；文档 `docs/03` F4 更新 | ⬜ |
| T-301 | probe 执行器（boot/http 两段） | M3 | implementer | T-201 | 单次 ≤20s；失败清理；dry-run 默认 | ⬜ |
| T-302 | probe 的 client-rendered 断言（BS-03） | M3 | implementer | T-301 | 能识别「HTTP 200 但白屏」 | ⬜ |
| T-303 | probe 的 namespace-diff 断言 | M3 | verifier | T-202, T-301 | 声明了但未注册的工具能被列出 | ⬜ |
| T-401 | Web 面板骨架（`settings.plugins.tab`） | M4-a | implementer | 上游 cordis 类型 | 面板显示与 CLI 同源结论 | ⬜ |
| T-402 | 徽章服务（SVG，插件×dsh×os） | M4-b | implementer | — | 徽章可按 SSOT 渲染；带 dsh.so 署名 | ⬜ |
| T-403 | format-1 索引源生成器 | M4-b | implementer | T-402 | 输出通过 `format:1` 字段校验；可在 Discover 添加 | ⬜ |
| T-404 | `compat_verdict` Agent 工具 | M4-b | implementer | T-201 | 工具返回 verdict JSON；失败降级 `unknown` | ⬜ |
| T-501 | 回流 schema + opt-in 开关 + 删除路径 | M5-a | implementer + reviewer(合规) | — | 0 PII；可删除；文档说明 | ⬜ |
| T-502 | 升级影响清单生成器（给定目标 dsh 版本） | M5-b | implementer | T-201 | 24h 内产出；含修复建议 | ⬜ |
| T-601 | 上架文案（zh/en）+ 提交 3 渠道 | 1.0 | arbiter | 功能完成 | `gate_release --publish` 绿 + 2 渠道收录 | ⬜ |
| T-602 | 案例帖 ×3（消失的工具 / 白屏 / 升级后起不来） | 增长 | researcher | T-101 | 每篇含真实 SSOT 证据 | ⬜ |
| T-701 | 把 `dsh.so` 数据接入 `check`（作为先验，tier 不得越级） | M2 | implementer | — | `--explain` 显示 registry 先验与本地结论差异 | ⬜ |

---

## 领取流程（3 步）

1. 把状态改 `🟨 进行中` 并写上自己的名字/agent 名（同一提交）；
2. 按 `.agents/prompts/task-packet.md` 自查边界（允许改哪些文件）；
3. 完成后：`pnpm run verify` + `node scripts/gate.mjs --mutate` → 更新状态为 `✅` 并在 `audit/AI_DISCLOSURE_LOG.md` 留痕。

## 禁止事项

- 禁同时领取两个有文件重叠的任务（同文件禁并行）；
- 禁跳过依赖（例：没接 T-201 就做 T-301）；
- 禁把「未做完」标成 `✅`（可标 `⛔` 并写清退出条件）。
