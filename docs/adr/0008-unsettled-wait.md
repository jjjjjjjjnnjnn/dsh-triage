# ADR 0008 · 不可判的树要等多久（`BS-25` / `BS-28` / T-311 / T-312）

> **状态**：**方案 E 已实施（2026-10-28，R26）。** 实施记录见本文件 §实施记录。
> 改动范围：`packages/probe/src/host.ts` 的样本循环 —— `settled:false` 的样本立即收敛，`{error}` 仍等满 `--unsettled-timeout`。
> **默认值仍未动**：`--unsettled-timeout 20000`、`settle 15s`、readiness 5s、`boot→sample ≤20s` 一字未改。
> **由 R23 的实测逼出来**：`boot` 步分段后，「不可判」的 48.4s 里 **20.3s 是替换等待**（不是 settle）。这笔等待从未在 29 份已记录产物里产生过更好的样本。

## 背景（全部实测）

1. **结构**（R23 / T-314）：`probe-boot-segments-overrun` 的 `boot` 步 48384ms = sample 19128 + **替换等待 20276** + settle 1011 + readiness 36 + render 4502 + 杀树 2203 + 杀后 1215。hook 自己的 settle（`wait_ms 16131ms`）**已经含在 sample 里**，不是额外项。
2. **替换窗口的用途**（R17）：一份**不可判**的样本（`{error}` 或 `settled:false`）之后，执行器会继续等 ≤`--unsettled-timeout`，因为 Cordis 在服务回来后**会重跑 apply**，新 apply 可能写出可判样本。R17 是在**开发期**观察到这个现象的，因此加了这道窗口。
3. **它到底起过作用吗（`scripts/report_replacement_window.mjs` 扫 29 份有相位块的产物）**：可判形状 9 份、`settled:false` 4 份、`{error}` **0 份**；4 次不可判样本的 `attempts` 全为 1、`applies` 全为 1 —— **没有任何一次记录到替换样本**。产物：`data/results/replacement-window-2026-10-28T21-30-00.000Z.json`（一条命令可重算）。
4. **缩短它的代价（同一夹具 `slow-overrun-plugin`，只改 `--unsettled-timeout`，三组真机）**：

   | 替换窗口 | 替换等待 | `boot` 步 | render | 结论 |
   |---|---|---|---|---|
   | **20000（今天的默认）** | 20.3s | **48.4s** | 4502ms | `unknown` |
   | 5000 | 5.3s | 33.9s | 4671ms | `unknown` |
   | 1000 | 1.2s | **26.2s** | 0（该轮 launcher 未打印 URL，render 被跳过；按 5s 那轮补正 ≈30.9s） | `unknown` |

   **结论完全不变**（永不 settle 的树三种窗口都给 `unknown`），差的只是**纯等待时间**：报告给出 `measured_saving_ms = 19092`。

## 选项

| 方案 | 做法 | 省多少 | 风险 |
|---|---|---|---|
| **A. 降低默认窗口** | `--unsettled-timeout` 默认 20000 → 5000 | ≈14.5s | 若某候选真的在 5–20s 之间被重跑并写出可判样本，这条恢复路径消失（`unknown` 会保持 `unknown`，不会变成 `blocked`——**判据不会变坏，只会更保守**） |
| **B. 维持现状** | 不动 | 0 | 每次不可判都让用户等 ≈48s；文档已经写明，但产品体验是实测过的差 |
| **C. 两阶段取样（T-312）** | 先回 provisional（`unknown`），后台续采并升级 | 全部 | 要改 hook 的写出协议（两次写样本 + 代际保护）与执行器状态机，并重跑 R17/R18 的全部时序负对照。**超过一轮预算** |
| **E. 只对 `{error}` 保留窗口** | `settled:false`（hook 读成功、但树仍在动）不再等替换；`{error}`（hook 自己读不到）仍等满 | ≈20s（就是本轮的主导项） | 精准保住 R17 的原始理由（dead context 被新 apply 取代），只放弃「`settled:false` 后来被替换」这一种情形——**27 份产物里从未出现** |

## 建议

**E，其次 A。** 理由：

- E 只改「等谁」，不改「等多久」的上限，也不动 `settle 15s` 与 readiness 5s 这两个被反复确认的阈值；
- 主导成本（20.3s）恰好来自 `settled:false` 这条路径，而 E 正是把它去掉；
- 剩下的 `{error}` 路径保留 R17 的完整恢复能力，且它在已记录产物中出现 **0 次**，所以 E 的实际影响面比 A 更小、更精确。

**无论选哪个，都不改变结论语义**：不可判的样本只能出 `unknown`（`judgeProbe` 已经强制），所以这一条 ADR 调的是**等待时间**，不是判据强度。

## 后果与待办

- 若选 E：`exec.ts` 的替换等待条件从「样本不可用」细化为「样本不可读（`{error}` 且 `errorCode === 'inactive-context'`）」；`probe.tree-not-settled` 文案要写明「没有再等替换」；`BS-28` 与 spec §4 的墙钟表同步。
- 若选 A：`--unsettled-timeout` 默认值与 `PROJECT_RULES` 的阈值清单同改，并在 `d2_report` 的 `wall_clock.note` 更新数字。
- 若选 C：单独立项 T-312，本轮不动。
- **测试要求（任一方案）**：`slow-overrun` 必须仍是 `unknown`；`slow-plugin`（6s）必须仍是 `go`；R17 的 `inactive-context` 负对照必须仍能等到替换样本（用一个能强制写出 `{error}` 的夹具）。

## 实施清单（方案 E，下一轮做）

> **2026-10-28 / R26：以下 5 条已全部落地，逐条结果见 §实施记录。**

1. `packages/probe/src/host.ts` 的样本循环：`replacedEnough` 只在样本**不可读**（`{error}`，尤其 `errorCode === 'inactive-context'`）时参与判定；`settled === false` 的样本一旦写出就**立即收敛**（仍照常 `settle` + readiness + render + 杀树）。
   - 关键：`isUsableSample()` 的语义**不要改**（它同时被 judge 与断言使用）；改的是「要不要继续等」。
2. 产物：`timings.bootSegments` 已经能反映缩短后的替换等待；另在 `inventory` 段加一个显式布尔（例如 `replacement_waited: false`），让读者不必从时间差推断。
3. 文案：`probe.tree-not-settled` 的 detail 里写明「没有再等替换样本（ADR-0008 E）」；`docs/05` 与 spec §4 的墙钟表同步（不可判 ≈26–31s）。
4. **三条必须仍成立的回归**（缺一即回滚）：
   - `slow-overrun-plugin`（顶层 await 20s）→ 仍是 `unknown`，`missing.inventory` 仍在；
   - `slow-plugin`（导入 6s）→ 仍是 `go`；
   - `{error}` + `inactive-context` 负对照 → **仍等满窗口**，且能等到替换样本（需要能强制写 `{error}` 的夹具；可先复用 hook 的单测注入）。
5. 重跑 `d2_report`（用现有矩阵）确认 `boot-budget` 与 `reliability` 不因此变红。

## 实施记录（R26，2026-10-28）

| # | 改动 | 落地位置 |
|---|---|---|
| 1 | 样本循环只在**不可读**时开替换窗口；`settled:false` 立即收敛 | `packages/probe/src/host.ts`（循环改为 `readable → timeout → replacedEnough → startupFailed` 四段判据；新增纯函数 `isReadableSample()`，**`isUsableSample()` 一字未改**） |
| 2 | 产物显式布尔，不让人从时间差推断 | `host.ts` 新增 `SampleReplacement`（`policy/waited/waitedMs/samples/stoppedBy`）→ `exec.ts#ProbeRun.sampleReplacement` → `record_probe.mjs` 的 `inventory.replacement_waited / _waited_ms / _observed / _samples / _policy / _stopped_by` |
| 3 | 文案写明「没有再等替换样本」 | `exec.ts#measurementDetail()` 追加 `replacement=not-waited(ADR-0008 E: only an unreadable sample is replaced)`（真等过则给 `replacement=waited(Nms, samples=k)`）；`record_probe.mjs` 的 `limits[]`、`d2_report.mjs` 的 `wall_clock.note` 与 `boot_breakdown.note` 同步 |
| 4 | 三条回归 | 见下 |
| 5 | 重跑 `d2_report`（现有矩阵） | `data/results/d2-2026-10-28T23-00-00.000Z.json`：`reliability 20/20`、`boot-budget` 12/12 真实候选、`fixtures_over_budget` 仍只有那个永不 settle 的夹具，`gate.passed=true`。**没有变红** |

### 三条回归（缺一即回滚）—— 全部真跑或单测

| 回归 | 结果 | 证据 |
|---|---|---|
| `slow-overrun-plugin`（顶层 await 20s）→ 仍 `unknown` + `missing.inventory` | ✅ `unknown`，`missing.inventory` 在，`probe.tree-not-settled` 的 detail 含 `replacement=not-waited(ADR-0008 E…)`，`inventory.replacement_waited=false` | `data/results/probe-adr0008e-overrun-2026-10-28T22-30-00.000Z.json` |
| `slow-plugin`（导入 6s）→ 仍 `go` | ✅ `go`，行 `active`，HTTP 401，渲染 289 字符 | `data/results/probe-adr0008e-slow-2026-10-28T22-40-00.000Z.json` |
| `{error}` / `inactive-context` → **仍等满窗口**且能等到替换样本 | ✅ 单测逐个钉死：`{error}` 后被替换 → 采用替换样本（`samples=2`）；`{error}` 永不替换 → `stoppedBy=unreadable-window` 且真的等满；`settled:false` → `waited=false`、`sampleWaitMs < 窗口` | `tests/unit/probe-host-sample.test.ts`（4 条，用一个只会写 overlay `out:` 的**假 launcher** 驱动真实循环） |

**真机对照（同一夹具、E 前后）**：不可判的 `boot` 步 **48.4s（R23）→ 28.6s（R26）**，差额正好是被删掉的替换窗口；`inventory.replacement_waited=false` 是本轮新增的**显式**证据，不必再从时间差推断。同轮另两份回归：`slow-plugin` = `go`（`boot` 步 25.4s）、真实候选 `dsh-status-rotator@0.38.0` = `go`（`boot` 步 21.7s、`boot→sample` 11.5s）。**墙钟是区间**（21.7–28.6s）：sample 等待在 11.5–22.7s 之间波动（`BS-32`），不许把任何一次观测写成承诺。

**没有改的东西（逐条核对）**：`--unsettled-timeout` 默认 `20000`、hook 的 `settle 15s`、settled 树 readiness `5s`、`boot→sample ≤20s` 判据、`isUsableSample()`、`judgeProbe` 的结论映射。

## 签字区（HUMAN）

```
[ ] A. `--unsettled-timeout` 默认 20000 → 5000
[x] E. 只对 `{error}` 保留替换等待，`settled:false` 立即返回（推荐）  ← 2026-10-28 交接时「同意」
[ ] C. 立项 T-312 两阶段（另开一轮，不改默认值）
[ ] B. 维持现状（保持 48s / 写进文案）
```

> **E 已于 R26 实施**（上表 §实施记录）。签字授权的是做法，实施与三条回归由 R26 完成；`audit/SIGNOFF.md` 有对应实施行。

> **E 之外的项（A/C/B）仍未勾选**，因此 `--unsettled-timeout`、`settle 15s`、readiness 5s 与 `boot→sample ≤20s` **一律不动**（铁律 4：阈值变更需 spec + HUMAN-SIGN）。E 只改「等谁」，不改这三个阈值。
>
> **历史（R23/R24）**：那两轮只交付材料 —— 分段读数、29 份产物的替换统计（`data/results/replacement-window-2026-10-28T21-30-00.000Z.json`，`replacements_observed = 0`）、三组窗口对照（`measured_saving_ms = 19092`）、本 ADR，**没有改任何默认值**。
