# M14 · 内核 manifest 读取（asar 目录解析）

> **状态**：`accepted`（2026-11-12 签字，见 `audit/SIGNOFF.md` 的 R101 行）。**它改变 `conclusion` 的输入**，因此是判据轮。
> **轮次**：R101（2026-11-12）。取证见 `audit/RECON_2026-11-12_desktop-misreport.md`。
> **一句话**：`dsh` 的版本与 `@deepseek-ai/*` 行的 manifest **都可以**从 `app.asar` 里读出来，
> 而 R91 的「普通 Node 读不到 asar」只对**挂载路径**成立，对**文件本身**不成立。

---

## 1. 问题

`packages/core/src/env.ts` 的 `resolveKernelAnchor()` 从 `process.argv[1]` 向上找 `node_modules`。
CLI 从 `<home>/profiles/<name>/node_modules/dsh-triage/dist/cli.js` 启动，向上第一个命中是
`<home>/profiles/node_modules` —— 那是 **pnpm hoisted 共享缓存**（实测 `0.1.0-rc.6`），
而宿主进程实际加载的是 `app.asar` 里的 `0.2.2-rc.1`。

源码已经识别出「走缓存不是内核」（`env.ts:107-114`，`isCache()`），**但只用它打了 `inferred` 标签**，
版本号仍然取缓存那一份。于是：

```
真机（2026-11-12）: 202 行 / 20 判 / 0 go / 8 blocked / 12 unknown / 1 collision
把 0.2.2-rc.1 代进去 : 8 条 blocked 全部满足（8/8）
```

**而且 `dsh-triage` 自己被自己判成 `blocked`** —— 这是让用户相信「这工具坏了」的那一条。

---

## 2. 判据（C1–C7）

| id | 判据 |
|---|---|
| **C1 来源顺序** | `kernel-asar`（`app.asar` 可读且结构合法）→ `kernel`（Electron 下 `process.argv[1]` 走到真实内核）→ `inferred`（profile / 共享缓存）→ `unresolved`。先命中者胜，**不许合并两个来源**。 |
| **C2 新来源标签** | `DshSource` 新增 `'kernel-asar'`。既有 `'kernel'` / `'inferred'` / `'unresolved'` **保留且语义不变**（M11 的断言继续成立）。 |
| **C3 同源** | 版本来自 asar 时，`@deepseek-ai/*` 行的 manifest **也必须**来自 asar。无法同源的行（不在 asar 里的包、路径型 specifier `./index.js`）manifest 保持 `null` → 仍是 `unknown`。**绝不混用**：内核版本 + 缓存 manifest 实测会给 125 条 blocked（RECON §4）。 |
| **C4 不猜** | asar 不存在 / 头被截断 / JSON 解析失败 / 条目越界 → **退回既有行为**（`inferred`），并记录一条可读的 `kernelProbe.detail`。**不许**用 `runtime.json` 或任何启发式补位。 |
| **C5 交叉核对** | `~/.dsh/dsh-runtimes/*/runtime.json` 的 `desktopVersion` **只记录、不取数**：写进 `kernelProbe.runtimeJsonVersion`，两者不一致时**两份都留**（`disagrees: true`），不裁。理由：那是桌面壳的排期，不是内核包目录（`BS-63` 的同型）。 |
| **C6 同源一屏** | CLI 与设置页必须继续同源：`client-serve` 的两条 `same-source` 断言全绿（R95 的 M13 纪律）。**R102 补一条可量化的读法**：真机上两侧的 `denied` / `collisions` / `duplicateCopies` / `errors` 必须相同（`scripts/record_desktop_panel.mjs` + `scripts/lib/panel-agreement.mjs#judgePanelAgreement`）；行数可以不同（Host 看得见内核层）。 |
| **C7 零依赖** | asar 解析只用 `node:fs` 与 `Buffer`，不引第三方包、不用 Electron API、不依赖运行在 Electron 里。 |

---

## 3. 负对照（N1–N8，逐条真红）

| id | 构造 | 期望 |
|---|---|---|
| **N1** | 缓存 `0.1.0-rc.6` + asar 里 `0.2.2-rc.1`，同一份 profile | 报 **`0.2.2-rc.1 (kernel-asar)`**；RECON 里那 8 条 `blocked` → 全部不再是 `blocked` |
| **N2** | 只有缓存、没有 asar（`BROWSER` 场景 / npm 全局安装） | 退回 `inferred`，**既有判定结果逐条不变**（证明「拿不到就不算」） |
| **N3** | 内核版本 + **缓存** manifest（混合） | **必须被拒绝**：manifest 来自缓存的 `@deepseek-ai/*` 行不得用内核版本去判，仍按 `null` → `unknown` |
| **N4** | 真机（本机桌面） | `dsh-triage` 自身**不得** `blocked` |
| **N5** | asar 头 8 字节被截断 / JSON 不是对象 | 退回 `inferred` + `kernelProbe.state: 'unreadable'`，**不抛异常** |
| **N6** | 条目 `offset + size` 越过文件末尾 | 视同不可读，退回 `inferred` |
| **N7** | `runtime.json` 的 `desktopVersion` 与 asar 不一致 | 两份都记录 + `disagrees: true`，**不选边** |
| **N8** | 一屏：`denied = 0`、`unknown > 0` | 文案**不含「异常」**（与 M15 一起验，见 §5） |

---

## 4. 实现边界（只做加法）

| 文件 | 改动 |
|---|---|
| `packages/core/src/asar.ts`（新） | `parseAsarDirectory(buffer)` · `asarReadFile(buffer, header, path)` · `asarListPackages(buffer, scope)`。纯函数、零依赖 |
| `packages/core/src/types.ts` | `DshSource` 加 `'kernel-asar'`；`EnvFingerprint` 加可选 `kernelProbe` |
| `packages/core/src/env.ts` | `resolveKernelAnchor()` 前置 asar 探针；`loadEnv()` 在命中时把 manifests 一并交出 |
| `packages/plugin/src/load.ts` | `moduleRoots()` 之后追加 `asar` 来源（**扁平先跑、失败后重试**，与 R95 的 M13 同一顺序纪律） |
| `packages/plugin/src/cli.ts` / `host.ts` | 只透传 `dshSource`，不改判定 |

**不做**：不引 `@electron/asar`；不写 asar；不改 `admission.ts` / 四桶 / 三阈值 / `data/gold/`；
不把 `runtime.json` 当版本来源；不为了「让一屏好看」而隐藏 `unknown`。

---

## 5. 与 M15 的关系

本轮同时包含 **M15（一屏说人话）**，那是**交付轮**性质（只改渲染、不改判定）：
`denied=0` 时基调从 `broken` 降为 `attention`，文案改成「0 项需要处理 · N 项未声明版本区间（不代表不兼容）」。
两者同轮但**分级不同**：M14 走判据轮的全套（四轴 + 对抗 + `step_reviews` 每步 + `--mutate`），
M15 只需一次真跑产物 + 复算。

---

## 6. 边界（如实写）

- asar 读取在**这台机器的桌面壳**上实测成立；npm 全局安装、Linux 桌面壳、CI 上没有实测 → `BS-67`。
- asar 里 331 个 `@deepseek-ai/*` 包，profile 声明的 147 个模块里 **121 个**在内核，**26 个**不在 → 那 26 行仍是 `unknown`（`BS-68`）。
- 内核包里 `peerDependencies` 精确钉在同一个版本（实测 `dsh-tools` / `dsh-web-app` / `dsh-agent` / `dsh-session` 全是 `0.2.2-rc.1`），
  所以「同源」不是可选项：混用必然互相矛盾。

---

## 7. 签字

| 项 | 内容 |
|---|---|
| 已签 | **2026-11-12**，HUMAN 原话「全部同意，开始依次进行」；范围与未逐条复核的部分见 `audit/SIGNOFF.md` 的 R101 行 |
| 签字后写进 | `audit/SIGNOFF.md` 新行 |
| 不签的后果 | 保持现状：**CLI** 继续把 8 个装好的插件报成 blocked（设置页从 0.3.7 起就是 0 denied —— R102 把这句话的主语改对了，见 `audit/RECON_2026-11-12_composition-source.md` §1 与 `docs/specs/M16-composition-source.md` §6） |
