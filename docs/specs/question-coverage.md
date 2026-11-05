# Question 覆盖率口径（先写死，再看数据）

> **状态**：`proposed` → **已签（2026-11-02，HUMAN：「同意，开始跑」）**；**R59-S1 修正（同日，HUMAN：「第三方 + 上游点名版本」）**：头条只算**用户可安装的第三方包**，以及**帖内点名了版本的上游包**；只涉及未点名上游包的帖子记 `upstream-only`（留在分母、不进分子）。修正理由见 §5 的「为什么上游包要分开」。
> **为什么先有这份文件**：这个数字会写进 README 首屏，而它最容易被两种方式做假：① 先跑一遍，看到数字不好看，再换分母；
> ② 把「只能说明没声明」也算成「能答」。所以总体、分母、三档、读不到、区间、抽检、外推边界全部在**跑之前**写死，
> 并做成可执行纯函数（`scripts/lib/question-coverage.mjs`）。
> **本轮不改任何判据**：`admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 / D5 三个阈值一字未动。

---

## 1. 两个总体（不合并）

| 总体 | 定义 | 在本轮的角色 |
|---|---|---|
| **P1 · Q&A** | `deepseek-ai/deepseek-harness` Discussions 的 **Q&A 分类全部帖子**，以抓取开始时的最大帖子号为截止 | **头条数字只从这里来** |
| **P2 · General** | 同仓 **General 分类全部帖子**，同一截止号 | **对照层**，单独一行；**永不与 P1 合并**（P2 体量约 P1 的 3.7 倍，合并会让它淹掉头条） |

**为什么不是抽样**：抽样需要先定义抽样框；而「全部帖子」本身就是可核对的分母。N 来自 GitHub `totalCount`，M 是实际抓到的条数。

## 2. 抓取与截止

- 一次预查询拿到每个分类的 `totalCount` 与**最新帖子号**；以该号码为**截止号**（不按墙钟截断，避免抓取过程中新帖混进来）；
- 按 `CREATED_AT ASC` 分页（每页 100），抓到 `number > 截止号` 即停；
- **M ≠ N → exit 2、零产物**：半份样本不能算率；
- 任何一页 403 / 429 / 结构不对 → **exit 2、零产物**（R52 的教训：读不到写成 0 会被读成「没人有问题」）；
- 快照落 `data/fixtures/question-coverage/<stamp>/`（见 §7）。

## 3. 目标运行时

- 默认 = 抓取时 npm `@deepseek-ai/dsh` 的 **`next` dist-tag**（读不到 → exit 2，不许猜）；
- 可用 `--target <精确版本>` 覆盖；覆盖值必须逐字是精确 semver；
- **帖子点名了 `pkg@ver` 就按点名版本探针**（R57 规则），否则用该包的 `latest`；
- 每个 probe 记录 `target`、`version_source`（`thread-pinned` / `latest` / `default`）；
- **一个目标版本判全部帖子**：这回答的是「按今天这个目标，我们能不能给声明层判定」，不是「当时为什么坏」；README 必须写这句边界。

## 4. 分类器（本轮冻结）

- 直接复用 `scripts/lib/discussion-triage.mjs` 的 `classifyThread`（`layer` 五态 / `verdict` 四态）与 `extractPackages`；
- **本轮不许改它的规则**。抽检发现的错例只记录、不修——改规则是下一轮的判据轮（否则就是看着样本调分类器）；
- 探针目标选择沿用 R57：作用域名覆盖时丢弃裸名、第三方包优先、每帖最多 3 个包；
- 超过 3 个包的帖子记 `truncated: true` 与 `packages_omitted`，并在产物里汇总，不静默截断。

## 5. 三档「能覆盖」（thread 级，互斥）

先定义**可计入头条的探针（actionable probe）**：

- `state = measured`，且
- **不是** `@deepseek-ai/*` 上游包，**或者**帖内点名了该包的版本（`version_source = thread-pinned`）。

**为什么上游包要分开**：`@deepseek-ai/*` 是 app 自带的依赖（目标运行时 `0.2.1-rc.5` 的 `dependencies` 有 86 个），它们的 npm `latest` 常年停在 `0.0.1-rc.1` 这类过期 monorepo tag 上。把「`dsh-tools@0.0.1-rc.1` 不含 rc.5」算成「我们答得出用户的问题」就是 R57 写过的坑：**上游 built-in 的 denial 通常是 app 自己在说话**。帖内点名了版本时例外——那时我们判的是用户手上那个 build（#8202 的规则）。

按下列**优先级**给每一条帖子一个 `tier`（命中即停）：

| 优先级 | tier | 判据 | 意思 |
|---|---|---|---|
| 1 | `names-a-denial` | 至少一个 **actionable** probe 的 `admission.status = denied` | 能点名「这一行/包会被拒」并给出区间 |
| 2 | `rules-out-declaration` | 无 actionable denied，且至少一个 actionable probe 的 `status = admitted` | 能排除声明层（「不是版本区间的问题」）——**不是**解决问题 |
| 3 | `declares-nothing` | 有 actionable measured probe，但全部是 `unconstrained` / `indeterminate` | 只能说明「没声明」——**不算兼容，也不算被拒** |
| 4 | `upstream-only` | 有 measured probe，但**没有 actionable**（全是未点名上游包） | 只能说到「上游 npm tag 与 app 自带版本不一致」，不进头条 |
| 5 | `probe-unreadable` | 有探针目标，但全部读不到。**R88 实测：Q&A 的 160 次全部是 `npm has no package`（名字不是包），不是网络/权限失败** | 读不到 ≠ denied；**名字读错 ≠ 读不到**（`docs/specs/X2-name-extraction-precision.md`） |
| 6 | `needs-their-profile` | 相关层，但没有任何可探针的包名。**R88 拆分：107 条在 admission / composition / upgrade（读已装集合就能答），71 条在 runtime（`ADR-0009` A 不读）** | 只能在他们的 profile 上答 |
| 7 | `not-relevant` | `layer = unknown`（分类器没读到任何层信号） | **只说明分类器没匹配到**；**不得**写成「与我们无关 / 不是我们的层」（`docs/specs/X3-not-relevant-means-no-signal.md`） |

**硬规则**：`declares-nothing` 与 `upstream-only` **永远不进头条分子**；两者都**留在分母里**（保守），并单列。
`indeterminate` 只允许来自「区间无法解析」这类证据不足，不允许来自「没给目标版本」。

## 6. 头条数字与区间

- **头条** = `(names-a-denial + rules-out-declaration) / P1 全部帖子数`；
- tier 1/2 只由 **actionable probe** 产生（§5）；`upstream-only` 是独立的第 4 档，和 `declares-nothing` 一样**不进分子**、但**留在分母**；
- 标签必须写「**能给出声明层判定的比例**」，**不得**写「解决率」「覆盖率 100%」；
- 分子、分母、比例、**Wilson 95%** 同时落盘；每档占比也各自带 Wilson 95%；
- **上下文行**（只进产物与报告，不进 README 头条）：以「相关问题」（`layer ≠ unknown`）和「可判相关问题」（再减去 `probe-unreadable`）为分母的同一比例；
- P2 用同一套 tier 与公式单独计算，标 `projection-only`（见 §7），**不与 P1 合并、不写合并率**。

## 7. 快照与复算（这一轮补齐 R57 的缺口）

| 文件 | 内容 | 复算能力 |
|---|---|---|
| `qa.json` | P1 全文快照（`number / title / bodyText / category / createdAt / url`） | **完全离线复算**：rows / counts / tiers 逐项相同 |
| `general.json` | P2 投影（`number / title / createdAt / url / body_sha256 / body_chars / layer / verdict / signals / packages / snippets`） | `projection-only`：行与计数相同，但**不能**重新跑正则；产物里必须自曝 |
| `packuments.json` | 去重后的包投影（`name / state / dist_tags / latest / chosen / manifest{engines,peerDependencies,deprecated} / error`） | 完全离线；**不存全量 packument**（体积） |
| `review.json` | 20 条抽检的逐条标签（layer + verdict + 理由） | 作为输入合并，不由脚本生成 |

> **R57 的缺口**：它的 `--fixtures` 只锁了帖子，`probePackage` 仍然联网——那不是离线复算。本轮把 packument 投影也快照，P1 的复算才真正离线。

## 8. 人工抽检与误差

- **抽样**：固定种子 `20261102`，对 P1 每条帖子算 `sha256("<seed>:<number>")`，按十六进制升序取前 **20** 条（可复现、不看内容挑）；
- **agent 复核**：逐条读 `title + bodyText`，独立给 `layer` + `verdict`；**一致 = 两者都相同**；不一致的逐条列出（帖子号 / 分类器 / 复核者 / 一句为什么）；
- **HUMAN 抽查**：同一次排序的前 **5** 条；未完成前产物写 `human_spot_check.status = "pending"`，README 只能写「agent 复核 20 条」；
- **误差门槛**：一致率 `< 80%` 时，README 的标题句必须带「分类器辅助，一致率 X/20」，且下一轮先做分类器 v2（另开判据轮）；
- 复核者身份写进产物（`agent:<model>` / `human`），不得把 agent 复核写成人工复核。

## 9. 外推边界（README 必须写）

1. 只对**这个样本**成立：P1 = 某日为止的 Q&A 全量、P2 = 同一截止的 General 全量；不许写「全网 / 所有问题 / every question」；
2. 判的是**已发布 manifest**（帖子点名版本时按点名版本），**不是他们那台机器**：没有 profile，行级相位、依赖遮蔽、运行期故障都不在读数里；
3. 分类器只读文本，会错；一致率与错例必须与数字同屏；
4. `rules-out-declaration` 是**排除**，不是修复；`declares-nothing` 不是兼容；
5. P2 是投影快照，只作对照，不与 P1 合并。

## 10. 负对照（脚本/测试必须能红）

| 编号 | 构造 | 期望 |
|---|---|---|
| N1 | 一条相关帖，探针全部 `unreadable` | tier = `probe-unreadable`；头条分子不变；它**仍在分母** |
| N2 | 一条只有 `unconstrained` 的帖 | tier = `declares-nothing`；头条分子不变 |
| N3 | 运行期帖，点名的包全部 `admitted` | tier = `rules-out-declaration`（不是 `names-a-denial`） |
| N4 | 一条帖两个包：一个 denied、一个 admitted | tier = `names-a-denial`（优先级 1） |
| N5 | 分母为 0 | 比例、Wilson 均为 `null`；**不写 0%** |
| N6 | Wilson 边界（x=0 / x=n / n=10） | 区间落在 `[0,1]`、有序、不越界 |
| N7 | 只有自家包/裸名（`dsh-triage` / `dsh-tools`） | 无探针目标 → `needs-their-profile`；不去 npm |
| N8 | `fetched < totalCount` | **exit 2、零产物** |
| N9 | 首屏 GraphQL 403/429 | **exit 2、零产物** |
| N10 | 同一份 `--fixtures` 复算 | P1 的 rows / counts / tiers 逐项相同 |
| N11 | README 引用 `question-coverage-pilot-*` | `check_listing` 第 14 条判红（试点产物不得当证据） |
| N12 | README 改一个 tier 数字 / 删掉边界句 | `check_listing` 第 14 条判红 |
| N13 | 一条帖只涉及**未点名**的上游包，且被 denied | tier = `upstream-only`；头条分子不变；它仍在分母 |
| N14 | 上游包在帖内**点名了版本**并被 denied | tier = `names-a-denial`（按点名版本判，不按 latest） |

## 11. 产物形状

`data/results/question-coverage-<stamp>.json`（试点：`question-coverage-pilot-<stamp>.json`；复算：`question-coverage-recompute-<stamp>.json`），带 `schema_version` / `produced_by` / `generated_at` / `.sha256`：

```jsonc
{
  "sample": {
    "source": "graphql | fixtures:<dir>",
    "repository": "deepseek-ai/deepseek-harness",
    "cutoff": { "qa_newest_number": 0, "general_newest_number": 0 },
    "qa": { "category_id": "...", "total_count": 0, "fetched": 0, "pages": 0 },
    "general": { "category_id": "...", "total_count": 0, "fetched": 0, "pages": 0 },
    "pilot": false
  },
  "target": { "runtime": "0.2.1-rc.5", "source": "next-dist-tag | argument" },
  "classifier": { "version": 1, "source": "scripts/lib/discussion-triage.mjs" },
  "counts": {
    "qa": { "threads": 0, "relevant": 0, "decidable": 0,
            "by_layer": {}, "by_verdict": {},
            "tiers": { "names-a-denial": 0, "rules-out-declaration": 0, "declares-nothing": 0,
                       "upstream-only": 0, "probe-unreadable": 0, "needs-their-profile": 0, "not-relevant": 0 },
            "probes": { "unique_packages": 0, "attempts": 0, "unreadable": 0, "truncated_threads": 0 } },
    "general": { /* 同形，projection-only */ }
  },
  "coverage": {
    "qa": {
      "headline": { "count": 0, "denominator": 0, "ratio": null, "wilson95": null },
      "tiers": [ { "tier": "names-a-denial", "count": 0, "denominator": 0, "ratio": null, "wilson95": null } ],
      "sensitivity": { "relevant": {}, "decidable": {} }
    },
    "general": { "label": "projection-only", /* 同形 */ }
  },
  "manual_review": {
    "seed": 20261102, "sample_size": 20,
    "sample_numbers": [ 0 ],
    "status": "pending | labelled",
    "agent": null,                       // live measurement: null; 抽检结果在兄弟产物里
    "human_spot_check": { "reviewer": "human", "size": 5, "numbers": [ 0 ], "status": "pending", "agree": null }
  },
  "rows": {
    "qa": [ { "number": 0, "url": "...", "title": "...", "created_at": "...", "category": "Q&A",
              "layer": "...", "verdict": "...", "tier": "...", "packages": [], "probes": [], "truncated": false } ],
    "general": [ /* 同形 + body_sha256 / body_chars；投影快照 */ ]
  },
  "limits": [ "... 6 条边界 ..." ]
}
```

**抽检是兄弟产物**（不手改测量产物）：`data/results/question-review-<stamp>.json`，带 `measurement: { path, sha256 }`、20 条逐条 `classifier` / `reviewer` / `agree`、`agent.agree/total` 与 `human_spot_check`。`--review-only` 会先校验测量产物的 `.sha256`，不匹配就拒绝——**改过的测量产物不能拿来算一致率**。

## 12. 退出码

| 码 | 含义 |
|---|---|
| 0 | 产物写出（含 `--fixtures` 复算） |
| 1 | 读数不成立（例如 M ≠ N 已写入产物？**不允许**：这种情况必须 exit 2 且零产物） |
| 2 | 用法错误 / 读数失败 / 样本不完整 / 试点模式与正式模式混用 |

## 13. 签字

| 项 | 内容 |
|---|---|
| 已签 | 2026-11-02 HUMAN「同意，开始跑」→ §1–§11；同日 R59-S1「第三方 + 上游点名版本」→ §5/§6 修正 |
| 签字后写进 | `audit/SIGNOFF.md` 两行（原话 + 未逐条复核的部分） |
| 不签的后果 | 不跑数据；README 不写覆盖率；T-826/T-827 保持 ⬜ |
| 签字即接受 | **数字不好看也照写**；改口径 = 新开一轮，不许在跑完后调 |
