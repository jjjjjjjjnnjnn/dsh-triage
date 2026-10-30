# DSH-Addition AGENTS.md

> **产品名**: **dsh-triage**（品牌：分诊台 / Triage）｜**仓库**: `https://github.com/jjjjjjjjnnjnn/dsh-triage`（public）｜**npm**: `dsh-triage@0.2.0`（registry 现值）· manifest 已升 **0.3.0，等 HUMAN `npm publish`**（R48）｜**Stand**: R49 (2026-10-30)｜**定位（R47 重定向）**：正门从「通用检查器」改成「**升级日**」——每次 rc 发布回答「**你这套已装集合**升上去会坏什么」；**R48 已交付「陌生人 60 秒」四项**（`--to next` / 无参数引导 / 卡片落盘 / README 首屏）；**R49 修好「打开就有一屏答案」**（无参 = `status`、`audit` 摘要优先、面板首屏 + `docs/SECURITY.md` + 11 条对抗性测试） | M0 ✅（9 门 / 9-9 · **477 测试**）· M1 ✅（27 金标 / D1 9-10）· M2 ✅ · M3 ✅（R14–R37，稳定性有分布）· M4 ✅（面板 / 徽章 / 索引源 / Agent 工具）· M5-a 本地半边 ✅（R41）· M5-b ✅（R42/R44）· **M6 升级日 ✅ 入口四项（R48），出口 = D5 待判**（细节以 `docs/HANDOFF.md` §2 为准）
> **Mission**: 在 DSH 生态里做「升级日」的判断层——每次 rc 发布，回答「**你这套已装集合**升上去会坏什么、怎么修」，再把同一份结果做成市场 / 索引源 / CI 能直接消费的数据 | **Root**: `DSH-Addition`（仓内相对路径；本机绝对路径见 `docs/07-environment.md`）
> **上游**: DeepSeek Harness（`@deepseek-ai/dsh` 0.2.1-rc.2，本机 profile 实测 0.1.0-rc.6） | **Node**: ≥22.19（本机 v24.15.0） | **pnpm**: 12.15.0
> **接手先读**: `docs/HANDOFF.md` → `PROJECT_RULES.md` → `INDEX.md`（三份即可开工）

---

## 🎯 Mission & Scope

**一句话**：在「装得上」和「跑得对」之间做判断层，**正门是升级日**。

**为什么改（R47，外部取证；证据见 `data/results/market-baseline-2026-10-29T12-20-00.000Z.json`）**：三个产品存在性问题（为什么必须装 / 为什么要有这功能 / 为什么不用别人的）在 R46 之前都没有答案。取证后的结论是——**通用诊断类在这个生态里没有需求形态**：

| 事实 | 数值（`data/results/market-baseline-2026-10-29T12-20-00.000Z.json`，`last-week`） |
|---|---|
| 诊断类目天花板 | 整个品类周下载 **1,988**（`dsh-doctor` 1,175 / `dsh-verify` 462 / `plugin-guard` 196 / `plugin-check` 77 / `dsh-guard` 56 / 其余 12），是市场类（**380,240**）的 **0.52%**、装饰类（**411,844**）的 **0.48%** |
| 我们自己 | `dsh-triage` **无下载记录**（downloads API 404 → 产物写 `downloads_state: no-record`，**不写成 0**）；registry 有 0.2.0 |
| 痛点是真的 | 上游最近 **842** 条 Discussions 里 **414 条是故障（49.2%）**，其中 **278 条零回复（67.2%）** |
| 但形态不对 | 赢家都是「在界面里、开箱可感、零配置、高频」：装饰类合计 411,844、市场类 380,240、能力类 304,666；harness 本体 540,139 |

四条候选路（进别人安装路径 / **升级日** / 作者侧 CI / 承认它不是产品）里，HUMAN 在 R47 选「**升级日当正门**」，出口门禁是可证伪的 **D5**（见 `docs/ROADMAP.md` §2）。

四件上游结构上不做的事（这一层不变）：

1. **归因**：一条命令回答「我的工具为什么不见了」——被 admission 拒绝的行 / import 失败的行 / 声明了但没注册上的能力；
2. **组合判断**：候选插件 × **本机已装集合** 的冲突（entry id / service / tool / command / settings / slot）；
3. **隔离实测**：在独立 `DSH_HOME` 里真装真启动，出 `boot / http / inventory / namespace-diff` 证据；
4. **回流**：opt-in 匿名结果 → 群体先验（唯一不会被上游吸收的资产）。

**明确不做**：不做插件市场/目录、不做启动器、不做通用安全扫描器、不做装/卸/回滚（上游 `plugin_manager` 已接管）、**不做全网公开兼容矩阵**（`dsh.so` 已用 L1–L5 占位，正面撞不过；我们的差异化只有「你的机器 + 你的集合」）。

---

## 📂 Architecture Map

```
DSH-Addition/  (repo: dsh-triage · 品牌：分诊台 / Triage)
├── .agents/                       # Agent 工作框架（交接入口见 .agents/README.md）
│   ├── README.md                  # 三入口 / 角色速查 / 机器校验项
│   ├── roles/                     # researcher / implementer / verifier / reviewer / adversary / arbiter
│   ├── prompts/                   # task-packet / review-packet / handoff-packet
│   └── rules/                     # integrity / reproducibility / agent_collaboration / execution-playbook / adversarial_review
├── .github/workflows/ci.yml       # 门禁 CI（正常 + 负对照 + 发布检查）
├── audit/                         # AI 披露 + 机器强制台账（gate_ledger / blind_spots / step_reviews，tests/governance 校验）
├── backup/BACKUP_POLICY.md        # 快照策略（snapshots/ 同名 + .sha256）
├── _archive/ARCHIVE_MANIFEST.md   # 只进不出归档索引
├── quarantine/                    # 外部产物隔离区（双门制）+ vendor-manifest（许可真相源）
├── sandbox/                       # 仓内 DSH 运行时（git 忽略）：upstream/<ver>/{install,home}，可挂载可删除
├── data/
│   ├── gold/admission-cases.json  # 金标夹具（admission 语义对等基准，人工签署）
│   ├── cases/CASE-*/              # 真实案例：输入 manifest + 机器可算 label + 偏差披露
│   ├── raw/                       # 原始证据（git 忽略重物）
│   └── results/                   # SSOT：脚本真跑 JSON + .sha256
├── docs/
│   ├── HANDOFF.md                 # 交接入口（五分钟检查 / 当前批次 / 第一件事 / 坑）
│   ├── ROADMAP.md                 # 12 周执行计划 + 决策门 + 指标看板
│   ├── BACKLOG.md                 # 可领取任务清单（ID / 角色 / 依赖 / 验收）
│   ├── AI_HANDOVER.md             # 真相源 / 防幻觉规则
│   ├── DESIGN-MAP.md              # 六层架构 + 门与证据矩阵
│   ├── 00-vision.md 01-competitors.md 02-signal-sources.md
│   ├── 03-failure-taxonomy.md 04-admission-semantics.md 05-verdict-contract.md
│   ├── 07-environment.md 08-conventions.md
│   ├── adr/                       # 决策记录（Result 优先 / 覆写不是撞车 / 零依赖门禁 / 外部候选取用边界 / 渲染后端 / 20s 预算口径[proposed]）
│   ├── specs/M0-skeleton.md M1-why.md M2-inventory.md M2-capabilities.md M3-probe.md M4-surface.md M5-upgrade.md M5-reflow.md M6-upgrade-day.md
│   └── market/listing_zh.md       # 上架文案（首屏 = 升级日，R47 起）
├── packages/
│   ├── core/     @dsh-triage/core   # 判断引擎：admission 语义 / env 指纹 / 能力台账 / 相位层 / 副本来源 / dsh.compatibility 与 registry 次要通道 / upgrade 四桶 / verdict 组装（纯函数、可离线）
│   ├── signals/  @dsh-triage/signals# 信号适配器：npm registry / dsh.so / hub catalog / 本机外部工具产物
│   ├── probe/    @dsh-triage/probe  # 隔离实测（M3）：plan 生成 + exec 执行/判定 + host 唯一一份 Host I/O（样本循环：`{error}` 才开替换窗口，ADR-0008 E）+ render 白屏判定（CDP）+ hooks/inventory-hook.mjs
│   └── plugin/   dsh-triage         # 用户安装件：DSH profile bundle + Web 面板（client.js）+ Host 只读路由（host-audit-route.ts）+ Agent 工具 compat_verdict（host-tool.ts + fit.ts，与 check 同一条引擎链；hooks/tool-hook.mjs 只做真机取证）+ bin CLI + probe-run.ts + serve.ts（本地面板）+ audit-data.ts（audit 的纯数据层，CLI 与面板共用）+ summary.ts（一屏答案的纯投影，CLI 与面板共用）
├── scripts/                       # 门禁（gate_*，9 门）+ 真跑落盘（scan_env / record_case / record_audit / record_registry / record_probe / record_render_fixture / record_serve_smoke / render_inventory / d1_report / probe_live_sample / bootstrap_upstream / record_upgrade_impact / record_market_baseline）
├── tests/                         # node:test + TS（admission / verdict / ledger / governance）
├── AGENTS.md / PROJECT_RULES.md / INDEX.md / COMPLIANCE.md / LICENSE(MIT)
└── package.json / pnpm-workspace.yaml / tsconfig*.json / .npmrc / .editorconfig
```

---

## ⚡ Standard AI Agent Workflows

### 0. 接手必读
先读 `docs/HANDOFF.md`（五分钟检查 + 当前批次 + 第一件事）→ `PROJECT_RULES.md` → `INDEX.md`，再动任何文件。

### 1. 跑全链（提交前必跑）
```powershell
pnpm install
pnpm run verify     # build → typecheck → test → gate
```

### 2. 单独跑门禁
```powershell
node scripts/gate.mjs            # 全部门
node scripts/gate.mjs --fast     # 跳过需要构建产物的门
node scripts/scan_env.mjs        # 真扫本机 DSH profile → data/results/*.json + .sha256
node scripts/record_market_baseline.mjs --stamp <ISO>   # 市场基线（R47）：npm 下载 + Discussions 痛点分布 → SSOT
```

### 3. 流程分级（R47 起，HUMAN 批准）

零用户阶段按「有没有动判据」分级，**只降审核成本，不降证据要求**：

| 轮型 | 触发 | 必须做 | 可跳过 |
|---|---|---|---|
| **判据轮** | 动 `admission.ts` / 冻结阈值 / `data/gold/` / verdict 契约 / 任何 `conclusion` 的计算 | 四轴 review + 对抗性反例 + `step_reviews.json` 每步一条 + 真跑产物 + `gate.mjs --mutate` | 无 |
| **交付轮** | 只动文档 / 文案 / 分发 / 新增渲染（不改判据） | 1 次真跑产物（`data/results/` + sha256）+ 1 个 verifier 复算 + 轮末一条汇总台账 | 四轴并行 review、per-step 台账、对抗性小节 |
| **采证轮** | 只读外部数据（npm / GitHub API）并落快照 | `produced_by` + `generated_at` + 原始快照进 `data/fixtures/`（离线可复算） | 负对照（没有门可骗） |

红线：**进入 `data/results/` 的任何数字仍必须由脚本产出、带 sha256、可离线重算**；改判据永远走判据轮。

### 4. 合规检查
- 新结论进 `data/results/` 必须由 `scripts/` 真跑，禁手填；`gate_ssot` 会检查 `produced_by`；
- 外部插件产物（tarball/源码）只进 `quarantine/`，禁直读直跑；
- 非人类手写模块记入 `audit/AI_DISCLOSURE_LOG.md`；
- 每条结论必须带证据等级（`declared/measured-*/scanned/inferred`），无证据只能出 `unknown`。

---

## 关键工程约定

- **TypeScript ESM**，包内相对导入必须写 `.js` 后缀；`erasableSyntaxOnly` 打开以保证 `node --test` 可直接跑 TS。
- **零门禁依赖**：`scripts/gate_*.mjs` 只用 Node 内置模块，任何情况下不得因缺依赖而失效（门禁必须永远能跑）。
- **失败即失败**：门禁返回非 0 必须修根因，禁放宽阈值；阈值变更需 spec + HUMAN-SIGN。
- **本机 DSH 只读**：任何代码不得写 `~/.dsh`（除 `probe` 在独立 `DSH_HOME` 下操作），`probe` 默认 dry-run。

---

## 🤝 Agent 协作与交接（随时可换人）

**入口**：`.agents/README.md`｜**交接**：`docs/HANDOFF.md`｜**任务**：`docs/BACKLOG.md`｜**计划**：`docs/ROADMAP.md`

### 常设角色（`.agents/roles/`）

| 角色 | 干什么 | 禁区 |
|---|---|---|
| Researcher | 卡住先外部取证（≥2 角度），结论带 A/B/C 证据等级 | 禁写实现代码 |
| Implementer | 按 spec 写码，先写断言 | 禁改判据/阈值、禁跳门禁 |
| Verifier | 独立上下文、只看产物复算 | 禁看实现过程、禁复述他人的结论 |
| Reviewer ×4 | 正确性 / 可复现 / 合规许可 / SSOT 一致，各报各轴 | 禁跨轴改结论、禁只报「看着没问题」 |
| Adversary | 专门证明「这个门可以被骗过」 | 禁以「没找到反例」代替构造 |
| Arbiter（主会话） | 仲裁矛盾、出最终 verdict、写交接包 | 禁跳过任一轴直接放行 |

### 并发硬边界

- **同文件 / 同主题禁并行写**；只读审核可按轴并行；
- 有依赖顺序的任务由主会话管依赖图，前序报告齐才起后序；
- 每个 subagent 只给最小任务包（`.agents/prompts/task-packet.md`），返摘要（verdict + ≤10 条证据）；
- 评审员先独立上报，**禁互相参考后再改结论**（防串谋）。

### 每轮固定节律

```
判据轮：选任务(BACKLOG) → 写 spec(判据+负对照) → 实现+自测 → 四轴 review + 对抗性 → 仲裁
        → pnpm verify + gate --mutate → 落 SSOT(+sha256) → 同步文档 → 交接包(HANDOFF) → commit

交付轮：选任务 → 实现 → 真跑一次产物(+sha256) → 1 个 verifier 复算 → 同步文档 → 一条汇总台账 → commit
```

**R47 起的分级理由**：零用户阶段，先让「第一次接触」发生（见 `docs/ROADMAP.md` D5）。判据轮的重流程不变；分发/文案/采证轮按上表降成本，但**证据要求不变**。

### 机器强制的框架完整性

以下缺一即红（`gate_governance` + `tests/governance`）：

1. 每个角色卡含 `## 输入 / ## 输出 / ## 禁区 / ## 验收`；
2. 每个模板含 `## 模板`；
3. `AGENTS.md` 链接 `.agents/README.md`；
4. `docs/HANDOFF.md` 含「当前批次」与「下一位 agent 的第一件事」；
5. `audit/AI_DISCLOSURE_LOG.md` 含 SessionID 字段。
