# HANDOFF · 交接入口

> **Stand**: R4 (2026-10-26)｜当前批次：**R4 · 真实案例验收 + 行级归因 + 0.2.x 解阻塞**（T-101 命中，新增 A7/A8 判据，见 `data/cases/CASE-11080/`）
> 任何人（人或 agent）接手，**只读本文件 + `PROJECT_RULES.md` + `INDEX.md` 三份**即可开工。

---

## 1. 五分钟检查（禁跳过）

```powershell
git status --short                  # 必须干净；有未提交改动先问来源
git log --oneline -3
pnpm install --frozen-lockfile
pnpm run verify                     # build → typecheck → test → gate，必须全绿
node scripts/gate.mjs --mutate      # 必须输出 NEGATIVE CONTROL PASSED · 7/7
```

基线不绿 → **先修基线，不叠加新功能**。

---

## 2. 当前批次

| 项 | 状态 |
|---|---|
| 产品名 | **dsh-triage**（品牌：分诊台 / Triage） |
| 里程碑 | **M0 ✅** · **M1 金标对等 ✅** · **M1 真实案例验收 ✅（1 例命中，未达 10 例门槛）** · **M2-a 契约 ✅ / 实现 ⬜** |
| 仓库 | `https://github.com/jjjjjjjjnnjnn/dsh-triage`（**private**，`main`） |
| CI | **5 job 全绿**：`verify (node 22)` · `verify (node 24)` · `verify (windows, node 24)` · `gates can fail`（负对照 7/7）· `release readiness`（tag 触发） |
| 规模 | 56 测试 · 7 门禁 · 6 角色卡 · 3+1 模板 · 1 个真实案例 |
| 本轮交付 | **T-101 真实案例命中**（CASE-11080）；**行级 admission 归因**（此前只看 bundle → patch 里的 row 逃检，假阴）；`record_case` / `bootstrap_upstream` 两个真跑脚本；`docs/specs/M2-inventory.md` 契约锁定；6 条新测试（4 单测 + 2 e2e 负对照） |
| 证据 | `data/results/why-case-CASE-11080-2026-10-26T00-00-00.000Z.json`（`hit.verdict=hit`，sha256 `19f52276eeca…`）· `data/results/upstream-0.2.1-rc.3-2026-10-26T00-00-00.000Z.json`（沙箱实测相位契约，7/7 checks）· `data/results/why-2026-10-26T00-00-00.000Z.json`（本机 profile，2 go / 0 冲突） |
| 案例输入 | `data/cases/CASE-11080/`（真实 npm manifest + 重建声明层 + 机器可算 label + 偏差披露） |

---

## 3. 下一位 agent 的第一件事

```powershell
pnpm install --frozen-lockfile; pnpm run verify; node scripts/gate.mjs --mutate
```

**验收标准**：第二条输出 `ALL GREEN · 7 gates`；第三条最后一行 `NEGATIVE CONTROL PASSED · 7/7`。
满足即环境可信，接着领 **T-201（按 `docs/specs/M2-inventory.md` §4 的 P1+P2 路径实现相位台账）**：`docs/BACKLOG.md` → 按 `.agents/prompts/task-packet.md` 列允许改动文件后再动手。


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
| 本轮审核结论 | `audit/AUDIT_2026-10-26_R3.md` |

---

## 8. 已知 blocked（带 owner + 退出条件）

| 项 | owner | 退出条件 |
|---|---|---|
| npm 未登录，尚未占位发布 | HUMAN | `npm login` 后发布 `dsh-triage@0.0.1`（先 `pnpm run release:check`） |
| 仓库仍 private | HUMAN | 决定转 public 时执行 `gh repo edit … --visibility public` |
| M1 真实案例验收（T-101） | HUMAN + Verifier | 提供插件名/版本/dsh 版本/症状 → `why` 一次命中 → 落 `data/results/why-case-*.json` |
| 0.2.x 真机 profile 未装 | Implementer（M3） | 本机装 `0.2.1-rc.2` profile 并跑通一次 probe |
