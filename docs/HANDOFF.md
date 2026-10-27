# HANDOFF · 交接入口

> **Stand**: R14 (2026-10-28)｜当前批次：**R14 · M3 probe 执行器（T-301）+ 金标扩容（T-103）+ roadmap 合并（T-110）**（163 测试；9 门 9-9）
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
| 里程碑 | **M0 ✅** · **M1 金标对等 ✅（27 条，R14 扩容）** · **M1 真实案例验收 ✅（D1：9/10）** · **M2-a P1+P2 ✅** · **M2-b 事实+差分 ✅（工具级结论不可判，`BS-21`/`BS-22`）** · **M3-a probe 执行器 ✅（R14）** |
| 仓库 | `https://github.com/jjjjjjjjnnjnn/dsh-triage`（**private**，`main`） |
| CI | **5 job**：`verify (node 22)` · `verify (node 24)` · `verify (windows, node 24)` · `gates can fail`（负对照 9/9）· `release readiness`（tag 触发） |
| 规模 | **166 测试** · **9 门禁** · 6 角色卡 · 3+1 模板 · **10 个真实案例（9 命中 / 1 显式 unknown）** · **27 条金标** · **3 份 probe 真机样本**（一绿两红，隐私修复后重采） |
| 硬规则 | **每一步做完必须四轴审核 + 真跑落产物**，写入 `audit/step_reviews.json`（R14 起 **66 步**），由门 `step-review` 重算 sha256（`PROJECT_RULES.md` 铁律 11）；授权/签署单独记在 `audit/SIGNOFF.md`（谁授权 / 谁执行 / HUMAN 未逐条看的部分，三者分列） |
| 本轮交付 | **M3 probe 执行器**：① `packages/probe/src/exec.ts`（步骤机 `runtime→install→boot→http→inventory→cleanup` + `judgeProbe` 纯函数 + 六断言表，`client-rendered`/`namespace-diff` 恒为 `unmeasured`）；② `packages/probe/src/host.ts`（安装/起 Host/杀树/就绪探测的唯一实现，`scripts/lib/live.mjs` 改为再导出）；③ CLI `probe --execute --dsh-main`（默认仍 dry-run，e2e 断言不 spawn）；④ `scripts/record_probe.mjs` + 三份 SSOT；⑤ **修掉我们自己 bundle patch 的 `insert:` 缺陷**（装了不挂载）；⑥ **T-103 金标 21→27**；⑦ **T-110 双 roadmap 合并**；⑧ **交付后独立复核抓到两个真缺陷并修**：`--profile` 路径逃逸（F-1）、沙盒目录名把用户名带进 SSOT（F-2） |
| 证据 | `data/results/probe-ok-2026-10-28T06-00-00.000Z.json`（go：boot→sample **19.9s**，本轮最慢；同 fixture 另有 11.7–14.8s）· `probe-red-apply-fail-…T06-10-00.000Z.json`（phase=`failed`）· `probe-red-import-fail-…T06-20-00.000Z.json`（phase=`null`）· `inventory-live-2026-10-28T02-30-00.000Z.json`（同一真机样本里 active/null/failed 三形状 + `cross_check.agree=true`）· `gates-2026-10-28T04-30-00.000Z.json`（金标后）/ `gates-2026-10-28T07-20-00.000Z.json`（复核修复后）/ `gates-mutate-2026-10-28T03-40-00.000Z.json` · 授权台账 `audit/SIGNOFF.md` |
| 审核报告 | `audit/AUDIT_2026-10-28_R14.md`（本轮）· `R13` · `R12` · `R10` · `R9` · `R8` · `R7` · `R6` · `R5` · `R4` · `R3` |
| 未通过的门槛 | **D2（probe 可行性）现在有了分布数据**：`boot→sample` 六次 **11.7 / 12.3 / 13.3 / 13.8 / 14.8 / 19.9s**——绿跑 3/3 都在 ≤20s 内，但最慢一次只剩 0.1s 余量，**D2 必须按分布判定**；清理 6/6；失败路径 2/2。仍缺「真实 registry 候选」（T-305）；T-302/T-303 未做；preset 的 broken/conditional 仍未真机化（`BS-20`） |
| **环境（本轮沿用）** | 仓内沙盒 `sandbox/upstream/0.2.1-rc.4`（git 忽略）：`install/` + `home/profiles/*`；probe 使用 `%TEMP%/dsh-triage-probe/<slug>` 作为隔离 `DSH_HOME`，跑完必删 |
| 交接快照（R14 收尾） | R14 = `806f770` + 本轮修复提交（见 `git log -3`）；`git status` 干净；`pnpm run verify` = **166 测试 / 9 门全绿**；`--mutate` = **9/9**；`data/results` 产物全部被 `audit/step_reviews.json` 引用（66 步）；旧的三份 probe 产物因隐私修复（F-2）已删除并重采 |
| 交接快照（R13 收尾） | R13 = `2a9e4c5`；142 测试 / 9 门全绿 / 9-9；`data/results` 46 产物 / 57 步 |

---

## 3. 下一位 agent 的第一件事

```powershell
pnpm install --frozen-lockfile; pnpm run verify; node scripts/gate.mjs --mutate
```

**验收标准**：第二条输出 `ALL GREEN · 9 gates`；第三条最后一行 `NEGATIVE CONTROL PASSED · 9/9`。
满足即环境可信，接着**四选一**（都不需要新许可）：

1. **T-302 probe 的客户端渲染断言**：执行器已能稳定起 Host 并探到端口，缺的只是「HTTP 有应答 ≠ 画面出来了」。做完这一条，M3 的出口门禁才完整（`client-rendered` 目前恒为 `unmeasured`）。
2. **T-305 registry 候选的真实安装形状**：本轮只测了本地 fixture（0.58–0.64s）。真实 npm 来源的安装耗时、lockfile 行为、私有源失败形状都还没数；D2 的「≥90% 成功率」必须在这个基础上算。
3. **T-202a 能力层的会话作用域**：probe 只到进程级（`BS-21`）。要做成，必须有一次真实会话或 probe 内的会话组合——**先读 `PROJECT_RULES.md` 铁律 4：不得读 `~/.dsh/credentials`、不得向沙盒注入真实凭据**；要破这条先出 ADR 让 HUMAN 签，不走暗门。
4. **T-117 行级兼容通道相左（`BS-17`）**：与相位层无关的一块独立判断，先定粒度再实现。

**想继续从开源里借**：`docs/09-open-source-borrowing.md` 先看，再动 T-113（attw 矩阵，前置是沙箱实测 loader 解析模式）/ T-114（bisect，前置是 M3 probe —— **现已满足**）。**借机制不抄代码**，真抄要先进 `quarantine/` + `vendor-manifest`。

先按 `.agents/prompts/task-packet.md` 列允许改动的文件，再动手。

> D1 已于 R6 通过（9/10）；M2-a P2 于 R7 交付；R8 补副本来源与重复副本；R9 让「没声明」不再静默；R10 让 dist-tag 失步可见；R12 让相位来自真机（`data/results/inventory-live-2026-10-27T22-00-00.000Z.json`）并补齐 preset 维度。
> 复核口径七条命令：`node scripts/d1_report.mjs --stamp <iso>`、`node scripts/render_inventory.mjs --snapshot data/fixtures/inventory/desktop-web-2026-10-26.json --dsh-home tests/fixtures/env/home --profile desktop --stamp <iso>`、`node scripts/record_live_inventory.mjs --dsh-home <sandbox>/home --profile upstream --install <sandbox>/install --stamp <iso>`、`node scripts/record_audit.mjs --dsh-home <sandbox> --profile desktop --stamp <iso>`、`node scripts/probe_live_sample.mjs --dsh-home <sandbox>/home --profile upstream --install <sandbox>/install --stamp <iso>`、`node scripts/record_registry.mjs --stamp <iso>`、`node scripts/record_probe.mjs --candidate tests/fixtures/probe/ok-plugin --dsh-main <sandbox>/install/node_modules/@deepseek-ai/dsh/lib/bin.js --install <sandbox>/install --label ok --expect go --stamp <iso>`。
> **对外口径（别再说过头）**：真机相位样本来自**仓内沙盒**（0.2.1-rc.4），不是用户的 `~/.dsh`（本机真实 profile 是 0.1.0-rc.6，没有 `pluginInventory`）。可以说「在一台真起的 0.2.1-rc.4 Host 上实测」，不能说「在用户机器上实测」。真机样本里没有 `failed` / `broken preset` / `conditional` 行——这三档只有夹具覆盖。

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
| `dsh --profile <p> web --port N` 报 `too many arguments` | app 名不能当参数再给一次；profile 自己决定 app | 直接 `dsh --profile <p> --port N --no-open`，端口透传给 app |

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
| 每步审核台账 | `audit/step_reviews.json`（门 `step-review` 校验；四轴 + 对抗性 + 产物 sha256；R14 起 66 步） |
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
| `T-202a` **agent/preset 作用域**的工具表面 | implementer | 在会话/组合作用域里读 preset 工具表面。**R14 的 probe 只到进程级（`BS-21` 未变）**；要真实会话须先解决铁律 4（不得读凭据）→ 需要 ADR + HUMAN 签字 |
| `T-302` probe 的 `client-rendered` 断言 | implementer | 能识别「HTTP 有应答但白屏」。**前置 T-301 已于 R14 满足**，产物现在如实写 `unmeasured` |
| `T-303` probe 的 `namespace-diff` 断言 | verifier | 依赖 T-202a（作用域）才能列「声明了但未注册」的工具 |
| `T-304` probe 只测空模板 profile | implementer | 用 profile 副本 + 依赖安装跑一次，回答「加到**我的**组合里会不会挂」 |
| `T-305` registry 候选的真实安装形状 | implementer | 至少一次真 npm 来源的 probe（耗时 / lockfile / 私有源失败形状）；D2 的 ≥90% 必须建立在这上面 |
| `T-306` 非 web 表面的就绪判据 | implementer | 用 Host 自己打印的 URL/端口替代人工 `--no-http` 开关 |
| `T-113` attw 式入口可加载性矩阵 | implementer | 先在沙箱实测 loader 解析模式（两种），再实现；否则会造假警告 |
| `T-114` `triage bisect`（VS Code 二分思路） | implementer | **前置 T-301 已于 R14 满足**：probe 能稳定启停一次 boot（11.8–13.8s） |
| `BS-16` 来源/副本扫描的边界：`overrides`/lockfile 手钉 / 两层以上嵌套不可见；未知版本不参与比较 | implementer | 出现误判先补样本再改扫描器；T-113 与 probe 是补全路径 |
| 0.2.x 真机 profile 未装在**用户机器**上（仓内沙盒已能挂载并采样） | implementer | R14 的 probe 已在沙盒里跑通一次 boot；「用户机器」要靠 T-304 的 profile 副本 |
| npm 未登录，尚未占位发布 | HUMAN | `npm login` 后发布 `dsh-triage@0.0.1`（先 `pnpm run release:check`） |
| 仓库仍 private | HUMAN | 决定转 public 时执行 `gh repo edit … --visibility public`（建议等 D2 后再定） |
