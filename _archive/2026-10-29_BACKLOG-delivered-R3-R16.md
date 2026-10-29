# BACKLOG · 已归档的交付记录（R3–R16，逐行原文）

> **归档日期**：2026-10-29（R48 整理）｜**原因**：`docs/BACKLOG.md` 是「可领取任务清单」，但文件后半段（约 170 行）是 R3–R16 的**已交付记录**——读清单的人要先翻过一整年的历史。
> **做法**：**逐行原文搬移**，一个字都没有改。任务行本身（T-1xx…T-7xx、T-8xx）仍留在 BACKLOG 里，它们才是清单。
> **引用处**：`docs/BACKLOG.md` 原位置留指针；`_archive/ARCHIVE_MANIFEST.md` 已登记。
> **为什么不删**：这些段落里有当时的口径纠正与失败形状（例如 `T-407` 的「CEO 认知纠正：CI 有浏览器」），删掉就等于第二次犯错。

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
