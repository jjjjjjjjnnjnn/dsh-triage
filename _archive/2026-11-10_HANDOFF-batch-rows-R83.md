# HANDOFF §2 · 归档的批次行（R83）

> 归档口径：入口文档只保留最近十轮（**R84–R93**）。本文件是逐行原文，不是摘要——
> 任何一行都可以用 `git show <commit>:docs/HANDOFF.md` 逐字节比对。
> 证据指针、审核报告行、未通过门槛**没有搬**（查产物的人比读历史的人多）。

| 项 | 状态 |
|---|---|
| 外部更正 + 规则收窄（R83，2026-11-05） | **作者指出我们上一轮的读数取自「下架之后」，接受更正，并把这条做成规则（采证 + 交付轮；判据/阈值一字未动）**。① **更正内容**：`#12209` 作者 `xinspark` 回帖（`discussioncomment-19415133`）指出 `0.12.3` 提示消失是作者**下架**（他列为 workaround），所以我们的探测（`latest=0.2.6` / `0.2.6 admitted` / `0.12.3 unreadable`）**按构造分不出**「比较逻辑对」与「没东西可比较」。数字没错，**推论越界**。② **规则化**：`docs/copy/README.md` §5 新增第 6 条红线「**缓解之后的读数不能当机制证据**」；`docs/copy/outreach.json` 的 `reply_received.correction` 记原文。③ **补四条代码层事实**（0.2.2-rc.1，tarball 只下到 `%TEMP%`、未进仓库）：`newerVersions()` 只做 `semver.valid` + `semver.gt` 再 `rcompare`，`time`/`dist-tags` **只挂成 `publishedAt` / `tags`**；`update()` 自己也要求 `semver.gt(version, from)`（只改列表不改这里，显式选版本路径仍是同一个坑）；客户端 `updateCandidate()` 取降序列表第一个可安装项；**`latest`-only 有反例**：60 个抽样包里 **22 个**的 `latest` 低于最高已发布版本。④ **新采证器** `scripts/record_update_trap.mjs`：按「最高 semver 候选的发布时间 vs 已装发布时间」判方向，两份产物 `update-trap-2026-11-05T10-40-00-000Z.json`（4 个包 `traps 0/4`，`dsh-win-pwsh7@0.2.6` → `no-newer`）与 `…T10-46-00-000Z.json`（搜 `dsh` 前 60 个包 `traps 0/60`，`no-newer` 38 / `no-trap` 22）；**如实说：抽样里没找到活的陷阱实例**。⑤ **回复已发**（`discussioncomment-19416157`，10:22:40Z，一条、不催；文案 `agy` 写、数字工程侧核对）：接受更正 + 四条事实 + 更窄规则（`semver.gt` **且** `time[c] > time[installed]`）+ 0 例如实说。⑥ **新 spec** `docs/specs/M9-downgrade-trap.md`（`T-861`，C1–C7 / N1–N6，判据先行、**未实现**；只出证据、不改 conclusion）。**冻结项一字未动**：D5 三个阈值 / 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
