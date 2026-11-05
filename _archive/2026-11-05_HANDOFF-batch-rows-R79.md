# HANDOFF §2 · R79 批次行（逐行原文，未改一字）

> 归档理由：R90 交接时 §2 已有 10 条批次行，新增 R90 之后按 R38 起的一贯口径只留最近十轮（**R80–R90**）。
> 本文件只搬 §2 的批次行；证据指针、审核报告行、未通过门槛**未搬**（查产物的人比读历史的人多）。
> 登记处：`_archive/ARCHIVE_MANIFEST.md`。

| 项 | 状态 |
|---|---|
| 采证 + 交付（R79，2026-11-05） | **两件时间敏感的事各做一次，判断一个字没动（采证 + 交付轮）**。① **升级日换了目标**：`@deepseek-ai/dsh` 的 `next` 从 `0.2.1-rc.5` 变成 **`0.2.2-rc.1`**（`latest` 仍是 `0.2.1-rc.5`）。`watch_next_release --baseline data/results,.watch-state` 本机真跑 → `changed`（`data/results/next-release-2026-11-05T07-34-44.456Z.json`）；真机重跑卡片 `--to 0.2.2-rc.1` **14/14**（`upgrade-card-2026-11-05T07-35-01.051Z.json`）：**192 单元 → 119 会被拒 / 73 判不了 / 0 会变好 / 0 像没事**，四桶自检与边界句全过；profile 仍是仓内沙盒 `0.2.1-rc.4`（产物 `limits` 写明不是用户机器）。② **已发布包再验一次**：匿名装 `dsh-triage@0.3.4` 在临时目录跑 `--help` / 无参 `status` / `audit` / `upgrade --to next --card` **6/6**（`usability-2026-11-05T07-35-16.214Z.json`），卡片印出的目标已是 `0.2.2-rc.1`。③ **D5 窗口内第二份现场基线**：`market-baseline-2026-11-05T07-35-31.003Z.json`（`inputs.offline=false`、`failures: []`），窗口 **`10-28..11-03`**、周下载 **1564**、`steady`（6/7 天，峰值 **40.5%**）；日序列 **`0 · 634 · 192 · 17 · 192 · 357 · 172`** —— 仍是 10-29 那次的回声（`BS-48`），按冻结口径 `threshold-met` 但**不是新需求证据**，`judgeD5` 仍 `pending`。④ **覆盖与截止日**：`d5_window_status` → covered **`11-01..11-03`** / missing 12 / **`next_run_by 2026-11-12`**（`d5-window-status-2026-11-05T07-36-24.115Z.json`）；三份入口文档的日期已随产物更新（治理断言会重算）。⑤ **判据/阈值一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门；**760 测试**，`--mutate` 9/9 |
