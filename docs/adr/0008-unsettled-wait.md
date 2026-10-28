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

## T-312 实施记录（R28，2026-10-29）

> **HUMAN 决定**：「立项 T-312 两阶段」（本会话原话）。C 案原本被标为「超过一轮预算」；这里记下它实际做了什么、代价是什么。

| # | 改动 | 落地位置 |
|---|---|---|
| 1 | hook 在**第一次读到树**时先写 `provisional: true` / `settled: false`，settle 循环结束后覆盖成最终样本（同路径、同代际） | `packages/probe/hooks/inventory-hook.mjs`（抽出 `publish()`，两次调用；`isNewest()` 代际保护不变） |
| 2 | 执行器识别 provisional：可读但**不收敛**，开一个有界升级窗口；窗口 = 样本自报的 `settle_timeout_ms` + 1s（没有该字段时退回 `sampleUpgradeWindowMs`，默认 15s） | `packages/probe/src/host.ts`（`isProvisionalSample()`、`sampleUpgradeWindowMs`、`stoppedBy: 'upgrade-window'`） |
| 3 | **预算口径改为「第一份样本」**：`seconds` / `timings.bootToSampleMs` 取第一份，`finalSeconds` / `bootToFinalSampleMs` 记录最终样本 | `host.ts`（`finalSeconds`、`segments.finalSampleMtimeMs`）→ `exec.ts`（`bootToFinalSampleMs`）→ `probe-run.ts` → `record_probe.mjs` |
| 4 | 产物自曝：`inventory.provisional` / `upgraded` / `upgrade_waited_ms`，`limits[]` 写明「预算判第一份」 | `record_probe.mjs`、`d2_report.mjs` 的 `boot_breakdown.note` |
| 5 | 回归：`settled:false` 的**最终**样本仍立即收敛（E 不变）；`{error}` 仍等满替换窗口（T-316 产物仍成立）；provisional 场景由 2 条 host 单测 + 1 条真 hook 单测钉死 | `tests/unit/probe-host-sample.test.ts`（+2）· `tests/unit/probe-hook-two-phase.test.ts`（+1） |

**真机结果（三例，见 F50）**：`slow-plugin` 第一份 5.4s / 最终 10.7s / `go`；`slow-overrun` 第一份 9.4s / 最终 24.5s / `unknown`；`dsh-mcp-connector@0.2.83` 第一份 10.1s / 最终 25.2s / `unknown`（该候选今天两次都没在 15s 内稳定）。

**代价（必须一起说）**：不可判的**墙钟**从 ≈28.6s 升到 ≈30.4s —— 我们并没有让 probe 更快，只是把「用户多快拿到一个答案」与「答案有多细」拆成了两个数字。**20s 预算现在判的是前者**，`bootToFinalSampleMs` 与 `upgrade_waited_ms` 公开后者。

**仍未解决**：D2 的 `boot-budget` 红项需要**用新口径重跑矩阵**才有结论（R27 的红是在旧口径下测的）；在那之前不许说「D2 已恢复」。

### R29 补记：T-312 让 `replacement_waited` 说错话（`BS-33`，已修）

R28 引入升级等待时，样本循环里「睡前已经是拿着样本」这一条件就把**可读的 provisional**也记成了 replacement wait。R29 第一批矩阵 20/20 都是 `replacement_waited=true` + `replacement_stopped_by=readable-sample` + `upgraded=true`，`waited_ms` 与 `upgrade_waited_ms` 同值——与本 ADR 与 spec 教读者判断的方向相反。修法**只改读数**：`waited` 只在样本不可读时置 true、替换窗口时长在读到可读样本那一刻结算、新增 `replacement_reason`（`unreadable` / `upgrade` / `null`），升级等待仍由 `upgrade_waited_ms` 暴露。**等待条件、`--unsettled-timeout`、`settle 15s`、判据全部未动**；修后同 plan 重跑，结论与修前逐条相同。读 R28 的 `probe-t312-*` 与 R29 批次 A 产物时，该字段是旧语义。

**R29 已按新口径重跑（两批）**：`boot-budget` 12/12、可靠性 20/20、清理 20/20、形状 6，`gate.passed=true`（`d2-2026-10-28T09-20-00.000Z.json` / `d2-2026-10-28T10-20-00.000Z.json`）。R27 那次红作为**旧口径的历史事实**保留，不删不改。

## 剩余项：把「不可判」也压进 20s（未授权）

E 之后不可判的墙钟 ≈29s（R26 实测 28.6s），仍然 >20s。剩下的结构是：

```
hook settle 上限 15s（真机上不可判的树一定撞满）+ boot ~2-4s + settle 1s + readiness ~0.1s + render ~5s + 杀树 ~3s + 杀后 1.2s
```

**E 只删掉了「替换窗口」这一项，剩下的主导项是 hook 自己的 settle 上限。** 要进 20s，只有三条路：

| 方案 | 做法 | 省 | 代价（可测） | 授权 |
|---|---|---|---|---|
| **A′. 把 hook 的 settle 上限 15s → 10s** | `inventory-hook` 的 `timeoutMs`（hook 内部 settle 预算），不是 `--unsettled-timeout` | 不可判 ≈5s → **≈24s**（仍未进 20s，但明显更接近） | **有真实代价，已测**：`dsh-mcp-connector@0.2.83` 的 `wait_ms` 在三次真跑里是 **10.6s / 16.2s / 18.0s**（`boot→sample` 16.0 / 22.5 / 23.8s）——cap 压到 10s 会把这一条从 `go` 变成 `unknown`。R19 批次的最大值 7686ms **不能**用来论证「不会误伤」（那是另一批、另一台时刻） | ❌ 未授权（阈值变更 = 改测量强度） |
| **A″. 再把它压到 8s** | 同上 | 不可判 ≈22s | 同上，风险更大；本批真实候选最大的 7686ms 已经贴到 8s 边缘 | ❌ 未授权 |
| **C. 两阶段取样（T-312）** | hook 先写 provisional 样本，执行器先回 `unknown`，后台续采再升级 | 全部（首包 ≈5–8s） | 要改 hook 写出协议（两次写 + 代际保护）与执行器状态机；R17/R18 的全部时序负对照要重跑 | ❌ 未授权（超过一轮预算） |

**为什么不能只改执行器的等待**：执行器的等待已经被 E 削到 0（对 `settled:false`）。剩下的时间花在**样本还没写出来**之前，只能由 hook 的 settle 上限或两阶段协议决定。

**建议（若要签）**：**先别签 A′**。R27 的真机证据把「A′ 不会误伤」这个说法推翻了：`dsh-mcp-connector@0.2.83` 的 settle 等待是 10.6–18.0s，cap 压到 10s 就会把一个 `go` 判成 `unknown`。而 20s 预算在这份批次里**已经**被同一条候选顶红过一次（`boot→sample` 22.5s），所以「预算被顶穿」和「cap 太紧」是同一枚硬币的两面：
> - 保 cap 15s → 保留 `go`，但 `boot→sample` 会间歇性 >20s（D2 的 `boot-budget` 会红）；
> - 压 cap 10s → 预算稳过，但慢候选被判 `unknown`（少一次 `go`）。
>
> **只有 C（T-312 两阶段）能两头都要**：先回 provisional（快），后台续采再升级。这也是本轮之后唯一有证据支撑的建议。

## 签字区（HUMAN）

```
[ ] A. `--unsettled-timeout` 默认 20000 → 5000
[x] E. 只对 `{error}` 保留替换等待，`settled:false` 立即返回（推荐）  ← 2026-10-28 交接时「同意」，R26 已实施
[ ] A′. hook 的 settle 上限 15s → 10s（不可判 ≈29s → ≈24s；**代价已实测**：`dsh-mcp-connector` 会从 `go` 变 `unknown`）
[x] C. 立项 T-312 两阶段 —— **2026-10-29 会话内「立项 T-312 两阶段：唯一能同时保住预算与慢候选的路」**；R28 已实施（见 §T-312 实施记录）
[x] B. 维持现状（保持 ≈29s / 写进文案） —— **2026-10-28 R30 勾选**：HUMAN 会话内「进行你自己评估讨论，代我签字，同意」，由 agent 代签；理由见下方「B 的选择理由」
```

### B 的选择理由（R30，代签，可撤销）

T-312（C）已经把「预算」与「慢候选」解耦：`boot→sample ≤20s` 判的是**第一份**样本，慢候选不再顶穿预算（R29 两批 `boot-budget` 12/12）。剩下的 ≈29s 是**不可判**情形的墙钟，而 A′/A″ 唯一的收益是把这段墙钟压短，代价是把还在 settle 的真实候选从 `go` 降成 `unknown`——这对用户是**更糟**的结果（`go`→`unknown` 意味着「本来能告诉你行不行，现在只能说不确定」）。因此：
- **保持 `settle 15s` / `--unsettled-timeout 20000` / readiness 5s / `boot→sample ≤20s` 全部不变**；
- 对外口径照 §实施记录写：**可判 ≈16s（答案在第一份样本时给出）、不可判 ≈29–30s 是区间不是常数**；
- 要改成 A′/A″ 必须**重开一轮**（新证据 + 重跑矩阵），不能引用本行的代签。

> **可撤销**：HUMAN 随时可以划掉本行的 `[x]` 并改签 A′/A″；撤销后本 ADR 的其余部分不受影响（E 与 C 是独立的两项）。

> **E 已于 R26 实施**（上表 §实施记录）。签字授权的是做法，实施与三条回归由 R26 完成；`audit/SIGNOFF.md` 有对应实施行。

> **E 之外的项（A/A′/A″）仍未勾选**，因此 `--unsettled-timeout`、`settle 15s`、readiness 5s 与 `boot→sample ≤20s` **一律不动**（铁律 4：阈值变更需 spec + HUMAN-SIGN）。E 只改「等谁」，不改这三个阈值。**R30 已勾 B（维持现状，代签，可撤销）**——这是「不动」的**明文**版本，不是「没人签所以搁置」。
>
> **历史（R23/R24）**：那两轮只交付材料 —— 分段读数、29 份产物的替换统计（`data/results/replacement-window-2026-10-28T21-30-00.000Z.json`，`replacements_observed = 0`）、三组窗口对照（`measured_saving_ms = 19092`）、本 ADR，**没有改任何默认值**。
