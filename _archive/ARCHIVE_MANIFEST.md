# ARCHIVE_MANIFEST（只进不出）

> 规则：废弃文件只能 `git mv` 进 `_archive/` 并在此登记；禁 `rm/del`。

| 日期 | 原路径 | 归档路径 | 原因 | 引用处是否已更新 |
|---|---|---|---|---|
| 2026-10-26 | （多处状态行，非单文件） | _archive/2026-10-26_stale-status-before-R5.md | R5 统一改写 Stand 行与过期数字（7→8 门、1→4 例、M0→R5），原文留痕 | ✅ 19 个文件的 Stand 行已改；`docs/06`、`PROJECT_RULES`、`README×2`、`AGENTS`、`AI_HANDOVER` 已同步 |
| 2026-10-28 | docs/06-roadmap.md | _archive/2026-10-28_06-roadmap-merged-into-ROADMAP.md | T-110（HUMAN 签字）：双 roadmap 重叠，保留 `docs/ROADMAP.md` 为唯一执行计划，增长阶梯/分发清单/指标/风险并入其 §7 | ✅ `INDEX.md`、`docs/00-vision.md`、`docs/AI_HANDOVER.md`、`docs/market/listing_zh.md`、`AGENTS.md`、`docs/ROADMAP.md` 引用已改 |
| 2026-10-27 | data/results/gates-2026-10-27T17-30-00.000Z.json（+ `.sha256`） | _archive/2026-10-27_R17-gates-trial/ | R17 的**试录**门禁快照：当时 R17 的新产物尚未写进 `audit/step_reviews.json`，`step-review` 按设计报 `no-orphan-results` 红。它记录的是一个中间状态，不是本轮证据；正式快照在台账补齐后重录 | ✅ 未被任何台账引用（移动前确认）；SSOT 只保留最终 `gates-2026-10-27T18-00-00.000Z.json` |
