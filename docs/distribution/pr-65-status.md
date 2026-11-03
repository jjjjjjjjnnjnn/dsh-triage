# 三条渠道 PR 的现状（R75，2026-11-03 实测）

> **这一页解决一个问题**：同一句「PR 卡住了」，三条 PR 的**原因**各不相同，按错的原因去修会做无用功。
> **R75 的变化**：#193 的维护者给了**人类回复**并开出合并条件（补 `README.zh.md` 一行）——已补齐、已 rebase，现在 `MERGEABLE/CLEAN`；
> 而 **#65 又变回 `CONFLICTING/DIRTY`**（上游 `main` 又动了），R74 写的「别再 rebase，它不是冲突」**对今天不再成立**。

---

## 1. 实测状态（三条一起看）

| PR | 仓库 | state | mergeable | mergeStateStatus | reviewDecision | reviews |
|---|---|---|---|---|---|---|
| **#65** | `zhu1090093659/dsh-community-plugins` | OPEN | **CONFLICTING** | **DIRTY** | `""`（无决定） | **0 条** |
| **#193** | `awesome-deepseekharness/awesome-deepseek-harness` | OPEN | **MERGEABLE** | **CLEAN** | APPROVED | 1（**bot**；但**人类** contributor 已给合并条件并说「up 了就合」） |
| #140 | `walkinglabs/awesome-deepseek-harness-plugins` | OPEN | MERGEABLE | CLEAN | `""` | 0 |

复算命令（任何时候都能自己重读，不需要信这一页）：

```powershell
gh pr view 65  --repo zhu1090093659/dsh-community-plugins --json state,mergeable,mergeStateStatus,reviewDecision,reviews
gh pr view 193 --repo awesome-deepseekharness/awesome-deepseek-harness --json state,mergeable,mergeStateStatus,reviewDecision,reviews
gh pr view 140 --repo walkinglabs/awesome-deepseek-harness-plugins --json state,mergeable,mergeStateStatus,reviewDecision,reviews
```

---

## 2. 三条各自卡在哪

### #65（community-plugins）

**R75 实测：它又变回 `CONFLICTING/DIRTY` 了**（R74 时是 `MERGEABLE/BLOCKED`）。上游 `main` 在这两天里动过，
我们那一行 `community.json` 与新版文件冲突。**R74 写的「别再 rebase，它不是冲突」对今天不成立**——今天它真的是冲突。

- 改动面：1 个文件、`+12/-0`（只在 `community.json` 里追加一个条目，没有动别人的行）。
- 但 `reviewDecision: ""` + `reviews: []` 没变：**就算 rebase 回 `MERGEABLE`，它仍然缺一条人 review**。

**所以：rebase 是必要条件，不是充分条件。**要不要再花一次动作，见 §7 的决定。

### #193（awesome-deepseek-harness）——**R75 有真人回复**

维护者 `hdjekuue`（`CONTRIBUTOR`）在 PR 下留言（原文见 §7），内容两条：**仓库检查通过**（MIT、`dsh-plugin` topic），
**只差 `README.zh.md` 同位置的一行**，补上就合。这不是「请求变更」的坏消息，而是一条**可执行的合并条件**。

仍然要分清两件事：`reviewDecision: APPROVED` 这条**正式 review 依旧来自 `sourcery-ai`（bot）**；
人类给的是**评论里的承诺**，不是 review 按钮。所以「合并概率高」与「已经通过 review」不是同一句话。

### #140（walkinglabs）

`MERGEABLE / CLEAN`、零 review。和 #65 同一个形状：技术上随时可合，缺的是人看一眼。

---

## 3. 合并了会改变什么（以及不会改变什么）

**会变**：M4 的出口门禁是「渠道收录」，`scripts/record_market_channels.mjs` 的 `merged` 计数会从 0 变成 1+，
`docs/market/` 下的上架状态可以从「已提交未收录」改成「已收录」。

**不会变**：**D5 的任何一项**。D5 的三个数是 `#11813` 的 reactions、GitHub search 找到的外部引用、市场基线的周下载；
「被一个 awesome-list 收录」不在其中（`docs/specs/D5-measurement.md` §1）。
同理，`docs/distribution/channels.json` 里也没有任何一条把这些 PR 记成 `d5_counts: true`。

**换句话说**：PR 合并是分发面的事，不是需求证据。11-15 的判定不会因为它变化。

---

## 4. 不许做的三件事

1. **不要为了「让它动起来」再 rebase**：**前提是它已经 `MERGEABLE`**。已经 `MERGEABLE` 时 rebase 只会刷新 `updatedAt`，不产生 review；
   但如果实测是 `CONFLICTING/DIRTY`（#65 在 R75 就是），那 rebase 是**唯一**能让它重新可合的动作——先看字段，再决定。
2. **不要改条目内容去换合并**（R60 已定的口径）：冲突只能靠 rebase 解，内容只能靠上游要求改。
3. **不要刷评论催**：每条 PR 只留**一次**礼貌的 review 请求，之后等。重复 ping 是这类仓库最常见的拉黑理由。

---

## 5. 唯一值得做的一件事（一次，之后等）

在 #65 留一条**一次性的**、说明「已 rebase 到最新 main、`community-index.cjs --check` 通过、
9 条测试全过、改动只有一行」的评论，然后不再跟进。模板：

> Hi — the branch is rebased onto the latest `main` and the only change is one appended entry in
> `community.json` (+12/-0). `community-index.cjs --check` reports 151 entries OK and the repo's own
> test suite passes 9/9. No rush — just flagging it in case it fell through. Thanks!

**什么时候放弃**：如果 2026-11-15 之后 #65 仍无 review，就把它记成「外部不可控」，写进交接，
不再投入。三条 PR 都不是我们的技术债——合并权在别人手里（R45 起一直这么记）。

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

**决定一**：等合并，不再动作。`merged` 才算收录；在那之前 `T-601` 仍只能写「已提交」。

**决定二**：#65 的 `CONFLICTING` 是**新事实**，与 R74 的判断不同。**下一轮**（不晚于 2026-11-15）做一次 rebase 并用它自己的校验器复验；
如果 rebase 后仍无 review，就按 §5 的放弃条件记成「外部不可控」，不再投入。**这一轮不动它**，因为本轮的动作已经给了 #193。
