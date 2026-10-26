# DSH-Addition PROJECT_RULES.md（工程铁律）

> **Stand**: v0.1.0-skeleton (2026-10-26) | **SSOT**: `data/results/`（真跑 JSON + `.sha256`）与 `data/gold/`（人工签署金标）

---

## 工程铁律 (Engineering Mandates)

1. **判断必须可证伪**：每条 verdict 必须带 `evidence[]`（tier + source + method + at）与 `confidence`；证据不足只能出 `unknown`，禁止用「看起来专业」的评分代替证据。
2. **对等上游语义**：admission 判定必须与 `@deepseek-ai/dsh-app-boot` 语义 **逐条对等**（`engines.dsh` 优先 → 否则 `@deepseek-ai/dsh*` peer 全 AND → prerelease 参与 → 空/非法区间视为不兼容）。对等性由 `data/gold/admission-cases.json` 门禁锁死，禁止凭记忆改规则。
3. **本机只读**：除 `packages/probe` 在独立 `DSH_HOME` 下操作外，任何代码禁写 `~/.dsh`；probe 默认 dry-run，真跑需显式 `--execute`。
4. **门禁永不失效**：`scripts/gate_*.mjs` 零第三方依赖、零网络；门禁红了先修根因，禁改阈值（阈值变更需 spec + HUMAN-SIGN）。
5. **SSOT 只由脚本产出**：`data/results/*.json` 必须含 `produced_by`（脚本名）、`generated_at`、`schema_version`，并配 `.sha256`；`gate_ssot` 校验，手填即红。
6. **隔离区双门制**：任何外部插件产物 / 第三方仓库 / 抓取数据先落 `quarantine/`，登记 `vendor-manifest.json`（许可 + 取用范围 + 是否可商用断言），未登记禁入 `packages/`。
7. **只进不出**：废弃文件只能 `git mv` 进 `_archive/` 并登记 `ARCHIVE_MANIFEST.md`，禁 `rm/del`。
8. **联动同步（Sync Rule）**：改 `packages/` `scripts/` `tests/` → 同步 `AGENTS.md` 架构图 + `INDEX.md` + `audit/AI_DISCLOSURE_LOG.md`；改结构 → 同步 `docs/DESIGN-MAP.md`；加文档 → 登记 `INDEX.md`。
9. **命名安全（硬性）**：不得占用上游 loader row id（`plugin-manager`/`tools`/`session`/`llm`/`web`/`permission`/`plugin-market`）与服务名；本仓所有 loader row 前缀 `compat-`，服务名以 `compat` 起头。`gate_namespace` 校验。
10. **许可与数据来源**：只用 MIT / CC BY 4.0 等可再分发数据；引用 dsh.so 数据必须署名（CC BY 4.0），npm 元数据按 registry 条款；`vendor-manifest.json` 是许可真相源。

---

## 严禁行为

1. **严禁把「声明检查」包装成壁垒**：上游已内置 install 前声明门（0.1.7+）。我们的差异只能是归因 / 组合 / 实测 / 回流。
2. **严禁对恶意代码给安全背书**：probe 只回答「能不能装、跑不跑得起来」，禁止输出「安全 / 无恶意」类结论。
3. **严禁伪造下载量或刷量**：README/榜单中的任何数字必须可回溯（npm API / 快照 + 时间戳）。
4. **严禁把密钥写进仓**：`~/.dsh/credentials`、API Key、代理凭证一律不读不写（probe 隔离目录内也不注入真实凭据）。
5. **严禁破坏可复现性**：输出必须确定性（排序键固定、时间戳只来自 `generated_at`、禁随机 ID）。
6. **严禁无证据的竞品贬损**：`docs/01-competitors.md` 的每条结论必须附来源（仓库 / README / 实测），C 级证据（推测/转述）不得写入结论段。

---

## 路线图 Roadmap（每阶段有出口门禁）

| 阶段 | 名字 | 交付物 | 出口门禁 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| **M0** | 骨架 | 目录/治理/门禁/pnpm 工作区/core+signals+probe+plugin 空壳可构建 | `pnpm run verify` 全绿；6 个门禁可分别 FAIL（负对照） | ✅ 已交付（2026-10-26，41 测试 / 6 门全绿 / 6 门 mutate 全部 CAUGHT） |
| **M1** | admission 对等 | `core/admission` + `data/gold/admission-cases.json`（21 条：13 synthetic + 8 npm 真快照） | 金标 100% 对等；负对照可复现 FAIL | 🟡 对等已锁死；**真实案例验收待补**（`docs/specs/M1-why.md` §3） |
| **M2** | `why` 归因 | `dsh-triage why`：拒绝行 / import 失败 / 能力缺失 + 修复命令 | 在真实「工具消失」案例上一次命中根因 | — |
| **M3** | 隔离实测 | `probe`：独立 `DSH_HOME` 装候选 → boot/http/inventory/namespace-diff | 单次 ≤20s；失败自动清理；默认 dry-run | — |
| **M4** | 分发 1.0 | Web 面板（`settings.plugins.tab`）+ 徽章 + format-1 索引源 + `plugin_fit` 工具 | 上架 dsh-plugin-catalog / hub / dsh.so；2 渠道收录 | — |
| **M5** | 回流 | opt-in 匿名结果上传 + 群体先验 + 时间序列回归 | 数据可用率 ≥80%；无 PII | — |

**回滚**：任一污染 → 以 tag + `backup/snapshots/` 恢复，新提交覆盖，禁改历史。

---

## 决策检查三问

1. 是否让用户在「装之前」少犯一次错，或在「坏了之后」少花 30 分钟？
2. 是否产生上游结构上拿不到的数据（组合 / 归因 / 时间序列）？
3. 是否服务下载量增长或分发位获取？

三否 → 立即终止该任务。
