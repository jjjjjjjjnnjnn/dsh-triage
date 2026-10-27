# 开源借鉴台账（09）· 别人的诊断逻辑，怎么搬进分诊台

> **Stand**: R8 (2026-10-27)｜目的：把「生态里已经想清楚的问题」借过来，而不是重新发明
> **许可立场**：本仓库**不复制任何第三方代码**。这里记的是**机制与呈现方式**（idea-level borrowing），实现由我们自己写、自己测。若将来确实要复制 MIT 片段，必须先落 `quarantine/` 并在 `quarantine/vendor-manifest.json` 登记（`PROJECT_RULES.md` 铁律 6），并在本文件的「license」列标明。
> **证据等级**：A = 本轮实抓了权威页面/仓库原文；B = 广为人知的既有设计（未在本轮抓取，引用时不得当作实测证据）。

---

## 1. 总表：谁解决了我们的哪个问题

| # | 来源 | 它解决的原始问题 | 我们借走的机制 | 落地状态 | 许可 | 证据 |
|---|---|---|---|---|---|---|
| 1 | **npm `explain`** | 「这个包为什么在这儿？」用户只看到结果，看不到依赖链 | 输出**依赖链/来源**，而不是只报结论 | ✅ **R8 已落地**：`why` 的行级结论里点名「这份副本来自 `dsh-pdf@0.1.0` 的 `dependencies`」（`admission-row-declared-by`） | npm CLI 文档（引用，未复制代码） | A（docs.npmjs.com） |
| 2 | **Maven enforcer `dependencyConvergence`** | 同一 artifact 在 classpath 上出现两个版本 | ①「同名不同版本」本身就是 finding；② 报错必须**同时打印两条路径**，否则不可行动 | ✅ **R8 已落地**：`audit` 的 duplicate copies 段与 `collision-duplicate-copy` 结论（两条副本 + 各自版本 + 相对路径） | Apache-2.0（仅借鉴机制） | A（maven.apache.org） |
| 3 | **`pip check`** | 「已安装集合自洽吗？」 | ① 用**已安装集合**而不是候选包做一致性检查；② 文案模板「X requires Y, which is not installed」「X has requirement R, but you have V」；③ 有问题时 exit 1 | ✅ 部分落地：我们的 duplicate/missing-entry 文案照这个句式；`audit` 有 finding 即 exit 1 | MIT（仅借鉴机制） | A（pip.pypa.io） |
| 4 | **`arethetypeswrong` (attw)** | 包能装但 import 会失败（ESM/CJS、exports 条件） | **解析矩阵**：按 (运行时解析模式 × 入口) 逐格判定，并给失败格一个**命名分类**（resolution failed / false CJS / false ESM / unexpected module syntax / internal resolution error） | ⬜ **设计**（T-113）：给 `check` 加「候选入口可加载性」矩阵。**前置条件**：先从上游沙箱实测 loader 用哪种解析模式，否则会造出假警告 | MIT | A（GitHub README） |
| 5 | **`publint`** | 包发布内容在别的环境不可用 | 「按环境逐条 lint 打包产物」的清单式输出 | ⛔ **不做**：这是插件作者侧的 linter，不是用户侧判断层。我们可以把结论输出成可粘贴给作者的段落，但不做 lint | MIT | A（GitHub README） |
| 6 | **`cargo-semver-checks`** | 新版本悄悄破坏 API | **witness 原则**：每条失败必须给出「哪一项、哪一行、为什么算破坏」的证据，否则不算失败；并有明确 exit status 契约 | ✅ 已作为**工程原则**：结论必须带可复算 `params`（见下方「口径修正」：`gate_verdict_contract` 目前锁的是 messageId/severity/条件断言，占位符完整性尚未纳入 → T-116）；后续 M5-b 升级影响清单沿用此原则 | MIT/Apache-2.0 | A（GitHub README） |
| 7 | **VS Code `Extension Bisect`** | 装了 24 个扩展，不知道哪个坏的 | **二分**：一次禁用一半，逐步收敛；灵感来自 `git bisect` | ⬜ **设计**（T-114，M3）：`triage bisect`——需要能真启停（probe），因此排在 M3 | MIT | A（code.visualstudio.com） |
| 8 | **`dpkg --audit`** | 「装了但没配好」的包 | 把**安装成功 ≠ 状态正确**做成一等公民视图 | ✅ 概念已落地：M2-a 相位层（`failed` / `no-fiber` / `disabled` 三态） | GPL（仅借鉴概念） | B |
| 9 | **systemd `systemctl --failed`** | 系统里哪些单元失败了、为什么 | ① failed 优先展示；② `status` 给出「为什么」而不是只给状态 | ✅ 已落地：`audit` 先给相位结论卡再给明细 | LGPL（仅借鉴概念） | B |
| 10 | **Kubernetes pod phase** | 一个对象的生命周期状态机（Pending/Running/Failed/…） | 相位词表与「相位 ≠ 可用」的区分 | ✅ 已落地（上游 `fiberPhase` 本身即此模型） | Apache-2.0（仅借鉴概念） | B |
| 11 | **Homebrew `brew linkage --test`** | 声明了依赖但没真的链上 | 逐条核对「声明 vs 实际」并列出**未满足项** | ✅ 已落地：`missing`（声明有、快照无）/ `undeclared`（快照有、声明无）双向 diff | BSD-2（仅借鉴概念） | B |
| 12 | **`syncpack` / `@manypkg/cli`** | monorepo 里版本区间不一致 | 「同类声明必须对齐」的检查 | ⬜ **设计**（T-115）：对候选插件提示「peer 用精确钉定 → 上游每次 patch 都会把你打挂」，与 T-109（dist-tag 失步）同族 | MIT | B |
| 13 | **`npm audit`** | 已知漏洞库 | —（**明确不借**） | ⛔ 拒绝：本项目不做安全扫描/安全背书（`PROJECT_RULES.md` 严禁行为 2）；没有漏洞库也不该暗示安全 | — | B |
| 14 | **`depcheck` / `knip`** | 未使用的依赖/导出 | —（只借了「声明 vs 使用」的思想） | 🟡 已有等价物：`missing-entry` 就是「声明了但没注册」；「装了但没人用」会变成噪音，不做 | MIT | B |

---

## 2. 本轮真正落地的两个机制（R8）

### 2.1 安装来源归因（借 npm `explain` + Maven「paths to dependency」）

**问题**：CASE-10364 / CASE-10759 里，用户看到的是「`tools` 行被禁用」——但真正要查的是「这份旧 `dsh-tools` 是谁带进来的」。原报告的源码级回复明确说：缺的就是这一行。

**做法**：`packages/plugin/src/load.ts#findDeclarers` 扫描 profile 与共享 `node_modules` 的 `dependencies/devDependencies/peerDependencies/optionalDependencies`，把「哪个包、哪个字段、哪个版本」挂到对应行的结论上；只在**该行真被拒**时才输出，避免 80 行全是噪音。`peerDependencies` 不算来源（peer 不会落地副本）。

**输出**：

```
reason   the "@deepseek-ai/dsh-tools" copy in this profile is there because dsh-pdf@0.1.0 lists it under dependencies
fix      [remove-plugin] move @deepseek-ai/dsh-tools from dsh-pdf dependencies to peerDependencies (or drop the declaring plugin) so the copy disappears
```

### 2.2 重复副本检测（借 Maven `dependencyConvergence` + `pip check`）

**问题**：#10364 的回复里描述了一个**静默变体**——旧副本版本「够兼容」所以过掉了所有 admission 检查，宿主正常启动，然后每个工具调用都挂在 `TOOL_RUNTIME_SCHEDULER` 上（两份模块各自求值了一次）。这是 Maven 的 classpath 双版本问题。

**做法**：`load.ts#findDuplicateCopies` 扫三处：profile 自己的 `node_modules`、共享 `profiles/node_modules`、以及**插件自带的嵌套 `node_modules`（一层）**；同一包名出现在 >1 处且**版本不同**才出结论（同版本是 pnpm 的硬链正常形态）。路径一律相对 DSH home，避免把用户名写进 SSOT。

**输出**：`risky`（不是 blocked——宿主可能还能启动），`collision-duplicate-copy`，两条副本各自 scope/版本/相对路径。

**边界（R8 独立复核后写清，别当成全覆盖）**：

| 项 | 现在的行为 | 不覆盖 |
|---|---|---|
| 同版本两份 | **静默**（pnpm 硬链的正常形态） | — |
| 版本读不到 | 静默（未知 ≠ 不同；无法证明就不报） | 清单里被人手改坏的情况 |
| 嵌套副本 | 扫**一层** `node_modules`，且不需要根目录先有同名副本 | 两层以上（pnpm 深层树） |
| 软链 / `link:` | 会跟随（`linked: true` 标在副本上） | — |
| 来源字段 | 只认真正会落地副本的 `dependencies` / `optionalDependencies`（profile 自身另含 `devDependencies`） | `peerDependencies`（不装卸）、`overrides`/`resolutions`、lockfile 手钉 |

---

## 3. 借了但**没有**落地的，以及为什么

| 项 | 为什么先不做 | 退出条件 |
|---|---|---|
| attw 式「入口可加载性矩阵」 | 我们不知道上游 loader 用哪种解析模式（node16? bundler? CJS require?）。没实测就上矩阵 = 造假警告，违反铁律 1 | 沙箱里用两种解析模式各加载一次真实插件，把实际行为记进 `data/results/` 后再实现（T-113） |
| Extension Bisect | 二分需要「禁用一半行 → 重启 → 观察」；我们连真机 0.2.x profile 都没有 | M3 probe 落地后（T-114） |
| 版本区间对齐（syncpack 思路） | 属于插件作者侧建议，容易变成说教 | 与 T-109 合并考虑，先有 dist-tag 失步信号 |
| publint 式打包 lint | 不是用户侧问题；会稀释「判断层」定位 | 不做（明确写下，避免以后又被拉回来） |
| `npm audit` 式漏洞扫描 | 严禁行为 2：不做安全背书 | 永远不做 |

---

## 4. 借鉴纪律（防止「抄了个热闹」）

0. **可审计性**：本轮 A 级来源的抓取日期为 2026-10-27，URL 见 §1 表末列之外的原始链接（`https://docs.npmjs.com/cli/v10/commands/npm-explain`、`https://maven.apache.org/enforcer/enforcer-rules/dependencyConvergence.html`、`https://pip.pypa.io/en/stable/cli/pip_check/`、`https://github.com/arethetypeswrong/arethetypeswrong.github.io`、`https://github.com/bluwy/publint`、`https://github.com/obi1kenobi/cargo-semver-checks`、`https://code.visualstudio.com/blogs/2021/02/16/extension-bisect`）。**本仓未提交抓取原文**，所以 A/B 分级本身不可被第三方独立复核——这是已知限制，登记在案，不假装是实测证据。
1. **先有失败样本，再借机制**：每个借鉴条目必须对应 `data/cases/` 里的真实案例或 `audit/` 里的明确缺口；没有样本的机制先记在本文件 §3。
2. **只借机制，不抄代码**：本文件「许可」列说明来源；真要抄代码 → 先 `quarantine/` + `vendor-manifest`。
3. **呈现方式也要借**：Maven 的两条路径、pip 的句式、systemd 的「failed 优先」，这些**格式**决定了诊断是否可行动；只借算法不借呈现，等于没借。
4. **不借边界**：别人做安全、做市场、做启动器，我们不做（见 `docs/01-competitors.md`、`PROJECT_RULES.md` 严禁行为）。
5. **复核优先于自信**：R8 的独立复核推翻了本文件两处措辞（「同版本从不被报」与「gate 锁死 params」），当轮即修；每轮如此。
