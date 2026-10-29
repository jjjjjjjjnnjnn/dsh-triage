# execution-playbook（执行手册）

## 0. 接手 5 分钟检查（禁跳过）

```powershell
git status --short          # 必须干净；有未提交改动先问来源
git log --oneline -3
pnpm install --frozen-lockfile
pnpm run verify             # 基线必须全绿；不绿先修基线，不叠加新功能
```

读：`docs/AI_HANDOVER.md` §2 → `PROJECT_RULES.md` → `INDEX.md`。

## 1. 每轮固定 9 步

| # | 步骤 | 产出 | 失败处置 |
|---|---|---|---|
| 1 | 读现状 | 相关 spec / 代码 / SSOT 证据 | 不清楚就查 `INDEX.md`，不猜 |
| 2 | 先写 spec（预登记判据） | `docs/specs/*.md`：判据、负对照、诚实边界 | 无判据不准写码 |
| 3 | 审核 | 纯文档 3 路；动代码/判据 5 路（含对抗性） | NEEDS WORK 必须先修 |
| 4 | 实现 | 代码 + 单测（先写断言） | — |
| 5 | **负对照** | 证明门会 FAIL 的用例 / 命令 | 门不响 = 门无效，回第 4 步 |
| 6 | 真跑 + 落 SSOT | `data/results/*.json` + `.sha256` | 禁手填、禁只贴 stdout |
| 7 | 门禁全绿 | `pnpm run verify` | 任一红不提测 |
| 8 | 文档同步 | 见 §4 | 漏同步 = 未完成 |
| 9 | commit | 提交信息含同步清单 | 禁 force-push |

### 1b. 每「一步」做完的必做动作（机器强制）

「一步」= 一次有产出的改动（一个功能点 / 一个判据 / 一个脚本 / 一个案例），不是「一轮」。
每一步完成**立刻**做两件事，并在 `audit/step_reviews.json` 追加一条（`gate step-review` 会重算 sha256，改不动也补不了）：

1. **审核**：四轴各写一句结论（正确性 / 可复现 / 合规许可 / SSOT 一致）+ **对抗性**：写清你尝试构造的反例与结果；只写「看着没问题」视为缺项。
2. **真实模拟测试**：真跑一条命令（不是 mock、不是思考实验），把产物落在 `data/results/`，记录 `command` / `artifact` / `sha256` / `outcome`。

```powershell
node scripts/gate_step_review.mjs          # 增量自检：缺轴/孤儿产物/哈希不符 → 红
node scripts/gate.mjs --record --stamp <iso>   # 整轮留痕：把门禁结果本身也写成 SSOT
```

### 1c. 流程分级（R47 起，HUMAN 批准）

先给这一轮**定性**，再决定走多重：

| 轮型 | 判据 | 硬要求 | 豁免 |
|---|---|---|---|
| 判据轮 | 改 `conclusion` 的计算、admission 规则、冻结阈值、`data/gold/`、verdict 契约 | 四轴 + 对抗性 + 每步 `step_reviews.json` + 真跑产物 + `--mutate` | 无 |
| 交付轮 | 文档 / 文案 / 分发 / 纯新增渲染 | 1 次真跑产物 + 1 个 verifier + 轮末 1 条汇总台账 | 四轴并行 review、per-step 台账 |
| 采证轮 | 只读外部数据并落快照 | 原始快照进 `data/fixtures/`、`produced_by`、离线可复算 | 负对照 |

**为什么允许豁免**：零用户阶段（周下载 0，见 `data/results/market-baseline-*.json`）最稀缺的资源是「接触用户的机会」，不是证据条数。豁免只针对**审核流程**，不针对**证据**：产物、sha256、可复算三件永远在。


## 2. 命令约定（Windows / 中文路径）

- 一律 UTF-8：`chcp 65001`；Node 脚本用 `node -X` 无必要，直接 `node`。
- 路径优先仓内相对 POSIX；跨包导入写 `.js` 后缀。
- 长任务（probe 全矩阵）放后台跑，期间做文档/审核，不轮询。
- 退出码判定用 `$LASTEXITCODE`，不要用 `Select-Object` 截断管道后再判。

## 3. 已知陷阱

| 症状 | 原因 | 处置 |
|---|---|---|
| `node --test` 找不到 TS 测试 | Node < 22.19 或文件名不符合 `*.test.ts` | 升级 Node；文件名必须 `*.test.ts` |
| 包间导入报 `ERR_MODULE_NOT_FOUND` | 忘记 `pnpm build` 或导入缺 `.js` | 先 `pnpm build`；TS 内相对导入带 `.js` |
| 门禁红了但不知道哪条 | 门禁输出被截断 | `node scripts/gate.mjs --json` 拿结构化结果 |
| 时间戳导致 SSOT 哈希漂移 | 每次生成都改 `generated_at` | 哈希只对「结论体」做，或固定 `--stamp` 复算对比 |
| 中文乱码 | PowerShell 显示编码 ≠ 文件编码 | 用 Node 读文件判断编码，禁据控制台乱码判文件损坏 |

## 4. 文档同步最小集（漏一即打回）

| 改了什么 | 必须同步 |
|---|---|
| 每一步（任何有产出的改动） | `audit/step_reviews.json`（四轴 + 对抗性 + real_test 产物 sha256） |
| **交付轮 / 分发轮（R47 起）** | 代替上面的 per-step：**1 条轮末汇总**（产物 + sha256 + verifier 结论）写进 `audit/step_reviews.json` 或该轮审核报告 |
| `packages/` `scripts/` `tests/` | `AGENTS.md` 架构图 + `INDEX.md` + `audit/AI_DISCLOSURE_LOG.md` + `PROJECT_RULES.md` 路线状态 |
| 判据 / 阈值 / verdict 契约 | `docs/05-verdict-contract.md` + `docs/specs/*` + `audit/gate_ledger.json` |
| 新依赖 / 新许可 / 新数据源 | `quarantine/vendor-manifest.json` + `COMPLIANCE.md` + `docs/02-signal-sources.md` |
| 归档 / 移动 | `_archive/ARCHIVE_MANIFEST.md` + `INDEX.md` + 引用处链接 |
| 每轮收尾 | `audit/AI_DISCLOSURE_LOG.md`（含 SessionID） |

## 5. 失败处理（禁做的事）

1. 禁为了让门变绿而放宽阈值（改阈值必须 spec + HUMAN-SIGN）；
2. 禁把「预期 BLOCKED」当「无需修复」——必须带 owner 与退出条件；
3. 禁删证据（只能 `git mv` 进 `_archive/` 并登记）；
4. 禁只贴 stdout 当证据（必须 SSOT + sha256）；
5. 禁在对话里下结论而不落文档（调研/选型沉淀到 `docs/specs/`）。

## 6. 轮次模板

```markdown
## 轮次 <日期><字母>｜<一句话主题>
- 判据：<spec 路径>（判据编号）
- 负对照：<命令>（必须 FAIL）
- 证据：data/results/...（sha256）
- 门禁：build / typecheck / test <n> / gate 7 门
- 同步：<文件清单>
- 诚实边界：未做 / 未验证 / 已知风险
```
