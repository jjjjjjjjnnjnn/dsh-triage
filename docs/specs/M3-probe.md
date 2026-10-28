# M3 · probe 执行器契约（T-301，R15 扩 T-302/T-306，R17 扩 T-308）

> **Stand**: R17 (2026-10-27) | 实现：`packages/probe/src/{exec,host,render,plan}.ts` + `scripts/record_probe.mjs` + `scripts/record_render_fixture.mjs` | 门禁：`tests/unit/probe-exec.test.ts` + `tests/unit/render.test.ts` + 门 `step-review`（不新增第 10 道门）
> **上游基线**：仓内沙盒 `@deepseek-ai/dsh` 0.2.1-rc.4（证据见 §2） | **默认 dry-run**，真跑必须显式 `--execute`
> **R15 新增**：`client-rendered` 从「恒为 unmeasured」变成**真判据**（真浏览器 + CDP）；就绪端口改由 Host 自己打印的 URL 决定（T-306）；registry 候选开始有真实分母（T-305）。
> **R17 新增**：**「慢」与「坏」分开**（T-308 / `BS-25`）——测量失败只能 `unknown`；端口改为向 OS 申请（本机 TCP 53461–53560 是排除段，哈希选中的 53506 绑不上，曾把正常候选写成 `blocked`）；`startup failed` 用 launcher 原文归因，且不再等满 120s。

---

## 1. 目标与非目标

**目标**：回答一个静态声明答不了的问题——**把候选插件真装进一个隔离的 `DSH_HOME`，它起不起得来、它的行有没有真的活着。**

**非目标（IS-NOT，一条都不许越）**：

| 不做 | 原因 |
|---|---|
| 不判「安全 / 无恶意」 | `COMPLIANCE.md` §5；probe 只答「装得上 / 跑不跑得起来」 |
| 不判「功能正确」 | 渲染层只回答「页面有没有挂载出可见 DOM」，不回答「这个功能对不对」；`namespace-diff`（T-303）仍未测，产物必须标 `unmeasured` |
| 不写真实 `~/.dsh` | `PROJECT_RULES.md` 铁律 3；沙盒必须是独立的 `DSH_HOME`，且与真实 home 不重叠（`validateProbePlan` 已强制） |
| 不注入真实凭据 | 铁律 4；候选需要 key 时如实记「未验证」而不是猜 |
| 结论不带「用户机器」口径 | 证据来自**仓内沙盒**；产物写 `runtime.source` |
| 不 vendor 候选代码 | `docs/adr/0004`；候选只在临时沙盒里被执行，源码不进仓 |

---

## 2. 实测事实（R14，0.2.1-rc.4，不是文档抄来的）

| # | 事实 | 怎么测的 |
|---|---|---|
| F1 | launcher 语法：`dsh --profile <p> --patch <overlay>`（flags 在 profile 名**之前**） | `dsh --help`；R12 已踩过坑 |
| F2 | 安装语法：`dsh plugin --profile <p> add <spec>` → 转发 pnpm；profile **首次使用时初始化**（模板 = `@deepseek-ai/dsh-base` bundle） | `dsh plugin --help`；孤立 `DSH_HOME` 实测 |
| F3 | **bundle 的 `cordis.patch.yml` 必须用 `insert:`**。裸 `- id: x / name: y` 是「修改 entry x」，上游对未知目标只写 stderr 警告然后跳过：`dsh: warning: patch: entry "triage-probe-ok" not found` | 第一次真机 boot：fixture 行消失 |
| F4 | 三种相位形状各有其名：干净挂载 → `active`；**import 期抛错** → `enabled:true + fiberPhase:null`；**apply 期抛错** → `fiberPhase:"failed"` | 三个 fixture 同 profile 采样：`{active:95, null:4, failed:1}` |
| F5 | 起服务到拿到样本：**6.1 / 7.2 / 7.7 / 8.2 / 9.8 s**（五次，含冷启） | `scripts/lib/live.mjs` 的 `host.seconds` |
| F6 | 本地路径安装：**490–635 ms**（离线、pnpm 已缓存）；真实 registry 安装**本轮未测**，不得假设 |
| F7 | 最小 probe profile **没有 `agentPresets`**（`host_summary.presets = null`），工具注册表全局层读到 **25** 个工具 | 同上，`capabilities.tools.length` |
| F8 | 行 id 在运行时带 group 前缀：声明 `triage-probe-ok` → 运行时 `include:triage-probe-ok` | R12 的 `resolveRuntimeId` 已归一，本轮再次实测 |
| F9 | **就绪探测必须在杀树之前做**。第一版在采到样本后立即 `taskkill`，随后的 HTTP 检查全部 `fetch failed`（端口已死） | 真机绿跑当场暴露；改为「采样 → settle 1s → 探测（重试 5s）→ 杀树」后得到 HTTP 401 |
| F10 | `--port` 不是 launcher flag，而是 **app 参数**：`dsh --profile <p> --patch <o> --port 53052 --no-open` 有效；不带 `--no-open` 探针会打开用户浏览器 | 实测：`--port` 透传后 `dsh web: http://127.0.0.1:53997/?token=…` 并尝试启动浏览器 |
| F11 | 沙盒没有 token → 只想探活时状态码是 **401 或 404**（`redirect:'manual'`）；「端口有应答」不等于「UI 正常」 | 实测两轮：401（`web` 模板）/ 404（更小的 profile） |
| F12 | `client-rendered` / `namespace-diff` 本轮**不可测**，产物必须 `unmeasured` | 未跑浏览器、工具表面在 agent 作用域（BS-21） |

### R15 新增事实（0.2.1-rc.4 + 本机 Chrome 154 / Edge 146）

| # | 事实 | 怎么测的 |
|---|---|---|
| F13 | **`--dump-dom` 在本机不可用**：Edge 146 与 Chrome 154 都返回 0 字节 stdout，并且一直挂到 60s 超时；`--screenshot` 同样失败。**CDP 可用**：`--remote-debugging-port=0` + `<profile>/DevToolsActivePort` + `Runtime.evaluate` 在 1–5s 内拿到 DOM | 2026-10-27 两次对照（`--dump-dom` / `--screenshot` / CDP）；结论：走 CDP，不引入 playwright |
| F14 | **真 Host 的页面会挂载**：`title=DeepSeek Harness`、`#root` 有 1 个子节点、`readyState=complete`、可见文本 289 字符、HTML ≈ 541KB。首帧测量（`readyState=interactive`）只有 24 字符 —— **停在第一帧会把骨架屏当成人已渲染** | spike + `data/results/probe-ok-render-2026-10-27T12-57-25.000Z.json` |
| F15 | token URL 在 stdout 打印（约 spawn 后 10s），浏览器直接导航会拿到 cookie 并落到应用，不需要再手工带 token | spike；`readiness.source=host-url` 已在产物里 |
| F16 | 无头浏览器必须用**独立 profile 目录**（临时目录），退出后用 `taskkill /T` 杀树；Host 端口在 `taskkill` 后确实不再应答 | spike 与 6 次真跑 |
| F17 | 默认（无 `--port` 冲突时）Host 打印的端口与 `plan.port` 一致；产物仍同时记录 `readiness.source`，不一致时以 Host 为准 | `probe-ok-render-2026-10-27T12-57-25.000Z.json`（53052） |
| F18 | **「装成功」不等于「走过网络」**：把 `NPM_CONFIG_REGISTRY` 指向 `http://127.0.0.1:1`，同一候选仍然 `go` —— pnpm store 命中，lockfile 与被测成功那次**逐字节一致**（`sha256=d716fa88…`） | `data/results/probe-registry-unreachable-2026-10-27T13-00-00.000Z.json`（`expectation_met=false`，正是本发现） |
| F19 | **环境变量级的 registry 覆盖被 launcher 中和**：换一个从未装过的候选（`dsh-cost-meter@1.9.41`）仍然 `go`，而我们自己的元数据 fetch 在同一 env 下 `fetch failed`。要测「私有源不可达」必须在 profile 级配置，环境变量不够 | `probe-registry-unreachable-fresh-2026-10-27T13-00-58.000Z.json`；本文件 §9 记未决 |
| F20 | **元数据层分不出 E404 / ETARGET**：`/pkg/<不存在版本>` 也返回 HTTP 404，所以 `resolved.error` 对「包不存在」和「版本不存在」都是 `HTTP 404`；要区分只能读 pnpm 全文 stderr（当前只留最后一行） | `probe-registry-e404-…` 与 `probe-registry-etarget-…` 两份产物 |
| F21 | 真实 registry 安装耗时 **5.4s**（450KB / 1 依赖，冷缓存），boot→sample **7.7s**，渲染 **3.9s**，清理 61ms | `data/results/probe-registry-ok-2026-10-27T12-59-01.000Z.json` |
| F22 | **浏览器错误页有 body 子节点和文本，但没有 `#root`**：指向未监听端口时 Chrome 自己渲染 `ERR_CONNECTION_REFUSED` 页（76 字符），若按 body 子节点判就会拿到 `rendered` —— 所以判定必须要求 `#root`/`#app` 挂载点 | `data/results/render-fixture-error-2026-10-27T13-29-50.000Z.json`（交付后独立复核抓到） |
| F23 | **卡死的渲染线程不回应 `Runtime.evaluate`**：`while(true)` 页面下第一次实现会无限挂（4s 预算跑了 30s+ 仍不返回）；加命令级超时 + 剩余预算封顶后，15s 预算下 **15.0s** 返回 `inconclusive` | `data/results/render-fixture-blocked-2026-10-27T13-30-00.000Z.json` |
| F24 | **profile 级 `.npmrc` 会被 launcher 采纳**（T-305b 的机制）：在临时 `DSH_HOME` 里先用本地 fixture 初始化 profile，再写 `<profile>/.npmrc` 为 `registry=http://127.0.0.1:1/`，随后 `dsh plugin --profile web add dsh-cost-meter@1.9.41` **确实失败**：`ERR_PNPM_RESOLVING_NPM_RESOLVER_NETWORK_ERROR`，日志写着 `Failed to fetch metadata from http://127.0.0.1:1/dsh-cost-meter`，exit 1。对比 F19：env 级 `NPM_CONFIG_REGISTRY` 被中和，**profile 级不被中和** | spike 2026-10-27（一次性临时 home，未留产物；复现命令就是本格描述的两步）。实现见 `T-305b` |
| F25 | **「慢」与「坏」在探针里长得一样**：矩阵实测 `dsh-whale-widget@0.4.2` 在 12.3s 写出样本，但 5s 就绪窗口内 Host 从未打印 `?token=` URL（`fetch failed`），同时探针 hook 报 `cannot get required service "loader" in inactive context`。结论被写成 `blocked`，但根因可能是「树还没 active」而不是插件坏 → 记为 `BS-25` / `T-308` | `data/results/probe-matrix-2026-10-27T14-36-20.000Z.json`（`runs[2]`，`expectation_met=false`） |

### R17 新增事实（0.2.1-rc.4，同一台 Windows 机器）

| # | 事实 | 怎么测的 |
|---|---|---|
| F26 | **哈希选的端口可能根本绑不上**：`buildProbePlan` 用 `53000 + hash%1000` 得到 **53506**，而本机 `netsh int ipv4 show excludedportrange protocol=tcp` 列出 **53461–53560** 为排除段，`net.Server.listen(53506)` 直接 `EACCES`。沙盒 Host 的 `webserver` 行因此 `failed`，`web-runtime` 等 5 行 pending，启动整体失败 —— **候选完全无辜** | 三次真跑同一条命令：`dsh: startup failed: 2 required plugins did not activate` → `webserver (required): listen EACCES: permission denied 127.0.0.1:53506`；`netsh` 输出；Node 直接 bind 复现 |
| F27 | **排除段会在会话中途变化**：同一候选在 15:05 还能起来（193 行、行 `active`），15:20 之后连续三次都是 EACCES 启动失败。**结论**：端口不能是常量或摘要，必须每次向 OS 申请 | 四次真跑的时间线（`probe-whale-*`，本轮临时目录） |
| F28 | **换端口后同一个候选是 `go`**：`findFreePort()`（bind :0 → 取端口 → 关闭）之后，`dsh-whale-widget@0.4.2` boot→sample **5.9–6.8s**、HTTP 401、行 `active`、渲染通过 | `data/results/probe-registry-whale-2026-10-27T17-05-00.000Z.json` · `probe-matrix-2026-10-27T17-20-00.000Z.json`（`runs[3]`） |
| F29 | **`inactive context` 是「我们的 fiber 被 unload 了」，不是「插件坏」**：Cordis 在注入服务缺失时把 `fiber.store` 置 `undefined`（`_unload`），等服务回来**重新跑 apply**。因此同一个 task 里重试同一个 ctx 无效；有效的是「旧 task 不许写文件（代际保护）+ 新 apply 覆盖写出好样本 + Host 等一份可判的样本」 | 读 `@deepseek-ai/cordis/lib/index.js`（`_getImpl`/`_refresh`/`_setEpoch`/`_unload`）+ 五次真跑的三种形状（error / 好样本 / 无样本） |
| F30 | **launcher 的启动诊断是免费的归因**：失败时 stdout 打印 `dsh: startup failed: N required plugins did not activate`，后面逐行列出 `Failed plugins` / `Plugins waiting for services`（含缺失服务名与原始错误）。它一出现就不会再写出样本，等满 120s 是纯浪费 | 一次 EACCES 真跑的完整 stdout（本轮 `boot.error_tail`） |
| F31 | **`apply` 返回 promise 不会让行走形**：把延迟写在 `apply` 里（返回 6s/20s 后 resolve 的 promise），实测行**立刻**就是 `active`、hook 的 `wait_ms` 只有 3.3s —— 也就是说 R17 的 `slow-plugin` 并没有制造出 transient 行，它的 `go` 不能当作「settle 路径」的证据。要让行真的停在 `loading`，必须让**模块导入**变慢（顶层 `await`） | R18 两次对照：老夹具（20s 延迟写在 `apply` 内）→ boot 7.5s、行 active、`go`；改成顶层 await 后同参数 → boot 19.1s、`settled:false`、`unknown` |
| F32 | **真机上两条「慢」的结论不同**：导入慢 6s → `go`（boot 10.1s、`wait_ms` 7.3s、`settled:true`、行 active）；导入慢 20s（超过 15s settle 预算）→ `unknown` + `missing.inventory` + `probe.tree-not-settled`，即使 HTTP 401 有应答也仍是 `http-served: unmeasured` | `data/results/probe-slow-normal-v2-2026-10-27T19-10-00.000Z.json` · `data/results/probe-slow-overrun-2026-10-27T19-20-00.000Z.json` |
| F33 | **真实候选的分布（n=10，pin 版本）**：9 个 `go`（boot 6.2–8.2s），1 个 `blocked` 且失败在**安装**阶段（`@aiwayds/dsh-cron@0.6.1`，pnpm 退出 1；产物只留最后一行 + 端点，读不到 pnpm 的错误码 —— 见 T-310）。清理 17/17 | `data/results/probe-matrix-2026-10-27T20-30-00.000Z.json` · `data/results/d2-2026-10-27T21-00-00.000Z.json` |

### R19 新增事实（0.2.1-rc.4 + pnpm 11，同一台 Windows 机器）

| # | 事实 | 怎么测的 |
|---|---|---|
| F34 | **诊断日志比 launcher 的 stderr 更没用**：`dsh: plugin command failed; diagnostics: <profile>/.plugin-manager/logs/operation-*/pnpm.log` 指向的那个文件**只有 67 字节**——`Command failed with exit code 1: pnpm add "@aiwayds/dsh-cron@0.6.1"`，**没有** `ERR_*` 码。真正的 `Error: ERR_PNPM_IGNORED_BUILDS` ＋ `Ignored build scripts: …` 只打在 launcher 的 **stderr**。`failureEndpoints` 原来只读日志是对的（端点在那儿），但**归因**必须两边都读且以 launcher 优先 | R19 spike：同一候选，launcher stdout/stderr 全文 + 日志全文对比（日志 67 B，stderr 有码） |
| F35 | **D2 里唯一「装不上」的候选其实装上了，死在构建审批**：pnpm 11 默认不执行依赖的 build scripts，输出 `ERR_PNPM_IGNORED_BUILDS` + `help: Run "pnpm approve-builds"`；stdout 同时打印 `+ @aiwayds/dsh-cron 0.6.1`。所以这是**包管理器策略**，不是插件写坏——`blocked` 仍成立（「在这里跑不起来」），但用户下一步动作与 404 完全不同 | 同上 spike（`+ @aiwayds/dsh-cron 0.6.1` 与 `ERR_PNPM_IGNORED_BUILDS` 同一次运行）；`data/results/probe-real-dsh-cron-*.json` |
| F36 | **20s 预算与 20s 未稳定窗口结构重叠**：`fixture-slow-overrun`（顶层 await 20s）实测 boot→sample **21.3s**——`boot(≈5s) + settle 上限 15s`。把它的 `--unsettled-timeout` 从 20s 降到 8s 只省下 ~2.5s（另一次实测 19.6s），因为主导项是 settle 上限而不是那个窗口。R18 的 19.1s 是**运气**，不是性质；因此 D2 的预算判定从 R19 起只对真实候选（`BS-28`）。顺带：`ERR_PNPM_*` 行常与解释分行（`Error: ERR_PNPM_X` 之后才是原因），只取码行等于没归因 | `data/results/probe-matrix-2026-10-28T11-40-00.000Z.json`（21.3s，单列在 `timing.fixtures_over_budget`）· `data/results/d2-2026-10-28T12-10-00.000Z.json` |
| F37 | **沙盒会继承操作者的 npm 凭据**：探针只清了环境变量里的 key/token，但 pnpm 自己读 `~/.npmrc`——同一条装不上的候选，默认环境打出 `An authorization header was used: Bearer npm_[hidden]`（2/2 复现），把操作者的 token 发给了 registry。把 `npm_config_userconfig` 指向沙盒内空文件后，该行消失且安装成功路径不变。**profile 级 `.npmrc` 不受影响**（T-305b 私有源仍成立），因为 pnpm 把 project config 与 user config 分开读 | R20 黑盒对照（不读凭据文件）：`default` 2/2 `authHeaderUsed=true` vs `sandbox-userconfig` 2/2 `false`；产物字段 `install.registry_auth_used` |

**F3 是产品级发现**：`packages/plugin/cordis.patch.yml` 原本正是这个形状——装上去这一行会被**静默丢弃**。R14 已修，并在门 `namespace` 增加 `rows-are-inserted`（双向自测：改回非 insert 即红）。

---

## 3. 步骤机

```
runtime → (profile) → install → boot → http → render → inventory → cleanup
   │          │           │        │      │       │        │          │
   └ 读版本    └ 复制组合   └ 装候选  └ 起 Host└ 探端口 └ 看画面   └ 读相位  └ 必删
```

`profile` 步**只在 `--copy-profile <name>` 时出现**（T-304，R22）：没有复制请求时计划里没有这一步，模板路径的行为一字不动。

| 步 | 输入 | 成功判据 | 失败码 |
|---|---|---|---|
| `runtime` | `--dsh-main <path>`（本轮显式传，不猜 PATH） | `node <main> --version` 有输出且可解析 | `probe.runtime-unavailable` |
| `profile`（T-304） | `--copy-profile <name>` + 真实 `$DSH_HOME/profiles/<name>` | 四个声明文件复制完、`dsh plugin install` 让副本可用、且 `link:`/`file:` 目标逐个 stat 都在 | `probe.profile-copy-unusable`（副本装不上）/ `probe.profile-link-dangling`（悬空链接，F40）——**两者都只能 `unknown`** |
| `install` | 候选 spec（路径 / tarball / npm spec，registry 必须 pin 版本） | 退出码 0 且 profile 的 `package.json` 里出现该包；复制模式下若 pnpm 因**组合自身**的构建审批退出 1，还要读回 `dsh.profile.bundles` 确认候选**真的进了组合**（R22） | `probe.install-failed`（无码）/ `probe.install-failed-code`（有 `ERR_*` 码）/ `probe.install-build-refused`（`ERR_PNPM_IGNORED_BUILDS` **且被拒名单里有候选**，R19/R22） |
| `boot` | profile 名 + 探针 overlay | 探针写出**可判**的样本（无 `{error}` 且 `settled≠false`）。写不出时：launcher 说过 `startup failed` → `blocked`（原文归因）；Host 打印过 URL 或**我们自己的端口**绑不上 → `unknown`；两者都没有 → `blocked` | `probe.startup-failed` / `probe.boot-timeout` / `probe.tree-not-settled` / `probe.port-unavailable` |
| `http` | Host 自打印 URL 的端口（T-306），回退 `plan.port`；URL 与端口**同轮询**（R17） | `redirect:'manual'` 下收到 2xx/3xx/401（303+token、401 无 token 都算活）。**读数不是 `valid` 时本步不出结论**（`unmeasured`） | `probe.http-unreachable`（仅 settled 树） |
| `render` | 同一 URL + 浏览器 | DOM 有挂载点、有可见文本（≥20 字符）、且 `readyState` 前进 | `probe.render-blank`；拿不到结论时 `unmeasured` |
| `inventory` | 样本 | 候选模块对应**恰好一条**运行时行 | `probe.row-missing` / `probe.row-inactive`；`pending/loading/unloading` → `unknown`（`probe.tree-not-settled`） |
| `cleanup` | 沙盒路径 + Host 用过的端口 | 目录不存在且端口不再应答 | `probe.cleanup-incomplete`（`risky`，不改测量结论） |

**硬规则**：

1. `cleanup` 在 `finally` 里执行；任何一步抛错都不许跳过清理；
2. 探针样本是**唯一**的相位来源，执行器不得自己猜相位；
3. 探针行自身必须从评分行里剔除（`excluded`），否则「候选行」与「我们自己的 instrument」会混在一起（R12 的坑）；
4. 候选行的识别口径：`moduleName === candidatePackageName` 且**唯一**；0 条 → `row-missing`，≥2 条 → `unknown`（不猜）；
5. **测量失败不得归给候选**（R17）：`{error}`、`settled:false`、候选行仍 transient、我们自己的端口绑不上——四种形状只能 `unknown` + `missing.*`，唯一例外是 launcher 明说 `startup failed`（那是 Host 自己的判定，照抄原文进 `blocked`）。

---

## 4. 计时契约（分段，禁止用总时长糊）

| 段 | 预算 | 超时 | 实测 |
|---|---|---|---|
| `install` | 不计入 20s（网络与 pnpm 波动不可控） | 本地 60s / registry 180s | 0.53–5.4s（本地 / 真实 registry）；**复制模式的 `profile` 步另计**：首跑 138s（含解析整棵组合后因构建审批失败）→ 加沙盒构建策略后 **18.5–19.7s**（R22） |
| `boot → sample` | **≤ 20s**（M3 出口门禁）—— **T-312 起判的是「第一份样本」**（provisional） | 120s（可配） | R14：11.8 / 12.3 / 13.8s；R15：7.7–8.7s；**R17：6.2–6.9s（12 次真跑）**；**R28（T-312）：`slow-plugin` 5.4s（最终样本 10.7s，仍 `go`）· `slow-overrun` 9.4s（最终样本 24.5s，仍 `unknown`）· 真实候选 `dsh-mcp-connector` 10.1s（最终 25.2s）** |
| `readiness`（settled 树） | **≤ 5s**（**阈值不变**） | 5s | R17：`waited_ms` 10–32ms（URL 与端口同轮询，命中即返回） |
| `readiness`（unsettled 树） | **≤ 20s，可配**（`--unsettled-timeout`）；**该窗口只能产出 `unknown`** | 20s | R17 新增；settled 树的 5s 判据未被放松 |
| `sample 替换等待` | ≤ `--unsettled-timeout`（默认 20s）；**ADR-0008 E 起只对 `{error}` 样本生效** | 同上 | 只对**不可读**样本生效：等 Cordis 重新 apply 覆盖出可判样本（F29）；`settled:false` 立即收敛（R26），产物记 `inventory.replacement_waited` + `replacement_reason`（`unreadable` / `upgrade` / `null`，R29 起）。**升级等待不算替换等待**：T-312 的 provisional→final 等待只进 `upgrade_waited_ms` 与 `replacement_reason=upgrade`（F51） |
| `startup failed` | 立即收敛（不占满 120s） | — | 实测从 126s 降到 ~6s（F30） |
| `render` | ≤ 15s（**独立预算，不进 20s 口径**） | 15s | 1.1–4.2s（`readyState=complete` 即停） |
| `cleanup` | ≤ 5s | 10s | 8–61ms |
| 总时长 | 只记录，不设判据 | — | — |

> `timings.bootToSampleMs` 取 `host.seconds`（spawn→样本）；`steps[boot].ms` 是整步墙钟（含 settle、就绪探测、渲染、杀树与杀后等待，R26 实测 21.7–28.6s）。预算只看前者，两者都进产物，避免「用总时长糊」。 
>
> **T-314 起 `steps[boot]` 的每一段都有独立读数**（`timings.bootSegments`：`spawnMs` / `sampleWaitMs` / `sampleMtimeMs` / `settleMs` / `readinessMs` / `renderMs` / `killMs` / `postKillWaitMs` / `scratchCleanupMs` / `totalMs`）。三段之和必须与 `steps[boot].ms` 相差 ≤100ms（R23 实测三份：15748 vs 15741、48453 vs 48384、16217 vs 16216）；`d2_report.timing.boot_breakdown` 给出各段最大值。**新增 await 时必须加段**，否则又会回到「差额没人解释」。

`install` 超预算时**不得**把总时长写成结论；产物里 `timings` 分段记账。

> **R19 口径（HUMAN 已签，`audit/SIGNOFF.md`）**：`boot → sample ≤20s` 只对**真实候选**判定。一棵永不 settle 的树要 `boot(≈5s) + settle 上限 15s ≈ 21s`，**结构上**不可能达标——R19 实测 `fixture-slow-overrun` = 21.3s（R18 只是恰好 19.1s 才过）。真实候选仍是 100% 必须达标，没有放宽成 90%；夹具耗时照旧进产物，并在 `d2_report` 的 `timing.fixtures_over_budget` 与 `boot-budget` 的 detail 里单列。
> **R29 口径（T-312 新预算口径的第一次完整矩阵，两批）**：用 `matrix-r19.json` 跑两批（`probe-matrix-2026-10-28T08-40-00.000Z.json` / `probe-matrix-2026-10-28T09-40-00.000Z.json`），两批都是 n=20 / 真实 13 / 清理 20-20 / 失败形状 6 / `expectation_misses=0`，`boot→sample` **4.6–9.8s** 与 **4.0–5.5s**，`d2_report` 的 `boot-budget` **12/12**（`d2-2026-10-28T09-20-00.000Z.json` / `d2-2026-10-28T10-20-00.000Z.json`）。**这不撤销 R27 那次红**：同一候选 `dsh-mcp-connector@0.2.83` 在 R27 是 22.5s（最终样本口径）、R28 两次 `unknown`、R29 两批 8.0s / 5.5s（`go`）——这是 `BS-32` 抖动的第三、四次观测，不是「修好了」。
> **R21 口径（ADR-0006 第 1–3 条，2026-10-28 采纳 + 同日实测纠正）**：**「20s」是测量预算（`spawn→sample`），不是墙钟承诺。** 实测（`d2_report.timing.wall_clock`）：正常 `go` 候选的 `boot` 步要 **22.1–25.3s**，永不 settle 的夹具 **42.7s**。对外只能说「可判的候选 `boot→sample` ≤20s；一次 probe 的实际等待约 25s；不可判的约 43s」——**不许**说「任何一次 probe 都 ≤20s」。
> **R23 口径（T-314 实测，覆盖上面那句的墙钟数字）**：`boot` 步已分段计时（`timings.bootSegments`）。三份真机产物给出结构：
>
> | run | `boot` 步 | sample | 替换等待 | settle | readiness | render | 杀树 | 杀后等待 | 删除 |
> |---|---|---|---|---|---|---|---|---|---|
> | 模板 + 正常夹具 | 15.7s | 6.3s | 0.24s | 1.01s | 0.04s | **4.73s** | **2.21s** | 1.21s | 0.002s |
> | 复制组合 + 正常夹具 | 16.2s | 6.3s | 0.19s | 1.01s | 0.04s | **4.72s** | **2.71s** | 1.21s | 0.001s |
> | 永不 settle | **48.4s** | 19.1s | **20.27s** | 1.01s | 0.04s | 4.50s | 2.20s | 1.22s | 0.001s |
>
> - 正常候选的差额 = **render ≈4.7s + 杀树 ≈2.2–2.7s + 杀后固定等待 1.2s + settle 1.0s**（与 settle 上限无关）；
> - 不可判 = **48.4s**，主导项是**为一份可判样本再等一整个替换窗口（20.3s）**；hook 自己的 settle（15s 上限）**已含在 sample 里**；
> - 对外口径：**可判 ≈16s；不可判 ≈48s**。旧数字（25s / 43s）作废。
> - **这笔 20.3s 是「为一份可判样本再等一整个替换窗口」**，不是 settle。要改它必须签 `docs/adr/0008-unsettled-wait.md`（提议中，默认值**未动**）：`scripts/report_replacement_window.mjs` 扫 29 份产物，4 次不可判样本里**替换从未出现**（`attempts` 全 1、`applies` 全 1），同一夹具把窗口从 20s 降到 1s 只省时间、结论仍是 `unknown`（`measured_saving_ms = 19092`）。
> **R26 口径（`ADR-0008` 方案 E 已实施）**：替换窗口**只对 `{error}` 样本打开**；`settled:false`（hook 已花完自己的 settle 预算后写下的最后读数）立即收敛。同一夹具真跑：不可判的 `boot` 步 **48.4s（R23）→ 28.6s（R26）**（`data/results/probe-adr0008e-overrun-2026-10-28T22-30-00.000Z.json`；`inventory.replacement_waited=false`、`waited_ms=0`、`samples=1`、`stoppedBy=readable-sample`），差额正是被删掉的替换窗口。同轮另两份：`slow-plugin` = `go`（`boot` 步 25.4s / `boot→sample` 14.7s / 渲染 5.4s）、真实候选 `dsh-status-rotator@0.38.0` = `go`（`boot` 步 21.7s / `boot→sample` 11.5s / 渲染 4.9s）。
> - ⚠️ R26 同时暴露一件事：**sample 等待本身在波动**（同机同夹具 11.5–22.7s，取决于 Host 组合出行的时刻），所以墙钟只能给区间：**R26 三次真跑 21.7–28.6s**（`BS-32`）。**不许**把任何一次实测的秒数写成产品承诺；预算仍只看 `spawn→sample`，夹具仍单列。
> **仍未解决**：默认 `--unsettled-timeout 20000` 与 hook 的 `settle 15s` **没有动**（方案 A/C 未授权）。要把「不可判」也压进 20s，只能改 settle 上限（少测）或改两阶段取样（T-312）。
> **未解决**：默认 `--unsettled-timeout 20000` 本身就可能让一次真实探针超过 20s 的产品承诺。改默认值属于阈值变更，需要 ADR + HUMAN 签（`BS-28` / T-311）。

---

## 5. 断言 → 结论映射

产物 `assertions[]` 每项带 `status ∈ passed / failed / unmeasured`。**未测的断言必须出现在产物里并标 `unmeasured`**，不许省略。

| assertion | 本轮状态 | 依据 |
|---|---|---|
| `boot-sampled` | 测 | 样本文件存在、可解析、且**可判**（无 `{error}`、`settled≠false`）。没写出样本但 Host 打印过 URL → `unmeasured`（不是 `failed`） |
| `http-served` | 测 | `redirect:'manual'` 的状态码。**读数不是 `valid` 时本项必须 `unmeasured`**：树还在动时的静默端口回答不了这个问题（R17） |
| `client-rendered` | **测（需浏览器）** | 真浏览器 + CDP 读 DOM：**必须存在 `#root`/`#app` 挂载点**、其子节点 ≥1、可见文本 ≥20 字符、`readyState` 非 `loading`；无挂载点（浏览器错误页 / 非挂载文档）→ `inconclusive`；有挂载点但零可见文本（canvas/icon-only）→ `inconclusive`；无浏览器 → `unmeasured` |
| `inventory-active` | 测 | 候选行的 `fiberPhase`；读数不可判时 `unmeasured`。**复制模式下若组合没被更新（`install` 失败且 `candidate_registered≠true`）或副本本身不可用，`boot-sampled` / `http-served` / `inventory-active` 必须一起 `unmeasured`**——候选根本没被 boot（R22） |
| `cleanup-complete` | 测 | 目录 + **所有** Host 用过的端口双重判据 |
| `namespace-diff` | **unmeasured**（T-303） | 工具表面在 agent/preset 作用域（R13 的 `BS-21`） |

结论：

| 情形 | conclusion | confidence.basis |
|---|---|---|
| 五步全过 + 候选行 `active` + 页面挂载出内容 | `go` | `measured-local`（high） |
| 候选行 `failed` / `null` / 不存在 | `blocked` | `measured-local`（high） |
| **HTTP 有应答但页面没挂载出内容（白屏）** | `blocked` + `probe.render-blank` | `measured-local`（high） |
| 渲染检查得不出结论（浏览器崩/超时） | `unknown` + `missing.render` | `measured-local` |
| install / boot / http 失败（**settled 树**） | `blocked` | `measured-local`（high） |
| **launcher 说 `startup failed`** | `blocked` + `probe.startup-failed`（原文进 `params.detail`） | `measured-local`（high） |
| **读数不可判**（`{error}` / `settled:false` / 候选行 transient / 我们的端口绑不上 / Host 起了但探针没写出样本） | `unknown` + `missing.inventory` 或 `missing.probe` | `measured-local` |
| 清理不干净 | `risky`（结论仍引自测量） | `measured-local` |
| 运行时与候选声明不匹配 / 候选行 ≥2 条 / 样本读不出 | `unknown` + `missingEvidence` | `measured-local` |

**永远不出现**：`go` 被读成「能正常使用」。渲染判据只回答「挂没挂载出可见 DOM」，不回答功能对不对；渲染时的 `go` 文案必须带限定（见 §7）。

---

## 6. 产物 schema（`data/results/probe-<stamp>.json`）

```jsonc
{
  "schema_version": 1,
  "produced_by": "scripts/record_probe.mjs",
  "generated_at": "2026-10-27T00:00:00.000Z",
  "candidate": { "spec": "tests/fixtures/probe/ok-plugin", "package": "triage-probe-fixture-ok", "kind": "path" },
  "runtime": { "source": "sandbox/upstream/0.2.1-rc.4/install", "version": "0.2.1-rc.4", "dsh_main": "<repo>/…/bin.js" },
  "sandbox": { "home": "<temp>/…", "profile": "probe", "overlap_check": "disjoint", "env_scrubbed": true },
  "steps": [{ "id": "install", "status": "passed", "ms": 640, "argv": ["<node>", "<dsh-main>", "plugin", "--profile", "probe", "add", "<candidate>"] }],
  "timings": { "installMs": 5394, "bootToSampleMs": 7700, "httpMs": 0, "renderMs": 3930, "cleanupMs": 61 },
  "readiness": { "source": "host-url", "port": 53052, "outcome": "served", "waited_ms": 10, "window_ms": 5000, "url_seen": true },
  "boot": { "url_printed": true, "first_line": "dsh web: http://127.0.0.1:53052/?token=<redacted>", "error_tail": null, "startup_failed": false, "bind_failed_ports": [] },
  "sandbox": { "home": "<temp>/…", "profile": "probe", "port_origin": "allocated", "port": 53052, "overlap_check": "disjoint", "env_scrubbed": true },
  "render": { "status": "rendered", "detail": "mount root with 1 child(ren), 289 visible chars", "ms": 1785, "signals": { "ready_state": "complete", "root_children": 1, "text_length": 289, "html_bytes": 540955 } },
  "install": { "lockfile": { "present": true, "bytes": 1717, "sha256": "…" }, "exit_code": 1, "endpoints": ["http://127.0.0.1:1/dsh-cost-meter"], "diagnosis": { "code": "ERR_PNPM_IGNORED_BUILDS", "key_line": "Ignored build scripts: @aiwayds/dsh-cron@0.6.1", "source": "launcher" }, "registry_auth_used": false },
  "assertions": [{ "id": "boot-sampled", "status": "passed", "detail": null }, { "id": "client-rendered", "status": "passed", "detail": "rendered: mount root with 1 child(ren), 289 visible chars" }],
  "inventory": { "transport": "in-process-projection", "entries": 98, "settled": true, "error_code": null, "attempts": 1, "applies": 1, "candidate_rows": [{ "entryId": "include:triage-probe-ok", "phase": "active" }], "excluded": ["include:triage-probe-ok"?] },
  "verdict": { "conclusion": "go", "reasons": [], "evidence": [], "missingEvidence": [] },
  "limits": ["no security judgement", "no client render check", "sandbox runtime, not the user's machine"]
}
```

约束：

- 脱敏：任何绝对路径先过 `makeRedactor`（R13 的 `file:///` + 百分号编码坑）；
- 确定性：同输入同结论；时序只进 `timings`，不参与判定；
- 可重算：`.sha256` 是**纯 hash**（R12 的坑）。

---

## 7. 文案与命名空间

新增 `probe.*` 原因码（**三处同改**：`messages.ts` 中英 / 门 `verdict-contract` 白名单 / `docs/05` §3）：

`probe.served`（info）· `probe.row-active`（info）· `probe.render-ok`（info，R15）· `probe.render-blank`（block，R15）· `probe.render-unmeasured`（warn→unknown，R15）· `probe.port-mismatch`（warn，R15）· `probe.row-inactive`（block）· `probe.row-missing`（block）· `probe.install-failed`（block）· `probe.boot-timeout`（block）· `probe.http-unreachable`（block，**仅 settled 树**）· `probe.runtime-mismatch`（warn→unknown）· `probe.cleanup-incomplete`（warn）· **`probe.tree-not-settled`（warn→unknown，R17）** · **`probe.startup-failed`（block，R17）** · **`probe.port-unavailable`（warn→unknown，R17）** · **`probe.install-failed-code`（block，R19）** · **`probe.install-build-refused`（block，R19）** · **`probe.profile-copy-unusable`（warn→unknown，R22）** · **`probe.profile-link-dangling`（warn→unknown，R22）** · **`probe.profile-build-refused`（warn，R22，可伴随 `go`）**

> 新增文案一律**只加不改**：给已有 messageId 增加 `{占位符}` 会让 `data/results` 里的历史产物在门 `verdict-contract` 变红（HANDOFF 坑表）。R19 的三条安装归因因此是**新 messageId**，`probe.install-failed` 原样保留（无码时仍用它）。

`go` 的渲染必须包含限定：**「仅证明装得上 + Host 起得来 + 端口有应答 + 行在跑（+ 页面有可见内容），不证明功能」**。

---

## 8. 负对照（必须能红）

| # | 注入 | 期望 |
|---|---|---|
| N1 | 沙盒 home = 真实 `~/.dsh` | 拒绝执行（`sandbox-overlaps-real-home`） |
| N2 | 不传 `--execute` | 只打印计划，**不 spawn 任何进程**（e2e 断言） |
| N3 | install 失败 | `blocked` + `probe.install-failed`，且清理仍执行 |
| N4 | boot 不写样本 | `blocked` + `probe.boot-timeout`，不把「进程活着」当成功 |
| N5 | HTTP 不应答 | `blocked` + `probe.http-unreachable` |
| N6 | 候选行不存在 | `blocked` + `probe.row-missing` |
| N7 | 候选行 `failed` | `blocked` + `probe.row-inactive`，并点名相位 |
| N8 | 候选行匹配到 2 条 | `unknown`，不猜 |
| N9 | 清理失败 | `risky` + `probe.cleanup-incomplete`，测量结论不变 |
| N10 | 把 `client-rendered` 写成 `passed` 而无观测 | 单测红（`run.render === null` → 必须 `unmeasured`） |
| N11 | 静态页 `200 + 空 <div id="root">`（真浏览器） | `blank` → `blocked` + `probe.render-blank`（`scripts/record_render_fixture.mjs --mode blank`） |
| N12 | 机器上没有浏览器 | `client-rendered: unmeasured` + 原因文本，**不得**是 passed/failed |
| N13 | 渲染检查得不出结论（调试端口没开） | `unknown` + `missing.render`，不得判 `go` |
| N14 | 只跑到第一帧（`readyState=interactive`）就收工 | 判定必须继续等 `complete`，且可见文本要**两次读数一致**才算稳定（F14） |
| N15 | 就绪端口用 `plan.port` 而 Host 打印了另一个端口 | 以 Host 为准；`cleanup` 必须证明两个端口都关 |
| N16 | 浏览器错误页（`ERR_CONNECTION_REFUSED`：有 body 子节点和文本，但没有 `#root`） | **`inconclusive`**，不得判 `rendered`（`--mode error`，R15 复核抓到的假绿） |
| N17 | 渲染线程被卡死（`while(true)`） | 仍在预算内返回（实测 15.0s / 15s 预算）；命令级超时 + 剩余预算封顶，**不得挂死**（`--mode blocked`） |
| N18 | 有挂载点但零可见文本（canvas/icon-only） | `inconclusive`，不得判 `blank`（否则冤枉真 UI） |
| N19 | 样本 `settled:false` + 端口静默 | `unknown` + `missing.inventory`（`probe.tree-not-settled`），**不得** `blocked` |
| N20 | 样本 `settled:true` + 端口静默 | 仍 `blocked` + `probe.http-unreachable`（防止修复变成「全都 unknown」） |
| N21 | 候选行相位 `pending`/`loading` | `unknown`，**不得** `probe.row-inactive` |
| N22 | 没写出样本，但 Host 打印过 `?token=` URL | `unknown` + `missing.inventory`；`boot-sampled: unmeasured`（**不得** `failed`） |
| N23 | Host 报绑定失败，且失败端口 = 探针自己选的端口 | `unknown` + `missing.probe` + `probe.port-unavailable`（**不得**算到候选头上） |
| N24 | 显式把 `--readiness-timeout` 调成 1000 | 如实 `readiness.outcome='timeout'` / `waited_ms≈1000`，不静默升级成 `served` |
| N25 | launcher 打印 `startup failed` | 立即收敛（不等 120s），`blocked` + `probe.startup-failed`，`params.detail` 是原文 |
| N26 | 安装失败且 launcher stderr 带 `ERR_*` 码 | `blocked` + `probe.install-failed-code`，`params.code` 就是那个码（**不得**退回「退出码 1」） |
| N27 | 码只在诊断日志里（launcher 没打） | 仍能点名，且 `install.diagnosis.source = "diagnostics-log"`（来源不许编） |
| N28 | 安装失败但两边都没有码 | `blocked` + `probe.install-failed`（旧文案），**不得**伪造一个码或空 `detail` |
| N29 | 包管理器 URL 带凭据 / 查询串 | `key_line` 里不出现 userinfo、`?token=`、`#frag`（与端点同一套纪律） |
| N30 | `ERR_PNPM_IGNORED_BUILDS` | `blocked` + `probe.install-build-refused` + `remediation.install-build-refused`（**不是**「插件写坏了」） |
| N31 | 操作者机器上有 `~/.npmrc`（含 token） | 沙盒安装**不得**发送凭据：`install.registry_auth_used=false`；把 `npm_config_userconfig` 指回真实路径时该标志变 `true`（R20 黑盒对照 2/2） |
| N32 | 复制的组合自己的依赖装不上（`ERR_PNPM_FETCH_404`） | `unknown` + `missing.probe` + `probe.profile-copy-unusable`；**没有** `install`/`boot` 步（候选没得到机会），断言 `boot-sampled` 等必须 `unmeasured`（R22） |
| N33 | 复制的组合里有 `{"x":"link:./not-here"}`，`plugin install` **exit 0** | `unknown` + `probe.profile-link-dangling`（`count`/`links` 点名），产物里 `dangling_links` 与 `install.exit_code=0` 同时存在（F40，R22） |
| N34 | 构建审批拒绝的是**复制组合**自己的依赖（被拒名单里没有候选） | 复制模式下读回 `dsh.profile.bundles`：候选已注册 → 可 `go` + `probe.profile-build-refused`（warn）；未注册 → `unknown`（**不得** `probe.row-missing`/`blocked`，R22） |
| N35 | 构建审批拒绝名单里**有**候选 | 仍 `blocked` + `probe.install-build-refused`（复制模式不放宽这条，R22） |
| N36 | 被拒名单读不出来（只有 `Ignored build scripts:` 一行头） | 保守判 `blocked`，**不得**借「读不到」换取宽松（R22） |
| N37 | 复制模式启动失败且组合的构建被跳过 | `unknown` + `missing.probe`（未构建的原生模块可能是原因，不能算到候选头上）；候选自己的 install 失败不受此影响（R22） |

---

## 8.5 T-304 真实组合复制（R20 取证 → **R22 实现**）

> 目的：probe 原来只能回答「加到**模板** profile 会不会挂」，T-304 回答「加到**我的**组合会不会挂」。

用法：`dsh-triage probe <pkg> --copy-profile <name> [--execute --dsh-main …]` / `node scripts/record_probe.mjs --copy-profile <name>`。
沙盒 profile 名默认继承源名（`--profile` 显式给出才改名），产物记 `sandbox.profile_origin = "copy:<name>"` 与 `sandbox.profile_source`。

| # | 实测事实 | 怎么测的 |
|---|---|---|
| F38 | **复制声明就够启动**：把真实 profile 的 `package.json` / `cordis.yml` / `cordis.patch.yml` / `pnpm-workspace.yaml` 四个文件复制进沙盒 `profiles/<name>`（**不复制** `node_modules`、不复制 `.plugin-manager/logs`、不复制任何凭据），Host 仍能起：打印 URL、HTTP 401。说明 bundles 由运行时 install 提供，声明层足够 | R20 spike（复制真实 `~/.dsh/profiles/web` → 沙盒，`--port 0 --no-open`，20s 内出现 `?token=` URL） |
| F39 | **带第三方依赖的副本要先装一次**：`dsh plugin <args>` 直接把参数转发给 pnpm，所以 `dsh plugin --profile <p> install` 会按复制来的 `package.json` 装依赖（实测 0.5s，store 命中；`node_modules` 出现），随后 Host 起得来（401）。`dsh` **不会**在 boot 时自动装 profile 依赖（R12 的老坑） | R20 spike：复制 + 注入 `dsh-unlag@1.12.5` → `plugin install` → boot |
| F40 | **`link:` 依赖会「假成功」**：`{"local-thing":"link:./not-here"}` 的 `plugin install` **exit 0** 并打印 `+ local-thing <- not-here`（真实路径不存在），`node_modules` 也建了。也就是说「装成功」不代表组合可用，T-304 必须**逐个检查 `link:`/`file:` 目标是否在沙盒里存在**，否则会把悬空链接当证据 | R20 spike 三组对照：不存在包 → `ERR_PNPM_FETCH_404`（exit 1）；`link:` → exit 0 但目标不存在；`file:./nope.tgz` → exit 1（原文「as it does not exist」） |
| **F41** | **复制一个真实组合，`plugin install` 会因 pnpm 的构建审批**（`ERR_PNPM_IGNORED_BUILDS`）**退出 1，哪怕每个包都装上了**。被拒名单是组合自己的依赖（`@deepseek-ai/dsh-subprocess-local` / `@google/genai` / `koffi` / `node-pty` / `protobufjs`），不是候选。**这是「复制组合」与「模板组合」最重要的差别**：模板路径里 pnpm 只报候选 | R22：`--copy-profile upstream`（沙盒 0.2.1-rc.4 的 composed profile），14 次真跑前 3 次均 exit 1 + 138s |
| **F42** | **`plugin add` 在 pnpm 非 0 退出时只写 `dependencies`，不写 `dsh.profile.bundles`**（手工复现：`triage-probe-fixture-ok` 出现在 dependencies，bundles 仍是 2 个）。所以「装失败还继续 boot」会得到 `row-missing` —— 一个把包管理器策略算成插件缺陷的 `blocked` | R22 手工复现（`repro-profile-add`）：逐字段对比 add 前后 `package.json` |
| **F43** | **沙盒 profile 的 `pnpm-workspace.yaml` 写 `strictDepBuilds: false` 能让同一操作退出 0 并注册 bundle**，而**不批准任何构建**（`onlyBuiltDependencies` 仍为空、`Ignored build scripts:` 照旧打印）。`.npmrc` 里的同名设置**无效**（exit 1） | R22 两组对照（`repro-pnpm-policy`）：`workspace-strict-false` → exit 0 + `registered=true`；`npmrc-strict-false` → exit 1 |
| **F44** | 复制模式真机 `go`：`copy:upstream` + `ok-plugin` → boot→sample **7.4s**、HTTP 401、渲染 2182ms、候选行 `active`、`registry_auth_used=false`；候选确实进了组合（`candidate_registered=true`） | `data/results/probe-copy-profile-ok-2026-10-28T14-30-00.000Z.json` |
| **F45** | 两个负形状都真跑过：装不上 → `ERR_PNPM_FETCH_404` → `unknown`（只有 runtime/profile/cleanup 三步）；悬空 → **install exit 0** 但 `link:./not-here` 不存在 → `unknown`，`dangling_links` 点名 | `probe-copy-profile-unusable-2026-10-28T14-40-00.000Z.json` / `probe-copy-profile-dangling-2026-10-28T14-50-00.000Z.json` |
| **F46** | **`ADR-0008` 方案 E 落地后，不可判的墙钟从 48.4s 降到 28.6s**：同一 `slow-overrun-plugin`，`inventory.replacement_waited=false`、`waited_ms=0`、`samples=1`、`stoppedBy=readable-sample`——**没有再等替换窗口**（R23 那 20.3s 就是它），结论仍 `unknown` + `missing.inventory` | `data/results/probe-adr0008e-overrun-2026-10-28T22-30-00.000Z.json`（对照 R23 的 `probe-boot-segments-overrun-…17-10-00`） |
| **F47** | **sample 等待本身在波动**：同一台机器、同一批夹具，hook 写出样本的时刻受 Host 组合时间影响 —— R26 三次真跑 `boot→sample` 11.5s / 14.7s / 22.7s（行相位分别是 active / active / null），`boot` 步 21.7–28.6s；R18 的 `slow-plugin` 只有 10.1s。因此墙钟只能给**区间**，预算仍只判 `spawn→sample`（`BS-32`） | `probe-adr0008e-slow-2026-10-28T22-40-00.000Z.json` · `probe-adr0008e-real-2026-10-28T22-50-00.000Z.json` |
| **F48** | **真 hook 会写 `{error}`，而且执行器为它等满整个窗口**（T-316）：用 `--hook-config` 把 hook 的 `resolveFrom` 指向一个没有 projection 包的 profile，**真实的 `inventory-hook.mjs`** 就写出 `error.code=projection-missing`、`settled:false`；执行器 `replacement_waited=true`、`waited_ms=5203`（窗口 5000）、`stoppedBy=unreadable-window`，结论仍是 `unknown` + `missing.inventory` + `probe.sample-unreadable`。**这就是 E 的反面**：`settled:false` 等 0ms，`{error}` 等满窗口 | `data/results/probe-adr0008e-hook-error-2026-10-29T00-10-00.000Z.json`（`unknown`，`inventory.error_code=projection-missing`） |
| **F49** | **复制源的 `nodeLinker: hoisted` 不会打断候选行识别**（T-315 遗留项）：把 `nodeLinker: hoisted` 写进复制源自己的 `pnpm-workspace.yaml`（`pnpm_policy=source`，沙盒不覆盖用户文件），install exit 0、`candidate_registered=true`、候选行 `include:triage-probe-ok` 相位 `active`、渲染通过 → `go`。**边界**：产物证明「这种形状不会把候选判丢」，**不证明** pnpm 真的切到了 hoisted 布局（布局未记录在产物里） | `data/results/probe-t315-node-linker-2026-10-29T00-40-00.000Z.json` |
| **F50** | **两阶段取样（T-312）把「预算」和「慢候选」解耦**：hook 先在**第一次读到树**时写出 `provisional: true` / `settled: false` 的样本，settle 循环结束后再覆盖成最终样本；执行器判 `boot→sample` 用**第一份**，等最终样本的窗口取「样本自报的 `settle_timeout_ms` + 1s」。真机三例：`slow-plugin` 第一份 **5.4s** / 最终 10.7s / **仍 `go`**（行 active）；`slow-overrun` 第一份 **9.4s** / 最终 24.5s / 仍 `unknown`；真实候选 `dsh-mcp-connector@0.2.83` 第一份 **10.1s** / 最终 25.2s / `settled:false` → `unknown`（该候选今天两次复测都未在 hook 的 15s 内稳定）。**代价**：不可判的墙钟从 ≈28.6s 升到 ≈30.4s（多了等最终样本的 15s，但因为第一份已经给了答案，**预算不再被顶穿**） | `data/results/probe-t312-slow-2026-10-29T04-00-00.000Z.json` · `probe-t312-overrun-b-2026-10-29T04-40-00.000Z.json` · `probe-t312-mcp-2026-10-29T04-20-00.000Z.json` |
| **F51** | **T-312 让 `inventory.replacement_waited` 说错了话（R29 发现并修，`BS-33`）**：样本循环原来把「已经拿着样本还要再睡」一律记成 replacement wait，而 T-312 之后唯一的睡前场景还包括可读的 provisional（升级等待）。R29 第一批矩阵 **20/20** 都写着 `replacement_waited=true` + `stopped_by=readable-sample` + `upgraded=true`，且 `replacement_waited_ms == upgrade_waited_ms`（`real-status-rotator` 4198/4198）——与 R26 起文档教读者判断的方向**相反**。**修法只改读数**：`waited` 只在样本不可读时置 true、替换窗口时长在读到可读样本那一刻结算、新增 `replacement_reason`，升级等待经 `upgrade_waited_ms` 与 `measurementDetail` 的 `upgrade=waited(…)` 暴露。修后重跑同一 plan：**20/20 `replacement_waited=false` + `replacement_reason=upgrade`**，结论与修前批次逐条相同（12 `go` / 1 `blocked` / 1 夹具 `unknown`）。**读旧产物要注意**：R28 的 `probe-t312-*` 与 R29 批次 A 的该字段是旧语义 | `data/results/probe-matrix-2026-10-28T08-40-00.000Z.json`（修前）· `probe-matrix-2026-10-28T09-40-00.000Z.json`（修后）· `tests/unit/probe-host-sample.test.ts` |

**T-304 的退出条件（R22 全部达成）**：

1. ✅ `probe --copy-profile <name>`：只按白名单复制声明文件，产物记 `sandbox.profile_origin = "copy:<name>"` 与复制清单（`profile_copy.files` / `.missing`）；
2. ✅ 复制后跑一次 `plugin install`；**失败时只能 `unknown`**（`probe.profile-copy-unusable`）+ `missing.probe`，且**不跑** `install`/`boot` 步；
3. ✅ `link:`/`file:` 依赖逐个 stat，悬空即 `unknown`（`probe.profile-link-dangling`），**install 退出 0 也不放过**；
4. ✅ 源 profile 与沙盒重叠时拒绝执行（`profile-source-overlaps-sandbox`，双向判）；
5. ✅ 真跑「复制组合 + 候选」并给出三种形状（成功 / 装不上 / 悬空链接）。

**构建审批的边界（R22，必须一起读）**：

- 沙盒**从不批准**任何构建脚本；`strictDepBuilds: false` 只把「错误」降为「提示」，被跳过的包一律进 `install.ignored_packages`；
- 该设置**只在源 profile 自己没有 `pnpm-workspace.yaml` 时**写入；用户自带的一律不覆盖（`profile_copy.pnpm_policy = "source"`），此时若仍是 `ERR_PNPM_IGNORED_BUILDS`，结果就是 `unknown`；
- 因此「复制模式 `go`」的准确含义是：**声明层完全一致、依赖装齐、但原生模块未在沙盒里构建**。它是 `BS-30` 说的那条缝，不许说成「在我机器上验证过」。

---

## 8.6 凭据来源审计（T-313 / `BS-29`，R23）

**问题**：R20 只堵住了 `~/.npmrc` 一条路径，其余来源（pnpm 自己的 rc、全局 npmrc、`PNPM_HOME`、corepack、代理凭证）**没有逐一验证**，所以「沙盒里没有凭据」当时仍是一句声明。

**探测器换成了本地假 registry**（`scripts/audit_credential_sources.mjs`）：在 127.0.0.1 起一个服务，记录每个请求的 `authorization` 头。
为什么不用 pnpm 的日志：R23 实测「合成 token + 真实 userconfig」**不会**打印 `An authorization header was used`——靠日志会把一条活着的来源判成「没问题」，正是最危险的假阴性。同理，**child 必须异步 spawn**：`spawnSync` 会阻塞事件循环，同进程里的假 registry 永远答不了，pnpm 会挂到被杀（R23 真踩了三次 90s）。

**三组对照（每个来源 × 两种 registry 应答）**：

| 组 | 环境 | 回答什么 |
|---|---|---|
| `routed` | 去掉 profile 的 `.npmrc`，来源自己带 `registry=` | 这个旋钮**是否被读**（有流量到假 registry 即为被读） |
| `opened` | profile 指回假 registry，来源只带 token（在 mitigation 之后注入） | 这个来源**是否活着**（token 会不会上网） |
| `closed` | 同上，但先注入再走我们发布的 env | 今天的沙盒**还漏不漏** |

**为什么需要 401 模式**：凭据可能只在被挑战时才发。`404`（不存在）与 `401`（要求认证）各跑一遍。

**实测（`data/results/credential-sources-2026-10-28T19-00-00.000Z.json`，10 组）**：

| 来源 | knob | 会被读？ | 会带 token？ | 今天的沙盒 |
|---|---|---|---|---|
| **user npmrc** | `npm_config_userconfig` | ✅ | ✅（404 与 401 都 2/2） | **不外发**（由 `sandboxNpmEnv` 挡住） |
| 全局 npmrc | `npm_config_globalconfig` | ❌ | ❌ | 不适用（旋钮未被读） |
| pnpm 自己的 rc | `XDG_CONFIG_HOME/pnpm/rc` | ❌ | ❌ | 不适用 |
| pnpm 全局 bin 目录 | `PNPM_HOME` | ❌ | ❌ | 不适用 |
| corepack | `COREPACK_HOME` | ❌ | ❌ | 不适用 |
| 代理 | `HTTPS_PROXY` 带 userinfo | — | 不进 registry | 我们的脱敏会去掉 userinfo（`http://u:p@h` → `http://h`） |

- **对照组**：不注入任何凭据 → 假 registry 收到 2 个请求、`authorization` 出现 0 次（证明探测器只在有凭据时响）；
- 全部 30 次运行的 install **都失败**（候选不存在），所以「没带 token」不是「没发请求」；
- **`BS-29` 因此收窄而不是关闭**：结论是「本轮审计的六类来源里，只有 user config 会被读，且已被挡在线上（两种应答模式各测一遍）」，仍有限制：① 只覆盖环境旋钮能移到的来源；② 只有 Windows / 一个 pnpm 版本 / 一个 launcher 版本；③ 量的是**读取路径**，不是「你机器上真的有没有 token」。

---

## 9. 未决

| 项 | 状态 |
|---|---|
| registry 候选的真实安装时长与失败形状 | **R15 开始有分母**：成功 5.4s（`dsh-plugin-model-proxy@0.1.6`，450KB/1 依赖）；E404 与「版本不存在」都是 `blocked`，但元数据层分不出两者（F20）。**R17**：矩阵 n=7（真实启动 2 次 / 合成失败 5 次）。**R19**：n=20（真实 13 / 夹具 4 / 合成 3），真实 12 `go` / 1 `blocked`；boot 9.6–18.x s。安装失败**现在能点名错误码**（F34/F35）：`ERR_PNPM_IGNORED_BUILDS` / `ERR_PNPM_NO_MATCHING_VERSION` / `ERR_PNPM_RESOLVING_NPM_RESOLVER_NETWORK_ERROR` |
| **20s 预算 vs 20s 未稳定窗口** | 两者结构重叠：永不 settle 的树 ≈ 21s（`boot→sample`），必然超预算（`BS-28`）。R19 起 `boot-budget` 只判真实候选（HUMAN 签），夹具单列。**R26**：`ADR-0008` 方案 E 已实施（`settled:false` 不再等替换窗口），同一夹具墙钟 48.4s → 28.6s；但 `settle 15s` 与 `--unsettled-timeout` 默认值**仍未动**——「不可判也压进 20s」仍需 T-312（两阶段）或改 settle 上限 |
| 私有源 / 不可达 registry 的失败形状 | **R16 已测**（F24，profile 级 `.npmrc`）；R17 未重测 |
| `namespace-diff`（T-303） | 需要 agent/preset 作用域（T-202a），仍 `unmeasured` |
| 渲染判据的强度 | 只判「`#root`/`#app` 挂载 + 可见文本 ≥20 字符 + 文本两次读数稳定」。骨架屏与内容区的区别靠「等 `complete` + 文本稳定」近似，**不是**视觉回归 |
| 渲染的耗时 | 15s 是**循环预算**；阻塞渲染器的实测总耗时 15.0s（命令级超时 + 剩余预算封顶） |
| 引擎差异 | Windows（Chrome 154 / Edge 146）+ **Linux CI（ubuntu-latest 自带 Chrome 155）** 都跑过同一套对照（`ADR-0005`） |
| **端口排除段** | R17 实测本机 53461–53560 被排除且**会变化**。现在每次 `findFreePort()` 向 OS 申请，产物记 `sandbox.port_origin=allocated`；仍存在「释放到 Host 绑定」之间的竞态，届时由 `probe.port-unavailable` 兜底。**未测**：Linux/macOS 上是否有等价排除段（CI 目前不跑真 probe） |
| **「慢到超过 settle 预算」的真机样本** | ✅ **R18 已补**（F31/F32）：`slow-overrun-plugin`（顶层 await 20s）真机 `unknown` + `missing.inventory`；同批 `slow-plugin`（6s）是 `go`。⚠️ R17 的写法（延迟在 `apply` 里）**没有**制造 transient 行，R18 已换成顶层 await 并重采 |
| **`settled:false` 时的等待成本** | **R26 已改（`ADR-0008` E）**：不可判样本**不再**等一份替换（默认 20s）——只有 `{error}` 才等，因为只有它可能被 Cordis 的新 apply 覆盖。代价是「`settled:false` 后来被替换成可判样本」这条恢复路径消失；29 份历史产物里它**从未出现**（`replacements_observed=0`），且两种情形本来就只可能出 `unknown`，不会把结论变坏。回归见 `ADR-0008` §实施记录 |
