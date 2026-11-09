# M12 · 什么该进「一屏」（surface）判据

> **Stand**: R92 (2026-11-09)｜**状态**: 已实现（`packages/core/src/duplicates.ts` + `packages/plugin/src/load.ts`）
> **这条 spec 回答两件事**（它们同一轮里被同一个问题撞上）：**一屏上那几条「要看的地方」，
> 到底该由谁来占位**；以及**「判不了」要不要算成问题**。
> **来源**：`docs/BACKLOG.md` 的 `T-866` / `T-867`，以及 R91 真机读数之后 HUMAN 的口头指令
> （「进行这些处理」）。

---

## 1. 起点：一屏被什么占满了

R91 把版本真相源修好之后，同一台机器的一屏从「9 条假 denied」变成：

```
tone    attention
counts  {"rows":285,"judged":90,"go":0,"denied":0,"unknown":90,"collisions":0,"duplicateCopies":13,"errors":0}
issues  5 条，全部是 duplicate
```

两类东西浮上来了，而且**两类都不是用户能动手的事**：

### 1.1 T-866：13 条「同名不同版本」，一条都不是 DSH 的东西

真机取证（`scripts` 只读，Electron in-Host）：

| 包 | 出现在哪 | 版本 |
|---|---|---|
| `@anthropic-ai/sdk` | nested + shared | 0.135.0 / 0.91.1 |
| `@babel/runtime` | profile + shared | 7.29.13 / 7.29.7 |
| `@opentelemetry/api` | profile + shared | 1.10.0 / 1.9.1 |
| `@types/node` | profile + shared | 16.9.1 / 26.2.0（**类型包，运行时不存在**） |
| `commander` | nested + profile + shared | 12.1.0 / 13.1.0 / 15.0.0 |
| `js-yaml` / `semver` / `ws` / `yaml` | profile + shared | 各差一个 patch |
| `openai` / `pngjs` / `undici` / `zod` | nested + … | 差一个 minor / major |

**13 条里，0 条是 `dsh.profile.bundles` 里的包，0 条是 `@deepseek-ai/dsh*`。**
这就是一个 hoisted `node_modules` 在任何机器上的样子：传递依赖各要各的版本。

## 2. 判据

| 编号 | 判据 | 由什么证明 |
|---|---|---|
| **M12-C1** | 一条 duplicate 只有在**它能在这个宿主里撞上**时才是 finding：`name ∈ dsh.profile.bundles`，或 `name` 是 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`。其余一律 `surface: false` | 纯函数 + 扫描层各一条单测 |
| **M12-C2** | `surface: false` **不删数据**：`audit --json#duplicates` 仍然列出全部 13 条，每条显式带 `surface`，并保留原始 `copies`；`audit` 的 "duplicate copies" 段也照旧列。消失的只有两处：**一屏 issues**，与 `why` 的 `collision-duplicate-copy`。一屏的 `counts.duplicateCopies` 数的是 **finding**（本机因此变成 0）——它必须和它下面那张列表一致，否则就是「标题说 13、表里 0 行」那种自相矛盾 | 单测：扫描结果条数不变、`surfaceOf` 正确；真机 `duplicateCopies: 0` 且 issues 里没有库副本 |
| **M12-C3** | **缺省 `surface` = finding**。手写的 duplicate（基准、旧调用方）没有这个字段，不许被当成「不算」——少一个字段不能变成一句结论 | 单测：`surface: undefined` 仍产出一条 verdict |
| **M12-C4** | 嵌套副本这条路**不走弱**：`@deepseek-ai/dsh-*` 在别的插件里的第二份，仍然是 `risky` + 两条路径 —— 那是 #10364 / #10458 的现场，也是我们对外说过的话 | 既有 8 条单测一条不改，全绿 |
| **M12-C5** | `T-867` 的 90 条 `unknown` **不是缺陷，不改判定**：真机取证显示它们的声明者是 **profile 层（90/90），内核层 0 条**，原因全是 `admission.row-unconstrained`（89）+ `row-missing`（1），即「这个插件什么都没声明」。原假设「内核 layer 带来的」不成立 | 取证脚本读数；`docs/BACKLOG.md` 结案说明 |

## 3. 负对照（必须真红）

| 编号 | 构造 | 期望 |
|---|---|---|
| **N1** | 把 `surface: canSurfaceInDsh(...)` 改成恒 `true` | 扫描层单测红：`@babel/runtime` 被判成能撞 |
| **N2** | 删掉 `verdictsFromDuplicateCopies` 里的 `surface === false` 跳过 | 纯函数单测红：一条库副本又变成 issue |
| **N3** | 把 `surface === false` 改成 `!surface`（缺省即跳过） | 「缺省 = finding」那条红 |
| **N4** | `canSurfaceInDsh` 只留 `bundles.has(name)`、去掉 `@deepseek-ai/dsh*` | 嵌套副本那条既有单测红（`@deepseek-ai/dsh-tools` 不再算） |

N1/N2 是这一对的眼睛：只做 N2 会把「谁能撞」写死在判断那一层；只做 N1 会让数据层和判断层各说一套。
N4 是**不许顺手把对外说过的话改掉**的那把锁。

## 4. 诚实边界

- `surface` 是**结构判断**，不是实测：它说的是「DSH 的 loader 会不会同时看见这两份」，
  而不是「这两份一定不冲突」。所以它只决定**要不要占用一屏**，不改变 `duplicates` 的存在。
- 反过来也一样：`surface: true` 只说明「值得看一眼」，不说明「一定坏」——`conclusion` 仍然是
  `risky`，不是 `blocked`。
- `@types/node` 这种只在类型层存在的包，仍会出现在 `duplicates` 里。**没有**按「是不是 devDependency」
  去过滤，因为我们在扫描时并不知道谁要它。

## 5. T-867 的结案（写在证据上）

原假设：那 90 条 `unknown` 是「内核 layer 带进来的」。

实测（同一台机、同一个 Host 进程）：

```
unknown rows: 90
  90  unknown · ?        ← 声明者全部来自 profile 层
unknown messageIds: {"admission.row-scope":90,"admission.row-missing":1,"admission.row-unconstrained":89}
rows total 90 · declared by kernel 0 · declared by profile 90
```

**内核层贡献 0 条。** 这 90 条就是「插件没写 `engines.dsh`、也没有 DSH peer」的那一类，
`unknown` 是它唯一诚实的结论（issue #1 的作者也这么建议）。

一屏的措辞本来就没把它们叫「异常」——zh 是「未发现阻断项，存在 {n} 项未明确版本声明」，
en 是 "Nothing is denied, but {n} thing(s) have no evidence either way"。所以 `tone: attention`
在这台机器上是**对的**：`go: 0`，我们确实一条都没判成「能跑」。

`T-867` 因此**结案为「不是缺陷」**，不产生判据改动；要改的是覆盖率，不是结论。
