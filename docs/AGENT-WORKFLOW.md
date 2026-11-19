# AGENT-WORKFLOW — 负责 Agent 的工作流（单一入口）

> 这份文档回答四件事：**我现在该做什么、事情归谁管、我的需求/想法往哪放、做完怎么留证。**
> 规则条文在 `PROJECT_RULES.md`，技术细节在各专题文档；本文件只做导航与顺序，不复制它们的判据。
> **宣传状态的唯一状态机在知识库 `Promotion/` 总线（本机 `Promotion Bus`），不在本仓库。**

---

## 0. 开工第一屏（每次会话先跑）

```powershell
git status --short
pnpm install --frozen-lockfile
pnpm run verify                     # build → typecheck → test → gate
node scripts/gate.mjs --mutate      # 10 门都要抓到注入的违规
node scripts/handover_check.mjs     # 交接文档自己说的话是否还成立
```

然后读 `docs/HANDOFF.md` 的「当前批次」与「下一位的第一件事」；**涉及宣传必须再跑 `kb promo status`**。
任何一条不是绿的，先修根因再往下走。**提交前一定跑 `pnpm run verify`，不是只跑 `gate.mjs`。**

---

## 1. 归属表（谁是什么的真相源）

| 主题 | 真相源 | 本仓库的角色 |
|---|---|---|
| 判据、阈值、金标 | `packages/core/src/admission.ts` · `data/gold/` · `docs/specs/` | 冻结，改动要判据轮 + 签字 |
| 数字（版本 / 测试数 / 读数） | `packages/plugin/package.json` · README 徽章 · `data/results/*.json` | 脚本产出 + `.sha256`，不在文档里手填 |
| 对外文字 | copy 通道（`docs/copy/facts/` → `drafts/` → paste 块） | 事实包先行；工程侧不代写文案 |
| 真机 / 门禁 / 发布证据 | `data/results/*.json` + `.sha256` | `produced_by` 必须是 `scripts/` |
| 交接、当前批次、第一件事 | `docs/HANDOFF.md` | 活文字必须描述这棵树 |
| **宣传排期 / 台账 / 事实卡 / 评论回收** | **知识库 `Promotion/` 总线** | **只提供 `promotion-snapshot/v1`；本仓 `docs/distribution/` 是人读 signal，不是第二份状态机** |
| Agent 的需求、想法、工单 | 知识库 inbox / `kb_dispatch` | 本仓库只留执行结果，不放第二份待办 |

与总线不一致时**以总线为准**，回来修正本仓的人读副本。

---

## 2. 每日循环

1. 跑 §0 的命令；红了先修根因。
2. `kb promo status`：看版本是否一致、哪些草稿 ready、哪些评论超 24h、哪些渠道在冷却。
3. 人工核对 API 看不见的一半：GitHub Discussions 的 0 回复状态、dev.to 评论正文、X 通知。
4. `node scripts/promo-snapshot.mjs` 自检快照；`kb promo collect dsh-triage` 把只读快照交给总线。
5. 有新评论要回的，回完把 URL 与验证结果用 `kb promo record` 落进总线台账，不要只留在浏览器里。
6. 安静的一天写「no change」；读不到写 `unreachable`，**绝不写 0**。

---

## 3. 需求与想法怎么处理（这是我自己的入口）

1. **能在本仓库直接落地的**：先写断言 / 脚本 / 文档变更，跑 `pnpm run verify`，结果写进 HANDOFF 当前批次。
2. **需要跨项目或跨渠道协调的**：用知识库总线登记——
   - 一般性需求 / 线索：`kb_create` 合适类型（如 `reference` / `inbox_item`），写清来源与判据；
   - 明确要有人或其他 Agent 做的：`kb_dispatch`（title / target_agent / deliverables / deadline）；
   - 宣传相关的发布动作：`kb promo record`，不在这里另开状态表；需要总线派发时 `target_agent` 用 `agent-promotion`，**不要用 `agent-tech`**。
3. **需要人类决定的**：登录 / 2FA / 验证码、HN/V2EX 正文、是否发版 / 打 tag / 切公开仓——列事实卡与选项交本人。
4. **不许静默丢弃**：不值得回的评论 / 想法也要写一句为什么不跟进（`docs/copy/outreach.json` 的 `read_not_posted`）。

---

## 4. 开发 / 修复流程（按轮型分级）

| 轮型 | 触发 | 必须做 | 可跳过 |
|---|---|---|---|
| 判据轮 | 动 `admission.ts`、冻结阈值、`data/gold/`、verdict 契约 | 判据先行 + 负对照 + 四轴 review + `--mutate` + 签字 | 无 |
| 交付轮 | 只动文档 / 文案 / 分发 / 新渲染 | 一次真跑产物 + 一个 verifier 复算 + 轮末一条台账 | 四轴并行、per-step 台账 |
| 采证轮 | 只读外部数据并落快照 | `produced_by` + 原始快照可离线复算 | 负对照 |

红线：**进 `data/results/` 的数字必须由脚本产出、带 sha256、可离线重算**；改判据永远走判据轮。

---

## 5. 发版流程（一次发版 = 一条完整链）

1. 稳定性体检：`pnpm run verify` + `--mutate` + `handover_check`。
2. 四包同升 → CHANGELOG → 两份 README / 两份 listing / 提交包对齐 → `check_listing --tests <n>`。
3. `pnpm -r publish --no-git-checks`（**本机 token 配了 2FA bypass，不需要 OTP**）→ `node scripts/record_publish.mjs`；
   紧跟发布的第一份若因副本滞后出红，**红产物保留**，几分钟后重跑。
4. 公开仓：`git rev-parse HEAD:dsh-triage` → `commit-tree -p origin/main` → push → `record_public_cut.mjs`。
5. **发版后宣传交给总线**：`kb promo facts dsh-triage` → `kb promo plan dsh-triage` → 逐渠道发帖 → `kb promo record`。

---

## 6. 宣传流程（状态在总线，动作在本机）

1. `kb promo plan dsh-triage` 决定**今天该发什么**；`done / post / wait / blocked / human / check` 里，
   `human` 只交事实卡，**不代写**；HN / V2EX 明文禁 AI 文本，本人写、本人发。
2. 每个渠道当期规则先读：版规 / CONTRIBUTING / 置顶帖三者。
3. 发帖前重读状态（`record_discussion_state --ids <...>` 或直接读页面）；**已被回答 / 已有我们自己回复的不再发第二条**。
4. 发帖后立刻验证：GitHub 评论读回逐字节、目录状态、dev.to 公开 API、X oEmbed、Reddit `removed_by_category`。
5. `kb promo record --project dsh-triage --channel <id> --url <url> --outcome <...> --method <...> --result <...>`
   记 URL 与验证结果；需要回的评论进总线 `inbound/`，回完写回复 URL。
6. 24 小时 / 1 周复盘：看 referrer、第一个外部 issue、哪个渠道有回声；下一轮只加一个渠道。
   **回帖数不是需求证据**；D5 只数 `#11813` 的 reactions 与第三方引用，全部 outreach 条目 `d5_counts: false`。

---

## 7. 留证与交接

- 每轮在 HANDOFF 顶部有「当前批次」与「下一位的第一件事」；批次写当时，状态表写现在。
- 五轴 review（正确性 / 可复现 / 合规 / SSOT / 对抗）不能为空；披露行含 SessionID。
- 外部报告只是线索，本机复现后才有补丁（R83 的更正红线）。
- 证据索引里每个文件都要能打开；当前快照只能有一个「当前」。

---

## 8. 冲突与失败的处理顺序

| 现象 | 先做什么 | 不要做 |
|---|---|---|
| 门禁红 | 修根因、重跑 `pnpm run verify` | 放宽阈值、只跑 `gate.mjs` 就提交 |
| 文档数字对不上 | 回到脚本 / 徽章现取，同一轮全链同步 | 从记忆或旧文档抄 |
| 发布后 registry 读到旧版本 | 等副本同步，几分钟后重跑；红产物保留 | 重发 |
| 目录条目版本旧 | 判 `upstream` / `pending`，只读复查 | 重复提 PR |
| 帖子被过滤 / 已有答复 | 读 `removed_by_category` / 评论数 | 重发、换标题、连发第二条 |
| 宣传状态不一致 | `kb promo status` 为准，回来改人读副本 | 在本仓另建一份状态表 |

---

## 9. 文件地图（全线路）

| 文件 | 职责 |
|---|---|
| `docs/AGENT-WORKFLOW.md` | 本文件：导航与顺序 |
| `AGENTS.md` / `PROJECT_RULES.md` | 入口与结构 / 硬规则 |
| `docs/HANDOFF.md` | 当前批次、第一件事、证据索引 |
| `docs/distribution/promotion.md` | 事实卡与人读渠道副本（总线为准） |
| `docs/distribution/promotion-playbook.md` | 可复用方法参考（流程以总线 PLAYBOOK 为准） |
| `docs/copy/` | 事实包 → 草稿 → paste 块 → outreach 台账 |
| `docs/research/` | 外部反馈 → 线索 → 本机复现 → 补丁 |
| `data/results/` · `audit/` | 脚本证据（+ sha256）· 五轴 review / 披露 / 台账 |
| `scripts/promo-snapshot.mjs` | 总线快照契约 `promotion-snapshot/v1`（只读、离线） |
| `tests/governance/promotion-bus.test.ts` | 守总线边界与快照契约 |
| 知识库 `Promotion/` | **宣传唯一状态机**（queue / ledger / facts / inbound / reach） |

---

## 10. 交接清单（给下一个人 / 下一个我）

- [ ] §0 命令全绿；不绿先修根因。
- [ ] 读 HANDOFF 的当前批次与第一件事；宣传再看 `kb promo status`。
- [ ] 新需求 / 想法已按 §3 落到正确的地方，没有静默丢弃。
- [ ] 对外文字经 copy 通道，数字来自事实包与产物。
- [ ] 宣传动作在总线登记（`kb promo record`），本仓库不留第二份状态。
