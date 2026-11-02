# D5 读数口径（三个数怎么算，先写死再看数据）

> **状态**：`proposed` —— 需要 HUMAN 签字后才可用于判定（签字栏在 §6）。
> **为什么先有这份文件**：D5 是这个项目**唯一的产品判断**（`docs/ROADMAP.md` §2）。如果等窗口结束再决定
> 「reactions 算不算转发的」「引用算不算我们自己提的 PR」，那就是**看着数据挑标准**。所以三个数的算法、
> 排除项、读不到时的处置，全部在投放**之前**写死，并且做成可执行函数（`scripts/lib/d5-score.mjs`）。
> **判据本身不改**：`reactions ≥ 10`、`外部引用 ≥ 1`、`周下载 ≥ 20` 三个阈值来自 R47 立项，本轮一个字都没动。

---

## 1. 三个数各自是什么

| 数 | 阈值 | 取自 | 排除 / 边界 |
|---|---|---|---|
| `reactions` | **≥ 10** | 那一条贴子的 `reactions.totalCount`（GitHub GraphQL） | **不**按类型加权：`👍 / ❤️ / 🚀 / 🎉` 一律各算 1。分类明细同时落盘，但不参与判定 |
| `external_references` | **≥ 1** | GitHub Search API（issues + PRs）里出现本项目仓库 URL（`github.com/jjjjjjjjnnjnn/dsh-triage`）的条目 | 排除三类：① 我们自己发的（author = 本项目账号）；② 我们自己的三条投稿 PR（#65 / #193 / #140 及其所在仓库）；③ 本项目自己的 issue/PR。**只有「别人提到我们」才算** |
| `weekly_downloads` | **≥ 20** | `data/results/market-baseline-*.json` 的 `d5` 块（R52 的 `download_shape` 规则） | **只在 `download_shape = steady` 时判定**；`single-day-burst` / `no-record` / `no-downloads` 一律记「未观测到需求」；`unreadable` 记 `unmeasurable` |

**读不到 ≠ 0。** 任何一个数取不到（403 / 429 / 超时 / 响应结构不对），该数的状态记 `unreadable`，
整体判定记 `unmeasurable`，**不许**把它当作「没达标」——「没观测到」和「观测到没有」是两件事（`BS-48`）。

## 2. 窗口

- 起点 = **贴子的 `posted_on`**（不是发布日期、不是 npm 发布时间）；
- 终点 = `posted_on + 14 天`（`P1D*14`，UTC，闭区间到那一刻）；
- 窗口没结束且未全部达标 → `pending`；窗口结束后 → `pass` / `fail`。
- **窗口内达标也立刻记 `pass`**：三个数都达到就不必再等（等待不会让证据变多）。

## 3. 判定表（穷举，代码里就是这个顺序）

| 条件 | `verdict` | `counts_as_demand` |
|---|---|---|
| **没有贴子 URL**（真的没发） | `no-post` | ❌ |
| **有贴子 URL，但 `posted_on` 读不出**（缺失 / 不存在的日期 / 非 instant） | `unmeasurable`（`reason: window-start-unreadable`） | ❌ |
| 任一数为 `unreadable` | `unmeasurable`（`reason: number-unreadable`） | ❌ |
| 三个数都达标 | `pass` | ✅ |
| 窗口未结束、未全部达标 | `pending` | ❌（未判定） |
| 窗口已结束、至少一个未达标 | `fail` | ❌ |

> **R70 改动（判据轮，HUMAN 2026-11-02 批准）**：第一行原本是「没有 `posted_on` **或**没有贴子 URL → `no-post`」。
> 那句话在「URL 明明在手上」的时候是**假话**——工具会宣称「没人发帖」，而它正拿着那篇帖子的链接。
> 现在把两种不可判分开：**没发帖**才是 `no-post`；**发了但窗口起点读不出**是 `unmeasurable`。
> **阈值一字未动**（10 / 1 / 20），判定顺序也未变，只是第一行拆成两行、并给 `unmeasurable` 加了 `reason`。
> 依据：R66 的独立 adversary 指出「仓内唯一的瞬时校验绑在没人消费的字段上」，R67 把校验挪到数据流上之后，
> 剩下的语义错误就暴露在这里（`2026-02-30` 会算出窗口，`2026-13-01` 会读成「没发帖」）。

**`fail` 之后做什么**（R47 已定，此处只复述）：执行 **D**——把仓库降级为作品集 + 给上游提 issue/PR，
**禁止**「再加一个功能试试」。

## 4. 产物

`data/results/d5-evidence-<stamp>.json`，带 `schema_version` / `produced_by` / `generated_at` / `.sha256`：

```
{
  "verdict": "pending|pass|fail|unmeasurable|no-post",
  "counts_as_demand": true|false,
  "window": { "posted_on": "...", "ends_at": "...", "closed": true|false },
  "numbers": {
    "reactions": { "value": 0|null, "state": "measured|unreadable", "threshold": 10, "met": false },
    "external_references": { "value": 0|null, "state": "measured|unreadable", "threshold": 1, "met": false,
                             "entries": [{ "url": "...", "author": "...", "kind": "issue|pull" }] },
    "weekly_downloads": { "value": 634|null, "shape": "steady|single-day-burst|unreadable",
                          "state": "measured|unreadable", "threshold": 20, "met": false }
  },
  "post": { "url": "...", "number": 0, "author": "..." },
  "sources": { "reactions": "graphql", "references": "search-api", "downloads": "<baseline 文件名>" },
  "limits": [ ... ]
}
```

`entries[]` **要列出被计入的每一条**（不是只给计数）：外部引用是最容易自欺的一个数，必须能逐条指出来。

## 5. 负对照（脚本必须能红）

| 编号 | 构造 | 期望 |
|---|---|---|
| N1 | 周下载 634 但 `download_shape = single-day-burst` | `weekly_downloads.met = false`（**burst 不是需求**） |
| N2 | 三个数都达标但缺 `posted_on`（而贴子 URL 在） | `verdict = unmeasurable`（`window-start-unreadable`），不是 `pass`，**也不是 `no-post`**（R70 改） |
| N2b | 三个数都达标、**完全没有贴子** | `verdict = no-post`，不是 `pass`（R70 新增：这才是「没发帖」） |
| N3 | 反应数取不到（模拟 403） | `reactions.state = unreadable`，整体 `unmeasurable`（不是 `fail`） |
| N4 | 「外部引用」只有我们自己的三条 PR 与本仓 issue | 计数 0，`met = false` |
| N5 | 窗口刚好到第 14 天那一刻 | `closed = true`，进入 `pass`/`fail` 判定 |
| N6 | 反应 9 / 引用 0 / 下载 25 steady，窗口已关 | `fail`（三个数缺一不可） |
| N7 | 反应 10 / 引用 1 / 下载 25 steady，窗口未关 | `pass`（达标不必等） |

## 6. 签字

| 项 | 内容 |
|---|---|
| 已签 1 | **R54（2026-11-01）**：§1–§5（三数算法 / 窗口 / 判定表 / 排除项 / 负对照） |
| 已签 2 | **R70（2026-11-02）**：§3 第一行拆成两行（`no-post` 只表示「真的没发帖」；有帖子但窗口起点读不出 → `unmeasurable` + `reason`）+ §5 的 N2 改期望与新增 N2b。**三个阈值（10 / 1 / 20）与判定顺序未动** |
| 签字后写进 | `audit/SIGNOFF.md` 新行（日期 + 原话 + 是否逐条复核） |
| 不签的后果 | D5 不能用于判定；只能继续报三个数，不给 verdict（**不许**先跑再补口径） |
| 撤销 | 任何一次改动都可撤销；撤销时在 `SIGNOFF.md` 写清日期与范围，并把判定表改回上一版（历史产物不重写） |
