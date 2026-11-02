# 发帖 runbook（T-810 的三条回帖）

> **谁用**：把 `06` / `07` / `08` 从 `draft` 变成 `posted` 的人（或 agent）。
> **为什么要有这一页**：草稿写完之后隔几天才发，中间会变的东西至少有三样——帖子可能已经被别人答了、
> `dist-tag` 可能已经被 retag、包里引用的产物可能被新一轮取代。R56 的教训是**登记错一个字符就会悄悄挪动 D5 的窗口**；
> R53 的教训是**对外文案里的数字没人核就会僵**。
> **本页不是判据**：它只规定「发之前必须重新读什么」和「发完必须回填什么」。

---

## 0. 一句话

**先读状态，再读会漂的数，最后粘贴；发完回填 `registry.json`，再跑一次 `check_listing`。**

```powershell
# 1) 三条帖子还开着吗（没被回答 / 没被关闭）
node scripts/record_discussion_state.mjs --ids 8202,10849,11687

# 2) 会漂的数字（只有 07 依赖它）
npm view @deepseek-ai/dsh-mcp-client dist-tags

# 3) 发完回填 registry.json 后
node scripts/check_listing.mjs --stamp <ISO> --tests <n>
```

---

## 1. 每条发之前要确认的三件事

| 草稿 | ① 帖子状态 | ② 会漂的数 | ③ 粘贴块完整性 |
|---|---|---|---|
| `06` #8202 | `open`（`record_discussion_state --ids 8202`） | `@deepseek-ai/dsh-mcp-client@0.1.0-rc.7` 是**已发布且不可变**的版本，不需要重读 | 粘贴块里 6 条 `^0.1.0-rc.7` 与两个 URL |
| `07` #10849 | `open`（`--ids 10849`） | **`latest` / `next` 必须重读**：整篇的前提是 `latest = 0.0.1-rc.1`。**一旦被 retag，这篇不要发**（改成讲「已被修正」也不是我们该说的话） | 粘贴块里 4 条 `^0.0.1-rc.1` 与两个 URL |
| `08` #11687 | `open`（`--ids 11687`）；**如果有人已经给了结论，不发** | `0.4.13` / `0.28.2` 不可变；`@deepseek-ai/dsh-desktop` 仍不在 npm（`unreadable`） | 粘贴块里 `等 13 项` 与那条「判不了」的句子 |

**状态判读**（`record_discussion_state` 的四档）：

- `open` → 可以发；
- `answered` → **不发**。别人已经给了答案，我们再贴一份只会稀释信息；
- `closed` → 发不了；
- `unreadable` → **不许**当成 `open`。读不到就重试或换个方式读（token / 限额），不要靠记忆。

---

## 2. 怎么发

1. 打开草稿里的 `<!-- paste:start -->` … `<!-- paste:end -->` 之间那段，**整段复制**；
2. 不要复制本页其它内容（`## 数值来源` 那些是给我们自己核账用的）；
3. 粘贴前把末尾两个 `https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/...` 打开一次——**打不开就不要发**（产物被改名/归档的情况必须发现，不能靠「应该还在」）；
4. 粘贴后检查：代码块有没有被论坛吃掉、`^` 有没有被转义成别的东西。

---

## 3. 发完必须回填（这一步不做，D5 的窗口就是假的）

`docs/distribution/T-810/registry.json` 里对应条目：

```json
{
  "file": "07-reply-10849-dist-tag.md",
  "status": "posted",
  "posted_url": "https://github.com/deepseek-ai/deepseek-harness/discussions/10849#discussioncomment-XXXXXXX",
  "posted_on": "2026-11-0XTXX:XX:XX+01:00"
}
```

**三条硬规则**（`scripts/lib/posting.mjs` + 第 13 条断言会验）：

1. `posted_on` 必须是**带时区的 ISO instant**：`Z` 或 `±hh:mm` 都行，**裸日期不行**；
2. URL 的域必须和 `channel` 声明的平台一致（GitHub 讨论帖就写 GitHub 的 URL）；
3. `status: draft` 的条目不写 URL。**不要**为了「先填上」而把 `status` 留在 `draft` 又写 URL。

> **本机是 UTC+1**（R64 坑）：`2026-11-03T09:30:00+01:00` 与 `08:30Z` 是同一个时刻，写成 `09:30Z` 会把 D5 窗口悄悄挪早一小时。
> 拿不准就写 `+01:00`。

回填后跑：

```powershell
node scripts/check_listing.mjs --stamp <ISO> --tests <n>
```

`posted-drafts-carry-a-date` 与 `draft-claims-match-their-artifact` 都必须绿。

---

## 4. 不许做的事

- **不许改条目内容换合并 / 换答案**（R60 定过的口径：PR 冲突只能 rebase，不能改内容）；
- **不许在已答帖下重复发**；
- **不许**把「声明层放行」写成「升级会修好」「装了就没事」——`08` 是反向回答，最容易被读错的那一条；
- **不许**在正文里放个人身份（邮箱 / 微信 / 个人主页）；用项目口吻；
- **不许**把这三条回帖当成 D5 的「达标手段」来批量灌：D5 数的是 `#11813` 的 reactions 与外部引用，刷帖既违反口径也违反铁律 3。

---

## 5. 和 D5 的关系（一句话）

这三条回帖**不直接计入 D5 的 reactions**（D5 只数 `#11813` 那一个 discussion），它们的价值是**真实接触**：
把结论放回有人在卡的地方，才可能换来「外部引用 ≥1」这一项。
如果三条都发了、11-15 关窗时外部引用仍是 0，那本身就是一条要如实记录的结果。
