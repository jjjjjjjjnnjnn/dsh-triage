# RECON · 2026-11-12 · 桌面设置页误报与「读错版本」的完整复核

> **触发**：HUMAN 在真机上看到设置页显示「检测到 9 项兼容异常」，并质疑「这个插件没作用」。
> **结论先行**：**那 8 条 `blocked` 全是误报，根因是 CLI/面板把 `0.1.0-rc.6`（陈旧共享缓存）当成了正在运行的运行时版本**；
> 而「一屏 202 行、0 条可动手」是第二个独立问题（判据对「没写声明」的行保持沉默，所以永远是 `unknown` 而不是 `go`）。
> **本报告只取证，不改判据**。判据变更见 `docs/specs/M14-kernel-asar.md`（待写）与 §6 的分级。

---

## 0. 一句话可复现

```powershell
node packages/plugin/dist/cli.js status --profile desktop
# 分诊台 · dsh 0.1.0-rc.6 (inferred) · profile desktop
#   202 项配置（20 项已分析）· 0 正常 · 8 存在异常 · 12 未明确 · 1 冲突
```

`dsh 0.1.0-rc.6 (inferred)` 里的 `inferred` 已经在提示「这不是运行时版本」，但一屏仍然按它判了。

---

## 1. 三个版本，只有一个是运行时

| # | 来源 | 版本 | 是什么 |
|---|---|---|---|
| 1 | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh/package.json` | **0.1.0-rc.6** | **pnpm hoisted 共享依赖缓存** ← CLI 读的就是它 |
| 2 | `~/.dsh/dsh-runtimes/dsh-primary-runtime/runtime.json` | **0.2.2-rc.1** | 桌面壳自己的运行时清单（`desktopVersion`） |
| 3 | `app.asar` 内 `dsh/node_modules/@deepseek-ai/dsh/package.json` | **0.2.2-rc.1** | Host 进程真正加载的那份 |

`packages/core/src/env.ts:238` 的 `resolveKernelAnchor()` 从 `process.argv[1]` 往上走：
CLI 从 `<home>/profiles/<name>/node_modules/dsh-triage/dist/cli.js` 启动 → 向上第一个命中 `node_modules`
就是 `<home>/profiles/node_modules`（**共享缓存**）→ 被 `isCache()` 判成 `inferred` → 但**版本仍然取它的 0.1.0-rc.6**。

源码里那句注释已经写对了（`env.ts:107-114`：走缓存不是内核），**但它只用来决定 `source` 标签，没有用来拒绝这个版本号**。

---

## 2. R91 的结论「普通 Node 读不到 asar」对这个用途是错的

实测（`node:fs`，无 Electron、无补丁）：

```
asar size 213202918
header: readUInt32LE(12) = 5748124  → JSON 目录在 offset 16
dsh/node_modules/@deepseek-ai/dsh/package.json → {"size":8329,"offset":"138409726"}
name: @deepseek-ai/dsh  |  version: 0.2.2-rc.1
dsh-desktop-host version: 0.2.2-rc.1
```

asar 就是个普通文件：**16 字节头 + 一段 JSON 目录 + 4 字节对齐后的数据区**。
`fs.readFile('…/app.asar')` 直接可读；`fs.readFile('<asar 挂载路径>/…')` 才是 Electron-only（R91 那次测的是后者）。
**所以「CLI 只能 `inferred`」不是能力上限，是没做。**

内核包数量：asar 里 `dsh/node_modules/@deepseek-ai/*` 共 **329–331 个**，profile 声明的模块 **147** 个里 **121** 个在内核中，**26** 个不在（多为第三方或路径型 specifier）。

---

## 3. 那 8 条 `blocked`：在真版本上全部满足

把 `row_verdicts[].reasons[].params.range` 原样喂给项目自己的 `evaluateRange()`，目标换 `0.2.2-rc.1`：

| 包 | 被点名的区间 | 在 0.2.2-rc.1 |
|---|---|---|
| `@linxin666/dsh-client-ui-skill-explorer` | `@deepseek-ai/dsh >=0.2.2-rc.1` | ✅ |
| `dsh-context` | `dsh >=0.2.0-rc.2 \|\| >=0.2.1-rc.2 \|\| >=0.2.2-rc.1` | ✅ |
| `dsh-free-search` | 5 条 peer `^0.1.7-rc.1 \|\| ^0.2.0-rc.1`（含 `dsh-settings` / `dsh-tools`） | ✅ 全过 |
| `dsh-ops` | `dsh >=0.2.2-rc.1 <0.2.3-0` | ✅ |
| `dsh-remedy` | `dsh >=0.2.0-rc.1 <0.3.0-0` | ✅ |
| `dsh-triage` | `dsh >=0.2.0-rc.1 <0.3.0-0` | ✅ |
| `dsh-unlag` | `dsh >=0.2.0-rc.1` | ✅ |
| `dshmarket` | `@deepseek-ai/dsh-settings ^0.1.0-rc.7 \|\| … \|\| ^0.2.1-rc.1` | ✅ |

```
blocked=8  would-be-fine-at-0.2.2-rc.1=8  still-blocked=0
```

**注意：`dsh-triage` 自己被自己的引擎判成 `blocked`。** 这是最容易让用户相信「这工具坏了」的一条。

---

## 4. 只换版本号不够：缓存里的 manifest 也是 0.1.0 的

只把 `env.dsh` 换成 `0.2.2-rc.1`（manifest 仍从缓存读）：

```
=== judged at dsh=0.2.2-rc.1 ===
verdicts: 137 | buckets: {"go":0,"blocked":125,"unknown":12}
blocked: @deepseek-ai/dsh-agent, @deepseek-ai/dsh-tools, @deepseek-ai/dsh-web-app, … (125 条)
```

原因：缓存里那些内核包自己的 `peerDependencies` 精确钉在 `"0.2.2-rc.1"`（实测 `dsh-tools` / `dsh-web-app` / `dsh-agent` / `dsh-session` 全是），
而**缓存副本是 0.1.0-rc.6 那一批**，它们内部又钉 `^0.1.0-rc.6` → 互相矛盾。

**所以 (A) 必须同时做两件事**：
1. 版本取自内核（asar 或 `runtime.json`）；
2. **manifest 也从内核读**（至少 `@deepseek-ai/*` 这 121 个）。

混合版（内核版本 + 缓存 manifest）实测 **9 条 blocked / 46 unknown**，这 9 条全是「asar 里没有、只能用缓存」的包 ——
**半修会把 8 条假答案换成 9 条另一种假答案，比不修更坏**（R91 的 `N9` 就是钉这个的）。

---

## 5. 第二个问题：一屏 202 行里 0 条可动手

`buildProfileSummary`（`packages/plugin/src/summary.ts:93`）的排序是对的（denied > collision > duplicate > unknown），
但它把三件事算在一起，用户读到的是「9 项兼容异常」而不是「0 项要你动手」：

| 数字 | 真身 | 用户能做什么 |
|---|---|---|
| `rows 202` | 配置行数（含 182 条「没写任何 DSH 区间」的） | 无 |
| `judged 20` | 真的判了的 | — |
| `denied 8` | **全是误报**（见 §3） | 无（修完 A 应为 0） |
| `unknown 12` | 没写 `engines.dsh` 也没写 peer（`T-867` 已结案：不是缺陷） | 无 |
| `collisions 1` | `llm-deepseek`：base bundle vs profile patch 同名两处 | **有**（这是唯一真事） |

**结论**：修完 (A) 之后正确的一屏应该是
`0 项需要处理 · 1 处同名冲突 · 12 项未声明（不代表不兼容）· 18x 项未声明任何 DSH 区间`。

---

## 6. 修复方案（分两轮，判据/交付各一）

### 轮 1（判据轮）· `M14` 内核 manifest 读取

**为什么必须判据轮**：它改变 `env.dsh` 与 `row.manifest` —— 也就是改变 `conclusion` 的输入。
按 `PROJECT_RULES.md`：spec + 四轴 review + 对抗性负对照 + `step_reviews` 每步一条 + `gate --mutate`。

**判据草案**（`docs/specs/M14-kernel-asar.md`，待写）：
- **C1** 版本来源顺序：`kernel:asar` > `kernel:runtime.json` > `profile` > `shared`；每级都写进 `dshSource`
- **C2** `dshSource` 增两值：`kernel-asar` / `kernel-runtime-json`，**旧值不删**（`kernel` / `inferred` / `unresolved` 保留）
- **C3** manifest 来源与版本来源**必须同源**：版本来自 asar 时，`@deepseek-ai/*` 行的 manifest 也必须来自 asar；
  无法同源的行保留 `null`（仍是 `unknown`），**不许混用**
- **C4** asar 不可读 / 结构不符 / 完整性校验失败 → **退回**并用 `inferred`，**不许猜**
- **C5** 一屏与 CLI 同源（现有 `same-source` 断言必须继续全绿）
- **N1** 缓存 `0.1.0-rc.6` + 内核 `0.2.2-rc.1` → 必须报 `0.2.2-rc.1`，且 8 条 `blocked` 变 `go/unknown`
- **N2** 只有缓存、没有内核 → 必须退回 `inferred` 且**不改变**既有 8 条（证明「拿不到就不算」）
- **N3** 内核版本 + 缓存 manifest（混合）→ **必须拒绝**（半修方向）
- **N4** `dsh-triage` 自身在真机上**不得** `blocked`
- **N5** asar 头部被截断 / JSON 解析失败 → `inferred` + 一条可读的 error，不抛
- **N6** `runtime.json` 声明 0.2.2-rc.1 但 asar 里是别的值 → 必须两份分开记，不许合并

**实现点**（都在 `core`/`plugin` 的文件边界内）：
- 新纯函数：`readAsarDirectory(buffer)` / `asarReadFile(buffer, header, path)` —— 可以放 `packages/core/src/asar.ts`，**零依赖、无 Electron API**
- `packages/core/src/env.ts`：`resolveKernelAnchor()` 增加 asar 探针；`loadEnv()` 用它
- `packages/plugin/src/load.ts`：`moduleRoots()` 失败后，`@deepseek-ai/*` 行追加「asar 内 manifest」来源（**只做加法**，与 R95 的 M13 同一纪律）
- 负对照全部要有单测（上 N1–N6）

### 轮 2（交付轮）· 一屏说人话

- `summary.ts`：新增「能动手的项」与「只是没声明的项」两类计数；
- tone 判定：`denied` 为 0 且只有 `unknown` → **不再是 `broken`**（现在是 `attention`，但文案说「检测到 9 项兼容异常」）；
- 文案：`copy.attention` 在 `denied=0` 时改成「0 项需要处理 · N 项未声明版本区间（不代表不兼容）」；
- 断言：新增一条「`denied=0` 时一屏不得出现『异常』二字」的单测 + 负对照。

---

## 7. 盲区（本轮新增，已登记或待登记）

| id | 看不见什么 |
|---|---|
| **BS-67** | asar 读取只在**桌面壳**上成立；npm 全局安装、CI、Linux 桌面壳（asar 结构可能不同）都没有实测；`runtime.json` 是壳自己的排期，**不是内核包目录** |
| **BS-68** | 内核 329 个包里 **26 个不在 asar**（第三方 + 路径型 specifier），这批行仍是 `unknown`；「一屏 0 条可动手」会有剩余 |
| （既有）`BS-63` | 渠道读数是「谁问」的函数 —— 与本次误报同型：**读数取决于你问谁**（问缓存还是问内核） |

---

## 8. 本次取证的操作记录

全部只读，无写入：

```powershell
node packages/plugin/dist/cli.js status --profile desktop      # 202/20/8/12/1
node packages/plugin/dist/cli.js audit  --profile desktop --json > %TEMP%\desktop-audit.json
node -e "…app.asar 头部解析…"                                   # 读到 dsh@0.2.2-rc.1
node -e "…evaluateRange 8 条 blocked 的区间 @0.2.2-rc.1…"       # 8/8 满足
node -e "…loadAuditData + verdictsFromRowAdmission ×3 场景…"    # 0.1.0→8 blocked / 0.2.2+缓存→125 / 内核混合→9
```

`%TEMP%` 里的中间脚本：`r101-asar-probe.mjs` · `r101-asar-extract.mjs` · `r101-rejudge.mjs` ·
`r101-decisive2.mjs` · `r101-asar-coverage.mjs` · `r101-panel2.mjs`。**都不进仓**。

---

## 9. 与 D5 的关系（不许混）

D5 仍是 `pending`（0/10 · 0/1 · 675 `steady`/20），关窗 `2026-11-15T20:24:37Z`，下一份基线最晚 `2026-11-20`。
**这次误报是 D5 之外的另一件事**，但它解释了同一个现象：
「产品看起来很厉害，用户体验却是『一堆看不懂的未明确』」——正是 `BS-44`（需求不存在 vs 形态错）里「形态错」的现场。
修完 (A)+(B) 之后如果仍然没人用，`fail` 的解释会更硬：**不是我们没修，是修了也没人要**。
