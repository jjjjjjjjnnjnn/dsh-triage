# 采证 · 上游问题里，这套判断层能覆盖多少（R59）

> **口径**：`docs/specs/question-coverage.md`（2026-11-02 签「同意，开始跑」；同日 R59-S1 修正「第三方 + 上游点名版本」）
> **产物**：`data/results/question-coverage-2026-11-02T09-57-53-229Z.json`（`7354f39db3ab…`，8.1MB）
> **离线复算**：`data/results/question-coverage-recompute-2026-11-02T10-05-00-000Z.json`（`2d51b1666275…`；rows / counts / coverage 与实测**逐项相同**）
> **抽检**：`data/results/question-review-2026-11-02T10-10-00-000Z.json`（`285fc59e5ac5…`；agent 9/20，HUMAN 抽查 5/5）
> **快照**：`data/fixtures/question-coverage/2026-11-02T09-57-53-229Z/`（`qa.json` 全文 4.4MB · `general.json` 投影 6.0MB · `packuments.json` 0.7MB / **1393 包**）

---

## 1. 结论先说

**在 Q&A 分类的全部 1545 条帖子里，我们能给出「声明层判定」的是 74 条 = 4.8%（Wilson 95% 3.8–6.0%）。**

这不是「解决率」，也不是「覆盖率」的全称：它只回答一个问题——**按今天的 `next`（0.2.1-rc.5）判，我们能不能对这条帖子说出一句有证据的声明层结论**。

| tier | 条数 | 占 Q&A | 意思 |
|---|---:|---:|---|
| `names-a-denial` | **47** | 3.0% | 能点名「这个包会被拒」并给出区间 |
| `rules-out-declaration` | **27** | 1.7% | 能排除声明层（「不是版本区间的问题」） |
| **头条（上面两项之和）** | **74** | **4.8%** | **Wilson 95% 3.8–6.0%** |
| `declares-nothing` | 89 | 5.8% | 只能说明「没声明」——**不算兼容，也不算被拒** |
| `upstream-only` | 164 | 10.6% | 只涉及未点名的上游包（npm tag 常年过期），**不进头条** |
| `probe-unreadable` | 90 | 5.8% | 名字在 npm 上不存在（366/370 次失败是 404），或极少网络失败 |
| `needs-their-profile` | 178 | 11.5% | 相关层，但没有可探针的包名 |
| `not-relevant` | 950 | 61.5% | 分类器没读到任何声明/组合/升级信号 |

**上下文（不是头条）**：问题里只要出现任何一层信号，就剩 **595 条**；其中 74 条能给出声明层判定 = **12.4%（Wilson 10.0–15.3%）**。再把「探针读不到」的 90 条摘掉，是 **74/505 = 14.7%（11.8–18.0%）**。

> **一句必须写进 README 的话**：头条的分母是**全部 Q&A**，不是「相关问题」。把 595 当分母会好看 2.6 倍，但那是另一个问题。

## 2. General（对照层，不与 Q&A 合并）

| 总体 | 条数 | 头条 | Wilson 95% | 相关问题 | 相关口径 |
|---|---:|---:|---|---:|---:|
| Q&A（头条） | 1545 | **74 (4.8%)** | 3.8–6.0% | 595 | 12.4% |
| General（投影快照，仅对照） | 5786 | **411 (7.1%)** | 6.5–7.8% | 2668 | 15.4% |

General 的 tier 拆分：`names-a-denial 223 · rules-out 188 · declares-nothing 487 · upstream-only 716 · probe-unreadable 405 · needs-their-profile 649 · not-relevant 3118`。

**不合并的理由**：General 体量是 Q&A 的 3.7 倍，而且大量是聊天/公告；合并会让它淹掉头条。General 的正文没有进仓库（会多 20–40MB），所以它标 `projection-only`，只用于对照，**不作为头条**。

## 3. 样本、抓取与目标

| 项 | 值 |
|---|---|
| 仓库 | `deepseek-ai/deepseek-harness` |
| Q&A | `DIC_kwDOT3T1g84DDSUc` · **1545/1545** · 16 页 · `#15`（2026-08-13）→ `#11857`（2026-11-02） |
| General | `DIC_kwDOT3T1g84DDSUb` · **5786/5786** · 58 页 · `#13`（2026-08-13）→ `#11856`（2026-11-02） |
| 截止 | 按**帖子号**（不是墙钟）：抓取开始时各分类的最新号；抓取期间的新帖号更大，被排除 |
| 目标运行时 | `0.2.1-rc.5`（抓取时 npm `next`，逐字读回） |
| 分类器 | `scripts/lib/discussion-triage.mjs` **v1 冻结**（本轮不改规则） |
| 探针 | 每帖最多 3 个包，第三方优先；帖内点名 `pkg@ver` 就按点名版本；包名去重后 **1393 个唯一包 / 5332 次探针** |

## 4. 抽检：分类器与人工的差距（这是本轮最重要的发现）

- **agent 盲标 20 条**（先读 title+body，再看分类器），**一致 9/20 = 45%**；
- **HUMAN 抽查前 5 条，5/5 同意 agent 的标签**；
- 11 条分歧里 **9 条是同一类**：运行期/UI 报告（`fails` / `cannot` / `TRANSPORT` / 沙箱 ACL / 浏览器 API）**没有命中关键词表**，被分类器读成 `unknown / not-ours`，人工读成 `runtime / partially-answerable`；
- 另两条：`#8110`（同名 fork 覆盖，读成 unknown，人工判 composition）与 `#10099`（bundle inject 硬依赖，读成 admission，人工判 composition）。

**为什么头条仍然是保守下界**：被误读成 `unknown` 的帖子**不会**进入 tier1/2（不探针、不计数）；如果分类器把它正确读成 `runtime`，它最多变成 `rules-out-declaration`（tier2）或 `upstream-only`，**只会让头条变高，不会变低**。所以 4.8% 不是被分类器抬出来的数字；真正被抬高的风险在 **tier 拆分**（`not-relevant` 950 里混着运行期报告），不在头条。

**下一步**：分类器 v2 是**判据轮**（要改规则、补中英文信号表、重跑 20 条抽检），不在本轮。

## 5. 三个自己抓到的缺陷（都保留在报告里，不粉饰）

### 5.1 第一次全量跑没有写 packument 快照

`let packumentsSnapshot` 初始为 `undefined`，而构建条件是 `=== null`，于是快照写成 `{schema_version, produced_by, captured_at}`（**没有 `packages`**）。离线复算当场拒绝：

```
the snapshot is missing 1392 package(s) the rows need: @deepseek-ai/dsh, ...
```

**修法**：初始化为 `null`；`writeSnapshot` 增加「没有 packuments 就 die」守卫。旧的 09:12 产物与快照**已删除**（它看起来是绿的，留着比删掉更危险）；本报告保留这次失败的读数。

### 5.2 快照把 `undefined` 写成 `null`，复算把 81 条从「没声明」翻成「被拒」

第一次可跑的复算（`09-45`）给出 **47/27/89 vs 128/17/18**（实测 vs 复算），头条 74 → 145。逐行比对定位到：

```
live @deepseek-ai/dsh@0.1.0-rc.6: unconstrained
rec  @deepseek-ai/dsh@0.1.0-rc.6: denied
```

根因：`manifest.engines ?? null` 把「没有这个字段」写成了字面 `null`，而 `evaluateAdmission` 把 `null` 读成**畸形声明**（denied），只有 `undefined` 才是「没声明」（unconstrained）。

**修法**：快照写出时**省略** `undefined` 字段；读取时把旧的 `null` 还原成 `undefined`。新增 3 条回归测试（`null` 仍是 unconstrained / 真声明仍 denied / 快照 round-trip）。修后复算与实测 **rows / counts / coverage 逐项相同**。

### 5.3 隐私门抓到一个假阳性（`方向键/Home/End/`）

`gate_governance` 的 `results-privacy` 拒绝 `data/results` 里的 `/home/<name>/`。它当场红了一条 General 标题：

```
[Bug Report] 共享 Menu 组件暴露 role="menu" 但完全没有键盘导航（焦点留 trigger，方向键/Home/End/Enter 全部无响应）
```

这不是用户 home 路径，是 `/Home/End/` 被**大小写不敏感**的 `/\/home\/[a-z0-9._-]+\//i` 命中。**没有放宽门禁**；加了一个 `scrubHomePaths()`（只替换 home 形状的片段，含这个假阳性），在 `toRow` 里作用于标题与 probe 详情，并加单测。重跑后 SSOT 干净。

> 三条都属于「看起来绿、其实是假的」那一类；它们能被抓到，是因为复算真的从快照重跑了 5332 次探针、门禁真的扫了 SSOT，而不是只比对计数。

## 6. 边界（README 必须同屏写）

1. **没有他们的 profile**：判的是**已发布 manifest** 对目标运行时；行级相位、依赖遮蔽、运行期故障都不在读数里。`names-a-denial` 是「如果你装的是这个版本」。
2. **一个目标版本判全部帖子**：`0.2.1-rc.5`。帖子点名了包版本就按点名版本；帖子说的是旧运行时，仍按 rc.5 判——这回答的是「今天能不能答」，不是「当时为什么坏」。
3. **分类器只读文本，一致率 45%**：头条是保守下界；tier 拆分受分类器影响。README 必须写「分类器辅助，一致率 9/20」。
4. **上游包不进头条**（R59-S1）：未点名的 `@deepseek-ai/*` 记 `upstream-only`；它们的 npm `latest` 常年是过期的 monorepo tag（`dsh-tools@0.0.1-rc.1` 这类），把 denial 算成用户问题就是 R57 写过的坑。
5. **`probe-unreadable` 绝大多数是 404**：Q&A 370 次失败里 366 次是「npm 上没这个包」（`dsh-compaction-basic` 这类上游内部模块名）；General 1790 次里 1763 次同样是 404，网络失败只有 3 次。它不是「npm 挂了」。
6. **每帖最多 3 个包**：Q&A 138 条、General 677 条有被截断的包名（`truncated: true`），逐条记录在产物里。
7. **只对这两个分类成立**：Q&A 全量 + General 全量；不许写「全网 / 所有问题 / every question」。

## 7. 复算命令

```powershell
# 实测（会抓 GitHub + npm，约 6 分钟）
node scripts/record_question_coverage.mjs --stamp <ISO> --delay 150

# 离线复算（只读快照；rows / counts / coverage 必须逐项相同）
node scripts/record_question_coverage.mjs --stamp <ISO> --recompute `
  --fixtures data/fixtures/question-coverage/2026-11-02T09-57-53-229Z --target 0.2.1-rc.5

# 抽检产物（20 条 agent 标签 + 5 条 HUMAN 抽查）
node scripts/record_question_coverage.mjs --review-only --stamp <ISO> `
  --measurement data/results/question-coverage-2026-11-02T09-57-53-229Z.json `
  --fixtures data/fixtures/question-coverage/2026-11-02T09-57-53-229Z `
  --review data/fixtures/question-coverage/2026-11-02T09-57-53-229Z/review.json `
  --human data/fixtures/question-coverage/2026-11-02T09-57-53-229Z/human.json
```

## 8. 这轮对产品的含义

- **4.8% 是诚实的**，但它不是「产品没用」：61.5% 的 Q&A 根本不是兼容/声明问题（主题、用法、公告），11.5% 没有包名。真正相关且可判的那 74 条，是我们能一句话答完的。
- **不要把它写成 12.4%**：那是「相关问题」口径，必须在同一屏写清分母。
- **分类器 v2 比再涨一个功能更值**：45% 的一致率意味着 tier 拆分目前只能当粗略分布看；头条不受影响，但「我们覆盖了哪一类问题」这件事还说不准。
- **D5 不受影响**：这轮没有改任何判据/阈值，也没有发新帖；D5 窗口仍在 `2026-11-15T20:24:37Z` 关闭。
