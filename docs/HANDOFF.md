# HANDOFF · 交接入口

> **Stand**: R10 (2026-10-27)｜当前批次：**R10 · 让版本信号说真话（T-109 dist-tag 失步 + T-115 区间形状）**（124 测试；9 门 9-9）
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
| 产品名 | **dsh-triage**（品牌：分诊台 / Triage） |
| 里程碑 | **M0 ✅** · **M1 金标对等 ✅** · **M1 真实案例验收 ✅（D1 通过：9/10 命中，1 例为显式 unknown）** · **M2-a P2 ✅ / P1 待 Remote 客户端**（T-201；**环境已就绪**，见下） |
| 仓库 | `https://github.com/jjjjjjjjnnjnn/dsh-triage`（**private**，`main`） |
| CI | **5 job**：`verify (node 22)` · `verify (node 24)` · `verify (windows, node 24)` · `gates can fail`（负对照 9/9）· `release readiness`（tag 触发） |
| 规模 | **124 测试** · **9 门禁** · 6 角色卡 · 3+1 模板 · **10 个真实案例（9 命中 / 1 显式 unknown）** |
| 硬规则 | **每一步做完必须四轴审核 + 真跑落产物**，写入 `audit/step_reviews.json`，由门 `step-review` 重算 sha256（`PROJECT_RULES.md` 铁律 11） |
| 本轮交付 | **版本信号说真话**：① T-109 新模块 `packages/core/src/version-drift.ts`——同通道比较 dist-tag（`latest` 是预发布就比最新已发布；是稳定版就只比最新稳定版，更新的预发布另报 `prerelease-ahead` 不算失步）；`check --explain` 打印 `latest` / `next` / 已发布最新，`--json` 另有 `registry.drift`；② T-115 `judgeRangeShape`（exact / unbounded / bounded / unusable / absent）→ `check` 时出 `admission.range-exact-pin`（info）与 `admission.range-unbounded`（warn），结论不变；③ 新命名空间 `registry.*`（三处同改：messages / 门白名单 / `docs/05` §3）；④ `scripts/record_registry.mjs` 把真机 registry 事实落成 SSOT |
| 证据 | `data/results/registry-2026-10-27T19-00-00.000Z.json`（3 个上游包 `latest` 全落后：`dsh-tools`/`dsh-base`=0.0.1-rc.1、`dsh`=0.2.1-rc.2，`next` 均 0.2.1-rc.4）· `why-case-CASE-7590-2026-10-27T15-00-00.000Z.json`（R9：2 unknown）· `d1-2026-10-27T15-00-00.000Z.json`（9/10）· `why-2026-10-27T18-20-00.000Z.json`（真机 156 行 → 2 条行级 unknown）· `ns-live-attempt-2026-10-27T16-00-00.000Z.json`（相位采样 blocked）· `gates-*` / `gates-mutate-*`（9 门全绿 + 9/9） |
| 审核报告 | `audit/AUDIT_2026-10-27_R10.md`（本轮）· `R9` · `R8` · `R7` · `R6` · `R5` · `R4` · `R3` |
| 未通过的门槛 | D2–D4 尚未到点；**真机相位样本仍未拿到**——但 blocker 已从「环境不可挂载」变成「缺 Remote 客户端」（见 §8） |
| **环境（本轮新解锁）** | 仓内沙盒 `sandbox/upstream/0.2.1-rc.4`（git 忽略）：runtime + profile 依赖已装（compose **191** 条）· `dsh web` **11.8s** 起服务 · 带 token **303**（token→cookie）、无 token **401** · `taskkill /T` 后端口关闭 · 证据 `data/results/upstream-0.2.1-rc.4-2026-10-27T21-00-00.000Z.json` + `data/results/ns-live-attempt-2026-10-27T21-10-00.000Z.json`（`outcome=mounted-host`） |
| 交接快照（R11 收尾） | R11 = `b92190e`（随后只有本文件的交接提交）；`git status` 干净；`pnpm run verify` = **124 测试 / 9 门全绿**；`--mutate` = **9/9**；`data/results` **35 产物 / 43 步**全被引用；沙盒 `sandbox/` 已被 `.gitignore` 忽略 |
| 交接快照（R10 收尾） | R10 = `cc76ea0`（随后只有本文件的交接提交）；`git status` 干净；`pnpm run verify` = **124 测试 / 9 门全绿**；`--mutate` = **9/9**；`data/results` **32 产物 / 39 步**全被引用 |
| 交接快照（R9 收尾） | R9 = `9259515`（随后只有本文件的交接提交）；`git status` 干净；`pnpm run verify` = **110 测试 / 9 门全绿**；`--mutate` = **9/9**；`data/results` **29 产物 / 36 步**全被引用 |

---

## 3. 下一位 agent 的第一件事

```powershell
pnpm install --frozen-lockfile; pnpm run verify; node scripts/gate.mjs --mutate
```

**验收标准**：第二条输出 `ALL GREEN · 9 gates`；第三条最后一行 `NEGATIVE CONTROL PASSED · 9/9`。
满足即环境可信，接着**三选一**（都不需要新许可）：

1. **T-201 P1**（相位真机来源，**环境已解锁**）：仓内 `sandbox/upstream/0.2.1-rc.4` 已能挂载 Host（11.8s 起服务、HTTP 303/401 可复现，见 `data/results/ns-live-attempt-2026-10-27T21-10-00.000Z.json`）。缺的只是 `pluginInventory/list` 的 Remote 客户端：读 `docs/specs/M2-inventory.md` §4，先跑通一次真实相位快照，再谈 T-202/T-112。
2. **T-112**（`agentPresets` 维度）：同一 entry 在不同 preset 下相位不同，当前先出 `unknown`/`runtime.preset-unjudged`。按 `docs/specs/M2-inventory.md` §3 硬约束 3 实现，先写负对照。**前置已经满足**（沙盒里有 `dsh-agent-preset-registry`，可产出带 preset 的真实快照）。
3. **T-117**（行级兼容通道相左，`BS-17`）：先定「相左」在行级要不要提示、以什么粒度出现，再实现。

**想继续从开源里借**：`docs/09-open-source-borrowing.md` 先看，再动 T-113（attw 矩阵，前置是沙箱实测 loader 解析模式）/ T-114（bisect，前置是 M3 probe）。T-115 已于 R10 与 T-109 一起落地。**借机制不抄代码**，真抄要先进 `quarantine/` + `vendor-manifest`。

先按 `.agents/prompts/task-packet.md` 列允许改动的文件，再动手。

> D1 已于 R6 通过（9/10）；M2-a P2 于 R7 交付（`data/results/inventory-2026-10-27T00-00-00.000Z.json`）；R8 补了副本来源与重复副本（`data/results/audit-2026-10-27T12-00-00.000Z.json`）；R9 让「没声明」不再静默（`data/results/why-case-CASE-7590-2026-10-27T15-00-00.000Z.json`）；R10 让 dist-tag 失步可见（`data/results/registry-2026-10-27T19-00-00.000Z.json`）。
> 复核口径五条命令：`node scripts/d1_report.mjs --stamp <iso>`、`node scripts/render_inventory.mjs --snapshot data/fixtures/inventory/desktop-web-2026-10-26.json --dsh-home <sandbox> --profile desktop --stamp <iso>`、`node scripts/record_audit.mjs --dsh-home <sandbox> --profile desktop --stamp <iso>`、`node scripts/probe_live_sample.mjs --dsh-home <sandbox>/home --profile upstream --install <sandbox>/install --stamp <iso>`、`node scripts/record_registry.mjs --stamp <iso>`。
> **P1 与真机相位采样仍阻塞**：本机没有可启动的 0.2.x profile；R9 的沙盒尝试停在「profile 未装 `node_modules`」（见 §8）。没有真机样本前，对外只能说「相位表已实现」，不能说「实测过这台机器」。

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
| 本轮审核结论 | `audit/AUDIT_2026-10-27_R8.md`（R8，含 §7 独立复核与修正）· `AUDIT_2026-10-27_R7.md`（§8 独立复核）· `AUDIT_2026-10-26_R6.md`（§10 独立复核）· `R5` · `R4` · `R3` |
| 每步审核台账 | `audit/step_reviews.json`（门 `step-review` 校验；四轴 + 对抗性 + 产物 sha256） |

---

## 8. 仍未解除的项（带 owner + 退出条件）

> **D1 已于 R6 通过**（9/10，`data/results/d1-2026-10-26T12-00-00.000Z.json`），因此下表不含 D1；但 D1 的标签目前是**实现方自证**（`BS-14` / T-111），对外口径只能是「机器可复算的命中率」。

| 项 | owner | 退出条件 |
|---|---|---|
| `T-111` label 自证（`BS-14`）：9 个命中无独立签署 | verifier + implementer | R7 起新案例由独立上下文签署 `label_verified_by` |
| `T-201 P1`：Host 内相位来源（Remote 客户端或进程内 loader 投影） | implementer | **环境已就绪**（沙盒 Host 能挂载并应答 HTTP）→ 产出一次真实 `pluginInventory/list` 快照，喂给 `audit --snapshot` 后与 Host 内结论一致 |
| `B1/B2` 真机采样（`BS-15`）：相位层目前只有合成样本 | verifier | 产出一份 `sample.kind=live` 的 `data/results/inventory-*.json`，与合成样本并列。**R11 把 blocker 从「环境不可挂载」推进到「缺 Remote 客户端」**（`ns-live-attempt-2026-10-27T21-10-00.000Z.json`，`outcome=mounted-host`），仍未解除 |
| `T-112` preset 维度：同一 entry 在不同 preset 下相位不同 | implementer | 分开出结论，禁取「最乐观值」；`conditional` 行标 `unknown`（当前先出 `unknown`/`runtime.preset-unjudged`，不静默） |
| `T-113` attw 式入口可加载性矩阵 | implementer | 先在沙箱实测 loader 解析模式（两种），再实现；否则会造假警告 |
| `T-114` `triage bisect`（VS Code 二分思路） | implementer | 依赖 M3 probe 能稳定启停一次 boot |
| `BS-16` 来源/副本扫描的边界：`overrides`/lockfile 手钉 / 两层以上嵌套不可见；未知版本不参与比较 | implementer | 出现误判先补样本再改扫描器；T-113 与 probe 是补全路径 |
| 0.2.x 真机 profile 未装（**仓内沙盒已可挂载**：`sandbox/upstream/0.2.1-rc.4`，依赖就位） | Implementer（M3） | 还差两步：① 写 Remote 客户端取一次 `pluginInventory/list`（T-201 P1）；② 用沙盒跑通一次 `probe`（M3 执行器），两者都完成后 B1/B2 才能关闭 |
| npm 未登录，尚未占位发布 | HUMAN | `npm login` 后发布 `dsh-triage@0.0.1`（先 `pnpm run release:check`） |
| 仓库仍 private | HUMAN | 决定转 public 时执行 `gh repo edit … --visibility public`（建议等 D2 后再定） |
| `audit` 与 `why` 行级结论不一致（T-105） | implementer | 两命令对同一 profile 交叉一致（e2e 断言） |
| T-103 金标扩容（冻结区） | HUMAN 签字后 implementer | 6 条新金标进 `data/gold/`，parity 门绿 |
| 双 roadmap 重叠（`docs/06-roadmap.md` vs `docs/ROADMAP.md`） | HUMAN 决定 | 合并或明确分工后归档其一（T-110，需签字，因为要删文档） |
