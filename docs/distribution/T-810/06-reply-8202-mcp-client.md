<!-- channel: reply in upstream discussion #8202 (Chinese) · draft -->
<!-- 状态: draft（未发布）。回复场景：帖子里点名 @deepseek-ai/dsh-mcp-client@0.1.0-rc.7 在 0.2.x 下无法加载。 -->
<!-- R71：正文改成「粘贴块」+ 数值来源。块内每个数字都由 scripts/check_listing.mjs 第 16 条从被引产物复算。 -->

# 草稿 06 · 回复 #8202（`@deepseek-ai/dsh-mcp-client@0.1.0-rc.7` 的准入约束）

> **给自己看的归因**：帖子点名了具体版本，所以不需要推测。该版本把 6 项 peer 钉在 `^0.1.0-rc.7`，
> 与 0.2.x 结构性不相交；而同名的 `0.2.1-rc.5` 把 8 项 peer 精确钉在运行时本身，同一个引擎判它放行。
> 两个数都由产物复算，不是读代码读出来的。

## 粘贴块

从 `paste:start` 的下一行到 `paste:end` 的上一行，就是回复正文，原样粘贴。

<!-- paste:start -->
你好，这个加载失败不是你的本地配置写错了，而是这个构建版本自己声明的 peer 依赖与 0.2.x 不相交。

`@deepseek-ai/dsh-mcp-client@0.1.0-rc.7` 在 npm 上发布的 manifest 里，6 项 peerDependencies 全部落在 0.1 线上：

```text
@deepseek-ai/dsh-llm@^0.1.0-rc.7          @deepseek-ai/dsh-tools@^0.1.0-rc.7
@deepseek-ai/dsh-timeout@^0.1.0-rc.7      @deepseek-ai/dsh-attachment@^0.1.0-rc.7
@deepseek-ai/dsh-invariants@^0.1.0-rc.7   @deepseek-ai/dsh-subprocess@^0.1.0-rc.7
```

这些 0.1 线的 caret 区间在 SemVer 下不含任何 `0.2.x`，所以加载器在准入阶段就把这一行判掉了——它没有进到 import/apply，也就不会给你留下运行期堆栈。我按目标运行时 `0.2.1-rc.5`（今天的 `next`）用与加载器一致的规则跑了一遍，结论是 `denied`，未满足的正是上面这 6 项。

**可执行的出路**（按推荐顺序）：

1. **装上游已经适配 0.2.x 的那个构建**：`@deepseek-ai/dsh-mcp-client@0.2.1-rc.5`。它的 8 项 peer 精确钉在 `0.2.1-rc.5` 上，同一个引擎判 `admitted`。换成它之后如果还起不来，那才是运行期问题，需要看 import/apply 的堆栈——两种故障的排查方向不同。
2. **显式豁免（接受风险）**：上游安装器在拒绝时会给出自己的豁免提示，形如 `dsh plugin … allow-version <pkg>@<version> --dsh-version <runtime> --accept-risk`（**具体参数以上游报错原文为准**）。它只绕过声明层准入，**不改写包里的 manifest，也不代表代码能跑**。

想在自己机器上复核：

```console
$ dsh-triage check @deepseek-ai/dsh-mcp-client@0.1.0-rc.7   # 按这个版本判，不按 latest
$ dsh-triage check @deepseek-ai/dsh-mcp-client@0.2.1-rc.5   # 推荐替换的那个构建
```

**边界**：以上判的是 npm 上**已发布的版本**，不是你那台机器；如果你本地装的是改过的分支，请以本地 `package.json` 的实际声明为准。声明层放行也不等于运行期一定无故障。

复算证据（公开仓，带 sha256）：`https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/discussion-triage-2026-11-02T12-10-00-000Z.json` · `https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/remedy-probe-2026-11-02T19-15-18-710Z.json`
<!-- paste:end -->

## 数值来源（不粘贴）

| 数字 | 来自哪里 |
|---|---|
| `denied` / 6 项未满足 / 6 项 peer | `data/results/discussion-triage-2026-11-02T12-10-00-000Z.json` 的 `rows[number=8202].probes[0]` |
| `admitted` / 8 项 peer | `data/results/remedy-probe-2026-11-02T19-15-18-710Z.json` 的 `rows[0]` |
| 目标运行时 `0.2.1-rc.5` | 两份产物的 `sample.target` / `target` |

复算命令：

```console
$ node scripts/record_discussion_triage.mjs --ids 8202 --target 0.2.1-rc.5
$ node scripts/record_remedy_probe.mjs --target 0.2.1-rc.5 --pins "@deepseek-ai/dsh-mcp-client@0.2.1-rc.5"
$ dsh-triage audit                        # 你机器上的行级准入台账（只读）
```

## 发之前要确认的三件事

见 `docs/distribution/posting-runbook.md`。至少：帖子仍 `open`（`node scripts/record_discussion_state.mjs --ids 8202`）、`latest` 仍是 `0.0.1-rc.1`、正文里的两个 URL 能打开。
