# ROADMAP · 分诊台（dsh-triage）

> **Stand**: R103 (2026-11-12，**发版轮：把 0.3.9 发出去 —— 桌面误报的修复终于落在 registry 上（判据/阈值一字未动）**：① **为什么要发**：R101（M14）与 R102（M16）的修复都在 0.3.8 发布之后（`publish-2026-11-12T10-54-31.143Z.json` 的 `git_head 20a582a` 是 R101 提交 `72c1cdf` 的祖先），所以 registry 上的 0.3.8 仍把 8 个已装插件报成 blocked、并仍报那条 phantom collision。② **四包同升 `0.3.9`**；CHANGELOG 首句写的是 **Behaviour**（不是「Documentation only」），逐条列出 M14（版本与 manifest 从 `app.asar` 读）、M16（组合层同源）、M15（一屏把「可动手」与「判不了」分开），并明写**这一版不声称**什么（没有归档的机器保持旧行为，`BS-67` / `BS-69` / `BS-70`）。③ **签字先补齐**：`M14` 与 `M16` 两份 spec 从 `proposed` 变 `accepted`，`audit/SIGNOFF.md` 新增三行（R101 M14+M15、R102 M16、R102 模型通道），每行都写清「HUMAN 未逐条复核的部分」。④ **发版前功能自检（真机，M14+M16 之后的代码）**：`why` → `0.2.2-rc.1 (kernel-asar)` / 285 行 / 116 verdicts / **0 blocked**；升级日卡片 `--to next` → 165 单元升 `0.2.2-rc.2`，**134 会被拒 / 110 判不了 / 0 会变好 / 21 像没事**，**14/14**（`card sha256=2b39acbc9caa…` / `artifact sha256=78be4cffd2ea…`）。⑤ **预检四项全绿**（`npm user` · `version 0.3.9` · `workspace 5 dep(s)` · `registry 0.3.9 还没发过`）；`check_listing --tests 971` **17/17**（`version-matches-manifest` 全部 0.3.9）。⑥ **一处顺序错误被门禁抓到并如实记**：先把两份产物塞进同一条台账步 → `step-review` 只允许一步一个 `real_test.artifact`，`no-orphan-results` 连续红两次；拆成 `R103-S2`（why）与 `R103-S3`（card）后 9 门全绿。**没有放宽门禁**。⑦ **发布本身**：`pnpm run release:publish` 由 HUMAN 在终端执行（OTP 不在 agent 手里），`record_publish` 的 18 项取证随后落盘；**在 `publish-*.json` 出现之前，本文不写 `latest=0.3.9`**。**判据/阈值一字未动**；**971 测试 / 9 门 / 9-9**）｜R102 (2026-11-12，**判据轮：组合层同源 —— CLI 与设置页第一次读到同一个组合（判据/阈值一字未动）**：① **真机验证先改主语**：`/compat-triage/summary`（带 `x-dsh-triage-client: settings-tab`）在装机版 0.3.7 上返回 `0.2.2-rc.1 (kernel)` / **0 denied / 0 collisions**；「检测到 9 项兼容异常」是 **CLI** 打的（`0.1.0-rc.6 (inferred)` / 8 blocked / 1 collision / exit 1）。**R101 把主语写错了**：设置页从 0.3.7 起就是 0 可动手项。② **M14 只修了一半，剩下那条是假的**：CLI 仍报 1 条 `llm-deepseek` `conflicting-definitions` —— 缓存 `dsh-base@0.1.0-rc.6` 的 patch 说 `@deepseek-ai/dsh-llm-deepseek`，内核 `0.2.2-rc.1` 的 patch 与 profile patch 都说 `-api-key`；面板看到的是后两份 → 无冲突（**面板对，CLI 错**）。根因：`kernelRoots` 只在 `anchor.source === 'kernel'` 时非空，`kernel-asar` 下为空 → 版本与 manifest 来自归档、**patch 来自缓存**。③ **判据先行**：`docs/specs/M16-composition-source.md`（C1 归档里有这个 bundle 就从归档读 · C2 只做加法、逐 bundle 回退 · C3 manifest 与 patch 同源、缺文件不补位 · C4 profile/home 永不走归档 · C5 provenance 仍三值 · C6 两侧可动手项必须相同）＋ N1–N6。④ **落地**：`packages/plugin/src/load.ts` 的 `loadBundleLayers()` 增加 asar 分支（`readBundleFromArchive` / `kernelArchiveOf` / `archivePatchPath`，只读 `env.kernelProbe.path`，不从 `kernelRoots` 猜）；`core/index.ts` 导出同一个 `asar.ts`；`host.ts` 把 `kernel-asar` 也透传给面板；`record_audit.mjs` 改成读全 `patchFiles`（原来漏掉 `dsh-web-app` 的四条 `presets/*.patch.yml`，96 行）。⑤ **真机读数（修前 → 修后）**：CLI **1 → 0** collision、`judged 55 → 93`、`rows 158 → 242`、**exit 1 → 0**；一屏「检测到 1 项兼容异常」→「**0 项需要处理 · 93 项无法判定**」。⑥ **双侧证据**：新记录器 `scripts/record_desktop_panel.mjs`（一次 GET + 一次同进程扫描，产物含 `host_plugin_version` / `cli_plugin_version`）→ `desktop-panel-2026-11-12T22-20-00.000Z.json`：`panel 289/0/0` 与 `cli 289/0/0`、`agree: version=true actionable=true`；纯函数 `scripts/lib/panel-agreement.mjs#judgePanelAgreement` 只比四个可动手字段（行数差单独记、不算不一致）。⑦ **负对照 21 → 25**（`mutation-controls-2026-11-12T21-40-00.000Z.json` **25/25**），新增 M16 四条；顺带抓到 `M11-N2` 的控制字符串早已陈旧（`SETUP-FAIL` 静默失效），已改。⑧ **三个边界如实记**：`BS-69`（同源只在桌面壳 + 默认 home 成立）· `BS-70`（213 MB 归档一次命令读两次、不做缓存）· `BS-71`（真机两侧 `judged` 差 3，未逐条点名）。**判据/阈值一字未动**；**966 测试 / 9 门 / 9-9**）｜R101 (2026-11-12，**判据轮：桌面设置页把 8 个装好的插件报成「兼容异常」，根因是 CLI 拿陈旧缓存当运行时；改为从 app.asar 读内核，并把一屏改成「零可动手项说零」（判据/阈值一字未动）**：① **真机误报**：`dsh-triage status --profile desktop` 报 **`dsh 0.1.0-rc.6 (inferred)`** —— 那是 `~/.dsh/profiles/node_modules` 的 **pnpm hoisted 共享缓存**，而 Host 实际加载的是 `app.asar` 里的 **`0.2.2-rc.1`**（`~/.dsh/dsh-runtimes/*/runtime.json` 也写 0.2.2-rc.1）。用它判定 → **8 条 blocked**（`dsh-triage`、`dsh-remedy`、`dshmarket`、`dsh-ops`、`dsh-unlag`、`dsh-free-search`、`dsh-context`、`skill-explorer`），把区间原样喂给 `evaluateRange()` 换成 0.2.2-rc.1 → **8/8 全满足**。② **R91 那条结论是错的**：它测的是 asar 的**挂载路径**（Electron-only）。容器本身是普通文件（16 字节头 + JSON 目录 + 4 字节对齐数据区），普通 `node:fs` 读得到：实测 `dsh/node_modules/@deepseek-ai/dsh/package.json` → **0.2.2-rc.1**，并能列出内核 scope **329** 个包。③ **判据先行**：`docs/specs/M14-kernel-asar.md`（C1 来源顺序 asar>kernel>profile>shared · C2 新标签 `kernel-asar` · C3 **同源**：版本与 manifest 必须来自同一处 · C4 读不到就退回、不猜 · C5 `runtime.json` 只记录不取数 · C6 一屏同源 · C7 零依赖）＋ N1–N8。**半修比不修更坏，有数**：只换版本不换 manifest → **125 条**假 blocked；只换 manifest 不换版本 → 8 条假 blocked 原样。④ **落地**：`packages/core/src/asar.ts`（纯解析）+ `kernel-probe.ts`（探针，三态 `read`/`absent`/`unreadable`）+ `env.ts` 接线；`load.ts#resolveRows` **只做加法**（asar 命中的行用它，其余走旧路径）。⑤ **「判不了」与「未安装」拆开**：内核 scope 里 asar 没有的包，磁盘那份属于**另一个运行时**，判它是「未安装」是对用户磁盘说假话、判它 blocked 更坏 → 新 `admission.row-unverifiable` + `row.unverifiable`。⑥ **M15 一屏**：`actionable`（denied+collision+duplicate+error）与 `unjudged`（unknown）分开计；`unknown` 单独存在时 `tone` 仍是 `attention`，文案改成「**0 项需要你处理；另有 N 项没写版本区间，那不代表不兼容**」，`denied=0` 时**不得出现「异常」二字**（单测 + 负对照）。⑦ **真机读数（修前 → 修后）**：`0.1.0-rc.6 (inferred)` → **`0.2.2-rc.1 (kernel-asar)`**；`202 项配置 · 20 已分析 · 8 异常 · 12 未明确 · 1 冲突` → **`202 · 55 已分析 · 0 异常 · 55 未明确 · 1 冲突`**；一屏 **「9 项兼容异常」→「1 项兼容异常」**，剩下那条是 `llm-deepseek` 的 Entry ID 同名（**真事**）。`audit --json` 的 `verdicts` **55 条全 unknown、0 blocked**。⑧ **两个边界如实记**：`BS-67`（只在桌面壳 + 本账户默认 home 上实测；npm 全局 / Linux / CI 都没有）· `BS-68`（「0 项需要处理」不等于「一切正常」，一个恰好没写区间的问题插件与「只是没写」同形）。**判据/阈值一字未动**；**954 测试 / 9 门 / 9-9**）｜R100 (2026-11-12，**采证轮：把 D5 窗口往前推一天，并把「现在为什么不能判」跑成一次可复算的彩排（判据/阈值一字未动）**：① **第七份现场基线**：`market-baseline-2026-11-12T14-30-00.000Z.json`（`inputs.offline: false`、`failures: []`）——窗口 **`11-05..11-11`**、周下载 **675**（`steady`，7/7 天，峰值 `11-11` **319** / 47.26%）。**这一份比上一份多的是哪一天**：上一份覆盖 `11-04..11-10`、**390**；今天 npm 才发布 `11-11` 的桶，所以 +285 全部来自那一天（319 − 掉出窗口的 34）。`categories` / `discussions` 与上一份**逐项相同**（2780 / 441272 / 249438 · 891 / 375 / 254）—— 只有下载是今天新采的。② **D5 读数**：`d5-evidence-2026-11-12T14-40-00-000Z.json` → **`pending`**（reactions **0/10**、外部引用 **0/1**（`references_seen: 3` 全被排除）、下载 **675 `steady`**/20）、`closed: false`、`days_left: 4`；fixtures 两份一起落盘。③ **为什么现在判不了（这次是跑出来的，不是说的）**：用纯函数把四个时刻各判一次 —— 关窗前一秒 `pending`、`2026-11-15T20:24:37Z` 整点 `fail`、关窗后 `fail`；「三数提前达标」那条路径实测 `pass`（不必等），「读不到」实测 `unmeasurable`（不是 `fail`）。**结论**：`fail`/`pass` 只由时间与第三方行为决定，不由我们多做一步决定。④ **覆盖与截止日**：`d5-window-status-2026-11-12T14-35-00.000Z.json` → 覆盖 **11** 天（`11-01..11-11`）、缺 4 天全是 `not published yet`、今天可采 **0** 天、lost 0、**下一份基线最晚 `2026-11-20`**、`urgent: false`。**一个反证也记着**：`--lag-days 1` 会把「可采 0 天」变成 1、截止日推到 `11-18` —— 说明这是**保守假设下的结论**，不是物理事实。⑤ **彩排**：抓取 → 离线复算 **`d5_verdict` / `numbers` / `window` 逐项 SAME**；基线也用 11-11 的 fixtures 离线重建，四块逐项相同。**彩排产物全在 `%TEMP%`**。⑥ **一个被自己抓到的门禁弱点（`BS-66`）**：截止日断言只查「字符串出现过」，而 `INDEX.md` 原先靠一条**历史批次行**恰好满足它 —— 现在补了一行显式标注的活行。⑦ **删掉一份中间件**：基线刷新前跑的那份 `d5-window-status-14-15`（截止 `11-19`）已被 14-35 取代，留着会让「当前截止日」有两个答案。**判据/阈值一字未动**；**933 测试 / 9 门 / 9-9**）｜R99 (2026-11-12，**维护轮：把「上游基线」这句话变成可复算的（判据/阈值一字未动）**：① **四处漂移、两个值**：`next` 在 R97 已到 **`0.2.2-rc.2`**（`next-release-2026-11-12T06-50-44.469Z.json`），而 `AGENTS.md` / 本文件尾部 / `docs/HANDOFF.md` 三处仍写 `0.2.2-rc.1`；`docs/07-environment.md` 更旧（`0.2.1-rc.2` + 「本机落后 8 个 rc」，而 R91 早已用 asar 实测 `0.2.2-rc.1 (kernel)`）。四处一起改对，并把**两个渠道现在不一致**写进正文，不合并成一个数。② **变成断言**：新增纯函数 `readTagClaims` / `judgeTagClaims`（`scripts/lib/upstream-baseline.mjs` + 手写 `.d.mts`）+ `tests/governance/upstream-baseline.test.ts` 五条：期望值只从**已提交**的最新 `next-release-*.json` 取，四份文档必须逐字复述；**负对照真红**。③ **`T-868` 结案**：`record_upgrade_card` 的裸 `sha256=` 拆成 `card sha256=` / `artifact sha256=`，`tests/governance/card-hash-labels.test.ts` 四条，真机 `--to next` **14/14**。④ **徽章与文案跟到 933**，`check_listing --tests 933` **17/17**。⑤ **公开仓切面（已执行）**：切前 `behind 20`（`public-cut-12-50`）→ `git rev-parse HEAD:dsh-triage` + `commit-tree`（parent = `origin/main`）+ push `ea68e6a` → 切后 **`in-sync` / `behind 0`**（`public-cut-13-00`，`git ls-remote` 复读远端就是 `ea68e6a`；那一刻容器 = `dd0fb20`）；**切完之后每一次新提交都会让它变回非零** —— 切面按定义比「装着这份文档的提交」早一步，**不要为了 `behind 0` 再切**；现在的数字由 `node scripts/record_public_cut.mjs` 现算，不写进文档。**判据/阈值一字未动**；**933 测试 / 9 门 / 9-9**）｜R98 (2026-11-12，**发版轮：把 0.3.8 发出去，让 npm 页面不再说假话（判据/阈值一字未动）**：① **为什么要发**：R96 修好的 npm 页面文案与 R97 补齐的参数表都发生在 **0.3.7 发布之后**，`npm view dsh-triage readme` 读到的仍是 0.3.7 那一份（徽章 **905**、许可句还是「引用自 dsh.so」、参数表 8 行）。仓内已经全对、**发出去之前用户看到的都是错的** —— 这就是 `T-869`。② **版本与文案**：四包同升 **`0.3.8`**（`packages/{core,signals,probe,plugin}/package.json`）；CHANGELOG 新增 0.3.8 段，首句明写「Documentation only」，并逐条列出本轮真正改的四件事（npm 页面参数表 **8 → 37**、中文帮助 **18 → 37**、四个记录器的打印路径、英文半边那句已退役的假话）；两份 README 的 `dsh-triage@` 行、两份 listing 的「已发布」行、`submissions/README.md` 的 npm 行一起跟到 0.3.8。**`0.3.5` 一个字都没动** —— 那是 dsh.so 自己的 install line 与历史产物指针，改了就是把别人的读数写成我们的版本。③ **预检**：`release_preflight` 四项全绿（`npm user: jjjjjjjjnnjnn` · `version: 0.3.8` · `workspace: 5 dep(s) 走 pnpm 改写` · `registry: 0.3.8 还没发过`）；发布前同一条命令如实报 `version-already-published` —— 那是 0.3.7 已发的真事实，不是故障。④ **发布一次过**：`pnpm -r publish` 首次报 `ERR_PNPM_GIT_UNCLEAN`（工作树有未提交的版本改动），**先提交再发**是正确顺序，不是绕过 git 检查；`record_publish` 的 18 项与匿名安装随后落盘。**判据/阈值一字未动**；**924 测试 / 9 门 / 9-9**）｜R97 (2026-11-12，**交付轮：把「对外说的话」与「仓库里真有的东西」第三轮对齐 + D5 关窗彩排（判据/阈值一字未动）**：① **四个记录器的打印路径是假的**（`T-835` 的第二形状）：`check_listing` / `record_outcomes` / `record_upgrade_impact` / `scan_upgrade_declarations` 收 `--out` 却把打印路径写死成 `join('data/results', …)`；实测 `check_listing --out %TEMP%` 打印 `data\results\listing-….json` 而文件落在 `%TEMP%` —— 与 R64/R65 同一原型，而 R67 的治理断言只匹配字面量 `ssot data/results/`，`join()` 这个形状从缝里漏了过去。修法：新增纯函数 `displayPath(target, root)`（`scripts/lib/evidence.mjs`），`writeEvidence()` 与八处记录器全部改用它；断言扩到 `join('data/results'` 形状，另加一条「至少一处 `--out` 记录器必须走 helper」的正向断言。顺带修掉 `release_preflight.mjs`：绝对 `--out` 被拼到仓根，写盘直接 `ENOENT`。② **英文半边仍在说「绝不修改 `~/.dsh`」**：两份 README 的 English Overview 与 `CONTRIBUTING.md` 的中英摘要，四处都还写着那句已被 0.3.7 CHANGELOG 判定为假话的话，而 `public-boundary.test.ts` 的禁语清单只有三条中文。修后四处都改成「默认只读 + `--apply` 只碰两处接缝 + 备份/journal/`--undo`」，`CONTRIBUTING.md` 纳入受检集合，禁语清单补三条英文形。③ **`docs/SECURITY.md` 漏写 M10 的调用方自报路径**：原文只写「没有 Origin 时必须带 `sec-fetch-site: same-origin`」，没写 R96 之后被接受的例外（`x-dsh-triage-client: settings-tab`，且**仅在**两条标准信号都缺失时生效），读者会以为旧规则仍然完整。补写时明确「这是调用方自报、不是认证」，并保留「任一标准信号在场即不生效」。④ **三处标签名/命令与代码不符**：`packages/plugin/README.md` / `README.zh-CN.md` / `docs/market/listing_zh.md` 把设置页叫「兼容性分析 / 兼容分诊台」，而 `client.js` 里是 `tab: 分诊台`；`CONTRIBUTING.md` 让人跑 `--tests 542`（照抄必红）。⑤ **D5 关窗彩排**（四条命令全部落 `%TEMP%`，不进 SSOT）：窗口覆盖 `11-01..11-10`、今天可采 **0** 天、lost 0、**下一跑截止 `2026-11-19`**；现场基线 390（`steady`）/20；D5 现场抓取 `pending`（0/10 · 0/1 · 390/20）；离线复算 **逐项 SAME**。三份入口文档里的截止日原来写着 11-17 / 11-13 / 11-11 三个不同的日子，本轮统一成脚本现算的 `2026-11-19`。⑥ **上游 `next` 推进到 `0.2.2-rc.2`**（`latest` 仍 `0.2.2-rc.1`）：`watch_next_release` 给 `changed`（含回滚判定），`--to next` 真机卡片 **14/14**；`record_remedy_probe --target 0.2.2-rc.2` 四行准入：`dsh-mcp-client@0.0.1-rc.1` denied(4) · `@0.2.1-rc.5` denied(8) · `@0.2.2-rc.1` denied(8) · `@0.2.2-rc.2` **admitted(9)** —— 每跳 rc 都要重新 pin，因为 peer 是精确钉定。⑦ **两条来自 GitHub 邮箱的线程各补了一份事实包**（#10849 的 rc.2 状态、#11687 的启动日志读法），**一条都没发**：D5 关窗前不开新动作，发帖由 HUMAN 决定。**判据/阈值一字未动**；**924 测试 / 9 门 / 9-9**）｜**下一件事：D5 关窗（6-11-15T20:24:37Z 之后按 docs/d5-close-runbook.md §0 四条命令）**｜R96 (2026-11-11，**维护轮：渠道状态复读 + 对外文案与代码对齐（判据/阈值一字未动）**：① **渠道复读**（`market-channels-2026-11-11T20-40-00.000Z.json`）：`validated 1 · ready 3 · live 2` + dsh.so `listed 1`；#65 `open` / `MERGEABLE` / `blocked`（认证）vs `clean`（匿名）/ `CHANGES_REQUESTED` / +12-0，#193 `merged 2026-11-04T01:00:47Z` / `APPROVED` / +2-0，#140 `open` / `clean` / 零 review / +1-0；dsh.so 三个 per-plugin 端点全 200，`L5 · Run tested` 的**当前**记录是运行时 `0.2.2-rc.1`（`checkedAt 2026-11-10T17:24:48.837Z`），`security low`（0 Critical / 0 Warning / **2 Info**），而其 `install.command` 仍写 `0.3.5` —— 那是它的排期。② **第一次跑把 PR 仓库名写错**（`deepseek-ai/…`、`walkinglabs/dsh-plugin-market`）→ 三条全 `gh-failed: 404`，**红产物已删**、按真 URL 重跑（`zhu1090093659/…`、`awesome-deepseekharness/…`、`walkinglabs/awesome-deepseek-harness-plugins`）。③ **对外文案与代码对齐**：四份 README/listing 原写「本仓**没有**使用 dsh.so 的数据」，而 `packages/signals/src/dshso.ts` 确实带适配器（CC BY 4.0 + `dshSoEvidence()` 附署名）→ 改写成「适配器在包里、索引源与所有默认路径只读 npm、**当前没有任何界面显示它**」，把许可义务写对而不是删掉。④ **`listing_en.md` 第 93 行在一次 merge 里丢了句首**（`…2026-11-04).so lists the plugin**`）已修。`check_listing` **17/17**（两次中间红都有据：`version-matches-manifest` 抓到我把 dsh.so 的记录 id 写成 `dsh-triage@0.3.5`，那是「我们说自己是 0.3.5」的形状 → 改措辞不改事实）。新盲区 `BS-63`（渠道读数是「谁问」的函数 + dsh.so 排期不由我们定）。**919 测试**)｜R95 (2026-11-11，**判据轮：`BS-61` 结案（面板与 CLI 同源）**：根因是 `resolveRows()` 的扁平查找在 pnpm 默认 `isolated` 布局上只看得见 profile 的直接依赖（沙盒实测 **2/190** 行、188 条假 `row-missing`），修法是按 Node 的 `NODE_MODULES_PATHS` 从**声明该行的 bundle 的 realpath** 重试、且**只在扁平查找失败之后**（`docs/specs/M13-row-resolution.md` C1–C6 / N1–N7）；`admission.ts` / 四桶 / D5 三个数一字未动；真机两条同源断言同时绿（`client-serve-2026-11-11T19-30-00.000Z.json`：`declared 219 / judged 72`、四桶 `119/74/0/2`）；覆盖 `11-01..11-10`、下一跑截止 **`2026-11-19`**；**918 测试**；新盲区 `BS-62`）｜R93 (2026-11-10) | 上游基线 `@deepseek-ai/dsh`：`latest` = **0.2.2-rc.1** · `next` = **0.2.2-rc.2**（R99 复读 `next-release-2026-11-12T06-50-44.469Z.json`：11-05T13:21:52Z rc.1 转正为 `latest`，R97 把 `next` 推进到 rc.2；仓内沙盒仍停在 0.2.1-rc.4）｜品牌：**分诊台 / Triage**｜仓库：`dsh-triage`
> 本文件是**唯一**执行计划（R14 / T-110 起）：判据细节以 `docs/specs/*` 为准；原先并列的 `docs/06-roadmap.md` 已归档到 `_archive/2026-10-28_06-roadmap-merged-into-ROADMAP.md`，其增长阶梯/分发清单/指标并入本文件 §7。
> **R47 重定向**：正门从「通用检查器」改为「**升级日**」。依据是外部取证（`data/results/market-baseline-2026-10-29T12-20-00.000Z.json`）：诊断类目周下载天花板 **1,988**（市场类 380,240 / 装饰类 411,844）；同时上游最近 842 条 Discussions 里故障帖 **49.2%**、其中 **67.2% 零回复**。痛点真、形态错 → 换触发时刻，不换判据。

---

## 0. 一句话与增长前提

**产品**：在「装得上」和「跑得对」之间做判断层；**正门 = 升级日**——每次 rc 发布回答「**你这套已装集合**升上去会坏什么、怎么修」。
**增长的前提（R47 实测，R52 复测）**：这个生态**不为「可靠性」付费**。整个诊断品类周下载 **3,074**（窗口 2026-10-23..10-29：`dsh-doctor` 1,511 / `dsh-verify` 510 / 其余零散），是市场类（**513,534**）的 **0.6%**。所以早期的现实目标不是「类目第一」，而是**先制造一次真实接触**（D5）；天花板判断推迟到 D5 之后。我们自己的 634 次周下载是**单日爆发**（十天里只有一天有数），按 R52 的读数规则**不算需求**。

---

## 1. 阶段表（每阶段都有可证伪出口）

| 周 | 阶段 | 交付物 | 出口门禁（可证伪） | 人力 |
|---|---|---|---|---|
| W0 | **M0 骨架** ✅ | 治理 / 9 门 / 引擎 / CLI / SSOT | `verify` 全绿 + 9 门 mutate 全 CAUGHT | 已完成 |
| W1 | **M1 收口** ✅ | 27 条金标（R14 由 21 扩）+ `why` 归因 + 10 例真实案例 | 真实案例 ≥8/10 命中 —— **R6 达成 9/10**（`data/results/d1-*.json`） | 已完成 |
| W2 | **M2-a 运行时台账** | ✅ **P1+P2 已交付**：`pluginInventory` 相位在仓内沙盒真采样（`data/results/inventory-live-2026-10-27T22-00-00.000Z.json`，194 行）+ `audit --snapshot` + 门 `inventory-contract` + preset 维度（T-112）；tools/commands/settings 快照：T-202b 事实+差分 ✅（R13），**agent 作用域读数**归 T-202a（需真实会话/M3） | `audit` 能显示每行相位；与 patch 静态声明交叉校验（真机 `missing=0`，Host↔CLI 逐行一致） | 1 |
| W3 | **M2-b 归因增强** | 读 stderr / 事故报告，把 import/apply 失败归到行 | 3 类真实故障（import 失败 / apply 抛错 / 服务冲突）都能点名 | 1 |
| W4 | **M3 probe 执行器** | ✅ **R14 交付执行器（T-301）**；✅ **R15 补判据**：白屏可判（T-302，真浏览器 + CDP）+ 就绪来自 Host 自打印 URL（T-306）+ 真实 registry 分母（T-305：install 5.4s / boot 7.7s）；✅ **R22 补「我的组合」**（T-304：`--copy-profile`，复制声明 → 装依赖 → 装候选 → boot，三形状真机）；**R37 有载对照**：`--load 8`（58–62% CPU）把 `boot→sample` 中位数 4.9s → 7.4s，两条件都没越过 20s；`namespace-diff`（T-303）仍未测 | `boot→sample ≤20s`（R14 11.7–19.9s，R15 7.7–8.7s，R22 复制模式 7.4s，**R37 空载 4.9s / 有载 7.4s 中位**）；「装了就白屏」两形状稳定复现（phase=failed / null）+ 白屏检测有红/绿对照；失败必清理（目录 + 全部端口） | 2（并行） |
| W5 | **M4-a 面板** | `settings.plugins.tab` 面板：结论卡 + 证据 + 修复按钮。**R26：只读契约 spike 完成**（`docs/specs/M4-surface.md` §3.1 的 C1–C6：`settings.plugins.tab` 插槽 / `ctx.slots.register` / props 由 `inject` 提供 / `remote.pluginInventory.list()` 形状 / `ctx.effect`+`locale`），**`client.js` 未写** | 面板能看到与 CLI 同源的结论（复用 messageId） | 2 |
| W6 | **M4-b 分发件** | ✅ **三件交付：徽章 SVG（T-402 · R34）+ format-1 索引源（T-403 · R34，用上游校验器验证）+ `compat_verdict` Agent 工具（T-404 · R36，真机三形状 + 八步回归；R40 补 ptc 折叠真机）**。索引源已于 R38 托管到公开 URL（repo raw 为首选、gist 备份，逐字节校验）；**仍剩人工动作**：在 Discover UI 里真的添加一次 | 索引源可在 Discover 添加（**要求一次发布动作**）；徽章可按 插件×dsh×os 渲染 | 2 |
| W7 | **M5-a 回流** | opt-in 匿名 outcome + 本地先验 | 上传可关闭、可删除；0 PII；数据可用率 ≥80% | 1 |
| W8 | **M5-b 升级日** | 升级影响清单生成器（给定目标 dsh 版本）。**R42 交付**四桶分区；**R44 补齐最后两块**：`improved` 有真机见证（策展混合组合，四桶非空）与 registry 成功分支 | 新 rc 发布 24h 内可产出全量已装集合的影响清单 | 1 |
| W9 | **1.0 候选** | 文档 / 上架文案 / 兼容矩阵公开页 | `gate_release --publish` 绿 + 2 渠道收录 | ✅ 交付（`gate_release --publish` 绿）；**收录 0**——三条 PR 全开、dsh.so `submitted` 未 `listed`，卡在外部 |
| W10 | **R47 市场取证 + 重定向** | `data/results/market-baseline-*.json` · 定位重写（`00-vision` / `AGENTS.md` / 本文件）· 流程分级 | 转向**有证据**而非直觉；`PROJECT_RULES` 新增第 4 问落地 | ✅ 本轮完成 |
| W11 | **升级日正门** | `upgrade` 卡片（R47 已交付，真机 14/14）+ **R48 收口「陌生人 60 秒」✅**：`--to next|latest` / 无参数引导 / `--card --out` / README 首屏（真机 26/26 + 离线复算 3/3，`listing` 11/11）+ **R71 定时触发 ✅**（`.github/workflows/watch-upstream.yml`，`unmeasured` 让 job 失败） | **D5**（2 周内 reactions ≥10 / 外部引用 ≥1 / 周下载 ≥20） | ✅ 入口四项 + 发布（**0.3.4 已上线**，`latest=0.3.4`，取证 `data/results/publish-2026-11-03T16-05-17.632Z.json`）+ `T-810` 投放（`#11813` 已发）+ 四个渠道台账（R73）+ 触发（R71）；**三条回帖 HUMAN 决定不发**（R58，理由经 R73 更正）；**渠道 PR 全在等 review**（`docs/distribution/pr-65-status.md`）→ **剩：11-15 关窗读数** |
| W12 | **按 D5 分叉（不硬推）** | 达标 → 进别人安装路径（A：交给 `dshmarket`/`catalog`）或作者侧 CI（C）；不达标 → 承认它不是产品（D：作品集 + 上游 PR） | D5 已判 + HUMAN 选支 | 待定 |

---

## 2. 决策门（不达标就停/改，不硬推）

| 门 | 时间点 | 判据 | 不达标怎么办 |
|---|---|---|---|
| **D1 真实价值** | W1 末 | `why` 在真实案例上一次命中（人工标注 10 例，≥8 命中） | 说明「归因」不成立 → 回到 F2/F3 重新选切入点，**不进入 M2** |

> **D1 现状（R6，2026-10-26）**：**已通过**。真实案例 **10 例 / 9 命中 / 1 有意 miss**（miss = CASE-7590：两个插件都不声明 `@deepseek-ai/dsh*` peer，失败在运行期 API 漂移；它们其实写了 `dsh.compatibility` / `dshReleases`，是我们**尚未读**的通道，见 `BS-13` / T-108，因此这是「我们的信息通道不全」而不是「声明层天花板」）。判定可重算：`node scripts/d1_report.mjs` → `data/results/d1-2026-10-26T12-00-00.000Z.json`（`gate.passed=true`，`totals.hit_rate=0.9`）。**M2 已解锁**：T-201 可开工；T-107（无声明行不得静默）与 T-109（dist-tag 失步信号）是本轮直接产出的需求。
>
> **口径限制（独立复核发现，`BS-14` / T-111）**：这 9 个命中是**机器可复算**的（label 与 verdict 一致、输入可重放），但 label 目前由实现方自写自签，尚未满足本行原话「人工标注」。对外只能说「机器可复算的命中率 9/10」。
| **D2 实测可行性** | W4 末 | **判定看可靠性**（一次跑完 = 有产物 + 清理干净 + boot 在预算内 + 说出结论，`unknown` 也算说出结论）≥90%；单次 ≤20s；失败必清理；真实启动 ≥10 次、失败形状 ≥5 种。**另外单列产品数字** `real_pass_rate = go/(go+blocked)`（`unknown` 既不算成功也不算失败） | 降级为「只做静态 + 人群数据」，probe 变可选实验特性 |
| **D3 分发意愿** | W6 末 | 至少 2 家（catalog / hub / dsh.so / launcher）愿意收录或对接 | 转「纯工具 + 内容营销」，重新评估总榜目标 |
| **D4 数据价值** | W8 末 | **先验与后测的一致率**（`ADR-0011` A 案，2026-10-29 代签）：同一精确键（`包@版本` + dsh 版本 + OS/arch + node major + profile kind）上，此前记录的先验与本次本机测量的一致率；`pairs ≥ 30` 且 Wilson 下界 ≥ 0.80 才算先验有用，不足即 `insufficient-pairs`。**不再用「命中率差 ≥10pp」**——先验不许改结论，那个差值恒为 0 | 砍掉回流的产品化投入，专注本地判断 + 分发（先验只保留 `--explain` 注解） |
| **D5 升级日可证伪**（R47 新增） | W11 末起 2 周 | **一次真实公开样本**（真机卡片 + 对应 rc 的 Discussion）在 2 周内拿到：reactions ≥10 · ≥1 条外部引用我们的输出 · 周下载 ≥20（`scripts/record_market_baseline.mjs` 采集，**且只在 `download_shape = steady` 时判定**，见下） | 不达标 → **走 D**：承认它不是产品，降级为作品集 + 给上游提 issue/PR，把精力移走。**禁止**「再加一个功能试试」 |

> **D2 判定（R18，2026-10-27）：通过（feasibility），产品数字单列。** 证据 `data/results/d2-2026-10-27T21-00-00.000Z.json`（由 `scripts/d2_report.mjs` 从矩阵产物重算，`gate.passed=true`）：
> - **可靠性 17/17 = 100%**（≥90%）：17 次运行全部产出产物、清理 17/17、有样本的 13 次 boot 6.2–19.1s 全在 20s 内、结论齐全（含 1 次诚实的 `unknown`）；
> - **真实启动 10 次**（≥10），**失败形状 5 种**（≥5）：安装失败 / 行 failed / 行无 fiber / 零行 / 树未 settle；
> - **产品数字**：真实候选 **9/10 = 90%** 为 `go`（Wilson 95% **0.596–0.982**），唯一的失败是 `@aiwayds/dsh-cron@0.6.1` **装不上**（产物只有 exit 1，原因归 `T-310`）。
>
> **口径警告**：这 10 个候选是**手挑的便利样本**（npm 搜索 + pin 版本），不是生态随机抽样；90% 只说明「这一批在这台机器/这个沙盒运行时上能装能起」，不等于「插件都能用」。D2 的通过只回答「probe 这件事能不能稳定跑」。
>
> **D2 复算（R19，2026-10-28）：仍通过，分母 10 → 13，且预算口径按 HUMAN 签署收窄。** 证据 `data/results/d2-2026-10-28T12-10-00.000Z.json`（`gate.passed=true`）：
> - **真实 13 个候选**（+`@lolkda/dsh-skills-manager@0.3.1` / `dsh-unlag@1.12.5`（只声明 `engines.dsh`）/ `@tencent-connect/dsh-qqbot@0.5.3`）：**12 `go` / 1 `blocked`**，通过率 **12/13 = 0.923**，Wilson 95% **0.667–0.986**；
> - **可靠性 20/20 = 100%**、清理 20/20、失败形状 **6 种**；
> - **口径修正（`audit/SIGNOFF.md` R19）**：`boot-budget` 只对**真实候选**判定——一棵永不 settle 的树要 `boot(≈5s)+settle 上限 15s≈21s`，结构上不可能进 20s（R18 的 19.1s 是运气）。真实候选仍是 100% 必须达标；夹具的 21.3s 原样单列在 `timing.fixtures_over_budget`。
> - **R26 收窄（`ADR-0008` E）**：`settled:false` 样本不再等替换窗口 → 不可判的 `boot` 步 48.4s → 28.6s（`probe-adr0008e-overrun-*`）；默认 `--unsettled-timeout 20000` 与 `settle 15s` **仍未动**，所以「不可判的一次探针也 ≤20s」仍不成立（`BS-28` / T-311 部分解除，T-312 未开）。`d2_report` 用现有矩阵复算仍 `gate.passed=true`（`data/results/d2-2026-10-28T23-00-00.000Z.json`），产品数字不变：真实 12/13 `go`，Wilson 0.667–0.986。
>
> - **R27 post-E 矩阵重测：D2 `gate.passed=false`（第一次真红）。** 证据 `data/results/d2-2026-10-29T01-30-00.000Z.json`（n=20 / 真实 13 / 清理 20-20 / 失败形状 6 / `expectation_misses=0`）：
>   - **可靠性 19/20 = 95%**（≥90% 仍 PASS）；**失败形状 6**（PASS）；**清理 20/20**（PASS）；
>   - **`boot-budget` FAIL：11/12 真实采样 run 在 20s 内** —— 超时的是 `real-mcp-connector`（`boot→sample` **22.5s**，hook `wait_ms` 16.2s）。
>   - **根因（同一条候选连跑三次的隔离复测）**：`dsh-mcp-connector@0.2.83` 的 `wait_ms` = 10.6 / 16.2 / 18.0s，`boot→sample` = **16.0 / 22.5 / 23.8s** —— 同 pin、同机器、同运行时，两次跨过 20s。**这不是 E 造成的**（`replacement_waited=false`，E 只动样本之后的等待），而是 `boot(≈4–5s) + settle(≤15s)` 的结构与 20s 预算**重叠**（`BS-28` 从「夹具问题」升级为「真实候选问题」，`BS-32` 是它的抖动面）。
>   - **没有做的事**：没有为了让 D2 变绿去放宽 `boot-budget`、也没有删掉那条 run。三条出路（保 15s / 压到 10s / T-312 两阶段）都要 HUMAN 签，见 `docs/adr/0008` §剩余项。
>
> - **R29 按 T-312 新口径重跑：D2 `gate.passed=true`（两批）。** 证据 `data/results/d2-2026-10-28T09-20-00.000Z.json`（批次 A）与 `data/results/d2-2026-10-28T10-20-00.000Z.json`（批次 B，`--strict` exit 0），源矩阵 `probe-matrix-2026-10-28T08-40-00.000Z.json` / `probe-matrix-2026-10-28T09-40-00.000Z.json`：
>   - 两批都是 n=20 / 真实 13 / 清理 20-20 / 失败形状 6 / `expectation_misses=0`；`boot-budget` **12/12**（`boot→sample` 4.6–9.8s 与 4.0–5.5s）；可靠性 20/20；产品数字仍是真实 **12/13 `go`**（Wilson **0.667–0.986**）。
>   - **R27 的红不撤销**：那是旧口径（预算判最终样本）下的真实历史，产物原样保留。**`BS-32` 仍 open**：同一 `dsh-mcp-connector@0.2.83` 在 R27 是 22.5s、R28 两次 `unknown`、R29 两批 8.0s / 5.5s（`go`）——本轮只是「这两批没踩线」，不是「稳定了」。
>   - **D2 的自动化接口**：`scripts/d2_report.mjs --strict`（T-317，R29）在判定失败时 exit 1，且产物与 `.sha256` 先落盘；默认模式仍 exit 0（R18 决定）。
>
> **Kill criteria**：D1 与 D2 同时不达标 → 停止投入，把已有引擎作为 `dsh-doctor` 式小工具维护，不追总榜。
>
> **D4 口径变更（2026-10-29，`ADR-0011` A 案代签）**：原判据「有先验 vs 无先验的命中率差 ≥10pp」与
> 「次要证据永不改结论」结构冲突（先验不改结论 ⇒ 差值恒为 0），已改成**可计算的一致率**（见上表）。
> 记账：`audit/SIGNOFF.md`（HUMAN 原话「你自己分析研究进行，我全部同意」，未逐条复核，**可撤销**）；
> 这个改动只动判据口径，不动任何阈值、不新增证据 tier，也不允许先验进入 `conclusion`。

> **D5 立项（R47，2026-10-29）**：这条门回答的不是「产品质量」，而是「**这个东西有没有存在的理由**」。
> 依据（`data/results/market-baseline-2026-10-31T06-40-00.000Z.json` 与它的 R47 前身）：诊断类目周下载天花板 **3,074**（市场类 513,534、装饰类 552,956）；我们自己的 634 是**单日爆发**（`single-day-burst`，不算需求）；上游最近 854 条 Discussions 里 405 条故障（47.4%）、其中 256 条零回复——**需求真、交付形态错**。
> 所以实验设计成最小可证伪：**一张真机升级卡片 + 一次公开样本**，看它能不能换来一次真实接触。
> 判定窗口：发布后 **2 周**（不是 2 天，也不是 2 个月）；采集只认三个机器可读的数（reactions / 外部引用 / npm 周下载）。
> **失败即执行 D**：把仓库降级为作品集 + 向上游提 issue/PR（把 admission 归因做进官方 `dsh-doctor`），不做第 N 个功能。

> **D5 的下载读数规则（R52，2026-10-31，HUMAN 批准；`audit/SIGNOFF.md` R52 行）**
> 「周下载 ≥20」**只在 `download_shape = steady` 时判定**。形状由日序列判定（`scripts/lib/download-shape.mjs`）：
> `steady` = ≥2 天有下载且无单日占比 >80%；`single-day-burst` = ≤1 天有下载或单日 >80%；
> `no-record` / `no-downloads` = 窗口内没有下载；`unreadable` = 没读出序列，记 `unmeasurable`——**不是**「没有需求」。
> 依据（`data/results/market-baseline-2026-10-31T06-40-00.000Z.json`）：`dsh-triage` 窗口 2026-10-22..10-30 的日序列是
> `0 0 0 0 0 0 0 / 634 / 0`——**634 全部落在 2026-10-29 一天**，前后都是 0。那是镜像/扫描器抓新包，不是人；
> 直接读周合计会让 D5 得到一个**假通过**。同一次采集里 30 个生态包里 29 个是 `steady`、1 个 `no-record`，
> 只有我们自己是 `single-day-burst`（`d5.verdict = burst-not-demand`，`counts_as_demand = false`）。
> 残留盲区见 `BS-48`：形状能排除单日爬虫，但排除不了「稳态的 20 次也是机器」。

> **D3 现状（R53，2026-11-01）**：**1/2 家**。dsh.so **已收录**（三个 per-plugin JSON 端点 200，`indexedAt = 2026-10-29T09:49Z`，`L5 · Run tested`（`0.2.1-rc.5` passed）、security `audited` / `riskLevel: low`；`data/results/market-channels-2026-11-01T09-40-00.000Z.json`）——但**收录不等于有人用**，它不产生下载，D5 的判据里没有这一项。另外三家仍是 PR：**#65 现在 `DIRTY`**（与上游 `main` 冲突，`T-821` 要先 rebase，否则永远合不了）、#193 `APPROVED` + `CLEAN` 等维护者、#140 `CLEAN` 无 review。**读法边界**：L5 是 dsh.so 在它自己的干净沙盒里的一次实测，不能读成「在你的机器上能用」（`BS-06`）。

> **D5 现状（R56，2026-11-01）**：**样本已投放，正在计时** —— 帖子 `https://github.com/deepseek-ai/deepseek-harness/discussions/11813`（Show Your Plugins!，`createdAt 2026-11-01T20:24:37Z`），窗口到 **`2026-11-15T20:24:37Z`**。首跑（`data/results/d5-evidence-2026-11-01T22-00-00-000Z.json`）**`pending`**：reactions **0/10** · 外部引用 **0/1** · 周下载 **634** 但 `download_shape = single-day-burst` → **不算需求**（`counts_as_demand = false`）。**读数口径已由 HUMAN 签字**（`audit/SIGNOFF.md` R54 行），窗口内任何一次重跑都用同一条命令、同一个口径。
>
> **D5 下载项第一次读到 `steady`（R75-P1，2026-11-03）**：`data/results/market-baseline-2026-11-03T06-22-20.130Z.json` 里 `dsh-triage` **周下载 1035 · `download_shape = steady` · 4/7 天有下载 · 峰值 61.3%** → 按冻结口径 `threshold-met`。**这不是 D5 达标**，两条边界必须一起读：① 日序列 `0 0 0 / 634 / 192 / 17 / 192` 是 **10-29 爆发的回声**（两个 192 同值），`BS-48` 写明 `steady` 不等于人；② 这份基线的窗口是 **`10-26..11-01`**，只有 `11-01` 落在 D5 窗口内，reactions **0/10** 与外部引用 **0/1** 仍是 0，`verdict` 仍是 **`pending`**。**为什么必须在 11-08 之前再跑一次**：npm `last-week` 是滚动 7 天，关窗那天只能看见 `11-08..11-14`，窗口前 7 天会永久缺失。

---

## 3. 分发时间线（与产品并行，不等做完）
|---|---|---|
| W1 | 注册 npm 名 `dsh-triage`；建立 GitHub private → **2026-10-29 已转 public（HUMAN 决定，见 `audit/AI_DISCLOSURE_LOG.md` R38 追加）** | 仓库公开可读；npm 发布仍未做（registry 404） |
| W2 | 写 3 篇中文案例帖（消失的工具 / 白屏 / 升级后起不来） | 社区曝光第一批 |
| W4 | 提交 dsh 社区插件索引：**`zhu1090093659/dsh-community-plugins` PR #65**（`community.json` +12/-0，用其自带校验器验证） | 已提交待审；合并后 dsh-market 商店自动收录 |
| W5 | **`awesome-deepseekharness/awesome-deepseek-harness` PR #193**（README +1/-0）已提交待审；**R40：npm 已发布** `dsh-triage@0.1.0`（+3 个 `@dsh-triage/*` 内部包），匿名安装验证通过，dsh.so 转 `ready` | 一条待审（#193 `APPROVED`，等维护者合并）、一条待填表 |
| W6 | **format-1 索引源已发布**：仓库 raw URL（首选，跟着分支走）与 public gist（备份），两条都逐字节校验过 | 无需安装即可被使用（Discover 里添加仍是一次人工动作） |
| W7 | 作者徽章上线，主动联系 10 个头部插件作者 | 徽章进入 README |
| W8 | 升级日预案：每次 rc 发布 24h 出清单 | 周期性流量峰 |
| W9–W12 | 拉 2 家关键路径集成（dshmarket / launcher / Desktop） | 冲总榜的必要条件；**R47 起改判为 D5 达标后再谈**（先有需求再谈分发） |
| W10–W11 | **升级日样本投放**：每个 rc 的 Discussion 下放真机卡片 + 三篇草稿发布 | 一次真实接触（D5 唯一领先指标） |

---

## 4. 指标看板（每周五更新）

| 指标 | 旧目标（W12，已作废） | **R47 口径** | 采集方式 |
|---|---|---|---|
| **首次接触**（新增，D5 唯一领先指标） | — | 2 周内 reactions ≥10 · 外部引用 ≥1 | GitHub API（Discussion 反应 / 引用） |
| npm 周下载 | ≥3,000 | **≥20**（从 0 起步；旧目标基于「类目第一 3.8k」，实测该类目天花板 1,175）。**R52 起只在 `download_shape=steady` 时判定**——2026-10-31 的 634 是单日爆发，不算需求 | `scripts/record_market_baseline.mjs`（npm downloads API + 按天序列） |
| 类目天花板 | 「安全/兼容类第一」 | 事实值：诊断品类合计 **3,074**（窗口 2026-10-23..10-29；R47 的 1,988 是旧窗口，不设「第一」目标） | 同上（内置品类清单 + 形状） |
| `why` 命中率（人工标注 30 例） | ≥80% | 保持（当前 9/10 机器可复算，label 自签 `BS-14`） | `data/results/d1-*.json` |
| 徽章曝光 | ≥5,000/月 | 冻结（没有徽章服务，无采集） | — |
| 索引源添加 | ≥300 | 冻结（Discover 里添加仍是人工动作） | — |
| `compat_verdict` 调用 | ≥2,000/周 | 冻结（opt-in 遥测未开工，`ADR-0012` 未签） | — |
| 误判投诉 | 0 起未修复 | 保持 | issue 标签 `false-positive` |

---

## 5. 每周固定节律

| 时点 | 动作 | 产出 |
|---|---|---|
| 周一 | 选任务（`docs/BACKLOG.md`）+ 写 spec | spec 草案 |
| 周二–周四 | 实现 + 自测 + 负对照 | 提交 |
| 周四晚 | 四轴 review + 对抗性审核 | findings |
| 周五 | 仲裁 + 门禁全绿 + 交接包 + 周报（指标看板） | `docs/HANDOFF.md` 更新 |

---

## 6. 风险与对策（触发器口径与 §7.4 一致，此处只列产品侧）

| 触发器 | 应对 |
|---|---|
| 上游发布「诊断/失败史」 | 立即把我们的 verdict 契约公开，转为**数据与归因提供方**；接入其 UI |
| dsh.so 扩到本机组合 | 主动对接，做它的「本机执行端」；我们保留离线/企业场景 |
| probe 被质疑执行不可信代码 | 默认 dry-run；显式 `--execute` + 沙盒路径证明 + 不提供安全背书 |
| 早期误判导致口碑崩塌 | 四态 + `unknown` + 证据 tier；48h 内修 + 公开复盘（ADR） |
| **实测：诊断类目没有需求形态**（R47） | 不加功能；按 D5 分叉——换触发时刻（升级日）/ 进别人路径（市场）/ 走 D（承认不是产品） |
| **痛点选错**（我们覆盖的子集只占故障帖的一部分） | 只做能复算的那部分（admission / 组合 / 升级影响）；其余在文案里明说不覆盖 |

---

## 7. 增长与分发（R14 合并自 `06-roadmap.md`，T-110）

### 7.1 下载量阶梯（R47 按实测重写）

旧版阶梯（0→500→3,000→20,000→175,000）建立在「类目第一 3.8k」这个**估算**上。R47 实测后作废，改用下表——每一格都写清「必须为真的那一件事」，且第一格不再要求用户量，只要求**一次真实接触**：

| 阶段 | 现实区间（周下载） | 必须为真 | 主要动作 |
|---|---|---|---|
| **A** | **0 → 20** | **一张升级卡片换到一次真实反应**（D5） | 在每个 rc 的 Discussion 下放真机样本表；不讲架构，讲「升级前先看这张表」 |
| **B** | 20 → 200 | 升级日变成**周期性事件**（每次 rc 都有人等） | 把 `upgrade` 卡片做成默认输出，附复算命令；→ 也顺手把 `dsh.so` 数据对齐 |
| **C** | 200 → 2,000 | 被 **≥1 个 ≥10k 下载的路径**消费（`dshmarket` 292k / `catalog` 74k） | A 支线：把判定做成数据包交给它们，用户不下载我们 |
| **D** | 2,000 → 20,000 | 成为默认安装前的**一次自动检查**（boot 守卫 / 市场安装前钩子） | 需要 `M6` 之后的 boot 守卫（上一轮被推迟的那个） |
| E | 20,000+ | 生态整体继续增长 + 上游不吸收 | 不可控，不设为目标 |

> **诚实结论（R47）**：诊断品类合计 **1,988** 周下载已经是这个类的**全部**；我们不打算用「再加功能」去突破它。突破只有两种：**换触发时刻**（升级日，A→B）或**进别人路径**（C）。两种都不成立就走 D（承认它不是产品）。

### 7.2 分发清单（按执行顺序）

| # | 渠道 | 动作 | 负责人 |
|---|---|---|---|
| 1 | npm | 包名 `dsh-triage`（已确认未被占用）；keywords 含 `dsh-plugin` / `compat` / `diagnostics` | HUMAN（发布） |
| 2 | `dsh-plugin-catalog`（dshmarket 目录，format-1） | 提 PR 收录 | Agent 起草 |
| 3 | `omdsh-dev/dsh-hub-workshop` catalog | 提 PR 收录 | Agent 起草 |
| 4 | dsh.so 提交 | 走其提交入口，拿 L4/L5 与安全档 | Agent 起草 |
| 5 | awesome 列表（`0xsline`、`imsai-sh`） | 各提 1 条 | Agent 起草 |
| 6 | 自建 format-1 索引源 | 个性化推荐（按 dsh 版本 + OS + 已装集合过滤） | M4 |
| 7 | 作者徽章 | `![triage](https://…/badge/<pkg>.svg)` 可嵌入 README | M4 |
| 8 | Agent 工具 | `compat_verdict` 让 Agent 在装前自查 | M4 |

### 7.3 指标（领先 + 滞后）

| 指标 | 类型 | 目标（M4 后 30 天） |
|---|---|---|
| `why` 根因命中率（人工标注 30 案例） | 质量 | ≥80% |
| 徽章曝光（shields 风格请求数） | 领先 | ≥5,000 |
| 索引源添加数 | 领先 | ≥300 |
| `compat_verdict` 调用次数 | 领先 | ≥2,000/周 |
| npm 周下载 | 滞后 | ≥3,000（类目第一） |

### 7.4 关键风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 上游补上诊断/失败史（已列 deferred） | 高 | 只赚数据与归因；先公开契约；把产品做成别人的信号源 |
| dsh.so 扩到「本机组合」 | 中 | 主动把其 API 当 S4 并署名；我们做它进不去的半边（本机/企业/离线） |
| probe 成本与安全争议 | 中 | 默认 dry-run、显式 `--execute`、明确不提供安全背书 |
| 误判一次口碑崩塌 | 中 | 四态 + `unknown` + 证据 tier；金标锁死语义 |
| 与上游行 id / 服务名撞车 | 中 | `compat-` 前缀 + `gate_namespace`（R14 起含 `rows-are-inserted`） |
