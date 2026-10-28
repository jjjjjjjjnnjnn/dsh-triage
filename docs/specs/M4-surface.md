# M4 · 控制面设计（本地面板 / DSH 设置面板 / 可双击的 exe）

> **Stand**: R16 设计稿（2026-10-27）｜实现：`packages/plugin`（`dsh-triage serve`、`client.js`）+ `scripts/sea_build.mjs`
> **原则**：控制面**只展示与触发**已有判断，**不新增判据**；默认只读、只本机、不读凭据；结论文案必须复用 `messageId`（与 CLI 同源）。

---

## 0. 为什么需要控制面

CLI 已经能回答「装不装 / 为什么坏 / 实测结果」，但三个场景它答不了：

1. **看得见的证据**：用户想点开一行插件看它为什么被判 `blocked`，而不是读 JSON；
2. **装之前的那一下**：在 DSH 的设置页里直接看候选结论（用户此刻就在那儿）；
3. **坏了之后**：应用可能起不来，需要一个**不依赖 DSH 启动**的窗口/面板来跑诊断。

对应三种交付形态，**成本从低到高**：`serve`（零依赖本地面板）→ DSH 设置面板（client bundle）→ SEA 单文件 exe。

---

## 1. 已核实的上游契约（不是猜的）

| # | 事实 | 证据 |
|---|---|---|
| S1 | 浏览器半边由 `package.json#dsh.client` 声明：`{ platform: "web", inject: [<client 服务包>] }`；Host 把它作为 `/plugins/<包名>/client.js` 提供 | `dsh-plugin-model-proxy@0.1.6` 的 `package.json` + `cordis.patch.yml` 注释（「browser half is discovered automatically … served at /plugins/<pkg>/client.js」） |
| S2 | client 入口是预打包的 `window.__ModuleLoader__.load({ id, factory: (require) => … })`，`require` 只能拿到 `dsh.client.inject` 里声明的服务的子集 | 同上 `lib/client.js` 头 12 行；`@deepseek-ai/dsh-client-ui-settings-plugins@0.2.1-rc.4/lib/client.js` 同形 |
| S3 | **loader row 的 id 就是 settings 命名空间**：设置 UI 把该 row 的 Config 投影成同名 section，客户端卡片用 `configForms.get('<row id>')` 绑定；改 id 会同时弄坏两处 | 同上 `cordis.patch.yml` 注释原文 |
| S4 | 设置区通过 `@deepseek-ai/dsh-client-ui-slots` + `@deepseek-ai/dsh-client-ui-settings` 注册；第三方插件的 inject 列表里两者都出现 | `dsh-plugin-model-proxy` 的 `dsh.client.inject`；`dsh-builtin-browser@0.4.15` 的 peerDeps |
| S5 | 生态里已有「应用内渲染上报」先例：guard v0.3.1 起由页面内的 client 上报渲染崩溃，boot-guard 据此回滚，**并明确写了「黑屏时 HTTP 仍是 200」** | `lxzy-7/dsh-plugin-guard` README「How it detects problems」第 2 条 |
| S6 | GitHub ubuntu runner 自带 Chrome/Chromium/Edge + xvfb | runner-images `Ubuntu2404-Readme.md`（image `20261023.334.3`） |

> **对 R15 的更正**：交接文档里「Linux CI 没有浏览器」是错的。见 `ADR-0005`，CI 已加 `render-control` 作业。

---

## 2. 形态 A：`dsh-triage serve`（本地控制面板，先做这个）

**一句话**：`dsh-triage serve` 起一个只在 `127.0.0.1` 上的小面板，把「已装集合 / 最近一次 probe / SSOT 证据」渲染成可点的页面，并能一键重跑某条命令。

> **状态（R16）**：**v0 已交付** —— 零依赖、token 鉴权、跨源拒绝、POST 403（`--allow-execute` 也只回 501）；当前只列 `data/results` 的产物与 sha256，**还没有** `/api/audit`（见 T-406）。
> 冒烟证据：`data/results/serve-smoke-2026-10-27T14-12-16.000Z.json`（8/8）；单测 `tests/unit/serve.test.ts`（6 条）。
>
> **状态（R19 / T-406）：v1** —— 新增 `GET /api/audit`（**默认关闭**，`--audit` 才开；关闭时回 **501**、读不到 profile 时回 **409**、绝不用空账本冒充「没有问题」）。数据来自**同一份** `loadAuditData()` + `auditJsonPayload()`（`packages/plugin/src/audit-data.ts`），所以面板与 `audit --json` 不是「两套实现」。冒烟 `serve-smoke-2026-10-28T10-20-00.000Z.json`（13/13，含 `/api/audit` 501 / 200 / 与 CLI 逐条一致 / token 与端口不入产物）。

| 项 | 设计 |
|---|---|
| 依赖 | **零**（`node:http` + 内联 HTML/CSS/JS，和门禁同一条纪律） |
| 绑定 | `127.0.0.1:<随机端口>`，打印带一次性 token 的 URL（与 DSH 自己的 `?token=` 同思路） |
| 鉴权 | token 校验 + `Origin`/`Sec-Fetch-Site` 同源检查；不读到任何凭据 |
| 数据 | `GET /api/audit`（`--audit` 才开；复用 `loadAuditData()`，只读本机 profile；关闭 = 501、读不到 = 409）、`GET /api/probe/:id`（读 `data/results/probe-*.json`）、`GET /api/ssot`（列出产物与 sha256） |
| 动作 | `POST /api/probe`（需 `--allow-execute` 才启用；默认只渲染 dry-run 计划） |
| 安全 | 不监听公网、不写 `~/.dsh`、不下载候选（执行由 probe 的既有沙盒负责） |
| 证据 | 页面上的每条结论都带 `messageId` + 产物路径 + sha256 |

**验收**：`dsh-triage serve --dry-run` 只打印 URL 与将读的数据源；`serve` 起来的页面在无网络下可用；`POST /api/probe` 在未加 `--allow-execute` 时返回 403（负对照）。

### 3.1 契约 spike（R26，**只读**：读上游 0.2.1-rc.4 的真实文件，未写 `client.js`）

> **为什么只读到这一步**：T-401 的出口是「面板能看到与 CLI 同源的结论」，写 `client.js` 需要先有一份能跑的契约样本，再谈 UI。本轮把「要照哪个文件写」钉到具体行号，避免下一轮从猜开始。

| # | 契约事实（0.2.1-rc.4 实读） | 出处 |
|---|---|---|
| C1 | 浏览器半边是一个 **Cordis client plugin**：`exports.inject` 声明要注入的客户端服务名，`exports.apply(ctx)` 里注册 UI；外层必须包在 `window.__ModuleLoader__.load({ id, factory })` 里，`id` = 包名 | `@deepseek-ai/dsh-client-ui-settings-plugin-inventory/lib/client.js` 第 1 行 + 第 719–770 行 |
| C2 | **插件页签的插槽名是 `settings.plugins.tab`**，注册方式 `ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({ name, id, order, label, locale, inject }, Component))`；`id` 在同一插槽内唯一（上游用 `"all"`、`order: 10`） | 同上第 757–766 行 |
| C3 | 组件拿数据是**由 `inject` 回调提供的 props**（不是自己 import host 模块）：上游注入 `{ list, presetName, resolveText, hooks, retryClient }`，其中 `list()` 调 `ctx.remote.pluginInventory.list()` 并返回 `{ok, value|error}` | 同上第 746–756 行 |
| C4 | 依赖的客户端服务名：`["slots","locale","remote","remote.pluginInventory","modules"]`；**`remote.pluginInventory` 就是本仓已经在用的那条 typert 通道** | 同上第 725–731 行 |
| C5 | 文案走 `ctx.locale.register(NS, {zh,en})` + `ctx.locale.bind(NS)`，`NS` 是自有命名空间（上游 `settings.pluginInventory`）；副作用一律包 `ctx.effect(...)` 以便卸载 | 同上第 736–745 行 |
| C6 | 上游自己就有一页**只读插件清单**（`dsh-client-ui-settings-plugin-inventory`）——说明「只读 tab」是上游承认的形态，不与上游抢位置也能挂上 | 同文件第 1 行注释「Read-only Host plugin inventory registered into Web Settings」 |

**给 T-401 的落地形状（下一轮）**：

- 文件 `packages/plugin/client.js`（手写、无打包器），`package.json#dsh.client = { platform: 'web', inject: ['@deepseek-ai/dsh-client-locale','@deepseek-ai/dsh-client-ui-settings','@deepseek-ai/dsh-client-ui-slots','@deepseek-ai/dsh-api-remotes'] }`；
- 在 `apply` 里 `ctx.slots.inject('settings.plugins.tab', …)` 注册 `{ name:'settings.plugins.tab', id:'compat-triage', order: 90, label, locale }`（**铁律 9：row id 用 `compat-` 前缀**，且它同时是 settings 命名空间 S3）；
- **降级必须是默认行为**：`apply` 用 `try/catch` 包住整段注册，并先探测 `ctx.slots?.inject` 与 `ctx.locale?.register` 是否存在；契约不匹配就**整块不注册**（页面看不到任何 triage UI，而不是半截报错）。这条要有单测（用假 `ctx` 断言「不匹配 = 零注册」，而不是「抛错冒到页面」）；
- 数据侧先复用 `serve` 的 `auditJsonPayload()` 同源结论，**不新增判据**；拿不到 Remote 时显示「上次 SSOT 的结论 + 提示跑 CLI」。

---

## 3. 形态 B：DSH 设置面板（M4-a / T-401）

**一句话**：把同一份结论嵌进 `设置 → 插件`，用户不用离开 DSH。

| 项 | 设计 |
|---|---|
| 新增文件 | `packages/plugin/client.js`（手写 `window.__ModuleLoader__.load`，**不引入打包器**）、`packages/plugin/package.json#dsh.client` |
| inject | `["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-api-remotes"]` |
| 挂载 | 通过 slots 注册一个 settings section；**row id 用 `compat-triage`**（铁律 9：本仓行 id 必须 `compat-` 前缀），同时作为 settings 命名空间（S3） |
| 数据 | 第一阶段走 Host 暴露的只读 Remote（与 `pluginInventory` 同一条 typert 通道）；拿不到就退化成「显示上次 SSOT 的结论 + 提示跑 CLI」 |
| 边界 | client bundle **不得** import 任何 host 侧模块（S2：`require` 只给 inject 子集）；不在 UI 里执行候选代码 |
| 风险 | 上游 client 契约在 rc 阶段会变（S1/S2 是 0.2.1-rc.4 实测），所以面板要有「契约不匹配就整块隐藏」的降级路径 |

**验收**：面板里的结论与 `audit --json` 逐条同源（同 `messageId` + 同 count）；契约不匹配时面板不渲染而不是报错白屏。

> **R30 状态（写了一半，且明确写清哪一半没写）**：`packages/plugin/client.js` 已落地——手写 classic script（不引打包器）、`window.__ModuleLoader__.load({ id:'dsh-triage', factory })`、在 `settings.plugins.tab` 里注册 `{ id:'compat-triage', order:90, locale:'compat-triage', inject }`，文案走 `ctx.locale.register` + `bind`、副作用走 `ctx.effect`。**降级是默认路径**：缺 `slots.inject`/`slots.register`/`locale.register`、`require('react')` 不可用、或任意属性读取抛错 → **零注册**（连字典都不注册），`apply` 永不向外抛。**tab 里没有任何结论**：只有「跑 `dsh-triage audit`」的入口与「宿主报告 N 行插件」这一条事实（并明写「行数是事实，不是结论」）——浏览器读不到 `data/results`，在这里编结论就是违反铁律 1。单测用 `node:vm` 跑**真实文件**（9 条：loader id / 插槽名 / row id / 三种降级 / Proxy 抛错 / load 失败不假装 0 行 / 不 require 宿主模块 / manifest 形状）。
>
> **仍未做的两件（不许当成已做）**：① 沙盒 Host 里真的看到这个 tab（需要起 Host + 设置页断言）；② 「与 CLI 同源结论」——那要求 Host 侧有一条只读 Remote 暴露 `audit --json`，本轮**没有**为了填这个格去自造判据，所以 tab 先只给入口。

---

## 4. 形态 C：可双击的 exe（SEA）

**一句话**：把 `serve` 包成单文件，双击即开面板——解决「应用起不来时也要有个窗口」。

| 项 | 设计 |
|---|---|
| 方案 | Node 官方 SEA（`--experimental-sea-config` + `postject`），不用 Electron/Tauri |
| 体积 | ≈ Node 运行时（~50–70MB） |
| 构建 | `node scripts/sea_build.mjs` → `dist/dsh-triage-panel-<os>-<arch>.exe`；只在 Windows/macOS 发布，Linux 用 `npx` |
| 边界 | 不自动执行 probe；不携带候选；只读 `data/results` 与本机 profile |
| 何时做 | **等 A 有真实用户之后**；先验证「用户愿不愿意点开面板」，再决定要不要 50MB 的安装件 |

**不做的理由（现在）**：SEA 把发布矩阵乘了 3 倍（os×arch），而 A 已经能解决「打不开命令行」的问题（`npx dsh-triage serve` 或全局安装）。M4-b 之前只做设计，不写构建脚本。

---

## 5. 与四个未决项的关系

| 未决项 | 控制面能帮什么 | 不能帮什么 |
|---|---|---|
| **D2 样本量** | 面板可以列出「候选池」并批量入队；真正的分母仍要 `probe` 真跑 | 面板不能替我们决定「≥90%」 |
| **T-303 namespace-diff** | 面板可以显示「当前进程级工具清单」并标注边界 | 会话作用域仍需要 T-202a（ADR + HUMAN 签） |
| **T-305b 私有源** | 面板里可以编辑「本次用的 registry」（仅本次、不持久化） | 失败形状仍要 profile 级配置（另开 spike） |
| **渲染跨平台** | 面板展示 `render.backend` 与对照结果 | 真渲染仍由 `ADR-0005` 的 A 后端负责；面板本身**不是**判据 |

---

## 6. 排期（成本从低到高）

| 序 | 交付 | 依赖 | 出口 | 状态 |
|---|---|---|---|---|
| 1 | CI `render-control` 作业（Linux 真浏览器） | 无 | 每轮 CI 有 `blank`/`rendered`/`error` 三份对照 | ✅ R16 |
| 2 | `dsh-triage serve --dry-run` + 只读页面 | 1 | 页面能显示 audit/probe/SSOT，且不执行任何东西 | ✅ R16（v0）· **R19（v1：`/api/audit` + 当前组合区块）** |
| 3 | `serve --allow-execute` + `POST /api/probe` | 2 | 负对照：未授权返回 403 | 🟡 门已就位（403 / 501），动作未实现 |
| 4 | DSH settings section（client bundle） | 2 | 与 CLI 同源；契约不匹配时隐藏 | 🟡 **R30：浏览器半边已交付**（`packages/plugin/client.js` + `dsh.client` + 9 条契约单测，含「不匹配 = 零注册」）；**剩余**：真机挂载 + 同源结论（需要 Host 侧只读 Remote） |
| 5 | SEA 构建（可选） | 3 + 真实用户 | 双击可开面板 | ⬜ 设计已就绪，未写脚本 |
