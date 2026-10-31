<!-- channel: upstream GitHub Discussions — reply under the rc.5 release thread -->

# 草稿 01 · 上游 rc.5 Discussion 回复（英文，可直接贴）

> **发之前核对三件事**：① 回复挂在 **rc.5 的那一帖**下，不是别的版本；② 只贴下面这一段，不要另加「我们很高兴」；③ 卡片数字若已过期，先重跑第 2 节那条命令再贴。

---

I run a small read-only checker (`dsh-triage`, MIT, not affiliated with this project) that answers one question
per release: **what does an already-installed set lose if it moves to the new build?**

After `0.2.1-rc.5` landed I judged a sandbox profile that is pinned to `0.2.1-rc.4` against it. Declaration layer
only — declared peer ranges vs the target runtime, not a runtime measurement:

| bucket | count | meaning |
|---|---|---|
| `would-be-denied` | 119 | the target build denies this row/package |
| `cannot-tell` | 73 | not enough declaration evidence |
| `improved` | 0 | denied today, admitted at target |
| `likely-fine` | 0 | no declared conflict (not a promise it runs) |

192 units total (2 bundles + 190 rows). The dominant reason is the same one repeated: rows declare an **exact**
peer on the rc they shipped with, so a build one rc newer is outside every declared range, e.g.

```
bundle:@deepseek-ai/dsh-web-app · @deepseek-ai/dsh-web-app@0.2.1-rc.4
  reason: peer @deepseek-ai/dsh-shell-env@0.2.1-rc.4 does not include 0.2.1-rc.5
```

Two things worth separating, because they get conflated in "upgrade broke it" reports:

1. this card **does not** say the upgrade is broken — it says the *declaration* would be refused, which is what
   admission prints and then drops from the composition;
2. it **cannot** say an upgrade fixes anything: `improved` is 0 here by construction, and a declaration being
   admitted is not a measurement.

Reproduce, offline, no network, exact version:

```console
$ dsh-triage upgrade --to 0.2.1-rc.5 --card
$ dsh-triage upgrade --to 0.2.1-rc.5 --json   # same judgement, machine-readable
```

On your own profile replace `<profile>` with your profile name; the numbers are supposed to be different from mine —
that is the whole point. Boundary: the profile above is the in-repo sandbox, **not your machine**, and this is a
declaration-layer judgement, not evidence about runtime behaviour.

If you maintain a plugin: an `engines.dsh` range (or a peer range wider than the exact rc) keeps you out of this
bucket. Upstream 0.2.x also reads an explicit per-pair exemption from the profile's `compatibility.json`, which is
what the checker's "record an explicit version exemption" fix line refers to.

Evidence artifact: `data/results/upgrade-card-2026-10-31T09-00-00.000Z.json` (14/14 recorder checks, two renders
byte-identical, no home path in the card). Source repo: `https://github.com/jjjjjjjjnnjnn/dsh-triage`.

---

## 发布后回填

- `registry.json` → `01-rc5-discussion-reply.md` 的 `status: posted` + URL + 日期；
- `node scripts/record_market_baseline.mjs --stamp <新 ISO>`，看 `d5.download_shape` 是否从 `single-day-burst`
  变成 `steady`（**单日爆发仍不算需求**，见 `audit/blind_spots.json` `BS-48`）。
