# HANDOFF · 交接入口
| T-313 凭据来源审计（BS-29） | verifier | 逐个来源（~/.pnpmrc / PNPM_HOME / 系统级 npmrc / corepack / 代理变量）做黑盒对照，只有全部关闭后才敢说「沙盒无凭据」；口径同步 docs/adr/0004 |

> **Stand**: R28 (2026-10-29，交接)｜当前批次：**R28 · T-312 两阶段取样已实施（预算改判「第一份样本」）；`ADR-0009` 结论 A（不破铁律 4）**｜**本轮只交接，不改行为**
> 任何人（人或 agent）接手，**只读本文件 + `PROJECT_RULES.md` + `INDEX.md` 三份**即可开工。

---

## 1. 五分钟检查（禁跳过）

```powershell
git status --short                  # 必须干净；有未提交改动先问来源
git log --oneline -3
pnpm install --frozen-lockfile
pnpm run verify                     # build → typecheck → test → gate，必须全绿
node scripts/gate.mjs --mutate      # 必须输出 NEGATIVE CONTROL PASSED · 9/9
```

基线不绿 → **先修基线，不叠加新功能**。

---

## 2. 当前批次

| 项 | 状态 |
|---|---|
| 交接（R28，2026-10-29） | **本轮只交接，不改行为**：`git log -1` 就是本提交、`git status` 干净；**274 测试 / 9 门 / `--mutate` 9-9**；132 份产物全部被 147 步台账引用。**冻结项**：`--unsettled-timeout 20000`、hook `settle 15s`、readiness 5s、`boot→sample ≤20s`（现在判第一份样本）、`isUsableSample()`/`judgeProbe()`。**下一位的第一件事**：按 §3 的「D2 重跑」两条命令，用**新口径**重跑矩阵（R27 的红作废、也还没被替代）。**两条待签**：`ADR-0008` §剩余项（A′ / C 已勾、B 未签）+ `ADR-0009`（结论 A、B 未签） |
| 产品名 | **dsh-triage**（品牌：分诊台 / Triage） |
| 里程碑 | **M0 ✅** · **M1 金标对等 ✅（27 条）** · **M1 真实案例验收 ✅（D1：9/10）** · **M2-a P1+P2 ✅** · **M2-b 事实+差分 ✅（`BS-21`/`BS-22`）** · **M3 probe 执行器 ✅（R14）** · **M3 判据补全 ✅（R15 白屏/就绪 + R16 跨平台 + R17 慢≠坏/端口）** · **D2 通过（R18 首判 / R19 复算，真实 13）** · **M4 形态 A ✅（`serve` v1：只读面板 + `--audit` 当前组合，R19）** · **M3 真实组合复制 ✅（T-304，R22）** · **M3 不可判等待收敛 ✅（`ADR-0008` E，R26）**；`namespace-diff`（T-303）仍缺（需 T-202a） |
| 仓库 | `https://github.com/jjjjjjjjnnjnn/dsh-triage`（**private**，`main`） |
| CI | **6 job**：`verify (node 22)` · `verify (node 24)` · `verify (windows, node 24)` · `render controls (ubuntu, real browser)` · `gates can fail`（负对照 9/9）· `release readiness`（tag 触发） |
| 规模 | **274 测试** · **9 门禁** · 6 角色卡 · 3+1 模板 · **10 个真实案例（9 命中 / 1 显式 unknown）** · **27 条金标** · **132 份 SSOT 产物** · **147 步台账** · **13 个真实插件候选（12 go / 1 装不上）** + **4 种组合复制形状（1 go / 3 unknown）** + **R26/R27/R28 的收窄与两阶段回归产物** |
| 硬规则 | **每一步做完必须四轴审核 + 真跑落产物**，写入 `audit/step_reviews.json`（R26 起 **135 步**），由门 `step-review` 重算 sha256；授权/签署单独记在 `audit/SIGNOFF.md` |
| 本轮交付（R28） | **T-312 两阶段取样（HUMAN 立项）**：hook 在第一次读到树时先写 `provisional: true`/`settled: false` 的样本，settle 结束后覆盖成最终样本；执行器**用第一份判 20s 预算**、用最终样本判结论（窗口 = 样本自报的 `settle_timeout_ms` + 1s）。真机：`slow-plugin` 第一份 **5.4s** / 最终 10.7s / **仍 `go`**；`slow-overrun` 第一份 9.4s / 最终 24.5s / 仍 `unknown`；真实候选 `dsh-mcp-connector@0.2.83` 第一份 10.1s / 最终 25.2s / `unknown`（今天两次都没在 15s 内稳定）。**代价**：不可判墙钟 ≈28.6s → ≈30.4s——我们没让 probe 更快，而是把「多快拿到答案」与「答案有多细」拆成两个数字。产物新增 `inventory.provisional/upgraded/upgrade_waited_ms` 与 `timings.bootToFinalSampleMs`。**E 与 `{error}` 的语义未变**（各自回归仍过）。**ADR-0009 自评结论 A**：为一个补证断言引入读凭据路径不划算，`T-303`/`T-202a` 收束为「当前不做」，退出条件改成 HUMAN 勾 B。**剩余**：D2 必须按新口径重跑矩阵 |
| 上一轮交付（R26） | **实施 `ADR-0008` 方案 E（已授权项，不改任何阈值）**：`host.ts` 样本循环只在样本**不可读**（`{error}`）时开替换窗口，`settled:false` 立即收敛；新增纯函数 `isReadableSample()`（`isUsableSample()` **一字未动**）；产物新增 `inventory.replacement_waited / _waited_ms / _observed / _samples / _policy / _stopped_by`；`probe.tree-not-settled` 的 detail 写明「没有再等替换样本（ADR-0008 E）」。**真机三轮**：不可判夹具 `boot` 步 **48.4s（R23）→ 28.6s（R26）**（`replacement_waited=false`、`waited_ms=0`）、慢夹具仍 `go`（`boot` 步 25.4s）、真实候选 `dsh-status-rotator@0.38.0` 仍 `go`（`boot→sample` 11.5s）。**三条回归**：`slow-overrun` 仍 `unknown` + `missing.inventory`；`slow-plugin` 仍 `go`；`{error}` 仍等满窗口且能采用替换样本（`tests/unit/probe-host-sample.test.ts`，4 条，假 launcher 驱动真实循环）。`d2_report` 用现有矩阵复算仍 `gate.passed=true`。**默认值/判据未动**：`--unsettled-timeout 20000` / `settle 15s` / readiness 5s / `boot→sample ≤20s`。新盲区 `BS-32`（墙钟 21.7–28.6s 是区间不是常数）、新任务 `T-316`（真 hook 的 `{error}` 夹具）。**同轮续做**：① **T-316 真机完成** —— 新增诊断开关 `--hook-config`（`record_probe` + `realProbeDeps.hookConfig`，产物记 `sandbox.hook_config`），把 hook 的 `resolveFrom` 指向没有 projection 包的 profile → 真实 hook 写出 `{error}/projection-missing`，执行器 `replacement_waited=true`/`waited_ms=5203`（窗口 5000）→ 与 `settled:false` 的 0ms 形成正反对照；另有 `tests/unit/probe-hook-error.test.ts` 跑**真实 hook 文件**钉死 `inactive-context`/`projection-missing` 两个 code。② **T-315 补测 `nodeLinker`** —— 复制源写 `nodeLinker: hoisted` 真跑 → `go`、行 `active`、`candidate_registered=true`（不打断行识别；但产物不记布局）。③ **T-309 post-E 矩阵重测** + `d2_report` 重算。④ **T-311 剩余写成可签的题**：`ADR-0008` 新增「把不可判压进 20s」三案（A′ settle 15s→10s / A″→8s / C 两阶段），并测出 13 个真实候选的 hook `wait_ms` 最大值 **7686ms**（所以 A′ 在本批不会误伤）。⑤ **T-303/T-202a 出 ADR**：`docs/adr/0009-agent-scope-reads.md`（proposed，三案 + B 案 6 条可机器检查边界）——**等 HUMAN 勾选才开工**。⑥ **T-401 只读契约 spike**：把上游 0.2.1-rc.4 的真实 client 契约钉到行号（`settings.plugins.tab` / `ctx.slots.register` / props 由 `inject` 提供 / `remote.pluginInventory.list()`），**未写 `client.js`** |
| 上一轮交付（R25） | **只交接，不改行为**：HUMAN 已授权 `ADR-0008` 方案 **E**（原话「同意。先进行项目交接，即将切换会话」）→ 记入 `audit/SIGNOFF.md`；ADR 状态改为**已授权、未实施**，并写下 `实施清单`（5 条）与 **3 条缺一即回滚的回归**。**代码一行未写、默认值一行未改**：`--unsettled-timeout 20000` / `settle 15s` / readiness 5s / `boot→sample ≤20s` 全部原样 |
| 上一轮交付（R24） | **把「不可判 ≈48s」变成一道可签字的题**（`ADR-0008`，当时 proposed）：`boot` 分段显示主导项是**替换等待 20.3s**；`scripts/report_replacement_window.mjs` 扫 29 份有相位块的产物，**4 次不可判样本的 `attempts`/`applies` 全为 1 → 替换从未出现过**；同一夹具把窗口从 20s 降到 5s / 1s 真跑，结论**仍是 `unknown`**，`boot` 步 48.4s → 33.9s → 26.2s（`measured_saving_ms = 19092`）。A（降默认窗口）/B（维持）/C（两阶段 T-312）/E（只对 `{error}` 保留等待）四案并列，最终 HUMAN 选 E |
| 上一轮交付（R23） | **① T-314 `boot` 步分段计时**（`timings.bootSegments` 10 段）：**R21 的两个墙钟数字都错了**。正常候选 15.7–16.2s = sample 6.3 + settle 1.0 + readiness 0.04 + **render 4.7** + **杀树 2.2–2.7** + 杀后 1.2；不可判 **48.4s** = sample 19.1 + **替换等待 20.3** + settle 1.0 + render 4.5 + 杀树 2.2 + 杀后 1.2 —— 主导项是「为一份可判样本再等一整个替换窗口」，**不是** settle（`wait_ms 16.1s` 已含在 sample 里）。对外口径改为**可判 ≈16s / 不可判 ≈48s**，ADR-0006 与 spec §4 已同步；`d2_report.timing.boot_breakdown` 给各段最大值。**② T-315 `ADR-0007`**：沙盒构建审批口径（只把错误降为提示、不批准任何构建、源 workspace 不覆盖、install 必须读回 `dsh.profile.bundles`），`docs/adr/0004` 与 `SIGNOFF` 同步。**③ T-313 凭据来源审计**：探测器换成**本地假 registry 记 `authorization` 头**（pnpm 日志会假阴性——合成 token 不打印那行），六类来源 × `404`/`401` = 10 组 + 对照组，全部离线。结论：**只有 user config 会被读**，且它在两种应答下都不再上网（0/2）；`globalconfig` / `$XDG_CONFIG_HOME/pnpm/rc` / `PNPM_HOME` / `COREPACK_HOME` 的旋钮在 launcher 路径下**未被读**。`BS-29` 由 open 改为 **narrowed**。**阈值一律未动** |
| 上一轮交付（R22） | **T-304 `--copy-profile` 落地**：复制四个声明文件（不搬 `node_modules` / `.plugin-manager` / `.npmrc`）→ 装副本依赖 → 装候选 → boot。**三形状真机产物**：`copy:upstream`+夹具 = **go**（boot→sample 7.4s / 401 / 渲染 2182ms / 行 `active` / `candidate_registered=true`）· 副本装不上 = **unknown**（`ERR_PNPM_FETCH_404` + `probe.profile-copy-unusable`，只有 runtime/profile/cleanup 三步）· 悬空 `link:` = **unknown**（install **exit 0** 也抓到，`probe.profile-link-dangling`）。**两个新事实**：F41 复制真实组合时 `plugin install` 因 pnpm **构建审批**退出 1（被拒的是组合自己的 5 个原生包，不是候选）；F42 `plugin add` 在 pnpm 非 0 退出时**只写 dependencies、不写 `dsh.profile.bundles`** → 「继续 boot」会得到 `row-missing`（把包管理器策略算成插件缺陷）。**解法（F43）**：沙盒 `pnpm-workspace.yaml` 写 `strictDepBuilds: false` → 同一操作 exit 0 且**真正注册 bundle**，而**不批准任何构建**（`.npmrc` 同名设置无效，已对照）。新文案 `probe.profile-copy-unusable` / `probe.profile-link-dangling` / `probe.profile-build-refused`；新盲区 `BS-30`（沙盒不构建原生模块）/ `BS-31`（只搬声明：链接与私有源只能 unknown）；新任务 `T-315`（该口径要 ADR）。**阈值与既有判据一字未动** |
| 上一轮交付（R21） | **① `ADR-0006` 按第 1–3 条采纳**（HUMAN「同意，继续」）：「20s」= **测量预算**（`spawn→sample`），不是墙钟承诺；`d2_report` 新增 `timing.wall_clock`（只记录、不设判据），`record_probe` 的 `limits[]` 写明「不可判的树 ≈ 25s」——**② 同日实测把 ② 证伪了**：`wall_clock.max_ms = 42701`，正常 `go` 候选的 `boot` 步 **22.1–25.3s**、永不 settle **42.7s**（而 `boot→sample` 只有 9.6–12.2s）。差额构成**未解释** → 新开 T-314；`settle 15s` / 窗口 `20000` / 所有判据**一字未动**（方案 A/C 未授权） |
| 上一轮交付（R20） | **① 安全：沙盒不再继承 npm 凭据**。`scrubbedEnv` 只清环境变量，挡不住 pnpm 读 `~/.npmrc`——实测同一条装不上的候选，默认环境 2/2 打印 `An authorization header was used: Bearer npm_[hidden]`，把操作者 token 发给 registry；现由 `sandboxNpmEnv()` 把 `npm_config_userconfig` 指向沙盒内空文件，2/2 消失，产物新增 `install.registry_auth_used`（真机 `false`）。**② 可观测**：`/api/audit` 响应头 `x-triage-audit-ms` 自带耗时（本机真实 profile 376–690ms，同步扫描期间阻塞面板）。**③ `ADR-0006`（R21 已按第 1–3 条采纳）**：20s 是测量预算，不是墙钟承诺。**同日实测纠正**：`boot` 步墙钟 = 正常候选 22.1–25.3s、永不 settle 42.7s（`boot→sample` 只有 9.6–12.2s）；差额构成未解释 → T-314。阈值一律未动（settle 15s / 窗口 20s 原样）。**④ T-304 前置取证 F38–F40**：声明文件复制即可启动 / 带依赖需先 `plugin install` / **`link:` 依赖假成功**（exit 0 但目标不存在）。**阈值一律未动** |
| 上一轮交付（R19） | **① T-310 安装失败归因**：`installDiagnosis`（launcher 优先 / 诊断日志兜底 / `dsh:` 行不算原因 / URL 去凭据与查询串）→ 产物 `install.diagnosis{code,key_line,source}`；新增 `probe.install-failed-code` 与 `probe.install-build-refused`。真机：`@aiwayds/dsh-cron@0.6.1` = `ERR_PNPM_IGNORED_BUILDS` + `Ignored build scripts: …`。**② T-406 面板 v1**：`audit-data.ts` 抽出 `loadAuditData()`，`serve --audit` 只读路由（默认 501、读不到 409）；抽取前后 `audit --json` 逐字节一致。**③ D2 分母 10→13**：真实 12 `go` / 1 `blocked`（0.923，Wilson 0.667–0.986），可靠性 20/20、形状 6。**④ 预算口径（HUMAN 签）**：`boot-budget` 只判真实候选，夹具 21.3s 单列；`BS-28` / `T-311` 新开 |
| 上一轮交付（R18） | **① D2 判定**：`scripts/d2_report.mjs` 把矩阵产物算成可重算报告（可靠性 / 真实通过率 + Wilson 95% / 失败形状 / 计时 / 清理），**分母不足时拒绝判定**；`data/results/d2-2026-10-27T21-00-00.000Z.json` = **通过**（可靠性 17/17、真实启动 10、失败形状 5、boot 6.2–19.1s、清理 17/17；真实通过率 9/10，Wilson 0.596–0.982）。**② 10 个真实 pin 候选**（status / theme×2 / tool / scheduler / notify / workspace / mcp / remote / git）：9 个 `go`，`@aiwayds/dsh-cron@0.6.1` **装不上**（→ `T-310`）。**③ `BS-26` 真机补测**：`slow-overrun-plugin`（顶层 await 20s）→ `unknown` + `missing.inventory`。**④ R17 纠错**：R17 的「慢」夹具把延迟写在 `apply` 里，实测**不会**让行停在 `loading` → 改成顶层 await 并重采。**⑤ 新夹具** `no-row-plugin`（第 5 种失败形状：装上但零行） |
| 上一轮交付（R17） | **① 端口自伤缺陷**：`buildProbePlan` 的哈希端口 **53506** 落在本机 Windows 排除段（`netsh`：TCP 53461–53560，且**会话中会变**），沙盒 `webserver` 行 `listen EACCES` → 整棵树 `startup failed`，**正常候选被写成 `blocked`**。改为每次 `findFreePort()` 向 OS 申请，产物记 `sandbox.port_origin`。**② 判定分离**：`valid/unsettled/unreadable` —— 只有 `valid` 能出 `blocked`；候选行 `pending/loading` 不再当死行；`probe.tree-not-settled`。**③ 就绪**：URL 与端口同轮询，`readiness` 记 `outcome/waited_ms/window_ms/url_seen`；settled 树 **5s 阈值未改**，unsettled 树 20s 窗口**只能出 unknown**。**④ hook**：`settled/attempts/applies` + 代际保护（旧 task 不许覆盖新样本）。**⑤ 归因**：`startup failed` 照抄 launcher 原文（`probe.startup-failed`）并提前收敛（126s → ~6s）。**⑥ 新夹具**：`tests/fixtures/probe/slow-plugin`（延迟 6s）真机 `go`。**⑦ D2 分母重测**：矩阵 n=7，`real_starts=2`（两次都 `go`），清理 7/7 |
| 上一轮交付（R16） | **① 口径纠正**：R14/R15 写的「Linux CI 没浏览器」是错的（ubuntu runner 自带 Chrome 155 / Chromium / Edge + xvfb）→ `ADR-0005`。**② CI `render-control`**：先断言 runner 真有浏览器（缺了明确失败），再跑 blank/rendered/error 三份对照，产物写 `$RUNNER_TEMP`。**③ `dsh-triage serve` v0**：零依赖只读证据面板（`packages/plugin/src/serve.ts`），只绑 127.0.0.1、一次性 token + HttpOnly cookie、跨源 403、artifact 名字白名单、`POST` 默认 403（`--allow-execute` 也只回 501）。**④ T-305b**：`--npmrc-registry` 用 profile 级 `.npmrc` 让源真不可达，产物 `install.endpoints` **点名源**（去凭据/查询串）。**⑤ D2 分母工具**：`scripts/record_probe_matrix.mjs` + `tests/fixtures/probe/matrix-r16.json`，首跑 n=6。**⑥ 新盲区**：`BS-25`/`T-308`（慢候选与坏候选同形） |
| 证据（R27） | `data/results/probe-matrix-2026-10-29T01-00-00.000Z.json`（post-E 批次 n=20 / 真实 13 / 清理 20-20 / 形状 6 / `expectation_misses=0`；`boot_to_sample` 10.0–22.5s，14/16 在 20s 内）· `d2-2026-10-29T01-30-00.000Z.json`（**`gate.passed=false`**：只有 `boot-budget` 红，11/12）· `probe-t309-mcp-isolated-a-2026-10-29T02-30-00.000Z.json`（同候选隔离复测 `boot→sample` 16.0s / `wait_ms` 10.6s）· `probe-t309-mcp-isolated-b-2026-10-29T02-40-00.000Z.json`（23.8s / 18.0s）· `probe-adr0008e-hook-error-2026-10-29T00-10-00.000Z.json`（真 hook `{error}`：`projection-missing`，`replacement_waited=true`、`waited_ms=5203`）· `probe-t315-node-linker-2026-10-29T00-40-00.000Z.json`（`nodeLinker: hoisted` 复制源 → `go`） |
| 证据（R26） | `data/results/probe-adr0008e-overrun-2026-10-28T22-30-00.000Z.json`（同一个不可判夹具：`boot` 步 **28.6s**、`replacement_waited=false`、`waited_ms=0`、`samples=1`、结论仍 `unknown` + `missing.inventory`；R23 同夹具 48.4s）· `probe-adr0008e-slow-2026-10-28T22-40-00.000Z.json`（导入 6s → 仍 `go`，`boot` 步 25.4s，行 `active`，渲染 5370ms）· `probe-adr0008e-real-2026-10-28T22-50-00.000Z.json`（真实候选 `dsh-status-rotator@0.38.0` → `go`，`boot→sample` 11.5s、`boot` 步 21.7s）· `d2-2026-10-28T23-00-00.000Z.json`（现有矩阵复算：`gate.passed=true`、`reliability 20/20`、`boot-budget` 12/12 真实候选） |
| 证据（R24） | `data/results/probe-settle-window-1s-2026-10-28T21-00-00.000Z.json`（`--unsettled-timeout 1000` → boot 26247ms，替换等待 1184ms，仍 unknown）· `probe-settle-window-5s-2026-10-28T21-10-00.000Z.json`（5000 → boot 33882ms，替换等待 5302ms，render 4671ms，仍 unknown）· `replacement-window-2026-10-28T21-30-00.000Z.json`（29 份产物：not-usable 4 / **replacements 0** / `measured_saving_ms=19092`） |
| 证据（R23） | `data/results/probe-boot-segments-template-2026-10-28T17-00-00.000Z.json`（go，boot 步 15741ms 逐段）· `probe-boot-segments-overrun-2026-10-28T17-10-00.000Z.json`（unknown，48384ms：sample 19128 + **替换等待 20276** + render 4502 + kill 2203）· `probe-boot-segments-copy-2026-10-28T17-20-00.000Z.json`（复制模式：profile 15336ms 与 boot 16217ms 分列）· `credential-sources-2026-10-28T19-00-00.000Z.json`（10 组审计：`live_and_leaking=[]`、`user-npmrc` 两种应答都 `neutralised`、其余四种 knob 未被读） |
| 证据（R22） | `data/results/probe-copy-profile-ok-2026-10-28T14-30-00.000Z.json`（`copy:upstream` → **go**：boot→sample 7.4s / 401 / 渲染 2182ms / 行 `active` / `candidate_registered=true` / `ignored_packages` 5 个 / `pnpm_policy=sandbox`）· `probe-copy-profile-unusable-2026-10-28T14-40-00.000Z.json`（`ERR_PNPM_FETCH_404` → **unknown**，三步：runtime/profile/cleanup）· `probe-copy-profile-dangling-2026-10-28T14-50-00.000Z.json`（install **exit 0** + `dangling_links` → **unknown**）· `probe-copy-profile-strict-2026-10-28T15-00-00.000Z.json`（源自带严格 workspace → `pnpm_policy=source` / `candidate_registered=false` → **unknown**，boot 三项 `unmeasured`） |
| 证据（R19） | `data/results/probe-real-dsh-cron-2026-10-28T09-30-00.000Z.json`（`ERR_PNPM_IGNORED_BUILDS` + `Ignored build scripts: …`）· `serve-smoke-2026-10-28T10-20-00.000Z.json`（13/13，含 `/api/audit` 与 CLI 逐条一致）· `probe-matrix-2026-10-28T11-40-00.000Z.json`（n=20 / 真实 13 / 形状 6 / 清理 20-20）· `d2-2026-10-28T12-10-00.000Z.json`（`gate.passed=true`）· `gates-2026-10-28T13-00-00.000Z.json` |
| 证据（R18） | `data/results/d2-2026-10-27T21-00-00.000Z.json`（D2 判定，`gate.passed=true`）· `probe-matrix-2026-10-27T20-30-00.000Z.json`（n=17 / 真实 10 / 失败形状 5 / 清理 17-17）· `probe-slow-normal-v2-2026-10-27T19-10-00.000Z.json`（导入慢 6s = go，`wait_ms` 7.3s）· `probe-slow-overrun-2026-10-27T19-20-00.000Z.json`（导入慢 20s = unknown，`settled:false`）· `probe-matrix-2026-10-27T19-30-00.000Z.json`（首个真实候选批次） |
| 证据（R17） | `probe-registry-whale-2026-10-27T17-05-00.000Z.json`（**R16 同一候选是 blocked → 现在 go**，boot 6.8s，`port_origin=allocated`）· `probe-slow-normal-2026-10-27T17-00-00.000Z.json`（慢但正常 = go，`settled=true`，`waited_ms=32`）· `probe-red-apply-fail-2026-10-27T17-10-00.000Z.json` / `probe-red-import-fail-2026-10-27T17-15-00.000Z.json`（负对照仍 blocked）· `probe-matrix-2026-10-27T17-20-00.000Z.json`（n=7 / real 2 全 go / cleanup 7-7 / boot 6.2–6.9s）· `gates-2026-10-27T18-00-00.000Z.json` |
| 证据（R16） | `serve-smoke-2026-10-27T14-16-05/07.000Z.json`（面板 8/8，含隐私修复前后）· `probe-registry-private-2026-10-27T14-33-57.000Z.json`（blocked，endpoints=`http://127.0.0.1:1/dsh-cost-meter`，install 78.9s）· `probe-matrix-2026-10-27T14-36-20.000Z.json`（n=6：go 2 / blocked 4，cleanup 6/6，boot 12.3–14.3s，`expectation_misses=1`）· `render-fixture-blank-2026-10-27T14-02-15.000Z.json`（CI 同一命令的本机落盘）· `gates-2026-10-27T14-42-00.000Z.json` |
| 证据（R15） | `probe-ok-render-2026-10-27T12-57-25.000Z.json`（boot→sample 8.7s，render 1785ms，readiness=host-url）· `probe-registry-ok-…12-59-01`（install 5.4s / boot 7.7s / render 3.9s）· `render-fixture-{blank,rendered,error,blocked}`（四形态对照） |
| 审核报告 | `audit/AUDIT_2026-10-28_R19.md`（本轮：T-310 安装归因 / T-406 面板 v1 / D2 扩容与预算口径）· `audit/AUDIT_2026-10-27_R18.md` · `audit/AUDIT_2026-10-27_R17.md`（端口自伤，含 R18 的纠错注记）· `AUDIT_2026-10-27_R16.md`· `R15`（四轴在 `step_reviews.json` R15-S1…S14）· `AUDIT_2026-10-28_R14.md` · `R13` · `R12` · `R10` · `R9` · `R8` · `R7` · `R6` · `R5` · `R4` · `R3` |
| 未通过的门槛 | **D2 仍红（R27 批次，旧口径）**：那条红是在「预算判最终样本」的旧口径下测的；R28 改成判第一份样本后**必须重跑矩阵才算数**——没重跑之前不许说「D2 已恢复」。详见下一行。**D2（post-E 批次，R27）第一次真红**：`d2-2026-10-29T01-30-00.000Z.json` 的 `gate.passed=false`，唯一红项是 `boot-budget`（11/12 真实 run ≤20s，超时的是 `real-mcp-connector` 22.5s）；可靠性 19/20、清理 20/20、失败形状 6 仍 PASS。**根因不是 E**（`replacement_waited=false`），而是 `boot(≈4–5s)+settle(≤15s)` 与 20s 预算结构重叠——同一条候选隔离复测 `boot→sample` = 16.0 / 22.5 / 23.8s（`BS-28` 升级为真实候选问题、`BS-32` 是其抖动面）。**没有放宽预算、没有删 run**；三条出路等签（`ADR-0008` §剩余项）。产品数字仍是**便利样本** 12/13 `go`（Wilson 0.667–0.986），只有一台 Windows / 一个运行时。`T-303`（namespace-diff）仍缺（`ADR-0009` 等签）。`T-316` 已真机完成（真 hook 写 `{error}/projection-missing`，`{error}` 仍等满窗口）。`BS-27`：分母不可外推。`T-317`：`d2_report` 判定失败仍 exit 0（自动化不得以退出码判 D2） |
| **环境（本轮沿用）** | 仓内沙盒 `sandbox/upstream/0.2.1-rc.4`（git 忽略）；probe 沙盒在 `%TEMP%/dsh-triage-probe/<slug>`、渲染 profile 在 `%TEMP%/dsh-triage-render*`，跑完必删。本机浏览器：Chrome 154 / Edge 146（**`--dump-dom` 在本机不可用，必须走 CDP**） |
| 交接快照（R18，交付） | D2 **通过（feasibility）**：可靠性 17/17、真实启动 10、失败形状 5、清理 17/17、boot 6.2–19.1s；产品数字 9/10（Wilson 0.596–0.982）· `BS-26` 关闭 / `BS-27` 新增 · R17 慢夹具机制纠错 · 220 测试 / 9 门 / 104 步 / 91 产物 |
| 交接快照（R17，交付） | T-308 完成（端口自伤 + 判定分离 + 就绪窗口 + hook 代际保护 + startup 归因）· `BS-25` 关闭 / `BS-26` 新增 · 213 测试 / 9 门 / 97 步 / 84 产物 · **对外口径：2 次真实启动不是成功率** |
| 交接快照（R16，交付） | **T-305b 完成**（profile 级 `.npmrc` → `blocked`，产物点名 `http://127.0.0.1:1/dsh-cost-meter`）· **D2 分母工具** `scripts/record_probe_matrix.mjs` 首跑 n=6（go 2 / blocked 4、cleanup 6/6、boot 12.3–14.3s）· **新盲区 `BS-25`/`T-308`**：慢候选与坏候选在探针里同形 · 200 测试 / 9 门 / 88 步 / 76 产物 |
| 交接快照（R15 收尾） | R15 = `98c0518`；190 测试 / 9 门；`data/results` 68 产物 / 80 步 |
| 交接快照（R14 收尾） | R14 = `806f770` + `b29e658` + `1a353ab`；166 测试 / 9 门；54 产物 / 66 步 |

---

## 3. 下一位 agent 的第一件事

```powershell
pnpm install --frozen-lockfile; pnpm run verify; node scripts/gate.mjs --mutate
```

**验收标准**：第二条输出 `ALL GREEN · 9 gates`；第三条最后一行 `NEGATIVE CONTROL PASSED · 9/9`。
满足即环境可信，接着**按优先级**（前两条不需要新许可）：

1. **用新口径重跑 D2（最该先做，约 18 分钟，不需要新许可）**：R27 的红是「预算判最终样本」的旧口径下测的，R28 已改成判**第一份**样本（T-312）。命令见 §3 末尾「D2 重跑」块：跑完矩阵再跑 `d2_report`，把新的 `d2-*.json` 与矩阵一起入账。**在这之前 D2 状态是「R27 判红 + 口径已改 + 结论待测」**，不许说「已恢复」。
2. **`T-317`**：`d2_report` 判定失败仍 exit 0 —— 任何自动化都不得用退出码判断 D2；要进 CI 得加 `--strict`。
3. **补真实候选（T-309 长期）**：每批 +2–3 个 pin 候选；可以再加「复制组合」样本（`--copy-profile`），但对外必须连 `BS-30`/`BS-31` 一起说。**注意**：新批次里出现过的慢候选要单独记 `wait_ms`，它们是预算红项的来源。
4. **`T-315` 剩余**：`strictPeerDependencies` 与其它可继承 pnpm 设置仍未逐一实测；`nodeLinker: hoisted` 已在 R26 补测（不打断行识别，见 F49），但产物**不记录 `node_modules` 布局**——想主张「真的切到 hoisted」得先把布局写进产物。
5. **T-401 DSH 设置面板（M4-a）**：只读契约 spike 已在 R26 完成（`docs/specs/M4-surface.md` §3.1 C1–C6）。下一步是写 `packages/plugin/client.js` + `dsh.client`，并先做「契约不匹配就整块不注册」的降级与其单测。
6. **`BS-29` 剩余面**：硬编码配置路径、非 Windows、其它 pnpm/launcher 版本。**不要**把「审计过的来源里只有 user config 会被读」说成「沙盒里绝无凭据」。
7. **T-303 / T-202a**：`docs/adr/0009-agent-scope-reads.md`（proposed）**等 HUMAN 勾选**（A 维持 / B 破例 / C 等上游）。未签前保持 `unmeasured`，**不要**用「进程级工具清单」冒充它。

**ADR-0008 E 提醒（R26）**：替换窗口现在是**`{error}` 专属**。`settled:false` 立即收敛，产物里是 `inventory.replacement_waited=false`——**别**把它读成「探针变快了 20s」就顺手去改 `--unsettled-timeout` 默认值（那仍是 20000，改它需新 ADR）。也**别**把 `isUsableSample()` 一起放宽：它同时被 judge 与断言使用，放宽它等于把「树还在动」判成 `blocked`。**`{error}` 那一侧现在有真机证据了**：`probe-adr0008e-hook-error`（真 hook 写 `projection-missing`，`replacement_waited=true`、`waited_ms=5203`）——但它**不是**一个正常候选样本（`sandbox.hook_config` 非空，用的是诊断开关 `--hook-config`），不许计入通过率。**墙钟是区间不是常数**：R26 三次真跑 `boot` 步 21.7–28.6s（sample 等待本身在 11.5–22.7s 之间波动，`BS-32`），对外只能说区间并指向 `timings.bootSegments`，不要说「一次 probe 30 秒」。

**D2 重跑（R28 交接后的第一件事）**：R27 的红是旧口径（预算判最终样本）下测的；R28 起预算判**第一份**样本（T-312）。重跑两条命令即可给出新结论：

```powershell
node scripts/record_probe_matrix.mjs --plan tests/fixtures/probe/matrix-r19.json --dsh-main sandbox/upstream/0.2.1-rc.4/install/node_modules/@deepseek-ai/dsh/lib/bin.js --install sandbox/upstream/0.2.1-rc.4/install --stamp <新 ISO>
node scripts/d2_report.mjs --matrix data/results/probe-matrix-<新 stamp>.json --stamp <新 ISO>
```

验收：矩阵 n=20 / 真实 13 / 清理 20-20 / 形状 6；`d2_report` 的输出里 **`boot-budget` 是否 12/12**。**注意**：`d2_report` 判定失败时**仍然 exit 0**（`T-317`），必须读产物里的 `gate.passed`，不能看退出码。跑之前先 `Get-Process pnpm` 清残留（R23 的坑），并且**不要**在跑矩阵时并行跑测试/构建（R27 的 `real-mcp-connector` 22.5s 可能被自己的并发拖慢过，见 `BS-32`）。

**T-312 提醒（R28）**：`provisional: true` 的样本**不可判**（`settled:false`，只能 `unknown`）；预算判第一份（`timings.bootToSampleMs`），最终样本时刻在 `bootToFinalSampleMs`。**升级窗口必须从样本自报的 `settle_timeout_ms` 推**（+1s），改回固定常数会错过恰好卡在 hook 预算上的最终样本（R28 真踩）。

**R19 提醒**：安装失败**现在有原因**了（`install.diagnosis`），但别把 `ERR_PNPM_IGNORED_BUILDS` 说成「插件坏」——它往往只是 pnpm 的 build-script 审批策略（F35）。`key_line` 的取法有两条硬规则：**launcher 优先于诊断日志**（日志只有 67 字节，没有码），**`dsh:` 开头的行永远不算原因**（那是 launcher 在说它自己）。

**D2 提醒（R19 之后）**：D2 的**通过**只回答「probe 这件事能不能稳定跑」。**产品数字**现在是真实候选 **12/13 = 0.923**，Wilson 95% 只有 **0.667–0.986**，而且是手挑的便利样本——对外必须连区间一起说，不许只说「92% 成功率」。重算命令：`node scripts/d2_report.mjs --matrix data/results/probe-matrix-2026-10-28T11-40-00.000Z.json --stamp <iso>`。
**预算口径（R19 已签）**：`boot-budget` **只判 `real:true`** 的 run；永不 settle 的夹具结构上 ≈21s，单列在 `timing.fixtures_over_budget`。真实候选仍是 **100%** 必须 ≤20s（没有放宽成 90%）。别把它读成「预算不重要了」（`BS-28` / T-311）。

**端口提醒（R17 的教训）**：`buildProbePlan` 的哈希端口只是**偏好**；本机 `netsh int ipv4 show excludedportrange protocol=tcp` 排除 **53461–53560** 且会中途变化。现在 CLI 与 `record_probe` 都会先 `findFreePort()`，产物记 `sandbox.port_origin`。**不要**把端口写死回常量。

**想继续从开源里借**：`docs/09-open-source-borrowing.md` 先看，再动 T-113（attw 矩阵，前置是沙箱实测 loader 解析模式）。**借机制不抄代码**，真抄要先进 `quarantine/` + `vendor-manifest`。

先按 `.agents/prompts/task-packet.md` 列允许改动的文件，再动手。

**新会话开箱状态（R28 收尾）**：`git log -1` 就是交接提交，`git status` 干净；**274 测试 / 9 门 / `--mutate` 9-9**；`data/results` 的每份产物都被步台账引用；新会话**不许**为了「让门变绿」改阈值或删产物。四条最容易踩的禁令：① 不得读 `~/.dsh/credentials`、不得向沙盒注入真实凭据（铁律 4，T-202a 要先出 ADR）；② 判据/阈值改动必须 spec + HUMAN-SIGN（`audit/SIGNOFF.md` 记账，R19 的预算口径就是范例）；③ 沙盒目录名一律 basename slug —— 别再让绝对路径进产物（F-2 / R16 面板 smoke 又踩过）；④ 外部候选只能 pin 版本 + 临时沙盒执行，不 vendor（`docs/adr/0004`）；**许可只认元数据能证明的**（`SEE LICENSE IN LICENSE` 这种直接跳过，R19 真放弃过一个候选）。**R22 追加一条**：`--copy-profile` 只搬四个声明文件，**永远不要**顺手复制 `node_modules` / `.plugin-manager` / `.npmrc`（最后一个是凭据）。**R26 追加一条**：改 `packages/probe/src/host.ts` 后**先 `pnpm build`** 再跑 `record_probe`（它 import `dist/`），否则你测的是旧循环。

> D1 已于 R6 通过（9/10）；M2-a P2 于 R7 交付；R8 补副本来源与重复副本；R9 让「没声明」不再静默；R10 让 dist-tag 失步可见；R12 让相位来自真机（`data/results/inventory-live-2026-10-27T22-00-00.000Z.json`）并补齐 preset 维度。
> 复核口径十一条命令：`node scripts/d1_report.mjs --stamp <iso>`、`node scripts/render_inventory.mjs --snapshot data/fixtures/inventory/desktop-web-2026-10-26.json --dsh-home tests/fixtures/env/home --profile desktop --stamp <iso>`、`node scripts/record_live_inventory.mjs --dsh-home <sandbox>/home --profile upstream --install <sandbox>/install --stamp <iso>`、`node scripts/record_audit.mjs --dsh-home <sandbox> --profile desktop --stamp <iso>`、`node scripts/probe_live_sample.mjs --dsh-home <sandbox>/home --profile upstream --install <sandbox>/install --stamp <iso>`、`node scripts/record_registry.mjs --stamp <iso>`、`node scripts/record_probe.mjs --candidate tests/fixtures/probe/ok-plugin --dsh-main <sandbox>/install/node_modules/@deepseek-ai/dsh/lib/bin.js --install <sandbox>/install --label ok --expect go --browser <chrome> --stamp <iso>`（R17 另加 `--readiness-timeout <ms>` / `--unsettled-timeout <ms>`；R22 另加 `--copy-profile <name>` + `--dsh-home <home>`；**R26 另加 `--hook-config <json>`（诊断开关：产物记 `sandbox.hook_config`，该产物不得计入通过率）**）、`node scripts/record_render_fixture.mjs --mode blank --expect blank --stamp <iso>`（另三种：`rendered` / `error` / `blocked`）、`node scripts/record_probe_matrix.mjs --plan tests/fixtures/probe/matrix-r17.json --dsh-main <sandbox>/install/node_modules/@deepseek-ai/dsh/lib/bin.js --install <sandbox>/install --stamp <iso>`、`node scripts/record_serve_smoke.mjs --stamp <iso>`、**`node scripts/audit_credential_sources.mjs --dsh-main <sandbox>/install/node_modules/@deepseek-ai/dsh/lib/bin.js --stamp <iso>`（R23，离线，30 次 launcher 运行）**。
> **对外口径（别再说过头）**：真机相位样本来自**仓内沙盒**（0.2.1-rc.4），不是用户的 `~/.dsh`（本机真实 profile 是 0.1.0-rc.6，没有 `pluginInventory`）。可以说「在一台真起的 0.2.1-rc.4 Host 上实测」，不能说「在用户机器上实测」。真机样本里没有 `failed` / `broken preset` / `conditional` 行——这三档只有夹具覆盖。R17 的 probe 真机样本全部来自这台 Windows 机器；Linux 只跑过渲染对照（CI `render-control`），**没跑过真 probe**。

> 每一步做完，先追加 `audit/step_reviews.json`（四轴 + 对抗性 + real_test 产物 sha256），再跑 `node scripts/gate_step_review.mjs`。漏了它，`pnpm run verify` 会红。


---

## 4. 坑（真实踩过的，别再踩）

| 症状 | 原因 | 处置 |
|---|---|---|
| `node --test` 找不到模块 | 没 `pnpm build`（包导出指向 `dist/`） | 先构建再测 |
| 标准 profile 报 27 条「entry id 冲突」 | 把「纯覆写」当撞车 | 已修，见 `docs/adr/0002`；别回退该判定 |
| `yaml` 把 `!!js` 当错误 | 未用 `parseDocument` + `doc.errors` | 已修（`core/ledger.ts`） |
| 提交标题带 `` | PowerShell 5.1 `Out-File -Encoding utf8` 写 BOM | 用 `git commit -m`，别用 `-F` 接 BOM 文件 |
| 门禁「全绿」但什么都没查 | 没跑 `--mutate` | 每轮必跑（CI 也跑） |
| CI 报找不到 `scripts/lib/kit.mjs` | `.gitignore` 的 `lib/` 匹配任意层级 | 已改 `**/dist/` + `packages/*/lib/` |
| `probe` 测试在 Linux 全红 | 硬编码 `C:/Temp`，POSIX 下非绝对路径 | 用 `tmpdir()` + `join()` |
| 误以为 `gate.mjs --mutate` 要 exit 1 | 单门才 exit 1；套件全 CAUGHT 才 exit 0 | 认最后一行 `NEGATIVE CONTROL PASSED` |
| SSOT 里出现 `C:\Users\<名>` | 只脱敏了 `env.profileDir`，漏了 `evidence[].source` | 已修 `redactVerdict` + `results-privacy` 门 |
| `npm` 命令刷 `Unknown project config` | `.npmrc` 放了 pnpm 专属键 | 已迁到 `pnpm-workspace.yaml` |
| Windows 上 `spawn('npm')` 报 EINVAL | 不能直接 spawn `.cmd` | 走 `ComSpec /c`（见 `gate_release_pack.mjs`） |
| 以为「只判 bundle 就够了」，结果 `why` 说 no denials 而用户的工具确实没了 | 上游按 **row 的模块** 判 admission，`cordis.patch.yml` 里挂的行逃过 bundle 级检查 | 已修行级归因（CASE-11080）；新增行必须走 `rowTargets`/`resolveRows`，别绕过 |
| 从 GitHub 找不到上游 issue | `deepseek-ai/deepseek-harness` 的 `has_issues=false`，只有 Discussions | 抓 `https://github.com/<repo>/discussions`（HTML 可读）；GraphQL 需 token |
| 案例 JSON 一读就 `JSON.parse` 失败 | PowerShell `Set-Content -Encoding utf8` 写 **BOM** | 用 Node 写/读；或先剥 `\uFEFF` |
| 全新 clone 后 input sha256 对不上 | `core.autocrlf=true` 把 LF 变 CRLF | `data/cases/** eol=lf`（已在 `.gitattributes`） |
| 想用「贴 stdout」当一步的证据 | 门 `step-review` 只认 `data/results/` 里可重算 sha256 的产物 | `node scripts/gate.mjs --record --stamp <iso>` 把门禁结果本身也写成产物 |
| 重跑脚本后产物 sha256 变了、门 `step-review` 红 | 把**文件名用的**时间戳（`2026-10-26T00-00-00.000Z`）当 `--stamp` 传了；`Date.parse` 宽松接受它 | 已加校验：`--stamp` 必须是 ISO-8601（`2026-10-26T00:00:00.000Z`），否则 exit 2 |
| 用 PowerShell 改 `.mjs` 脚本，跑起来报语法错 / 门禁读到怪字符 | `Set-Content -Encoding utf8` 在 PS 5.1 下写 **BOM**（R6 实际踩到 `scripts/d1_report.mjs`） | 改代码只用编辑器/Node：`node -e "…writeFileSync(p, t.replace(/^\uFEFF/,''),'utf8')"`；提交前看首字节是否是 `EF BB BF` |
| 新脚本按传参目录跑，报 `ENOENT ...\<repo>\C:\Users\…` | `scripts/lib/kit.mjs` 的 `abs()` 是 **repo-root 相对**，直接把绝对路径塞进去会被拼接 | 传参路径先判 `isAbsolute()` 再决定是否 `abs()`（见 `scripts/d1_report.mjs` 的 `pathFor`） |
| `npm view`/registry 拿某个具体版本的 manifest 返回 **406** | 只发 `Accept: application/vnd.npm.install-v1+json` 时，版本端点不支持 | 具体版本用 `Accept: application/json`；packument 才用 install-v1 |
| 新写了一条 `reason`，`verdict-contract` 门报 “messageId must be a catalogue id” | 门里 `MESSAGE_ID` 是**白名单正则**（`admission|collision|runtime|remediation|missing`），新命名空间要同时改门 + `docs/05-verdict-contract.md` | 新增命名空间时三处同改：`messages.ts` 文案、`gate_verdict_contract.mjs` 正则、`docs/05` §契约表；这不是放宽阈值，是对齐已锁 spec |
| 给 `for (const [a, b] of [...])` 漏了 `]`，Node 只报 “Unexpected token 'of'” | 解构语法；报错位置指向 `of` 容易误导 | 写完 pair 循环先跑 `node --check <file>`（或直接跑一次 `tsc -b`） |
| PowerShell 里写 `node -e "…中文/单引号/正则…"` 反复报 ParserError | PS 5.1 会先解析一遍单引号与转义，中文和 `'` 很容易被吃掉 | 一次性脚本写成临时 `.mjs`（`%TEMP%\opencode\*.mjs`）再 `node` 执行；R8 两次踩到 |
| `findDuplicateCopies` 扫出 0 条，明明有两份 | 把 `env.profileDir`（profile 目录）当成了 `node_modules` 传进扫描器 | 扫描器的根必须是 `<profile>/node_modules` 与 `<dshHome>/profiles/node_modules`；R8 的单测抓到了 e2e 没抓到的这处 |
| 门「全绿」但文案里的 `{占位符}` 会原样打到用户脸上 | 只校验 messageId 存在，不校验 `params` 是否提供占位符 | R9 起门 `verdict-contract` 有 `placeholder-params-required`（缺 key / `null` / 空串都算缺）；新增文案后先跑一次单门 |
| `dsh --dump-config` 在 PowerShell 里「看起来 exit 1」 | `\| Select-Object -First N` 提前关管道，`cmd` 侧报 broken pipe | 判定 exit code 要么整段收完，要么用脚本 `spawnSync`（`probe_live_sample.mjs` 就是这么记的） |
| 沙盒 0.2.x「能 compose 不能 mount」 | `%TEMP%\dsh-triage-env\<ver>\home\profiles\<p>` 只有 `package.json`，没有 `node_modules` | 相位采样前置：先给沙盒 profile 装依赖；`pluginInventory` 只以 typert Remote 暴露，不能同进程直读 |
| 以为 `pluginInventory` 可以像普通 Cordis 服务那样 `ctx.get()` | 上游实现是 Remote-only，明确不声明同进程 merge | P1 要么在 Host 内走 loader 投影，要么走 Remote 客户端；README 原文见 `dsh-host-plugin-inventory` |
| 兼容通道把作者标注的「不兼容」读成「兼容」 | `dshReleases` 的键被手写成 `v0.1.7-alpha.2`，与运行时串按字节比较失败，退化到更宽的 `dsh: "*"` | 比较前归一化（去空白 / 去 `v`,`=` 前缀 / 过 `semver.valid`）；R9 复核抓到，已修并加单测 |
| 门「全绿」但 `--mutate` 的某一类注入根本没落地 | 注入目标（含占位符的 reason）在产物里不存在时被静默跳过 | R9 起：注入失败即判红，并加常态断言 `placeholder-copy-present`（产物必须真的用到含占位符的文案） |
| 「latest 落后」判断反了 | 用了 `semver.rcompare(a,b) > 0`，但 `rcompare` 的语义是**反向**（a 比 b 旧时才 > 0），于是「更新的版本」被判成最新 | 正向比较一律用 `compare(a,b) > 0`，降序排序用 `rsort`；单测 8 条当场抓到（`tests/unit/version-drift.test.ts`） |
| 用 PowerShell 改 `.ts`/`.mjs` 后文件头变成 `EF BB BF` | `Set-Content -Encoding utf8` 在 PS 5.1 写 BOM（R9/R10 各踩一次） | 改代码只用编辑器；批量替换后跑 `node -e` 检查首字节并剥 BOM，或直接写成临时 `.mjs` 执行 |
| 沙盒放 `%TEMP%` 被清理，或 profile 没依赖导致「能 compose 不能 mount」 | 沙盒默认位置在临时目录；profile 依赖要单独装 | R11 起沙盒固定在 `<repo>/sandbox/`（git 忽略），并用 `bootstrap_upstream.mjs --with-profile-deps` 一次装齐 |
| 探 HTTP 时「带 token 也 401」 | 带 token 的首个响应是 **303 + Set-Cookie**，Node `fetch` 不保存 cookie，跟随重定向后就 401 | 探活要 `redirect: 'manual'`，把 303 当「服务活着」；无 token 的 401 是另一个证据 |
| `child.kill()` 之后 Host 还在监听 3080 | Windows 上 `dsh web` 会带子进程，单杀父进程不够 | `taskkill /pid <pid> /T /F`，并以「端口不再应答」作为停止判据（别信 `exitCode`） |
| `dsh web --patch x.yml` 报 `error: unknown option '--patch'` | launcher flag 必须写在 profile 名**之前**：`dsh <name> ...` 会把后面的都当 app 参数透传（`passThroughOptions`） | 用 `dsh --profile upstream --patch <overlay>`（R12 实际踩到） |
| 一个 bundle 的行在 `audit` 里**整层消失**，且没有任何报错 | `package.json#dsh.bundle.patch` 允许**字符串或数组**；只读了字符串分支，`dsh-web-app`（数组形态，含 4 个 `presets/*.yml`）被静默跳过 | `readBundlePatchPaths` 支持两种形态；`declaresBundlePatch` 让畸形值变成错误而不是空层（R12 修，`undeclared` 195→4） |
| 声明行 `tool-bash` 与运行时 `include:tool-bash` 对不上，健康 Host 报几十条「缺失/未声明」 | loader 把 profile 的 `cordis.yml` 包在 `include` group 里，**运行时 id 带 group 前缀** | `indexRuntimeIds`/`resolveRuntimeId`：精确优先 → 唯一后缀匹配 → 多候选出 `runtime.ambiguous-entry`（R12 修，`missing` 96→0），别改成「按后缀粗暴匹配」 |
| 产物里出现 `C:/Users/<名>/...`，`results-privacy` 却没红 | 探针行的模块名被 loader 解析成 `file:///` URL 且**百分号编码**；只替换反斜杠路径的脱敏看不见它 | 脱敏先 `decodeURIComponent` 再同时替换 `\` 与 `/` 变体（`scripts/record_live_inventory.mjs`） |
| `gate_ssot` 报 hash 不匹配，肉眼看 `.sha256` 一模一样 | `.sha256` 文件必须是**纯 hash**：门拿整文件内容与 `sha256(text)` 比较，尾巴带文件名就红 | 只写 `${hash}\n` |
| 改了 `messages.ts` 的 `{占位符}` 之后，`data/results` 里老产物让门红 | `verdict-contract` 会用**当前** catalog 校验历史产物 | 用产出脚本按**同一 stamp** 重放该产物，并把新 sha256 同步进 `audit/step_reviews.json`（R12 对 R7 合成样本做过一次，附原因） |
| 以为 preset 行的 `fiberPhase: null` 和主列表一样是「声明了没加载」 | 上游文档：preset 行的相位是「组合活着时的 root fiber 相位；否则 null」，`null` 也覆盖「没有会话组合过它」 | 主列表照旧 `blocked`，preset 行判 `unknown`/`runtime.preset-no-fiber`（`docs/specs/M2-inventory.md` §3.1） |
| 自己的插件装上了却什么都没挂载，日志只有一行 `patch: entry "x" not found` | bundle 的 `cordis.patch.yml` 用了 `- id: x` 形态——那是**修改**已有 entry，不是插入；上游对未知目标口头警告后跳过（schema `includePatch` 原文） | 必须 `- insert:`；门 `namespace` 的 `rows-are-inserted` 已把这条钉死（R14 实测发现，我们自己也踩了） |
| probe 明明起了服务，HTTP 检查却全 `fetch failed` | 采样后立刻 `taskkill`，端口已经没了；就绪探测打在死端口上 | 就绪探测必须在杀树**之前**（`host.ts`：采样 → settle → 探测重试 → 杀树），R14 真机抓到 |
| probe 一跑就把用户浏览器弹出来 | Host 默认 `open` 浏览器，探针是后台进程 | app 参数加 `--no-open`；`--port` 也是 app 参数（launcher flag 与 app 参数位置别混） |
| 以为 CI 里没有浏览器，渲染断言只能 `unmeasured` | **前提错了**：GitHub ubuntu-latest 预装 Chrome/Chromium/Edge + xvfb（runner 镜像清单实测） | `ADR-0005`；CI 新增 `render-control` 作业跑三份对照，缺浏览器时**明确失败**而不是静默降级 |
| `dsh --profile <p> web --port N` 报 `too many arguments` | app 名不能当参数再给一次；profile 自己决定 app | 直接 `dsh --profile <p> --port N --no-open`，端口透传给 app |
| 以为 `chrome --headless --dump-dom URL` 能拿 DOM，结果 0 字节 + 挂满 60s | 本机 Chrome 154 / Edge 146 上 `--dump-dom` 与 `--screenshot` 都失效（不是参数写错） | 走 CDP：`--remote-debugging-port=0` + `<profile>/DevToolsActivePort` + `Runtime.evaluate`；Node 22 内置 `WebSocket` 就够（`packages/probe/src/render.ts`） |
| `mkdtempSync(join(root,'x-'))` 报 ENOENT | 父目录不存在时 mkdtemp 不会替你建 | 先 `mkdirSync(root,{recursive:true})`（render.ts 踩过） |
| 把 `NPM_CONFIG_REGISTRY` 指向死地址，安装却成功 | pnpm store 命中：装成功 ≠ 走网络，lockfile 甚至逐字节一致 | 判「网络形状」不能只看 exit code；R15 的 F18/F19 就是这一枪（`probe-registry-unreachable-*.json`） |
| 以为 `--registry`/env 覆盖能测私有源 | launcher 会把环境变量中和，pnpm 用自己的源 | 私有源形状要走 profile 级配置（T-305b） |
| `scripts/lib/live.mjs` 报 `ERR_MODULE_NOT_FOUND .../src/render.js` | 它直接 import `host.ts`，而 `host.ts` 新加的 `./render.js` 不会被类型剥离重写成 `.ts` | live.mjs 改为 re-export **构建产物** `packages/probe/dist/host.js`；跑 live 脚本前先 `pnpm build` |
| PowerShell 里 `node -e "…中文/反引号…"` 直接语法错 | 反引号在 PS 里是转义符，会先被吃掉 | 一次性脚本写成 `%TEMP%\opencode\*.mjs` 再 `node` 执行（R15 又踩一次） |
| 探针报「Host 起不来 / 超时 / 端口无应答」，候选看起来没问题 | **先查端口有没有落在 OS 排除段**：本机 `netsh int ipv4 show excludedportrange protocol=tcp` = 53461–53560，plan 的哈希选中 53506，Host 的 `webserver` 行 `listen EACCES` → 整棵树 `startup failed`（R17 真踩，正常候选被写成 blocked） | 端口每次都 `findFreePort()`；产物看 `sandbox.port_origin` 与 `boot.bind_failed_ports`；`probe.port-unavailable` = 探针环境问题，不是插件 |
| 同一个候选一会儿 `go` 一会儿 `blocked` | Windows 的端口排除段**会话中途会变**（R17：15:05 能起、15:20 起不来） | 别把「上次能跑」当成本次能跑；每次看产物里的端口与 `port_origin` |
| hook 报 `cannot get required service "loader" in inactive context`，以为是「树慢」 | 其实是**我们自己的 fiber 被 unload**（Cordis 把 `fiber.store` 置空），服务回来后它会**重跑 apply** | 别在同一个 dead ctx 里重试；靠代际保护 + 等一份可判样本（R17 的 `isUsableSample`） |
| 改了 `packages/probe/src/host.ts`，跑 `record_probe` 却没变化 | `record_probe` 与 `live.mjs` 都 import `packages/probe/dist/`（构建产物） | 先 `pnpm build` 再真跑（R17 踩了一次） |
| 产物里 `boot.url_printed/first_line/error_tail` 全是空 | boot 步骤在 `sample === null` 时**提前 return**，赋值写在 return 之后 | 新字段一律在 early return **之前**赋值（R17 踩了一次，单测没覆盖到） |
| 想看 launcher 为什么起不来，产物里却只有第一行 | 启动诊断打在 **stdout**，而 `error_tail` 只取了 stderr | 两流拼接后再截断，并对 `?token=` 脱敏（R17 已修） |
| `Set-Content -Encoding utf8` 给夹具写的 `package.json` 带 BOM，launcher 解析怪 | PS 5.1 的 utf8 一律带 BOM | 写夹具后用 Node 重写并 `replace(/^\uFEFF/,'')`（R17 的 slow-plugin 踩过） |
| 想让行慢一点，就在 `apply` 里 `await sleep()` | **没用**：Cordis 进入 `apply` 就把行标成 `active`（R18 实测 `wait_ms` 3.3s、行立刻 active），这种夹具证明不了 settle 路径 | 要造 `loading` 必须让**模块导入**慢：顶层 `await`（R18 的 `slow-plugin` / `slow-overrun-plugin`） |
| 把 D2 的「成功率」写成点估计 | 9/10 很容易被读成「90% 稳了」，但 n=10 的 Wilson 区间是 0.596–0.982（R19 的 13 个是 0.667–0.986） | 用 `scripts/d2_report.mjs`：它把区间、分母检查、清理、计时一起算，并在真实启动 <10 时**拒绝判定** |
| 以为「诊断日志里肯定有真正的错误」 | launcher 只在日志里写一行 `Command failed with exit code 1: pnpm add …`（**67 字节**）；`ERR_PNPM_*` 与解释只在 **stderr** | 归因顺序：launcher 输出优先、日志兜底，产物记 `diagnosis.source`（R19 F34）。只有错误码的行不算解释——继续往下找第一条 `label: detail` |
| 归因抓到了 `dsh: plugin command failed; diagnostics: …` | 那是 launcher 在说**它自己**，不是包管理器的原因 | 前向扫描跳过 `^dsh:` 与 `help:/hint:` 行（R19 实测 `synthetic-missing` 就踩了） |
| 成功安装的产物里出现「诊断」 | `runInstall` 以前对 `exit 0` 也算 `key_line`，于是本地夹具写着 `Already up to date`，看起来像失败 | `exit 0` 时 diagnosis 恒为 `{null,null,'none'}`（R19） |
| `ERR_PNPM_IGNORED_BUILDS` 被当成「插件坏」 | 它是 pnpm 11 的 build-script 审批策略：包**装上了**，只是构建脚本没跑（stdout 同时有 `+ pkg@ver`） | `probe.install-build-refused` + 专用 remediation；别把包管理器策略说成插件缺陷（R19 F35） |
| D2 的 `boot-budget` 被一个「永不 settle」的夹具判红 | 20s 预算与 20s 未稳定窗口**结构重叠**：`boot(≈5s)+settle 上限 15s ≈ 21s`，永远进不了 20s（R18 的 19.1s 是运气） | 预算只判 `real:true`；夹具耗时单列 `timing.fixtures_over_budget`（HUMAN 签，R19）；改默认窗口需 ADR（T-311） |
| 沙盒「清了环境变量」就以为没有凭据了 | pnpm 自己会读 `~/.npmrc`：装不上的候选会打印 `An authorization header was used: Bearer npm_[hidden]`，把**操作者的 token** 发给 registry（R20 实测 2/2） | `runInstall` 走 `sandboxNpmEnv()`，把 `npm_config_userconfig` 指向沙盒内空文件；产物 `install.registry_auth_used` 必须为 `false`。**别去读那个 npmrc**（铁律 4），只停止继承 |
| 以为「组合装成功了 = 组合可用」 | `{"x":"link:./not-here"}` 的 `plugin install` **exit 0** 并打印 `+ x <- not-here`，目标根本不存在（R20 F40） | T-304 已实现：`link:`/`file:` 逐个 stat，悬空 → `unknown` + `probe.profile-link-dangling`。**别**改成「看退出码就够了」 |
| 复制真实组合后 `plugin install` 一直 exit 1，被拒的是 `node-pty`/`koffi` 这类**组合自己的**包 | pnpm 的构建审批策略（R19 F35 同一形状）；模板路径里 pnpm 只报候选，所以以前没见过（R22 F41） | 沙盒 `pnpm-workspace.yaml` 写 `strictDepBuilds: false`（F43）：exit 0 且注册 bundle，但**不批准任何构建**；被跳过的包进 `install.ignored_packages`。`.npmrc` 里同名设置**无效** |
| 「ADR 已经签了」就顺手把默认值也改掉 | ADR-0008 的方案 E **授权的是做法**（`settled:false` 不再等替换），**不是**「改 `--unsettled-timeout` 的默认值」。两者是两件事 | **R26 已实施做法、默认值仍 20000**；改默认值是另一道签（方案 A），未授权 |
| 把 `provisional: true` 的样本当成可判样本 | 它是 hook 的**第一份**读数，`settled` 恒为 `false`；`measurementState` 据此判 `unsettled` → 只能 `unknown` | 想让它出 `go`/`blocked` 只有一条路：等最终样本（`inventory.upgraded=true`）。**别**在 `judgeProbe` 里为 provisional 开特例 |
| 以为「T-312 让 probe 变快了」 | 墙钟反而从 ≈28.6s 升到 ≈30.4s（多等最终样本） | 预算判的是**第一份样本**（`timings.bootToSampleMs`）；最终样本时刻在 `bootToFinalSampleMs`。对外只能说「答案更早」，不能说「更快」 |
| 升级窗口取固定值，结果恰好错过最终样本 | R28 第一版用固定 15s，`slow-overrun` 的最终样本 15.25s 才写完 → `upgraded` 误记 `false`（结论不变，但产物说谎） | 窗口 = 样本自报的 `settle_timeout_ms` + 1s；hook 版本换了就自动跟着变。**别**改回常数 |
| 把 `settled:false` 与 `{error}` 当成同一种「不可判」去删等待 | 两者的恢复机制不同（R17：`{error}` 是 dead context 被新 apply 取代；`settled:false` 是 hook 自己读完了但树还在动） | **R26 已按 `ADR-0008` E 落地**：`replacedEnough` 只在样本**不可读**时参与；`settled:false` 立即收敛。**别**顺手把 `isUsableSample()` 也放宽（那会把「树还在动」判成 `blocked`），也**别**把 `--unsettled-timeout` 默认值改掉 |
| 说「E 让 probe 变快了 20 秒」 | E 只删掉**本来就没买到任何东西**的那一段（29 份产物 `replacements_observed=0`）；同类夹具的 sample 等待本身在 11.5–22.7s 之间波动（`BS-32`），看起来就像「有时没变快」 | 引用时给区间与前后对照：同夹具 `boot` 步 48.4s（R23）→ 28.6s（R26），差额是被删掉的替换窗口；证据看 `timings.bootSegments` 与 `inventory.replacement_waited` |
| 用 pnpm 的 `An authorization header was used` 判断有没有凭据外发 | **这句话不是总会出现**：R23 实测「合成 token + 真实 userconfig」不打印它，靠日志会把一条活着的凭据来源判成「没问题」 | 用本地假 registry 记请求头（`scripts/audit_credential_sources.mjs`）；而且必须**异步 spawn**，`spawnSync` 会阻塞事件循环让同进程的假 registry 永远答不了（真踩三次 90s） |
| 跑完一次审计后下一轮 install 全挂 / 挂 90s | 上一轮被 kill 的 `pnpm add` 还活着，占着 store 锁（R23 实际遇到 `pnpm.exe` 残留进程） | 先 `Get-Process pnpm` 清残留再重跑；审计脚本自身用 `SIGKILL` + 超时兜底 |
| 以为「某来源没泄漏 = 是我们挡住了」 | 可能是那个旋钮**根本没被读**（R23：`globalconfig` / `XDG_CONFIG_HOME/pnpm/rc` / `PNPM_HOME` / `COREPACK_HOME` 都没被读） | 审计要分 `knob_honored`（源自己带 `registry=` 时有没有流量）与 `leaks_today` 两列，别把两件事混成一件 |
| 以为「boot 步的差额是 settle 15s」 | 分段实测（R23）：正常候选的差额是 **render 4.7s + 杀树 2.2–2.7s + 杀后 1.2s**；不可判的 48.4s 里主导项是**替换等待 20.3s**，而 hook 的 `wait_ms` 已含在 sample 里 | 看 `timings.bootSegments`；新增 await 必须加段，段之和要与 `steps[boot].ms` 对齐（≤100ms） |
| 复制组合后 boot 成功、HTTP 200，却报「候选零行」 | `plugin add` 在 pnpm **非 0** 退出时只写 `dependencies`，**不写 `dsh.profile.bundles`**（R22 F42）——「继续跑」会把包管理器策略算成插件缺陷 | 现在读回 `dsh.profile.bundles`：候选已注册 → 可 `go`（带 warn）；未注册 → `unknown` + `missing.probe`。**别**把 `row-missing` 留给这条路径 |
| 复制模式 `go` 被当成「在我机器上验证过」 | 沙盒**从不运行**组合依赖的构建脚本（`BS-30`）；副本也只搬四个声明文件（`BS-31`） | 对外口径：「声明层一致、依赖装齐、原生模块未构建」；链接/私有源场景只能是 `unknown` |
| 用 `--profile` 默认值覆盖了复制源的名字 | `Flags.profile` 默认 `web` 会让 `--copy-profile upstream` 被静默改名（R22） | CLI 用 `profileExplicit` 区分「显式给」与「默认值」；`record_probe` 同理 |
| 面板「感觉有点慢」却说不出哪里慢 | `/api/audit` 是同步扫描：本机 156 行 profile 实测 **376–690ms**，期间阻塞事件循环 | 响应头 `x-triage-audit-ms` 自带耗时（R20）；别把它做成轮询接口 |
| INDEX 里写一个新路由/裸文件名，`governance` 报 `index-references` 红 | 门把表格行里**任何**含 `/` 或以 `.json` 结尾的反引号 token 当路径 | 路由别用反引号写成 `/api/x` 形态，产物一律写全 `data/results/xxx.json`（R18 踩过 `go/(go+blocked)`，R19 又踩两次） |
| 失败形状数看起来很好（9 种） | 把 info 级原因（`probe.render-ok`、`probe.served`）也算成了形状 | 只数 `block` / `warn`（R18 已修在脚本里） |

---

## 5. 冻结区（改之前必须问 HUMAN）

| 区域 | 原因 |
|---|---|
| `data/gold/admission-cases.json` | 金标；改它等于改判据 |
| `audit/gate_ledger.json` 的 `negative_control` | 门禁有效性的唯一证明 |
| `packages/core/src/admission.ts` 的规则顺序 | 与上游对等性由金标锁死 |
| `PROJECT_RULES.md` 的铁律 | 工程宪法 |
| `packages/plugin/cordis.patch.yml` 的行 id | 撞上游 id 会让整个 profile 起不来 |

---

## 6. 交接包模板

写完交接，把内容贴进本文件 §2（覆盖上一轮）并在 `audit/AI_DISCLOSURE_LOG.md` 追加一条。
模板见 `.agents/prompts/handoff-packet.md`；硬性要求：

1. 「下一位 agent 的第一件事」必须是**单条可执行命令**；
2. 证据必须落盘（SSOT + sha256），禁只贴 stdout；
3. 未完成项必须带 owner 与退出条件。

---

## 7. 角色与规则速查

| 需要 | 看 |
|---|---|
| 新会话开工指令 | `.agents/prompts/kickoff.md`（整块粘进新会话即可） |
| 领任务 / 派活 | `docs/BACKLOG.md` + `.agents/prompts/task-packet.md` |
| 审核 | `.agents/roles/reviewer.md` + `.agents/prompts/review-packet.md` |
| 对抗性证伪 | `.agents/roles/adversary.md` + `.agents/rules/adversarial_review.md` |
| 代码约定 | `docs/08-conventions.md` |
| 路线与决策门 | `docs/ROADMAP.md` |
| 环境事实 | `docs/07-environment.md` |
| 本轮审核结论 | `audit/AUDIT_2026-10-28_R14.md`（本轮，含 §6 对抗性小节）· `AUDIT_2026-10-27_R13.md` · `AUDIT_2026-10-27_R12.md` · `AUDIT_2026-10-27_R8.md`（含 §7 独立复核与修正）· `R7` · `R6` · `R5` · `R4` · `R3` |
| 每步审核台账 | `audit/step_reviews.json`（门 `step-review` 校验；四轴 + 对抗性 + 产物 sha256；R21 起 114 步） |
| 授权/签署台账 | `audit/SIGNOFF.md`（谁授权、谁执行、HUMAN 没逐条看的部分，三者分列） |

---

## 8. 仍未解除的项（带 owner + 退出条件）

> **D1 已于 R6 通过**（9/10，`data/results/d1-2026-10-26T12-00-00.000Z.json`），因此下表不含 D1；但 D1 的标签目前是**实现方自证**（`BS-14` / T-111），对外口径只能是「机器可复算的命中率」。

| 项 | owner | 退出条件 |
|---|---|---|
| `T-111` label 自证（`BS-14`）：9 个命中无独立签署 | verifier + implementer | R7 起新案例由独立上下文签署 `label_verified_by` |
| `T-201 P3`：真 Remote 客户端（`pluginInventory/list` 走 `dsh-client-connection`） | implementer | token→cookie 握手已实测（303）；产出一份 `transport=remote` 的样本，且与 `in-process-projection` 那份逐行一致 |
| `B3` 边界（`BS-20`）：**preset** 的 `failed` / `broken preset` / `conditional` 三档仍无真机样本 | verifier | 沙盒里故意写坏一个 preset、加一条 `!!js` 门。**R14 已真机化主列表的 `failed`（apply 抛错）与 `null`（import 抛错）**——`inventory-live-2026-10-28T02-30-00.000Z.json`；preset 三档仍只有夹具 |
| `B1/B2` 静态侧不全（`BS-19`）：launcher 层与运行时动态挂载的行不在声明侧 | implementer | 与 T-202 一起做：给 `undeclared` 分类（动态 / launcher / 探针），而不是只给计数。**R12 已把 195 条噪声降到 3 条并可逐条解释（探针不再被评分）** |
| `T-202a` **agent/preset 作用域**的工具表面 | implementer | 在会话/组合作用域里读 preset 工具表面。**R14 的 probe 只到进程级（`BS-21` 未变）**；要真实会话须先解决铁律 4（不得读凭据）→ **R26 已出 ADR：`docs/adr/0009-agent-scope-reads.md`（proposed）**，HUMAN 勾 B 才开工，且必须满足其 6 条边界 |
| `T-401` DSH 设置面板（M4-a） | implementer | **R26 只做了只读契约 spike**（`docs/specs/M4-surface.md` §3.1 的 C1–C6，钉到上游 0.2.1-rc.4 的具体行号：`settings.plugins.tab` 插槽、`ctx.slots.register`、props 由 `inject` 提供、`remote.pluginInventory.list()` 形状、`ctx.effect`/`locale` 用法）。**未写 `client.js`**；退出条件：写出来后真机挂载出 `compat-triage` tab + 「契约不匹配 = 零注册」的单测 |
| `T-302` probe 的 `client-rendered` 断言 | implementer | ✅ **R15 交付、R16 扩到 Linux**：真浏览器 + CDP；无浏览器 `unmeasured`；CI `render-control` 每轮跑三份对照。剩余：不是视觉回归，canvas/icon-only 只能 `inconclusive` |
| `T-305` registry 候选的真实安装形状 | implementer | ✅ **R18 收口 + R19 扩容**：13 个真实 pin 候选安装 0.5–10.6s、boot 9.6–18.x s；1 个装不上（原因已于 R19 点名：pnpm build-script 审批） |
| `T-305b` 私有源 / 不可达 registry 的真实失败形状 | implementer | ✅ **R16 交付**：`--npmrc-registry` + `install.endpoints` 点名源（`probe-registry-private-2026-10-27T14-33-57.000Z.json`）。剩余：只在 Windows 上跑过这一次 |
| `T-308` 就绪窗口 / hook 时序（`BS-25`） | implementer | ✅ **R17 交付 + R18 补测**：端口向 OS 申请、判定分离、就绪同轮询、hook 代际保护、`startup failed` 原文归因；`slow-plugin`(6s)=go 与 `slow-overrun`(20s)=unknown 都有真机产物。**剩余**：Linux 等价端口排除段未测（`BS-27` 的跨平台部分） |
| `T-310` 安装失败归因 | implementer | ✅ **R19 交付**：`install.diagnosis{code,key_line,source}` + `probe.install-failed-code` / `probe.install-build-refused`；真机 3 种码（`IGNORED_BUILDS` / `NO_MATCHING_VERSION` / `RESOLVING_NPM_RESOLVER_NETWORK_ERROR`）可见，URL 去凭据/查询串。剩余：`peer` 冲突类错误未在真机出现（只有单测形状） |
| `T-311` 20s 预算 vs 未稳定窗口（`BS-28`） | implementer + arbiter | ✅ **R26（E）+ R28（T-312）两步收窄**：`settled:false` 不再等替换窗口；预算改判**第一份**样本（`slow-plugin` 5.4s 仍 `go`）。**未解除**：不可判墙钟 ≈30.4s（比 E 之后的 28.6s 略长，因为要等最终样本），`--unsettled-timeout` 仍 20000、`settle` 仍 15s；`A′`（settle→10s）与 `A″`（→8s）**未签且已实测有代价**（`dsh-mcp-connector` 会 `go`→`unknown`） |
| `T-316` 真 hook 的 `{error}` 夹具 | implementer | ✅ **R27 完成**：`--hook-config` 把 hook 的 `resolveFrom` 指向没有 projection 包的 profile，真实 hook 写出 `{error}/projection-missing`，执行器 `replacement_waited=true`/`waited_ms=5204`（窗口 5000）。**边界**：`inactive-context` 只有桩级证据（`tests/unit/probe-hook-error.test.ts`），不许说成真机回归 |
| `T-303` / `T-202a` 会话作用域读数 | verifier + implementer | ⛔ **R28 结论：当前不做（A 案）**。`docs/adr/0009` 已分析三案：B 只换来一个补证断言，代价是产品里永久存在一条读凭据路径，且 6 条边界挡不住下一问「帮我读 `~/.dsh`」。产物继续写 `namespace-diff: unmeasured`；**退出条件**：HUMAN 在 ADR-0009 签字区勾 B |
| `T-304` probe 只测空模板 profile | implementer | 用 profile 副本 + 依赖安装跑一次，回答「加到**我的**组合里会不会挂」 |
| `T-306` 非 web 表面的就绪判据 | implementer | ✅ **R15 已交付（web 面）**：`readiness.source=host-url` + 多端口 cleanup。剩余：tui/headless profile 仍靠 `--no-http` 人工出口 |
| `T-113` attw 式入口可加载性矩阵 | implementer | 先在沙箱实测 loader 解析模式（两种），再实现；否则会造假警告 |
| `T-114` `triage bisect`（VS Code 二分思路） | implementer | **前置 T-301 已于 R14 满足**：probe 能稳定启停一次 boot（11.8–13.8s） |
| `BS-16` 来源/副本扫描的边界：`overrides`/lockfile 手钉 / 两层以上嵌套不可见；未知版本不参与比较 | implementer | 出现误判先补样本再改扫描器；T-113 与 probe 是补全路径 |
| 0.2.x 真机 profile 未装在**用户机器**上（仓内沙盒已能挂载并采样） | implementer | R14 的 probe 已在沙盒里跑通一次 boot；「用户机器」要靠 T-304 的 profile 副本 |
| npm 未登录，尚未占位发布 | HUMAN | `npm login` 后发布 `dsh-triage@0.0.1`（先 `pnpm run release:check`） |
| 仓库仍 private | HUMAN | 决定转 public 时执行 `gh repo edit … --visibility public`（建议等 D2 后再定） |
