<!-- channel: reply in upstream discussion #11687 (Chinese) · draft -->
<!-- 状态: draft（未发布）。贴之前确认：① 回的是 #11687；② 先自己在那个组合上跑一次 audit，确认没有 blocked 行再说。 -->

# 草稿 08 · 回复 #11687（rc.5 启动崩溃：声明层不是凶手）

> **这一条是反向回答**：社区最容易的归因是「插件版本不兼容」，但帖子里点名的两个第三方插件都**放行** rc.5。
> 回帖必须说清「不在声明层」，否则会把人引向错误方向。

---

先说结论：**这不是准入（声明层）把插件摘掉了。**

帖子里的两个第三方插件，按它们**已发布**的 manifest 对 `0.2.1-rc.5` 求值（与加载器同一套 admission 语义）：

```text
@linxin666/dsh-web-all@0.4.13   peers: @deepseek-ai/dsh@>=0.2.1-rc.3            → 放行
dsh-better-sidebar@0.28.2       peers: …dsh-llm@^0.2.1-rc.1 等 13 项            → 放行
```

也就是说：**它们不会被区间拒**。那句 `1 required plugin did not activate` 更可能来自 apply / import / 注册阶段失败，而不是被准入从组合里摘除——这两件事在日志里长得像，但处理方式完全不同（前者要改插件或运行时，后者改声明或加豁免）。

**怎么在你自己机器上把两者分开**（只读，不改 profile）：

```console
$ dsh-triage audit              # 如果没有 blocked 行，就说明不是准入；有的话它会点名是哪一行、什么原因
$ dsh-triage upgrade --to 0.2.1-rc.5 --card
```

如果你的 `audit` 里**没有** blocked 行，那就不要在声明层找原因：去看启动日志里那一行的 import / apply 报错原文，那是「插件自己起不来」，不是「被拦掉了」。

两条边界要说在前面：① 我判的是 **npm 上已发布的版本**，你本机装的可能是别的版本——`audit` 会按你装的算；② 声明层放行**不等于**运行期没问题，这条反过来说也成立：运行期崩了也不等于声明有问题。

证据产物（机器可读、在仓库里带 sha256）：`data/results/discussion-triage-2026-11-02T12-10-00-000Z.json`
