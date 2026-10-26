# BACKLOG · 可领取任务清单

> 规则：一个任务 = 一个可验收产物 + 一个角色 + 一个判据来源。领取前先读 `docs/HANDOFF.md`。
> 状态：`⬜ 待领` / `🟨 进行中` / `✅ 完成` / `⛔ 阻塞`（阻塞必须写 owner + 退出条件）

| ID | 任务 | 里程碑 | 角色 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|---|---|
| T-101 | 真实案例验收：把「插件静默消失」案例跑通 `why` 并落 SSOT | M1 | verifier + adversary | — | 点名行 = 真实根因；`data/results/why-case-*.json` 的 `hit.verdict=hit` | ✅ **CASE-11080 命中**（`data/cases/CASE-11080/`，2026-10-26）。D1 门槛是 10 例 ≥8 命中，目前 **1/1**，案例数未达标 |
| T-104 | 再收 9 例真实案例（凑满 D1 门槛 10 例） | M1 | researcher + verifier | — | 每例 `record_case` 可复现；命中率 ≥80% | ⬜ 建议下一批（讨论区/issue 已证明可挖到） |
| T-102 | `why` 支持 stderr 归因（import/apply 失败 → 行） | M2-b | implementer | T-201 | 3 类真实故障都能点名 | ⬜ |
| T-103 | 补 6 条金标：`workspace:` peer、`engines` 畸形、`^0.2.0` prerelease 边界 | M1 | implementer | — | parity 门绿 + 夹具 `why` 说明 | ⬜ |
| T-201 | 接入 `pluginInventory/list`（相位）到 `audit`/`why` | M2-a | implementer | — | 契约已在 `docs/specs/M2-inventory.md` 锁定（B1–B5）；实现走 P1 进程内 + P2 快照文件 | 🟨 **契约就绪，实现待领**（沙箱 `data/results/upstream-0.2.1-rc.3-*.json` 已证明服务存在、`fiberPhase` 枚举实测） |
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

## R4 已交付（本轮，证据见 `data/results/why-case-CASE-11080-*.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| T-101 | 真实案例命中：升级后 `cordis.patch.yml` 的行被静默禁用（peer 钉旧版本） | ✅ |
| A7/A8 | **行级 admission 归因**：此前只按 bundle 判，patch 里的 row 逃检（假阴）；未安装模块只能 `unknown` | ✅ |
| NEW | `scripts/record_case.mjs`：案例输入固化 + 隔离复现 + 机器可算命中判定 + SSOT | ✅ |
| NEW | `scripts/bootstrap_upstream.mjs`：0.2.x 隔离运行时（不写 `~/.dsh`）+ 契约实测 SSOT | ✅ |
| NEW | `docs/specs/M2-inventory.md`：`pluginInventory` 契约、相位映射、P1/P2/P3 传输路径、负对照 | ✅ |
| 测试 | +4 单测（`tests/unit/rows.test.ts`）+3 e2e（row 命中、相对路径 row、缺失包不判 go）= 56 条 | ✅ |

---

## R3 已修（证据见 `audit/AUDIT_2026-10-26_R3.md`）

| 审核 ID | 内容 | 状态 |
|---|---|---|
| A1 | SSOT 泄露 home 路径（`evidence[].source`）→ `redactVerdict` + `results-privacy` 门 | ✅ |
| A2 | 删除会撒谎的公开 API `readDshPeerRequirements` | ✅ |
| A3 | admitted verdict 重复渲染同一文案 → 新增 `admission.declared-only` | ✅ |
| A4 | 修复文案硬编码英文 → `Remediation.messageId/params` + 本地化渲染 | ✅ |
| A5 | 门禁校验 messageId 必须存在于 `messages.ts` | ✅ |
| A6 | `gate_ssot` 校验 `produced_by` 指向真实脚本 | ✅ |
| A7 | probe 首步语义修正（`runtime-check`） | ✅ |
| A8 | `.npmrc` 去掉 pnpm 专属键（消除 npm 告警） | ✅ |
| A9 | 新门 `release-pack`：实测 `npm pack` 内容 | ✅ |
| A10 | CI 增加 Windows job | ✅ |
| A11 | 新增 e2e CLI 测试（含脱敏断言） | ✅ |
| A12 | 坑表补 3 条真实故障 | ✅ |

---

## 领取流程（3 步）

1. 把状态改 `🟨 进行中` 并写上自己的名字/agent 名（同一提交）；
2. 按 `.agents/prompts/task-packet.md` 自查边界（允许改哪些文件）；
3. 完成后：`pnpm run verify` + `node scripts/gate.mjs --mutate` → 更新状态为 `✅` 并在 `audit/AI_DISCLOSURE_LOG.md` 留痕。

## 禁止事项

- 禁同时领取两个有文件重叠的任务（同文件禁并行）；
- 禁跳过依赖（例：没接 T-201 就做 T-301）；
- 禁把「未做完」标成 `✅`（可标 `⛔` 并写清退出条件）。
