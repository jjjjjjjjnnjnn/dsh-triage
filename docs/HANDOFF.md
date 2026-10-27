# HANDOFF · 交接入口

> **Stand**: R8 (2026-10-27)｜当前批次：**R8 · 开源借鉴落地（副本来源归因 + 重复副本检测）+ 借鉴台账**（91 测试；9 门 9-9）
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
| 里程碑 | **M0 ✅** · **M1 金标对等 ✅** · **M1 真实案例验收 ✅（D1 通过：9/10 命中）** · **M2-a P2 ✅ / P1 待真机**（T-201） |
| 仓库 | `https://github.com/jjjjjjjjnnjnn/dsh-triage`（**private**，`main`） |
| CI | **5 job**：`verify (node 22)` · `verify (node 24)` · `verify (windows, node 24)` · `gates can fail`（负对照 9/9）· `release readiness`（tag 触发） |
| 规模 | **96 测试** · **9 门禁** · 6 角色卡 · 3+1 模板 · **10 个真实案例（9 命中 / 1 有意 miss）** |
| 硬规则 | **每一步做完必须四轴审核 + 真跑落产物**，写入 `audit/step_reviews.json`，由门 `step-review` 重算 sha256（`PROJECT_RULES.md` 铁律 11） |
| 本轮交付 | **开源借鉴落地**（台账 `docs/09-open-source-borrowing.md`，14 来源分三档）：① npm `explain` 式**副本来源归因**（`admission-row-declared-by`：「这份副本来自 `dsh-pdf@0.1.0` 的 `dependencies`」）；② Maven `dependencyConvergence` 式**重复副本检测**（`collision-duplicate-copy`，两条路径 + 两个版本）；③ `scripts/record_audit.mjs` 把 audit 写成 SSOT；④ 只设计：T-113 attw 矩阵 / T-114 bisect / T-115 区间对齐；明确不做：`npm audit` 式漏洞扫描、作者侧打包 lint |
| 证据 | `data/results/audit-2026-10-27T12-00-00.000Z.json`（2 rows / 1 duplicate group / 2 verdicts）· `inventory-2026-10-27T00-00-00.000Z.json`（相位层）· `gates-2026-10-27T12-00-00.000Z.json`（9 门全绿）· `gates-mutate-...`（9/9 CAUGHT）；共 23 个产物、30 个已审步骤 |
| 审核报告 | `audit/AUDIT_2026-10-27_R8.md`（本轮）· `AUDIT_2026-10-27_R7.md` · `AUDIT_2026-10-26_R6.md` · `R5` · `R4` · `R3` |
| 未通过的门槛 | D2–D4 尚未到点；**B1/B2 真机采样未验证**（P1 未实现，见 §8） |

---

## 3. 下一位 agent 的第一件事

```powershell
pnpm install --frozen-lockfile; pnpm run verify; node scripts/gate.mjs --mutate
```

**验收标准**：第二条输出 `ALL GREEN · 9 gates`；第三条最后一行 `NEGATIVE CONTROL PASSED · 9/9`。
满足即环境可信，接着**三选一**（都不需要新许可）：

1. **T-112**（`agentPresets` 维度）：同一 entry 在不同 preset 下相位不同，当前先出 `unknown`/`runtime.preset-unjudged`。按 `docs/specs/M2-inventory.md` §3 硬约束 3 实现，先写负对照。
2. **T-202**（namespace 快照）：`tools/commands/settings/skills` 的运行期快照，落 `data/results/ns-*.json` + 哈希。
3. **T-107 / T-108 / T-109**（R6 的三个真缺口）：无声明行静默、`dsh.compatibility` 未读、dist-tag 失步。

**想继续从开源里借**：`docs/09-open-source-borrowing.md` 先看，再动 T-113（attw 矩阵，前置是沙箱实测 loader 解析模式）/ T-114（bisect，前置是 M3 probe）/ T-115（区间对齐，与 T-109 合并）。**借机制不抄代码**，真抄要先进 `quarantine/` + `vendor-manifest`。

先按 `.agents/prompts/task-packet.md` 列允许改动的文件，再动手。

> D1 已于 R6 通过（9/10）；M2-a P2 于 R7 交付（`data/results/inventory-2026-10-27T00-00-00.000Z.json`）；R8 补了副本来源与重复副本（`data/results/audit-2026-10-27T12-00-00.000Z.json`）。
> 复核口径三条命令：`node scripts/d1_report.mjs --stamp <iso>`、`node scripts/render_inventory.mjs --snapshot data/fixtures/inventory/desktop-web-2026-10-26.json --dsh-home <sandbox> --profile desktop --stamp <iso>`、`node scripts/record_audit.mjs --dsh-home <sandbox> --profile desktop --stamp <iso>`。
> **P1 与真机相位采样仍阻塞**：本机没有可启动的 0.2.x profile（见 §8）。没有真机样本前，对外只能说「相位表已实现」，不能说「实测过这台机器」。

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
| 本轮审核结论 | `audit/AUDIT_2026-10-26_R6.md`（R6，含 §10 独立复核）· `AUDIT_2026-10-26_R5.md` · `R4` · `R3` |
| 每步审核台账 | `audit/step_reviews.json`（门 `step-review` 校验；四轴 + 对抗性 + 产物 sha256） |

---

## 8. 仍未解除的项（带 owner + 退出条件）

> **D1 已于 R6 通过**（9/10，`data/results/d1-2026-10-26T12-00-00.000Z.json`），因此下表不含 D1；但 D1 的标签目前是**实现方自证**（`BS-14` / T-111），对外口径只能是「机器可复算的命中率」。

| 项 | owner | 退出条件 |
|---|---|---|
| `T-107` 无声明行静默（`BS-10`）：不声明任何 dsh peer 的行一行结论都不出 | implementer | 行级产出 `unknown` + `missingEvidence`，并有「静默即红」的负对照测试 |
| `T-108` 未读的声明通道（`BS-13`）：`dsh.compatibility` / `dshReleases` | implementer | 读成次要证据并与 peer 结论分列；tier 不得越级 |
| `T-109` npm dist-tag 失步（`dsh-tools` latest=0.0.1-rc.1，而已发布 0.2.1-rc.x） | implementer | `check --explain` 显示 latest / next / 已发布最新 三者差异，tier 不得越级 |
| `T-111` label 自证（`BS-14`）：9 个命中无独立签署 | verifier + implementer | R7 起新案例由独立上下文签署 `label_verified_by` |
| `T-201 P1`：Host 内 `compat_inventory` 工具（相位真机来源） | implementer | 本机可启动 0.2.x profile → P1 导出的快照喂给 `audit --snapshot` 与 Host 内结论一致 |
| `B1/B2` 真机采样（`BS-15`）：相位层目前只有合成样本 | verifier | 产出一份 `sample.kind=live` 的 `data/results/inventory-*.json`，与合成样本并列 |
| `T-112` preset 维度：同一 entry 在不同 preset 下相位不同 | implementer | 分开出结论，禁取「最乐观值」；`conditional` 行标 `unknown`（当前先出 `unknown`/`runtime.preset-unjudged`，不静默） |
| 0.2.x 真机 profile 未装（沙盒已有，非真机） | Implementer（M3） | 本机装 `0.2.1-rc.3` profile 并跑通一次 probe（同时解锁 P1 与 B1） |
| npm 未登录，尚未占位发布 | HUMAN | `npm login` 后发布 `dsh-triage@0.0.1`（先 `pnpm run release:check`） |
| 仓库仍 private | HUMAN | 决定转 public 时执行 `gh repo edit … --visibility public`（建议等 D2 后再定） |
| 0.2.x 真机 profile 未装（沙盒已有，非真机） | Implementer（M3） | 本机装 `0.2.1-rc.3` profile 并跑通一次 probe |
| `audit` 与 `why` 行级结论不一致（T-105） | implementer | 两命令对同一 profile 交叉一致（e2e 断言） |
| T-103 金标扩容（冻结区） | HUMAN 签字后 implementer | 6 条新金标进 `data/gold/`，parity 门绿 |
| 双 roadmap 重叠（`docs/06-roadmap.md` vs `docs/ROADMAP.md`） | HUMAN 决定 | 合并或明确分工后归档其一（T-110，需签字，因为要删文档） |
