# HANDOFF §2 批次行归档：R111

> **逐行原文，未改一字。** 用脚本从 `docs/HANDOFF.md` 的表格里按行取原字节（不是重打）。
> 归档理由：入口只保留最近十轮；R121 加进来之后，R111 出界。

| **容器根的 `.agents/` 不该在这里（R111，2026-11-14）** | **交付轮：把两份 2026-11-12 的 packet 搬进它们真正的归属，并把每条断言对回仓内证据（判据/阈值一字未动）**。① **归属**：容器根有个没人认领的 `.agents/`，里面两张由 Personal Hub 派发的 packet，两张都是关于 `dsh-triage` 的；而 `.agents/tasks/` 本来就是本仓的投递入口（`.agents/README.md` §3.5），容器根的规则里从来没有 `.agents`。② **搬法**：正文一字未改，只把知识库路径的账号段换成 `<home>\`（P-0028）；`verify-committed-packets.mjs` 用「还原 + LF→CRLF」把仓里这份对回源文件并比 sha256（`equals_redacted_original_with_lf: true`），`-8 B` 与 25 处 CRLF 归一都有账；未脱敏原件留在容器 gitignored 的 `.tmp/`。③ **TSK-013 的断言核对**：`render controls` 确实是 `0b1bf5c` 上唯一红的 job，另外三个绿；但 packet 让对账的 `scripts/gate_render.mjs` **不存在** —— 真入口是 `ci.yml` 的 `render-control:` job 调 `record_render_fixture.mjs`。产物给出 R90 没有的名字：`DevTools listening on ws://…` 与 `readyState: loading` 同时存在，所以「只在端口未开时重试」那条候选覆盖不到它。④ **TSK-009 的断言核对**：packet 引的 `:1128` / `:1144` / `:1118` / `:1135` 在 `app.asar` 里逐行对得上，但包路径是旧的 monorepo 布局；它要的「二分排查」已经挂号为 **`T-114 triage bisect`**（⬜ 未领取），本仓不做功能轮，只记录。⑤ **没有产物**：上面每条都是别人的流水线读数或本机只读复核，写进 `data/results/` 会立刻过期；run id 与时间戳都在 `.agents/tasks/RESULTS-2026-11-14.md`。 |
