<!-- channel: reply in upstream discussion #11687 (Chinese) · draft -->
<!-- 状态: draft（未发布）。回复场景：升级到 0.2.1-rc.5 后启动崩溃，帖子把原因猜成「插件版本不兼容」。 -->
<!-- R71：这是**反向**回答（声明层不是凶手）。这条不许被误读成「升级会修好」，所以边界句必须留在粘贴块里。 -->

# 草稿 08 · 回复 #11687（声明层不是凶手）

> **给自己看的归因**：这不是「我们能修」，而是「这里可以排除」。两款被点名的第三方插件在 0.2.1-rc.5 上都被判 `admitted`，
> 所以回帖的价值在于**把排查方向挪走**（去 import/apply），而不是给一个可能错误的修法。
> 帖子里还提到 `@deepseek-ai/dsh-desktop`，npm 上没有这个包，我们**判不了**——这一条要一起说，否则读起来像我们全判过了。

## 粘贴块

从 `paste:start` 的下一行到 `paste:end` 的上一行，就是回复正文，原样粘贴。

<!-- paste:start -->
提供一个反向的信息供参考：**这次的启动失败，不是声明层准入规则（admission）拦下来的。**

我把帖子里点名的两款第三方插件在 npm 上发布的 manifest 取下来，用与官方加载器一致的准入规则，对目标运行时 `0.2.1-rc.5` 求值：

```text
@linxin666/dsh-web-all@0.4.13   peers: @deepseek-ai/dsh@>=0.2.1-rc.3            → admitted
dsh-better-sidebar@0.28.2       peers: @deepseek-ai/dsh-llm@^0.2.1-rc.1 等 13 项 → admitted
```

也就是说，这两款插件声明的区间都覆盖了 `0.2.1-rc.5`，**准入阶段不该把它们判掉**。日志里的 `1 required plugin did not activate` 更可能发生在被放行之后的 import / apply / 上下文注入阶段——这两种故障表现相似，但排查方向完全不同：

- 若真是准入拦截：通常有明确的「版本不满足」原文，或被判掉的那一行会消失；
- 若是运行期异常：准入那一关是过的，需要在启动输出里找该模块 import 或 setup 时的具体报错与堆栈。

顺带一条**判不了**的：帖子里提到的 `@deepseek-ai/dsh-desktop`，npm 上没有这个包名，我们无法对它给出任何结论——它不在上面的结论里，请别把它当成「已放行」。

想在自己机器上把「准入」这一层单独排除掉：

```console
$ dsh-triage audit                            # 全量行级准入台账：没有 blocked 行，就说明声明层不是原因
$ dsh-triage upgrade --to 0.2.1-rc.5 --card   # 目标版本下的四桶影响清单（只看声明层）
```

**边界**：以上判的是 npm 上**已发布的版本**，不是你那台机器；声明层放行**不等于**运行期不会出错，也不代表这个故障有已知修法。如果你装的是自定义分支或历史构建，请以本地实际声明与堆栈为准。

复算证据（公开仓，带 sha256）：`https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/discussion-triage-2026-11-02T12-10-00-000Z.json`
<!-- paste:end -->

## 数值来源（不粘贴）

| 数字 | 来自哪里 |
|---|---|
| `@linxin666/dsh-web-all@0.4.13` → `admitted`，1 项 peer | `data/results/discussion-triage-2026-11-02T12-10-00-000Z.json` 的 `rows[number=11687].probes[0]` |
| `dsh-better-sidebar@0.28.2` → `admitted`，13 项 peer | 同上 `probes[1]` |
| `@deepseek-ai/dsh-desktop` → `unreadable`（npm 无此包） | 同上 `probes[2]` |

复算命令：

```console
$ node scripts/record_discussion_triage.mjs --ids 11687 --target 0.2.1-rc.5
```

## 发之前要确认的三件事

见 `docs/distribution/posting-runbook.md`。这篇特别要确认：**帖子还没有被解答**（`node scripts/record_discussion_state.mjs --ids 11687`）；
如果维护者已经给出结论，这篇就不要发了——重复一个别人已给的答案只会稀释信息。
