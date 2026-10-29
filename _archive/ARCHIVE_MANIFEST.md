# ARCHIVE_MANIFEST（只进不出）

> 规则：废弃文件只能 `git mv` 进 `_archive/` 并在此登记；禁 `rm/del`。

| 日期 | 原路径 | 归档路径 | 原因 | 引用处是否已更新 |
|---|---|---|---|---|
| 2026-10-26 | （多处状态行，非单文件） | _archive/2026-10-26_stale-status-before-R5.md | R5 统一改写 Stand 行与过期数字（7→8 门、1→4 例、M0→R5），原文留痕 | ✅ 19 个文件的 Stand 行已改；`docs/06`、`PROJECT_RULES`、`README×2`、`AGENTS`、`AI_HANDOVER` 已同步 |
| 2026-10-28 | docs/06-roadmap.md | _archive/2026-10-28_06-roadmap-merged-into-ROADMAP.md | T-110（HUMAN 签字）：双 roadmap 重叠，保留 `docs/ROADMAP.md` 为唯一执行计划，增长阶梯/分发清单/指标/风险并入其 §7 | ✅ `INDEX.md`、`docs/00-vision.md`、`docs/AI_HANDOVER.md`、`docs/market/listing_zh.md`、`AGENTS.md`、`docs/ROADMAP.md` 引用已改 |
| 2026-10-27 | data/results/probe-matrix-2026-10-27T20-00-00.000Z.json（+ `.sha256`） | _archive/2026-10-27_R18-matrix-superseded/ | R18 的第一版扩展矩阵（n=16：10 真实 + 3 夹具 + 3 合成），缺「装上但零行」这一种失败形状；补 `no-row-plugin` 后用同一命令重跑为 n=17（`probe-matrix-2026-10-27T20-30-00.000Z.json`）。旧批次不删，移入归档留痕 | ✅ 未被任何台账引用（移动前确认）；D2 报告指向 n=17 那份 |
| 2026-10-27 | data/results/gates-2026-10-27T17-30-00.000Z.json（+ `.sha256`） | _archive/2026-10-27_R17-gates-trial/ | R17 的**试录**门禁快照：当时 R17 的新产物尚未写进 `audit/step_reviews.json`，`step-review` 按设计报 `no-orphan-results` 红。它记录的是一个中间状态，不是本轮证据；正式快照在台账补齐后重录 | ✅ 未被任何台账引用（移动前确认）；SSOT 只保留最终 `gates-2026-10-27T18-00-00.000Z.json` |
| 2026-10-29 | docs/HANDOFF.md（§2 中 R14–R28 的 17 行批次行，逐行原文） | _archive/2026-10-29_HANDOFF-batch-rows-R14-R28.md | R38 整理：§2 批次表已有 25 行，新接手的人要翻过十几轮历史才看到当前批次；入口文档只保留最近十轮 + 常设行 + 证据指针 | 是：docs/HANDOFF.md §2 顶部有指针行；证据指针（R15–R29）与审核报告行**未搬**（查产物的人比读历史的人多） |
| 2026-10-29 | docs/HANDOFF.md（§2 中 R29–R36 的 8 行批次行，逐行原文） | _archive/2026-10-29_HANDOFF-batch-rows-R29-R36.md | R47 整理：第 46 轮后 §2 又长回 21 行；同 R38 口径，入口只留最近十轮（R37–R47）+ 常设行 + 证据指针 | 是：docs/HANDOFF.md §2 留指针行；证据指针（R15–R45）、审核报告行、未通过门槛行**未搬** |
| 2026-10-29 | docs/HANDOFF.md（§2 中 R37–R38 的 2 行批次行，逐行原文） | _archive/2026-10-29_HANDOFF-batch-rows-R37-R38.md | R48 交接：入口只保留最近十轮（**R39–R48**），与前两次归档同一口径 | 是：docs/HANDOFF.md §2 留指针行；证据指针与审核报告行**未搬** |
| 2026-10-29 | docs/BACKLOG.md（「R3–R16 已交付」共 11 节、约 170 行，逐行原文） | _archive/2026-10-29_BACKLOG-delivered-R3-R16.md | R48 整理：BACKLOG 是**可领取清单**，但后半段是历史交付记录（257 行里 170 行是历史），读清单要先翻过一年历史 | 是：BACKLOG 原位置留「历史交付记录（R3–R16）」指针；任务行（T-1xx…T-8xx）全部留在清单里 |
