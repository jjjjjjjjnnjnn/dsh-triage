# HANDOFF §2 批次行归档：R115

> **逐行原文，未改一字。** 用脚本从 docs/HANDOFF.md 的表格里按行取原字节（不是重打）。
> 归档理由：入口只保留最近十轮；R125 加进来之后，R115 出界。
| **0.3.11 发布：只改文档与文案（R115，2026-11-17）** | **发布轮：让 npm 页面与市场详情页带上 R114 的新首屏，源码一个字节不改（判据/阈值一字未动）**。① **四包同升 `0.3.11`**，CHANGELOG 首句 `Documentation and copy only`；`packages/*/src` 未改，所以运行时行为与 0.3.10 相同。② **为什么必须发**：`packages/plugin/README.md` 是 `npm view dsh-triage readme` 渲染的那一页，而 0.3.10 的 tarball 里仍是旧首屏 —— 仓内改了、用户看不到。③ **预检**：`release_preflight` 四项（`npm user` / `version 0.3.11` / `workspace 5 dep(s)` / `registry 还没发过`）。④ **发布取证**：`record_publish` 四包 `latest=0.3.11` + `anonymous-install` + `client-bundle`；紧跟发布的第一份若因副本滞后出现 `version:` / `dist-tags-agree` 两条红，**红产物保留**，几分钟后重跑 18/18。⑤ **发版后读数**：`usability-*.json`（0.3.11 四条命令）+ `npm view dsh-triage readme` 与 `packages/plugin/README.md` 逐字节相同。**判据/阈值一字未动**；**995 测试 / 10 门 / 10-10** |
