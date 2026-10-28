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

### 3.2 真机验证（R31，**F53**）

`scripts/record_client_serve.mjs` 把四个 workspace 包（`file:` 依赖，workspace 协议改写成 `file:`，不碰 registry、不碰凭据）装进一次性 DSH home，起一次真 Host，然后按**启动文档**取资产：

| 步骤 | 真机结果 |
|---|---|
| `graph` | 启动文档里的组合 URL 含 **`dsh-triage/client.js`**——Host 组进了启动图 |
| `client` | 取该组合 URL → **200 / 2,020,463B**，含 `__ModuleLoader__.load`、`id: 'dsh-triage'`、`settings.plugins.tab` |
| `mount` | headless Chrome + CDP 打开页面 → **`window.__dshTriage = {registered:true, slot:'settings.plugins.tab', id:'compat-triage'}`** |

产物：`data/results/client-serve-2026-10-28T19-20-00.000Z.json`（六步全绿，含 cleanup）。

**三条只有真机才暴露的发现（`BS-35`）**：

1. **`package.json#exports["./client"]` 必需**：`dsh-client-modules` 的 `clientExportOf()` 只认这个键；缺了会抛 `declares dsh.client but exports no "./client" bundle`，而且只走 onError → **模块静默消失**。
2. **profile patch 行的 `name` 必须是裸包名**（`dsh-triage`）：`exactPackageSpecifier()` 不接受子路径，`dsh-triage/host` 会让 `locatePkgJson()` 返回 `undefined` → 浏览器半边永远不被组进图。R30 的 `cordis.patch.yml` 用的正是子路径（`dsh-triage/host`），所以「装了、host 半边也能 dump 出来，但页面里没有我们」。修法：行名改裸包名，`dist/index.js` 重新导出 host 插件（`apply`/`name`/default），程序化 barrel 不变。
3. **资产 URL 必须带 `?rev=`**：`/plugins/<pkg>/client.js` 裸请求一律 404（上游自己的 bundle 也一样），要用启动文档给出的组合 URL `/plugins/??<ids>/client.js&rev=…`。

**仍未做**：设置页里**肉眼看到** tab（要点击导航后断言 DOM）；「与 CLI 同源结论」（要 Host 侧只读 Remote）。`mount` 证明的是「client runner 调了 `apply`、slot 接受了注册」，**不**证明用户点开设置就能看到。

### 3.3 R33 收口：可见性 + 同源结论（**T-401 完成**）

`ADR-0010` 定了通道：**同源只读 HTTP 路由**（`GET /compat-triage/audit`），不是 Typert Remote —— 后者在真机上「注册成功、浏览器拿不到」，要补一条带 `zod` 的客户端生成链，与我们「手写无依赖 client.js」的决定冲突。

| 步 | 判据 | 真机读数 |
|---|---|---|
| `visible` | 关首启浮层 → 开设置 → 进「内置插件」section → DOM 里出现 `分诊台`，点击后 tab body 出现 `dsh-triage audit` | passed（`client-serve-2026-10-29T01-20-00.000Z.json`，6 跳逐条记录） |
| `same-source` | tab 里渲染的行数/结论计数 == 同一 profile 上 `dsh-triage audit --json` 的数字 | passed：两侧都是 **192 行 / 0 go / 0 blocked / 184 unknown** |

**两条负对照**（`--expect-tab-label` 与 `--cli-home`）：可见性换成不存在的标签 → `visible:failed` + exit 1；CLI 指到另一个 home → `same-source:failed`（192 vs 190）。两次都只换输入，不换代码路径。

> 边界：`visible` 证明的是「设置页里渲染出我们的 tab」（不是视觉回归）；`same-source` 证明的是「两侧数字一致」（payload 里没有字段被谁重排）。**两个 profile 恰好行数相同**时 `same-source` 负对照会变成「一致」而失败，届时换 profile，别放宽比较。

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
| 4 | DSH settings section（client bundle） | 2 | 与 CLI 同源；契约不匹配时隐藏 | ✅ **R30 写 / R31 真机注册 / R33 收口**：`client.js` + `dsh.client` + 契约单测；真机六步全绿；**R33 补上剩下两件** —— `visible`（设置页里真的渲染出 tab）+ `same-source`（tab 与 CLI 在同一 profile 上数字一致，`ADR-0010` 选了同源只读路由而不是 Typert Remote），两条负对照各一份产物 |
| 5 | SEA 构建（可选） | 3 + 真实用户 | 双击可开面板 | ⬜ 设计已就绪，未写脚本 |

---

## 7. 徽章与格式索引（M4-b）

### 7.1 徽章 `dsh-triage badge <pkg[@ver]>`（T-402，R34 完成）

**一句话**：把**已经记录过的那次运行**写成 shields 风格 SVG，可供作者放进 README。

| 项 | 实现 |
|---|---|
| 数据源 | 只读 `--results <dir>` 里的 `probe-*.json`；**不联网、不读 registry、不跑 probe** |
| 排除项 | `sandbox.hook_config` 非空的诊断产物不计入（R26 规则：诊断样本不得进通过率） |
| 文案 | 左 `triage`，右 `go · dsh 0.2.1-rc.4`（结论 + 实测运行时）；**没有测量** → `not measured`（灰） |
| tooltip | `<title>` 带包名@版本、结论、`boot→sample`、采样时间、产物文件名——徽章是指向证据的指针，不是结论的摘要 |
| 确定性 | 纯函数 + 固定字宽表；同一输入同一字节（产物可哈希） |
| 关闭面 | `--json` 给出 `evidence` 与 `svg_sha256`；`--out <file>` 落盘 |

**为什么不做「分数」**：本项目对「质量」没有证据，只有「在这台机器/这版 dsh 上到了什么结论」。分数会变成不可证伪的背书（铁律 1、严禁行为 2）。

**产物**：`data/results/badge-2026-10-29T02-30-00.000Z.json`（两例：`dsh-status-rotator` = `go`；不存在的包 = `not measured`），单测 `tests/unit/badge.test.ts`（8 条）。

### 7.2 格式 1 索引源（T-403，R34 交付）

**取证方式**：实读上游校验器 `@deepseek-ai/dsh-plugin-market-index@0.2.1-rc.4`（`lib/index.js`），不按 Agent Note 转载复述。

| 规则 | 事实（校验器行为） |
|---|---|
| 顶层 | `format` 必须 `=== 1`；`title` 必填（字符串或 `{en:…, zh:…}`，**对象必须含 `en`**）；`description` 可选；`plugins` 必须是数组且**名字不重复** |
| 插件 | `name` 必须是合法 npm 名；`title`/`description` 可本地化；`icon` 必须是 `https:` URL、与索引同源的相对引用，或 ≤32 KiB 的 base64 `data:`；`author`/`homepage`/`repository` 可选 |
| 版本 | `versions` 非空、版本号**不重复**、必须是精确 SemVer；`publishTimestamp` 必填 = **整数 Unix 秒** `[0, 10^11)`；`source` 必填：npm（可选 `registry`）或 git（40 位小写 commit + 可选 `path`）；`engines.dsh` 若是字符串必须是合法 SemVer range 且**不得是 `workspace:`** |
| metadata | `categories` / `labels` / `sortKeys` 先声明才能被引用；`plugins[].metadata` 里未声明的 id 直接失败；`keywords` 是字符串数组 |
| 解析副作用 | 未定义成员**被丢弃**；`versions` 按 SemVer **降序**重排；相对 `icon` 解析成绝对 URL |

**由此确定的两条实现约束**（写在这里，避免下一轮重新踩）：

1. **`publishTimestamp` 必须逐版本**，而本仓现有 `registry-*.json` 只有 `newest_published_at`（整包一条）——生成器要么联网取 packument 的 `time` 字段（`scripts/record_registry.mjs` 已有取数路径），要么只收录「有逐版本时间戳」的条目；**不许**拿 `newest_published_at` 冒充某个具体版本的时间。
2. **索引格式里没有「结论」字段**，任何把 verdict 塞进 metadata 的做法在校验器里会被**静默丢弃**。所以索引源的差异化只能是**筛选**（只列出实测 `go` 且 `engines.dsh` 覆盖当前运行时的版本），不是「给插件打分」。

#### 7.2.1 实现（R34）

`dsh-triage index [--results <dir>] [--out <file>] [--json]`（`packages/plugin/src/index-source.ts`）：

- **收录判据**：只收「有记录的一次运行得到 `go`」的版本；每次取**最新**的那次；候选必须是 **registry** 来源（本地目录没有 npm 版本可列）；`sandbox.hook_config` 的诊断产物排除（R26 规则）；`blocked` / `unknown` 一律不进索引，并在 `excluded[]` 里写明原因。
- **时间戳**：`publishTimestamp` 取 registry **逐版本** `time`（`publishedAt`）折算的整数秒；拿不到就**排除**该版本，绝不拿整包的 `newest_published_at` 冒充某个版本的时间。
- **范围**：`engines.dsh` 只在包声明了、且不是 `workspace:` 时才写；索引里出现范围是给读者判断兼容性用的，不是我们的结论。
- **校验**：`scripts/record_index_source.mjs` 跑完 CLI 后，用**上游校验器**（沙盒里的 `@deepseek-ai/dsh-plugin-market-index`）验证文档；校验器不在 → `unmeasured`，**不是**「valid」。校验失败 → exit 1。
- **真机产物**：`data/results/index-source-2026-10-29T04-00-00.000Z.json` —— **5 个插件 / 5 个版本被上游校验器接受**（`dsh-cost-meter@1.9.41`、`dsh-mcp-connector@0.2.83`、`dsh-plugin-model-proxy@0.1.6`、`dsh-status-rotator@0.38.0`、`dsh-whale-widget@0.4.2`）。
- **边界**：索引是**筛选**不是背书——格式里没有结论字段，未定义成员会被校验器**丢弃**；描述文案明写「没出现的包 = 这里没测过，不是判定」。单测 8 条钉死这些规则。

### 7.3 Agent 工具 `compat_verdict`（T-404，R36 交付）

**一句话**：让 Agent 在「装之前」能问一次判断层——返回与 CLI **同源**的 verdict JSON，失败只降级 `unknown`。

| 项 | 实现 |
|---|---|
| 数据源 | 读**一个**已发布的 manifest（npm packument）→ `evaluateAdmission` → `judgeVersionDrift` → `verdictFromAdmission`，与 `check` 同一条引擎链（`packages/plugin/src/fit.ts`） |
| 参数 | `package`（必填，`name` 或 `name@version`）；`additionalProperties: false`——注册表**不校验**纯对象定义的参数，所以由我们自己拒绝（`readPackageArgument`） |
| 输出 | JSON 字符串：`conclusion` + `summary`（与 CLI 同一 `renderVerdict` 的逐行文本）+ `verdict`（契约对象，路径已脱敏）+ `admission` + `registry` + `limits` |
| 失败 | 任何读不到 manifest 的路径 → `unknown` + `missing.admission` + `tool.verdict-unavailable`（`{detail}` 写明真实原因）；**绝不抛**（抛出去模型只会看到栈） |
| 超时 | `timeoutMs = 20s`，并**真的**把 `exec.signal` 转发进 registry 读（`AbortSignal.any` 合并） |
| 不做 | 不安装、不执行候选代码、不读凭据、不判安全；`go` 只表示「声明层接受这个运行时」 |

**为什么是纯对象而不是 `defineTool`**（R36 实测 `@deepseek-ai/dsh-tools/lib/index.js#register`）：注册表只校验四件事——`output.render` 是函数、`output.schema` 属于受支持的 JSON Schema 子集（`type/oneOf/properties/required/additionalProperties/items/enum/const` + 注解）、`timeoutMs` 为正、名字不是保留的 `run_code`。**没有 marker**，`defineTool` 只是把作者侧 schema DSL 编译成 JSON Schema 并加参数校验。因此本包不需要引入任何上游依赖（与 `ADR-0010` 对手写 `client.js` 的取舍同源）。

**注入形态（R36 改了这里，必须记住）**：在 R35 之前这个 row 声明 `inject: ['webServer']`，于是**没有 webserver 的 profile 根本不挂载它**——对浏览器 tab 是对的，对 Agent 工具是错的（最需要「装前自查」的恰恰是不带 web 面的 tui/headless profile）。现在两半各自用 Cordis 自己的 `ctx.inject([...], cb)` 门控（上游 `dsh-plugin-market` 的写法）：`webServer` 在则挂路由，`tools` 在则挂工具，各自失败不影响另一半。代价与回归：R33 验过的八步 `client-serve` 在 R36 重跑仍全绿（`data/results/client-serve-2026-10-29T13-00-00.000Z.json`）。

**真机证据**（`scripts/record_agent_tool.mjs` + `packages/plugin/hooks/tool-hook.mjs`）：四个 workspace 包按 `file:` 装进一次性 DSH home → 起 Host → 读 `tools.schemas()` → 调三次工具 → 落产物。`data/results/agent-tool-2026-10-29T12-20-00.000Z.json` 十一项全绿：

- `registered:true`、`model_visible.in_schemas:true`（506 字符描述、参数 `[package]`、该 profile 共 2 个可见工具）；
- 三次调用都 `via: registry`（走的是 `tools.execute()`，即模型真正的调用管道，不是直接调定义）：`@lolkda/dsh-skills-manager@0.3.1` = **go**、`dsh-cost-meter@1.7.43` = **blocked**、不存在的包 = **unknown**（`tool.verdict-unavailable`）；
- 同一产物里的负对照：未注册的名字在 `tools.get()` 里**查不到**（所以「可见」不是一个恒真的读数）。

**两条实测教训（写进这里，避免下一轮重踩）**：

1. **工具回答的是「它服务的那个 profile」的运行时**。第一次跑用 `dsh-status-rotator@0.38.0` 期望 `go`，实际 `unknown`——它什么都不声明；第二次用 `dsh-mcp-connector@0.2.83` 期望 `blocked`，实际 `go`——因为 CLI 那次是在操作者的 `~/.dsh`（0.1.0-rc.6）上判的，而 Host 的 profile 是 0.2.1-rc.4。**两个数都对，问的不是同一个问题。**
2. **期望必须在跑之前用同口径测出来**。现在脚本把期望写进 `CALLS`（并在产物 `sandbox.calls[].expected` 里落账），声明一改就红，而不是被事后重新叙述。

**为什么 hook 目录不进 `files`**：它是仓库里的诊断件（同 `scripts/record_*`），不是用户运行时要加载的东西；与 probe 的 `hooks/`（CLI 装成 npm 包后仍需找到）不同。**边界**：真机只覆盖一个 Windows 机器 + 0.2.1-rc.4 + 一个 `web` profile；它证明「注册了、模型看得见、三问都答得上」，**不**证明模型会主动选这个工具，也不是任何形式的安全背书。

