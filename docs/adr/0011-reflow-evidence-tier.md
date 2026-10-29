# ADR 0011 · 回流证据的 tier，与 D4 到底能不能被测量（`T-501` / D4）

> **状态**：**accepted（A，2026-10-29 代签）**。签字见 §签字区；记账见 `audit/SIGNOFF.md`（HUMAN 原话「你自己分析研究进行，我全部同意」，未逐条复核，**可撤销**）。
> **A 案含义**：先验只出现在 `check --explain` 的 `prior` 注解块（以及排序），**永不进 `conclusion`**；D4 判据随之改写为「先验与后测的一致率」。B/C 两案未签。
> **本文件不改任何东西**：不新增 tier、不改 `conclusion`、不改门禁正则、不改 ROADMAP 的 D4 原文、不改 `PROJECT_RULES.md`。它只把「回流的先验能不能改结论」变成一道可签字的题。
> **卡住的是什么**：`docs/ROADMAP.md` §2 的 D4 要求「回流数据能显著提升判断（有先验 vs 无先验的**命中率差 ≥10pp**）」；而 `docs/05-verdict-contract.md` §2c/§2d 与 `packages/core/src/compat-channel.ts` 的铁纪律是「次要证据**永不**改变 `conclusion`」。两条同时成立时，「有先验 vs 无先验」的命中率差**在构造上恒为 0**——D4 写得再清楚也测不出来。

## 1. 背景（全部是仓内已记录的约束，不是推测）

| # | 约束 | 出处 | 对 D4 的后果 |
|---|---|---|---|
| C1 | D4 原文：「回流数据能显著提升判断（有先验 vs 无先验的命中率差 ≥10pp）」 | `docs/ROADMAP.md` §2 | 「命中率」**没有定义分母与语料**：既可能是 D1 式案例命中率，也可能是 D2 式 `go/(go+blocked)`。两者都需要一份带标签的语料，而回流数据本身没有标签。 |
| C2 | 只有四态结论；`evidence` 非空；`tier ∈ {inferred, declared, scanned, measured-registry, measured-local}` | `docs/05` §3；`packages/core/src/types.ts` 的 `EvidenceTier`；门 `verdict-contract` 的枚举断言 | 要让先验「改结论」，必须先加一个 tier 成员，并同时改门禁枚举 —— 这是**契约变更**，不是加一个字段。 |
| C3 | 次要通道（`dsh.compatibility` / `registry.*` / 区间形状）**永不改变** `conclusion` / `confidence`，最坏只到 `unknown` | `docs/05` §2c/§2d；`verdict.ts#compatSurfacing` / `#registrySurfacing`；`tests/unit/compat-channel.test.ts` 三条 tier 纪律负对照 | 这是本项目唯一已经被测试钉死的「证据不可越级」范式。先验若越级，就与它直接矛盾。 |
| C4 | `unknown` ⇒ `missingEvidence.length ≥ 1`，且 `missingEvidence` **只在** `unknown` 时非空 | `docs/05` §3；`types.ts` 注释 | 若先验把 `unknown` 升成 `go`，要么放宽这条不变量（契约变更），要么额外写一条「这个 `go` 不是本机测出来的」的原因。 |
| C5 | 结论只对 `(package@version, dsh 版本, os/arch, node, profile)` 成立；同一 `package@version` 在 0.2.1-rc.4 是 `go`、在 0.1.0-rc.6 是 `blocked`，**两次都对** | `BS-38`；`docs/HANDOFF.md` §4 坑表同一行 | 群体先验必须按**精确键**匹配，不能按包名或 semver 区间匹配，否则就是把别人的运行时结论贴到你的运行时上（`BS-05`）。 |
| C6 | 同一台机器、同一 pin、同一运行时，重复测量**已经会不一致**：`dsh-mcp-connector@0.2.83` 在 R27–R29 五次里是 1 次 `go`（22.5s）/ 2 次 `unknown` / 2 次 `go` | `BS-32`；`data/results/probe-matrix-2026-10-29T01-00-00.000Z.json`、`d2-2026-10-29T01-30-00.000Z.json`、`probe-matrix-2026-10-28T09-40-00.000Z.json` | **「命中率」需要 ground truth，而 ground truth 本身在抖**。任何「先验把命中率抬高 10pp」的断言，都会被这条抖动吃掉；这是 D4 结构上不可测的第二个原因。 |
| C7 | 严禁行为第 5 条：输出必须确定性、禁随机 ID；铁律 5：SSOT 只由脚本产出 | `PROJECT_RULES.md` | 本地 outcome 库不是 SSOT（不进 `data/results/`、不进仓），随机 `id` 只允许存在于本地库；任何进仓的产物只能记**计数与哈希**。这一点由 `docs/specs/M5-reflow.md` §3 与门 `outcome-privacy` 钉住。 |
| C8 | 上游不静态声明工具名，工具注册在 agent/preset 作用域 | `BS-21` / `BS-22` | 「别的用户在这个插件上看到了工具 X」这类回流证据，连**本机**都取不到，更不能当作判断依据。回流能承载的字段必须严格限定在四态结论与 messageId 上。 |

## 2. 冲突的精确形状

设先验为 `P`、本机判断为 `J`。「先验提升命中率」这句话只有在 `P` 参与决定 `conclusion` 时才有非零期望差。于是只有两种自洽读法：

- **读法 1（先验参与判定）**：`P` 可以改变 `conclusion`。那么 `P` 就不是「次要证据」，C3 被推翻，C2 的 tier 枚举必须扩容，门 `verdict-contract` 的枚举断言与 `docs/05` §3 的表格必须同改。
- **读法 2（先验不参与判定）**：`P` 只能注解/排序。那么「有先验 vs 无先验」的 `conclusion` 序列**逐字节相同**，命中率差恒为 0 —— D4 原判据**永远不可能达标**，不是「还没测」，而是「测了也必然 0」。

**没有第三种读法**：把「先验让用户更早看到有用的东西」算成「命中率提升」是改判据的定义，不是测出来。

## 3. 三条路（互斥，选一条）

| 方案 | 做法 | 代价（可测的部分） | 我们能说的话 | 我们必须继续禁止说的话 |
|---|---|---|---|---|
| **A. 先验只做注解（推荐）** | 先验只出现在 `check --explain` 的一个独立 `prior` 块里；`conclusion` / `confidence` / `evidence[]` / `missingEvidence` 一个字都不动。D4 改写为「**先验与后测的一致率**」。排序**本里程碑不实现**（将来要用，也只能用同一个注解块，不得改结论） | 一个 messageId 命名空间 `prior.*`（三处同改：`messages.ts` 中英、门 `verdict-contract` 正则、`docs/05` §3）；一个 `--explain` 文本块；一个 D4 报表脚本。**tier 枚举 0 改动、契约不变量 0 改动** | 「在同一个精确键上，先验与随后一次本机测量的**一致率**是 X%（n=k，Wilson 95% a–b）」 | 「先验提升了命中率」「有先验的判断更准」「先验可以解决 `unknown`」 |
| **B. 新增 tier `measured-crowd`（只能解 `unknown`）** | 新 tier 成员；聚合快照以产物形式随包分发；只对**完全相同的键**、且本机结论是 `unknown` 时生效，只能把 `unknown` 升成 `go`，永不升 `blocked`/`risky`，置信度封顶 `low` | tier 枚举 +1、门枚举断言、`docs/05` §3 表、`messages` 新命名空间、**聚合快照的生产链**（= 上传/聚合，本身就是另一道 ADR）、**去重身份**（见边界 B7） | 「该键在 n 个样本里一致为 `go`，因此把本机的 `unknown` 升为 `go`（置信度低，且本机什么都没测）」 | 「先验可以推翻本机实测」；任何 `blocked` → `go`；任何 `risky`；任何 `high` 置信度 |
| **C. 只做本地半边，D4 推迟** | 只交付 outcome 记录 / 0 PII / 删除路径；**先验连注解都不做** | 最小；但 D4 在 W8 无结论，必须带新的日期与退出条件 | 「我们已经能记录、能删除、能证明 0 PII」 | 任何关于先验的判断，包括一致率 |

## 4. A 案（推荐）：先验的精确位置与 D4 的新口径

### 4.1 先验长什么样、允许出现在哪

唯一允许的位置：`dsh-triage check --explain` 的 **`prior` 块**（`--explain --json` 时是可解析对象）。它**不进入** `verdict`：不占 `evidence[]`、不进 `conclusion`、不进 `confidence`、不进 `missingEvidence`。因此：

- `check --json`（不带 `--explain`）在「有先验」与「无先验」两种情况下**必须逐字节相同**（负对照 N3，见 spec §14）；
- tier 字符串沿用已有的 `measured-local`（它确实是**这台机器**过去测出来的），**不新增成员**；`source` 写 `local-outcomes`、`method` 写 `outcome-log`，让人一眼看出它不是本次运行的证据；
- 若将来要放群体先验，它不能借用 `measured-local`（那是本机实测），必须走 B 案的新成员 —— 这也是 A 案「零契约变更」的边界所在。

形状（`--explain --json`，节选；完整定义见 `docs/specs/M5-reflow.md` §10）：

```jsonc
{
  "prior": {
    "schema_version": 1,
    "annotation_only": true,
    "key": {
      "package": "dsh-status-rotator", "version": "0.38.0",
      "dsh": "0.2.1-rc.4", "os": "win32", "arch": "x64",
      "node_major": 24, "profile_kind": "web"
    },
    "source": "local-outcomes",
    "n": 3,
    "counts": { "go": 2, "risky": 0, "blocked": 1, "unknown": 0 },
    "majority": "go",
    "agreement": 0.667,
    "tier": "measured-local",
    "evidence_id": "prior-local",
    "note_id": "prior.annotation-only"
  }
}
```

键不完整或 `n = 0` 时，**整个 `prior` 键不存在**（不是 `null`、不是空对象）——「没有」必须与「有但为空」可区分。本机结论是 `go` / `blocked` 时**照样显示**：注解的价值恰恰在于让 disagreement 可见（先验说 `go`、今天说 `blocked`），但它绝不参与判定（负对照 N3 就是拿这个形状打的）。

### 4.2 D4 的新口径（这是本 ADR 要签的唯一判据改动）

> **签 A 即同时授权**：把 ROADMAP §2 D4 的判据从「命中率差 ≥10pp」改写为下面这条一致率口径。ROADMAP 原文由**下一轮**改（本文件不改），并在 `audit/SIGNOFF.md` 记一行。

| 项 | 定义 |
|---|---|
| 实验 | 同一份本地 outcome 库上的**回顾性双窗**实验：先验窗 `[t0, T0)` 与后测窗 `[T0, t1]`，`T0` 由操作者给定并写进产物 |
| 单位 | **精确键** `(package, version, dsh, os, arch, node_major, profile_kind)`；任何一位不同即不同键，不跨版本、不跨 profile 种类合并 |
| 分母 | **配对数** = 先验窗内该键 ≥1 条记录、且后测窗内该键 ≥1 条记录的键数（缺一侧的键不计入分母，单列 `keys_one_sided`） |
| 统计量 | `agreement = #(先验众数 == 后测第一条结论) / 配对数`，报 Wilson 95% 区间；先验众数并列时该对判 `inconclusive` 并**从分子分母同时剔除**（单列 `ties`） |
| 阈值 | `配对数 ≥ 30` **且** Wilson 下界 `≥ 0.80` → D4（A 口径）PASSED；`配对数 < 30` → **拒绝判定**（照抄 `d2_report` 在真实启动 <10 时的做法：写 `gate.passed=false` + `reason=insufficient-pairs`，不是「通过」） |
| 产物 | `data/results/d4-<stamp>.json` + `.sha256`，由 `scripts/d4_report.mjs` 真跑产出；`produced_by` / `generated_at` / `schema_version` 齐全（铁律 5）；**只含计数与 `input_sha256`，不含任何记录内容与 `id`** |

**为什么不是「命中率」**：C6 已经证明同一个键在本机重复测量会不一致（1 go / 2 unknown / 2 go）。没有 ground truth，「命中」无法定义；一致率不需要 ground truth，只需要两次可重放的读数。这就是 A 案能说真话、B/D4 原文不能的原因。

### 4.3 A 案明确**不**做的事

- 不改 `EvidenceTier`、不改门 `verdict-contract` 的 tier 枚举、不改 `conclusionRank`；
- 不让先验进入 `verdict`（`check --json` 字节不变，负对照 N3）；
- 不做聚合、不做上传（见 spec §12）；
- 不声称「先验解决了 `unknown`」。

## 5. B 案（若 HUMAN 想选）：全部边界，写死到可机器检查

选 B 就必须同时接受：**B 不能先于上传落地**（没有跨机器的聚合快照，`measured-crowd` 无数据可读），而上传本身需要另一份 ADR（暂记 `0012`，未写）。

| # | 边界 | 机器检查 |
|---|---|---|
| B1 | 新 tier 名 `measured-crowd`，插在 `declared` 与 `measured-registry` 之间（语义：跨机器的实测，强度低于本机实测） | 门 `verdict-contract` 的 tier 枚举 + `types.ts` + `docs/05` §3 三处同改；旧产物逐字节不变（枚举扩容不改输出） |
| B2 | **只在**本机 `conclusion === 'unknown'` 时生效；本机是 `go`/`risky`/`blocked` 时先验**连注解都不进 verdict** | 单测：4 种本机结论 × 有先验，只有 `unknown` 那格的 `conclusion` 可变 |
| B3 | 只能产出 `go`；**永不**产出 `blocked` / `risky` | 负对照：先验 100% 为 `blocked` 时，本机 `unknown` **仍是** `unknown`（只是多一条 `prior.crowd-disagrees` 注解） |
| B4 | 键必须是**完全相同**的七元组：`package`（精确名）、`version`（精确版本，禁区间/禁 `^`）、`dsh`（精确版本，禁 `*`）、`os`、`arch`、`node_major`、`profile_kind` | 键比较是字符串相等；单测覆盖「差一位即不匹配」7 个用例 |
| B5 | 样本门槛：该键 `n ≥ 20` **且** 一致率 `≥ 95%`（即 ≥19/20）；未达门槛只能出注解 | 单测：n=20 且 19/20 → 生效；n=20 且 18/20 → 不生效；n=19 → 不生效 |
| B6 | 置信度封顶 `{ level: 'low', basis: 'measured-crowd' }`；永不 `medium`/`high` | 门断言 + 单测 |
| B7 | **去重身份**：同一贡献者多跑不能当多个样本 —— 需要一个持久的伪匿名 id，或「每 (键, 贡献者, 天) 只计 1 条」。前者是**持久标识符**，接近 PII，本身要一道 HUMAN 决定；后者需要可信的贡献者划分 | **这一条是 B 案最贵的边界**：没有它，一次循环跑 20 次就能伪造「群体一致」 |
| B8 | 必须同时挂一条 `prior.crowd-only`（`info`），文案写明「本机什么都没有测」；不得让 `go` 看起来像实测 | `messages.ts` 新增 messageId + 门正则 |
| B9 | 聚合快照必须是**随包分发的只读产物**（`data/results/priors-*.json` + sha256），`check` 运行时**不得联网** | 门 `outcome-privacy` 的网络符号扫描 + 产物 sha256 校验 |
| B10 | 与 C5 冲突时的裁决：若本机 `dsh` 版本读不出来（`env.dsh === null`），先验**不可用**（键不完整） | 单测：`dsh=null` 时 `prior` 键不存在 |

**B 案最贵的地方不是 tier，是 B7。** 一个「群体先验」若分不清「20 个人各跑一次」和「1 个人跑 20 次」，它就不是先验，是刷量入口（与严禁行为第 3 条同类）。

## 6. C 案（若 HUMAN 想选）

只交付 spec 里的本地半边（§1–§9、§11–§12、§14–§17；**不含** §10 与 §13），**连 `check --explain` 的 `prior` 块也不做**。代价：`T-501` 的「本地先验」这半句落空；D4 必须改成「待用户基数与上传路径成立后再议」，并写清退出条件（例如「≥100 个安装、≥30 个精确键达到 n≥20」—— 这两个数字今天都是 **unmeasured**，我们没有任何安装量读数）。

## 7. 建议（R41，agent 自评，**不改状态**）

**选 A。** 理由按权重排序：

1. **A 是唯一今天就能真跑的判据**：它只需要本地 outcome 库 + 一次后来的本机测量，两样都是 `M5-a` 自己产出的东西；B 需要上传与聚合（另一道 ADR + 用户基数），C 直接放弃测量。
2. **B 的收益在 A 之前无法证成**：A 测出来的「一致率」正是 B 的风险指标 —— 一个连自己上次结论都对不上的先验，凭什么去解 `unknown`？先做 A，等于先用最便宜的方式测 B 的前提。
3. **B 改的是契约，A 改的是报表**：B 要动 tier 枚举与门禁断言（C2），并把「证据不可越级」这条被三条负对照钉死的纪律开一个口子（C3）；A 一个契约字段都不动。
4. **键密度今天无法估**：`package × version × dsh × os × arch × node × profile` 的笛卡尔积会把多数格子打空。我们的安装量、活跃键数、每键样本数**全部 `unmeasured`**；在没有这些数字之前用「≥10pp」给它下判据，是拿判据代替证据（铁律 1 的反面）。
5. **C6 已经给出了天花板**：同一键本机重复测量本身就会不一致，所以「先验提高命中率」的任何版本都需要一份不存在的 ground truth。A 的一致率口径绕开了这个死结，而且不给用户任何「更准」的错觉。

**会让我改推 B 的证据（三条同时成立才改）**：

| # | 证据 | 今天的读数 |
|---|---|---|
| F1 | A 口径跑出 `配对数 ≥ 30` 且 Wilson 下界 `≥ 0.80`（先验足够准） | `unmeasured`（最多 13 对：`tests/fixtures/probe/matrix-r19.json` 的 13 个真实候选，一个 dsh 版本） |
| F2 | 键密度：`≥30` 个精确键达到 `n ≥ 20`，且来自 `≥3` 个不同贡献者 | `unmeasured`，**且结构性需要上传**（→ 需先签上传 ADR） |
| F3 | 需求面：在 `≥100` 条 `unknown` 结论里，`≥10%` 能被某个可用键覆盖（可在本地统计，无需上传） | `unmeasured`（本机 `unknown` 目前主要来自 `BS-21`/`BS-28` 一类结构问题，不是「缺人群数据」） |

**任一条不成立就留在 A**；三条同时成立才重开本 ADR。尤其 F2 不成立时，即使 F1 成立也只能留在 A —— **样本不足的先验不是证据，只是别人的运气**。

## 8. 签 A 之后 D4 长什么样（一句话版）

D4 从「先验让命中率提高 ≥10pp」变成「**先验与随后一次本机测量的一致率，在 ≥30 对精确键上，Wilson 95% 下界 ≥ 0.80**」；达不到就如实写 `insufficient-pairs`，不许改成「接近通过」。

## 9. 后果与待办（按选中方案）

- **若签 A**：`docs/specs/M5-reflow.md` 直接可执行（它的 §10 就是 A 的形状）；下一轮改 `docs/ROADMAP.md` §2 D4 一行（**需要本 ADR 已被签**）、补 `prior.*` 三处同改、写 `scripts/d4_report.mjs` + 门 check `outcome-privacy`。
- **若签 B**：先写上传/聚合 ADR（`0012`），再回来实施 B1–B10；`M5-a` 只能先交付 C 的本地半边，`measured-crowd` 留空实现。
- **若签 C**：`docs/specs/M5-reflow.md` 的 §10 / §13 整段作废，D4 换日期与退出条件。
- **任一方案都不许**：把「先验」写成 `evidence[]` 里的 `measured-local`（B 需要新成员；A 根本不进 verdict）。

## 签字区（HUMAN）

> **签字状态**：`2026-10-29` 由 HUMAN 委托代签（会话内原话：「你自己分析研究进行，我全部同意」），
> 采纳 **A**。记账见 `audit/SIGNOFF.md`（含「HUMAN 未逐条复核」与**可撤销**说明）。

```
[x] A. 先验只做注解/排序（`check --explain` 的 `prior` 块），D4 改写为「先验与后测的一致率」（推荐）
        —— 勾这一项同时授权改写 `docs/ROADMAP.md` §2 的 D4 判据（判据变更 = 需 HUMAN-SIGN，铁律 4 同类）
        —— 代签（2026-10-29）：HUMAN 原话「你自己分析研究进行，我全部同意」；撤销只需在此行下追加
[ ] B. 新增 tier `measured-crowd`，只能把 `unknown` 升 `go`，并接受 §5 的 B1–B10 全部边界
        —— 必须先有上传/聚合 ADR；B7（去重身份）需要单独决定
[ ] C. 只做本地半边（记录 / 0 PII / 删除），先验与 D4 一起推迟
```

> 未勾选前：`T-501` 只能按 **C 的范围**准备（outcome 记录、0 PII 门、删除路径），**不得**写任何读先验的代码路径；`D4` 保持原文（不可测），也不许在对外材料里写「回流能提升判断」。
> **本 ADR 已签 A（2026-10-29，代签）**：`T-501` 的本地半边与 `check --explain` 的 `prior` 注解块都可实施；`docs/ROADMAP.md` §2 的 D4 改写为「先验与后测的一致率」是 A 案授权的一部分。**仍然不许**新增证据 tier、不许让任何先验进入 `conclusion`。
> 本 ADR **不是** tier 变更的授权书：即使签了 B，`EvidenceTier` 的改动也必须按 B1 三处同改并在同一轮里补负对照。
> **可撤销**：HUMAN 随时可以划掉勾选改签别的方案；撤销只需在本行下方追加，不需要改正文。
