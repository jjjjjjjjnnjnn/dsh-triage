<!-- facts: docs/copy/facts/2026-11-12-11687-startup-log.md -->

# #11687 · `1 required plugin did not activate` 上面那段才是根因（草稿，**未发**）

> 状态：`draft`。帖子 `open`（`record_discussion_state --ids 11687`，2026-11-12T07:10Z：3 条评论、最后一条 `PerryLink`、`isAnswered: false`）。
> 发布由 HUMAN 决定；D5 关窗前不开新动作。
> **文案来源**：外部 `agy --model gemini-3.8-flash-high` 读本事实包生成（2026-11-12）。源码段落顺序由事实包锁死，措辞由 copywriter 负责。

<!-- paste:start -->
你说的段落顺序我按 master 核过，成立。在 `packages/boot/app-boot/src/index.ts` 里，`startupDiagnostic` 负责汇总首行，只报 required 插件未激活；`Failed plugins` 段才由 `inactiveDiagnostic` 给出带 required 标记的 id、Package 名与错误原文；而 `Plugins waiting for services` 列出的只是在等服务的插件，属于后果而非根因。

排查时建议把「准入」与「运行期」两个阶段划清：准入在 import 之前做判定，不会产生运行期堆栈；import、apply 或上下文注入失败时才有栈。此前用同一个准入引擎对被点名的第三方插件求值，结论均为 admitted，因此这次更可能是运行期问题，而非声明层。

做二分排查建议带上备份：修改前先把 `dsh.profile.bundles` 复制一份，因为要逐字节还原。将 `dsh.profile.bundles` 缩减到只剩官方 base 的条目，确认能正常启动；再逐个加回插件，崩在哪个就是哪个。

这只是读源码得出的排查顺序，不是对你这次崩溃的归因；没看到你的启动日志，根因判不了，也不是你那台机器的读数。
<!-- paste:end -->

## 数值来源

- `data/results/discussion-state-2026-11-12T07-10-00-000Z.json`（`#11687 open / comments 3 / last by PerryLink`）
- 源码：`deepseek-ai/deepseek-harness` `master` `e8f7b93a`，`packages/boot/app-boot/src/index.ts`（`startupDiagnostic` / `inactiveDiagnostic` / `failureDetail` 三处；来信给的行号与我们从该提交读到的差 1–2 行，原因写在事实包里）
- 11-11 那条已发的回复（`docs/copy/outreach.json` 的 `entries` 里 `#11687` 条目）

## 复算

```powershell
node scripts/record_discussion_state.mjs --ids 11687 --stamp 2026-11-12T07:10:00.000Z --out %TEMP%
gh api repos/deepseek-ai/deepseek-harness/contents/packages/boot/app-boot/src/index.ts -H 'Accept: application/vnd.github.raw'
```

## 不许改的边界

- 不许点名「就是 X 插件」：我们没有他的日志。
- 不许写成「升级会修好」「装了就没事」。
- 不许把「准入放行」读成「运行期没问题」。
- 这条回复**不引用任何读数**（只有源码函数名与文件名），不要为了好看加数字。
