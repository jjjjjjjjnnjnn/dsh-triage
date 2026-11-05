<!-- facts: docs/copy/facts/2026-11-05-10458-followup.md -->

# 10458 · follow-up：复核嵌套 app-boot 补丁（含 `6887f331bb` 的扩展）

- 渠道：GitHub Discussion `deepseek-ai/deepseek-harness#10458`（英文）
- 回复对象：`aturzone` 的 `discussioncomment-19416449`（原分支 `abe10ce`）与其 `discussioncomment-19417014`（扩展 `6887f331bb`）
- 状态：**已发 `discussioncomment-19417004`，并在 60 秒后按新提交更新过一次**（原文只覆盖 `abe10ce`；扩展提交与我们的评论几乎同时落地）
- 检查：行号以分支 tip `6887f331bb` 为准；没跑过他的测试套件

<!-- paste:start -->
Reading the diff at `abe10ce`: the patch adds an optional `runtimeVersion` to `ProfileContext`, gives it nullish-coalescing precedence over `getDshRuntimeVersion()`, and applies one change in `compatibility-preflight`.

Since then `6887f331bb` extends it to the other two surfaces I was about to flag: bundle layers (`loadProfileDirectory` / `loadProfile` now take `runtimeVersion`, used at `profile.ts:701`) and `plugin-manager` (five call sites now go through `this.runtimeVersion()`).

What still resolves the checking copy's own manifest at the branch tip:
- `packages/boot/plugin-market/src/index.ts:377`: `getDshRuntimeVersion()` is read and forwarded to the compatibility call at `:513`, so a market served from a nested app-boot copy still judges its listing against that copy.
- `packages/boot/plugin-manager/src/index.ts:514`: still reads `getDshRuntimeVersion()`, but for install-target naming rather than admission — flagging only so it is not mistaken for the same call.

README phrasing: is "composition preflight prefers the launcher runtime version" meant to stay scoped to row-level preflight, or to widen with bundle layers and the manager now following it?

Before boot, `dsh-triage audit` reports duplicate copies at different versions as `collision-duplicate-copy`, with both paths and versions ([tests/unit/duplicates.test.ts:72](https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/tests/unit/duplicates.test.ts#L72)). We have not reproduced the nested resolution path at runtime.

We did not run the test suite on that branch; the line numbers above are at `6887f331bb` and will drift. Everything here is read from the diff and published metadata, not your machine.
<!-- paste:end -->
