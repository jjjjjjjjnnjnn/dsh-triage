# 06 · 路线图（含下载量阶梯与分发动作）

> **Stand**: v0.1.0-skeleton (2026-10-26) | 状态以 `PROJECT_RULES.md` 的 Roadmap 表为准

## 1. 里程碑

| 阶段 | 周 | 交付 | 出口门禁（可验收） |
|---|---|---|---|
| **M0 骨架** ✅ | W0 | 目录、治理、6 道门禁、pnpm 工作区、core/signals/probe/plugin 可构建 | `pnpm run verify` 全绿；6 门在 `--mutate` 下**全部能 FAIL**（负对照） |
| **M1 admission 对等** | W1 | `core/admission` + 21 条金标（13 synthetic + 8 real）+ `scan_env` 真跑 SSOT | 金标 100% 对等；`data/results/why-*.json` 落盘带哈希 |
| **M2 `why` 归因** | W2 | 被拒行 / import 失败 / 能力缺失 + 修复命令；S2 运行时台账接入 | 在真实「工具消失」案例上**一次命中根因**（见 `specs/M1-why.md` 判据） |
| **M3 隔离实测** | W3–W4 | `probe` 执行器：独立 `DSH_HOME`、boot/http/render/inventory/namespace-diff、失败清理 | 单次 ≤20s；能稳定复现一个「装了就白屏」的案例；默认 dry-run |
| **M4 面板 + 分发** | W5–W6 | Web 面板（`settings.plugins.tab`）+ `compat_verdict` Agent 工具 + 作者徽章 + format-1 索引源 | 上架 `dsh-plugin-catalog` / hub / dsh.so 中 ≥2 渠道 |
| **M5 回流** | W7–W8 | opt-in 匿名 outcome 上传 + 群体先验 + 版本回归检测 | 数据可用率 ≥80%；0 PII；可在关闭后完全删除 |

## 2. 下载量阶梯（诚实版）

| 阶段 | 现实区间（周下载） | 必须为真 | 主要动作 |
|---|---|---|---|
| A | 0 → 500 | `why` 在真实案例上一次命中 | 中文社区发案例帖：不讲架构，讲「我帮你找回消失的工具」 |
| B | 500 → 3,000 | 进入 `dsh-plugin-catalog` + omdsh hub + 两个 awesome 列表 | 类目第一（当前 3,792）靠覆盖矩阵赢，不靠功能数 |
| C | 3,000 → 20,000 | 徽章开始自传播（作者愿意挂）+ 索引源被添加 | 作者侧运营：徽章 → README 曝光 → 用户安装 |
| D | 20,000 → 100,000 | 被 `dshmarket` / launcher / Desktop 中至少一家**当作信任层嵌入流程** | BD 从 W1 起并行，不等产品做完 |
| E | 100,000+ | 成为默认安装路径的一部分 | 只有 D 成功才可能 |

> **诚实结论**：纯产品路径的现实天花板约 **20–30k**（类目第一 + 3–5 倍）。**总榜第一（175k）需要一次关键路径集成**，本质是分发结果。所以路线把 BD 放在第一周，而不是最后。

## 3. 分发清单（按执行顺序）

| # | 渠道 | 动作 | 负责人 |
|---|---|---|---|
| 1 | npm | 包名 `dsh-triage`（已确认未被占用）；keywords 含 `dsh-plugin` / `compat` / `diagnostics` | HUMAN（发布） |
| 2 | `dsh-plugin-catalog`（dshmarket 目录，format-1） | 提 PR 收录 | Agent 起草 |
| 3 | `omdsh-dev/dsh-hub-workshop` catalog | 提 PR 收录 | Agent 起草 |
| 4 | dsh.so 提交 | 走其提交入口，拿 L4/L5 与安全档 | Agent 起草 |
| 5 | awesome 列表（`0xsline`、`imsai-sh`） | 各提 1 条 | Agent 起草 |
| 6 | 自建 format-1 索引源 | 个性化推荐（按 dsh 版本 + OS + 已装集合过滤） | M4 |
| 7 | 作者徽章 | `![triage](https://…/badge/<pkg>.svg)` 可嵌入 README | M4 |
| 8 | Agent 工具 | `compat_verdict` 让 Agent 在装前自查 | M4 |

## 4. 指标（领先 + 滞后）

| 指标 | 类型 | 目标（M4 后 30 天） |
|---|---|---|
| `why` 根因命中率（人工标注 30 案例） | 质量 | ≥80% |
| 徽章曝光（shields 风格请求数） | 领先 | ≥5,000 |
| 索引源添加数 | 领先 | ≥300 |
| `compat_verdict` 调用次数 | 领先 | ≥2,000/周 |
| npm 周下载 | 滞后 | ≥3,000（类目第一） |

## 5. 关键风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 上游补上诊断/失败史（已列 deferred） | 高 | 只赚数据与归因；先公开契约；把产品做成别人的信号源 |
| dsh.so 扩到「本机组合」 | 中 | 主动把其 API 当 S4 并署名；我们做它进不去的半边（本机/企业/离线） |
| probe 成本与安全争议 | 中 | 默认 dry-run、显式 `--execute`、明确不提供安全背书 |
| 误判一次口碑崩塌 | 中 | 四态 + `unknown` + 证据 tier；金标锁死语义 |
| 与上游行 id / 服务名撞车 | 中 | `compat-` 前缀 + `gate_namespace` |
