<!-- channel: reply in upstream discussion #10849 (Chinese) · draft -->
<!-- 状态: draft（未发布）。回复场景：裸名安装 @deepseek-ai/dsh-mcp-client 被拒，原因是 npm 的 latest 标签失步。 -->
<!-- R71：正文改成「粘贴块」+ 数值来源。latest/next 两个标签值由产物记录（它们是带时间戳的事实，不是包的属性）。 -->

# 草稿 07 · 回复 #10849（`latest` 指向 `0.0.1-rc.1` 导致裸名安装被拒）

> **给自己看的归因**：拦截不是使用者写错了区间，而是裸名解析到的那个构建自己声明得太老。
> 今天两个标签的读数是 `latest=0.0.1-rc.1` / `next=0.2.1-rc.5`；前者 4 项 peer 钉在 `^0.0.1-rc.1`（拒），后者 8 项精确钉在运行时本身（放行）。
> **retag 是上游的动作**，用户侧只能绕过，不能修复。

## 粘贴块

从 `paste:start` 的下一行到 `paste:end` 的上一行，就是回复正文，原样粘贴。

<!-- paste:start -->
你好，这个拒绝**不在你本地写的配置区间上，而在 npm 的 `latest` 标签指向**。

截至 2026-11-02，`@deepseek-ai/dsh-mcp-client` 的两个标签是：`latest = 0.0.1-rc.1`、`next = 0.2.1-rc.5`。不带版本号的 `dsh plugin add @deepseek-ai/dsh-mcp-client` 会拉 `latest`，也就是 `@deepseek-ai/dsh-mcp-client@0.0.1-rc.1`；而这个构建的 4 项 peer 全部钉在 0.0.1 线上：

```text
@deepseek-ai/dsh-llm@^0.0.1-rc.1        @deepseek-ai/dsh-tools@^0.0.1-rc.1
@deepseek-ai/dsh-invariants@^0.0.1-rc.1 @deepseek-ai/dsh-subprocess@^0.0.1-rc.1
```

这个 0.0.1 线的 caret 区间与 `0.2.x` 没有任何交集，于是加载器在准入阶段把这行判掉，表现就是「装不上 / 不兼容」。

要分清**谁能修**：

1. **你这边能做的**：不要用裸名，显式指定**已经适配 0.2.x 的那个构建**——`@deepseek-ai/dsh-mcp-client@0.2.1-rc.5`（就是现在的 `next`）。它把 8 项 peer 精确钉在 `0.2.1-rc.5` 上，同一个引擎判 `admitted`。
2. **你这边做不了的**：`npm dist-tag add` 是上游的发版动作。在 `latest` 被修正之前，裸名安装会一直解析到那个老构建。

装之前可以先看清裸名到底解析到哪、以及它会不会被放行：

```console
$ npm view @deepseek-ai/dsh-mcp-client dist-tags    # 标签随时可能变，先读一次再决定
$ dsh-triage check @deepseek-ai/dsh-mcp-client       # 裸名（= latest）的准入结论
$ dsh-triage check @deepseek-ai/dsh-mcp-client@0.2.1-rc.5
```

**边界**：以上判的是 npm 上**已发布的版本**，不是你那台机器；标签是可变的，若上游之后 retag，以你执行 `check` 时读到的 registry 数据为准。声明层放行也不代表运行期一定无故障。

复算证据（公开仓，带 sha256）：`https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/discussion-triage-2026-11-02T12-10-00-000Z.json` · `https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/remedy-probe-2026-11-02T19-15-18-710Z.json`
<!-- paste:end -->

## 数值来源（不粘贴）

| 数字 | 来自哪里 |
|---|---|
| `denied` / 4 项未满足 / 4 项 peer | `data/results/discussion-triage-2026-11-02T12-10-00-000Z.json` 的 `rows[number=10849].probes[0]`（版本 `0.0.1-rc.1`） |
| `admitted` / 8 项 peer | `data/results/remedy-probe-2026-11-02T19-15-18-710Z.json` 的 `rows[0]`（版本 `0.2.1-rc.5`） |
| `latest = 0.0.1-rc.1` / `next = 0.2.1-rc.5` | 同上产物的 `rows[0].dist_tags`（**一次读取，带时间戳**） |

复算命令：

```console
$ node scripts/record_discussion_triage.mjs --ids 10849 --target 0.2.1-rc.5
$ node scripts/record_remedy_probe.mjs --target 0.2.1-rc.5 --pins "@deepseek-ai/dsh-mcp-client@0.2.1-rc.5"
$ npm view @deepseek-ai/dsh-mcp-client dist-tags     # 标签现值，发帖前必读
$ dsh-triage audit                                   # 你机器上的行级准入台账（只读）
```

## 发之前要确认的三件事

见 `docs/distribution/posting-runbook.md`。这篇最容易被时间打脸：**`latest` 一旦被 retag，整篇的前提就没了**——发之前一定重读 `dist-tags`。
