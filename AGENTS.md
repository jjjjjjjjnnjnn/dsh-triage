# DSH-Addition AGENTS.md

> **产品名**: **dsh-triage**（品牌：分诊台 / Triage）｜**仓库**: `https://github.com/jjjjjjjjnnjnn/dsh-triage`（public）｜**npm**: `dsh-triage@0.3.4`（**四包已发布**，`latest=0.3.4`；取证 `data/results/publish-2026-11-03T16-05-17.632Z.json` **18/18 · `git_dirty=false`**，另有一份「读早了」的红产物 `publish-2026-11-03T15-45-35.175Z.json`：发布后副本滞后 ~5 分钟，同一份产物里匿名安装等 302 秒后成功）（0.3.3 取证 `data/results/publish-2026-11-02T15-54-38.303Z.json` **21/21**、`git_dirty=false`、`head 0ad06c7`；过程见 `audit/INCIDENT_2026-11-02_missing-signals-0.3.3.md`）（0.3.2 取证 `data/results/publish-2026-11-02T14-24-39.944Z.json` **20/20**、`git_dirty=false`、`head 6fde8da`；发布当晚有过一次部分发布，见 `audit/INCIDENT_2026-11-01_partial-publish.md`；R62 又抓到「取证紧跟发布 → 副本滞后假红」，见 `scripts/lib/registry-wait.mjs`）｜**Stand**: R90 (2026-11-05，**交接轮**：R88/R89 的 8 个提交第一次上 CI（run `42098350228`）；818 测试 / 9 门 / `--mutate` 9-9；D5 覆盖 `11-01..11-04`，下一跑截止 **`2026-11-13`**；修掉入口文档的日期漂移；**判据/阈值一字未动**)｜R88 (2026-11-05，**文档漂移对账（交付轮）**：重复归档指针合并、八行原文归档（8/8 逐字节）、口径落到 R79–R88；规模行改为按仓库实算 818 测试 / 488 产物 / 512 步 / 60 盲区 / 7 角色卡，并由 `tests/governance/handoff-scale-line.test.ts` 复算；**T-862 规划半边**：三个假设逐条核过（178 → 107/71、160/160 名字不是包、950 全是 unknown），产出 `X1`/`X2`/`X3` 三份草案；**判据/阈值一字未动**；818 测试)｜R87 (2026-11-05，**交接轮**：HUMAN 回帖推广 + 工程侧「事实包 / 回填 / 问题分析 → 计划性扩展」写进 HANDOFF §3；新增 `T-862`；**判据/阈值一字未动**；805 测试)｜R86 (2026-11-05，**关窗前定桩（不开功能）**：**805 测试 / 9 门 ALL GREEN** + `--mutate` **9/9**；`d5_window_status` 复算 → 覆盖 `11-01..11-04`、今天可采 **0 天**、**下一跑截止 `2026-11-13`**；D 线 `docs/11-d-path.md` + 事实包 `docs/copy/facts/2026-11-05-upstream-attribution.md`；`T-855`–`T-858` 推迟到判定后；**判据/阈值一字未动**)｜R85 (2026-11-05，**交接轮（不改行为）**：把 R82–R84 那 10 个提交第一次推上 CI（run `42028080241` 与 `42028436382` **5 job 全绿**，`release readiness` 按设计只在 tag 时跑）并把这件事写进入口；§2 只留最近十轮（R75–R84），R67–R74 的 **8 行**原文逐行进 `_archive/2026-11-05_HANDOFF-batch-rows-R67-R74.md` 并登记 `ARCHIVE_MANIFEST`；§3 重写成「D5 关窗 + SAFE MODE 入口 + 两条外部线程状态 + 邮件环境备注」；交接快照 `snapshot-0.3.4-handoff-R85` · **判据/阈值一字未动**；**805 测试**)｜R84 (2026-11-05，**T-861 落地：更新提示指向旧代码的证据**：纯函数 `judgeUpdateOrder()`（四态 `trap` / `no-trap` / `no-candidate` / `unmeasured`）+ `audit --registry` 显式开关（默认路径逐字节不变，N6 钉住）；live 3 行 `no-trap` + 5 条纯函数用例全过；负对照 N1–N6 逐条真红，`true ? 'trap'` / `false ? 'trap'` 两个方向各自抓到对应断言；spec 两处实施偏差已写进 §7 · **判据/阈值一字未动**；**805 测试**)｜R83 (2026-11-05，**外部更正 + 规则收窄**：`#12209` 作者指出我们的探测取自「下架之后」，按构造分不出「比较逻辑对」与「没东西可比较」→ **接受更正**，并把「缓解之后的读数不能当机制证据」写成文案红线；补四条代码层事实、给出更窄的更新判定规则；`record_update_trap.mjs` 两份产物（`traps 0/4`、`0/60`，**如实说没找到活的实例**）；新 spec `M9-downgrade-trap.md`（判据先行、未实现）· **判据/阈值一字未动**；**792 测试**)｜R82 (2026-11-05，**急救箱两块都落地**：新命令 `dsh-triage rescue`（M8 A+B）—— 三态分类 `official` / `third-party` / `unresolved`（官方 scope 的 `unresolved` **只报告不裁**），默认零写盘；`--apply` 只改 `dsh.profile.bundles`（备份 + 原子替换 + 回读 + journal），`--undo` 逐字节还原并在 profile 被改过时拒绝覆盖；`read_only` / `byte_exact_restore` 都由 sha256 比出来；N1–N11 逐条真红后还原 · **判据/阈值一字未动**；**792 测试**)｜**R81 (2026-11-05，**同定位仓库研究 + 急救箱方向**：`scripts/record_adjacent_tools.mjs` 用 7 条固定查询采证 **140 个 DSH 相关仓库**（12 个 rescue/doctor 词面命中、6 个无许可证）+ `docs/10-adjacent-tools.md`（可学机制 / 不可抄代码 / 缺口）；下一阶段 `rescue` 计划、SAFE MODE、`profile snapshot` **分支优先**（`T-854`–`T-859`）· **判据/阈值一字未动**；**763 测试**)｜**R80 (2026-11-05，**文案通道 + 外部触达**：对外文案所有权交给外部 `copywriter`（Gemini）——`docs/copy/`（事实包 → 草稿 → 结构校验）+ `.agents/roles/copywriter.md` + `tests/governance/copy-channel.test.ts`（3 条）；同时扫 300 条最近更新的 upstream Discussions，挑出 4 条声明层候选（#10849 / #12210 / #10458 / #10759）与 1 条只能给排查命令的 #12192，按帖子状态与评论排除两条已被回答的（#8202 / #11687）；**判据/阈值一字未动**；**763 测试**)｜**R79 (2026-11-05，**采证 + 交付**：上游 `next` 从 `0.2.1-rc.5` 变成 **`0.2.2-rc.1`** → 真机重跑升级日卡片（**14/14**：192 单元 → **119 会被拒 / 73 判不了 / 0 会变好 / 0 像没事**）+ 已发布 `0.3.4` 的可用性 smoke **6/6**（`upgrade --to next --card` 的目标已是 `0.2.2-rc.1`）；D5 窗口内**第二份现场基线**（窗口 `10-28..11-03`、周下载 **1564**、`steady` 40.5%，日序列 `0/634/192/17/192/357/172` 仍是 10-29 爆发的回声，`BS-48`）→ 覆盖推进到 **`11-03`**、截止 **`2026-11-12`** · **判据/阈值一字未动**；**760 测试**)｜**R78 (2026-11-03，**维护 + 交接**：`backup/BACKUP_POLICY.md` 从 M0 起写着「快照由 `scripts/snapshot_state.mjs` 生成」而**那个脚本从未存在**、`backup/snapshots/` 只有 `.gitkeep`、也没有门禁看过 `backup/` → 脚本落地 + 两条治理检查（策略点名的脚本必须存在、每个快照必须能被 `.sha256` 验证，负对照真红）+ 交接快照；同时核对出 **tag 线从未启用**（表里 3 个里程碑 tag 一个都没打，记成 `T-848` **未签不打**）· 文案与证据对齐 `T-844`/0.3.4 已发布 · **判据/阈值一字未动**；**760 测试**)｜**R77（2026-11-03，发版 + 整理**：四包 **`0.3.4` 已发布**（`latest=0.3.4`；T-844 的复制修复随 `client.js` 到用户手里）+ CHANGELOG + 上架文案 / README 的版本号与测试数对齐（`check_listing` **17/17**）· 预检先如实报 `E401`、`npm login` 后走 `release:publish`，取证 **18/18**（首份读数撞上副本滞后 ~5 分钟，红产物保留）· `docs/HANDOFF.md` §2 按既定口径只留最近十轮（R39–R66 的 **31 行**逐行归档并登记 `ARCHIVE_MANIFEST`）· **判据/阈值一字未动**；**760 测试**)｜**下一件事：窗口内基线的第四跑，截止 **`2026-11-13`**（这个日子是 `scripts/d5_window_status.mjs` 按已提交产物算出来的，不是记的；覆盖已到 `11-04`）→ 11-15 关窗**｜**定位（R47 重定向）**：正门从「通用检查器」改成「**升级日**」——每次 rc 发布回答「**你这套已装集合**升上去会坏什么」；**R48 已交付「陌生人 60 秒」四项**（`--to next` / 无参数引导 / 卡片落盘 / README 首屏）；**R49 修好「打开就有一屏答案」**（无参 = `status`、`audit` 摘要优先、面板首屏 + `docs/SECURITY.md` + 11 条对抗性测试），并按用户反馈把面板做成可操作（搜索 / 筛选 / 排序 / 详情抽屉 / 主题 / 深链），再默认成**简单模式**（人话结论 + 一个按钮 + 简单/详细切换），并交付**自动修复**（`fix`：计划 / `--apply` / `--undo`，先备份后原子写，M7 判据）与**面板视觉重做**（独立 agent，去 AI 化），冒烟 18/18；**R50 把 0.3.0 发出去并修掉发布预检查的假警报**（preflight 在 Windows 上没调起 npm 却报「你的 token 401」，详见 `scripts/lib/npm-auth.mjs`）；**R51 让这份答案直接出现在 DSH 设置页**（新只读路由 `/compat-triage/summary` + 页签重写成一屏答案：人话结论 / 计数 / 最多 3 条「要看的地方」+ 复制修复，真机 10 步含 `summary-visible` 与 `same-source`）；**R52 让 D5 的下载口径不再能被单日爆发骗过**（`download_shape` 判定：7 条单测 + 4 条端到端，含「真实 634 序列必须判成 burst」与「steady 25 必须算通过」两条方向相反的对照；基线真跑 `failures: []` + 离线逐字节复算），并把升级日卡片换成**真实存在的 `0.2.1-rc.5`**、交付 `T-810` 五篇草稿与 `check_listing` 第 9 条断言（12/12，含两条红产物与一条定向负对照）；**R53 把 0.3.1 的票做好并核实渠道**（四包同升 / CHANGELOG / 两份 README + 两份上架文案 + 提交包对齐，`check_listing` **12/12**；发布预检查如实报 **`E401`**——本机 npm 凭据已失效，发布前需 `npm login`；顺带核实 **dsh.so 已收录**（三个端点 200、`L5 · Run tested`、security `low` → `listed`），并发现 **#65 已变成 `DIRTY`**：与上游 `main` 冲突，需要 rebase；**同晚发布时发生部分发布**——`dsh-triage` / `probe` / `signals` 的 0.3.1 上去了，`@dsh-triage/core@0.3.1` 被 registry 暂存挡住 → `latest` 一度指向装不上的版本（现场与修复路径见 `audit/INCIDENT_2026-11-01_partial-publish.md`，红产物 `publish-2026-11-01T17-15-00`），发布链已改成 `preflight → publish → record_publish` 自动取证）；**R54 把「投放」变成一套可执行的包**（D5 读数口径先写死：`docs/specs/D5-measurement.md` + 纯函数 `judgeD5` + **8 条单测**对应 N1–N7；计量脚本 `record_d5_evidence.mjs` live/fixtures 双模，读不到记 `unmeasurable`、burst 不算需求；`record_client_serve --screenshot` 拍到**两张真机截图**；草稿 01 按上游 **Show Your Plugins** 六条改写成纯中文；检查器又抓到 4 条我自己写的禁用话术）；**R55 把设置页换成了三张表**（计数 / 问题 / 下一步；内联样式在这个宿主里有效、但列宽靠内容撑；探针改成按行读回 `data-count-*`；「标签与命令分开」的断言从文本搬到单元格；后补：**三类问题同屏的混合演示**（denied + collision + unknown），并修掉「标题说 2 个、表里只列 1 个」的自相矛盾）；**R56 文案重写 + 发帖 + D5 开表**（用户把中文文案改成工程化措辞：不再有「宿主 / 会坏 / 撞车 / 判不了」；两张图同 stamp 重录后产物与图一致；帖子 `#11813` 已发到 Show Your Plugins!；`record_d5_evidence` 首跑 **`pending`**：reactions 0/10 · 外部引用 0/1 · 634 burst 不算需求，窗口到 `2026-11-15T20:24:37Z`；新增第 13 条「已发布」断言，含空转守卫与三次才做对的负对照）；**R57 采证「上游求助帖我们能答哪些」**（12 条分层：`names-a-denial 7 · rules-out-declaration 1 · declares-nothing 3 · runtime 3`；对点到包名的帖子用**同一个** `evaluateAdmission` 真算准入，帖子点名版本就按点名版本判；两个假话自己抓的：把「不是 admitted」写成「denies」→ 应用「拒自己」，裸名 `dsh-llm` 会指到别的包）；**R59 大样本 Question 覆盖率**（先签口径再跑：Q&A **1545/1545** + General **5786/5786**；头条 **74/1545 = 4.8%**（Wilson 3.8–6.0%）；七档 47/27/89/164/90/178/950；抽检 agent **9/20** + HUMAN **5/5**；README 两份新增一节 + `check_listing` **14/14**，含 3 条定向负对照；**三个自己抓到的假绿/假阳性**：`undefined` 快照 → 复算 exit 1、`undefined`→`null` → 81 条 unconstrained 翻 denied；判据/阈值一字未动）；**R60 分类器 v2 实验**（开发集 **20/20**、互斥留出集 **12/20**、v1 7/20；未达 80%，**不采用**；生产仍 v1，覆盖率 4.8% 与 README 9/20 不变；新增 `BS-53`）；**R60 续 · 分类器 v3 候选**（开发集 20/20、留出集 1 17/20、**干净留出集 2 17/20 = 85%**；过 80% 但**未采用**，需 R62 live 重测 + HUMAN 5 条）；**T-818 四桶页签 ✅ R62 收口**（R61 记的「页面 fetch 仍 loading」查明是**探针 ≈500ms 就收工**：加载态走失败视图、终止条件把「有 error 元素」当判；修后真机 **16/16**，`upgrade-visible` + `upgrade-same-source` 全绿，四桶 3/190/0/2 与 CLI 逐项相同；`judgeTabView`/`judgeUpgradeView` 把「loading 不是结论」变成单测强制的规则，四条负对照各自真红；**0.3.2 已发布**（四包 `latest=0.3.2`，取证 20/20），发布后同轮修掉「取证紧跟发布 → 副本滞后」的假红；**`T-829`：`record_publish` 现在验浏览器半边**（21 项）；新盲区 `BS-54`）| M0 ✅（9 门 / 9-9 · **760 测试**）· M1 ✅（27 金标 / D1 9-10）· M2 ✅ · M3 ✅（R14–R37，稳定性有分布）· M4 ✅（面板 / 徽章 / 索引源 / Agent 工具 / **设置页一屏答案**）· M5-a 本地半边 ✅（R41）· M5-b ✅（R42/R44）· **M6 升级日 ✅ 入口四项（R48），出口 = D5 待判**（细节以 `docs/HANDOFF.md` §2 为准）
> **Mission**: 在 DSH 生态里做「升级日」的判断层——每次 rc 发布，回答「**你这套已装集合**升上去会坏什么、怎么修」，再把同一份结果做成市场 / 索引源 / CI 能直接消费的数据 | **Root**: `DSH-Addition`（仓内相对路径；本机绝对路径见 `docs/07-environment.md`）
> **上游**: DeepSeek Harness（npm `latest` = **0.2.1-rc.5** · `next` = **0.2.2-rc.1**（R79 实测）；仓内沙盒 0.2.1-rc.4；本机 profile 实测 0.1.0-rc.6） | **Node**: ≥22.19（本机 v24.15.0） | **pnpm**: 12.15.0
> **接手先读**: `docs/HANDOFF.md` → `PROJECT_RULES.md` → `INDEX.md`（三份即可开工）

---

## 🎯 Mission & Scope

**一句话**：在「装得上」和「跑得对」之间做判断层，**正门是升级日**。

**为什么改（R47，外部取证；证据见 `data/results/market-baseline-2026-10-29T12-20-00.000Z.json`）**：三个产品存在性问题（为什么必须装 / 为什么要有这功能 / 为什么不用别人的）在 R46 之前都没有答案。取证后的结论是——**通用诊断类在这个生态里没有需求形态**：

| 事实 | 数值（R47 窗口 `data/results/market-baseline-2026-10-29T12-20-00.000Z.json`；"我们自己"那一行是 R52 复测 `market-baseline-2026-10-31T06-40-00.000Z.json`） |
|---|---|
| 诊断类目天花板 | 整个品类周下载 **1,988**（`dsh-doctor` 1,175 / `dsh-verify` 462 / `plugin-guard` 196 / `plugin-check` 77 / `dsh-guard` 56 / 其余 12），是市场类（**380,240**）的 **0.52%**、装饰类（**411,844**）的 **0.48%**。**R52 复测（新窗口）：诊断 3,074 / 市场 513,534 / 装饰 552,956** |
| 我们自己 | `dsh-triage` 周下载 **634**，但**全部落在 2026-10-29 一天**（前后都是 0）→ `download_shape: single-day-burst`，**按 D5 读数规则不算需求**（`data/results/market-baseline-2026-10-31T06-40-00.000Z.json` 的 `d5.verdict = burst-not-demand`，`BS-48`）；registry 有 0.3.0 |
| 痛点是真的 | 上游最近 **842** 条 Discussions 里 **414 条是故障（49.2%）**，其中 **278 条零回复（67.2%）** |
| 但形态不对 | 赢家都是「在界面里、开箱可感、零配置、高频」：装饰类合计 411,844、市场类 380,240、能力类 304,666；harness 本体 540,139 |

四条候选路（进别人安装路径 / **升级日** / 作者侧 CI / 承认它不是产品）里，HUMAN 在 R47 选「**升级日当正门**」，出口门禁是可证伪的 **D5**（见 `docs/ROADMAP.md` §2）。

四件上游结构上不做的事（这一层不变）：

1. **归因**：一条命令回答「我的工具为什么不见了」——被 admission 拒绝的行 / import 失败的行 / 声明了但没注册上的能力；
2. **组合判断**：候选插件 × **本机已装集合** 的冲突（entry id / service / tool / command / settings / slot）；
3. **隔离实测**：在独立 `DSH_HOME` 里真装真启动，出 `boot / http / inventory / namespace-diff` 证据；
4. **回流**：opt-in 匿名结果 → 群体先验（唯一不会被上游吸收的资产）。

**明确不做**：不做插件市场/目录、不做启动器、不做通用安全扫描器、不做装/卸/回滚（上游 `plugin_manager` 已接管）、**不做全网公开兼容矩阵**（`dsh.so` 已用 L1–L5 占位，正面撞不过；我们的差异化只有「你的机器 + 你的集合」）。

---

## 📂 Architecture Map

```
DSH-Addition/  (repo: dsh-triage · 品牌：分诊台 / Triage)
├── .agents/                       # Agent 工作框架（交接入口见 .agents/README.md）
│   ├── README.md                  # 三入口 / 角色速查 / 机器校验项
│   ├── roles/                     # researcher / implementer / verifier / reviewer / adversary / arbiter
│   ├── prompts/                   # task-packet / review-packet / handoff-packet
│   └── rules/                     # integrity / reproducibility / agent_collaboration / execution-playbook / adversarial_review
├── .github/workflows/ci.yml       # 门禁 CI（正常 + 负对照 + 发布检查）
├── audit/                         # AI 披露 + 机器强制台账（gate_ledger / blind_spots / step_reviews，tests/governance 校验）
├── backup/BACKUP_POLICY.md        # 快照策略（snapshots/ 同名 + .sha256）
├── _archive/ARCHIVE_MANIFEST.md   # 只进不出归档索引
├── quarantine/                    # 外部产物隔离区（双门制）+ vendor-manifest（许可真相源）
├── sandbox/                       # 仓内 DSH 运行时（git 忽略）：upstream/<ver>/{install,home}，可挂载可删除
├── data/
│   ├── gold/admission-cases.json  # 金标夹具（admission 语义对等基准，人工签署）
│   ├── cases/CASE-*/              # 真实案例：输入 manifest + 机器可算 label + 偏差披露
│   ├── raw/                       # 原始证据（git 忽略重物）
│   └── results/                   # SSOT：脚本真跑 JSON + .sha256
├── docs/
│   ├── HANDOFF.md                 # 交接入口（五分钟检查 / 当前批次 / 第一件事 / 坑）
│   ├── ROADMAP.md                 # 12 周执行计划 + 决策门 + 指标看板
│   ├── BACKLOG.md                 # 可领取任务清单（ID / 角色 / 依赖 / 验收）
│   ├── AI_HANDOVER.md             # 真相源 / 防幻觉规则
│   ├── DESIGN-MAP.md              # 六层架构 + 门与证据矩阵
│   ├── 00-vision.md 01-competitors.md 02-signal-sources.md
│   ├── 03-failure-taxonomy.md 04-admission-semantics.md 05-verdict-contract.md
│   ├── 07-environment.md 08-conventions.md 10-adjacent-tools.md
│   ├── adr/                       # 决策记录（Result 优先 / 覆写不是撞车 / 零依赖门禁 / 外部候选取用边界 / 渲染后端 / 20s 预算口径[proposed]）
│   ├── specs/M0-skeleton.md M1-why.md M2-inventory.md M2-capabilities.md M3-probe.md M4-surface.md M5-upgrade.md M5-reflow.md M6-upgrade-day.md M7-autofix.md M8-rescue.md M9-downgrade-trap.md D5-measurement.md question-coverage.md + **R88**：X1-reply-command-pack.md / X2-name-extraction-precision.md / X3-not-relevant-means-no-signal.md（扩展计划草案，**规划不实施**）
│   ├── market/listing_zh.md       # 上架文案（首屏 = 升级日，R47 起）
│   └── copy/                      # 文案通道：事实包（工程侧）+ 草稿（Gemini）+ 结构校验
├── packages/
│   ├── core/     @dsh-triage/core   # 判断引擎：admission 语义 / env 指纹 / 能力台账 / 相位层 / 副本来源 / dsh.compatibility 与 registry 次要通道 / upgrade 四桶 / verdict 组装（纯函数、可离线）
│   ├── signals/  @dsh-triage/signals# 信号适配器：npm registry / dsh.so / hub catalog / 本机外部工具产物
│   ├── probe/    @dsh-triage/probe  # 隔离实测（M3）：plan 生成 + exec 执行/判定 + host 唯一一份 Host I/O（样本循环：`{error}` 才开替换窗口，ADR-0008 E）+ render 白屏判定（CDP）+ hooks/inventory-hook.mjs
│   └── plugin/   dsh-triage         # 用户安装件：DSH profile bundle + Web 面板（client.js）+ Host 只读路由（host-audit-route.ts）+ Agent 工具 compat_verdict（host-tool.ts + fit.ts，与 check 同一条引擎链；hooks/tool-hook.mjs 只做真机取证）+ bin CLI + probe-run.ts + serve.ts（本地面板）+ audit-data.ts（audit 的纯数据层，CLI 与面板共用）+ summary.ts（一屏答案的纯投影，CLI 与面板共用）
├── scripts/                       # 门禁（gate_*，9 门）+ 真跑落盘（scan_env / record_case / record_audit / record_registry / record_probe / record_render_fixture / record_serve_smoke / render_inventory / d1_report / probe_live_sample / bootstrap_upstream / record_upgrade_impact / record_market_baseline）+ **R64**：`watch_next_release.mjs`（升级日监听：`changed`/`unchanged`/`unmeasured`）+ `lib/dist-tags.mjs`（四包 `latest` 一致性）+ **R65**：`record_usability_smoke.mjs`（匿名装已发布包 → 四条命令真跑）+ `lib/posting.mjs`（上架登记规则）+ **R71**：`record_discussion_state.mjs`（回帖前读帖子状态：`open`/`answered`/`closed`/`unreadable`）+ `lib/discussion-state.mjs` + `record_remedy_probe.mjs`（「建议装哪个构建」过同一个 `evaluateAdmission`）+ `watch_next_release.mjs --baseline`（CI 里也能看见变化）+ **R76**：`d5_window_status.mjs`（D5 窗口覆盖与「下一份基线最晚哪天跑」，只读；`lib/d5-window-coverage.mjs` 纯函数）+ **R81**：`record_adjacent_tools.mjs`（同定位仓库采证：7 条固定查询 + 许可证字段；`docs/10-adjacent-tools.md`）+ **R88**：`record_extension_candidates.mjs`（T-862：把覆盖率产物按「能不能答」重分组，校验源 `.sha256`，零网络）
├── .github/workflows/watch-upstream.yml  # **R71**：每 6 小时读上游 `dist-tags.next`；`unmeasured` → job 失败；CI 里不跑卡片
├── .github/workflows/d5-window.yml  # **R86**：每天 06:00 UTC + 手动跑 `d5_window_status`；`urgent` / `lost` → job 失败，读不到也失败；**窗口结束后自退役**；不刷基线、不写 SSOT
├── tests/                         # node:test + TS（admission / verdict / ledger / governance；含文档漂移断言：Stand 一致、规模行九项实算、D5 截止日）
├── AGENTS.md / PROJECT_RULES.md / INDEX.md / COMPLIANCE.md / LICENSE(MIT)
└── package.json / pnpm-workspace.yaml / tsconfig*.json / .npmrc / .editorconfig
```

---

## ⚡ Standard AI Agent Workflows

### 0. 接手必读
先读 `docs/HANDOFF.md`（五分钟检查 + 当前批次 + 第一件事）→ `PROJECT_RULES.md` → `INDEX.md`，再动任何文件。

### 1. 跑全链（提交前必跑）
```powershell
pnpm install
pnpm run verify     # build → typecheck → test → gate
```

### 2. 单独跑门禁
```powershell
node scripts/gate.mjs            # 全部门
node scripts/gate.mjs --fast     # 跳过需要构建产物的门
node scripts/scan_env.mjs        # 真扫本机 DSH profile → data/results/*.json + .sha256
node scripts/record_market_baseline.mjs --stamp <ISO>   # 市场基线（R47）：npm 下载 + Discussions 痛点分布 → SSOT
```

### 3. 流程分级（R47 起，HUMAN 批准）

零用户阶段按「有没有动判据」分级，**只降审核成本，不降证据要求**：

| 轮型 | 触发 | 必须做 | 可跳过 |
|---|---|---|---|
| **判据轮** | 动 `admission.ts` / 冻结阈值 / `data/gold/` / verdict 契约 / 任何 `conclusion` 的计算 | 四轴 review + 对抗性反例 + `step_reviews.json` 每步一条 + 真跑产物 + `gate.mjs --mutate` | 无 |
| **交付轮** | 只动文档 / 文案 / 分发 / 新增渲染（不改判据） | 1 次真跑产物（`data/results/` + sha256）+ 1 个 verifier 复算 + 轮末一条汇总台账 | 四轴并行 review、per-step 台账、对抗性小节 |
| **采证轮** | 只读外部数据（npm / GitHub API）并落快照 | `produced_by` + `generated_at` + 原始快照进 `data/fixtures/`（离线可复算） | 负对照（没有门可骗） |

红线：**进入 `data/results/` 的任何数字仍必须由脚本产出、带 sha256、可离线重算**；改判据永远走判据轮。

### 4. 合规检查
- 新结论进 `data/results/` 必须由 `scripts/` 真跑，禁手填；`gate_ssot` 会检查 `produced_by`；
- 外部插件产物（tarball/源码）只进 `quarantine/`，禁直读直跑；
- 非人类手写模块记入 `audit/AI_DISCLOSURE_LOG.md`；
- 每条结论必须带证据等级（`declared/measured-*/scanned/inferred`），无证据只能出 `unknown`。

---

## 关键工程约定

- **TypeScript ESM**，包内相对导入必须写 `.js` 后缀；`erasableSyntaxOnly` 打开以保证 `node --test` 可直接跑 TS。
- **零门禁依赖**：`scripts/gate_*.mjs` 只用 Node 内置模块，任何情况下不得因缺依赖而失效（门禁必须永远能跑）。
- **失败即失败**：门禁返回非 0 必须修根因，禁放宽阈值；阈值变更需 spec + HUMAN-SIGN。
- **本机 DSH 只读**：任何代码不得写 `~/.dsh`（除 `probe` 在独立 `DSH_HOME` 下操作），`probe` 默认 dry-run。

---

## 🤝 Agent 协作与交接（随时可换人）

**入口**：`.agents/README.md`｜**交接**：`docs/HANDOFF.md`｜**任务**：`docs/BACKLOG.md`｜**计划**：`docs/ROADMAP.md`

### 常设角色（`.agents/roles/`）

| 角色 | 干什么 | 禁区 |
|---|---|---|
| Researcher | 卡住先外部取证（≥2 角度），结论带 A/B/C 证据等级 | 禁写实现代码 |
| Implementer | 按 spec 写码，先写断言 | 禁改判据/阈值、禁跳门禁 |
| Verifier | 独立上下文、只看产物复算 | 禁看实现过程、禁复述他人的结论 |
| Reviewer ×4 | 正确性 / 可复现 / 合规许可 / SSOT 一致，各报各轴 | 禁跨轴改结论、禁只报「看着没问题」 |
| Adversary | 专门证明「这个门可以被骗过」 | 禁以「没找到反例」代替构造 |
| Arbiter（主会话） | 仲裁矛盾、出最终 verdict、写交接包 | 禁跳过任一轴直接放行 |
| Copywriter（Gemini） | 把事实包写成可发的文案（回帖 / 上架 / README 段落 / 截图说明） | 禁发明数字、禁决定发布、禁改判据 |

**文案所有权（R80 起）**：对外文案由 `copywriter`（Gemini）写，工程 agent 只提供 `docs/copy/facts/` 的**事实包**
（产物 + sha256 + 精确数字 + 边界）。缺事实包不写文案；发布由 HUMAN / arbiter 决定。规则见 `docs/copy/README.md`，
发帖规则见 `docs/distribution/posting-runbook.md`，结构由 `tests/governance/copy-channel.test.ts` 校验。
**模型使用纪律（HUMAN 2026-11-05）**：opencode 内**只用 DeepSeek**；文案一律走外部 `agy`
（`agy --model gemini-3.8-flash-high --print=...`）读事实包生成，**不得**调用 opencode 里的 Gemini / 其他供应商
（2026-11-05 实测 `opencode` 的 Gemini 供应商返回 `Insufficient account funds`，记入 `BS-58`）。

### 并发硬边界

- **同文件 / 同主题禁并行写**；只读审核可按轴并行；
- 有依赖顺序的任务由主会话管依赖图，前序报告齐才起后序；
- 每个 subagent 只给最小任务包（`.agents/prompts/task-packet.md`），返摘要（verdict + ≤10 条证据）；
- 评审员先独立上报，**禁互相参考后再改结论**（防串谋）。

### 每轮固定节律

```
判据轮：选任务(BACKLOG) → 写 spec(判据+负对照) → 实现+自测 → 四轴 review + 对抗性 → 仲裁
        → pnpm verify + gate --mutate → 落 SSOT(+sha256) → 同步文档 → 交接包(HANDOFF) → commit

交付轮：选任务 → 实现 → 真跑一次产物(+sha256) → 1 个 verifier 复算 → 同步文档 → 一条汇总台账 → commit
```

**R47 起的分级理由**：零用户阶段，先让「第一次接触」发生（见 `docs/ROADMAP.md` D5）。判据轮的重流程不变；分发/文案/采证轮按上表降成本，但**证据要求不变**。

### 机器强制的框架完整性

以下缺一即红（`gate_governance` + `tests/governance`）：

1. 每个角色卡含 `## 输入 / ## 输出 / ## 禁区 / ## 验收`；
2. 每个模板含 `## 模板`；
3. `AGENTS.md` 链接 `.agents/README.md`；
4. `docs/HANDOFF.md` 含「当前批次」与「下一位 agent 的第一件事」；
5. `audit/AI_DISCLOSURE_LOG.md` 含 SessionID 字段。
