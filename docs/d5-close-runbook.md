# D5 关窗 runbook（`2026-11-15T20:24:37Z`）

> **谁用**：关窗那天执行 D5 判定的人 / agent。
> **为什么单独一页**：D5 是**唯一**的产品判断（`docs/ROADMAP.md` §2），而它的三个数来自**三个不同的采集路径**，
> 其中一个（周下载）并不是现场抓的——它读的是最近一份 `market-baseline-*.json` 的 `d5` 块。
> 少刷一步，就会拿 `2026-10-31` 的下载数去判 `2026-11-15` 的窗，看起来完全正常。
> **本页不改判据**：阈值（10 / 1 / 20）、判定顺序、`unmeasurable` 的语义全部以
> `docs/specs/D5-measurement.md` 与 `scripts/lib/d5-score.mjs` 为准。

---

## 0. 一句话

**关窗之后**依次跑四条命令：刷新市场基线 → 读 D5（同时抓原始读数）→ 离线复算 → 登记；**`--baseline` 必须显式给**。

```powershell
# 0) 先确认时间点：窗口必须已经结束（早于 20:24:37Z 跑出来只会是 pending）
node -e "console.log('ends_at =', new Date(Date.parse('2026-11-01T20:24:37.000Z') + 14*864e5).toISOString())"

# 1) 刷新市场基线（下载那一项的唯一来源；不刷新 = 用旧窗的数判新窗）
node scripts/record_market_baseline.mjs --stamp <ISO>

# 2) 读 D5，并把原始读数抓成 fixtures（关窗读数的可离线复算靠这一步）
node scripts/record_d5_evidence.mjs --stamp <ISO> `
  --post https://github.com/deepseek-ai/deepseek-harness/discussions/11813 `
  --posted-on 2026-11-01T20:24:37.000Z `
  --baseline data/results/market-baseline-<第1步的stamp>.json `
  --fixtures-out data/fixtures/d5/<ISO>

# 3) 离线复算：只从第 2 步抓的 fixtures 推导（产物名 d5-selftest-*，明确不是证据）
node scripts/record_d5_evidence.mjs --stamp <ISO+10min> --out %TEMP%/d5-recompute `
  --post https://github.com/deepseek-ai/deepseek-harness/discussions/11813 `
  --posted-on 2026-11-01T20:24:37.000Z `
  --fixtures data/fixtures/d5/<ISO> `
  --baseline data/results/market-baseline-<第1步的stamp>.json
```

第 3 步的判读方法：比 `d5_verdict` / `numbers` / `window` 三项是否与第 2 步**逐项相同**；
不同就是抓取有损（R59 的 `undefined` 快照把 81 条 `unconstrained` 翻成 `denied` 就是这么发现的）。
复算产物又叫 `d5-selftest-*` 且带 `self_test: true`，**不许**当测量指针引用。

---

## 0.5 彩排（R86，2026-11-05；**不是证据**）

> 关窗是一次性的，所以四步在窗口还开着的时候先走一遍。**彩排产物全部写在 `%TEMP%`，不进 `data/results`，也不算读数**。

| 步骤 | 彩排命令（stamp 是彩排时刻，不是读数时刻） | 结果 |
|---|---|---|
| 基线离线复算 | `record_market_baseline --stamp 2026-11-05T14:00:00.000Z --fixtures data/fixtures/market-baseline/2026-11-05T10-45-00.000Z --out %TEMP%\…` | `d5` / `categories` / `downloads` / `discussions` 与现场件**逐项相同** |
| D5 现场抓取 | `record_d5_evidence --stamp 2026-11-05T13:56:00.000Z … --fixtures-out %TEMP%\…\fixtures --out %TEMP%\…\capture` | `pending` · reactions **0/10** · 外部引用 **0/1** · 下载 **1598**（steady）/20 |
| D5 离线复算 | `… --stamp 2026-11-05T13:57:00.000Z --fixtures %TEMP%\…\fixtures --out %TEMP%\…\recompute` | 产物是 `d5-selftest-*`；`d5_verdict` / `numbers` / `window` **逐项相同** |

**读法**：彩排只证明「这四条命令在这台机器上能跑通、抓取与复算两条路径自洽」，**不证明** 11-15 那天的读数会是什么。
**一个自己踩的坑**：第一次比对把 `self_test` 也算进比较键，得到 `SAME=false` —— 那是复算件的**设计差异**，不是抓取有损；按本页 §0 的口径只能比 `d5_verdict` / `numbers` / `window`。
**下一次真跑的截止日**：`2026-11-13`（`node scripts/d5_window_status.mjs` 现算：覆盖 `11-01..11-04`、今天可采 **0** 天、lost 0）。

---

## 0.6 每日守卫（R86 起）

`.github/workflows/d5-window.yml` 每天 **06:00 UTC**（+ 手动 `workflow_dispatch`）跑同一条只读脚本：

```bash
node scripts/d5_window_status.mjs --out "$RUNNER_TEMP/d5-window"
```

- 产物只写 runner 临时目录：**不写 SSOT、不刷基线、不出 D5 verdict**；
- `urgent`（截止日就是今天/已过）或 `lost > 0` → **job 失败**，`::error::` 里带窗口摘要；
- 脚本读不到（exit 2）→ **也失败**，不安静通过；
- **窗口结束后自退役**：`today > window.to` 时只打 `::notice::` 并 exit 0 —— 那时 D5 判定才是权威，缺一天是判定要记的事实，不是排期告警。

**边界**：cron 是 best-effort（可能延迟几十分钟，`BS-56` 同一条）；它是「不漏掉」的兜底，不是「准点」承诺。
守卫自己不懂「基线该跑哪一天」，那句话仍然由脚本算（`next_run_by`）。

---

## 1. 时间点

| 项 | 值 |
|---|---|
| 帖子 | `https://github.com/deepseek-ai/deepseek-harness/discussions/11813`（Show Your Plugins!） |
| 发帖时刻 | `2026-11-01T20:24:37Z`（`posted_on`，带时区；本机 UTC+1，写成 `21:24:37+01:00` 是同一时刻） |
| 关窗 | **`2026-11-15T20:24:37Z`**（`posted_on + 14d`） |
| 现在（`2026-11-02`） | `pending`。**关窗前重跑不算新证据**（HANDOFF 已写死这一条） |

窗口是**闭区间到那一刻**：`2026-11-15T20:24:37Z` 之前跑出一律 `pending`，之后才可能 `pass` / `fail`。
如果三个数在窗口内**全部**达标，`judgeD5` 会立刻给 `pass`——那时不必等 11-15。

---

## 2. 三个数各自从哪来（与各自的陷阱）

| 数 | 来源 | 门槛 | 陷阱 |
|---|---|---|---|
| reactions | `#11813` 的 `reactions.totalCount`（GraphQL） | **≥10** | **只数这一个 discussion**。X 上的赞按口径**不进**这个数（R69 已写进边界），转述时必须一起说 |
| 外部引用 | `search/issues` 提到本仓 URL 的条目，经三重排除（自己的登录名 / 本仓自己 / 我们那三条投稿 PR） | **≥1** | `seen` 是"查到了几条候选"，`value` 才是"其中有多少条算外部"。`seen: 3 / value: 0` 不是矛盾，是三条都被排除了 |
| 周下载 | **最近一份 `market-baseline-*.json` 的 `d5` 块**（`week_downloads` + `download_shape`） | **≥20 且 `shape = steady`** | ① 这一项**不是现场抓的**——不刷新基线就是拿旧窗的数列；② `single-day-burst` **不算需求**（2026-10-29 那次 634 全落在一天）；③ 读不到记 `unreadable`，不记 0 |

### 为什么 `--baseline` 仍然要显式给

R72 之前，默认值是「`data/results` 里文件名排序最后的那份 `market-baseline-*`」——排序**分不出**测量件与离线复算件
（两者同名同前缀），于是默认会选中 `market-baseline-2026-10-31T07-10-00.000Z.json`（**复算件**）。
R72 把选择器改成 `pickBaselineArtifact`：优先 `inputs.offline === false`（现场测量）里最新的一份；
只有复算件时才退回并**在 stderr 明说**「这个下载数来自复算基线」，产物里新增 `inputs.baseline_kind`（`measured` / `recompute` / `unproven` / `explicit`）。

所以关窗那天：

- 默认现在会选中 `market-baseline-2026-10-31T06-40-00.000Z.json`（**measured**）——但那是 **10-31** 的窗口；
- 仍然**必须**显式 `--baseline <第 1 步刚写的那份>`，否则你拿到的是一个**旧窗**的 634；
- 产物里的 `inputs.baseline_kind` 与 `inputs.baseline` 要一起看：`explicit` 只说明「这文件是操作者点名的」，
  **不说明**它覆盖了 D5 的窗口。

---

### 为什么 X / Reddit 的热度**不进** D5

`docs/specs/D5-measurement.md` §1 定的三个数是：**`#11813` 这一个 discussion 的 reactions**、**GitHub search 找到的外部引用**、
**市场基线里的周下载（且形状必须是 `steady`）**。Reddit 的赞、X 的赞、频道的数量都不是其中的任何一个 ——
把它们算进来等于**改判据**，而判据是冻结的（`audit/SIGNOFF.md` R54）。

`docs/distribution/channels.json` 把这条写成了可检查的字段：`d5_counts` 只允许**一条**为 `true`，
其余每一条都必须写 `why_not_counted`；改台账而不改判据，检查器就会红。

---

## 3. 怎么读结果（判定表照抄 spec，一字不改）

| 条件 | `verdict` | 含义 |
|---|---|---|
| 没有贴子 URL | `no-post` | 真的没发（不落产物） |
| 有 URL，但窗口起点读不出 | `unmeasurable` · `window-start-unreadable` | 日期有问题，不是产品结论 |
| 任一数为 `unreadable` | `unmeasurable` · `number-unreadable` | 读不到，不是 0 |
| 三个数都达标 | `pass` | `counts_as_demand: true` |
| 窗口未结束、未全部达标 | `pending` | 还没判 |
| 窗口已结束、至少一个未达标 | `fail` | 判定完成，不达标 |

**退出码**（`record_d5_evidence`）：

| 退出码 | 含义 | 是不是「脚本坏了」 |
|---|---|---|
| `0` | 产物已写，`verdict ∈ {pass, pending, unmeasurable}` | 否 |
| `1` | 产物已写，**`verdict = fail`** | **否**——这是判定完成，不是故障 |
| `2` | 用法错误 / 读不到 / 没发帖 → **零产物** | 是（要么修参数，要么修网络） |

> `fail` 走 exit 1 是有意的：关窗当天它必须能被自动化看见。**不要**为了让命令跑完去改它。

---

## 4. 三个分支各自做什么

### 4.1 `pass`（三个数全达标）

1. 产物落 `data/results/d5-evidence-<stamp>.json` + `.sha256`；
2. 按 `docs/ROADMAP.md` §2 进 **A 支线**（把判定做成数据包交给 `dshmarket` / `catalog`，用户不下载我们）
   或 **C 支线**（作者侧 CI），由 HUMAN 选；
3. 同步 `docs/HANDOFF.md` / `docs/ROADMAP.md` / `docs/BACKLOG.md` 的 D5 行，写清**是哪三个数**让它达标的。

### 4.2 `fail`（窗口结束仍未达标）

**执行 D**（R47 已定，此处只复述）：把仓库降级为**作品集 + 给上游提 issue/PR**，
**禁止「再加一个功能试试」**。具体三件事：

1. 产物原样保留（红也是证据），并在 HANDOFF 里写清哪一项没达标、差多少；
2. README / 上架文案里所有「基于 D5 的增长假设」的措辞要重写（不能留着一句「之后会有人用」）；
3. 把三条回帖草稿（`06` / `07` / `08`）当作 `fail` 之后仍然有效的资产——它们是**上游贡献**，不是需求证据。

### 4.3 `unmeasurable`（读不到）

**这不是结论**。按顺序修：读不到的原因（token / 限额 / 网络）→ 重跑同一条命令 → 仍然读不到就**如实记**
`unmeasurable` 并说明哪一项读不出，**不许**把它写成 `fail`，也不许写成「未观测到需求」。

---

## 5. 关窗后必须同步的东西

| 文件 | 改什么 |
|---|---|
| `docs/HANDOFF.md` | Stand 的 D5 状态（`pending` → 判定结果）+ 一条批次行 |
| `docs/ROADMAP.md` | §2 的 D5 行：写判定日期与三个实测数（不是「据说」） |
| `docs/BACKLOG.md` | `T-802` 的状态；`T-803` / `T-804`（两条支线）按分支解除或关闭 |
| `docs/distribution/T-810/registry.json` | **不用改**（它记的是投放；D5 读数不写在这里） |

---

## 6. 预演记录（2026-11-02，零 SSOT 产物）

关窗前把整条链路演过两遍，**都不写 `data/results`**（`pending` 的产物会变成"看起来像证据"的东西）：

### 6.1 `--dry-read`：三个源今天都读得到

```
$ node scripts/record_d5_evidence.mjs --post https://github.com/deepseek-ai/deepseek-harness/discussions/11813 \
    --posted-on 2026-11-01T20:24:37.000Z --dry-read
reactions  : 0   （measured，八种 reaction 全 0）
references : 0   （measured，seen 3 —— 三条都是我们自己的投稿 PR，按口径排除）
downloads  : 634 （measured，shape = single-day-burst，days_with_downloads 1，peak_share 1）
             baseline = market-baseline-2026-10-31T07-10-00.000Z.json   ← 复算件，见 §2 的陷阱
```

由此确认三件事：

1. 三条采集路径**今天都读得到**（不是 `unmeasurable`），所以关窗那天失败只会是网络/凭据问题；
2. **下载这一项确实来自旧基线**——它和今天（11-02）无关，这正好证明 §0 第 1 步不能省；
3. 默认基线选中的是**复算件**，所以关窗时要用 `--baseline` 点名测量件。
   （**R72 同轮已修**：选择器改为优先 `inputs.offline === false` 的现场件，并在产物里写 `baseline_kind`；
   这条预演记录保留原样，因为它是修复前的读数。）

### 6.2 抓取 → 复算：改前跑不通，补了 `--fixtures-out` 之后逐项相同

**发现**：`--fixtures` 只**读**，从没人**写**——所以关窗产物的离线复算路径是空的（R54 的自检 fixtures 是手写的）。
补上 `--fixtures-out` 后（并加 2 条单测），在 `%TEMP%` 真跑：

```
live      : pending · 0/10 · 0/1 · 634 (single-day-burst)/20 · ends_at 2026-11-15T20:24:37.000Z
recompute : pending · 0/10 · 0/1 · 634 (single-day-burst)/20 · ends_at 2026-11-15T20:24:37.000Z
SAME = true     （recompute 的 self_test = true、mode = fixtures、名字是 d5-selftest-*）
```

也就是说：**关窗那天只要保留第 2 步的 fixtures，任何人都能在断网机器上把同一个判定重新推导出来。**
`--dry-read` 与 `--fixtures-out` 同时给会被**拒绝**（exit 2、零文件）——预演不能留下证据。

---

## 7. 一句话边界

D5 判的是「**一次公开样本有没有换来真实需求**」，不是「产品好不好」。
`pass` 只说明这一形态值得继续投；`fail` 只说明**这一个形态**在这个生态里没被需要——
两者都不能靠加功能来改写。
