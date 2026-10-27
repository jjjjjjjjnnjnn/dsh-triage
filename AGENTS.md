# DSH-Addition AGENTS.md

> **产品名**: **dsh-triage**（品牌：分诊台 / Triage）｜**仓库**: `https://github.com/jjjjjjjjnnjnn/dsh-triage`（private）｜**Stand**: R9 (2026-10-27)｜M0 ✅（9 门 / 9-9 CAUGHT · 110 测试）· M1 金标对等 ✅ · M1 真实案例验收 **✅ D1 通过：10 例 / 9 命中 / 1 显式 unknown** · M2-a 契约已锁 / **P2 已交付**（`audit --snapshot` + 相位门）/ P1 待真机（`docs/HANDOFF.md` §2 为准）
> **Mission**: 做 DSH 生态里「装之前判断该不该装、装完坏了定位为什么」的判断层，并靠真实失败数据成为默认安装件 | **Root**: `DSH-Addition`（仓内相对路径；本机绝对路径见 `docs/07-environment.md`）
> **上游**: DeepSeek Harness（`@deepseek-ai/dsh` 0.2.1-rc.2，本机 profile 实测 0.1.0-rc.6） | **Node**: ≥22.19（本机 v24.15.0） | **pnpm**: 12.15.0
> **接手先读**: `docs/HANDOFF.md` → `PROJECT_RULES.md` → `INDEX.md`（三份即可开工）

---

## 🎯 Mission & Scope

**一句话**：在「装得上」和「跑得对」之间做判断层。

核心不是「检查声明」（上游 0.1.7 起已内置 install 前声明门，归因见 `docs/01-competitors.md` §3），而是四件上游结构上不做的事：

1. **归因**：一条命令回答「我的工具为什么不见了」——被 admission 拒绝的行 / import 失败的行 / 声明了但没注册上的能力；
2. **组合判断**：候选插件 × **本机已装集合** 的冲突（entry id / service / tool / command / settings / slot）；
3. **隔离实测**：在独立 `DSH_HOME` 里真装真启动，出 `boot / http / inventory / namespace-diff` 证据；
4. **回流**：opt-in 匿名结果 → 群体先验（唯一不会被上游吸收的资产）。

**明确不做**：不做插件市场/目录、不做启动器、不做通用安全扫描器、不做装/卸/回滚（上游 `plugin_manager` 已接管）。

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
│   ├── 06-roadmap.md 07-environment.md 08-conventions.md
│   ├── adr/                       # 决策记录（Result 优先 / 覆写不是撞车 / 零依赖门禁）
│   ├── specs/M0-skeleton.md M1-why.md M2-inventory.md
│   └── market/listing_zh.md       # 上架文案
├── packages/
│   ├── core/     @dsh-triage/core   # 判断引擎：admission 语义 / env 指纹 / 能力台账 / 相位层 / 副本来源 / dsh.compatibility 次要通道 / verdict 组装（纯函数、可离线）
│   ├── signals/  @dsh-triage/signals# 信号适配器：npm registry / dsh.so / hub catalog / 本机外部工具产物
│   ├── probe/    @dsh-triage/probe  # 隔离实测（M3）：计划生成 + 执行器（独立 DSH_HOME）
│   └── plugin/   dsh-triage         # 用户安装件：DSH profile bundle + Web 面板 + bin CLI
├── scripts/                       # 门禁（gate_*，9 门）+ 真跑落盘（scan_env / record_case / record_audit / render_inventory / d1_report / probe_live_sample / bootstrap_upstream）
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
```

### 3. 合规检查
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
选任务(BACKLOG) → 写 spec(判据+负对照) → 实现+自测 → 四轴 review + 对抗性 → 仲裁
→ pnpm verify + gate --mutate → 落 SSOT(+sha256) → 同步文档 → 交接包(HANDOFF) → commit
```

### 机器强制的框架完整性

以下缺一即红（`gate_governance` + `tests/governance`）：

1. 每个角色卡含 `## 输入 / ## 输出 / ## 禁区 / ## 验收`；
2. 每个模板含 `## 模板`；
3. `AGENTS.md` 链接 `.agents/README.md`；
4. `docs/HANDOFF.md` 含「当前批次」与「下一位 agent 的第一件事」；
5. `audit/AI_DISCLOSURE_LOG.md` 含 SessionID 字段。
