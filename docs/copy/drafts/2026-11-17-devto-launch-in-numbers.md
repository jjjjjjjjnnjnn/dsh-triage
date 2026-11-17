# dev.to · 19 visitors, 1 star, 1,416 clones — a launch in numbers

> **渠道**：dev.to · **英文** · 新帖（不是回复）
> **状态**：**draft —— 未发**（发布需要 HUMAN 的 dev.to 账号 / API key）
> **事实**：`docs/copy/facts/2026-11-17-traffic-post.md`

<!-- facts: docs/copy/facts/2026-11-17-traffic-post.md -->

## 标题

```text
19 visitors, 1 star, 1,416 clones: what a launch actually looked like
```

## 摘要（dev.to 的 description 字段）

```text
Four packages published, an anonymous install that works, and 19 unique visitors in two weeks. Here is the traffic data nobody puts in a launch post.
```

## 正文

> **封面图**：`docs/copy/assets/2026-11-17-npm-downloads.png`（1200×630，从 `traffic-2026-11-17T13-04-28-424Z.json` 的日序列直接生成，不是手绘）。
> dev.to 发布时把这张图上传到封面位；正文里的日序列代码块与它同源。

<!-- paste:start -->

We shipped a developer tool for a plugin ecosystem, published four packages to npm, and wrote a launch post. Two weeks later the repository had **47 views from 19 unique visitors**.

That is the number I want to start with, because everything else in this post is only interesting next to it.

### The numbers, in the order they mislead you

**Clones: 1,416 in 14 days.** Sounds like traction. It is 30× the view count, which is the tell: browsers do not clone a repository 30 times per visit. CI runners, mirrors and scanners do. Clone count measures automation, not attention.

**npm downloads: 2,996 in 31 days.** Also sounds like traction. Look at the shape instead of the total:

```
10-29   634   <- release day
10-30   192
10-31    17
11-01   192
11-02   357
11-08    15
11-09   183   <- next release
11-10    30
```

Release days spike, the days between sit at 30–57. That is not 30–57 people a day; that is mirrors and caches refreshing. Our own measurement rule says a single-day burst does not count as demand, and this is what that rule looks like from the inside.

**Stars: 1. Forks: 0.**

**The number that decided things for us:** we had pre-registered a test before launching — reactions ≥10 on the launch thread, at least one third-party reference, and ≥20 weekly downloads, judged over a two-week window. Final reading: **0 reactions, 0 third-party references, 1,212 weekly downloads**. One of three, and the two zeros were never going to move, because you cannot manufacture a third party citing you.

So the honest summary is: the delivery worked, the distribution did not.

### What "the delivery worked" means

This part is checkable, so I will be specific. Four packages published; registry bytes compared against the local tarballs; a clean-room install with an empty npm config exiting 0; the CLI running; the bundle importing. 18 checks, all green in the release evidence file.

None of that got us a reader. It only ensured that a reader who arrived would not bounce off a broken install.

### What we did, and what it bought

| Action | Cost | What changed |
|---|---|---|
| Rewrote the README around one problem | a day | nothing measurable in 14 days |
| Added a GitHub Release | an hour | nothing measurable |
| Set the repository homepage | a minute | nothing measurable |
| Icon on the marketplace tile | an hour | card no longer falls back to an avatar — no data yet |
| Launch post in the ecosystem's showcase category | a day | **0 reactions** |

The marketplace listing was already there and stayed there. The listing gets downloads (2,953 as of today), but downloads without stars is the same shape as clones without views.

### The diagnosis that changed our plan

We had been assuming the bottleneck was the pitch: maybe the front page was unclear, maybe the description was too long. So we measured who was actually visiting, by path.

The top paths were the repository home, `/issues`, and a handful of `data/results/*.json` blobs. All of it traced back to **one person**: a user who had filed the single external issue, and who was reading the evidence files we had pasted into it.

Nineteen unique visitors, and nearly all of the human traffic was one person checking our work.

That moved the bottleneck from "what do they read when they arrive" to "who arrives at all". Those need different work, and we had been doing the first one.

### What we are doing instead

The ecosystem has one place where people are already in the failure state we solve for: the upstream discussions, where plugin users report what broke. In a one-week window, **345 of 845 recent threads matched a failure cluster, and 242 of those had no reply at all** — 70%.

So the plan changed from "publish another announcement" to "answer the threads that have no answer". Not a link drop: a reply that opens with a read-only command the reporter can run, explains what the output means, and states what it does not prove.

Two things about that, honestly:

- It does not scale. Each answer takes real reading.
- It may produce nothing measurable either. A reply in someone else's thread is contact, not a signal, and we deliberately do not count it as one.

But it is the only channel where the audience is already assembled and already in pain, and it is the only one our own data supports.

### Three things I would tell someone shipping a niche developer tool

1. **Pre-register what "worked" means, then publish the result even when it fails.** We wrote the three thresholds before the launch post. That is the only reason this article can say "0 reactions" instead of quietly redefining success.
2. **Separate installation health from attention.** They fail for completely different reasons, and a green install suite feels like progress while nothing arrives.
3. **Check whether your only visitors are the one person who filed an issue.** Path-level data is small and unglamorous, and it told us more than the totals did.

If you are building something for a small ecosystem, the ceiling may be lower than you think — not because the tool is bad, but because the number of people who have the problem is small. Measuring that early is cheaper than rewriting your landing page twice.

Boundary: these numbers describe published artifacts and public traffic, not your machine — and none of them is a user count.

<!-- paste:end -->

## 自检

| 正文数字 | 事实包出处 |
|---|---|
| 47 / 19 浏览唯一、1,416 / 327 clone、2,996 / 1,042 / 634、11,631、1 star | `traffic-2026-11-17T13-04-28-424Z.json` |
| 0 / 0 / 1,212 与 10 / 1 / 20 三个阈值 | `d5-evidence-2026-11-16T07-05-00-000Z.json` + `docs/specs/D5-measurement.md`（冻结阈值） |
| 845 / 345 / 242（40.8% / 70.1%） | `market-baseline-2026-11-16T07-00-00.000Z.json` |
| 18 项发布取证、匿名安装 exit 0 | `publish-2026-11-17T12-15-53.890Z.json` |
| 2,953 下载 | 市场 `/plugins.json`（第三方读数，文中已注明「as of today」） |

**禁项复核**：没有把 clone / 下载 / 唯一访客读成人数；没有「我们成功了」；没有比例推断；没有保证式建议；边界句含 "not your machine"。
