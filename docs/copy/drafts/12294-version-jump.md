<!-- facts: docs/copy/facts/2026-11-05-12294-version-jump.md -->

# 12294 · 「每一版都不兼容」其实是 caret 区间

- **目标**：GitHub Discussion `deepseek-ai/deepseek-harness#12294`（Q&A，`open`）
- **语言 / 渠道**：中文 / GitHub Discussion 回复
- **作者**：`agy --model gemini-3.8-flash-high`（事实包由工程侧提供，数字未改一字）
- **状态**：`posted` — 2026-11-05T17:48:21Z · https://github.com/deepseek-ai/deepseek-harness/discussions/12294#discussioncomment-19423754（回填于 `docs/copy/outreach.json`）

## 粘贴块

<!-- paste:start -->
这不是「每版都是新产品」，而是插件声明里的 `^0.1.0-rc.N` 按 semver 把 0.1 锁死，`0.2.x` 在区间外。

在一台跑 `0.1.0-rc.6` 的 profile 上测 `0.2.2-rc.1`：130 个单元中有 128 个 `would-be-denied`，且全部被 `@deepseek-ai/dsh-invariants@^0.1.0-rc.6` 等 caret 区间拦截。另有 2 个单元是 `cannot-tell`：它们没有声明任何 DSH 区间，所以不是「不兼容」，而是「无法判断」——沉默不等于通过。四桶里 `improved` 是 0：意思是「今天能跑、升上去会挂」的单元，在这台机器上一个也没有。离线复现命令：

```console
npx dsh-triage upgrade --to 0.2.2-rc.1 --card
```

你可以在自己机器上跑同一命令，查看自己那份清单。

以上判的是**声明层**：只看「声明区间 vs 目标运行时」，没有任何一个单元在 `0.2.2-rc.1` 上真正启动过；而且这是**一台机器、一个 profile** 的读数，**不是你那台机器**，换台机器数字就变。

`https://github.com/jjjjjjjjnnjnn/dsh-triage`（这不是官方项目）
<!-- paste:end -->

## 声明（供复核）

| 草稿里说的 | 事实包里的出处 |
|---|---|
| 130 个单元 / 128 个 `would-be-denied` | 产物 `impact.counts` 逐项相同 |
| 2 个 `cannot-tell`，且「没有声明任何 DSH 区间」 | 产物 `units[]` 里这两条的 `missing_evidence` |
| `improved` 为 0 | 产物 `impact.counts.improved` |
| `@deepseek-ai/dsh-invariants@^0.1.0-rc.6` 挡了全部 | 事实包「机制」段（128/128 由派生命令算出） |
| 命令离线可复现 | 确切版本号 = 不读 registry（`docs/specs/M6-upgrade-day.md`） |

**没有出现**事实包以外的数字。边界句与事实包逐字一致。
