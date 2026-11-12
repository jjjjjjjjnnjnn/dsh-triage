# 11 · D 线（D5 不达标时的出口）· 备用，未执行

> **Stand**: R86 (2026-11-05)｜**状态**: **contingency —— 判定前只备不执行**
> **触发条件由机器判，不由人判**：`2026-11-15T20:24:37Z` 之后按 `docs/d5-close-runbook.md` §0 跑四条命令，
> 由 `scripts/lib/d5-score.mjs#judgeD5` 给出 `pass` / `fail` / `unmeasurable`。
> **本文件不改任何判据**：D5 三个阈值（10 / 1 / 20）、判定顺序、`admission.ts`、四桶、`improved` 五门槛、
> `data/gold/`、20s / settle / readiness / 9 门，一字未动。
> **判定出来之前，本文件不得对外引用**，也不许被读成「我们已经承认失败」。

---

## 1. 触发条件（含当前读数，便于对照）

`judgeD5` 的四条出口（冻结顺序，见 `docs/specs/D5-measurement.md`）：

| 出口 | 条件 |
|---|---|
| `no-post` | 没有公开样本 |
| `unmeasurable` | 三个数里有读不到且窗口已关 |
| `pass` | **三个数全部达标** |
| `fail` | 窗口已关、数都读到了、但不是三个全达标 |

**当前读数（R84 同日复核 + R86 复算覆盖）**：

- `#11813` reactions **0 / 10**
- 外部引用 **0 / 1**
- 周下载 **1598**（`steady`，20 的门槛已过）——但日序列是 `634 · 192 · 17 · 192 · 357 · 172 · 34`，
  那是 `2026-10-29` 一次爆发的回声（`BS-48`），**不构成需求证据**
- 结论：`pending`（窗口未关）。证据 `data/results/d5-evidence-2026-11-05T10-48-11-239Z.json`

**为什么「剩下几天加把劲」不改变这个数**：外部引用按判据**不能自己造** —— `judgeD5` 三重排除
（自己的登录名 / 本仓自己 / 我们的三条投稿 PR）。只有第三方引用才算。其余两个数里，
reactions 只数 `#11813` 这一个 discussion，下载项是机器在数。**这三个数没有一个是「多写一段文案」能动的。**

> 这不是悲观，是判据的形状。R54 签字的就是这个形状（`audit/SIGNOFF.md` R54 行）。

---

## 2. 三件事（只在 `fail` 之后执行）

### D-1 上游贡献：把「归因」提给上游，而不是把工具卖给上游

- **主题**：admission 拒绝时，用户只知道「被拒」，不知道**哪一份副本、被谁带进来、哪一条 peer 挡住**。
- **证据**（全部是已经落盘的 SSOT，不新造数字）：
  - 10 个真实案例、9 命中 / 1 显式 `unknown` → `data/results/d1-2026-10-26T12-00-00.000Z.json`
  - 27 条 admission 金标（与上游语义逐条对等）→ `data/gold/admission-cases.json`
  - Q&A 分类样本 **1545** 条，能给出声明层答案的 **74** 条（**4.8%**，Wilson 95% **3.8–6.0%**）
    → `data/results/question-coverage-2026-11-02T09-57-53-229Z.json`
  - 876 条最近讨论里 **379** 条是故障（43.3%）、零回复占比 **67.6%**
    → `data/results/market-baseline-2026-11-05T10-45-00.000Z.json`
- **形态**：先 issue，视回复再决定要不要 PR。**文案走 copy 通道**（事实包 → **会话内同一个模型**写稿 → HUMAN 发；R102 起不调外部模型 CLI），
  事实包见 `docs/copy/facts/2026-11-05-upstream-attribution.md`。
- **完成判据**：上游有实质回应（含「不做」），或 PR 进入 review。**不以合并为成功判据**——
  合并与否在别人手里，那是 `D3` 已经教过一次的事。

### D-2 作品集：一页说清做了什么、证明了什么、没做到什么

- **入口**：仓库 README 的一段 + 本文件 §4 的资产表。
- **规则**：每个数字必须指到 SSOT 产物；`check_listing` 保持绿；不许出现「100% 兼容」「安全」类说法。
- **完成判据**：README 里的每句话都能被一个产物或一条门禁复算出来。

### D-3 维护模式：不再加功能，只做四类事

1. **安全修复**（`docs/SECURITY.md` 的红线）；
2. **上游变更适配**（`next` 换版本 → 卡片回归、`admission` 语义对等）；
3. **依赖与 CI 修复**（含从未跑过的 `release readiness`，见 `T-848`）；
4. **已发布包的回归 smoke**（`scripts/record_usability_smoke.mjs`）。

- **不做**：新命令、新面板页、新判据。`T-855` / `T-856` / `T-857` / `T-858` 在 `fail` 之后一律标 ⛔。
- **完成判据**：`docs/HANDOFF.md` §3 与 `docs/BACKLOG.md` 同步到「维护模式」。

---

## 3. 不做什么（硬边界）

| 不做 | 为什么 |
|---|---|
| 改 D5 的三个阈值或判定顺序 | 改即判据轮 + HUMAN-SIGN；且 `ADR-0013` §5.2 写死「不做第 N 个功能的妥协」 |
| 把下载项的 `steady` 说成需求 | 那是 10-29 爆发的回声（`BS-48`），`counts_as_demand` 的判定不能靠解释改 |
| 刷量 / 买 reactions / 自己引用自己 | 判据会排除；更根本的是，那是伪造证据（`PROJECT_RULES.md` 严禁行为 3） |
| 把 `rescue` / SAFE MODE / `profile snapshot` 当成翻盘手段 | 它们是给**已经存在的用户**用的，不产生第一个用户 |
| 删历史产物或红产物 | 铁律 7（只进不出）；红产物是判定过程的一部分 |

**一句话**：D5 失败说明的是「这个交付形态没换来接触」，不是「引擎没用」。所以出口是**把引擎交出去**，
不是**把引擎做大**。

---

## 4. 资产清单（判 `fail` 之后仍然成立的东西）

| 资产 | 它证明了什么 | 证据指针 |
|---|---|---|
| admission 引擎 + 27 条金标 | 与上游语义逐条对等，不是「我们觉得」 | `data/gold/admission-cases.json`、门 `admission-parity` |
| 四桶升级判定 + 可粘贴卡片 | 「你这套已装集合升上去会坏什么」能算 | `packages/core/src/upgrade-*.ts`、`data/results/upgrade-card-2026-11-05T07-35-01.051Z.json` |
| 10 个真实案例 | 归因在真实故障上 9/10 命中 | `data/cases/CASE-*/`、`data/results/d1-2026-10-26T12-00-00.000Z.json` |
| `rescue` 急救箱（A+B） | 「起不来时先裁哪些第三方」可撤回 | `docs/specs/M8-rescue.md`、`data/results/rescue-2026-11-05T09-32-00-752Z.json` |
| probe 隔离实测 | 「装得上 ≠ 跑得对」有实测面 | `data/results/d2-2026-10-28T10-20-00.000Z.json` |
| 面板 / Agent 工具 / 索引源 / 徽章 | 同一份结论有五个外壳 | `packages/plugin/src/`、`data/results/client-serve-2026-11-02T13-33-17.447Z.json` |
| 未回答问题的覆盖率 | 这个生态的痛点分布是可量的 | `data/results/question-coverage-2026-11-02T09-57-53-229Z.json` |

> **数字口径**：SSOT 产物数与测试数每轮都在变，引用时用命令现算，不要抄这里：
> `(Get-ChildItem data/results -Filter *.json).Count` · `pnpm test`。
> 当前数字只在 `docs/HANDOFF.md` 的**规模行**写一份，且由 `tests/governance/handoff-scale-line.test.ts` 从仓库复算——这里不再抄第二份。

---

## 5. 时间线与责任人

| 时间 | 动作 | 谁 |
|---|---|---|
| **2026-11-12 或 11-13** | 第四份窗口内基线（`record_market_baseline`），否则 `11-05..11-08` 永久缺失 | agent（采证轮） |
| **`2026-11-15T20:24:37Z` 之后** | 关窗四条命令 + 判定 | agent（判定轮） |
| 判定后 24 小时内 | 若 `fail`：HUMAN 决定是否宣布；D-1 的 issue 由 HUMAN 发（agent 只备稿） | HUMAN |
| 判定后一周 | D-2 作品集页 + D-3 维护模式声明 + BACKLOG 收口 | agent |

---

## 6. 同一份文件也要能反向读

如果 D5 **`pass`**：

- 本文件标 `not-triggered`，**不删**（下一轮的人需要看到这条分支也想过）；
- 转入 `T-803`（把判定做成数据包交给 `dshmarket` / `catalog`）与 `T-804`（作者侧 CI）；
- §4 的资产清单直接变成 A/C 支线的素材，没有浪费。

如果 D5 **`unmeasurable`**：先修读数（`docs/d5-close-runbook.md` §2 的三条陷阱），**不许**把它读成 `fail`。
