# M16 · 组合层同源（composition source）

> **状态**：`accepted`（2026-11-12 签字，见 `audit/SIGNOFF.md` 的 R102 行）。**它改变 `collisions` / 行集的输入**，因此是判据轮。
> **轮次**：R102（2026-11-12）。取证见 `audit/RECON_2026-11-12_composition-source.md`。
> **上游**：`M14-kernel-asar.md`（内核版本与 manifest 同源）只覆盖了 manifest，**没有覆盖 bundle 的 patch 文件**。
> **一句话**：运行时的版本与 `@deepseek-ai/*` 的 manifest 已经来自 `app.asar`，但**行是怎么被声明的**
> （bundle 的 `dsh.bundle.patch` 文件）仍然从 pnpm 共享缓存读 —— 于是 CLI 判的是另一份组合。

---

## 1. 问题：同一个 id，两个模块名

真机读数（2026-11-12，`--profile desktop`）：

| 读数 | 设置页（Host 路由） | CLI（0.3.7 装机版） | CLI（HEAD，M14） |
|---|---|---|---|
| 运行时 | `0.2.2-rc.1 (kernel)` | `0.1.0-rc.6 (inferred)` | `0.2.2-rc.1 (kernel-asar)` |
| 行 / 判 | 242 / 90 | 202 / 20 | 158 / 55 |
| denied / blocked | **0** | **8** | **0** |
| collisions | **0** | 1 | **1** |
| 一屏 | 「未发现阻断项，存在 N 项未明确版本声明」 | 「检测到 **9** 项兼容异常」 | 「检测到 **1** 项兼容异常」 |

M14 之后 CLI 不再报 8 条假 blocked，但**还剩 1 条**，而且它是假的：

```
collision: llm-deepseek  conflicting-definitions
  owners: bundle:@deepseek-ai/dsh-base, patch:profile
  names : @deepseek-ai/dsh-llm-deepseek      ← 来自缓存 dsh-base@0.1.0-rc.6 的 patch
          @deepseek-ai/dsh-llm-deepseek-api-key ← 来自 profile patch
```

三份 patch 的真实内容（`RECON` §2 有逐行证据）：

| 来源 | `llm-deepseek` 的 `name` | 版本 |
|---|---|---|
| 共享缓存 `@deepseek-ai/dsh-base/cordis.patch.yml` | `@deepseek-ai/dsh-llm-deepseek` | 0.1.0-rc.6 |
| 内核 asar `dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml` | `@deepseek-ai/dsh-llm-deepseek-api-key` | 0.2.2-rc.1 |
| profile `cordis.patch.yml` | `@deepseek-ai/dsh-llm-deepseek-api-key` | — |

面板（在 Host 内，通过内核根读 patch）看到两份**同名同模块** → 不冲突，**它是对的**。
CLI（读缓存那份 0.1.0-rc.6 的 patch）看到同名不同模块 → 报冲突，**它是错的**。

**根因**：`env.kernelRoots` 只在 `anchor.source === 'kernel'` 时非空（`env.ts:272`）；`kernel-asar` 不是
`kernel`，所以 CLI 的 `moduleRoots()` 里没有任何内核根 —— 版本与 manifest 从 asar 读了，**组合层没有**。

**这不是一条孤立的假答案**：缓存里 `dsh-base` 有 78 条 claims、内核有 97 条，其中 9 条名字不同、
6 条只在缓存里；`dsh-web-app` 缓存 78 条、内核 119 条，14 条不同。**CLI 判的是一个旧的组合**
（158 行），面板判的是正在运行的那个（242 行）。

---

## 2. 判据（C1–C6）

| id | 判据 |
|---|---|
| **C1 来源顺序** | 当 `dshSource === 'kernel-asar'`（即 M14 已命中桌面归档）时，`dsh.profile.bundles` 里**归档中存在**的 bundle，其 `package.json` 与全部 `dsh.bundle.patch` 文件**从归档读**；归档中不存在的 bundle（第三方插件）走原有磁盘解析，顺序不变。 |
| **C2 只做加法** | 归档不可读、或这个 bundle 不在归档里 → 退回**改前**行为，逐条不变（M14-C4 的同一纪律）。**逐 bundle 回退**，不是整体回退。 |
| **C3 同源** | 一个 bundle 的 manifest 与它的 patch 必须来自**同一处**。归档里有 manifest 但某个声明的 patch 读不到 → 该文件记 `text: null` + 一条可读的 error，**不许**拿缓存里的同名文件补位（那正是 M14-N3 禁止的混用）。 |
| **C4 profile 与 home 不动** | `patch:profile` / `patch:home` 永远从 `env.profileDir` / `dshHome` 读。归档里没有它们，也不该有。 |
| **C5 provenance 不变** | 归档提供的 bundle 记 `provenance: 'kernel'`（既有三值之一，`kernel` / `profile` / `shared`），不新增第四值。 |
| **C6 同源可观测** | 修后同一台机器上：CLI 的 `collisions` 与设置页路由的 `collisions` **相同**；CLI 的行数应当收敛到设置页的行数，**剩余的差必须能逐条解释**（归档里没有的第三方 bundle 照旧走磁盘）。 |

---

## 3. 负对照（N1–N6，逐条真红）

| id | 构造 | 期望 |
|---|---|---|
| **N1** | 缓存里 bundle patch 把 `llm-deepseek` 指到 `@deepseek-ai/dsh-llm-deepseek`，归档里指到 `-api-key`，profile patch 也是 `-api-key` | claims 取**归档那份** → `collisions` 为 **0**（修前是 1） |
| **N2** | `dshSource !== 'kernel-asar'`（夹具 / `DSH_HOME` 被改写 / 没有归档） | 组合层逐条与**改前**相同（缓存/磁盘怎么答就怎么答） |
| **N3** | 归档可读，但**这个 bundle 不在归档里**（例如第三方 bundle） | 走磁盘解析，provenance / version / patch 与改前相同 |
| **N4** | 归档里有 manifest，但声明的 patch 文件不在归档里 | 该文件 `text: null` + error；**同一 id 不许**从缓存补位 |
| **N5** | archive 头被截断 / JSON 不是目录 | 整体退回改前行为；error 里带 `unreadable`，不抛异常 |
| **N6** | 真机（本机桌面 profile） | CLI `collisions` **0**、`denied` **0**，与设置页路由逐项相同；`dsh-triage` 自己与 `dsh-remedy` 等已装插件不再出现在任何 actionable 桶里 |

---

## 4. 实现边界（只做加法）

| 文件 | 改动 |
|---|---|
| `packages/plugin/src/load.ts` | `loadBundleLayers()` 增加一个 asar 分支：`env.dshSource === 'kernel-asar'` 且 `env.kernelProbe.state === 'read'` 时，先按 `dsh/node_modules/<bundle>/` 读 manifest 与 patch；读不到的这个 bundle 走原路径。新增纯函数 `readBundleFromAsar(archive, name)`（可单测，不需要真机）。 |
| `packages/core/src` | **不动**。`asar.ts` 的 `asarReadFile` / `asarReadManifest` 已经够用；`admission.ts` / 四桶 / 三阈值 / `data/gold/` 一字不动。 |
| `docs` | `M14` §7 更正主语（见 §6）；`M16` 本文；`RECON` 第二份；`BS-69` 登记。 |

**不做**：不把 `kernelRoots` 假装成 asar 路径（那会让 `resolveFromDeclarer` 走进一个不存在的目录，把
「解析不到」变成另一条假答案）；不缓存已解析的归档到磁盘；不改 `record_audit.mjs` 之外任何记录器的语义；
**不为了「一屏干净」把 `unknown` 藏起来**（`unknown` 仍是一屏上的 `unjudged`，M15 已经把它与 `actionable` 分开）。

---

## 5. 与 M14 / M15 的关系

- **M14** 回答「运行时是哪个版本、`@deepseek-ai/*` 的 manifest 是哪个」；
- **M15** 回答「一屏怎么把可动手的项与判不了的项分开」；
- **M16** 回答「行是被哪一份 patch 声明的」。

三份合起来才是「CLI 与设置页看同一个组合」。缺 M16 时，M14 的 `0 blocked` 与 M15 的
「0 项需要你处理」都仍然可能被一条**假的** collision 推翻 —— 这正是 R101 剩下的那条。

---

## 6. 主语更正（R101 的叙事）

R101 的 Stand、`M14` §7、`RECON` §0 都写「桌面设置页把 8 个装好的插件报成兼容异常」。真机复测（R102）：

- **设置页路由**（`/compat-triage/summary`，带 `x-dsh-triage-client: settings-tab`）在 0.3.7 上返回
  `env.dsh 0.2.2-rc.1` / `dshSource: kernel` / **0 denied** / 0 collisions —— 它**从来没有**报过那 8 条；
- **CLI** 在 0.3.7 上返回 `0.1.0-rc.6 (inferred)` / **8 blocked** / 1 collision / 「检测到 9 项兼容异常」。

所以那 9 项是 **CLI** 的读数。R102 更正的是**主语**，不是数字：M14 修的是 CLI 的版本来源，
M15 修的是**两者共用的**一屏文案，M16 修的是 CLI 的组合来源。这条更正写进
`audit/RECON_2026-11-12_composition-source.md` §1，M14 §7 同时改。

---

## 7. 边界（如实写）

- 归档里只有**内核自己**的 bundle。第三方 bundle（`dsh-remedy` / `dshmarket` / `dsh-context` …）仍然从
  磁盘读，它们与内核的 patch 在同一个 id 上真的可能冲突 —— 那种冲突是**真事**，本判据不消除它。
- `app.asar` 213 MB，读一次 ~100ms（本机实测 99–110ms，RSS ≈ 483MB）。`loadEnv` 已经读一次（M14），
  本判据在 `loadBundleLayers()` 里再读一次；**同一次命令里读两次**是已知代价，没做缓存（缓存会让
  「同一进程两次判定」看到不同时刻的归档，那是另一种假事实）。`BS-70` 登记。
- npm 全局安装、Linux 桌面壳、CI 上没有归档 → 走 N2，行为与改前相同（`BS-67` 仍然开着）。

---

## 8. 签字

| 项 | 内容 |
|---|---|
| 已签 | **2026-11-12**，HUMAN 原话「全部同意，开始依次进行，确保项目符合目标……最后确保后发布」；范围与未逐条复核的部分见 `audit/SIGNOFF.md` 的 R102 行 |
| 签字后写进 | `audit/SIGNOFF.md` R102 行（已写） |
| 不签的后果 | 保持现状：CLI 继续用缓存里 `dsh-base@0.1.0-rc.6` 的 patch，`llm-deepseek` 那条 phantom collision 原样存在，`judged` 停在 55（少判 38 行） |
