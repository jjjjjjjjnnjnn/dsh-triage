# HANDOFF §2 批次行归档：R116

> **逐行原文，未改一字。** 用脚本从 docs/HANDOFF.md 的表格里按行取原字节（不是重打）。
> 归档理由：入口只保留最近十轮；R126 加进来之后，R116 出界。
| **流量审计 + 知名度计划（R116，2026-11-17）** | **采证/研究轮：把「有没有人看见」变成可复算的读数，并给出不加功能的分发计划（判据/阈值一字未动）**。① **新记录器**：`scripts/record_traffic.mjs` 一次写 GitHub 14 天 views/clones/referrers/paths + 四包 31 天 npm 下载 + 两个第三方条目（`awesome-dsh-plugin` / `dsh.so`），产物 `traffic-2026-11-17T13-04-28-424Z.json`。② **读数**：仓库 **47 次浏览 / 19 唯一**，**1,416 次 clone / 327 唯一**（**30 倍于浏览**，是 CI/镜像/扫描器）；npm 31 天 **2,996**（近 7 天 1,042，发布日尖峰）；star **1** / fork 0 / watch 0；唯一第三方互动是 issue #1（外部用户 `CyrusCCSY`，真 bug）。③ **诊断**：瓶颈是「到达」不是「文案」——首屏已在 R114/R115 改好并送到 npm，但 19 个唯一访客里几乎只有 issue #1 的作者。④ **计划**（`docs/research/2026-11-17-traffic-audit.md`）：P0 tag+Release（HUMAN 签）、repo homepage、市场 `icon`、`dsh-pluginmarket/metadata`；P1 D-1 上游 Discussion + 5 条故障帖 + 一篇透明数据帖；P2 每周复跑记录器，4 周目标 **100 唯一访客 / 10 star / 3 第三方引用 / 3 外部 issue**。⑤ **不做什么**：不买 star/下载、不再 ping #140、不把 clone 说成关注、不为曝光加功能。**判据/阈值一字未动**；**995 测试 / 10 门 / 10-10** |
