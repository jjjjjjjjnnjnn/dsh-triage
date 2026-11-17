# D-1 · 上游 issue 草稿（英文）· admission 拒绝后的归因

> **渠道**：`deepseek-ai/deepseek-harness` 的 issue（**不是** discussion）
> **状态**：**已发（2026-11-17）** —— https://github.com/deepseek-ai/deepseek-harness/discussions/13608（**Ideas** 分类；上游把 issue 关掉了，所以投的是 discussion）。
> 发之前由 HUMAN 授权；正文与下面 paste 块 **逐字相同**，发完回填 `docs/copy/outreach.json`（`d5_counts: false`）。
> **事实来源**：`docs/copy/facts/2026-11-17-d1-attribution.md`（本文不提供事实包以外的数字）
> **投放规则**：`docs/distribution/posting-runbook.md`；发完回填 `docs/copy/outreach.json`（`d5_counts: false`）

<!-- facts: docs/copy/facts/2026-11-17-d1-attribution.md -->

## 标题（60 字符，≤70）

```text
Admission denials name the verdict, never the evidence behind it
```

## 正文（`paste:start` 与 `paste:end` 之间就是要粘贴的字）

<!-- paste:start -->

### What happens

When a plugin is refused, the message says *denied* and stops there. The three things a user needs are missing:

1. **Which copy was actually resolved** — the realpath, and the manifest that was read.
2. **Who brought that copy in** — the profile, a bundler, or a shared dependency cache.
3. **Which constraint failed** — the package, the declared range, and the version it was compared against.

So the only next step is to paste logs and ask someone. That is the part I would like to see change.

### Why I think it is worth changing

In the 845 most recent discussions in this repository (window `2026-11-08` → `2026-11-16`), **345 fall into a
failure cluster (40.8%)**, and **242 of those 345 have no reply at all (70.1%)**. Those counts are a sampled
window, not a census, and the clustering is a classifier's judgement — but the shape is clear: failures arrive,
and the person who hit one usually cannot name its cause.

A denial that carried its own evidence would let some of those threads be answered by the reporter.

### The same package, one release apart

Against runtime `0.2.2-rc.1`, `@deepseek-ai/dsh-mcp-client`:

| build | declaration result | why |
|---|---|---|
| `0.2.2-rc.1` | `admitted` | eight peers, all pinned to `0.2.2-rc.1` |
| `0.2.1-rc.5` | `denied` | eight peers, all pinned to `0.2.1-rc.5`; eight unmet |

Same code, one release apart, opposite outcomes. The denial does not say **which** peer did it, so the user cannot
tell "this build is old" from "the profile already contains a different copy of one dependency".

### A real case rather than a hypothetical

A user reported that `@deepseek-ai/dsh-base` and `dsh-web-app` were announced as *not installed under the profile*
while the host loaded them normally (public report: `jjjjjjjjnnjnn/dsh-triage#1`, opened `2026-11-08`). The message
named the two directories it had searched; it never said the packages **were** there, in a third place, inside the
kernel. The reporter had to paste those two `roots` lines himself before anyone could see it.

That bug was ours, not yours — it is fixed on our side. I am citing it because the gap it exposes is generic:
"not present in the directory I looked at" was printed as "not installed".

### What I am proposing

Additive output only. A sketch, not a spec:

```json
{
  "resolved": { "path": "/abs/path/to/copy", "manifest": "/abs/path/to/package.json" },
  "declared_by": "profile | bundler | shared-cache | kernel",
  "unmet": [{ "package": "@deepseek-ai/dsh-x", "range": "0.2.1-rc.5", "target": "0.2.2-rc.1" }]
}
```

The decision itself would not move. This adds the evidence that produced it, so the same refusal can be read
without a human in the loop.

### What I am not claiming

I recomputed admission over 27 cases and agree with the current semantics on every one of them — `engines.dsh`
first, otherwise the `@deepseek-ai/dsh*` peers as an AND, prereleases included, empty or invalid ranges treated as
incompatible. So this is not "the rule is wrong". The rule is right; the sentence after the rule is what is missing.

If a shape like the sketch above is acceptable, I am happy to open a PR against the admission path. If the
preferred place is elsewhere, that is just as useful to know.

### Boundary

Boundary: this reads published build metadata, not your machine. This is a declaration-layer analysis of published
npm artifacts, not a runtime guarantee, and not a report about your machine: `admitted` means the declared ranges
accept the target build — nothing more.

<!-- paste:end -->

## 草稿自检（发布前人工过一遍）

| 正文里的数字 | 事实包里的出处 |
|---|---|
| 845 条讨论 / 345（40.8%）/ 242（70.1%） | `market-baseline-2026-11-16T07-00-00.000Z.json` 的 `discussions.fetched` / `pain_threads` / `pain_share` / `unanswered_share` |
| 27 条准入案例零分歧 | `data/gold/admission-cases.json`（门 `admission-parity`） |
| `dsh-mcp-client` 两个构建 `admitted` / `denied`、8 条 peer | `remedy-probe-2026-11-05T08-01-23-093Z.json` 的 `rows[]` |
| issue #1 的时间与症状 | 公开 URL + `2026-11-08T01:44:27Z`（事实包「真实案例」一节） |

**禁项复核**：无安装命令、无自荐包名、无 D5、无「多少比例的用户会遇到」、无运行期保证、
无「100% 兼容 / 升级会修好」类话术；边界句原样保留。
