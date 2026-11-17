# HANDOFF §2 批次行归档：R101

> **逐行原文，未改一字。** 用脚本从 `docs/HANDOFF.md` 的表格里按行取原字节（不是重打）。
> 归档理由：入口只保留最近十轮；R114 加进来之后，R101 出界。

| **桌面设置页 8 条假「兼容异常」+ 一屏说人话（R101，2026-11-12）** | **判据轮：CLI 把 pnpm 共享缓存（0.1.0-rc.6）当成运行时，而 Host 跑的是 app.asar 里的 0.2.2-rc.1；改为读内核归档，并把一屏的「可动手项」与「判不了」分开（判据/阈值一字未动）**。① **误报的可复算证据**：8 条 blocked 的 `reasons[].params.range` 换成 `evaluateRange(…, 0.2.2-rc.1)` → **8/8 satisfied**（`audit/RECON_2026-11-12_desktop-misreport.md` §3）。② **R91 的结论被实测推翻**：普通 `node:fs` 读 asar **可以**（挂载路径不可以）—— 213 MB 文件 → 目录 JSON → `dsh@0.2.2-rc.1` + 329 个内核包（RECON §2）。③ **`M14-kernel-asar.md`**：C1–C7 + N1–N8；**半修有数**：只换版本 125 条假 blocked、只换 manifest 8 条原样（RECON §4）。④ **落地**：`asar.ts` + `kernel-probe.ts` + `env.ts`；`resolveRows` 只做加法；内核 scope 里 asar 没有的包 → `admission.row-unverifiable`（不再说「未安装」）。⑤ **M15 一屏**：`actionable` / `unjudged` 分开；`denied=0` 时**不得出现「异常」**；文案「0 项需要你处理；另有 N 项没写版本区间，那不代表不兼容」。⑥ **真机**：`0.1.0-rc.6 (inferred)` → **`0.2.2-rc.1 (kernel-asar)`**；**8 → 0 blocked**、20 → 55 judged、一屏 **9 → 1 项异常**（剩下的是 `llm-deepseek` 同名，真事）。⑦ **`BS-67` / `BS-68`** 已登记（只在桌面壳+默认 home 实测；「0 项」不等于「一切正常」）。**954 测试 / 9 门 / 9-9** |
