# 实验 · 分类器 v3：干净留出集 17/20（85%），**过 80% 门槛，但尚未采用**（R61 候选）

> **产物**：`data/results/classifier-v3-2026-11-02T12-50-00-000Z.json`（`4b0247e48c35…`）
> **脚本**：`scripts/record_classifier_v3.mjs`（读 QA 快照 + 三份标签，纯离线）
> **代码**：`scripts/lib/discussion-triage.mjs` —— `classifyThread`（v1，**生产**）/ `classifyThreadV2`（R60 实验）/ `classifyThreadV3`（R61 候选）
> **数据**：`data/fixtures/question-coverage/2026-11-02T09-57-53-229Z/`（`review.json` 开发集 · `holdout-review.json` 留出集 1 · `holdout2-review.json` 留出集 2）

---

## 1. 结论先说

| 集合 | 样本 | v1 | v2 | **v3** |
|---|---:|---:|---:|---:|
| 开发集（v2 从这里设计；v3 也看过） | 20 | 9/20 | 20/20 | **20/20** |
| 留出集 1（v2 的失败集；v3 设计时看过） | 20 | 7/20 | 12/20 | **17/20** |
| **留出集 2（v3 从未见过，干净）** | 20 | 5/20 | 15/20 | **17/20（85%）** |

**v3 在干净留出集上 17/20，超过 `docs/specs/question-coverage.md` §8 的 80% 门槛。** 但本轮**没有**把它换进生产：

- 换分类器会改变覆盖率的头条（R59 的 74/1545 = 4.8% 是 v1 测的），必须**另开一轮重测**（live + 新 20 条抽检 + HUMAN 抽查）；
- 留出集 2 的标签是 agent 盲标的，**还没有 HUMAN 抽查 5 条**；
- 所以产物写的是 `decision: candidate-validated`，不是 adopted。

## 2. v3 改了什么

v2 的留出集 1 有 8 条没对上，v3 针对**形状**补了三类、并加了一条**否决**：

1. **中文/日志形状**：`卡着` / `卡顿` / `卡了`、`401/403`、`INVALID_REQUEST` / `Content Exists Risk` / `HTTP 400`、`损坏|corrupt`、`提权|权限|elevation`、`no text block / nothing to display`；
2. **组合形状**：`symlink` / `module-fallback` / `healProfilesModuleFallback`（权重 5，压过 upgrade）；
3. **问题/功能请求否决**：如果文本像「怎么用 / 能不能加 / 请问」且**没有具体失败形状**，直接 `unknown / not-ours`。这修掉了 v2 的 `不能` 误报（一篇模型行为研究被读成 runtime）。问题里如果**引用了**具体错误（`0xC000` / `TRANSPORT` / `error` / `超时` / `卡顿` …），否决不生效——它仍然是故障。

## 3. 干净留出集 2 的 3 条没对上

| # | 人工标签 | v3 读出 | 为什么 |
|---|---|---|---|
| 11173 | runtime | unknown | 「为什么现在**非常的慢**」——否决把「为什么」当问题，而 `慢` 不在具体失败形状里 |
| 10855 | runtime | admission/answerable | 升级后 `Invalid URL` 起不来；`升级到…后` 给了 upgrade，`无法/error` 的 runtime 权重没有压过它 |
| 3491 | runtime | unknown | 「启动一直**卡在**加载插件页面」——`卡在` 不在具体失败形状里（v3 有 `卡着/卡顿/卡死/卡住`） |

这三条都是**同一类**：中文性能/启动症状 + 问句。修它们只需要再加 `慢|卡在` 等词，但**这就是在留出集 2 上调参**——它会变成第二个开发集，下一个数字就不可信了。所以本轮**停在这里**。

## 4. 采用 v3 需要什么（R62）

1. **HUMAN 抽查留出集 2 的前 5 条**（同一次排序），确认 agent 标签；
2. 新开一轮覆盖率：把 `classifyThread` 切到 v3，**live 重跑** Q&A + General，生成新的测量/复算/抽检产物；
3. 新抽检用**新种子**（不能复用留出集 2），README 的「一致率」写新读数；
4. `check_listing` 第 14 条、HANDOFF、README 的数字一起更新。

在此之前，**生产仍是 v1**，R59 的 **4.8%** 与 README 的 **9/20** 不变。

## 5. 复算

```powershell
node scripts/record_classifier_v3.mjs --stamp 2026-11-02T12:50:00.000Z `
  --fixtures data/fixtures/question-coverage/2026-11-02T09-57-53-229Z
```

预期：`dev v1 9/20 · v2 20/20 · v3 20/20`；`holdout1 7/12/17`；`holdout2 5/15/17`；`decision candidate-validated`。

## 6. 这轮的意义

- v1 → v3 在**从未见过的** 20 条上从 **5/20 提到 17/20**：这不是「加一个词」，而是「补形状 + 否决误报」两件事都起了作用；
- 但 85% 仍然是「文本分类」的水平：3 条漏掉的都是中文性能/启动症状，说明下一层需要**症状词典**（慢/卡在/提权/损坏）或换方法；
- **不采用**不是保守，是因为换分类器必须与新的覆盖率读数一起出现，否则 README 的 4.8% 和 9/20 会变成两个不同分类器的拼盘。
