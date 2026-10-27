# 项目全局检索与知识索引中心

> **Stand**: R17 (2026-10-27)｜接手先读 `docs/AI_HANDOVER.md`｜路线见 `PROJECT_RULES.md` Roadmap

## 🔍 按需求快速索引

| 需求 | 路径 | 内容/状态 |
| :--- | :--- | :--- |
| **交接入口** | `docs/HANDOFF.md` | 五分钟检查 / 当前批次 / 下一位 agent 的第一件事 / 真实踩过的坑 |
| **真实案例** | `data/cases/CASE-*/` | **10 例（9 命中 / 1 显式 `unknown`）**：`CASE-11080`（升级后行被静默禁用）· `CASE-11012`（MCP 工具整体消失/传递依赖漂移）· `CASE-8202`（上一代插件进新运行时）· `CASE-10849`（npm dist-tag 失步 → 未钉版本被拒）· `CASE-10201`（hooks 桥 latest 失步 → 装前被拒）· `CASE-10759` / `CASE-10364`（dependency hoist 遮蔽 `dsh-tools` → tools 行被禁）· `CASE-8751`（官方包留在上一代 → session 行被禁）· `CASE-8220`（安装器判了 bundle 自己 disabled 的 shim 行）· `CASE-7590`（**负样本**：两个插件都不声明 peer；R9 起不再是「静默 miss」，而是 2 条 `unknown`，其中 `@xmanrui/dsh-im` 的 `dsh.compatibility` 被点名读出来） |
| **D1 命中率** | `scripts/d1_report.mjs` → `data/results/d1-*.json` | 从 `why-case-*.json` 汇总命中率（当前 **9/10 PASSED**），含 `label_key_sources` 与 **`miss_kind`**（`silent` / `explicit-unknown` / `explicit-other`）；`tests/governance/d1-report.test.ts` 反向点数 + 重算 `miss_kind`，禁手填 |
| **次要通道 `dsh.compatibility`** | `packages/core/src/compat-channel.ts` + `verdict.ts#compatSurfacing` | 读 `dsh.compatibility.dsh` / `dshReleases` / `profiles`，只出 `declared` 级次要证据（`compat-channel`）；**不得单独判 `blocked`、不得把 `unknown` 升 `go`**（三条 tier 纪律负对照）；`dshReleases` 键按作者写法归一化（`v` 前缀/空白）；行级只在 `unconstrained` 挂载（行级相左 = `BS-17` / T-117） |
| **live 采样尝试台账** | `scripts/probe_live_sample.mjs` → `data/results/ns-live-attempt-*.json` | `--boot` 会真起 Host 并在杀掉前探 HTTP：`outcome` 三态 `blocked` / `composed-only` / **`mounted-host`**；当前实测 `mounted-host`（11.8s 起服务、带 token 303、无 token 401、端口干净关闭）；相位行仍未读（缺 Remote 客户端） |
| **仓内 0.2.x 沙盒** | `sandbox/`（git 忽略）· `scripts/bootstrap_upstream.mjs` | runtime + profile 依赖装进仓内（0.2.1-rc.4，compose 191 条），可挂载可观测；删掉整个目录即重置，不碰真实 DSH home |
| **dist-tag 失步 / 区间形状** | `packages/core/src/version-drift.ts` + `check --explain` → `data/results/registry-*.json` | 同通道比较 `latest` / `next` / 已发布最新（`latest` 是稳定版时不把更新的预发布当失步）；`registry.*` 只出 `measured-registry` 证据，**不改结论**；`judgeRangeShape` 提示「精确钉定会被下一个 patch 打挂」与「无上界会自动放大版本」；真机事实见 `data/results/registry-2026-10-27T19-00-00.000Z.json` |
| **副本来源与重复副本** | `packages/core/src/duplicates.ts` + `scripts/record_audit.mjs` → `data/results/audit-*.json` | 同名同版本不算问题；同名不同版本 → `collision-duplicate-copy`（两条路径 + 两个版本）；行被拒时点名「这份副本来自谁的 dependencies」（借 npm explain / Maven） |
| **运行时相位（M2-a P1+P2）** | `packages/core/src/inventory.ts` + `scripts/render_inventory.mjs` + `scripts/record_live_inventory.mjs` | 相位→结论映射（`runtime.*`）、声明/运行双向 diff（id 前缀 `include:` 已归一）、`sample.kind` 自曝 synthetic/live、`transport` 自曝 `remote`/`in-process-projection`；**R12 起有真机样本**：`data/results/inventory-live-2026-10-27T22-00-00.000Z.json`（194 行 / 167 active / 27 disabled / 4 preset 98 行 / Host↔CLI 结论逐行一致） |
| **真机采样（Host 内探针）** | `packages/probe/hooks/inventory-hook.mjs` + `scripts/record_live_inventory.mjs` | 用 `--patch` 挂一行探针进沙箱 Host，调上游导出的 `readPluginInventory(ctx)`（与 Remote 方法同一函数），等树稳定后落盘；用完即删目录；探针行在产物里记 `excluded`。**R14 起该 hook 随 probe 包发布**（CLI 装成 npm 包也能找到），repo 脚本经 `scripts/lib/live.mjs` 复用同一份 |
| **能力层（M2-b / T-202b）** | `packages/core/src/capabilities.ts` + `scripts/record_live_capabilities.mjs` | 工具注册表**事实**（`ctx.tools.schemas()`）+ 两样本**差分**（`diffCapabilities`）+ 三条硬边界（插件不静态声明工具名 / 工具在 agent 作用域 / `ptc` 折叠可见面）；**不产出「工具缺失」结论**（无判据来源）。证据 `data/results/capabilities-2026-10-27T23-30-00.000Z.json` |
| **两命令同源（T-105）** | `packages/plugin/src/cli.ts` | `audit` 也出**行级** admission 结论（文本逐行 + `--json row_verdicts`），与 `why` 同一个引擎；e2e 比集合而非计数 |
| **preset 维度（T-112）** | `packages/core/src/inventory.ts#presetVerdicts` | 五档：`preset-conditional` / `preset-fiber-failed` / `preset-no-fiber` / `preset-unjudged` / `preset-divergence`；`enabled:false` 的 preset 行不刷屏；跨 preset 相位不同两侧分别成立 |
| **相位契约门** | `scripts/gate_inventory_contract.mjs` + `tests/fixtures/inventory/cases.json` | 9 门之一：fixtures 逐行回放 spec §3/§3.1/§3.2 + 上游 `fiberPhase` 枚举比对 + 中英文案存在性 + `evidence_method_not`（投影不得自称 Remote） |
| **复现脚本** | `scripts/record_case.mjs` | 案例 → 隔离沙盒 → verdicts → `data/results/why-case-*.json` + `.sha256` + `hit` |
| **上游沙盒** | `scripts/bootstrap_upstream.mjs` | 0.2.x 隔离运行时 + `pluginInventory` 契约实测（不写真实 DSH home） |
| **执行计划** | `docs/ROADMAP.md` | 12 周阶段表 + 4 个决策门 + 指标看板 + 分发时间线 + kill criteria |
| **任务清单** | `docs/BACKLOG.md` | T-101…T-701（角色 / 依赖 / 验收 / 状态），可直接领取 |
| **Agent 框架** | `.agents/README.md` | 三入口 + 6 张角色卡 + 4 个模板 + 5 条硬性校验 |
| **开工指令** | `.agents/prompts/kickoff.md` | 新会话整块粘入即可开工（含三步命令与期望输出） |
| **审核报告** | `audit/AUDIT_2026-10-27_R17.md`（最新：端口自伤 + 慢≠坏）· `audit/AUDIT_2026-10-27_R16.md` · `audit/AUDIT_2026-10-28_R14.md`· `R13` · `R12` · `R10` · `R9` · `R8` · `R7` · `R6` · `R5` · `R4` · `R3` | 四轴 + 对抗性；R14：M3 probe 执行器（一绿两红真机）+ bundle patch 的 `insert:` 缺陷 + 金标 21→27 + roadmap 合并；R13：能力层取证（三条硬边界）+ T-105 两命令同源；R12：真机相位采样（P1 进程内投影）+ T-112 preset 维度 + 两个真 bug（bundle patch 数组、loader id 前缀）；R10：dist-tag 失步 + 区间形状（`registry.*`）；R9：不静默一轮（T-116/T-107/T-108）；R8：副本来源 + 重复副本 |
| **每步审核台账** | `audit/step_reviews.json` | 每一步的四轴结论 + 对抗性反例 + real_test 产物 sha256（门 `step-review` 校验；R17 起 **97 步 / 84 产物**） |
| **授权/签署台账** | `audit/SIGNOFF.md` | 谁授权 / 谁执行出结论 / HUMAN 未逐条复核的部分，三者分列；冻结区改动必须有对应条目 |
| 接手清单 | `docs/AI_HANDOVER.md` | 真相源、冻结区、防幻觉、5 分钟检查 |
| 工程铁律 | `PROJECT_RULES.md` | 10 条铁律 + 严禁行为 + M0–M5 路线与出口门禁 |
| 设计地图 | `docs/DESIGN-MAP.md` | 六层架构 / 门与证据矩阵 / 数据模型 / 分发位 |
| 愿景与定位 | `docs/00-vision.md` | 「装得上 ≠ 跑得对」判断层；不做市场/启动器/杀软 |
| **开源借鉴台账** | `docs/09-open-source-borrowing.md` | 14 个来源的机制/许可/落地状态：npm explain → 副本来源归因、Maven dependencyConvergence → 重复副本、pip check → 已装集合自检；含「借了但不做」的理由（不做安全扫描、不做作者侧 lint） |
| 竞品与上游归因 | `docs/01-competitors.md` | 12 个竞品 + 上游已吸收清单 + 实测下载量/星标 |
| 信号源评估 | `docs/02-signal-sources.md` | 信号/格式/频率/可信度/许可/适配成本 |
| 失败分类法 | `docs/03-failure-taxonomy.md` | 9 类失败：机制 / 症状 / 谁接得住 / 空白 |
| admission 语义 | `docs/04-admission-semantics.md` | 上游判定规则逐条复刻 + 金标夹具口径 |
| Verdict 契约 | `docs/05-verdict-contract.md` | 结论/证据/置信度/替代方案 JSON 契约 |
| 工程约定 | `docs/08-conventions.md` | 模块边界/命名/错误/确定性/扩展方式/评审清单 |
| 决策记录 | `docs/adr/0001-result-over-exceptions.md` + `docs/adr/0002-override-is-not-a-collision.md` + `docs/adr/0003-zero-dep-gates-with-mutation.md` + `docs/adr/0004-external-candidate-boundary.md` + `docs/adr/0005-render-backends.md` | Result 优先 / 覆写不是撞车 / 零依赖门禁+负对照 / 外部候选只在临时沙盒执行且不 vendor / 渲染只认系统浏览器 + CDP |
| 路线 | `docs/ROADMAP.md` | 12 周阶段表 + 4 个决策门 + 增长阶梯/分发清单/指标（R14 起为唯一执行计划；旧的双 roadmap 之一已归档到 `_archive/`，见 `ARCHIVE_MANIFEST`） |
| 本机环境 | `docs/07-environment.md` | Node/pnpm/DSH 版本、profile 路径、只读边界 |
| 模块 spec | `docs/specs/M0-skeleton.md`、`docs/specs/M1-why.md`、`docs/specs/M2-inventory.md` | 判据先行、负对照、诚实边界 |
| 判断引擎 | `packages/core/src/`（admission / env / ledger / verdict / compat-channel / version-drift / duplicates / inventory） | 纯函数、零网络、可离线；`compat-channel` 与 `version-drift` 只出次要证据 |
| 信号适配 | `packages/signals/src/`（npm / dsh.so / local-artifacts） | 每个信号带 tier + 出处 |
| **probe 执行器（M3 / T-301）** | `packages/probe/src/exec.ts` · `packages/probe/src/host.ts` · `packages/probe/src/render.ts` · `scripts/record_probe.mjs` · `packages/probe/hooks/inventory-hook.mjs` | `runtime→install→boot→http→render→inventory→cleanup` 七步；判定是纯函数（`judgeProbe` / `judgeRender`），I/O 全部注入；**R15 起 `client-rendered` 可测**（真浏览器 + CDP；无浏览器 → `unmeasured`），`namespace-diff` 仍 `unmeasured`（T-303）；默认 dry-run，`--execute --dsh-main` 才真跑；**R17 起端口由 `findFreePort()` 向 OS 申请**（`--readiness-timeout` / `--unsettled-timeout` 可配），产物记 `sandbox.port_origin` |
| **「慢 ≠ 坏」（R17 / T-308）** | `packages/probe/src/host.ts` · `packages/probe/src/exec.ts` · `packages/probe/hooks/inventory-hook.mjs` · `tests/fixtures/probe/slow-plugin` | 判定把读数分成 `valid`、`unsettled`、`unreadable`：只有 valid（读到 + 无 error + `settled:true`）能出 `blocked`；候选行仍 transient（pending、loading）、hook 的 `inactive context`、我们自己的端口绑不上 → `unknown` + `missing.inventory`/`missing.probe`；launcher 的 `startup failed` 照抄原文进 `blocked` 并提前收敛。证据 `data/results/probe-slow-normal-2026-10-27T17-00-00.000Z.json`（慢=go）· `data/results/probe-registry-whale-2026-10-27T17-05-00.000Z.json`（R16 的 blocked → 现在 go） |
| **白屏判定（T-302）** | `packages/probe/src/render.ts` · `scripts/record_render_fixture.mjs` | `judgeRender` 判「挂载点有子节点 + 可见文本 ≥20 字符 + 非 loading」；`findBrowser`（显式/env/常见路径）；`renderUrl` 用无头 Chromium + CDP（`--dump-dom` 在本机不可用）；红/绿对照产物 `data/results/render-fixture-*.json` |
| **M3 probe 契约** | `docs/specs/M3-probe.md` | 实测事实 **F1–F30**（+R17 的端口排除段、fiber unload、startup 诊断、换端口后 go）+ 计时契约（boot→sample ≤20s；settled 就绪 5s 不变，unsettled 20s 只能出 unknown）+ 断言→结论映射 + **25 条负对照** |
| **渲染后端选择** | `docs/adr/0005-render-backends.md` | 系统浏览器 + CDP 是唯一能给 `passed` 的后端；DOM 模拟/应用内上报/静态检查的定位与代价；CI 真浏览器作业 |
| **控制面设计（M4）** | `docs/specs/M4-surface.md` | `dsh-triage serve` 本地面板 / DSH 设置面板（`dsh.client` + slots，row id = settings 命名空间）/ SEA 单文件 exe；三者都只展示与触发，不新增判据 |
| **本地证据面板（T-405）** | `packages/plugin/src/serve.ts` + `scripts/record_serve_smoke.mjs` | `dsh-triage serve [--port N] [--results DIR] [--allow-execute]`：零依赖、只绑 127.0.0.1、token + HttpOnly cookie、跨源 403、POST 默认 403（`--allow-execute` 也只回 501）；列出 `data/results` 全部产物与 sha256 |
| **外部候选取用边界** | `docs/adr/0004-external-candidate-boundary.md` | pin 版本 / 临时沙盒 / 不 vendor / 不注入凭据 / 不判安全 / 失败即证据；`vendor-manifest` 只登记 `kind: probe-candidate` 元数据 |
| 隔离实测 | `packages/probe/src/exec.ts` · `packages/probe/src/host.ts` · `packages/probe/src/plan.ts` | M3：默认 dry-run，独立 `DSH_HOME`；`packages/probe/src/host.ts` 是唯一一份 Host I/O，`scripts/lib/live.mjs` 只是再导出；R17 起 boot 事实（`url_printed` / `startup_failed` / `bind_failed_ports` / `error_tail`）在 early return 之前落账 |
| **D2 分母矩阵** | `scripts/record_probe_matrix.mjs` + `tests/fixtures/probe/matrix-r17.json` → `data/results/probe-matrix-*.json` | 摘要区分 `real_starts` / `synthetic_failures` / `by_conclusion`；R17 首测 n=7（真实 2 次全 go，清理 7/7，boot 6.2–6.9s）。**2 次真实启动不是成功率** |
| 用户安装件 | `packages/plugin/`（`dsh-triage`） | bundle + patch + bin CLI + Web 面板（M4） |
| 门禁 | `scripts/gate_*.mjs` + `scripts/gate.mjs` | 9 门：admission 对等 / verdict 契约（含 `{占位符}` 完整性）/ SSOT / 治理 / 命名 / 发布 / 发布内容 / 相位契约 / 每步审核 |
| 真跑落盘 | `scripts/scan_env.mjs` | 扫本机 profile → `data/results/*.json` + `.sha256` |
| 测试 | `tests/` | `node --test`（TS 直跑，零测试框架依赖）；`tests/governance/d1-report.test.ts` 把 D1 命中率钉成可重算断言 |
| 金标 | `data/gold/admission-cases.json` | 真实 npm 声明快照 + 人工签署 |
| 隔离 | `quarantine/QUARANTINE_POLICY.md` + `quarantine/vendor-manifest.json` | 双门制 + 许可真相源 |
| 归档 | `_archive/ARCHIVE_MANIFEST.md` | 只进不出 |
| 备份 | `backup/BACKUP_POLICY.md` | snapshots + `.sha256` + tag 策略 |
| 合规 | `COMPLIANCE.md` + `audit/AI_DISCLOSURE_LOG.md` | 本地优先 + 披露 + 数据许可 |
| 说明 | `README.md`（英主）+ `README.zh-CN.md` | 双语文档，口径一致 |
| 上架 | `docs/market/listing_zh.md` | 应用市场/目录提交文案 |

## 🏷️ Tags
`#DSH` `#DeepSeekHarness` `#PluginCompat` `#Diagnostics` `#LocalFirst` `#EvidenceFirst` `#NoQuarantineOfTrust`
