# 分发渠道 · 提交包（submissions）

> **状态（R96，2026-11-11 实测）**：`validated 1` · `ready 3` · `live 2` · `site 1`（dsh.so 已收录 = `listed`）· `merged 1`。证据：`data/results/market-channels-2026-11-11T20-40-00.000Z.json`（`submitted[]` 是三条 PR 的**实时**状态；`site_submissions[]` 是 dsh.so 的提交记录 + 收录探针）。**`live` 从 R53 的 3 变成 2 不是漂移**：`#193` 已于 2026-11-04T01:00:47Z 合并（merge commit `d944a40e`），OPEN 的只剩 `#65` 与 `#140` → `merged` 由 0 变 1、`live` 由 3 变 2，两个数要一起读。R53 的旧快照 `data/results/market-channels-2026-11-01T09-40-00.000Z.json`（当时是 `live 3 · merged 0`）与 R45 的 `data/results/market-channels-2026-10-29T10-00-00.000Z.json` 原样保留，**它们只是历史读数，不是现状**。
> **npm**：`dsh-triage@0.3.8`（四包同版本，**已发布**，`latest=0.3.8`；匿名安装 + CLI + `import()` + `client.js` 四项取证见 `data/results/publish-2026-11-09T15-55-00.000Z.json`，18/18 · `git_dirty=false`）。上一版 `0.3.3` 的匿名安装 **21/21** 取证见 `data/results/publish-2026-11-02T15-54-38.303Z.json`（`git_dirty=false` / `head 0ad06c7`，含 `client-bundle`）；`0.3.2` 见 `data/results/publish-2026-11-02T14-24-39.944Z.json`（20/20）；`0.3.1` 见 `data/results/publish-2026-11-01T18-00-00.000Z.json`。**发布链的一个真缺陷**：取证紧跟 publish 时会撞上 npm 读副本滞后（约 4.5 分钟），五分钟内产出三份假红 → 已改成带预算的等待（`scripts/lib/registry-wait.mjs`）。
> **索引源已在真实公开 URL 上**：`data/results/index-hosting-2026-10-29T22-00-00.000Z.json`。

## 已提交的三条（R93 实测：`live 2` · `merged 1`）

| 渠道 | PR | 状态 | diff |
|---|---|---|---|
| **dsh-community-plugins**（dsh-market Workshop 的唯一真相源） | https://github.com/zhu1090093659/dsh-community-plugins/pull/65 | **OPEN · MERGEABLE**（`CHANGES_REQUESTED`，等 re-review；无冲突）｜`mergeable_state` 认证读 **`blocked`** / 匿名读 **`clean`**（vantage，见 R93 说明第 4 段） | `community.json` **+12 / -0**（**120 entries**；我方条目在 **idx 101**，prev `dsh-translate` / next `dsh-tui`；上游校验器在我们分支的字节上重跑：`community-index: OK (120 entries)` + `node --test` **10 pass / 0 fail**）。分支 = `main` + 1 条按 id 插入、**逐字节相同**（`index-sync-2026-11-10T17-30-00.000Z.json`，见下方 R93 说明） |
| **awesome-deepseekharness/awesome-deepseek-harness** | https://github.com/awesome-deepseekharness/awesome-deepseek-harness/pull/193 | **MERGED**（2026-11-04T01:00:47Z，merge commit `d944a40e`） | `README.md` + `README.zh.md`：`changed_files 2` · **+2 / -0**（R93 产物记 `review_decision: APPROVED`；补 `README.zh.md` 同位置一行的经过见 `docs/distribution/pr-65-status.md` §7） |
| **walkinglabs/awesome-deepseek-harness-plugins**（R45 新提） | https://github.com/walkinglabs/awesome-deepseek-harness-plugins/pull/140 | **OPEN · MERGEABLE · CLEAN**（无 review，`review_decision: null`；读数来自 R93 产物） | `README.md` **+1 / -0**（Developer Tooling 段，字母序 `dsh-tool-approval` → `dsh-triage` → `dsh-verify`） |

**R96 复读：`closed` 不等于「被拒」，而 `merged` 也不等于「已上线」。** GitHub 对已合并的 PR 回 `state: closed`（`merged_at` 才有意义），所以那一栏写的是 API 的字面值。真正要去问的是**条目有没有落到上游主干上**（2026-11-11 实测，`raw.githubusercontent.com` 的上游 `main`）：

| 渠道 | 上游主干里有没有 `dsh-triage` | 结论 |
|---|---|---|
| `awesome-deepseekharness/awesome-deepseek-harness` | ✅ `README.md` 第 215 行有那一行（`README.zh.md` 同样有） | **已上线**，`#193` 的合并不是「关掉」 |
| `zhu1090093659/dsh-community-plugins` | ❌ `community.json` 没有 `dsh-triage` | **未上线**，`#65` 仍在等 review |
| `walkinglabs/awesome-deepseek-harness-plugins` | ❌ `README.md` 没有 `dsh-triage` | **未上线**，`#140` 零 review |

这次复读**不改任何渠道状态**（产物里的 `summary` 仍是 `live 2`），它只是把「PR 状态」翻译成「读者能不能在那边看到我们」。

> **R60 已 rebase #65**：从 `upstream/main` 重建干净分支，只 cherry-pick 新增 `dsh-triage` 条目（**+12/-0**，别人的条目一个没动），丢掉一个纯逗号格式化的提交；上游 `community-index.cjs --check` **OK（151 entries）**、`node --test` **9/9**（这两条是 R60 当天的读数，**已被 R93 取代**，现行 120 entries / 10 条单测）；force-with-lease 推回后 PR 从 **`CONFLICTING/DIRTY`** 变成 **`MERGEABLE`**（当天的 `mergeable_state` 读数记的是 `blocked`——**R93 复算指出这个字段取决于「谁问」**：认证侧看到 ruleset 的 required check 才算 `blocked`、匿名侧算 `clean`，详见下方 R93 说明）；**不是冲突**；`merged: 0` 未变（合并仍由维护者决定）。
>
> **R93（2026-11-10）索引结构改了，R60/R76 的这组读数已过期**：上游把 `community.json` 改成**按 `id` 升序**存放，登记要**插到自己 id 的位置**（`CONTRIBUTING.md` 第 1 步原文 "Insert one object into the community.json array at its ascending id position. There is no rank field: the array order is the store order..."；同节还写 "Prefer an open range such as >=0.2.1-rc.2 <0.4.0-0 over an exact version or a closed upper bound"），校验器新增升序断言（报错原文 `community.json: entries must be sorted by id: <a> comes before <b>`），单测从 9 条变成 **10 条**。维护者 `zhu1090093659` 在 2026-11-10T05:05:48Z 于 PR #65 下留言：他按新结构重建了这个分支（合入当前 `main`、条目插到 id 位置、内容与评审结论没改），要求我们 `pull`/`fetch` 后 **merge**，**不要 force push**。实测（`data/results/index-sync-2026-11-10T17-30-00.000Z.json`，`scripts/record_index_sync.mjs` 产出）：`status: in-sync`；上游 `community.json` **119 条**（sha256 前缀 `19ddc699f284`）；fork 分支 **120 条**，我方条目 **idx 101**（prev `dsh-translate` / next `dsh-tui`）；把 fork 里那条按 `scripts/lib/index-order.mjs#insertByEntryId` 插回 upstream main 重建 → **120 条**、`byte_equal_to_fork: true`、`deep_equal_to_fork: true`。**结论：fork 分支 = `main` + 1 条按 id 插入、逐字节相同 → 这一轮不需要 push，尤其不能 force push。** 两个 head：上游 `main` `5c9f645a`（2026-11-10T04:57:39Z，提交 "test(community-plugins): assert the index stays in ascending id order"），fork `b79a17e8`（2026-11-10T05:05:39Z，"Merge main into feat/community-plugins-dsh-triage / Insert the index entry at its id position"），与 PR head 一致。现行读数见上面的表格。
>
> **R93 复算补记（vantage）**：`mergeable_state` 不是 PR 的固有属性，是「**谁问**」的函数——带 token 读 #65 得 `blocked`（能看到 ruleset `main-branch-policy` 的 required check `community index gate, typecheck, test and build` 与待审 review），匿名读同一个 URL 得 `clean`（看不到那些依赖）；`mergeable: true` 两侧一致。对照：#140 两侧都 `clean`、#193（已合并）两侧都 `unknown`。所以产物里 `submitted[].mergeable_state_by_vantage = {authenticated, anonymous}` + `mergeable_state_disagrees` 两侧都记，单独一格 `mergeable_state` 不足以描述它。
> **同一次复算还改了 `entry` 的出处**：脚本插的是 **fork 分支里的条目**（不是本地副本），产物现在写 `entry.taken_from`（分支名）+ `entry.local_copy.identical_to_fork_entry`。首版把 `docs/market/submissions/community-plugins-entry.json` 的来源写成了「就是这一条」，而那份副本当时仍是旧措辞（`It never installs into your profile…`，分支是 `It never installs, never removes…`，差 `description` / `descriptionEn` 两个键）；副本现已逐字对齐（`identical_to_fork_entry: true`）。

**为什么这三条能提出来**：仓库在 2026-10-29 由 HUMAN 决定转 public（`gh repo edit --visibility public`），
raw URL 立刻可读（`docs/market/index.json` 2116B，与仓内副本逐字节一致）；R45 另给仓库补上 `dsh-plugin` 等 topics（该列表的 CONTRIBUTING 要求「plugin 仓库建议带这个 topic」）。

## 其余渠道

（上表那次「条目有没有落到上游主干」的复读，命令是 `curl -s https://raw.githubusercontent.com/<repo>/main/<file> | grep dsh-triage`，2026-11-11。）

| 渠道 | 入口 | 状态 | 说明 |
|---|---|---|---|
| **dsh-market（Workshop 商店）** | 由 community-plugins 生成 | `ready-after-channel-1` | 第一条 PR 合并后自动出现在商店 |
| **dsh.so** | 站点表单（无 API） | ✅ **已收录（`listed`）** | 2026-10-29 由 HUMAN 提交，`registry.indexedAt = 2026-10-29T09:49Z`；R45 探测时三个 per-plugin 端点还是 404（那时如实记 `submitted`），**R53（2026-11-01）三个端点全部 200**，所以现在记 `listed`。内容（**R96 复读 2026-11-11**）：`verification.level = L5 · Run tested`（**当前运行时 `0.2.2-rc.1` `passed`**，依据记录是它用自己的 `sourceRecordId` 标的「构建 `0.3.5` + 运行时 `0.2.2-rc.1`」（`checkedAt 2026-11-10T17:24:48.837Z`）；另有 0.2.1-rc.5 `passed`、0.2.1-rc.3 `unknown`）、`security.status = audited`、`riskLevel = low`（0 Critical / 0 Warning / **2 Info**，扫了 3 个文件）。**两条边界**：① L5 是 dsh.so 在它自己的干净沙盒里的一次实测，**不是**「在你的机器上能用」（`BS-06`）；② 它页面上的安装行仍是 **`0.3.5`**（`install.command`），要等它自己重新索引到 `0.3.7` —— 那是它的排期，不是我们的动作。 |

## dsh.so 实测记录（R45，2026-10-29）

**提交前的检查**（仓库 URL）：

```
✓ 仓库公开且活跃      ✓ 已找到 README
! 找到许可证文件，但无法确定 SPDX 标识     ← 已修
✓ 找到 DSH cordis 清单  ✓ 名称可生成合法 id
安全扫描：通过 · 0 Critical / 0 Warning / 0 Info
       已扫描文件 0 · 达到扫描预算（150 个文件），未检查全部文件
```

**两处处置**：

1. **SPDX**：根 `package.json` 原先没有 `license` 字段（只有 `packages/*` 有 MIT），而它读的是仓库根清单。已加 `"license": "MIT"`（根仍是 `private: true`，`LICENSE` 与所有发布包都是 MIT）。
2. **扫描 0 文件**：不是源码不可扫——本仓 827 个 tracked 文件里 309 `.json` + 232 `.sha256` + 112 `.md`（`data/results` 460 个是带 sha256 的证据产物），150 文件预算在 `data/` 与 `docs/` 就用完了，`packages/`/`scripts/` 的 85 个 `.ts` 没轮到。**若要真扫源码，改走 npm tarball**（`files` 只有 `dist/` + `client.js` + `cordis.patch.yml` + `README.md`）。

**提交后**：HUMAN 于 2026-10-29 通过站点表单提交（`--site dsh.so=human`）。R45 那天的产物里 `site_submissions[0].indexed = false`，三个端点全部 `http_status: 404`——那是「还没收录」，不是「被拒」。

**R53 复核（2026-11-01，`data/results/market-channels-2026-11-01T09-40-00.000Z.json`）**：三个端点现在全部 **200**，且正文是真数据（不是空壳），所以状态从 `submitted` 变成 **`listed`**：

| 字段 | 值 |
|---|---|
| `registry.indexedAt` | `2026-10-29T09:49Z`（提交当天就建了条目，比我们的探测晚） |
| `verification` | `level 5` · `L5 · Run tested`；`0.2.1-rc.5` `passed`（`2026-10-31T02:29Z`），`0.2.1-rc.3` `unknown` |
| `security` | `audited` · `riskLevel: low` · 0 Critical / 0 Warning / 1 Info |
| `install.command` | 站点自己记的安装行仍是 **`0.3.5`**（它还没重新索引到 `0.3.7`；R96 复读 2026-11-11） |

**两条不许越界的读法**：① `L5` 是 dsh.so 在**它自己的干净沙盒**里跑的一次结果（`BS-06`），不能读成「在你的机器上能用」；② 被收录 ≠ 有人用——它不产生下载，D5 的判据里没有这一项。

## 提交是怎么做的（可复核）

1. `record_market_channels.mjs` 先在上游仓库的**副本**里**按 `id` 升序插入**条目（不是追加），并跑**它们自己的**校验器（`community-index.cjs --check` + 10 条测试）；
2. fork 上游仓 → 建分支 → **文本插入**（不是 `JSON.stringify` 重排：第一版那样做会顺手改掉上游两处 `}\n,  {` 的旧格式，把一条插入变成 4 行无关删除，已重做）；
3. 推之前再对**将要推送的字节**跑一次它们的 gate；
4. 开 PR（正文见 `community-plugins-pr.md`）；
5. `record_market_channels.mjs --pr <channel>=<url>` 把 PR 的实时状态写进产物——**不是**「命令退出 0 就算收录」。

## 还需要 HUMAN 的两件（都不阻塞别人）

1. **dsh.so**：**已收录**（R96 复读：三个端点 200，L5 against `0.2.2-rc.1` / low risk），不用再做任何提交动作；唯一会变的是它自己重新索引到 `0.3.7`。
2. **等维护者**：#65 待 **re-review**（R93 实测 `MERGEABLE` / `CHANGES_REQUESTED`；`mergeable_state` 认证侧 `blocked`、匿名侧 `clean`——**是「谁问」的函数**，两侧都记在产物里；**无冲突、分支已逐字节同步、无需 push**）；#193 **已合并**（2026-11-04T01:00:47Z，merge commit `d944a40e`）；#140 `CLEAN` 无 review。`state=merged` 之后才算收录（等的是别人的 review/合并，不是我们的技术动作）。

（历史：R40 之前的唯一卡点是 npm 未发布；发布链的四条命令、`workspace:*` 与 org/OTP 的坑已写进 `docs/HANDOFF.md` §3/§4，别再按旧命令发。）

## 相关文件

- `docs/market/index.json` —— 已发布的 format-1 索引源（repo 内副本；raw URL 见产物 `publish.raw_url`）
- `docs/market/submissions/community-plugins-entry.json` —— 唯一被上游校验器接受的那份条目
- `docs/market/submissions/community-plugins-pr.md` —— PR 正文
- `docs/market/submissions/awesome-lists.md` —— 两个 awesome 列表 + dsh.so 的文案
- `docs/market/listing_zh.md` —— 上架总文案
