# BACKLOG · 可领取任务清单

> 规则：一个任务 = 一个可验收产物 + 一个角色 + 一个判据来源。领取前先读 `docs/HANDOFF.md`。
> **R38 整理**：T-310 曾有两条重复行（一条只写症状、一条带实现细节），已合并为一条；历史轮次的交付表（R16/R15/…）保留原样，它们不是待办清单。
> 状态：`⬜ 待领` / `🟨 进行中` / `✅ 完成` / `⛔ 阻塞`（阻塞必须写 owner + 退出条件）

| ID | 任务 | 里程碑 | 角色 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|---|---|
| T-101 | 真实案例验收：把「插件静默消失」案例跑通 `why` 并落 SSOT | M1 | verifier + adversary | — | 点名行 = 真实根因；`data/results/why-case-*.json` 的 `hit.verdict=hit` | ✅ **D1 通过：10/10 例，9 命中 / 1 有意 miss**（`data/results/d1-2026-10-26T12-00-00.000Z.json` → `gate.passed=true`） |
| T-104 | 再收 6 例真实案例（把 D1 门槛凑到 10 例 ≥8 命中） | M1 | researcher + verifier | — | 每例 `record_case` 可复现；命中率 ≥80% | ✅ 2026-10-26 收齐：CASE-10201/10759/10364/8751/8220（hit）+ CASE-7590（miss 负样本）；R6 审核见 `audit/AUDIT_2026-10-26_R6.md` |
| T-107 | 行级 `unknown`：admission 为 indeterminate 的行不得静默 | M2-a | implementer | — | 不声明任何 `@deepseek-ai/dsh*` peer 的行产出 `unknown` + `missingEvidence`；负对照：静默即红 | ✅ **R9 完成**：`verdictsFromRowAdmission` 对 `unconstrained` 行出 `unknown` + `missing.peer-declaration`；CASE-7590 由 0 verdict 变 2 verdict（`data/results/why-case-CASE-7590-2026-10-27T15-00-00.000Z.json`） |
| T-109 | npm dist-tag 失步信号进 `check --explain`（T-701 子项） | M2 | implementer | — | 能显示「latest=X / next=Y / 已发布最新=Z」并标 tier；不得据此越级判 blocked | ✅ **R10 完成**：`packages/core/src/version-drift.ts` + `check --explain` + `--json registry`；真机证据 `data/results/registry-2026-10-27T19-00-00.000Z.json`（三个上游包 latest 全落后） |
| T-108 | 读 `dsh.compatibility.dsh` / `dshReleases` 作为**次要证据** | M2-a | implementer | — | verdict 中与 peer 结论分列；tier 不得越级、不得单独判 blocked；CASE-7590 由 miss 升为 `unknown` + `missingEvidence` | ✅ **R9 完成**：`packages/core/src/compat-channel.ts` + `verdict.ts#compatSurfacing`；CASE-7590 仍判 miss，但 `miss_kind=explicit-unknown`（`data/results/d1-2026-10-27T15-00-00.000Z.json`） |
| T-111 | label 独立签署：`label_verified_by` 字段 + 独立 verifier 流程 | 流程 | verifier + implementer | — | R7 起新案例先由独立上下文复核并签署；`d1_report` 输出已签/未签比例 | ⬜ R6 独立复核发现 A9 / `BS-14`（D1 目前是自证） |
| T-113 | attw 式「入口可加载性矩阵」：按解析模式 × 入口判定候选包会不会 import 失败 | M2-b | implementer | — | 先在沙箱实测 loader 的解析模式（两种），再实现矩阵；否则会造出假警告 | ⬜ R8 借鉴台账（`docs/09`，attw 仅设计） |
| T-114 | `triage bisect`：禁用一半行 → 重启 → 收敛（VS Code Extension Bisect 思路） | M3 | implementer | T-301 | 需要稳定启停一次 boot；输出「坏行 + 时间线证据」 | ⬜ R8 借鉴台账（`docs/09`） |
| T-115 | 版本区间对齐建议：peer 精确钉定 → 上游每次 patch 都会打挂（syncpack 思路） | M2 | implementer | T-109 | 与 T-109 合并设计；只提示不阻断 | ✅ **R10 完成**（与 T-109 同一轮）：`judgeRangeShape` + `admission.range-exact-pin` / `admission.range-unbounded`；仅 `check --explain` 出现，`conclusion` 不变 |
| T-116 | `messageId` 的 `{占位符}` 必须由 `reasons[].params` 提供，缺一即红 | 流程 | implementer | — | `gate_verdict_contract` 新增占位符完整性断言 + 负对照；现状只校验 messageId/severity | ✅ **R9 完成**：门新增 `placeholder-params-required`（双向自测：缺即红、补齐即绿，`reasons[]` 与 `remediation[]` 同规则）+ `--mutate` 注入第二类违规 |
| T-117 | 行级「peer 通过但 `dsh.compatibility` 相左」是否提示（`BS-17`） | M2-a | implementer | T-108 | 先定粒度（每模块一条）与是否进 `unknown`，再实现；在此之前文档明确「行级只在 `unconstrained` 时挂兼容通道」 | ⬜ R9 独立复核发现（行级相左目前不提示） |
| T-102 | `why` 支持 stderr 归因（import/apply 失败 → 行） | M2-b | implementer | T-201 | 3 类真实故障都能点名 | ⬜ |
| T-103 | 补 6 条金标：`workspace:` peer、`engines` 畸形、`^0.2.0` prerelease 边界 | M1 | implementer | — | parity 门绿 + 夹具 `why` 说明 | ✅ **R14 完成**（HUMAN 2026-10-27 签字）：21 → **27 条**（+6 synthetic：workspace: peer / engines 非字符串 / `^0.2.0` prerelease 边界 / 空串 engines / `*` peer / 非法 engines 优先于 peer）。六条**全部与文档语义一致，未暴露分歧**；原有 21 条未改 |
| T-201 | 接入 `pluginInventory/list`（相位）到 `audit`/`why` | M2-a | implementer | — | 契约已在 `docs/specs/M2-inventory.md` 锁定（B1–B5）；实现走 P1 进程内 + P2 快照文件 | ✅ **R12 完成 P1（进程内投影）+ P2**：沙箱 Host 内 `readPluginInventory(ctx)` 真采样 → `data/results/inventory-live-2026-10-27T22-00-00.000Z.json`（`sample.kind=live`，195 行，`cross_check.agree=true`，B1/B2 关闭）；**Remote 客户端（真 `pluginInventory/list`）留作 P3** |
| T-112 | `agentPresets` 维度：同一 entry 在不同 preset 下相位不同，必须分开出结论 | M2-a | implementer | T-201 | 不取「最乐观值」；只有 `conditional` 的 preset 行标 `unknown` + 需会话上下文 | ✅ **R12 完成**：preset 分行判（`conditional` / `failed` / `no-fiber` / `broken` / 跨 preset 分歧五档），真机样本 4 个 preset / 98 行；`runtime.preset-*` 命名空间三处同改 |
| T-202a | 运行时命名空间快照（**agent/preset 作用域**：tools/commands/settings/skills） | M2-b | implementer | T-301 或一次真实会话 | 在会话作用域里读出 preset 的工具表面，才谈得上「声明 vs 注册」 | ⛔ **当前不做（A 案，R28 自评）**：进程级探针只看到全局层 1 个工具（`BS-21`），上游也不静态声明工具名（`BS-22`）；`docs/adr/0009` 已把「要不要破铁律 4」写成可签字的题，结论是维持现状。**退出条件**：HUMAN 勾 B |
| T-202b | 能力层事实：全局层工具清单 + 两样本差分 + 边界登记 | M2-b | implementer | T-201 | 快照落 `data/results/capabilities-*.json` + 哈希；差分可点名「关掉这一行后能力怎么变」 | ✅ **R13 完成**：`packages/core/src/capabilities.ts` + `scripts/record_live_capabilities.mjs`；产物 `capabilities-2026-10-27T23-30-00.000Z.json`（`outcome=expectation-not-met`，正是边界 B2 的机器可读形式）；spec `docs/specs/M2-capabilities.md` |
| T-203 | 冲突分级 v2：service / tool / command / slot / theme 权重表 | M2-a | implementer | T-202 | 单测覆盖 5 类；文档 `docs/03` F4 更新 | ⬜ |
| T-105 | `audit` 与 `why` 结论同源：`audit` 也要给出行级 admission 结论 | M2-a | implementer | T-201 | 同一 profile 下两命令交叉一致（e2e 断言） | ✅ **R13 完成**：`audit` 复用 `verdictsFromRowAdmission` + `--json row_verdicts` + 文本逐行结论；e2e「audit and why reach the same row-level admission conclusion」比两命令的 `subject|conclusion|reasons` 集合；`unknown` 不计入失败（与 `why` 默认一致） |
| T-106 | `step-review` 升级：结论必须引用具体反例命令/路径的结构化字段 | 流程 | implementer | — | 套话无法通过（新增结构化断言 + 负对照） | ⬜ 对应 BS-09 |
| T-301 | probe 执行器（boot/http 两段） | M3 | implementer | T-201 | 单次 ≤20s；失败清理；dry-run 默认 | ✅ **R14 完成**：`packages/probe/src/{exec,host}.ts` + CLI `probe --execute --dsh-main` + `scripts/record_probe.mjs`；真机绿跑 `go`（boot→sample **11.8s**，HTTP 401，行 active）+ 两红（`failed` / `null`）稳定复现；清理以「目录消失 + 端口不再应答」双判据。证据 `data/results/probe-{ok,red-apply-fail,red-import-fail}-2026-10-28*.json`；spec `docs/specs/M3-probe.md` |
| T-302 | probe 的 client-rendered 断言（BS-03） | M3 | implementer | T-301 | 能识别「HTTP 200 但白屏」 | ✅ **R15 完成**：`packages/probe/src/render.ts`（`judgeRender` 纯函数 + `findBrowser` + 无头 Chromium/CDP `renderUrl`）；真机绿跑 `client-rendered=passed`（289 字符 / `readyState=complete`）；红样本 `render-fixture-blank-2026-10-27T12-58-42.000Z.json`（200 + 空挂载点 → blank）；无浏览器/超时 → `unmeasured`，不判通过 |
| T-303 | probe 的 namespace-diff 断言 | M3 | verifier | T-202, T-301 | 声明了但未注册的工具能被列出 | ⛔ **当前不做（A 案，R28 自评）**：`docs/adr/0009` 分析了三案，结论是「为一个补证断言引入读凭据路径不划算」。产物继续写 `namespace-diff: unmeasured`；**退出条件**：HUMAN 在 ADR-0009 签字区勾 B，并按 6 条边界先写测试再实现 |
| T-401 | Web 面板骨架（`settings.plugins.tab`） | M4-a | implementer | 上游 cordis 类型 | 面板显示与 CLI 同源结论 | ✅ **R30 写 · R31 真机注册 · R33 收口**：`client.js`（classic script、零打包器、契约不匹配=零注册）+ `dsh.client` + `exports["./client"]`；真机六步全绿后，R33 补上最后两件并以 `ADR-0010` 定了通道：① **`visible`** —— 关首启浮层 → 开设置 → 进「内置插件」→ DOM 里出现 `分诊台` 且点击后 tab body 出现 `dsh-triage audit`（`data/results/client-serve-2026-10-29T01-20-00.000Z.json`）；② **`same-source`** —— tab 渲染的 192 行 / 0-0-184 与同一 profile 上 `dsh-triage audit --json` **逐项一致**。通道选**同源只读路由**（`packages/plugin/src/host-audit-route.ts`），没选 Typert Remote：真机证明后者 host 侧可注册、浏览器侧拿不到（`spike-typert-*` vs `spike-route-*`）。**两条负对照**：标签换成不存在的 → `visible:failed`+exit 1；CLI 指到另一个 home → `same-source:failed`（192 vs 190） |
| T-405 | `dsh-triage serve` 本地只读面板 | M4-a | implementer | — | 零依赖、只绑回环、token 鉴权、跨源拒绝、POST 默认 403 | ✅ **R16 完成 v0**：`packages/plugin/src/serve.ts` + CLI `serve --port/--results/--allow-execute`；smoke 8/8（`data/results/serve-smoke-2026-10-27T14-12-16.000Z.json`）；只列 SSOT 产物，不重算 |
| T-406 | 面板接实时 `audit`（`/api/audit`） | M4-a | implementer | T-405 | 抽取 `loadAuditData()` 后，`audit --json` 逐字节不变；面板显示当前组合 | ✅ **R19 完成**：`packages/plugin/src/audit-data.ts`（`loadAuditData`/`auditJsonPayload`/`auditExitOutcome`）+ `serve --audit`（默认 501、读不到 409）+ 页面「当前组合」区块。**逐字节负对照**：同 profile/同 stamp 下抽取前后 `audit --json` sha256 一致（`EE1D3AC5…` 夹具 profile / `BEC85449…` 真实 profile）；冒烟 13/13 且 `/api/audit` 与 `audit --json` 逐条一致 |
| T-310 | 安装失败的**原因**只留最后一行 | M3 | implementer | T-305 | 产物能点名错误码或关键错误行（如 `ERR_PNPM_FETCH_404` / peer 冲突），且不泄漏凭据/查询串 | ✅ **R19 完成**：`host.ts#installDiagnosis`（launcher 优先、诊断日志兜底、`dsh:` 行不算原因、URL 去凭据/查询串）+ `probe.install-failed-code` / `probe.install-build-refused` 两条新文案 + 产物 `install.diagnosis{code,key_line,source}`。真机：`@aiwayds/dsh-cron@0.6.1` = `ERR_PNPM_IGNORED_BUILDS`（`probe-real-dsh-cron-2026-10-28T09-30-00.000Z.json`）；另外三种合成失败也各自点名了码 |
| T-311 | **20s 预算 vs 20s 未稳定窗口**（`BS-28`） | M3 | implementer + arbiter | T-308 | 出 ADR 并落地文案 | ✅ **R26 完成（方案 E）**：`ADR-0008` 签字区的 E 已实施 —— `settled:false` 不再开替换窗口（`inventory.replacement_waited=false`），`{error}` 仍等满 `--unsettled-timeout`；默认值（20000）、`settle 15s`、readiness 5s、`boot→sample ≤20s` **一字未动**。真机：不可判 `boot` 步 **48.4s（R23）→ 28.6s（R26）**（`data/results/probe-adr0008e-overrun-2026-10-28T22-30-00.000Z.json`）；三条回归见 `docs/adr/0008-unsettled-wait.md` §实施记录。**剩余**：不可判仍 ≈29s（>20s），要压进 20s 只能改 settle 上限或两阶段取样（T-312）；墙钟是区间（21.7–28.6s，`BS-32`） |
| T-316 | **真 hook 的 `{error}` 夹具**：现在「`{error}` 仍等满窗口并采用替换样本」由**假 launcher** 的单测证明（`tests/unit/probe-host-sample.test.ts`），不是真实 Host 写的 | M3 | implementer | T-311 | 在沙盒里造出一个能让 `inventory-hook` 真正写出 `{error}` 的形态（例如在 apply 后立刻 unload 注入服务），真跑一份 `unknown` + `sample-unreadable` 或 `tree-not-settled` 的产物。在此之前**不许**声称「真实 Host 的 `{error}` 路径已回归」 | ✅ **R26 完成（真机）**：新增诊断开关 `--hook-config`（`record_probe` + `realProbeDeps.hookConfig`），把 hook 的 `resolveFrom` 指向一个没有 projection 包的 profile → **真实 `inventory-hook.mjs`** 写出 `error.code=projection-missing`、`settled:false`；执行器 `replacement_waited=true`、`waited_ms=5203`（窗口 5000）、`stoppedBy=unreadable-window`，结论 `unknown` + `missing.inventory` + `probe.sample-unreadable`（`data/results/probe-adr0008e-hook-error-2026-10-29T00-10-00.000Z.json`，F48）。另外新增 `tests/unit/probe-hook-error.test.ts`：**跑真实 hook 文件**，用会抛错的 projection 桩钉死 `inactive-context` 与 `projection-missing` 两个 code 与 `settled:false`。**边界**：本轮真跑用的是 `projection-missing`（半装坏的 profile，真实形状），`inactive-context` 只有桩级证据——**不许**把后者说成真机回归 |
| T-407 | CI `render-control` 作业（Linux 真浏览器） | M3/M4 | implementer | T-302 | runner 自带浏览器；blank/rendered/error 三份对照；缺浏览器即失败 | ✅ **R16 完成**：`.github/workflows/ci.yml` 新 job；本机同一命令已落 SSOT（`render-fixture-blank-2026-10-27T14-02-15.000Z.json`） |
| T-402 | 徽章服务（SVG，插件×dsh×os） | M4-b | implementer | — | 徽章可按 SSOT 渲染；带 dsh.so 署名 | ✅ **R34 完成**：`packages/plugin/src/badge.ts` + CLI `badge <pkg[@ver]>`（`--json` / `--out`）；只读 `probe-*` 产物、排除 `sandbox.hook_config` 的诊断样本、没有测量渲染 `not measured`；8 条单测 + 真机产物 `data/results/badge-2026-10-29T02-30-00.000Z.json`（`go` 与 `not measured` 各一例）。**未使用 dsh.so 数据，因此本产物不需要 CC BY 署名**；将来若引入其信号再补 |
| T-403 | format-1 索引源生成器 | M4-b | implementer | T-402 | 输出通过 `format:1` 字段校验；可在 Discover 添加 | ✅ **R34 完成**：`packages/plugin/src/index-source.ts` + CLI `index [--out]`，只收「实测 go」的 registry 版本（最新一次生效、诊断样本排除），`publishTimestamp` 取 registry 逐版本 `time`、拿不到就排除；**用上游校验器**验证（沙盒里的 `@deepseek-ai/dsh-plugin-market-index`），真机产物 `data/results/index-source-2026-10-29T04-00-00.000Z.json`：**5 插件 / 5 版本通过校验**；8 条单测钉死「不打分、不猜时间戳、`workspace:` 范围不出现在索引里」。**剩余**：托管成可被 Discover 添加的 URL 需要发布动作（HUMAN） |
| T-404 | `compat_verdict` Agent 工具 | M4-b | implementer | T-201 | 工具返回 verdict JSON；失败降级 `unknown` | ✅ **R36 完成 · R40 补 ptc 真机**：`packages/plugin/src/fit.ts`（与 `check` 同一条引擎链）+ `host-tool.ts`（纯对象定义，**不引上游依赖**）+ `host.ts` 把 row 拆成两半各自 `ctx.inject`。**R36 真机**（`agent-tool-2026-10-29T12-20-00.000Z.json`）：`registered:true`、`schemas()` 可见、三次调用都走 `tools.execute()`。**R40 补 `BS-39`**：`--tools-mode ptc` 给 `tools` 行写 `config.mode: ptc`（`ExtraPatchEntry` 新增 `config`，**浅覆盖**语义写进注释），真机 `schemas()` = `[compat_verdict, working_directory, run_code]`、`tools.execute()` 三次全拒（`only run_code is callable directly`）、hook 回落到定义答出三形状；native 对照 3/3 走 registry（`agent-tool-ptc-2026-10-29T03-05-00.000Z.json` / `agent-tool-native-2026-10-29T03-20-00.000Z.json`）。**仍开**：`run_code` 程序内部调用、模型自发选择、`BS-38` 跨 profile |
| T-408 | 发布链：四个包按依赖顺序上架 + **匿名**安装验证 | M4-b | implementer | T-404 | registry 上的字节 = 本地验证过的字节；无凭据机器能装能跑 | ✅ **R40 完成**：`scripts/record_publish.mjs`（registry 逐包 integrity/shasum 与本地 tarball 比对、空 `npm_config_userconfig` 下 `npm install`、CLI 真跑、`import()` 导出）→ `data/results/publish-2026-10-29T01-40-00.000Z.json` **20 项全绿**。**踩到的三件事**：npm 不重写 `workspace:*`（会发坏包）、`@dsh-triage` scope 要先建免费 org、写操作强制 OTP（非交互报 `ERR_PNPM_OTP_NON_INTERACTIVE`），都已写进 HANDOFF §4 |
| T-501 | 回流 schema + opt-in 开关 + 删除路径 | M5-a | implementer + reviewer(合规) | — | 0 PII；可删除；文档说明 | ✅ **本地半边 R41 交付**（`packages/core/src/outcome.ts` + `packages/plugin/src/outcomes/` + `outcomes --purge`；真跑 24/24）。**上传/聚合仍 ⬜**：需 `ADR-0012` + HUMAN 签字 |
| T-502 | 升级影响清单生成器（给定目标 dsh 版本） | M5-b | implementer | T-201 | 24h 内产出；含修复建议 | ✅ **R42 交付**（`upgrade --to` 四桶分区，真机 192 单元 / 119 拒） |
| T-503 | **点亮 `improved` 桶**（R42 唯一空洞）：造一份混合声明的组合，让「今天拒、目标放行」在真机上出现 | M5-b | implementer + verifier | T-502 | `counts.improved > 0`，每个改善单元同时带「当前拒绝原因」与「目标放行」两侧证据；四桶非空 | ✅ **R44 完成**：先扫描取证（1584 包 / 202 今天被拒 / **前向 0** → `data/results/upgrade-declarations-2026-10-29T07-05-00.000Z.json`），再按真实声明策展 6 个发布包（`scripts/prepare_upgrade_mixed_profile.mjs`，`--ignore-scripts` + 空 userconfig）：`--to 0.2.1-rc.3` 得 **3 改善 + 1 拒 + 1 不可判 + 1 像没事**（`data/results/upgrade-mixed-2026-10-29T07-10-00.000Z.json`，30 项自检）。**形状是降级几何**（`BS-42`）；顺带修掉三个记录器缺陷（见 R44 报告 §4） |
| T-504 | **`upgrade --registry` 的成功分支**：证明真查到的注解也不能搬桶 | M5-b | implementer | T-502 | `registry.facts > 0` 且 `units[].bucket` 与离线跑逐条相同 | ✅ **R44 完成**：`record_upgrade_impact.mjs --registry-live`（真联网 `facts = 2` / `failures = 0`，注解 `admits_target: false`，桶与计数一字未变）→ `data/results/upgrade-registry-live-2026-10-29T07-15-00.000Z.json` |
| T-505 | **渠道状态刷新**（只读，不提交新 PR） | 增长 | arbiter | — | 读 `submitted[].state`，`merged` 才算收录 | ✅ **R44 完成**：`data/results/market-channels-2026-10-29T07-20-00.000Z.json`（#65 `open/blocked`、#193 `open/APPROVED`、`merged = 0`） |
| T-601 | 上架文案（zh/en）+ 提交 3 渠道 | 1.0 | arbiter | 功能完成 | `gate_release --publish` 绿 + 2 渠道收录 | 🟨 **R45：文案与提交完成，收录未达成**。`docs/market/listing_zh.md` 刷新 + `listing_en.md` 新增；第三条渠道 **PR #140**（walkinglabs，`+1/-0`）；`gate_release` 绿。**`merged = 0`**（#65 待审 / #193 APPROVED 未合并 / #140 新开），所以 1.0 仍被外部合并卡着 |
| T-602 | 案例帖 ×3（消失的工具 / 白屏 / 升级后起不来） | 增长 | researcher | T-101 | 每篇含真实 SSOT 证据 | ✅ **R45 完成（**草稿未发布**）**：`docs/posts/01-tool-disappeared.md`（CASE-11080 行级归因）· `02-white-screen.md`（200 但白屏，红/绿对照）· `03-before-you-upgrade.md`（四桶 + 1584 扫描前向 0 + prerelease 区间陷阱 + 边界）。发布前须重跑文中命令 |
| T-603 | **文案与仓库的一致性检查器**：版本 / DSH 区间 / 测试数 / 证据路径 / 禁用话术 / 文章登记 / 两条边界 | 流程 | implementer | — | 任一项漂移即判红；边界段落被删也判红 | ✅ **R45 完成**：`scripts/check_listing.mjs`（8 条断言，产物 `listing-*.json`）。**第一次跑就抓到三份对外文档残留 `dsh-triage@0.1.0`**（红产物 `data/results/listing-2026-10-29T08-00-00.000Z.json` 保留），修后 8/8 全绿 |
| T-701 | 把 `dsh.so` 数据接入 `check`（作为先验，tier 不得越级） | M2 | implementer | — | `--explain` 显示 registry 先验与本地结论差异 | ⬜ |
| T-801 | **升级日卡片渲染**（M6 正门）：首行结论 + 四桶计数表 + 可粘贴 markdown + 边界句 + 复算命令 | M6 | implementer | — | `docs/specs/M6-upgrade-day.md` 的 C1–C8 与 N1–N13 全过；`upgrade-card` 纯函数；真机产物 `data/results/upgrade-card-*.json` | ⬜ |
| T-802 | **D5 公开样本投放**（唯一的产品判断）：一张真机卡片 + 一次对应 rc 的 Discussion | M6 | arbiter + HUMAN | T-801 | 2 周内 reactions ≥10 · 外部引用 ≥1 · 周下载 ≥20；不达标 → 执行 D（作品集 + 上游 PR） | ⬜ |
| T-803 | **A 支线（D5 达标后才做）**：把兼容判定做成数据包交给 `dshmarket` / `dsh-plugin-catalog`，用户不下载我们 | M6 | implementer + HUMAN（BD） | T-802 | 被 ≥1 个 ≥10k 周下载的路径消费（产物里能指到对方仓的引用） | ⛔ 等 T-802 |
| T-804 | **C 支线（D5 达标后才做）**：作者侧 GitHub Action 兼容矩阵（7,557 条 catalog 口径待核） | M6 | implementer | T-802 | ≥3 个外部仓在 CI 里引用；指标从下载量改为「被引用数」 | ⛔ 等 T-802 |
| T-805 | **boot 守卫（留存）**：boot 时快照 + 只在「变坏」时说一句 + 本地历史账本 | M6 | implementer | T-802 | 10 次 boot 只在第一次变坏时说一次；账本可 purge；不写 `~/.dsh` | ⛔ **按 `BS-44` 推迟**：D5 之前不做留存类功能 |
| T-308 | 就绪窗口与 hook 时序：慢候选不得被写成 blocked | M3 | implementer | T-305/T-308 | Host 打印 URL 为准 + 窗口可配；hook 在 `inactive context` 时重试，耗尽只能 `unknown` + `missing.inventory` | ✅ **R17 完成（含一个更严重的自伤缺陷）**：① 端口改为 `findFreePort()` 向 OS 申请 —— 本机 TCP **53461–53560** 是排除段且会话中会变，哈希选中的 53506 绑不上，`webserver` 行 EACCES 导致整棵树起不来（**正常候选被写成 blocked**）；修后 `dsh-whale-widget@0.4.2` = `go`（boot 5.9–6.8s）。② hook 增 `settled`/`attempts`/`applies` + 代际保护；`inactive context` = 我们的 fiber 被 unload（Cordis 会重跑 apply），所以只 `unknown` + `missing.inventory`。③ 就绪 URL 与端口同轮询，`readiness` 记 `outcome/waited_ms/window_ms/url_seen`；settled 树 5s 阈值不变，unsettled 树 20s 窗口只能出 `unknown`。④ `startup failed` 照抄 launcher 原文（`probe.startup-failed`）并提前收敛（126s → ~6s）。证据 `data/results/probe-registry-whale-2026-10-27T17-05-00.000Z.json`、`probe-slow-normal-*`、`probe-matrix-2026-10-27T17-20-00.000Z.json`（n=7 / 真实 2 次全 go / 清理 7-7）。**剩余**：延迟 >15s 的 `slow-overrun` 真机夹具、Linux 是否有等价端口排除段 |
| T-309 | **D2 分母扩容 + 判定**（判据修好后才有意义） | M3 | verifier + implementer | T-308 | ≥10 次真实启动、≥5 种失败形状；成功率 = `go/(go+blocked)`，`unknown` 单列；矩阵摘要带 `real_starts` | ✅ **R18 首判 + R19 扩容 + R27 post-E 重测**：R27 批次 n=20（真实 **13** / 夹具 4 / 合成 3），真实 12 `go` / 1 `blocked`，`expectation_misses=0`，清理 20/20，形状 6 → **`d2-2026-10-29T01-30-00.000Z.json` 的 `gate.passed=false`**（唯一红项 `boot-budget`：11/12，超时的是 `real-mcp-connector` 22.5s）。产品数字不变（12/13，Wilson 0.667–0.986）。**剩余**：预算红项按 `ADR-0008` §剩余项等签（`BS-28`/`BS-32` 已有真实见证）；便利样本仍需持续加批次 |
| T-318 | **`replacement_waited` 在 T-312 之后说错话**（`BS-33`）：升级等待（可读的 provisional）被记成替换等待，20/20 产物与文档教读者的读法相反 | M3 | implementer | T-312 | `waited` 只在样本不可读时置 true；新增 `replacement_reason`；升级等待单独暴露；判据与等待不动 | ✅ **R29 完成**：`host.ts` 收窄 `waited` + 新增 `reason`，`record_probe.mjs` 出 `inventory.replacement_reason`，`exec.ts` 的 detail 把 `upgrade=waited(…)` 与 `replacement=…` 分开；单测 +3 断言（`tests/unit/probe-host-sample.test.ts` 6/6）。真机：修后批次 20/20 `replacement_waited=false` + `reason=upgrade`，结论与修前逐条相同（`data/results/probe-matrix-2026-10-28T09-40-00.000Z.json`） |
| T-319 | **稳定性只有点估计**（`BS-32`）：同一候选在不同批次里 `boot→sample` 差 3 倍，而仓库一直用「一次几秒」说话 | M3 | implementer | T-312 | 多批同 plan 矩阵 + 一份分布报告（min/median/p90/max、超预算次数、结论是否稳定），且**拒绝单矩阵**、**不设 gate** | ✅ **R31 完成（空载分布）+ R37 完成（有载对照）**：`scripts/stability_report.mjs` + 4 条契约测试；R31 三批空载 → 36 次真实观测 3.5–9.6s。**R37**：`record_probe_matrix.mjs --load <n>` 起 CPU-busy worker 并在产物记 `load{workers, cores, observed_busy_percent}`（`os.cpus()` 累计时间差——`os.loadavg()` 在 Windows 恒为 0，用它就是假读数）；两批 idle（4.4–11.8s，median 5.1s，0/23 超预算）+ 两批 8-worker 有载（58–62% 占用，5.8–8.3s，median 7.4s，0/24 超预算，**1/40 无产物**），`stability_report` 新增 `conditions[]` 按机器条件分组（也把「无产物」单列，不再折进 `unknown`）。**结论**：有载把中位数抬 ~45%，但没把任何真实候选推出 20s；结论稳定性 13/13 不变（唯一例外是探针自身故障，见 `T-321`）。**边界**：CPU 载荷一种、单用户、单机（`BS-40`） |
| T-317 | **`d2_report` 的判定结果没有退出码**：`gate.passed=false` 时脚本仍 exit 0（R18 定为「失败也是数据，不是基础设施错误」，并有测试钉住） | 流程 | implementer | T-309 | 若要进 CI 或自动化，需要 `--strict`（判定失败即 exit 1，但同时保证产物已写）；在此之前**任何自动化都不得以 exit code 判断 D2** | ✅ **R29 完成**：新增 `--strict`（判定失败 → **产物与 `.sha256` 先落盘**，再 exit 1）；默认模式行为不变（仍 exit 0，R18 的决定保留）。严格模式的 `gate` 行追加 `· strict → exit 1`。单测 +2（红批次 exit 1 且产物在 / 绿批次 exit 0），`tests/governance/d2-report.test.ts` 10/10。真机：批次 B 的 D2 用 `--strict` 跑出 exit 0（`data/results/d2-2026-10-28T10-20-00.000Z.json`） |
| T-304 | probe 对「用户自己的 bundle 集合」取样（现在只测空模板 profile） | M3 | implementer | T-301 | 用 profile 副本 + 依赖安装跑一次，能回答「加到**我的**组合里会不会挂」；当前只能回答「加到模板 profile 里」 | ✅ **R22 完成**：`probe --copy-profile <name>`（+ `record_probe --copy-profile`）复制四个声明文件 → 装依赖 → 装候选 → boot；终止条件 5 条全达成。真机三形状：`copy:upstream` + 夹具 = **go**（boot→sample 7.4s / 401 / 渲染 2182ms / 行 `active` / `candidate_registered=true`）· 装不上 = **unknown**（`ERR_PNPM_FETCH_404` + `probe.profile-copy-unusable`）· 悬空 `link:` = **unknown**（install **exit 0** 也抓到，`probe.profile-link-dangling`）。产物 `data/results/probe-copy-profile-ok-2026-10-28T14-30-00.000Z.json` / `probe-copy-profile-unusable-2026-10-28T14-40-00.000Z.json` / `probe-copy-profile-dangling-2026-10-28T14-50-00.000Z.json`。**剩余（新盲区）**：`BS-30`（沙盒不构建原生模块，`go` 不等于你机器上构建后的行为）/ `BS-31`（只搬声明，链接与私有源场景只能 `unknown`） |
| T-315 | **复制模式的 pnpm 构建审批口径**：沙盒写 `strictDepBuilds: false` 让 install 退出 0 并注册 bundle（R22 F43），但这属于「沙盒环境设置」，需要一个 ADR 记录边界（谁授权、改了什么、没改什么），并顺带审计 pnpm 其它可被继承的设置（`onlyBuiltDependencies`、`nodeLinker`、`strictPeerDependencies`） | M3 | implementer + arbiter | T-304 | ADR 落地：明确「不批准任何构建、只把错误降为提示」；`profile_copy.pnpm_policy` 三态（`source`/`sandbox`/未执行）在产物与文案里一致 | ✅ **R23（ADR-0007）+ R26 `nodeLinker` + R31 布局读数 + R33 `strictPeerDependencies`**：严格 A/B（同一复制源、同一候选，两组都写 `strictDepBuilds: false`，只差该键）—— strict 组 profile install `exit 1` + `ERR_PNPM_PEER_DEP_ISSUES` → `unknown`；对照组 `exit 0` → `go`（4.7s / 401 / 行 active），两轮复现。结论：该键**被 launcher 读到并生效**，真实 profile 存在 peer 问题。**新盲区 `BS-36`**：只要复制源自带 workspace 文件就 `pnpm_policy=source`，会连带丢掉 `strictDepBuilds: false`（R33 的第一次对照因此作废）。**剩余**：`onlyBuiltDependencies`、`packageManager` 等其它可继承键仍未逐一实测 |
| T-320 | **Typert Remote 作为面板通道**（`ADR-0010` 的未选方案）：host 侧手写 manifest 可行，浏览器侧需要 `remote-client` 生成物（带 `zod`） | M4-a | implementer | `ADR-0010` | 只有当我们愿意引一条客户端生成链时才做；做的话必须同时改「client.js 手写、无打包器」那条决定 | ⛔ **当前不做（R33）**：真机证据 `data/results/spike-typert-2026-10-28T23-30-00.000Z.json`（`registry:passed` / `call:unmeasured`）；同源路由已满足 M4-a 出口（`spike-route-2026-10-29T01-40-00.000Z.json`）。**退出条件**：HUMAN 愿意接受客户端构建链并重开 `ADR-0010` |
| T-321 | **探针自己的临时目录失败会被判成插件失败**（R37 真机发现）：`bootAndSampleHost` 里 `rmSync(probeDir)` 抛 `EPERM`（Windows 持有句柄）→ 异常逃出 → `boot` 步失败 → 判据落到 `probe.boot-timeout` → **`blocked`** | M3 | implementer | T-308 | scratch 的准备/清理失败必须**记录不抛**，判据产出 `unknown` + `missing.probe` + `probe.measurement-unavailable`，三件套 `unmeasured`；清理失败不得销毁已拿到的样本 | ✅ **R37 完成**：`packages/probe/src/host.ts` 把准备失败与删除失败都写成 `setupError` / `scratchCleanupError`（新增 `unmeasuredBoot()` / `removeScratch()`，后者在 `finally` 也只记录）；`packages/probe/src/exec.ts` 把 `boot` 步抛的任何异常记成 `bootSetupError`，判据新增 `probe.measurement-unavailable`（`probe.*` 命名空间已存在，门不需要改）。**负对照**：`tests/unit/probe-exec.test.ts` 的 N24（`setupError` → unknown，不落 `boot-timeout`）与 N24b（boot 步抛异常 → 同样 unknown）。**历史见证保留**：`data/results/probe-matrix-2026-10-29T15-30-00.000Z.json` 里 `real-unlag@1.12.5` 被记成 `blocked`（`boot.detail` = `EPERM … triage-live-…`）——**那份产物不改**，它就是这条缺陷的唯一真机见证。**剩余**：无法按需复现这种句柄占用（`BS-41`） |
| T-313 | 凭据来源审计：~/.pnpmrc / PNPM_HOME / 系统级 npmrc / corepack / 代理变量是否被沙盒读到（BS-29） | M3 | verifier | T-310 | 对每个来源做黑盒对照（同一条失败安装，逐源关闭），产物里 install.registry_auth_used 只有在**所有**来源关闭后才敢声称 0；对外口径同步 docs/adr/0004 | ✅ **R23 完成（收窄而非关闭）**：`scripts/audit_credential_sources.mjs` 用**本地假 registry 记 `authorization` 头**（不再靠 pnpm 日志——实测合成 token 不打印那行，靠日志会假阴性），六类来源 × `404`/`401` 两种应答 = 10 组 + 对照组 + 30 次运行全部失败。结果：**只有 user config 会被读**（`globalconfig` / `$XDG_CONFIG_HOME/pnpm/rc` / `PNPM_HOME` / `COREPACK_HOME` 的旋钮在 launcher 路径下未被读），且它在 404/401 两种模式下**都不再上网**。产物 `data/results/credential-sources-2026-10-28T19-00-00.000Z.json`。**剩余**：硬编码配置路径、非 Windows、pnpm/launcher 其它版本（`BS-29` 已改写） |
| T-312 | probe 两阶段取样（先用 provisional 样本在 20s 内返回，再续采升级） | M3 | implementer | T-311 | 改 hook 写出协议（两次写样本 + 代际保护）与执行器（接受「先 unknown 后升级」），并重跑 R17/R18 的全部时序负对照；不达成就维持 ADR-0006 的「可判 20s / 不可判 48s」口径 | ✅ **R28 完成（HUMAN：立项 T-312 两阶段）**：hook 先写 `provisional:true`/`settled:false` 的样本，settle 结束后覆盖成最终样本；执行器**判第一份**为预算（`bootToSampleMs`），等最终样本的窗口 = 样本自报的 `settle_timeout_ms` + 1s，并记 `inventory.upgraded` / `upgrade_waited_ms` / `timings.bootToFinalSampleMs`。真机：`slow-plugin` 第一份 **5.4s** / 最终 10.7s / **仍 `go`**；`slow-overrun` 第一份 9.4s / 最终 24.5s / 仍 `unknown`；`dsh-mcp-connector@0.2.83` 第一份 10.1s / 最终 25.2s / `unknown`（该候选今天两次未在 15s 内稳定）。**代价**：不可判墙钟 ≈28.6s → ≈30.4s（用户更早知道「不可判」，但最终样本仍要等）；`E` 与 `{error}` 的既有语义未变。**剩余**：D2 必须按新口径重跑矩阵才有结论 |
| T-314 | **`boot` 步墙钟分解**：实测正常候选 22.1–25.3s、永不 settle 42.7s，而 `boot→sample` 只有 9.6–12.2s；多出来的 ~12s / ~21s **没有解释** | M3 | implementer | T-301 | 给 `boot` 步加分段计时（spawn / hook 写样本 / settle 1s / readiness / 杀树 / 删除），产物里能逐段读出；据此决定是否优化、以及 ADR-0006 的对外文案 | ✅ **R23 完成**：`timings.bootSegments`（spawn/sampleWait/sampleMtime/settle/readiness/render/kill/postKillWait/scratchCleanup/total），`d2_report.timing.boot_breakdown` 给各段最大值。**差额已解释**：正常候选 15.7–16.2s = sample 6.3 + settle 1.0 + **render 4.7** + **杀树 2.2–2.7** + 杀后 1.2；不可判 **48.4s** = sample 19.1 + **替换等待 20.3** + settle 1.0 + render 4.5 + 杀树 2.2 + 杀后 1.2。**推翻了 R21 的两个数字**（25s 与 43s），ADR-0006 与 spec §4 已按实测改正。阈值仍未动 |
| T-305 | registry 候选的安装形状（网络、tarball、私有源） | M3 | implementer | T-301 | 至少一次真实 npm 来源的 probe；记录耗时与失败形状（本轮只有本地路径，0.58–0.64s） | ✅ **R15 完成（部分）**：真实安装 **5.4s**（`dsh-plugin-model-proxy@0.1.6`，450KB/1 依赖）+ E404 / 版本不存在两种 `blocked`；`--resolved` 记 `license/integrity/unpackedSize/lockfile`；F18/F19 发现「装成功 ≠ 走过网络」「env 级 registry 覆盖被中和」→ 私有源形状拆成 `T-305b` |
| T-305b | 私有源 / 不可达 registry 的失败形状（profile 级配置） | M3 | implementer | T-305 | 用 profile 级 `.npmrc` 让 registry 真的不可达，产出 `probe.install-failed` 并点名源 | 🟨 **机制已验证（R16 spike，`M3-probe.md` F24）**：profile 级 `.npmrc` 会被 launcher 采纳（`ERR_PNPM_...NETWORK_ERROR`），env 级不会（F19）。实现 = `record_probe --npmrc-registry <url>`：先用本地 fixture 初始化 profile → 写 `<profile>/.npmrc` → 装候选 → 落产物 |
| T-306 | 非 web 表面的就绪判据 | M3 | implementer | T-301 | 用 host 自己打印的 URL/端口替代人工 `--no-http` 开关，覆盖 tui/headless profile | ✅ **R15 完成（web 面）**：`extractHostUrl` 从 stdout 取 URL，产物 `readiness.source=host-url`；`cleanup` 证明 Host 用过的**所有**端口都关；非 web 面仍用 `--no-http`，tui/headless 未测 |

---

## R16 已交付（本轮，证据见 `data/results/serve-smoke-*` 与 `render-fixture-blank-2026-10-27T14-02-15.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| 口径纠正 | R14/R15 写的「Linux CI 没浏览器」是错的：ubuntu runner 预装 Chrome/Chromium/Edge + xvfb（`ADR-0005`） | ✅ |
| T-407 | CI 新增 `render-control`：先断言 runner 真有浏览器（缺了明确失败），再跑 blank/rendered/error 三份对照，产物写 `$RUNNER_TEMP` | ✅ |
| T-405 | `dsh-triage serve`：零依赖只读面板 + token + 回环 + 跨源拒绝 + POST 403/501；`--results` 指向任意证据目录 | ✅ v0 |
| NEW | `scripts/record_serve_smoke.mjs`：8 项路由检查落 SSOT（不含 token/端口） | ✅ |
| 设计 | `docs/specs/M4-surface.md`（serve / DSH 设置面板 / SEA exe）+ `docs/adr/0005-render-backends.md` | ✅ |
| 真缺陷 | smoke 首跑 8/8 通过但进程 teardown 崩（Windows libuv，keep-alive socket）；`closeAllConnections()` + 去掉 `process.exit()` 后干净退出 | ✅ |
| 测试 | +6（serve 单测），总 **196**；9 门 / `--mutate` 9/9 | ✅ |

---

## R15 已交付（本轮，证据见 `data/results/probe-*` 与 `render-fixture-*`）

| 项 | 内容 | 状态 |
|---|---|---|
| S1 | spike 先证事实：`--dump-dom`/`--screenshot` 在本机不可用，CDP 可用；真 Host 挂载出 `#root` + 289 字符（`M3-probe.md` F13–F16） | ✅ |
| T-302 | `render.ts`：`judgeRender` 纯函数（6 种 DOM 形状）+ `findBrowser`（显式/env/常见路径）+ `renderUrl`（无头 Chromium + CDP，独立 profile 目录，跑完杀树） | ✅ |
| T-302 | 三处同改：`probe.render-ok` / `probe.render-blank` / `probe.render-unmeasured`（`messages.ts` 中英 + `docs/05` §2e + spec §7） | ✅ |
| T-306 | 就绪端口改由 Host 自打印 URL 决定；`cleanup` 证明它用过的所有端口都关；`readiness.source` 进产物 | ✅ |
| NEW | `scripts/record_render_fixture.mjs`：真浏览器跑「200 + 空挂载点」红样本与「有内容」对照，证明判定不是恒绿 | ✅ |
| T-305 | `record_probe.mjs --resolved`（license/integrity/unpackedSize/tarball）+ lockfile 指纹 + `--browser`/`--registry`；真实候选 1 绿 2 红 | ✅ 部分 |
| ADR | `docs/adr/0004`：外部候选取用边界（pin 版本 / 临时沙盒 / 不 vendor / 不判安全 / 失败即证据） | ✅ |
| 发现 | F18 装成功不等于走网络（pnpm store）；F19 env 级 registry 覆盖被 launcher 中和；F20 元数据层分不出 E404/ETARGET | ✅ 交给 T-305b |
| 测试 | +22（单测 16 render + 6 exec/plan），总 **196**；9 门 / `--mutate` 9/9 | ✅ |

---

## R14 已交付（证据见 `data/results/probe-*-2026-10-28*.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| T-301 | probe 执行器：`packages/probe/src/exec.ts`（步骤机 + 判定纯函数，17 条单测）+ `host.ts`（安装/起 Host/就绪探测/杀树/清理，唯一实现）+ `packages/plugin/src/probe-run.ts` + CLI `probe --execute --dsh-main` | ✅ |
| NEW | `scripts/record_probe.mjs`：一绿两红三份 SSOT（`probe-ok` / `probe-red-apply-fail` / `probe-red-import-fail`），`--expect` 自检，`limits[]` 把「不判安全 / 不判功能 / 沙盒非用户机器」写进产物 | ✅ |
| FIX | **我们自己的 `packages/plugin/cordis.patch.yml` 用的是 patch 形态而不是 insert**：装了也不挂载（上游只写 stderr `patch: entry … not found`）。已修，门 `namespace` 新增 `rows-are-inserted`（双向自测） | ✅ |
| FIX | 就绪探测必须在杀树之前（第一版打完样本立刻 `taskkill`，HTTP 检查全打在死端口） | ✅ |
| NEW | `--port`/`--no-open` 作为 app 参数透传（否则探针会打开用户浏览器）；非 web 面用 `--no-http` 显式关掉而不是误判 | ✅ |
| 合并 | 起 Host 的机械收到 `packages/probe/src/host.ts`，`scripts/lib/live.mjs` 改为再导出 —— 不再有第二份 boot 逻辑（R13 的教训） | ✅ |
| T-103 | 金标 21 → **27**（HUMAN 签字）：6 条新语义全部与文档一致，无分歧 | ✅ |
| T-110 | 双 roadmap 合并：保留 `docs/ROADMAP.md`（§7 吸收增长/分发/指标），旧文件归档 `_archive/` 并登记 | ✅ |
| BS-20 部分 | 真机样本首次同时包含 `active` / `null`（import 失败）/ `failed`（apply 失败）三形状，`cross_check.agree=true`；preset 的 broken/conditional 仍未真机化 | 🟡 部分 |
| 复核修复 | **交付后独立复核抓到两处真缺陷**：F-1 `--profile` 路径逃逸出沙盒（现按名字白名单拒绝，exit 2）；F-2 沙盒目录名把用户名带进三份产物（改 basename slug + 隐私门增压平形态 + 产物重采） | ✅ |
| 测试 | +24（单测 19 + e2e 5），总 **166**；9 门 / `--mutate` 9/9 | ✅ |

---

## R12 已交付（证据见 `data/results/inventory-live-2026-10-27T22-00-00.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| T-201 P1 | `scripts/probe_hooks/inventory-hook.mjs`：在沙箱 Host 内调上游导出的 `readPluginInventory(ctx)`，等树稳定（无 pending/loading）后落盘；`scripts/record_live_inventory.mjs` 负责挂载/采样/杀树/交叉校验/脱敏 | ✅ |
| T-112 | preset 维度：`InventoryPreset`/`InventoryPresetRow` 解析 + 五档判法（`preset-conditional` / `preset-fiber-failed` / `preset-no-fiber` / `preset-unjudged` / `preset-divergence`）；禁用的 preset 行不刷屏 | ✅ |
| NEW | `transport` 字段进快照契约（`remote` / `in-process-projection`），证据 `method` 随传输变化；fixture `projection-never-claims-the-remote` 锁死 | ✅ |
| NEW | id 形态解析：`include:tool-bash` ≡ 声明行 `tool-bash`（唯一后缀），两候选 → `runtime.ambiguous-entry`（不猜）；新原因 `missing.row-identity` | ✅ |
| FIX | `dsh.bundle.patch` 支持**数组**（上游默认形态）：此前只读字符串分支，`dsh-web-app` 整层被静默跳过。修后真机 `undeclared` 195 → 3 | ✅ |
| FIX | preset 声明读取：`config.plugins` 里的组合行（`extractPresetDeclarations`），而不是把 preset 载体行当成 1 条声明 | ✅ |
| 真机发现 | 沙箱 Host：194 行 = 167 active + 27 disabled（27 条全是 disabled）；4 个 preset / 98 行；无 failed、无 broken、无 conditional | ✅ |
| 测试 | +8（`tests/unit/inventory.test.ts` 22 条），总 **135**；9 门 / `--mutate` 9/9 | ✅ |
| 重放 | `data/results/inventory-2026-10-27T00-00-00.000Z.json`（R7 合成样本）用当前引擎重放：preset 档位变了，夹具未改；sha256 同步进 `audit/step_reviews.json` | ✅ |

---

## R10 已交付（证据见 `data/results/registry-2026-10-27T19-00-00.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| T-109 | 新模块 `packages/core/src/version-drift.ts`：同通道比较 dist-tag（`latest` 是预发布→比最新已发布；是稳定版→只比最新稳定版，更新的预发布另报 `prerelease-ahead`）；`check --explain` 打印 `latest`/`next`/已发布最新，`--json` 另有 `registry.drift` | ✅ |
| T-115 | `judgeRangeShape`：`exact` / `unbounded` / `bounded` / `unusable` / `absent`；`check` 时出 `admission.range-exact-pin`（info）与 `admission.range-unbounded`（warn），**不改变结论** | ✅ |
| NEW | 命名空间 `registry.*`（`registry.latest-behind` / `prerelease-ahead` / `latest-missing` / `tags` / `drift-none` / `drift-unknown`）；门 `verdict-contract` 白名单 + `docs/05` §3 三处同改 | ✅ |
| NEW | `scripts/record_registry.mjs`：真查 npm 并把 drift 判断落成 SSOT（`registry-*.json`，元数据 only，不下载 tarball） | ✅ |
| 真机发现 | 三个上游核心包的 `latest` 全落后：`dsh-tools` / `dsh-base` = `0.0.1-rc.1`，`dsh` = `0.2.1-rc.2`，三者 `next` = `0.2.1-rc.4` | ✅ |
| 测试 | +14 单测（`tests/unit/version-drift.test.ts`），总 **124**；9 门 / `--mutate` 9/9 | ✅ |

---

## R9 已交付（本轮，证据见 `data/results/d1-2026-10-27T15-00-00.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| T-116 | 门 `verdict-contract` 增 `placeholder-params-required`：文案里的 `{占位符}` 必须由 `params` 提供（缺 key / `null` / 空串都算缺），带双向自测 + `--mutate` 第二类注入 | ✅ |
| T-107 | 行级 `unconstrained` 由「静默」改为 `unknown` + `missing.peer-declaration`；CASE-7590 从 0 verdict 变 2 verdict | ✅ |
| T-108 | 新模块 `packages/core/src/compat-channel.ts`：读 `dsh.compatibility` / `dshReleases` / `profiles` 作 `declared` 级次要证据；三条 tier 纪律负对照 | ✅ |
| D1 口径 | `scripts/d1_report.mjs` 增 `miss_kind`（`silent` / `explicit-unknown` / `explicit-other`）+ `totals.miss_by_kind`；**不改任何 label**，只加派生分类；`tests/governance` 两条新断言 | ✅ |
| NEW | `scripts/probe_live_sample.mjs`：0.2.x 沙盒真机采样的**尝试台账**（`outcome=blocked` 也落盘，`sample.kind=live-attempt`），当前 blocker = 沙盒 profile 未装依赖 | ✅ |
| 真机复跑 | `data/results/why-2026-10-27T18-20-00.000Z.json`：本机 0.1.0-rc.6 / 156 行 → 4 条结论（2 `go` + 2 行级 `unknown`），证明 T-107 在真实 profile 上不刷屏 | ✅ |
| 测试 | +14（单测 12 + 治理 2），总 **110**；9 门 / `--mutate` 9/9 | ✅ |
| 独立复核 | 只读对抗性会话（`ses_e8440b560ffej1y7jzfl0ofsii`）判定 PARTLY CONFIRMED，4 个必须修的洞全部当场修（占位符只盖 reasons/remediation、CLI note 自相矛盾、live 脚本死分支+硬编码原因、mutate 注入可静默跳过）；另修 4 处口径并新增 `BS-17` / T-117 | ✅ 见 `audit/AUDIT_2026-10-27_R9.md` §8 |
| 未做 | T-109 dist-tag、T-111 label 独立签署、T-112 preset 维度、T-202 快照、P1 相位 | ⬜ 见 `audit/AUDIT_2026-10-27_R9.md` §4 |

---

## R8 已交付（证据见 `data/results/audit-2026-10-27T12-00-00.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| 借鉴台账 | `docs/09-open-source-borrowing.md`：14 个来源，分「已落地 / 只设计 / 明确不做」三档，含许可与证据等级 | ✅ |
| NEW | **副本来源归因**（借 npm `explain` + Maven「paths to dependency」）：行被拒时点名「这份副本来自 `dsh-pdf@0.1.0` 的 `dependencies`」 | ✅ |
| NEW | **重复副本检测**（借 Maven `dependencyConvergence`）：同名不同版本 → `collision-duplicate-copy`，两条路径 + 两个版本；同版本硬链不算 | ✅ |
| NEW | `scripts/record_audit.mjs`：把一次 audit（行 + 来源 + 重复副本 + 结论）写成 SSOT | ✅ |
| 测试 | +15（单测 9 + e2e 3 + 其他回归），总 **91**；9 门 / `--mutate` 9/9 | ✅ |
| 复核修正 | 独立对抗性会话（只读、不看实现）判定 PARTLY CONFIRMED，抓出 5 个必须当场修的洞：同版本双副本仍被上报、`devDependencies` 被当来源（依赖方 devDeps 根本不装）、软链/`link:` 目录被当成不存在、未知版本被当版本比较、嵌套副本必须先有根副本；另把「gate 锁死 params」的过度声称改成事实 | ✅ 见 `audit/AUDIT_2026-10-27_R8.md` §7 |
| 登记 | 只设计：T-113（attw 矩阵）、T-114（bisect）、T-115（区间对齐）、T-116（占位符完整性）；明确不做：`npm audit` 式漏洞扫描、作者侧打包 lint | ✅ |

---

## R7 已交付（证据见 `data/results/inventory-2026-10-27T00-00-00.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| T-201 P2 | 相位层：`packages/core/src/inventory.ts`（防御式解析 + 相位→结论映射 + 声明/运行 diff） | ✅ |
| CLI | `dsh-triage audit --snapshot <file>`：行旁相位、missing/undeclared 两段、结论卡；无 `--snapshot` 时行为不变 | ✅ |
| NEW | 门 **`inventory-contract`**（9 门）：fixtures 逐行回放 spec §3 + 上游 `fiberPhase` 枚举比对 + 中英文案存在性；`--mutate` 可打红 | ✅ |
| NEW | `scripts/render_inventory.mjs`：把一次相位判定写成 SSOT（`sample.kind` 自曝 synthetic/live） | ✅ |
| 测试 | +13（单测 10 + e2e 3），总 **75**；套件 9 门 / `--mutate` 9/9 | ✅ |
| 未做 | P1（Host 内取相位）、真机样本、`agentPresets` 维度（T-112） | ⬜ 见 `audit/AUDIT_2026-10-27_R7.md` §3 |
| 复核修正 | 独立对抗性会话（只读、不看实现）判定 PARTLY CONFIRMED，抓出 3 个必须当场修的洞：**门没真正绑定 spec 表**（改一行结论仍全绿）、**`agentPresets` 被静默吞掉**（failed 的 preset 行完全不可见）、**`sample.kind` 是自由文本且默认值与文档不符**；另改 4 处口径（B3 拆分、禁用行不判“在跑”、`--json` 多字段、无 module 行计数） | ✅ 见 `audit/AUDIT_2026-10-27_R7.md` §8 |

---

## R6 已交付（证据见 `data/results/d1-2026-10-26T12-00-00.000Z.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| T-104 | **+6 例真实案例**：10201 / 10759 / 10364 / 8751 / 8220 全命中，7590 为有意保留的 miss 负样本 | ✅ |
| D1 | **9/10 hit = 90% ≥ 80%**，判定由 `scripts/d1_report.mjs` 从产物汇总（不再手写数字） | ✅ |
| NEW | `scripts/d1_report.mjs`：D1 命中率 → `data/results/d1-*.json` + `.sha256`；含 `label_key_sources` 分层（report-explicit / derived / unstated） | ✅ |
| NEW | `tests/governance/d1-report.test.ts`（5 条）：反向点数、重复产物去重、非法 hit 值拒绝、短样本必红、同 stamp 逐字节一致 | ✅ |
| FIX | R5 对 #10364 的「嵌套 `node_modules` 不可见」判断被实抓正文证伪（实为 hoist 到 profile 层，可见）→ 修正为 `BS-11` | ✅ |
| NEW | 盲区 `BS-10`（无声明行静默 → T-107）/ `BS-11`（遮蔽可见性边界）/ `BS-12`（命中 key 的证据强度分层） | ✅ |
| 复核 | **独立对抗性会话**（只读、不看实现）逐字节重放全部产物：D1 结论 CONFIRMED；另抓 3 项当场修 —— CASE-11080 旧产物不可重放（已用当前脚本重放，R6-S10）、「dsh-im 什么都不声明」过强（实际带 `dsh.compatibility` 通道 → `BS-13`/T-108）、2 例来源日期与 1 例作者名 | ✅ 见 `audit/AUDIT_2026-10-26_R6.md` §10 |

---

## R4 已交付（证据见 `data/results/why-case-CASE-11080-*.json`）

| 项 | 内容 | 状态 |
|---|---|---|
| NEW | **门 `step-review`**（7→8 门）：每一步必须有四轴 + 对抗性结论，且 real_test 产物 sha256 可重算；`data/results` 不得有孤儿产物 | ✅ |
| NEW | `node scripts/gate.mjs --record --stamp <iso>`：把整轮门禁结果写成 `data/results/gates-*.json`，「全绿」变成可重算证据 | ✅ |
| NEW | `audit/step_reviews.json` + `PROJECT_RULES` 铁律 11 + playbook §1b：每步必审 + 真实模拟测试（机器强制） | ✅ |
| FIX | R4 审核发现的 7 项真实缺陷（行级假阴、相对路径误判、BOM、autocrlf 哈希漂移、沙盒过度声明、文本刷屏、空包名） | ✅ 见 `audit/AUDIT_2026-10-26_R4.md` |
| T-101 | 真实案例命中：升级后 `cordis.patch.yml` 的行被静默禁用（peer 钉旧版本） | ✅ |
| A7/A8 | **行级 admission 归因**：此前只按 bundle 判，patch 里的 row 逃检（假阴）；未安装模块只能 `unknown` | ✅ |
| NEW | `scripts/record_case.mjs`：案例输入固化 + 隔离复现 + 机器可算命中判定 + SSOT | ✅ |
| NEW | `scripts/bootstrap_upstream.mjs`：0.2.x 隔离运行时（不写 `~/.dsh`）+ 契约实测 SSOT | ✅ |
| NEW | `docs/specs/M2-inventory.md`：`pluginInventory` 契约、相位映射、P1/P2/P3 传输路径、负对照 | ✅ |
| 测试 | +4 单测（`tests/unit/rows.test.ts`）+3 e2e（row 命中、相对路径 row、缺失包不判 go）= 56 条 | ✅ |

---

## R3 已修（证据见 `audit/AUDIT_2026-10-26_R3.md`）

| 审核 ID | 内容 | 状态 |
|---|---|---|
| A1 | SSOT 泄露 home 路径（`evidence[].source`）→ `redactVerdict` + `results-privacy` 门 | ✅ |
| A2 | 删除会撒谎的公开 API `readDshPeerRequirements` | ✅ |
| A3 | admitted verdict 重复渲染同一文案 → 新增 `admission.declared-only` | ✅ |
| A4 | 修复文案硬编码英文 → `Remediation.messageId/params` + 本地化渲染 | ✅ |
| A5 | 门禁校验 messageId 必须存在于 `messages.ts` | ✅ |
| A6 | `gate_ssot` 校验 `produced_by` 指向真实脚本 | ✅ |
| A7 | probe 首步语义修正（`runtime-check`） | ✅ |
| A8 | `.npmrc` 去掉 pnpm 专属键（消除 npm 告警） | ✅ |
| A9 | 新门 `release-pack`：实测 `npm pack` 内容 | ✅ |
| A10 | CI 增加 Windows job | ✅ |
| A11 | 新增 e2e CLI 测试（含脱敏断言） | ✅ |
| A12 | 坑表补 3 条真实故障 | ✅ |

---

## 领取流程（3 步）

1. 把状态改 `🟨 进行中` 并写上自己的名字/agent 名（同一提交）；
2. 按 `.agents/prompts/task-packet.md` 自查边界（允许改哪些文件）；
3. 完成后：`pnpm run verify` + `node scripts/gate.mjs --mutate` → 更新状态为 `✅` 并在 `audit/AI_DISCLOSURE_LOG.md` 留痕。

## 禁止事项

- 禁同时领取两个有文件重叠的任务（同文件禁并行）；
- 禁跳过依赖（例：没接 T-201 就做 T-301）；
- 禁把「未做完」标成 `✅`（可标 `⛔` 并写清退出条件）。
