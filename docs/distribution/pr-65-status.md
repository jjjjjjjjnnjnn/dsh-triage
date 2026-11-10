# 三条渠道 PR 的现状（R93，2026-11-10 实测）

> **这一页解决一个问题**：同一句「PR 卡住了」，三条 PR 的**原因**各不相同，按错的原因去修会做无用功。
> **R93 的事实**：上游在 2026-11-10 把 `community.json` 改成**按 `id` 升序**存放，登记要**插到自己 id 的位置**；
> 维护者 `zhu1090093659` 在 `2026-11-10T05:05:48Z` 于 #65 下留言：他按新结构重建了这个分支（合入当前 `main`、条目插到 id 位置、
> 内容与评审结论没改），要我们 `pull`/`fetch` 后 **merge**，**不要 force push**。
> **实测结论**：我方 fork 分支已经**逐字节等于**「upstream `main` + 我方条目按 id 插入」→ **不需要 push**；
> #65 现在是 `MERGEABLE` + `CHANGES_REQUESTED`（1 条 review，作者是维护者本人），差的是 re-review，不是技术动作。
> **`mergeable_state` 是「谁问」的函数，不是 PR 的属性**（R93 实测）：带 token 读是 `blocked`，匿名读同一 URL 是 `clean`。
> 两种读数都写进产物（`mergeable_state_by_vantage` + `mergeable_state_disagrees`），本页一律标出用的是哪一种。
> #193 已于 `2026-11-04T01:00:47Z` **合并**（merge commit `d944a40e`）；#140 仍是 `OPEN / MERGEABLE / CLEAN`、无 review。
> 全部读数来自两份产物：`data/results/market-channels-2026-11-10T16-35-00.000Z.json`（三条 PR 的 live 字段 + 两种 vantage）
> 与 `data/results/index-sync-2026-11-10T17-30-00.000Z.json`（索引结构对账 + 本地副本出处，脚本 `scripts/record_index_sync.mjs` 产出）。
> 上一版只记了带 token 那一侧（那两份已被下面这两份取代、不再留在 `data/results` 里），本文 §2 的更正就是这么来的。

---

## 1. 实测状态（三条一起看）

| PR | 仓库 | state | mergeable | mergeStateStatus | reviewDecision | reviews |
|---|---|---|---|---|---|---|
| **#65** | `zhu1090093659/dsh-community-plugins` | **OPEN** | **MERGEABLE** | `blocked`（认证侧）/ `clean`（匿名侧）—— 是「谁问」的函数，**不是**「缺一个人类批准」 | **`CHANGES_REQUESTED`** | **1 条**（`zhu1090093659`，维护者本人，`2026-11-05T16:15:37Z`） |
| **#193** | `awesome-deepseekharness/awesome-deepseek-harness` | **CLOSED＝已合并**（`2026-11-04T01:00:47Z`，merge commit `d944a40e`） | 已合并 | 已合并 | `APPROVED` | 见 §7 |
| **#140** | `walkinglabs/awesome-deepseek-harness-plugins` | **OPEN** | **MERGEABLE**（`mergeable_state: clean`） | **CLEAN** | **无**（`review_decision: null`） | **0 条** |

复算命令（任何时候都能自己重读，不需要信这一页）：

```powershell
gh pr view 65  --repo zhu1090093659/dsh-community-plugins --json state,mergeable,mergeStateStatus,reviewDecision,reviews,changedFiles,additions,deletions
gh pr view 193 --repo awesome-deepseekharness/awesome-deepseek-harness --json state,mergedAt,mergeCommit,reviewDecision,changedFiles,additions,deletions
gh pr view 140 --repo walkinglabs/awesome-deepseek-harness-plugins --json state,mergeable,mergeStateStatus,reviewDecision,reviews,changedFiles
```

产物：`data/results/market-channels-2026-11-10T16-35-00.000Z.json`（三条 live 状态 + dsh.so 收录探针）。
**旧读数不再有效**：R53（`live 3 · merged 0`）、R60（`151 entries` / `9/9`）、R76（`152 entries` / `9/9` / `reviews 0 条`）都是各自那天的快照；
`live` 从 3 变 2 是 #193 合并所致（OPEN 的只剩 #65 / #140），不是漂移。

---

## 2. 三条各自卡在哪

### 先看机制：`community.json` 按 `id` 升序，条目插在自己 id 的位置（R93）

`CONTRIBUTING.md` 第 1 步原文：

> "Insert one object into the community.json array at its ascending id position. There is no rank field:
> the array order is the store order..."

同节还写："Prefer an open range such as `>=0.2.1-rc.2 <0.4.0-0` over an exact version or a closed upper bound"。
上游校验器 `scripts/community-index.cjs` 现在**断言升序**，报错原文：

```
community.json: entries must be sorted by id: <a> comes before <b>
```

单测从 9 条变成 **10 条**（`node --test scripts/community-index.test.mjs`）。

**对账结果**（`data/results/index-sync-2026-11-10T17-30-00.000Z.json`，`status: in-sync`）：

| 项 | 读数 |
|---|---|
| 上游 `community.json` | **119 条**（sha256 前缀 `19ddc699f284`） |
| 我方 fork 分支 | **120 条**；`dsh-triage` 在 **idx 101**，prev `dsh-translate` / next `dsh-tui` |
| 用 `scripts/lib/index-order.mjs#insertByEntryId` 把 fork 那条插进 upstream main 重建 | **120 条** · `byte_equal_to_fork: true` · `deep_equal_to_fork: true` |
| 上游 `main` head | `5c9f645a`（`2026-11-10T04:57:39Z`，"test(community-plugins): assert the index stays in ascending id order"） |
| fork head | `b79a17e8`（`2026-11-10T05:05:39Z`，"Merge main into feat/community-plugins-dsh-triage / Insert the index entry at its id position"），与 PR head 一致 |

**结论**：分支已经逐字节等于「`main` + 1 条按 id 插入」。**这一轮不需要 push，尤其不能 force push**——
维护者原话（`2026-11-10T05:05:48Z`，PR #65 下）要求 `pull`/`fetch` 后 **merge**：*"do not force push"*。
force push 会覆盖他的重建，把「逐字节相同」这个唯一剩余的技术优势也弄丢。
（历史：R60 的冲突解法、R76 的「取上游文件逐字节 + 末尾追加一条」都建立在「两边往同一个数组末尾追加」这个前提上；
那个前提在 2026-11-10 被「按 id 升序」取代了，所以那两轮的读数（151 / 152 entries、9/9）只能当历史事实看。）

### #65（community-plugins）——**等 re-review，不欠技术动作**

R93 实测：`OPEN / MERGEABLE`，改动 1 个文件（`community.json`，**+12/-0**），
`review_decision: CHANGES_REQUESTED`，**1 条 review**（`2026-11-05T16:15:37Z`，作者 `zhu1090093659`，即维护者本人）。
分支侧读数（同一份产物）：`community-index: OK (120 entries)`（exit 0）+ `ℹ pass 10 / ℹ fail 0`（`node --test`）。
所以「解冲突 / 追平 main」这两个动作**已经由维护者做完了**（他重建的分支就是 PR head `b79a17e8`）。

**一处必须说清的读数陷阱（R93 复算发现）**：这一行原来写的是 `mergeable_state: blocked` / `mergeStateStatus: BLOCKED`，
而同一时刻**匿名**读同一个 API 是 `clean`。两种都是真读数，差别在**谁问**：带 token 的调用会连带看到 ruleset 里那条
required status check（`community index gate, typecheck, test and build`）与等待中的 review，于是算成 `blocked`；
匿名调用看不到那些依赖，于是算成 `clean`。**合并按钮真正看的是带 token 那一侧**，所以 `mergeable_state` 这个字段
保留认证读数；产物另记 `mergeable_state_by_vantage`（两侧各一）与 `mergeable_state_disagrees`（true），
任何引用这一格的人都能看见「它不是 PR 的固有属性」。`mergeStateStatus` 属 GraphQL 字段，本机只有认证侧读数。
（维护者那条 2026-11-05 的评审同一条 review 至今未 dismiss；ruleset 的 `required_approving_review_count` 是 0，
所以卡住的是 `require_extra_approval_for_unattributed_changes` 与那条 required check，不是「缺一个人类批准」。）

### #193（awesome-deepseek-harness）——**已合并**

`state: closed`、`merged_at: 2026-11-04T01:00:47Z`、`review_decision: APPROVED`、`changed_files 2`、**+2/-0**
（`README.md` + `README.zh.md` 同位置各一行）。merge commit `d944a40e`（用 `gh` 复核过 `state: MERGED`）。经过见 §7。

### #140（walkinglabs）

`OPEN / MERGEABLE（clean）/ CLEAN`、`review_decision: null`、0 条 review、1 个文件 **+1/-0**。
和 R76 同一个形状：技术上随时可合，缺的是人看一眼。

### 评审的五点（#65 唯一那条 `CHANGES_REQUESTED`）逐条现状

| # | 评审点 | 现状（R93，2026-11-10） |
|---|---|---|
| ① | 条目可收，但与 `main` 冲突 | **已解决**：R93 实测 `MERGEABLE`、无冲突；维护者重建的 `b79a17e8` 与「main + 1 条按 id 插入」**逐字节相同** |
| ② | 兼容性希望补**实测结论**，或写进已知边界 | **未处理（本轮不动）**：`engines.dsh` 仍是 `>=0.2.0-rc.1 <0.3.0-0`，实测只有「0.2.1-rc.4（Windows）」一条；补测量或写边界属声明面，需单独一轮 |
| ③ | 建议把上界放宽到 `<0.4.0-0` | **未处理（本轮不动）**：会牵动 **277 处 `0.3.0-0` 字符串**与 client-tab 对 `inject` 的断言，属声明面 |
| ④ | `inject` 里的 `@deepseek-ai/dsh-api-remotes` 正文没用到，补用途或去掉 | **技术上成立，未改**：`packages/plugin/client.js` 实际只 `inject ['slots','locale','modules']`，数据走 `fetch('/compat-triage/summary')`；改动要连带测试与 spec，同样单独一轮 |
| ⑤ | 文案边界（`fix --apply` 会改 profile 的 `compatibility.json`） | **分支上已经是新文案**：中文「只读展示当前组合。不安装、不卸载、不判安全。」英文 "It never installs, never removes, and never claims a plugin is safe." 两处都在 `b79a17e8` 的 `community.json` 里（PR diff 的 +12 行就是这个版本）。**一处自纠**：R93 首版把这事写成「已改好」并引用我们 docs 里的副本，而那份副本当时还带着「不安装到你的 profile」的旧措辞——两处文案本就不是同一句（`index-sync` 复算指出差异键是 `description` 与 `descriptionEn`）；docs 副本已在 `2026-11-10T16:30` 的产物里与分支**逐字一致**（`identical_to_fork_entry: true`） |

---

## 3. 合并了会改变什么（以及不会改变什么）

**会变**：M4 的出口门禁是「渠道收录」，`scripts/record_market_channels.mjs` 的 `merged` 计数已经因为 #193 从 0 变成 **1**，
`docs/market/` 下的上架状态可以从「已提交未收录」改成「已收录」。

**不会变**：**D5 的任何一项**。D5 的三个数是 `#11813` 的 reactions、GitHub search 找到的外部引用、市场基线的周下载；
「被一个 awesome-list 收录」不在其中（`docs/specs/D5-measurement.md` §1）。
同理，`docs/distribution/channels.json` 里也没有任何一条把这些 PR 记成 `d5_counts: true`。

**换句话说**：PR 合并是分发面的事，不是需求证据。11-15 的判定不会因为它变化。

---

## 4. 不许做的四件事

1. **不要为了「让它动起来」再 push**：前提是分支已与 `main` 逐字节一致、且 PR 已经 `MERGEABLE`（R93 实测就是）。
   这时重新推送只会刷新 `updatedAt`，不产生 review。只有当实测是 `CONFLICTING/DIRTY` 时才轮到「重建」——先看字段，再决定。
2. **不要 force push**（R93 新增）：维护者已按新结构重建分支、并要求 `pull`/`fetch` 后 merge；
   force push 会覆盖他的提交，**毁掉**「fork = main + 1 条」这个已经证明过的状态。
3. **不要改条目内容去换合并**（R60 已定的口径）：冲突只能靠重建解，内容只能靠上游要求改；
   ②③④ 是声明面改动，按上游原文单独一轮处理，不在「求合并」的借口下动。
4. **不要刷评论催**：每条 PR 只留**一次**礼貌的 review 请求，之后等。重复 ping 是这类仓库最常见的拉黑理由。
   R76 于 2026-11-03 发过一条（`issuecomment-6607329040`）；R93 发的那条（`6771980461`，2026-11-10T15:49:44Z）**不是催**——它回答的是维护者 11-10 的索引结构变更（分支已逐字节等于「main + 1 条」、我们不需要 push），
   顺带把 11-05 评审剩下几点的现状说清楚。**从那以后不要再发第二句**，除非维护者先回。

---

## 5. 评论稿（**已发 · 2026-11-10T15:49:44Z**）

R76 于 2026-11-03 发过一条（`issuecomment-6607329040`）。R93 的两条 PR 事实（分支逐字节等于「main + 1 条按 id 插入」、
上游校验器 `OK (120 entries)` + 10/10）拿到 HUMAN 的「全部同意」后，把重写稿发了出去：

| 项 | 值 |
|---|---|
| 评论 URL | https://github.com/zhu1090093659/dsh-community-plugins/pull/65#issuecomment-6771980461 |
| comment id | `6771980461` |
| `created_at` | **2026-11-10T15:49:44Z** |
| 作者 | `jjjjjjjjnnjnn` |
| 长度 | 896 字符 |
| 复核命令 | `gh api repos/zhu1090093659/dsh-community-plugins/issues/comments/6771980461 --jq '{id, created_at, user: .user.login, len: (.body|length)}'` |

发出前先读了帖子状态（`scripts/record_discussion_state.mjs` 的口径：写之前先确认它还开着、且没有结论），
`state: open` / 未合并 / head 仍 `b79a17e8`。**这是我们对自家 PR 的同步说明，不是 R58 那三条「暂不发」的外部回帖**，
两件事别记混：`docs/distribution/T-810/registry.json` 记的是那三条外站帖子，`#65` 这条在 GitHub 上、贴的是我们自己的提交。

已发正文（中文，896 字符，与 GitHub 上的逐字一致）：

> 感谢重建，我这边确认同步情况（不发新 push）：
> 
> - 分支 head `b79a17e8` 与「当前 main + 我方一条按 id 插入」**逐字节相同**：120 条，条目在 **idx 101**（`dsh-translate` 之后、`dsh-tui` 之前）。做法是按同一条插入规则从 main 重建，然后比对**字节**（不是比 JSON 相等）。
> - 用分支的原始字节跑仓库自带的 `scripts/community-index.cjs --check` → `community-index: OK (120 entries)`，`scripts/community-index.test.mjs` 10/10 通过。另外做了三条负对照（改回末尾追加 / 对调 100 与 101 / 还原），分别按预期红→绿，说明这个绿不是空转出来的。
> - 结论：**我这边没有要推的东西，也不会 force push**。你的重建没有被我碰过，等你 re-review 就好。
> 
> 11-05 评审里剩下的几点，顺手说一下现状（都不阻挡这条合并）：
> 
> - 措辞那条（描述里「真装真启动」与同句「不安装」读起来打架）：分支里已经是改准的版本 ——「只读展示当前组合。不安装、不卸载、不判安全。」/ "It never installs, never removes, and never claims a plugin is safe."，PR 的 +12 行就是这版。
> - 上界放宽到 `<0.4.0-0`、以及 `inject` 里 `@deepseek-ai/dsh-api-remotes` 的用途：这两处要动 `engines.dsh` 与注入声明，会牵动仓内多处同一个版本字符串和注入断言，我想单独提一个 PR 来改，不塞进这条条目 PR。你要是希望合并前就一起改，回一句我就在这条 PR 上补。
> - 兼容性实测：真机目前只有 0.2.1-rc.4（Windows）一条，没测过的版本我不会写进声明；rc 下一版出来我补测再调区间。
> 
> 不着急，等你有空 re-review。

**为什么不发英文**：这个仓库的维护者用中文留言（11-10 那条就是中文），用他写评论的语言更省他一次翻译；
条目本身的 `description` / `descriptionEn` 仍是双语，没有因为评论语言改变任何上架文案。

**什么时候放弃**：如果 2026-11-15 之后 #65 仍无 review，就把它记成「外部不可控」，写进交接，不再投入。
三条 PR 都不是我们的技术债——合并权在别人手里（R45 起一直这么记）。

---

## 6. 和 D5 的关系（一句话）

这条线**不进** D5 的分子，也**不该**被用来解释 D5 的结果。
如果 11-15 判 `fail`，正确结论是「这个形态在这个生态里没有被需要」，
不能写成「因为 PR 没合并所以没人用」——那是在给一个已经被证伪的假设找台阶。

---

## 7. #193 的经过（R75）与两条决定

**经过（全部可复算）**：

1. 维护者留言（2026-11-03）：*"Thanks for the submission! The repo checks out (MIT, dsh-plugin topic). One thing before merge: the list is bilingual, so please add the matching row to README.zh.md at the same position (see CONTRIBUTING.md). Ping me once it's up and I'll merge right away."*
2. 我们做的事：在 `README.zh.md` 的**同一张表、同一位置**（`lengrufeng2008/dsh-code-intel` 之后）加一行中文；顺带把星数从 `0` 改成当前 **1**（`CONTRIBUTING.md` 要求「别用 0，除非真的是 0」）。
3. **分支当时已经 `CONFLICTING/DIRTY`**（43 个提交落后上游）→ rebase 到 `upstream/main` 之上，冲突只在我们那一行，解法是**保留上游新增的 4 行 + 追加我们那一行**。
4. 推送后实测：`MERGEABLE / CLEAN`，`curate` 检查 **pass**（它正是「两份 README 都要有」的那道检查）。
5. 按维护者的话留了**一次**回复（不重复催）。
6. **R93 复核：已合并**——`merged_at: 2026-11-04T01:00:47Z`，merge commit `d944a40e`，`changed_files 2`、**+2/-0**（`market-channels-2026-11-10T16-35-00.000Z.json`）。

**决定一**：这条渠道**已结案**（`merged` 才算收录）。#65 与 #140 仍只能写「已提交 / 待审」。
