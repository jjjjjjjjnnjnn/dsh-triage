# HANDOFF · 交接入口

> **Stand**: v0.1.0-skeleton (2026-10-26)｜当前批次：**R2 · 命名 + 路线 + Agent 框架**
> 任何人（人或 agent）接手，**只读本文件 + `PROJECT_RULES.md` + `INDEX.md` 三份**即可开工。

---

## 1. 五分钟检查（禁跳过）

```powershell
git status --short                  # 必须干净；有未提交改动先问来源
git log --oneline -3
pnpm install --frozen-lockfile
pnpm run verify                     # build → typecheck → test → gate，必须全绿
node scripts/gate.mjs --mutate      # 每道门必须 CAUGHT（证明门不是装饰）
```

基线不绿 → **先修基线，不叠加新功能**。

---

## 2. 当前批次

| 项 | 状态 |
|---|---|
| 产品名 | **dsh-triage**（品牌：分诊台 / Triage） |
| 里程碑 | **M0 ✅**（44 测试 / 6 门全绿 / 6/6 CAUGHT）· **M1 🟡**（金标对等 ✅，真实案例验收 ⬜） |
| 仓库 | `https://github.com/jjjjjjjjnnjnn/dsh-triage`（private） |
| 上游基线 | `@deepseek-ai/dsh` **0.2.1-rc.2**（本机 profile 实测 0.1.0-rc.6） |
| 本轮交付 | 命名与仓库、`docs/ROADMAP.md`、`docs/BACKLOG.md`、`.agents/{README,roles×6,prompts×3,rules/adversarial_review}` |
| 证据 | `data/results/why-2026-10-26T00-00-00.000Z.json`（156 行 / 0 冲突 / sha256 随行） |

---

## 3. 下一位 agent 的第一件事

```powershell
pnpm install --frozen-lockfile; pnpm run verify; node scripts/gate.mjs --mutate
```

**验收标准**：两次命令都成功，且 `gate --mutate` 输出 6 行 `CAUGHT`（不是 `MISSED`）。
看到 `CAUGHT` = 你接手的环境是可信的，可以开始领任务（`docs/BACKLOG.md` → 推荐 **T-101**）。

---

## 4. 坑（真实踩过的，别再踩）

| 症状 | 原因 | 处置 |
|---|---|---|
| `node --test` 报找不到模块 | 没 `pnpm build`（包导出指向 `dist/`） | 先构建再测 |
| 标准 profile 报 27 条「entry id 冲突」 | 把「纯覆写」当撞车 | 已修，见 `docs/adr/0002`；别回退该判定 |
| `yaml` 解析把 `!!js` 当错误 | 未用 `parseDocument` + `doc.errors` | 已修，见 `packages/core/src/ledger.ts` |
| 提交标题带 `` | PowerShell 5.1 `Out-File -Encoding utf8` 写 BOM | 用 `git commit -m`，别用 `-F` 接 BOM 文件 |
| 门禁「全绿」但什么都没查 | 没跑 `--mutate` | 每轮必跑（CI 也跑两次） |
| 中文控制台乱码 | 控制台编码 ≠ 文件编码（文件是 UTF-8 无 BOM） | 用 Node 读文件判断，不看控制台 |

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
| 领任务 / 派活 | `docs/BACKLOG.md` + `.agents/prompts/task-packet.md` |
| 审核 | `.agents/roles/reviewer.md` + `.agents/prompts/review-packet.md` |
| 对抗性证伪 | `.agents/roles/adversary.md` + `.agents/rules/adversarial_review.md` |
| 代码约定 | `docs/08-conventions.md` |
| 路线与决策门 | `docs/ROADMAP.md` |
| 环境事实 | `docs/07-environment.md` |
