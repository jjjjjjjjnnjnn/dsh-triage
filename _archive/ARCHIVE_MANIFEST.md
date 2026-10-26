# ARCHIVE_MANIFEST（只进不出）

> 规则：废弃文件只能 `git mv` 进 `_archive/` 并在此登记；禁 `rm/del`。

| 日期 | 原路径 | 归档路径 | 原因 | 引用处是否已更新 |
|---|---|---|---|---|
| 2026-10-26 | （多处状态行，非单文件） | _archive/2026-10-26_stale-status-before-R5.md | R5 统一改写 Stand 行与过期数字（7→8 门、1→4 例、M0→R5），原文留痕 | ✅ 19 个文件的 Stand 行已改；`docs/06`、`PROJECT_RULES`、`README×2`、`AGENTS`、`AI_HANDOVER` 已同步 |
