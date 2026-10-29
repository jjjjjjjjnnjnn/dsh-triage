# DSH-Addition PROJECT_RULES.md（工程铁律）

> **Stand**: R48 (2026-10-29) | **SSOT**: `data/results/`（真跑 JSON + `.sha256`）与 `data/gold/`（人工签署金标）
> **R47 变更范围**：只改 Stand、路线表状态与决策检查（新增第 4 问）；**10 条铁律一字未动**（冻结）。
> **R48 变更范围**：只改 Stand 与 M6 的状态行（把 R48 的四项收口写进路线表）；**铁律仍然一字未动**。

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
11. **每步必审 + 真实模拟测试（机器强制）**：任何一步有产出的改动（代码 / 判据 / 脚本 / 案例 / 文档性结论）完成后，必须①四轴审核（正确性 / 可复现 / 合规许可 / SSOT 一致）+ 对抗性反例，②真跑一次可重算的测试并把产物落 `data/results/`。两条都写进 `audit/step_reviews.json`，由 `scripts/gate_step_review.mjs`（门 `step-review`）重算 sha256 校验：产物被改过、缺一轴、或「只贴 stdout」，门必红。禁事后补写台账。

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
| **M0** | 骨架 | 目录/治理/门禁/pnpm 工作区/core+signals+probe+plugin 空壳可构建 | `pnpm run verify` 全绿；门禁可分别 FAIL（负对照） | ✅ 已交付（现为 **9 门 / 9-9 CAUGHT**） |
| **M1** | admission 对等 | `core/admission` + `data/gold/admission-cases.json`（27 条） | 金标 100% 对等；负对照可复现 FAIL | ✅ 对等锁死；D1 机器可复算 9/10（label 自签，见 `BS-14`） |
| **M2** | `why` 归因 + 运行时台账 | `why` / `audit` 行级归因 + 能力层事实与差分 | 真实「工具消失」案例一次命中根因 | ✅（P3 Remote 与 agent 作用域按 `ADR-0009` A 不做） |
| **M3** | 隔离实测 | `probe`：独立 `DSH_HOME` 装候选 → boot/http/render/inventory | 单次 ≤20s；失败自动清理；默认 dry-run | ✅（`namespace-diff` 仍 `unmeasured`，`ADR-0009` A） |
| **M4** | 分发件 | 面板 / 徽章 / 索引源 / `compat_verdict` / `serve` | 上架渠道收录 | ✅ 交付；**渠道全在别人手里**（`merged 0` / `listed 0`） |
| **M5** | 回流 + 升级清单 | `outcomes`（本地半边）+ `upgrade --to` 四桶 | 数据可用率 ≥80%；无 PII | ✅ 本地半边 + 四桶；上传/聚合待 `ADR-0012` |
| **M6** | **升级日正门（R47 起）** | 市场基线落盘 · `upgrade` 卡片（首行结论 + 可粘贴 markdown + 边界句）· **R48：`--to next` / 无参数引导 / 卡片落盘 / README 首屏** | **D5**：2 周内 reactions ≥10 且外部引用 ≥1 且周下载 ≥20；不达标 → 走「承认它不是产品」 | 🚧 R47 交付卡片（真机 14/14）；**R48 待做 T-806…T-809**（`docs/BACKLOG.md`） |

**回滚**：任一污染 → 以 tag + `backup/snapshots/` 恢复，新提交覆盖，禁改历史。

---

## 决策检查四问

1. 是否让用户在「装之前」少犯一次错，或在「坏了之后」少花 30 分钟？
2. 是否产生上游结构上拿不到的数据（组合 / 归因 / 时间序列）？
3. 是否服务下载量增长或分发位获取？
4. **（R47 新增）如果有人不装我们，他会怎么办？** —— 若「重装 / 回滚 / 发帖问人 / 直接问 agent」已在 30 秒内解决，则本功能不成立，别做。

**前三问任意两否 → 终止**；**第 4 问答案是「不用我们也能过」→ 必须换交付形态（进别人路径 / 换触发时刻），而不是加功能。**
（依据：R47 实测诊断类目周下载天花板 **1,988** vs 市场类 **380,240**；`dsh-triage` **无下载记录**。证据 `data/results/market-baseline-2026-10-29T12-20-00.000Z.json`。）
