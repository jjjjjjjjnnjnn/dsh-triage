# 分发渠道 · 提交包（submissions）

> **状态（R53，2026-11-01 实测）**：`validated 1 · ready 3 · live 3 · site 1（dsh.so 已收录 `listed`）· merged 0`。
> 证据：`data/results/market-channels-2026-11-01T09-40-00.000Z.json`（`submitted[]` 是三条 PR 的**实时**状态；`site_submissions[]` 是 dsh.so 的提交记录 + 收录探针）。R45 的旧快照 `data/results/market-channels-2026-10-29T10-00-00.000Z.json` 原样保留。
> **npm**：`dsh-triage@0.3.2`（四包同版本，本次备票待发布；`0.3.1` 的匿名安装取证见 `data/results/publish-2026-11-01T18-00-00.000Z.json`，**20/20**；`0.3.2` 的取证在发布后补）。
> **索引源已在真实公开 URL 上**：`data/results/index-hosting-2026-10-29T22-00-00.000Z.json`。

## 已提交的三条（`live: 3`）

| 渠道 | PR | 状态 | diff |
|---|---|---|---|
| **dsh-community-plugins**（dsh-market Workshop 的唯一真相源） | https://github.com/zhu1090093659/dsh-community-plugins/pull/65 | **OPEN · MERGEABLE · BLOCKED（冲突已解，等 review）** | `community.json` **+12 / -0**（151 entries，纯追加；上游校验器在我们 rebase 后的字节上重跑过：`community-index: OK (151 entries)` + 9/9 tests） |
| **awesome-deepseekharness/awesome-deepseek-harness** | https://github.com/awesome-deepseekharness/awesome-deepseek-harness/pull/193 | **OPEN · APPROVED · CLEAN（等维护者合并）** | `README.md` **+1 / -0**（Tools, Workflows & Presets 表末行） |
| **walkinglabs/awesome-deepseek-harness-plugins**（R45 新提） | https://github.com/walkinglabs/awesome-deepseek-harness-plugins/pull/140 | **OPEN · CLEAN（无 review）** | `README.md` **+1 / -0**（Developer Tooling 段，字母序 `dsh-tool-approval` → `dsh-triage` → `dsh-verify`；纯追加） |

> **R60 已 rebase #65**：从 `upstream/main` 重建干净分支，只 cherry-pick 新增 `dsh-triage` 条目（**+12/-0**，别人的条目一个没动），丢掉一个纯逗号格式化的提交；上游 `community-index.cjs --check` **OK（151 entries）**、`node --test` **9/9**；force-with-lease 推回后 PR 从 **`CONFLICTING/DIRTY`** 变成 **`MERGEABLE/BLOCKED`**。`blocked` 是仓库要求 review，**不是冲突**；`merged: 0` 未变（合并仍由维护者决定）。

**为什么这三条能提出来**：仓库在 2026-10-29 由 HUMAN 决定转 public（`gh repo edit --visibility public`），
raw URL 立刻可读（`docs/market/index.json` 2116B，与仓内副本逐字节一致）；R45 另给仓库补上 `dsh-plugin` 等 topics（该列表的 CONTRIBUTING 要求「plugin 仓库建议带这个 topic」）。

## 其余渠道

| 渠道 | 入口 | 状态 | 说明 |
|---|---|---|---|
| **dsh-market（Workshop 商店）** | 由 community-plugins 生成 | `ready-after-channel-1` | 第一条 PR 合并后自动出现在商店 |
| **dsh.so** | 站点表单（无 API） | ✅ **已收录（`listed`）** | 2026-10-29 由 HUMAN 提交，`registry.indexedAt = 2026-10-29T09:49Z`；R45 探测时三个 per-plugin 端点还是 404（那时如实记 `submitted`），**R53（2026-11-01）三个端点全部 200**，所以现在记 `listed`。内容：`verification.level = L5 · Run tested`（0.2.1-rc.5 `passed`；0.2.1-rc.3 `unknown`）、`security.status = audited`、`riskLevel = low`（0 Critical / 0 Warning）。**两条边界**：① L5 是 dsh.so 在它自己的干净沙盒里的一次实测，**不是**「在你的机器上能用」（`BS-06`）；② 它页面上的安装行仍是上一个版本，要等它重新索引才会到 `0.3.1`。 |

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
| `install.command` | 站点自己记的安装行仍是**上一个版本**（它还没重新索引到 `0.3.1`） |

**两条不许越界的读法**：① `L5` 是 dsh.so 在**它自己的干净沙盒**里跑的一次结果（`BS-06`），不能读成「在你的机器上能用」；② 被收录 ≠ 有人用——它不产生下载，D5 的判据里没有这一项。

## 提交是怎么做的（可复核）

1. `record_market_channels.mjs` 先把条目追加进上游仓库的**副本**并跑**它们自己的**校验器（`community-index.cjs --check` + 9 条测试）；
2. fork 上游仓 → 建分支 → **文本插入**（不是 `JSON.stringify` 重排：第一版那样做会顺手改掉上游两处 `}\n,  {` 的旧格式，把一条追加变成 4 行无关删除，已重做）；
3. 推之前再对**将要推送的字节**跑一次它们的 gate；
4. 开 PR（正文见 `community-plugins-pr.md`）；
5. `record_market_channels.mjs --pr <channel>=<url>` 把 PR 的实时状态写进产物——**不是**「命令退出 0 就算收录」。

## 还需要 HUMAN 的两件（都不阻塞别人）

1. **dsh.so**：**已收录**（R53 复核：三个端点 200，L5 / low risk），不用再做任何提交动作；唯一会变的是它自己重新索引到 0.3.1。
2. **等维护者**：#65 待审但**与 main 冲突（`DIRTY`）**——需要我们先 rebase（`T-821`），否则合并不了；#193 已 `APPROVED` + `CLEAN` 待合并；#140 `CLEAN` 无 review。`state=merged` 之后才算收录（那一步不需要我们做）。

（历史：R40 之前的唯一卡点是 npm 未发布；发布链的四条命令、`workspace:*` 与 org/OTP 的坑已写进 `docs/HANDOFF.md` §3/§4，别再按旧命令发。）

## 相关文件

- `docs/market/index.json` —— 已发布的 format-1 索引源（repo 内副本；raw URL 见产物 `publish.raw_url`）
- `docs/market/submissions/community-plugins-entry.json` —— 唯一被上游校验器接受的那份条目
- `docs/market/submissions/community-plugins-pr.md` —— PR 正文
- `docs/market/submissions/awesome-lists.md` —— 两个 awesome 列表 + dsh.so 的文案
- `docs/market/listing_zh.md` —— 上架总文案
