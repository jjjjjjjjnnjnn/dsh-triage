# SIGNOFF · 授权与签署台账

> **为什么有这份文件**：这个仓里「signature」代表**授权**，不代表团签。把 agent 的复核写成「HUMAN 逐条审过」是另一种假证据——和伪造测试结果同性质。
> 因此每条记录都分三栏：**谁授权**、**谁执行与出结论**、**HUMAN 没有逐条看的部分**。
>
> 规则：
> 1. 签名只对「被点名的范围 + 当时的证据哈希」有效，跨轮不继承；
> 2. 冻结区（`data/gold/**`、`audit/gate_ledger.json` 的 negative_control、`packages/core/src/admission.ts` 规则顺序、`PROJECT_RULES.md` 铁律）必须有本文件对应条目；
> 3. 授权可以来自会话内明确批准，必须记录原话或摘要与日期；**不得事后补签**；
> 4. 执行方是 agent 时，必须写明模型与它**没有**做的事。

| 日期 | 范围 | 授权（HUMAN） | 执行与结论（agent） | HUMAN 未逐条复核的部分 | 证据 |
|---|---|---|---|---|---|
| 2026-10-27 | T-103 金标扩容（冻结区） | 会话内批准「T-103 金标扩容签字」 | DeepSeek V4.1 Flash：新增 6 条 synthetic，期望值由 `semantics_rules` 推导后写入；parity 门 27/27 | 6 条 `why` 文案与用例选取的人工复核；未由 HUMAN 逐条读 | `data/gold/admission-cases.json`（`signature` 字段）· `data/results/gates-2026-10-28T04-30-00.000Z.json` |
| 2026-10-27 | T-110 双 roadmap 合并（删文档） | 会话内批准「双 roadmap 合并」 | DeepSeek V4.1 Flash：保留 `docs/ROADMAP.md`，旧文件 `git mv` 到 `_archive/` 并登记，六处引用同步 | 合并后 §7 的措辞与优先级是否认可；未由 HUMAN 逐行校对 | `_archive/ARCHIVE_MANIFEST.md` · `data/results/gates-2026-10-28T04-40-00.000Z.json` |
| 2026-10-28 | R14 交付签收（M3 probe 执行器 + 上述两项） | 会话内原话：「好了，继续，你全方面审核测试以后替我签字，我已批准」 | DeepSeek V4.1 Flash：跑 166 测试 / 9 门 / `--mutate` 9/9；只读复核脚本抓出 F-1（沙盒逃逸）与 F-2（用户名进 SSOT）并当场修；重采三份产物 | **判据本身是否正确**（probe 的结论映射、`≤20s` 预算是否合理）；安全/合规口径的最终认定；未由 HUMAN 逐条审阅审核报告 | `audit/AUDIT_2026-10-28_R14.md` §7b · `data/results/gates-2026-10-28T07-20-00.000Z.json` · `audit/step_reviews.json` R14-S9 |
| 2026-10-28 | **R15 外部候选取用授权**（ADR-0004：首次在临时沙盒真装并执行第三方 npm 插件） | 会话内原话：选项「授权，按 pin 版本 + 临时沙盒执行」；范围「S1 + T-306 + T-302 + T-305」 | DeepSeek V4.1 Flash：写入 `docs/adr/0004`；只测 3 个公开 MIT 包（`dsh-plugin-model-proxy@0.1.6` / `dsh-cost-meter@1.9.41` / 两个不存在的 spec），全部装进系统临时目录下的沙盒 `DSH_HOME`、跑完即删；候选源码不进仓、不进 `quarantine/`，只登记元数据 | **候选作者与代码可信度**（本仓不判安全，`COMPLIANCE.md` §5）；候选在真实用户组合下的行为；HUMAN 未逐条看安装日志 | `docs/adr/0004-external-candidate-boundary.md` · `quarantine/vendor-manifest.json`（`probe-candidate-*`）· `data/results/probe-registry-*.json` |
| 2026-10-28 | **R16 沿用上述授权（未扩大）** | 会话内指令「同意，继续」 | DeepSeek V4.1 Flash：新增执行 `dsh-whale-widget@0.4.2`（矩阵里 1 次）与 `dsh-cost-meter@1.9.41`（私有源形状 1 次）；仍全部 pin + 临时沙盒 + 跑完即删；只新增元数据登记，未新增 vendor | 同 R15 行；另外 HUMAN 未逐条复核「矩阵把多少失败算作合成」的标注 | `data/results/probe-matrix-2026-10-27T14-36-20.000Z.json` · `probe-registry-private-2026-10-27T14-33-57.000Z.json` · `audit/AUDIT_2026-10-27_R16.md` |

| 2026-10-27 | **R17 判据改动**：`M3-probe.md` §4 新增「unsettled readiness window（默认 20s，可配，只能出 unknown）」+ `ROADMAP.md` §2 D2 口径（`go/(go+blocked)`，`unknown` 单列） | 会话内原话：「同意，继续，开始进行」（针对附两条待签项的 R17 计划） | DeepSeek V4.1 Flash：settled 树的 5s 判定阈值**未改**；新增窗口只作用于 `settled:false` / 读不到树的形状，且判定层强制只能 `unknown`；D2 口径只改统计分母定义，不改任何判据 | 两条文案与「20s」这个具体数字是否合适；HUMAN 未逐条复核 spec §4/§5 的最终措辞 | `docs/specs/M3-probe.md` §4/§5/§8 · `docs/ROADMAP.md` §2 · `data/results/gates-2026-10-27T18-00-00.000Z.json` |
| 2026-10-27 | **R17 外部候选**（沿用 ADR-0004 边界，未扩大机制） | 同上会话批准（R17 计划 §3 S1/S7 明确要重跑 whale-widget 与矩阵） | DeepSeek V4.1 Flash：`dsh-whale-widget@0.4.2`、`dsh-plugin-model-proxy@0.1.6`、`dsh-cost-meter@1.9.41`（私有源形状）全部 pin 版本、装进系统临时目录的独立 `DSH_HOME`、跑完即删；候选源码不进仓、不进 `quarantine/`，只登记元数据 | 具体候选清单与「重跑几次」的取舍；本仓仍不判安全性（`COMPLIANCE.md` §5） | `data/results/probe-matrix-2026-10-27T17-20-00.000Z.json` · `probe-registry-whale-2026-10-27T17-05-00.000Z.json` · `audit/AUDIT_2026-10-27_R17.md` |

| 2026-10-27 | **R18 D2 判定口径**：`ROADMAP.md` §2 明确「D2 判定看可靠性（产物 + 清理 + 预算 + 说出结论），真实通过率 `go/(go+blocked)` 单列并带 Wilson 95%」 | 会话内原话：「继续」（承接 R17 交班里的 R18 = T-309） | DeepSeek V4.1 Flash：写了 `scripts/d2_report.mjs`，把矩阵算成 `d2-*.json`；真实启动 <10 时**拒绝判定**（默认 `--min-real 10`）；R18 结果 reliability 17/17、真实 10、形状 5、通过 9/10（Wilson 0.596–0.982） | 「可靠性」这个判定口径是否认可；Wilson 区间与「便利样本」的措辞；HUMAN 未逐条复核 10 个候选的挑选 | `data/results/d2-2026-10-27T21-00-00.000Z.json` · `data/results/gates-2026-10-27T22-00-00.000Z.json` · `audit/AUDIT_2026-10-27_R18.md` |
| 2026-10-27 | **R18 外部候选**（沿用 ADR-0004，未扩大机制） | 同上会话批准（R18 计划：10 个真实 pin 候选 + 4 个夹具 + 3 个合成形状） | DeepSeek V4.1 Flash：10 个真实包（status-rotator / dream-skin / claude-style / free-search / dsh-cron / plugin-notify / archive-manager / mcp-connector / remote / git-worktree），全部 pin、MIT 或 Apache-2.0、装进系统临时目录的独立 `DSH_HOME`、跑完即删；源码不进仓、不进 `quarantine/`，只登记元数据 | 候选清单与「为什么是这 10 个」；仍不判安全性（`COMPLIANCE.md` §5） | `data/results/probe-matrix-2026-10-27T20-30-00.000Z.json` · `audit/AUDIT_2026-10-27_R18.md` |

| 2026-10-28 | **R19 D2 预算口径（判据改动）**：`scripts/d2_report.mjs` 的 `boot-budget` 只对 `real:true` 的 run 判定；夹具耗时单列 `timing.fixtures_over_budget`；`probe_reliability` 的预算项同样只作用于真实候选 | 会话内原话（选项）：「签字：预算只算真实候选（推荐）」 | DeepSeek V4.1 Flash：**没有**放宽真实候选的门槛（仍是 100% 在 20s 内，不是 90%）；只把「永不 settle 的夹具」从判定分母里摘出，并把它的 21.3s 原样写进产物与 `check.detail`。负对照：真实 run 超预算仍红（`tests/governance/d2-report.test.ts`） | 「20s 预算」这个产品承诺本身是否该随 `--unsettled-timeout` 调整（`BS-28` / T-311）；HUMAN 未逐条复核 spec §4 的措辞 | `data/results/d2-2026-10-28T12-10-00.000Z.json` · `docs/specs/M3-probe.md` §4 · `audit/blind_spots.json` BS-28 |
| 2026-10-28 | **R19 外部候选（+3）**：`@lolkda/dsh-skills-manager@0.3.1` · `dsh-unlag@1.12.5` · `@tencent-connect/dsh-qqbot@0.5.3` | 会话内原话（选项）：「保留（推荐）」 | DeepSeek V4.1 Flash：三个包全部 MIT、无 install/postinstall 脚本、pin 精确版本；装进系统临时目录的独立 `DSH_HOME`，跑完即删；源码不进仓、不进 `quarantine/`，只登记元数据（`quarantine/vendor-manifest.json`） | 候选清单与新声明形态（`engines.dsh`-only / `dsh.compatibility`）的取舍；仍不判安全性 | `data/results/probe-matrix-2026-10-28T11-40-00.000Z.json` · `tests/fixtures/probe/matrix-r19.json` |

| 2026-10-28 | **R21 采纳 ADR-0006 第 1–3 条**（「20s」= 测量预算，不是墙钟承诺；新增 `timing.wall_clock` 与 `limits[]` 自曝；**不动任何阈值**） | 会话内原话：「同意，继续」 | DeepSeek V4.1 Flash：落地文案 + `d2_report.timing.wall_clock` + `record_probe` 的 `limits[]`；同日实测**纠正**了自己写的「不可判 ≈25s」→ 正常候选 `boot` 步 22.1–25.3s、不可判 42.7s，差额归 T-314；`settle 15s` / `--unsettled-timeout 20000` 一字未动 | 差额的工程解释（T-314）；方案 A（settle→10s）与 C（两阶段）未授权，HUMAN 未逐条复核 spec §4 措辞 | `data/results/d2-2026-10-28T16-00-00.000Z.json` · `docs/adr/0006-probe-budget-promise.md` |

| 2026-10-28 | **R23 ADR-0007 追认**：沙盒 `pnpm-workspace.yaml` 写 `strictDepBuilds: false`（不批准任何构建，只把 pnpm 的错误降为提示；源 profile 自带 workspace 时一律不覆盖；install 步必须读回 `dsh.profile.bundles` 确认候选真的进组合） | 会话内原话：「同意，继续，处理所有问题」（授权继续执行 backlog 全部三项，包含 T-315 的口径落地） | DeepSeek V4.1 Flash：ADR 记录 6 条拒绝方案与 4 条可机器检查的边界；**没有**批准任何构建脚本（`onlyBuiltDependencies` 保持为空，被跳过的包逐个进 `install.ignored_packages`）；`strictDepBuilds` 在 `.npmrc` 里无效（已对照实测） | HUMAN **未逐条复核** F41–F43 的对照实验与 `pnpm_policy` 三态文案；`nodeLinker` / `strictPeerDependencies` 等其它可继承设置**未逐一实测** | `data/results/probe-copy-profile-ok-2026-10-28T14-30-00.000Z.json` · `probe-copy-profile-strict-2026-10-28T15-00-00.000Z.json` · `docs/adr/0007-sandbox-build-policy.md` |
| 2026-10-28 | **R23 T-313 凭据来源审计（口径收窄，不改判据）**：把探测器从「pnpm 日志」换成「本地假 registry 记 `authorization` 头」，对六类来源 × `404`/`401` 各测一遍，并据此改写 `BS-29` 与 `docs/adr/0004` 的对外口径 | 会话内原话：「同意，继续，处理所有问题」 | DeepSeek V4.1 Flash：**没有**读任何真实凭据文件（token 全部是本脚本写进临时目录的合成串），也没有扩大沙盒权限；结论只到「审计过的来源里只有 user config 会被读，且已不外发」 | HUMAN 未逐条复核 30 次运行的对照与「旋钮未被读」的判定；非 Windows / 其它 pnpm 版本仍未覆盖 | `data/results/credential-sources-2026-10-28T19-00-00.000Z.json` · `docs/specs/M3-probe.md` §8.6 |
| 2026-10-28 | **R23 T-314 墙钟口径改正（只改文案，不动阈值）**：把 ADR-0006 与 spec §4 的「不可判 ≈25s / ≈43s」改成实测的「可判 ≈16s / 不可判 ≈48s」，并新增 `timings.bootSegments` | 会话内原话：「同意，继续，处理所有问题」 | DeepSeek V4.1 Flash：`settle 15s` / `--unsettled-timeout 20000` / `boot→sample ≤20s` **一字未动**；只加计时、改文案；同时推翻了自己 R21 写的两个数字 | HUMAN 未逐条复核三份真机分段读数与「替换等待 20.3s」的归因 | `data/results/probe-boot-segments-{template,overrun,copy}-2026-10-28T1*.json` · `docs/adr/0006-probe-budget-promise.md` |
| 2026-10-28 | **R24 ADR-0008 方案 E 授权（阈值相邻的决定，尚未实施）**：`settled:false` 的样本不再等替换窗口（立即收敛），`{error}`（含 `inactive-context`）仍等满 `--unsettled-timeout`；`--unsettled-timeout` 的**默认值不改**（仍 20000），`settle 15s` 与 readiness 5s 不改 | 会话内原话：「同意。先进行项目交接，即将切换会话」（承接上一轮提问「A/B/C/E 选一个」，推荐项为 E） | DeepSeek V4.1 Flash：**本轮只做交接，一行实现都没写**；ADR-0008 的状态改为「已授权、未实施」，`实施清单` 写了 5 条 + 3 条必须仍成立的回归；默认值与判据 diff 为空 | HUMAN 未逐条复核 ADR-0008 的 29 份产物统计与三组窗口实测；`{error}` 形状在已记录产物中出现 0 次，其回归需要新夹具（下一轮） | `docs/adr/0008-unsettled-wait.md` · `data/results/replacement-window-2026-10-28T21-30-00.000Z.json` |
| 2026-10-28 | **R26 ADR-0008 方案 E 实施记录**（承接上一行授权；**不改任何阈值**）：样本循环只在样本**不可读**（`{error}`）时开替换窗口，`settled:false` 立即收敛；产物新增 `inventory.replacement_waited` 等 6 个显式字段；文案/文档同步 | 授权来自上一行（HUMAN 2026-10-28「同意。先进行项目交接，即将切换会话」）；本轮会话内指令「同意，继续，处理所有问题」= 执行已授权项 | DeepSeek V4.1 Flash：**`--unsettled-timeout` 默认 20000、hook `settle 15s`、settled 树 readiness 5s、`boot→sample ≤20s`、`isUsableSample()`、`judgeProbe` 的结论映射全部一字未动**；只改「等谁」不改「等多久」。三条回归真跑/单测全过；真机同夹具 `boot` 步 48.4s → 28.6s | HUMAN 未逐条复核：假 launcher 单测的覆盖面（它证明循环行为，不证明真实 hook 会写 `{error}`）、本轮三次真跑的计时波动（`BS-32` 新开：21.7–28.6s 是区间）、以及 post-E 矩阵尚未重测（`T-309`） | `data/results/probe-adr0008e-overrun-2026-10-28T22-30-00.000Z.json` · `probe-adr0008e-slow-2026-10-28T22-40-00.000Z.json` · `probe-adr0008e-real-2026-10-28T22-50-00.000Z.json` · `tests/unit/probe-host-sample.test.ts` · `docs/adr/0008-unsettled-wait.md` §实施记录 |
## 未决的授权项（尚未签，不要当成已签）

| 项 | 需要谁 | 为什么不能由 agent 代办 |
|---|---|---|
| `npm login` + 发布 `dsh-triage@0.0.1` | HUMAN 亲自操作 | 需要你的 npm 凭据；agent 不得读 `~/.npmrc` 或 token |
| 仓库转 public | HUMAN | 不可逆的对外动作（git 历史永久可见） |
| T-202a 真实会话（读 agent 作用域） | HUMAN 先签 ADR | 与铁律 4（不得读凭据 / 不得向沙盒注入真实凭据）冲突，改宪法必须有明文 ADR |
| 门禁阈值变更（若有） | HUMAN | 铁律 4：阈值变更需 spec + HUMAN-SIGN |

## 记录格式（后续照此追加）

```
| 日期 | 范围（文件/判据/阈值） | 授权（原话或摘要） | 执行与结论（模型 + 做了什么） | HUMAN 未逐条复核的部分 | 证据（产物 + sha256） |
```
