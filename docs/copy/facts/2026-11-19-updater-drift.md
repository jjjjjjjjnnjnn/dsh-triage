# updater-drift · `#13730` 回复的事实包（2026-11-19）

> **用途**：R122。`#13730`（macOS，可选 bundle 被 preflight 禁用）与 `#13748`（Windows，核心包被禁用 → host 起不来）
> 是同一件事的两端；`#13730` 的结论是「唯一的出路是兼容豁免，且每次运行时更新后都要重新授一次」。
> 这一条只补**那个结论不成立的两处**：预留 profile 是能被自家 CLI 管理的，豁免也有官方命令。
> **不带链接**（额度 2/2 已用完），不推销。
>
> **事实包只引用带 `.sha256` 的产物**；数字一律来自下表的三份产物，不手填。

- **渠道 / 语言 / 受众**：上游 Discussions 回复（`#13730` 的评论），英文
- **本机环境**：Windows，DSH Desktop `0.2.2-rc.5`，`app.asar` 209,083,008 B（sha256 见产物）

## 产物

| 产物 | sha256 | 它提供什么 |
|---|---|---|
| `data/results/updater-drift-2026-11-19T06-56-13-204Z.json` | `445f1566c0ebbe68d9e4b969b2fab27781b4d517cf7d9fcff09ba79923d3b36c` | 安装件里到底有没有那些命令面、哪两个调用点被 `manageDesktopProfile` 管着 |
| `data/results/remedy-probe-2026-11-19T06-54-24-786Z.json` | `b904772c7b15d6bb7f4f0bc4385699c3a30230d76295436ba567fb60da087763` | 被点名的四个 rc.3 包在 `0.2.2-rc.5` 上到底判什么 |
| `data/results/discussion-state-2026-11-19T06-58-07-519Z.json` | `46d9fd6c9b3f1f11dbee4bf58bf1f41149d0fc0d3b3e56bf282b9faa9e1c22b0` | 发前状态：三条线程 `unreadable`（General 分类没有 `isAnswered`）、0 条评论 |

## 代码层事实（读的是本机 `app.asar`，不是别人的转述）

1. `@deepseek-ai/dsh-desktop-host/lib/cli.js`（3,436 B）调的是
   `runCli({ manageDesktopProfile: true, packageManager: … })` —— 它把**预留 profile 的管理权**交给普通 CLI。
2. `@deepseek-ai/dsh/lib` 里有两种调用点，`manageDesktopProfile` 只管其中一个（产物里的 `call_sites`）：

   | 调用点 | 源码形状 | 结果 |
   |---|---|---|
   | boot（`--profile` 启动 / `--dump-config`） | `rejectElectronProfile(program, profile)` —— **无条件** | `desktop` 恒被拒，所以 `#13748` 引用的那句「managed exclusively」出现在这里 |
   | plugin（`dsh plugin --profile …`） | `if (!manageDesktopProfile) rejectElectronProfile(plugin, …)` | 只有自家 CLI 能过 |

   这就是「同一个 profile，`--dump-config` 拒绝、`plugin add` 不拒绝」的机制，不是 bug 也不是漏配。
3. `plugin-*.js` 里有一组 DSH 自有子命令（不是 pnpm 转发）：
   - `version-exemptions` —— 打出当前 `compatibility.json` 里的豁免（JSON）
   - `allow-version <pkg@version> --dsh-version <exact> --accept-risk` —— 写一条精确版本豁免，并打印
     `allowing incompatible plugin versions can break the application or corrupt data` 的警告
   - `revoke-version <pkg@version> --dsh-version <exact>` —— 撤一条
   三者都走 `withFileLock(<profile>/package.json)`，`desktop` 分支还要求 profile 已由 app 初始化。
4. 安装路径上如果遇到不兼容版本，CLI 自己就会打印修复行
   （`dsh plugin --profile <p> allow-version <name>@<version> --dsh-version <rt> --accept-risk`）。
   **启动路径不打印** —— 这正是 `#13748` 期望 #3 说的缺口，可以在回复里承认。

## 声明层读数（`evaluateAdmission`，目标 `0.2.2-rc.5`）

| 包（上报里点名的 rc.3） | 判定 | 未满足的精确钉定 |
|---|---|---|
| `@deepseek-ai/dsh-session-query-sqlite@0.2.2-rc.3` | **denied** | `dsh-session` / `dsh-session-persistence` / `dsh-session-query` 各 `@0.2.2-rc.3` |
| `@deepseek-ai/dsh-authorization@0.2.2-rc.3` | **denied** | `dsh-llm` / `dsh-credentials` 各 `@0.2.2-rc.3` |
| `@deepseek-ai/dsh-llm@0.2.2-rc.3` | **denied** | `dsh-error@0.2.2-rc.3` |
| `@deepseek-ai/dsh-experimental-session-search@0.2.2-rc.3` | **unconstrained** | 无 |

**读法**：bundle 本身什么都不声明（`unconstrained`），被禁的是它拉进来的**行**。所以
`listBundles()` 报 rc.5 与「实际跑的是 rc.3 副本」可以同时为真 —— 它答的是 bundle 的问题，
用户需要的是行的答案。这句是给 `#13730` 管理缺口 #1 的回应，不给结论。

## 本机负对照

`~/.dsh/profiles/desktop`：19 个依赖、**0 个 `@deepseek-ai/*` 版本钉定**、22 个 bundle（6 个官方，**按名字声明**）、
无 `compatibility.json`。同一台机器 rc.3 → rc.5 之后 `dsh-triage` 读到 **0 项可动手 / 79 项判不了**。
即：**失效的前提是 profile 里有精确的官方版本钉定**；bundle 是名字，名字不会过时。

## 可以说什么

- 预留 profile **能被自家 CLI 管理**，`plugin add` 是对齐 pin 的路，不是豁免（引 `#13748` 的现场结果）。
- 豁免有官方命令（`allow-version` / `revoke-version` / `version-exemptions`），不必手改文件、也能撤。
- 被禁的是行、不是 bundle；bundle 的版本上报与行的解析是两个问题。
- 启动路径不打印修复行，是 `#13748` 期望 #3 的真实缺口。

## 不可以说

- 不说「我在 macOS 上验证过」：产物只读过这台 Windows 机器的归档，命令面是**读**出来的，没有执行。
- 不说「对齐一定成功」：`#13748` 的 Windows 现场成功是**他的**读数，我们只解释机制。
- 不说「所以不用管豁免」：豁免仍是版本没对齐时唯一能开机的手段，`allow-version` 自己也带损坏数据的警告。
- 不说「`listBundles()` 在说谎」：它答的是另一个问题；说成撒谎会把一个真问题降级成措辞问题。
- 不提本仓任何命令 / 面板 / 版本号（D-3 维护模式，不做曝光）。

## 边界句

> Boundary: this is read out of the installed 0.2.2-rc.5 archive on one Windows machine — the code paths are there, but I did not run them on macOS, and declaration-layer admission says nothing about runtime health.
