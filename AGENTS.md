# DSH-Addition AGENTS.md

> **Stand**: v0.1.0-skeleton (2026-10-26)｜M0 骨架 ✅（41 测试 / 6 门全绿 / 负对照 6/6 CAUGHT）· M1 admission 对等 ✅（21 条金标）· M1 真实案例验收 🟡 | **Mission**: 做 DSH 生态里「装之前判断该不该装、装完坏了定位为什么」的判断层，并靠真实失败数据成为默认安装件 | **Root**: `DSH-Addition`（仓内相对路径；本机绝对路径见 `docs/07-environment.md`）
> **上游**: DeepSeek Harness（`@deepseek-ai/dsh` 0.2.1-rc.2，本机 profile 实测 0.1.0-rc.6） | **Node**: ≥22.19（本机 v24.15.0） | **pnpm**: 12.15.0

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
DSH-Addition/
├── .agents/rules/                 # 协作与质量规则（integrity/reproducibility/agent_collaboration/execution-playbook）
├── .github/workflows/ci.yml       # 门禁 CI（verify 全链）
├── audit/                         # AI 披露 + 机器强制台账（gate_ledger / blind_spots，tests/governance 校验）
├── backup/BACKUP_POLICY.md        # 快照策略（snapshots/ 同名 + .sha256）
├── _archive/ARCHIVE_MANIFEST.md   # 只进不出归档索引
├── quarantine/                    # 外部产物隔离区（双门制）+ vendor-manifest（许可真相源）
├── data/
│   ├── gold/admission-cases.json  # 金标夹具（admission 语义对等基准，人工签署）
│   ├── raw/                       # 原始证据（git 忽略重物）
│   └── results/                   # SSOT：脚本真跑 JSON + .sha256
├── docs/
│   ├── AI_HANDOVER.md             # 接手清单（真相源/冻结区/防幻觉）
│   ├── DESIGN-MAP.md              # 六层架构 + 门与证据矩阵
│   ├── 00-vision.md 01-competitors.md 02-signal-sources.md
│   ├── 03-failure-taxonomy.md 04-admission-semantics.md 05-verdict-contract.md
│   ├── 06-roadmap.md 07-environment.md
│   ├── specs/M0-skeleton.md M1-why.md
│   └── market/listing_zh.md       # 上架文案
├── packages/
│   ├── core/     @dsh-triage/core   # 判断引擎：admission 语义 / env 指纹 / 能力台账 / verdict 组装（纯函数、可离线）
│   ├── signals/  @dsh-triage/signals# 信号适配器：npm registry / dsh.so / hub catalog / 本机外部工具产物
│   ├── probe/    @dsh-triage/probe  # 隔离实测（M3）：计划生成 + 执行器（独立 DSH_HOME）
│   └── plugin/   dsh-triage         # 用户安装件：DSH profile bundle + Web 面板 + bin CLI
├── scripts/                       # 门禁（gate_*）+ 真跑落盘（scan_env）
├── tests/                         # node:test + TS（admission / verdict / ledger / governance）
├── AGENTS.md / PROJECT_RULES.md / INDEX.md / COMPLIANCE.md / LICENSE(MIT)
└── package.json / pnpm-workspace.yaml / tsconfig*.json / .npmrc / .editorconfig
```

---

## ⚡ Standard AI Agent Workflows

### 0. 接手必读
先读 `docs/AI_HANDOVER.md` + `PROJECT_RULES.md` + `INDEX.md`，再动任何文件。

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
