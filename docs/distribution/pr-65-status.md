# 三条渠道 PR 的现状（R74，2026-11-02 实测）

> **这一页解决一个问题**：外部转述说「PR #65 仍处于冲突状态，需要解冲突」。**实测不是。**
> 冲突在 R60 就解掉了，现在卡的是**没有人 review**。这个区别很重要——按错的原因去修，会做无用功。

---

## 1. 实测状态（三条一起看）

| PR | 仓库 | state | mergeable | mergeStateStatus | reviewDecision | reviews |
|---|---|---|---|---|---|---|
| **#65** | `zhu1090093659/dsh-community-plugins` | OPEN | **MERGEABLE** | **BLOCKED** | `""`（无决定） | **0 条** |
| #193 | `awesome-deepseekharness/awesome-deepseek-harness` | OPEN | MERGEABLE | CLEAN | APPROVED | 1（**bot**） |
| #140 | `walkinglabs/awesome-deepseek-harness-plugins` | OPEN | MERGEABLE | CLEAN | `""` | 0 |

复算命令（任何时候都能自己重读，不需要信这一页）：

```powershell
gh pr view 65  --repo zhu1090093659/dsh-community-plugins --json state,mergeable,mergeStateStatus,reviewDecision,reviews
gh pr view 193 --repo awesome-deepseekharness/awesome-deepseek-harness --json state,mergeable,mergeStateStatus,reviewDecision,reviews
gh pr view 140 --repo walkinglabs/awesome-deepseek-harness-plugins --json state,mergeable,mergeStateStatus,reviewDecision,reviews
```

---

## 2. 三条各自卡在哪

### #65（community-plugins，唯一 `BLOCKED` 的那条）

- `mergeable: MERGEABLE` → **没有冲突**。R60 从 `upstream/main` 重建分支、只 cherry-pick 那一行 `+12/-0`，
  force-with-lease 推回后状态就从 `CONFLICTING/DIRTY` 变成了 `MERGEABLE/BLOCKED`。
- `mergeStateStatus: BLOCKED` + `reviewDecision: ""` + `reviews: []` → **被告知需要 review，而至今没有一条**。
- 改动面：1 个文件、`+12/-0`（只在 `community.json` 里追加一个条目，没有动别人的行）。

**所以：再 rebase 一次不会让它合并，也不会让它变绿。**它缺的是人。

### #193（awesome-deepseek-harness）

`reviewDecision: APPROVED` **看起来**已经过了——但那条 review 来自 `sourcery-ai`，`authorAssociation: NONE`，
是自动化评审机器人，不是维护者。这类批准通常不满足「需要人类 review」的分支保护，所以它仍然 `OPEN`。
**别把 `APPROVED` 读成「快要合了」。**

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

1. **不要为了「让它动起来」再 rebase**：`MERGEABLE` 已经成立，rebase 只会刷新 `updatedAt`，不产生 review。
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
