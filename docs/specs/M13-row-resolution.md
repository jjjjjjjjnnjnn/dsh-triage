# M13 · 行的模块解析判据（row resolution）

> **Stand**: R95 (2026-11-11)｜**状态**: 判据先行，实现随本轮交付
> **这条 spec 回答一件事**：一个 loader 行说它 import 了 `X` 时，「`X` 是哪个版本的哪个副本」应该按谁的规则查？
> 今天的答案是「按 `moduleRoots()` 的扁平查找」，它在一份真实的 pnpm `isolated` profile 上只能解析
> **2 / 190** 行，于是把 188 行报成 `admission-row-missing`（「这个 profile 下没装」）——而那 188 个包
> **全都在磁盘上**，加载器每次启动都在用它们。

## 1. 证据（R95 现场，`BS-61` 的根因）

`BS-61` 原本记的是「同一份沙盒 profile 上，面板 72 / CLI 184，两条同源断言红」。R95 把这件事拆成了
「两边各自怎么解析」，并在**同一种沙盒形状**上复算（临时 home、profile manifest 只有四个直接依赖、
由 `dsh plugin --profile web install` 装依赖，与 `scripts/record_client_serve.mjs` 同构）：

| 复算方式 | resolved | verdicts | `row-missing` | `row-unconstrained` |
|---|---|---|---|---|
| **A** 现装代码（CLI 侧：无锚点 → `kernelRoots = 0`） | **2 / 190** | **184**（全 `unknown`） | 184 | 0 |
| **B** A + 把 `.pnpm/node_modules` 当一个扁平根 | 190 / 190 | **72**（全 `unknown`） | 0 | 72 |
| **C** 按 Node 规则：从**声明该行的 bundle 的 realpath** 解析 | **190 / 190** | **72** | 0 | 72 |

四桶（`upgrade --to 0.2.2-rc.1`，同一目标）：A = `3 / 189`；B = C = **`119 / 73`**；
`client-serve-2026-11-11T18-27-00.000Z.json` 里面板是 **`119 / 74`**（差的那一个 `likely_fine` 是沙盒把
`dsh-triage` 自己也当 bundle 装了进去）→ **B / C 与面板逐项相同，A 与产物里的 CLI 逐字相同**。

**机制**：`scripts/lib/bundle.mjs` 的 `SANDBOX_PNPM_WORKSPACE` 只写 `strictDepBuilds: false`，没有
`nodeLinker`，于是 pnpm 用**默认的 `isolated`**：`<profile>/node_modules` 顶层只有四个直接依赖 + `.pnpm`，
整棵树在 `.pnpm/<pkg>@<ver>/node_modules/`。`moduleRoots()` 只会做 `<root>/<name>/package.json` 这种
**扁平**查找，三个 root（`kernel ∪ profile/node_modules ∪ profiles/node_modules`）没有一个落得进那棵树。

**而面板是对的**：Host 是被 `install/node_modules/@deepseek-ai/dsh/lib/bin.js` 启起来的，
`resolveKernelAnchor()` 走 `process.argv[1]` 拿到 `kernel` 锚点，那份 install 是 **hoisted**（306 个包扁平摆着）
→ 190 行全解析 → 72。

**所以 `BS-61` 不是「面板与 CLI 各读了一份」，而是「CLI 侧看不见这棵树」。** 它对真实用户同样成立：
pnpm 的默认 linker 就是 `isolated`，任何用默认布局建的 profile 都会读成「大半行没装」。

### 1.1 本机真实 profile 的对照（缺陷被布局藏住了）

| profile | 布局 | A 现装代码 | C Node 规则 | 是否分叉 |
|---|---|---|---|---|
| `~/.dsh` → `desktop` | `nodeLinker: hoisted` | 155 / 160 resolved，22 verdicts | **完全相同** | 否 |
| 沙盒（`record_client_serve` 建的那个） | `isolated`（默认） | 2 / 190 | 190 / 190 | **是** |

同一张表说明两件事：这个缺陷在维护者本机被 `hoisted` 藏住了；而它与 `BS-61` 是同一个根因的两种投影。

### 1.2 为什么不能「把 `.pnpm/node_modules` 加进 moduleRoots()」

那一层是 pnpm 的**便捷软链层**：每个**名字**一条软链，只能指向一个版本。R95 实测（沙盒里 296 个名字）：

- **16** 个名字装了多于一个版本；
- 其中 **11** 个的软链指向的**不是**某个声明者要的那份（`debug` 软链指 2.6.9、还有 4.4.3；
  `zod` 指 4.4.3、还有 4.6.7；……）；
- 幸运的是本轮 190 行里**没有一行**的模块落在这 16 个名字上（`0 / 190`），所以 B 与 C 才会给出同一个答案
  ——这是**这一份 profile 的巧合**，不是可以依赖的性质。

拿那个软链当答案，等于「拿一份加载器根本不会载入的副本去判」，正是本产品要防的那类错误。
所以修法必须是 **C：按 Node 的规则解析**，而不是「多搜一个目录」。

## 2. 判据（写进代码里的）

**M13-C1（来源锚点）**　一行 `X` 的副本，必须按 **Node 自己的解析规则**从「声明这一行的那个包」开始查：
即 `<声明者真实目录>/node_modules/X`，逐级向上；声明者是 bundle 时，用它**解析后的真实路径**
（pnpm `isolated` 下 `<layer>` 是软链，真实路径在 `.pnpm/<pkg>@<ver>/node_modules/<pkg>`，它的同级
`node_modules` 才是整棵树）。`patch:profile` / `patch:home` 声明的行，声明者就是 profile 目录本身。

**M13-C2（只做加法，不改已有答案）**　新规则只在**现有扁平查找失败**之后启用。任何今天能解析出结果的行，
版本**必须逐字节不变**——包括 `M11-N9` 钉住的「内核副本优先于陈旧共享缓存」。理由：现有答案背后有金标、
有 `N9`、有针对真实 profile 的读数；一次「重写解析器」会把它们全部作废。

**M13-C3（解析不到仍然是解析不到）**　新规则解析失败的行，**保持 `null`**，结论仍是 `unknown` +
`missing.row-module`。`createRequire().resolve()` 抛异常与「磁盘上没有这个包」在产物里是同一种事实，
不许用任何兜底把它变成 `go` 或 `blocked`。

**M13-C4（声明者可追溯）**　`resolveRows()` 的输入必须能说出「这一行是谁声明的」。层到目录的映射来自
`loadComposition()` 已经读出的 `layers[].dir`（不是从 `source` 字符串里猜），因为 `source` 的写法
（`bundle:<name>` / `bundle:<name>/<file>` / `patch:profile` / `patch:home`）是给人看的标签，不是路径。

**M13-C5（噪音不增加）**　新规则**不得**让 `verdicts` 条数变多，除非那些行的 `row-missing` 因此消失：
一条今天 `row-missing` 的行，若新规则解析到了，它就换成一条真实的 admission 结论（`go` / `blocked` /
`unconstrained` 三选一）；一条今天已经解析的行，一条 verdict 都不许多。

**M13-C6（两条同源断言的第二半）**　`BS-61` 的验收判据不变：**同一条 `record_client_serve` 命令里
`same-source` 与 `upgrade-same-source` 同时绿**。本 spec 只覆盖「CLI 为什么看不见树」这一半；
若修完仍红，说明 Host 与 CLI 还差在别处（`env` / `dshHome` / `profile` 解析），按 `M13-C6` 继续定位，
**不许**为此放宽或删除这两条断言。

## 3. 负对照（每条都必须能真红）

| ID | 构造 | 必须观察到 |
|---|---|---|
| **M13-N1** | 一份 `isolated` 布局的夹具 profile（`.pnpm/<pkg>@<ver>/node_modules/<pkg>` + 顶层只有直接依赖），一行指向一个**只在 `.pnpm` 里**的模块 | 修前 `version: null`（`row-missing`）；修后解析到**正确版本**。夹具必须是真的 isolated 形状（顶层不能有那个包），否则这条对照恒绿 |
| **M13-N2** | 同一夹具，再放一份**不同版本**在 `.pnpm/node_modules/<name>`（便捷软链层） | 解析到的是**声明者要的那份**，不是便捷层那份；把实现改成「加一个扁平根」→ 当场红 |
| **M13-N3** | 一个今天就能解析的行（`hoisted` 夹具，扁平 root 里有它） | `version` 与修前**逐字节相同**；把实现改成「先 per-declarer」并让声明者目录里放一个不同版本 → 红（证明 `M13-C2` 的「只做加法」被钉住了） |
| **M13-N4** | 一个**真的不存在**的模块 | 修后仍 `null` + `row-missing`；把它改成「猜一个版本」→ 红（`M13-C3`） |
| **M13-N5** | 声明者目录**不可读**（层目录被删掉） | 不抛异常、不静默改用别的层；该行 `null`，且 `errors`/日志里能看出「声明者目录不可用」 |
| **M13-N6** | `record_client_serve` 的**负对照**：`--cli-home` 指向另一个 home | `same-source` 仍**必须红**（现有负对照不许因为本轮而失效） |
| **M13-N7** | 真机复跑 | `same-source` 与 `upgrade-same-source` **同时绿**，且 `declared` 仍是 219（分母没被改动） |

## 4. 诚实边界

1. **本 spec 不动** `admission.ts`、`data/gold/`、四桶的判定顺序与阈值、D5 三个数、`improved` 五门槛。
   它只改「版本从哪个副本读」，不改「怎么比」——与 `M11` 同一条分界线。
2. **不改 `moduleRoots()` 的顺序**：`kernel → profile → shared` 是 `M11-C3` 已签的语义，
   `M13-C2` 把它整个保留为第二段。新规则只是在它**失败之后**补一段 Node 忠实的解析。
3. **不改沙盒的布局**：`SANDBOX_PNPM_WORKSPACE` 不加 `nodeLinker: hoisted`。
   把沙盒改成 hoisted 能让这两条断言变绿，但那是**把测试改得看不见缺陷**——正是 `BS-61` 教过的那一课。
4. **不承诺「任意布局都能解析」**：`isolated` 下 `createRequire().resolve()` 能走通是因为声明者的真实路径
   旁边就有整棵树；一个被手工挪过的 `node_modules` 仍会 `null`，那是诚实结论。
5. **不把 `unknown` 说成「没问题」**：`unconstrained` 的措辞不变（`admission.row-unconstrained`）。

## 5. 影响面

- `packages/plugin/src/load.ts`：`resolveRows()` 增加可选「层目录映射」入参 + per-declarer 兜底；
  新增纯函数（声明者 → 目录），由单测钉住 `M13-C4`。
- `packages/plugin/src/audit-data.ts` / `cli.ts` / `scripts/{record_audit,record_case,scan_env}.mjs`：
  把 `loadComposition()` 已经读出的 `layers` 传进去（不给就保持今天的行为，`M13-C2` 因此可回归）。
- 测试：`tests/unit/row-resolution.test.ts`（`M13-N1`…`N5`，8 条左右）。
- `scripts/record_mutation_controls.mjs`：新增 `M13-N1` / `M13-N2` / `M13-N3` 三条变异。
- 真机：`scripts/record_client_serve.mjs` 重跑（`M13-N7`）；产物另存，别覆盖 `18-27` 那份红件。
