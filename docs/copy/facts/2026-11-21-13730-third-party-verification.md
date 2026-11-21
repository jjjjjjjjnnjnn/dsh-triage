# 事实包：#13730 的第三条独立验证（2026-11-21）

> **用途**：把 D5 判 `fail` 之后第一条「第三方明确引用并验证我们输出」的信号写成可复算事实。
> **不是**对外文案，也不是 D5 翻案：判据冻结、窗口已关，这条评论在窗口外且不在 `#11813`。
> 事实包先行；本轮**不发帖、不回帖**，理由在 §4。

---

## 1. 来源（可逐字段核对）

| 项 | 值 |
|---|---|
| 线程 | [deepseek-ai/deepseek-harness#13730](https://github.com/deepseek-ai/deepseek-harness/discussions/13730)（`General`，`open`，`answerable: false`） |
| 评论 | `https://github.com/deepseek-ai/deepseek-harness/discussions/13730#discussioncomment-19796156` |
| 作者 | **RealLearnAI**（第三方，非本仓账号） |
| 时间 | **2026-11-21T14:40:12Z** |
| 板块读数 | `data/results/discussion-state-2026-11-21T16-04-50-189Z.json`：`comments 4`（GraphQL 顶层口径）、`last_comment.at = 2026-11-21T14:40:12Z`、`last_comment.author = RealLearnAI`、`gate = unreadable` |
| 读回方式 | `gh api repos/deepseek-ai/deepseek-harness/discussions/13730/comments`，REST 返回 6 条（含 2 条嵌套回复），最后一条 id `19796156` |

**口径差异如实记**：GraphQL 的 `comments` 是 4、REST 是 6 —— 差别是两条嵌套回复，不是「评论被删」。两条口径都写进产物/事实包，读者不会把一个数当全部。

---

## 2. 他说了什么（只取可核对的）

1. **新的 Windows 实例**：host `0.2.2-rc.5`（asar 校验）、Windows 11、Electron 44.7.0、Node 24.21.0；触发方式是 `nightly` 通道的 host 自动更新，**不是**用户手动改插件。
2. **pin 级别不同**：官方可选 bundle 仍钉在 **`0.2.2-rc.1`**（`@deepseek-ai/dsh-experimental-session-search`、`dsh-experimental-plugin-market-bundle`），而 `#13730` 原帖与 `#13748` 是 rc.3 —— **同一机制，第三个独立的版本pin 实例**。
3. **host 侧日志**：renderer crash log 逐字给出 `active Service "sessionController" is unavailable`；在 UI 里禁用两个 bundle **不能**消除故障（与 OP 一致：问题是被遮蔽的 stale resolution，不是 bundle 是否启用）。
4. **明确引用并验证我们的输出**：原文写「Recovery — **matches the CLI path reported by @jjjjjjjjnnjnn in this thread, confirmed working on Windows**」，并贴出他自己跑的 `ELECTRON_RUN_AS_NODE=1 … cli.js plugin --profile desktop add …` 命令，附「app quit first、重启后输入框与建会话恢复、无新 crash log」的观察。
5. **复发性**：同一机器 12 天内三次遇到同故障（先是手动装 stale bundle，后两次 host 自动更新），结论是持久修复必须在 updater 侧。

---

## 3. 对我们意味着什么（诚实的边界）

- **这是 D5 判 `fail` 之后第一次有人明确引用我们的输出并说「confirmed working」**。此前 `#13581` 的回应是**更正我们的模型**，这次是**验证我们给出的命令** —— 两者性质不同，不能混成「别人认可」。
- **不翻 D5**：三个阈值（10 / 1 / 20）、判定顺序、窗口 `2026-11-01T20:24:37Z → 2026-11-15T20:24:37Z` 全部冻结。这条评论发生在 11-21、线程是 `#13730` 而非 `#11813`，按判据**不计入** reactions / 外部引用 / 周下载中的任何一项。
- **不是我们的实测**：「confirmed working」是对方在自己机器上的观察；我们没有访问他的 profile、没有运行他的 host，也没有在 macOS 上验证过。本轮只读了一条公开评论。
- **不是上游采纳**：线程里 durable fix 的讨论在维护者 `TheVicky1` 与其他报告者之间继续（事务性 reconciliation、`listBundles()` 区分声明版本与解析版本）；上游尚未给结论。
- **第二个 Windows + 第一个 macOS**：这条加上 `#13748`（Windows rc.3）与原帖 `#13730`（macOS rc.3）构成三个独立现场，但仍是**便利样本**，不是随机抽样。

---

## 4. 为什么本轮不回帖（必须写死，防止下一轮手痒）

1. 对方已经**明确确认**我们的 CLI 路径有效并贴了自己的命令 —— 我们回「谢谢」是噪声。
2. 他提的 durable fix（updater 事务性 reconciliation）正在维护者与其他用户之间推进，我们插进去不会加速它。
3. HANDOFF §3 从 R122 起写死：**回帖数不是需求证据**；`read_not_posted` 要记一句为什么不跟进。
4. 本仓 Agent 不直接发帖 —— 发帖/回帖权归知识库 `agent-promotion`；本轮也不派发，因为没有需要对方知道的新信息。

---

## 5. 产物指针（本事实包引用的数字都带 `.sha256`）

- `data/results/discussion-state-2026-11-21T16-04-50-189Z.json`（板块读数与最后评论作者/时间）
- `data/results/updater-drift-2026-11-19T06-56-13-204Z.json`（R122 读安装件：`manageDesktopProfile` 只在 plugin 调用点放行）
- `data/results/remedy-probe-2026-11-19T06-54-24-786Z.json`（R122 准入复算：rc.3 构建在 rc.5 上 denied，bundle 自身 unconstrained）

**复算命令**：

```powershell
node scripts/record_discussion_state.mjs --ids 13730 --stamp 2026-11-21T16:04:50.189Z
node --test tests/governance/copy-channel.test.ts
```
