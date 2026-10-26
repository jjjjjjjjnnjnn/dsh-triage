# ADR 0002 · 覆写不是撞车：entry id 冲突的判定语义

> **状态**：已采纳（2026-10-26） | 影响面：`core/ledger.ts`、`core/verdict.ts` | 触发：真实假阳性

## 背景（一次真实的自我打脸）

首版 `findEntryIdCollisions` 的实现是「按 id 分组，出现 ≥2 次即冲突」。在本机**标准 profile**（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`）上运行，直接报出 **27 条 blocked**：

```
hmr, plan-mode, system-prompt, compaction-basic, …
```

但这些都是**正常机制**。上游 `web-app` 的 patch 里写的是：

```yaml
- id: hmr
  disabled: true
```

即「不重新定义行，只覆写已有行的 `disabled`/`config`」。cordis 的 patch 层语义本来就是「后层按 id 覆写前层」。如果把这个当作撞车，产品上线第一天就会对**每一个**用户报 27 条假警报——比不做还糟。

## 决定

冲突判定只看**行定义**，不看覆写：

| 情况 | 判定 |
|---|---|
| 只有一条 claim 带 `name`/`group`，其余只有 `id`（纯覆写） | **不是冲突** |
| 同一 source 内把同一个 id 定义两次 | `within-source-duplicate`（block） |
| 不同 source 定义同一 id 且**模块不同** | `conflicting-definitions`（block；即上游 `duplicate loader entry id`） |
| 不同 source 定义同一 id 且模块相同（重新声明） | 不是冲突（合法重述） |

## 后果

- 标准 profile 现在输出 `0` 条冲突（真跑 SSOT 可复现：`data/results/why-*.json`）；
- 真实的撞车场景（同 id 不同模块）仍然被点名，并在 remediation 里写出 `x vs y`；
- 新增回归测试：`tests/unit/ledger.test.ts` 的 `pure override is not a collision`。

## 教训（写进 `integrity.md` 的口径）

> **测量 ≠ 结论**：`id` 重复是**观测**；「会炸」需要额外前提（重复的是行定义，且模块不同）。
> 任何「由计数推出的定性判断」都必须先写明对照基准，否则就是把正常机制报成缺陷。
