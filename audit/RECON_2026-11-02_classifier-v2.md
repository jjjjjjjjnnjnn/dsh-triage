# 实验 · 分类器 v2：开发集 20/20，留出集 12/20，**不采用**（R60）

> **产物**：`data/results/classifier-v2-2026-11-02T11-20-00-000Z.json`（`3e357e063cfe…`）
> **脚本**：`scripts/record_classifier_v2.mjs`（读 QA 快照 + 两份标签，纯离线）
> **数据**：`data/fixtures/question-coverage/2026-11-02T09-57-53-229Z/`（`qa.json` 全文 1545 条 · `review.json` 开发集 20 条 · `holdout-review.json` 留出集 20 条）
> **代码**：`scripts/lib/discussion-triage.mjs` —— `classifyThread`（v1，**生产**）/ `classifyThreadV2`（实验，不采用）

---

## 1. 结论先说

| 集合 | 样本 | v1 一致 | v2 一致 |
|---|---:|---:|---:|
| 开发集（v2 就是从这里设计的） | 20 | **9/20（45%）** | **20/20（100%）** |
| 留出集（新种子 `20261103`，排除开发集 20 条） | 20 | **7/20（35%）** | **12/20（60%）** |

**v2 是真实改进（35% → 60%），但没有达到 `docs/specs/question-coverage.md` §8 的 80% 门槛，所以不替换生产分类器。**
R59 的覆盖率数字（**74/1545 = 4.8%**）与 README 里的 **9/20** 一字未动；v2 只作为可复现实验保留。

> **开发集 20/20 不能当成准确率**：v2 的信号表就是照着这 20 条的分歧加词加权的。留出集才是「它没见过的问题」。

## 2. v2 改了什么

v1 的问题不是「漏了某个词」，而是**只认少数具体形状**：`service-unavailable` / `cookie` / `peer` / `重复`。真实报告大量写的是 `fails` / `cannot` / `TRANSPORT` / `0xC0000142` / `白屏` / `卡着` / `403`。v2 加了三类信号：

1. **通用失败动词**（runtime，权重 3）：`fail(s|ed|ure)` / `error` / `crash` / `exception` / `cannot` / `无法` / `失败` / `报错`；
2. **具体运行期形状**（runtime，权重 4–5）：`0xC000` / `SEC_E_` / `TRANSPORT` / `沙箱` / `ACL` / `timeout` / `超时` / `WebSocket` / `502` / `503` / `权限`（v2.1 未加）；
3. **组合形状**（composition，权重 3–4）：`fork` / `同名` / `link:` / `node_modules` / `inject` / `bundle patch` / `硬依赖` / `preset-standard`。

权重顺序是：具体运行期形状（5）> 声明/组合陈述（4）> 通用失败动词（3）> 弱词法提示（2）；同分按 `LAYERS` 顺序（admission 在前），所以「install fails: peer …」仍然是 admission。

## 3. 留出集 8 条没对上的（这才是重点）

| # | 人工标签 | v2 读出 | 为什么 |
|---|---|---|---|
| 264 | runtime | unknown | 「提问一直**卡着**」——v2 只有 `卡死/卡住`，没有 `卡着` |
| 5439 | composition | upgrade/answerable | 坏掉的 fallback **symlink** 被读成 upgrade；`symlink`/`module-fallback` 不是组合信号 |
| 653 | runtime | unknown | 「反代访问返回 **403**」——v2 有 `502/503`，没有 `401/403` |
| 6509 | unknown | runtime | 这是一篇模型行为研究，但正文用「**不能**把这些实验写成……」——`不能` 误触发 |
| 5445 | runtime | unknown | 会话损坏 + `INVALID_REQUEST / HTTP 400`；v2 没有 `400`/`损坏`/`INVALID_REQUEST` |
| 11338 | runtime | unknown | 「turn ends with no text block / nothing to display」；没有失败动词 |
| 5116 | runtime | admission/answerable | 构建被 TS 错误挡住；`pnpm install` 把它拉进 admission，runtime 权重不够 |
| 10057 | runtime | unknown | 「更新后要**提权**才能写 Office」；v2 没有裸 `权限/提权` |

两个方向都有：v2 漏了**中文/日志形状**（卡着、403、400、损坏、提权），也**误报**了一次（`不能` 出现在方法学讨论里）。

## 4. 为什么不继续在留出集上调

留出集已经被看过；任何针对这 8 条加词都会把它变成**第二个开发集**，下一个 12/20 也就没有意义了。v3 要么：

- 用**第三个**互斥留出集验证；或
- 换方法：先做「问题 vs 故障」的二分类（把 feature request / usage question 挡掉），再做层分类；或
- 承认纯关键词的天花板，引入本地小模型做一次「只读文本」的辅助判断（需要新的 ADR 与离线边界）。

## 5. 复算

```powershell
node scripts/record_classifier_v2.mjs --stamp 2026-11-02T11:20:00.000Z `
  --fixtures data/fixtures/question-coverage/2026-11-02T09-57-53-229Z `
  --dev data/fixtures/question-coverage/2026-11-02T09-57-53-229Z/review.json `
  --holdout data/fixtures/question-coverage/2026-11-02T09-57-53-229Z/holdout-review.json
```

预期：`dev v1 9/20 · v2 20/20`；`holdout v1 7/20 · v2 12/20`；`verdict not-adopted`。

## 6. 对产品的影响

- **没有影响**：生产分类器、覆盖率产物、README 的 4.8% 与 9/20 都没改；
- **有价值**：v2 证明了「加通用失败动词」能显著提高召回（留出集 +5/20），也证明了「关键词表单独用」到不了 80%；
- **下一步**：分类器 v3 是独立判据轮，先写 spec + 新留出集，再动代码。`BS-53` 已登记。
