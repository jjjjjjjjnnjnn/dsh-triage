# M11 · 环境指纹的真相源（kernel resolution）判据

> **Stand**: R91 (2026-11-09)｜**状态**: 判据先行，实现随本轮交付
> **这条 spec 回答一件事**：`loadEnv()` 现在从 `~/.dsh/profiles/node_modules` 读 `@deepseek-ai/dsh`
> 的版本，但那是**一份陈旧的共享依赖缓存**，不是正在运行的运行时。拿它去比 `engines.dsh`，
> 一屏结论全是错的。
> **来源**：HUMAN 本机（DSH Desktop `0.2.2-rc.1` + `dsh-triage@0.3.4`，2026-11-09）——
> 面板报「9 项兼容异常」，其中被点名的每一条都是拿 `0.1.0-rc.6` 去比 `>=0.2.x` 得到的；
> 以及 GitHub issue `jjjjjjjnnjnn/dsh-triage#1`（同一类误报的 bundle 版本）。

---

## 1. 现象与证据

`dsht why --profile desktop` 的本机输出（2026-11-09，未改动的 `0.3.4`）：

```
scanned 17 bundles · 198 loader rows · 156 import targets · dsh 0.1.0-rc.6 · profile desktop
warn  bundle @deepseek-ai/dsh-experimental-plugin-market-bundle is listed in … but not installed under the profile
…
```

同一刻正在运行的 Host（PID 35536）：

```
DeepSeek Harness.exe --expose-internals
  "…\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js"
```

该 asar 内的内核包：

| 路径（asar 内） | 版本 |
|---|---|
| `dsh/node_modules/@deepseek-ai/dsh/package.json` | **0.2.2-rc.1** |
| `dsh/node_modules/@deepseek-ai/dsh-base/package.json` | **0.2.2-rc.1** |
| `dsh/node_modules/@deepseek-ai/dsh-web-app/package.json` | **0.2.2-rc.1** |

而 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh/package.json` 是 **0.1.0-rc.6**，
`dsh-web-app` 同样是 **0.1.0-rc.6**。

于是所有 `engines.dsh >= 0.2.x` 的插件被判 `denied`：

| 被判不兼容的 | 它要求的 | 用 0.1.0-rc.6 比 | 用 0.2.2-rc.1 比 |
|---|---|---|---|
| `@linxin666/dsh-client-ui-skill-explorer` | peer `>=0.2.2-rc.1` | ✗ | ✓ |
| `@michengai/dsh-pua` | `>=0.2.0-rc.1 <0.3.0-0` | ✗ | ✓ |
| `dsh-context` | `>=0.2.2-rc.…` | ✗ | ✓ |
| 其余同类 | | ✗ | ✓ |

**这不是「9 个风险」，是「9 个我们的错误」。** 产品的主张是「你这套已装集合升上去会坏什么」，
版本取错等于整张卡作废——比打不开更伤，因为它**看起来有答案**。

同一份错误也让 issue #1 的 bundle 误报成立：`loadBundleLayers()` 的 roots 只有
`profileDir/node_modules` 与 `dshHome/profiles/node_modules`，内核自带 bundle 在这两个目录之外。

## 2. 边界（写进代码里的）

1. **只换取数来源，不换比较逻辑。** `admission.ts` 的区间判定、`engines.dsh` / peer 的解析、
   四桶分区，**一行不动**。这一轮改的是「版本从哪来」，不是「怎么比」。
2. **不采用「多源取最高版本」。** 高版本 ≠ 正在跑的版本。取最高会把判断变成猜，
   并且掩盖「我们不知道」——那正是这个项目一直在拒绝的做法。
3. **不采用「跳过 host-provided 名单」。** issue #1 的建议二会连**真正缺失**的 bundle 一起吞掉
   ——「内核里有」和「谁都没装」必须靠搜索区分，不能靠一张写死的白名单猜。宁可多报，不可漏报。
4. **失败必须软着陆。** 锚点解析不到时退回旧路径并**标 `inferred`**，不许崩、不许装成已知。
5. **`dshSource` 必进结论。** 版本旁边写清它是从哪来的，因为「0.1.0-rc.6」和
   「0.1.0-rc.6（推断）」对用户是两个完全不同的事实。
6. **本机 DSH 只读。** 只读 `package.json` 与 `runtime.json`，不写、不装、不改。

## 3. 判据

| 编号 | 判据 | 由什么证明 |
|---|---|---|
| **M11-C1** | 锚点顺序固定：① `anchorEntry`（默认 `process.argv[1]`）逐级向上找 `D/node_modules/@deepseek-ai/dsh/package.json`，命中即 `source: 'kernel'`；② `profileDir/node_modules`；③ `dshHome/profiles/node_modules`；②③ 命中一律 `source: 'inferred'`；④ 全落空 → `source: 'unresolved'` + `dsh: null` | 纯函数 `resolveKernelAnchor()` + 单测逐条 |
| **M11-C2** | `dsh`（运行时版本）与 `installed`（`@deepseek-ai/dsh` 那一行）用**同一个** roots 数组，不允许出现 `dsh: '0.2.2-rc.1'` 而 `installed['@deepseek-ai/dsh']: '0.1.0-rc.6'` 这种自相矛盾 | 单测：解析一次 `loadEnv`，断言两处版本相等 |
| **M11-C3** | bundle roots = `kernel ∪ profileDir/node_modules ∪ dshHome/profiles/node_modules`，去重、丢 null；**内核排第一**（用户装的包不在内核里，内核优先对它们无害；而内核包必须用内核那份，否则会读到陈旧副本的 patch 层）。**`loadBundleLayers()` 与 `resolveRows()` 必须共用同一份 `moduleRoots()`** —— 两份列表就是「layer 说 0.2.2-rc.1、row 判 0.1.0-rc.6」的来源 | 单测：同一 bundle 两处都有 → 取内核那份；同一模块两处都有 → row 也取内核那份 |
| **M11-C4** | `BundleLayer` 带 `provenance: 'kernel' \| 'profile' \| 'shared'`；诊断输出能说明某个 layer 是宿主提供的。`kernelRoots` 只在 `dshSource === 'kernel'` 时非空——`inferred` 指的是 profile / shared 那两处，把它们的 layer 叫「宿主提供」是另一句假话 | 单测断言 provenance 与 `kernelRoots` |
| **M11-C5** | 找不到时的诊断句必须**说真话**：`bundle <name> is listed in dsh.profile.bundles but no copy was found in the profile, the shared layer, or the kernel`（原句 `not installed under the profile` 在搜过内核之后就不再是真话） | 单测断言句子；`rg` 断言旧句不再出现 |
| **M11-C6** | 显示层带来源后缀：`dsh <ver> (kernel)` / `dsh <ver> (inferred)` / `dsh unknown`。位置是 `cli.ts` 的 `why` 摘要行与 `summary.ts` 的一屏答案首行 | 单测分别跑两个格式化函数 |
| **M11-C7** | CLI 在 desktop 形态下只能看到 profile 缓存，因此**必然**报 `inferred`。这是**已登记的边界**，不是缺陷：面板与 agent 工具跑在 Host 内，它们报 `kernel` | 文档断言 + 单测（anchorEntry 指向非内核路径时 → `inferred`） |
| **M11-C8** | 判据不动：`packages/core/src/admission.ts` 与 `data/gold/` 在本轮**逐字节不改** | `git diff --stat` 对这两个路径为空；金标用例全过 |
| **M11-C9** | `EnvFingerprint.dshSource` 是**可选**字段，缺省语义 = 未知来源。新加字段不得让既有的 13 个构造点失效 | 单测：手工构造不带 `dshSource` 的 `EnvFingerprint` 仍能走完整链路 |

## 4. 负对照（必须真红）

| 编号 | 构造 | 期望 |
|---|---|---|
| **N1** | 桌面形态：`anchorEntry` 指向 `<root>/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js`，`<root>/node_modules/@deepseek-ai/dsh` 是 `0.2.2-rc.1`，同时 `profiles/node_modules` 里放 `0.1.0-rc.6` | 版本 = `0.2.2-rc.1`，`dshSource = 'kernel'`，**`0.1.0-rc.6` 不出现在任何输出里** |
| **N2** | 两份陈旧副本都在、内核不存在 | 版本 = 陈旧那份，`dshSource = 'inferred'`（证明降级是有标记的，不是静默的） |
| **N3** | 四个锚点全部落空 | `dsh = null`、`dshSource = 'unresolved'`，**不抛异常、不编数值** |
| **N4** | 内核与 profile 是同一个版本 | 不出现重复项、不出现假冲突、`installed` 里没有两条同名 |
| **N5** | issue #1 形态：`@deepseek-ai/dsh-base` / `dsh-web-app` 只在 `<root>/node_modules/@deepseek-ai/dsh/node_modules/` 下 | 两条 warn **消失**，且两个 layer 的 `provenance = 'kernel'` |
| **N6** | 构造夹具：某个 bundle 在**任何** root 下都不存在 | warn **必须还在**（加 roots 不许把真缺失一起吞掉） |
| **N7** | 内核有 `dsh-web-app@0.2.2-rc.1`，`profiles/node_modules` 有 `dsh-web-app@0.1.0-rc.6`，两者 `cordis.patch.yml` 内容不同 | 读到的 patch 是**内核那份**（逐字节比较） |
| **N8** | 只有一个 bundle 在内核里、profile 完全没装 | 它仍然成为一个 layer（不是「跳过 host-provided」），且 patch 可读 |
| **N9** | 同一个模块在内核是 `0.2.2-rc.1`、在 shared 是 `0.1.0-rc.6`，两处都被一个 row 引用 | `resolveRows()` 取**内核**那份；另一个两处都没有的模块仍然是 `null`（不借版本） |

**N5 与 N6 是这一对的眼睛**：只做 N5 会得到一个「把宿主包当空气」的洞，只做 N6 会得到一个「内核包永远修不好」的摆设。

> **R91 自查（这一条差点被我写错）**：我最初把本机那 5 条 `@deepseek-ai/dsh-experimental-*` 记成
> 「真的不在，修复后必须继续 warn」。用真实 asar 跑一遍才发现**它们也在内核里**（全部 `0.2.2-rc.1`）：
> 修复后本机 `layers 22`、`errors: []`。「profile 磁盘上没有」不等于「没有」——这正是 issue #1 那句话。
> 所以 N6 **不能拿本机当例子**，它只能靠构造夹具；一台机器的现状可以推翻一个假设，却不能证明一条规则。

> **R91 第二次自查（真机跑出来的，不是想出来的）**：只给 `loadBundleLayers()` 加内核 root 之后，
> 真机从「9 条假 `denied`」变成 **「119 条假 `blocked`」** —— 因为 `resolveRows()` 还从 profile / shared
> 解析版本，于是内核 layer（`0.2.2-rc.1`）里的 `@deepseek-ai/dsh-agent` 被按共享缓存的 `0.1.0-rc.6` 判。
> 这正是 `N9` 存在的理由：**layer 与 row 必须用同一份 roots**。修完真机 `denied 0 / blocked 0`。
> 换句话说，加 roots 只做一半，会把「9 条假答案」升级成「119 条假答案」。

## 5. 实施要点

- `packages/core/src/env.ts`：新增 `resolveKernelAnchor()`（纯逻辑 + 一个有界的向上查找，最多 40 级）；
  `LoadEnvInput` 加 `readonly anchorEntry?: string | null`（测试注入，默认 `process.argv[1]`）。
- `packages/core/src/types.ts`：`EnvFingerprint` 加可选 `dshSource` 与 `kernelRoots`。
- `packages/core/src/redact.ts`：`kernelRoots` 也要过 `redactPath`（首次全量测试当场抓到三条 e2e 泄漏）。
- `packages/plugin/src/load.ts`：roots 扩成三个并去重；`BundleLayer` 加 `provenance`；改诊断句。
- `packages/plugin/src/cli.ts` / `packages/plugin/src/summary.ts`：两处显示各加来源后缀。
- **不改**：`admission.ts`、`verdict.ts`、`data/gold/`、`docs/specs/D5-measurement.md`。

### 5.1 asar 可读性：**实测，不是假设**

计划里这条被标成「必须测」。测了，结论是**能读**——但只在这一个进程里能读：

| 进程 | `fs.readFileSync('<…>/app.asar/dsh/node_modules/@deepseek-ai/dsh/package.json')` |
|---|---|
| 本机普通 Node 24 | 失败（`resolveKernelAnchor` 返回 `unresolved`），所以 CLI 必然 `inferred` |
| `DeepSeek Harness.exe` + `ELECTRON_RUN_AS_NODE=1` | **成功，读到 `0.2.2-rc.1`** |

在 Electron 的 fs 上跑一遍真实的 `loadEnv()`（`anchorEntry` = 正在跑的 `dsh-desktop-host/lib/index.js`）：

```
{ "dsh": "0.2.2-rc.1", "source": "kernel",
  "kernelRoots": ["…app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh\\node_modules",
                  "…app.asar\\dsh\\node_modules"],
  "installedDsh": [{ "name": "@deepseek-ai/dsh", "version": "0.2.2-rc.1" }] }
```

同一个进程里再跑 `loadBundleLayers`：`layers 22`、`errors: []`，
其中 `kernel` 7 条（`dsh-base` / `dsh-web-app` + 5 条 `dsh-experimental-*`，全部 `0.2.2-rc.1`）。

### 5.2 真机全链路读数（`loadAuditData` + `buildProfileSummary`，同一进程）

| 读数 | 修前（`0.1.0-rc.6`，旧 roots） | 只修 layer（半修） | 修完（layer + row 同根） |
|---|---|---|---|
| `dsh` | `0.1.0-rc.6` | `0.2.2-rc.1 (kernel)` | `0.2.2-rc.1 (kernel)` |
| `layers` | 17 | 22 | 22 |
| `rows` | 198 | 285 | 285 |
| `judged` | 20 | 214 | 90 |
| `denied` / `blocked` | 8 | **119** | **0** |
| `collisions` | 1 | 0 | 0 |
| `duplicateCopies` | 13 | 13 | 13 |
| `tone` | `broken` | `broken` | `attention` |

「只修 layer」那一列是这一轮最值得记住的数：**半修会把 9 条假答案升级成 119 条**。
它当场被真机读数抓住，然后由 `N9` 钉在测试里。

剩下的 `attention` 来自 5 条 `duplicate`（`@anthropic-ai/sdk`、`@babel/runtime`、`@opentelemetry/api`、
`@types/node`、`commander` 的多版本副本）与 90 条 `unknown`。**这两类本轮没有动**，
也没有把它们算进任何新结论——它们是另一个判断问题，不是这一轮的证明。

## 6. 诚实边界

- 这一轮修好的是**取数**，不是**判定**。如果真实运行时确实不接受某个插件，结论仍然是 `denied`——
  而且现在它能说清是拿哪个版本比的。
- `kernel` 只说明「这个版本来自正在运行的那个包」，**不说明**「这个版本被正确使用」；
  插件是否真的被加载，仍是 `probe` 的事。
- CLI 在 desktop 形态下会长期停在 `inferred`。这是**已知且已登记**的边界（M11-C7），
  不是待修的 bug；要补也必须是另一次判据轮，不能顺手。
