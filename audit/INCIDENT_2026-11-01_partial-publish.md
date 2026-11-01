# 事故 · 2026-11-01 · 0.3.1 部分发布，`latest` 一度指向装不上的版本

> **状态**：**已修复**。`@dsh-triage/core@0.3.1` 于 `2026-11-01T17:10:45Z` 上线，四个包现在都是
> `latest=0.3.1`；`data/results/publish-2026-11-01T17-30-00.000Z.json` 起 `record_publish` **20/20**
> （匿名安装 exit 0、`dependency:*` 三项全部解析、CLI 15 行命令、`import()` 成功）。
> **破损窗口约 2 分 47 秒**（`17:07:58` → `17:10:45`）。**修复不是我们做的诊断，是补发**；下面记的是
> 现场、根因与「让它不再隐形」的改造。

## 1. 现场（机器可复核）

`data/results/publish-2026-11-01T17-15-00.000Z.json`（`c5021370…`，`ok: false`）——发布后的自动取证第
一次跑就红了，八项失败，根因只有一个：

| 包 | 0.3.1 是否在 registry | `latest` | 依赖 | 结论 |
|---|---|---|---|---|
| `@dsh-triage/core` | **否**（`404 version not found`） | `0.3.0` | — | **缺** |
| `@dsh-triage/signals` | 是（17:0x 之后上线） | `0.3.1` | `core@0.3.1` | 依赖未解析 → 装不上 |
| `@dsh-triage/probe` | 是（`2026-11-01T17:07:33Z`） | `0.3.1` | `core@0.3.1` | 依赖未解析 → 装不上 |
| `dsh-triage` | 是（`2026-11-01T17:07:58Z`） | `0.3.1` | `core/probe/signals@0.3.1` | 依赖未解析 → 装不上 |

匿名安装的原文（同一份产物）：

```
npm error notarget No matching version found for @dsh-triage/core@0.3.1.
```

所以在这一刻，`npm install dsh-triage`（解析 `latest`）会失败——**这是用户可见的破损**，不是内部问题。

## 2. 时间线（UTC）

| 时刻 | 事件 |
|---|---|
| 17:07:33 | `@dsh-triage/probe@0.3.1` 上线 |
| 17:07:58 | `dsh-triage@0.3.1` 上线（`latest` 跟着指过去） |
| ~17:08 | `pnpm -r publish` 在 `core` 上失败；registry 留下一份**暂存**的 0.3.1（`409 Cannot publish over previously staged version`） |
| ~17:09 | R53 的预检查重跑，`version-already-published` 判红 → 才发现「已经发了一部分」 |
| 17:10 | `record_publish --version 0.3.1` 落红产物，八项失败全部指向同一个缺口 |
| **17:10:45** | **`@dsh-triage/core@0.3.1` 上线**（HUMAN 侧补发成功）——`latest` 破损解除 |
| 17:13 | 重试 `pnpm --filter @dsh-triage/core publish`：仍 `409`（暂存未过期） |
| 17:14 | 尝试把 `latest` 指回 0.3.0 做最小回滚：`npm dist-tag add` → **`EOTP`**（写操作要网页 OTP，agent 侧做不了） |
| 17:30 | `record_publish` **20/20**：匿名安装 exit 0、三个 `dependency:*` 全部解析、CLI 与 `import()` 通过 |

## 3. 根因（两层，缺一不可地说）

1. **直接原因**：`pnpm -r publish` 是**四次独立的 registry 写**，npm 没有跨包事务。`core` 那次卡在 OTP/暂存
   上没有提交成功，后三个照常发出去——于是「四个包同版本」这个前提**只在开始时成立**。
2. **过程原因（更重要）**：`pnpm run release:publish` 的定义是
   `release_preflight && pnpm -r publish`，**发布之后没有任何自动取证**。谁按了发布，谁就以为完事了；
   `record_publish` 那 20 项检查只有想起来才会跑。R50 就写过「没产物不算一步」，但发布链本身没遵守。

## 4. 修复路径（按顺序）

1. ~~**补发 `core@0.3.1`**~~ —— **已完成**（`17:10:45Z` 上线，HUMAN 侧执行）。四个包现在都是 `latest=0.3.1`。
2. ~~**`record_publish` 复跑**~~ —— **已完成**：`publish-2026-11-01T17-30-00.000Z.json` **20/20**，含 `anonymous-install`（exit 0）与三个 `dependency:*`（全部解析到 0.3.1）。
3. **备用路径（未触发）**：若暂存 1 小时不清，改走 **0.3.2**（四包一起）并把 0.3.1 `npm deprecate` 成「uninstallable partial publish」——**不许**把 0.3.1 留在 `latest` 上装作没事。这条留着，因为同类事故还可能再来。
4. **发布链改造（本轮已做）**：`release:publish` 变成
   `release_preflight → pnpm -r publish → record_publish`，且 `record_publish` 的版本默认从
   `packages/plugin/package.json` 读（不再默认 `0.1.0`）。这样「发到一半」会在同一条命令里当场变红。
   **这次的证据**：`publish-2026-11-01T17-30-00.000Z.json` 的 `release.version_source = "manifest"`、
   `release.version = "0.3.1"`——不带 `--version` 也检查对了版本。

## 5. 这次学到什么（写进 `BS-50`）

- 「四个包同版本」是**发布前的计划**，不是发布后的**事实**；事实只能来自 registry 逐包查询。
- 一条命令 exit 0 还是非 0，都不能证明四个包都上去了；**只有匿名安装一次**能证明用户装得上。
- 危险的不是失败，是**部分成功**：它让 `latest` 指向一个装不上的版本，而所有内部检查都还是绿的。

## 6. 一处自己撞上的隐私门（同日修复）

红产物里带着 `npm` 自己的报错原文，而原文里有一个用户目录下的 `npm-cache` 日志路径 →
`results-privacy` 门判红。处置：**事后脱敏 + 重算 sha256**（`c5021370…` → `05976eaa…`，台账 `R53-S9` 写明），
同时把 `record_publish` 的 `clean()` 扩到 `homedir()`（原来只清 scratch 与 tmp），后续不会再写出去。
这条和 R51 的六份产物、R52 的 `inputs.fixtures` 是同一个坑的第三次。
