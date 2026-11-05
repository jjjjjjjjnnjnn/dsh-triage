# dsh-triage · 本地插件兼容分诊台

**面向 DeepSeek Harness 的本地插件诊断与升级预检工具**

[![npm version](https://img.shields.io/npm/v/dsh-triage.svg)](https://www.npmjs.com/package/dsh-triage)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node: >=22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen.svg)](https://nodejs.org)
[![dsh compatibility](https://img.shields.io/badge/dsh->=0.2.0--rc.1%20<0.3.0--0-blue.svg)](packages/plugin/package.json)
[![tests: 821 passed](https://img.shields.io/badge/tests-821%20passed-success.svg)](scripts/gate.mjs)

[English Overview](#english-overview) | [English README](README.md) | [安全模型 (Security)](docs/SECURITY.md) | [贡献指南 (Contributing)](CONTRIBUTING.md) | [交接说明 (Handoff)](docs/HANDOFF.md)

---

DSH 负责插件的下载与安装，但装好后会不会被准入规则拦截、升级后哪些插件会失效，原生日志往往不会直接给出归因。

`dsh-triage`（分诊台）用于解决以下常见问题：
- **升级前预检**：DSH 发布新版本时，推演升上去当前已装插件哪些会被准入规则拦截；
- **静默失效归因**：查明插件安装后为何在界面中消失、无报错却无法加载的具体原因；
- **命名冲突排查**：定位多个插件争抢同一 Entry ID 或服务名的加载冲突。

所有判定均在本地计算并绑定证据来源；信息不足时不作无根据的推测，直接标为 `unknown`（未明确）。只读检查，不修改任何现有配置。

npm 发布版本：`dsh-triage@0.3.4` · 包含独立 CLI 与 DSH 设置页插件 · 本地只读 · 仅在使用 registry 查询命令时发起必要网络请求。

---

## 效果预览

DSH 设置页内置可视化面板（数据来自本地只读接口，与终端 CLI 输出完全同源）：

### 1. 异常排查视图（包含版本拦截、Entry ID 冲突与声明不足）
![异常排查面板](docs/market/screenshot-0.3.1-mixed.png)

> **说明**：标出不满足准入的具体版本区间，并提供直接可用的修复命令；标明 Entry ID 冲突的具体插件；对没有声明版本区间的条目归入“未明确”，不作无证据假设。

### 2. 正常配置视图（无阻断项）
![真实体检面板](docs/market/screenshot-0.3.1-real.png)

> **说明**：无版本阻断或冲突时的状态显示。

---

## 升级日前瞻预检（Upgrade Day）

上游 DSH 发布新候选版本时，提前推演：**当前这套已装插件升上去，会有哪些被拦截？**

<!-- upgrade-card: data/results/upgrade-card-2026-10-31T09-00-00.000Z.json -->
```console
$ dsh-triage upgrade --to next
# 升级日 · 0.2.1-rc.5

**upstream：192 个单元（2 bundle + 190 行）升到 0.2.1-rc.5 → 119 会被拒 · 73 判不了 · 0 会变好 · 0 像没事**

> profile `upstream`（live）· 当前 0.2.1-rc.4 · 目标比当前新
> 判的是**声明层**：只看「声明区间 vs 目标运行时」，不是运行期实测。

| 桶 | 数量 | 意思 |
|---|---|---|
| `would-be-denied` | 119 | 升上去会被摘掉 —— 目标版本的 admission 会拒绝这一行/包 |
| `cannot-tell` | 73 | 判不了 —— 声明不足或目标还没发布，证据不够 |
| `improved` | 0 | 今天被拒、目标放行 —— 今天是坏的，目标版本会放行它 |
| `likely-fine` | 0 | 声明上不冲突 —— 不等于升级后能跑，只表示没有声明冲突 |
```
<!-- /upgrade-card -->

**数据出处**：上述卡片数据基于仓内沙盒 profile（`sandbox/upstream/0.2.1-rc.4`，目标版本 `0.2.1-rc.5`）实跑所得，**不是你的机器**。用户本机的实际已装配置才是推演的输入源。复算验证命令：`node scripts/record_upgrade_card.mjs --stamp 2026-10-31T09-00-00.000Z --to 0.2.1-rc.5`。

- `--to next` / `--to latest` 从 npm `dist-tags` 实时获取目标版本；`--to <版本号>` 全程离线推演。
- `--card --out card.md` 将 Markdown 格式卡片直接落盘，便于附在 GitHub Issue 或 Discussions 中交流。
- 卡片不承诺“升级后一定能跑”：`improved` 的语义是**“目标版本会放行它”**，声明被准入放行不代表运行期动态实测一定通过。

---

## 为什么需要它（排查对照）

| 现象 | 常见误判 | 底层实际原因 |
|---|---|---|
| 插件安装成功，但界面中没有任何入口 | 插件代码有 Bug | 其 `package.json` 未声明 `dsh.bundle`，被作为普通依赖安装，未进入 Profile 加载层 |
| MCP 工具在重启后静默消失 | 通信或环境不稳定 | Loader 在 **admission（准入评估）** 阶段判定版本不匹配，该行在启动初期被静默剔除 |
| DSH 启动崩溃或无法加载 | 全局环境损坏 | 多个插件声明了相同的 Loader Entry ID 或服务名，命名冲突导致启动中断 |

排查困难的核心原因：
1. **准入评估按 Loader 条目逐行判定，而非按 Bundle 整体判定**：Bundle 安装成功，引入特定模块的条目仍可能被拒；
2. **声明兼容的模块仍可能加载失败**：存在依赖版本覆盖、标签失步或构建阶段未完成等情况；
3. **未显式声明不等于兼容**：未声明依赖区间的插件无法作确定性推演，必须如实标为“未明确”。

---

## 上游问题里，这套判断层能覆盖多少

<!-- question-coverage: data/results/question-coverage-2026-11-02T09-57-53-229Z.json -->
**样本**：`deepseek-ai/deepseek-harness` 的 **Q&A 全量 1545 条**（2026-08-13 → 2026-11-02，截止 `#11857`），目标运行时 `0.2.1-rc.5`。**能给出声明层判定：74/1545 = 4.8%（Wilson 95% 3.8–6.0%）**。

| tier | 条数 | 占 Q&A | 意思 |
|---|---:|---:|---|
| `names-a-denial` | 47 | 3.0% | 能点名「这个包会被拒」并给出区间 |
| `rules-out-declaration` | 27 | 1.7% | 能排除声明层（「不是版本区间的问题」） |
| `declares-nothing` | 89 | 5.8% | 只能说明「没声明」——不算兼容，也不算被拒 |
| `upstream-only` | 164 | 10.6% | 只涉及未点名的上游包（npm tag 常年过期），不进头条 |
| `probe-unreadable` | 90 | 5.8% | 名字在 npm 上不存在（404）——名字抽取的问题，不是 registry 读不到 |
| `needs-their-profile` | 178 | 11.5% | 相关层，但没有可探针的包名 |
| `not-relevant` | 950 | 61.5% | 分类器没读到任何信号——**不等于「与我们无关」** |

**上下文（不是头条）**：有层信号的 **595** 条里 **74/595 = 12.4%（Wilson 10.0–15.3%）**；再摘掉读不到的 90 条，是 **74/505 = 14.7%（11.8–18.0%）**。**General 全量 5786 条**另算：**411/5786 = 7.1%（6.5–7.8%）**，投影快照，只作对照，**不与 Q&A 合并**。

**边界**：只对这个样本成立；判的是**已发布 manifest** 对 `0.2.1-rc.5`，**不是你的机器**；分类器只读文本，agent 复核 20 条一致 **9/20**，HUMAN 抽查 **5/5**；未点名的上游包不进头条；`probe-unreadable` 多数是 npm 上没这个名字（404），不是 npm 挂了。**R88 复核（`data/results/extension-candidates-2026-11-05T16-50-00.000Z.json`）**：那 950 条在产物里**全是 `layer=unknown`、零信号**，所以它说明的是「分类器没匹配到」，**不能**读成「这些帖子与我们无关」；抽看标题能看到真实的安装 / 运行失败。

复算：`node scripts/record_question_coverage.mjs --stamp 2026-11-02T10:05:00.000Z --recompute --fixtures data/fixtures/question-coverage/2026-11-02T09-57-53-229Z --target 0.2.1-rc.5`。产物：`data/results/question-coverage-recompute-2026-11-02T10-05-00-000Z.json`；抽检：`data/results/question-review-2026-11-02T10-10-00-000Z.json`；方法：`audit/RECON_2026-11-02_question-coverage.md`。
<!-- /question-coverage -->

---

## 安装与使用

### 1. 独立 CLI 工具

```bash
# 全局安装
npm install -g dsh-triage

# 升级前预检：检查升到新版本会对当前已装插件有什么影响
dsh-triage upgrade --to next --card

# 查看当前状态（一屏概览）
dsh-triage status

# 查明未加载条目的准入原因
dsh-triage why

# 查看完整台账（已装包、槽位与服务）
dsh-triage audit

# 启动本地 Web 诊断面板
dsh-triage serve
```

本地 Web 面板默认只响应 `127.0.0.1` / `localhost` / `[::1]`（`Host` 不匹配一律 **421**）。局域网访问需显式传入 `--host <IP>`（或 `--host 0.0.0.0 --allow-host <IP>`）；经 `ssh -L` 或反向代理访问时若端口改变，需指定 `--allow-host localhost:<端口>`。同一秒内重复刷新会直接复用前次扫描（响应标记 `reused: true`），作为调用速率上限。

### 2. DSH 设置页集成

```bash
# 装入当前 DSH profile
dsh plugin --profile web add dsh-triage
```

安装后在 DSH **“设置页 → 兼容性分析”** 即可查看诊断视图与修复命令。

---

## 常用命令说明

### 1. 查看环境指纹 (`env`)
```console
$ dsh-triage env
dsh        0.1.0-rc.6
node       24.15.0 · win32/x64
profile    web (~/.dsh/profiles/web)
bundles    2
  - @deepseek-ai/dsh-base
  - @deepseek-ai/dsh-web-app
```

### 2. 深入排查静默失效原因 (`why`)
```console
$ dsh-triage why
scanned 2 bundles · 156 loader rows · 128 import targets · dsh 0.1.0-rc.6 · profile web
[UNKNOWN] @deepseek-ai/cordis-plugin-hmr@1.0.16 — 证据不足
  env      dsh 0.1.0-rc.6 · win32/x64 · profile web
  reason   loader row hmr 引入 @deepseek-ai/cordis-plugin-hmr（声明于 bundle:@deepseek-ai/dsh-base）
  reason   row hmr 引入的 @deepseek-ai/cordis-plugin-hmr 没有声明任何 @deepseek-ai/dsh* 区间
  fix      [report] 请作者补上 @deepseek-ai/cordis-plugin-hmr 实际需要的 peer 区间，或做一次隔离实测
  missing  该 row 模块声明的 @deepseek-ai/dsh* peer 区间（或 engines.dsh）
  evidence declared:row, measured-local:runtime
```

### 3. 安装前预检候选插件 (`check`)
```console
$ dsh-triage check dsh-cost-meter
[BLOCKED] dsh-cost-meter@1.9.44 — 不可用
  env      dsh 0.1.0-rc.6 · win32/x64 · profile web
  reason   engines.dsh >=0.2.0-rc.1 <0.3.0-0 不含 0.1.0-rc.6
  fix      [allow-version] 为这个精确版本对记录一次显式豁免 -> dsh plugin --profile web allow-version dsh-cost-meter@1.9.44 --dsh-version 0.1.0-rc.6 --accept-risk
  fix      [pin-version] 改装一个声明含 0.1.0-rc.6 的版本（profile: web）
  fix      [upgrade-dsh] 升级 DSH：1 条要求需要更新的运行时（至少 0.2.0-rc.1，当前 0.1.0-rc.6）
  evidence declared:admission, measured-local:runtime, measured-registry:registry-tags
```

### 4. 隔离沙盒真机实测 (`probe`)
在独立的临时 `DSH_HOME` 中执行安装、启动、HTTP 探活与无头浏览器页面挂载：
```console
$ dsh-triage probe dsh-status-rotator --execute
```
*注：默认模式为 `--dry-run` 仅输出方案；明确指定 `--execute` 才会拉起测试沙盒进程，退出时自动清理。*

---

## 判定契约与证据等级

诊断结论分为四类：

| 结论 | 含义 |
|---|---|
| `go` | 静态声明与当前运行时匹配；或在 `probe` 实测中安装、启动、响应均正常且条目为 `active` |
| `risky` | 基本可用，但存在明确标记的潜在限制条件 |
| `blocked` | 存在确定性阻断项，无法正常加载；**必定提供至少一条可执行的修复命令** |
| `unknown` | 现有声明或证据不足以推演；**必定明确列出缺失的具体信息** |

### 证据等级制度（Evidence Tiers）
每条结论均附带证据类型：
- `declared`：插件作者在 `package.json` 等文件中发布的依赖声明；
- `scanned`：对本机已安装文件的静态扫描分析；
- `measured-local`：在当前机器环境下的真实执行观测；
- `measured-registry`：来自官方 npm registry 的公开发布元数据；
- `inferred`：逻辑推导（绝不单独作为输出结论的依据）。

---

## 工具边界（不做什么）

1. **不修改你的 profile**：不安装到你的 profile、不卸载现有插件、不执行回滚；除独立的临时测试沙盒外，绝不修改用户的 `~/.dsh` 配置。
2. **不做集中式市场或排行榜**：仅输出针对当前机器环境的本地诊断结论，不做全网评分或排位。
3. **不提供安全背书**：本工具不提供安全背书。分诊台聚焦于本地兼容性与启动加载可用性，不代表对插件源码的防恶意软件或供应链安全审计。
4. **无证据不猜**：未显式声明依赖区间的插件严格归入 `unknown`，绝不盲目判定为正常。

---

## 可复算的工程证据

所有公开陈述与文档结论均有对应的工程脚本产物支持，全量存储于 `data/results/` 并配备 `.sha256` 校验：

| 验证项 | 复现命令 / 证据源 | 说明 |
|---|---|---|
| 全套自动化验证 | `pnpm run verify` | 构建、类型检查、821 个测试、9 道零依赖门禁 |
| 门禁对抗性负对照 | `node scripts/gate.mjs --mutate` | 校验 9 道门禁均具备真实的拦截捕获能力 |
| 上游准入语义对等 | `data/gold/admission-cases.json` | 27 条人工签署的对等金标基准 |
| 真实故障根因命中 | `node scripts/d1_report.mjs` | 真实案例采集中 9 命中、1 显式 `unknown`（`data/results/d1-*.json`） |
| 发布包真机安装验证 | `data/results/publish-*.json` | 干净环境匿名安装、四包对齐一致性校验 |

---

## 模块结构

```
packages/core/       判断引擎：准入语义、环境指纹、能力台账、Verdict 组装（纯函数、离线）
packages/signals/    信号适配器：npm registry、dsh.so、本地证据适配
packages/probe/      隔离实测：沙盒计划、执行器、无头浏览器 CDP 渲染判定
packages/plugin/     分发入口：dsh-triage CLI、DSH 设置页前端面板、Agent 工具
scripts/             9 道零外部依赖门禁脚本与自动化取证流水线
data/gold/           准入规则人工签署金标基准
data/results/        真实评测 JSON 数据与 .sha256 签名（SSOT）
```

---

## English Overview

**dsh-triage** is the diagnostic layer for DeepSeek Harness (DSH) plugins. It answers why plugins silently disappear after updates and pre-evaluates compatibility risks before upgrading.

### Quick Start
```bash
npm install -g dsh-triage
dsh-triage upgrade --to next --card
dsh-triage status
```

### Safety & Integrity Boundaries
- **Local & Read-only**: Analyzes local configurations without mutating `~/.dsh` files.
- **Explicit Unknowns**: Silence is not a pass. Undeclared ranges yield `unknown` instead of false positives.
- **Security Boundary**: We do **not** provide security assurances — no verdict in this tool means "safe to run" (本工具不提供安全背书).

---

## 参与贡献与交接

欢迎参与完善分诊台！详细指南请参阅：
- [参与贡献指南 (CONTRIBUTING.md)](CONTRIBUTING.md)
- [快速上手与交接文档 (docs/HANDOFF.md)](docs/HANDOFF.md)
- [项目规则与工程约束 (PROJECT_RULES.md)](PROJECT_RULES.md)

---

## 开源许可

本项目基于 [MIT License](LICENSE) 开源。引用自 [dsh.so](https://www.dsh.so) 的注册表事实数据遵循 CC BY 4.0 协议并已在引用处注明。
