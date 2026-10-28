# 分发渠道 · 提交包（submissions）

> **状态（R38 第二轮，2026-10-29 实测）**：`validated 1 · ready 3 · live 2`。
> 证据：`data/results/market-channels-2026-10-29T22-40-00.000Z.json`（`submitted[]` 里是两条 PR 的**实时**状态与 diff 规模）。
> **索引源已在真实公开 URL 上**：`data/results/index-hosting-2026-10-29T22-00-00.000Z.json`。

## 已提交的两条（`live: 2`）

| 渠道 | PR | 状态 | diff |
|---|---|---|---|
| **dsh-community-plugins**（dsh-market Workshop 的唯一真相源） | https://github.com/zhu1090093659/dsh-community-plugins/pull/65 | **OPEN** | `community.json` **+12 / -0**（149 entries，纯追加；他们的 gate 在我们推的字节上重跑过：`community-index: OK (149 entries)`） |
| **awesome-deepseekharness/awesome-deepseek-harness** | https://github.com/awesome-deepseekharness/awesome-deepseek-harness/pull/193 | **OPEN** | `README.md` **+1 / -0**（Tools, Workflows & Presets 表末行） |

**为什么这两条能提出来**：仓库在 2026-10-29 由 HUMAN 决定转 public（`gh repo edit --visibility public`），
raw URL 立刻可读（`docs/market/index.json` 2116B，与仓内副本逐字节一致）。

## 其余渠道

| 渠道 | 入口 | 状态 | 说明 |
|---|---|---|---|
| **dsh-market（Workshop 商店）** | 由 community-plugins 生成 | `ready-after-channel-1` | 第一条 PR 合并后自动出现在商店 |
| **walkinglabs/awesome-deepseek-harness-plugins** | PR 加一行 | `ready`（未提交） | 它的 CONTRIBUTING 要求「publicly accessible」——现在满足了；文案见 `awesome-lists.md` |
| **dsh.so** | 站点表单（无 API） | `blocked` | 需要**已发布**的 npm 包（registry 对 `dsh-triage` 仍是 404）；文案已备好 |

## 提交是怎么做的（可复核）

1. `record_market_channels.mjs` 先把条目追加进上游仓库的**副本**并跑**它们自己的**校验器（`community-index.cjs --check` + 9 条测试）；
2. fork 上游仓 → 建分支 → **文本插入**（不是 `JSON.stringify` 重排：第一版那样做会顺手改掉上游两处 `}\n,  {` 的旧格式，把一条追加变成 4 行无关删除，已重做）；
3. 推之前再对**将要推送的字节**跑一次它们的 gate；
4. 开 PR（正文见 `community-plugins-pr.md`）；
5. `record_market_channels.mjs --pr <channel>=<url>` 把 PR 的实时状态写进产物——**不是**「命令退出 0 就算收录」。

## 还需要 HUMAN 的一件

`npm login` 之后发布 `dsh-triage`（`pnpm run release:check && npm publish -w dsh-triage --access public`），
解锁 **dsh.so** 这条渠道。其余渠道不再需要任何动作，等维护者审 PR 即可。

## 相关文件

- `docs/market/index.json` —— 已发布的 format-1 索引源（repo 内副本；raw URL 见产物 `publish.raw_url`）
- `docs/market/submissions/community-plugins-entry.json` —— 唯一被上游校验器接受的那份条目
- `docs/market/submissions/community-plugins-pr.md` —— PR 正文
- `docs/market/submissions/awesome-lists.md` —— 两个 awesome 列表 + dsh.so 的文案
- `docs/market/listing_zh.md` —— 上架总文案
