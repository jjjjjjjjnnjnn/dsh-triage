# ROADMAP · 分诊台（dsh-triage）12 周

> **Stand**: R44 (2026-10-29) | 上游基线 `@deepseek-ai/dsh` 0.2.1-rc.2（npm `latest`；`next` = 0.2.1-rc.4，即仓内沙盒）｜品牌：**分诊台 / Triage**｜仓库：`dsh-triage`
> 本文件是**唯一**执行计划（R14 / T-110 起）：判据细节以 `docs/specs/*` 为准；原先并列的 `docs/06-roadmap.md` 已归档到 `_archive/2026-10-28_06-roadmap-merged-into-ROADMAP.md`，其增长阶梯/分发清单/指标并入本文件 §7。

---

## 0. 一句话与增长前提

**产品**：在「装得上」和「跑得对」之间做判断层（归因 / 组合 / 实测 / 回流）。
**增长**：纯产品路径天花板约 **20–30k 周下载**（安全类目第一当前 3.8k）；**总榜第一（175k）必须靠关键路径集成**，所以 BD 与产品并行。

---

## 1. 阶段表（每阶段都有可证伪出口）

| 周 | 阶段 | 交付物 | 出口门禁（可证伪） | 人力 |
|---|---|---|---|---|
| W0 | **M0 骨架** ✅ | 治理 / 9 门 / 引擎 / CLI / SSOT | `verify` 全绿 + 9 门 mutate 全 CAUGHT | 已完成 |
| W1 | **M1 收口** ✅ | 27 条金标（R14 由 21 扩）+ `why` 归因 + 10 例真实案例 | 真实案例 ≥8/10 命中 —— **R6 达成 9/10**（`data/results/d1-*.json`） | 已完成 |
| W2 | **M2-a 运行时台账** | ✅ **P1+P2 已交付**：`pluginInventory` 相位在仓内沙盒真采样（`data/results/inventory-live-2026-10-27T22-00-00.000Z.json`，194 行）+ `audit --snapshot` + 门 `inventory-contract` + preset 维度（T-112）；tools/commands/settings 快照：T-202b 事实+差分 ✅（R13），**agent 作用域读数**归 T-202a（需真实会话/M3） | `audit` 能显示每行相位；与 patch 静态声明交叉校验（真机 `missing=0`，Host↔CLI 逐行一致） | 1 |
| W3 | **M2-b 归因增强** | 读 stderr / 事故报告，把 import/apply 失败归到行 | 3 类真实故障（import 失败 / apply 抛错 / 服务冲突）都能点名 | 1 |
| W4 | **M3 probe 执行器** | ✅ **R14 交付执行器（T-301）**；✅ **R15 补判据**：白屏可判（T-302，真浏览器 + CDP）+ 就绪来自 Host 自打印 URL（T-306）+ 真实 registry 分母（T-305：install 5.4s / boot 7.7s）；✅ **R22 补「我的组合」**（T-304：`--copy-profile`，复制声明 → 装依赖 → 装候选 → boot，三形状真机）；**R37 有载对照**：`--load 8`（58–62% CPU）把 `boot→sample` 中位数 4.9s → 7.4s，两条件都没越过 20s；`namespace-diff`（T-303）仍未测 | `boot→sample ≤20s`（R14 11.7–19.9s，R15 7.7–8.7s，R22 复制模式 7.4s，**R37 空载 4.9s / 有载 7.4s 中位**）；「装了就白屏」两形状稳定复现（phase=failed / null）+ 白屏检测有红/绿对照；失败必清理（目录 + 全部端口） | 2（并行） |
| W5 | **M4-a 面板** | `settings.plugins.tab` 面板：结论卡 + 证据 + 修复按钮。**R26：只读契约 spike 完成**（`docs/specs/M4-surface.md` §3.1 的 C1–C6：`settings.plugins.tab` 插槽 / `ctx.slots.register` / props 由 `inject` 提供 / `remote.pluginInventory.list()` 形状 / `ctx.effect`+`locale`），**`client.js` 未写** | 面板能看到与 CLI 同源的结论（复用 messageId） | 2 |
| W6 | **M4-b 分发件** | ✅ **三件交付：徽章 SVG（T-402 · R34）+ format-1 索引源（T-403 · R34，用上游校验器验证）+ `compat_verdict` Agent 工具（T-404 · R36，真机三形状 + 八步回归；R40 补 ptc 折叠真机）**。索引源已于 R38 托管到公开 URL（repo raw 为首选、gist 备份，逐字节校验）；**仍剩人工动作**：在 Discover UI 里真的添加一次 | 索引源可在 Discover 添加（**要求一次发布动作**）；徽章可按 插件×dsh×os 渲染 | 2 |
| W7 | **M5-a 回流** | opt-in 匿名 outcome + 本地先验 | 上传可关闭、可删除；0 PII；数据可用率 ≥80% | 1 |
| W8 | **M5-b 升级日** | 升级影响清单生成器（给定目标 dsh 版本）。**R42 交付**四桶分区；**R44 补齐最后两块**：`improved` 有真机见证（策展混合组合，四桶非空）与 registry 成功分支 | 新 rc 发布 24h 内可产出全量已装集合的影响清单 | 1 |
| W9 | **1.0 候选** | 文档 / 上架文案 / 兼容矩阵公开页 | `gate_release --publish` 绿 + 2 渠道收录 | 2 |
| W10–W12 | **增长冲刺** | 案例帖 ×5、作者徽章推广、渠道提交、Discord/微信群答疑 | 周下载 ≥3,000（类目第一）；索引源 ≥300 | 2 |

---

## 2. 决策门（不达标就停/改，不硬推）

| 门 | 时间点 | 判据 | 不达标怎么办 |
|---|---|---|---|
| **D1 真实价值** | W1 末 | `why` 在真实案例上一次命中（人工标注 10 例，≥8 命中） | 说明「归因」不成立 → 回到 F2/F3 重新选切入点，**不进入 M2** |

> **D1 现状（R6，2026-10-26）**：**已通过**。真实案例 **10 例 / 9 命中 / 1 有意 miss**（miss = CASE-7590：两个插件都不声明 `@deepseek-ai/dsh*` peer，失败在运行期 API 漂移；它们其实写了 `dsh.compatibility` / `dshReleases`，是我们**尚未读**的通道，见 `BS-13` / T-108，因此这是「我们的信息通道不全」而不是「声明层天花板」）。判定可重算：`node scripts/d1_report.mjs` → `data/results/d1-2026-10-26T12-00-00.000Z.json`（`gate.passed=true`，`totals.hit_rate=0.9`）。**M2 已解锁**：T-201 可开工；T-107（无声明行不得静默）与 T-109（dist-tag 失步信号）是本轮直接产出的需求。
>
> **口径限制（独立复核发现，`BS-14` / T-111）**：这 9 个命中是**机器可复算**的（label 与 verdict 一致、输入可重放），但 label 目前由实现方自写自签，尚未满足本行原话「人工标注」。对外只能说「机器可复算的命中率 9/10」。
| **D2 实测可行性** | W4 末 | **判定看可靠性**（一次跑完 = 有产物 + 清理干净 + boot 在预算内 + 说出结论，`unknown` 也算说出结论）≥90%；单次 ≤20s；失败必清理；真实启动 ≥10 次、失败形状 ≥5 种。**另外单列产品数字** `real_pass_rate = go/(go+blocked)`（`unknown` 既不算成功也不算失败） | 降级为「只做静态 + 人群数据」，probe 变可选实验特性 |
| **D3 分发意愿** | W6 末 | 至少 2 家（catalog / hub / dsh.so / launcher）愿意收录或对接 | 转「纯工具 + 内容营销」，重新评估总榜目标 |
| **D4 数据价值** | W8 末 | **先验与后测的一致率**（`ADR-0011` A 案，2026-10-29 代签）：同一精确键（`包@版本` + dsh 版本 + OS/arch + node major + profile kind）上，此前记录的先验与本次本机测量的一致率；`pairs ≥ 30` 且 Wilson 下界 ≥ 0.80 才算先验有用，不足即 `insufficient-pairs`。**不再用「命中率差 ≥10pp」**——先验不许改结论，那个差值恒为 0 | 砍掉回流的产品化投入，专注本地判断 + 分发（先验只保留 `--explain` 注解） |

> **D2 判定（R18，2026-10-27）：通过（feasibility），产品数字单列。** 证据 `data/results/d2-2026-10-27T21-00-00.000Z.json`（由 `scripts/d2_report.mjs` 从矩阵产物重算，`gate.passed=true`）：
> - **可靠性 17/17 = 100%**（≥90%）：17 次运行全部产出产物、清理 17/17、有样本的 13 次 boot 6.2–19.1s 全在 20s 内、结论齐全（含 1 次诚实的 `unknown`）；
> - **真实启动 10 次**（≥10），**失败形状 5 种**（≥5）：安装失败 / 行 failed / 行无 fiber / 零行 / 树未 settle；
> - **产品数字**：真实候选 **9/10 = 90%** 为 `go`（Wilson 95% **0.596–0.982**），唯一的失败是 `@aiwayds/dsh-cron@0.6.1` **装不上**（产物只有 exit 1，原因归 `T-310`）。
>
> **口径警告**：这 10 个候选是**手挑的便利样本**（npm 搜索 + pin 版本），不是生态随机抽样；90% 只说明「这一批在这台机器/这个沙盒运行时上能装能起」，不等于「插件都能用」。D2 的通过只回答「probe 这件事能不能稳定跑」。
>
> **D2 复算（R19，2026-10-28）：仍通过，分母 10 → 13，且预算口径按 HUMAN 签署收窄。** 证据 `data/results/d2-2026-10-28T12-10-00.000Z.json`（`gate.passed=true`）：
> - **真实 13 个候选**（+`@lolkda/dsh-skills-manager@0.3.1` / `dsh-unlag@1.12.5`（只声明 `engines.dsh`）/ `@tencent-connect/dsh-qqbot@0.5.3`）：**12 `go` / 1 `blocked`**，通过率 **12/13 = 0.923**，Wilson 95% **0.667–0.986**；
> - **可靠性 20/20 = 100%**、清理 20/20、失败形状 **6 种**；
> - **口径修正（`audit/SIGNOFF.md` R19）**：`boot-budget` 只对**真实候选**判定——一棵永不 settle 的树要 `boot(≈5s)+settle 上限 15s≈21s`，结构上不可能进 20s（R18 的 19.1s 是运气）。真实候选仍是 100% 必须达标；夹具的 21.3s 原样单列在 `timing.fixtures_over_budget`。
> - **R26 收窄（`ADR-0008` E）**：`settled:false` 样本不再等替换窗口 → 不可判的 `boot` 步 48.4s → 28.6s（`probe-adr0008e-overrun-*`）；默认 `--unsettled-timeout 20000` 与 `settle 15s` **仍未动**，所以「不可判的一次探针也 ≤20s」仍不成立（`BS-28` / T-311 部分解除，T-312 未开）。`d2_report` 用现有矩阵复算仍 `gate.passed=true`（`data/results/d2-2026-10-28T23-00-00.000Z.json`），产品数字不变：真实 12/13 `go`，Wilson 0.667–0.986。
>
> - **R27 post-E 矩阵重测：D2 `gate.passed=false`（第一次真红）。** 证据 `data/results/d2-2026-10-29T01-30-00.000Z.json`（n=20 / 真实 13 / 清理 20-20 / 失败形状 6 / `expectation_misses=0`）：
>   - **可靠性 19/20 = 95%**（≥90% 仍 PASS）；**失败形状 6**（PASS）；**清理 20/20**（PASS）；
>   - **`boot-budget` FAIL：11/12 真实采样 run 在 20s 内** —— 超时的是 `real-mcp-connector`（`boot→sample` **22.5s**，hook `wait_ms` 16.2s）。
>   - **根因（同一条候选连跑三次的隔离复测）**：`dsh-mcp-connector@0.2.83` 的 `wait_ms` = 10.6 / 16.2 / 18.0s，`boot→sample` = **16.0 / 22.5 / 23.8s** —— 同 pin、同机器、同运行时，两次跨过 20s。**这不是 E 造成的**（`replacement_waited=false`，E 只动样本之后的等待），而是 `boot(≈4–5s) + settle(≤15s)` 的结构与 20s 预算**重叠**（`BS-28` 从「夹具问题」升级为「真实候选问题」，`BS-32` 是它的抖动面）。
>   - **没有做的事**：没有为了让 D2 变绿去放宽 `boot-budget`、也没有删掉那条 run。三条出路（保 15s / 压到 10s / T-312 两阶段）都要 HUMAN 签，见 `docs/adr/0008` §剩余项。
>
> - **R29 按 T-312 新口径重跑：D2 `gate.passed=true`（两批）。** 证据 `data/results/d2-2026-10-28T09-20-00.000Z.json`（批次 A）与 `data/results/d2-2026-10-28T10-20-00.000Z.json`（批次 B，`--strict` exit 0），源矩阵 `probe-matrix-2026-10-28T08-40-00.000Z.json` / `probe-matrix-2026-10-28T09-40-00.000Z.json`：
>   - 两批都是 n=20 / 真实 13 / 清理 20-20 / 失败形状 6 / `expectation_misses=0`；`boot-budget` **12/12**（`boot→sample` 4.6–9.8s 与 4.0–5.5s）；可靠性 20/20；产品数字仍是真实 **12/13 `go`**（Wilson **0.667–0.986**）。
>   - **R27 的红不撤销**：那是旧口径（预算判最终样本）下的真实历史，产物原样保留。**`BS-32` 仍 open**：同一 `dsh-mcp-connector@0.2.83` 在 R27 是 22.5s、R28 两次 `unknown`、R29 两批 8.0s / 5.5s（`go`）——本轮只是「这两批没踩线」，不是「稳定了」。
>   - **D2 的自动化接口**：`scripts/d2_report.mjs --strict`（T-317，R29）在判定失败时 exit 1，且产物与 `.sha256` 先落盘；默认模式仍 exit 0（R18 决定）。
>
> **Kill criteria**：D1 与 D2 同时不达标 → 停止投入，把已有引擎作为 `dsh-doctor` 式小工具维护，不追总榜。
>
> **D4 口径变更（2026-10-29，`ADR-0011` A 案代签）**：原判据「有先验 vs 无先验的命中率差 ≥10pp」与
> 「次要证据永不改结论」结构冲突（先验不改结论 ⇒ 差值恒为 0），已改成**可计算的一致率**（见上表）。
> 记账：`audit/SIGNOFF.md`（HUMAN 原话「你自己分析研究进行，我全部同意」，未逐条复核，**可撤销**）；
> 这个改动只动判据口径，不动任何阈值、不新增证据 tier，也不允许先验进入 `conclusion`。

---

## 3. 分发时间线（与产品并行，不等做完）

| 周 | 动作 | 产出 |
|---|---|---|
| W1 | 注册 npm 名 `dsh-triage`；建立 GitHub private → **2026-10-29 已转 public（HUMAN 决定，见 `audit/AI_DISCLOSURE_LOG.md` R38 追加）** | 仓库公开可读；npm 发布仍未做（registry 404） |
| W2 | 写 3 篇中文案例帖（消失的工具 / 白屏 / 升级后起不来） | 社区曝光第一批 |
| W4 | 提交 dsh 社区插件索引：**`zhu1090093659/dsh-community-plugins` PR #65**（`community.json` +12/-0，用其自带校验器验证） | 已提交待审；合并后 dsh-market 商店自动收录 |
| W5 | **`awesome-deepseekharness/awesome-deepseek-harness` PR #193**（README +1/-0）已提交待审；**R40：npm 已发布** `dsh-triage@0.1.0`（+3 个 `@dsh-triage/*` 内部包），匿名安装验证通过，dsh.so 转 `ready` | 一条待审（#193 `APPROVED`，等维护者合并）、一条待填表 |
| W6 | **format-1 索引源已发布**：仓库 raw URL（首选，跟着分支走）与 public gist（备份），两条都逐字节校验过 | 无需安装即可被使用（Discover 里添加仍是一次人工动作） |
| W7 | 作者徽章上线，主动联系 10 个头部插件作者 | 徽章进入 README |
| W8 | 升级日预案：每次 rc 发布 24h 出清单 | 周期性流量峰 |
| W9–W12 | 拉 2 家关键路径集成（dshmarket / launcher / Desktop） | 冲总榜的必要条件 |

---

## 4. 指标看板（每周五更新）

| 指标 | 目标（W12） | 采集方式 |
|---|---|---|
| npm 周下载 | ≥3,000 | npm downloads API |
| 类目排名 | 安全/兼容类第一 | dsh.so npm 榜 + 自采 |
| `why` 命中率（人工标注 30 例） | ≥80% | `data/results/cases-*.json` |
| 徽章曝光 | ≥5,000/月 | 徽章服务日志（M4） |
| 索引源添加 | ≥300 | 索引源请求 UV |
| `compat_verdict` 调用 | ≥2,000/周 | Agent 工具遥测（opt-in） |
| 误判投诉 | 0 起未修复 | issue 标签 `false-positive` |

---

## 5. 每周固定节律

| 时点 | 动作 | 产出 |
|---|---|---|
| 周一 | 选任务（`docs/BACKLOG.md`）+ 写 spec | spec 草案 |
| 周二–周四 | 实现 + 自测 + 负对照 | 提交 |
| 周四晚 | 四轴 review + 对抗性审核 | findings |
| 周五 | 仲裁 + 门禁全绿 + 交接包 + 周报（指标看板） | `docs/HANDOFF.md` 更新 |

---

## 6. 风险与对策（触发器口径与 §7.4 一致，此处只列产品侧）

| 触发器 | 应对 |
|---|---|
| 上游发布「诊断/失败史」 | 立即把我们的 verdict 契约公开，转为**数据与归因提供方**；接入其 UI |
| dsh.so 扩到本机组合 | 主动对接，做它的「本机执行端」；我们保留离线/企业场景 |
| probe 被质疑执行不可信代码 | 默认 dry-run；显式 `--execute` + 沙盒路径证明 + 不提供安全背书 |
| 早期误判导致口碑崩塌 | 四态 + `unknown` + 证据 tier；48h 内修 + 公开复盘（ADR） |

---

## 7. 增长与分发（R14 合并自 `06-roadmap.md`，T-110）

### 7.1 下载量阶梯（诚实版）

| 阶段 | 现实区间（周下载） | 必须为真 | 主要动作 |
|---|---|---|---|
| A | 0 → 500 | `why` 在真实案例上一次命中 | 中文社区发案例帖：不讲架构，讲「我帮你找回消失的工具」 |
| B | 500 → 3,000 | 进入 `dsh-plugin-catalog` + omdsh hub + 两个 awesome 列表 | 类目第一（当前 3,792）靠覆盖矩阵赢，不靠功能数 |
| C | 3,000 → 20,000 | 徽章开始自传播（作者愿意挂）+ 索引源被添加 | 作者侧运营：徽章 → README 曝光 → 用户安装 |
| D | 20,000 → 100,000 | 被 `dshmarket` / launcher / Desktop 中至少一家**当作信任层嵌入流程** | BD 从 W1 起并行，不等产品做完 |
| E | 100,000+ | 成为默认安装路径的一部分 | 只有 D 成功才可能 |

> **诚实结论**：纯产品路径的现实天花板约 **20–30k**（类目第一 + 3–5 倍）。**总榜第一（175k）需要一次关键路径集成**，本质是分发结果。所以路线把 BD 放在第一周，而不是最后。

### 7.2 分发清单（按执行顺序）

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

### 7.3 指标（领先 + 滞后）

| 指标 | 类型 | 目标（M4 后 30 天） |
|---|---|---|
| `why` 根因命中率（人工标注 30 案例） | 质量 | ≥80% |
| 徽章曝光（shields 风格请求数） | 领先 | ≥5,000 |
| 索引源添加数 | 领先 | ≥300 |
| `compat_verdict` 调用次数 | 领先 | ≥2,000/周 |
| npm 周下载 | 滞后 | ≥3,000（类目第一） |

### 7.4 关键风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 上游补上诊断/失败史（已列 deferred） | 高 | 只赚数据与归因；先公开契约；把产品做成别人的信号源 |
| dsh.so 扩到「本机组合」 | 中 | 主动把其 API 当 S4 并署名；我们做它进不去的半边（本机/企业/离线） |
| probe 成本与安全争议 | 中 | 默认 dry-run、显式 `--execute`、明确不提供安全背书 |
| 误判一次口碑崩塌 | 中 | 四态 + `unknown` + 证据 tier；金标锁死语义 |
| 与上游行 id / 服务名撞车 | 中 | `compat-` 前缀 + `gate_namespace`（R14 起含 `rows-are-inserted`） |
