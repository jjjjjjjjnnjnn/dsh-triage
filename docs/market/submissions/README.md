# 分发渠道 · 提交包（submissions）

> **状态（R45，2026-10-29 实测）**：`validated 1 · ready 3 · live 3 · site 1（dsh.so 已提交、未收录）· merged 0`。
> 证据：`data/results/market-channels-2026-10-29T10-00-00.000Z.json`（`submitted[]` 是三条 PR 的**实时**状态；`site_submissions[]` 是 dsh.so 的提交记录 + 收录探针）。
> **npm 已发布**：`dsh-triage@0.2.0`（四包同版本），匿名安装验证见 `data/results/publish-2026-10-30T05-00-00.000Z.json`。
> **索引源已在真实公开 URL 上**：`data/results/index-hosting-2026-10-29T22-00-00.000Z.json`。

## 已提交的三条（`live: 3`）

| 渠道 | PR | 状态 | diff |
|---|---|---|---|
| **dsh-community-plugins**（dsh-market Workshop 的唯一真相源） | https://github.com/zhu1090093659/dsh-community-plugins/pull/65 | **OPEN · BLOCKED（待审）** | `community.json` **+12 / -0**（149 entries，纯追加；他们的 gate 在我们推的字节上重跑过：`community-index: OK (149 entries)`） |
| **awesome-deepseekharness/awesome-deepseek-harness** | https://github.com/awesome-deepseekharness/awesome-deepseek-harness/pull/193 | **OPEN · APPROVED（未合并）** | `README.md` **+1 / -0**（Tools, Workflows & Presets 表末行） |
| **walkinglabs/awesome-deepseek-harness-plugins**（R45 新提） | https://github.com/walkinglabs/awesome-deepseek-harness-plugins/pull/140 | **OPEN** | `README.md` **+1 / -0**（Developer Tooling 段，字母序 `dsh-tool-approval` → `dsh-triage` → `dsh-verify`；纯追加） |

**为什么这三条能提出来**：仓库在 2026-10-29 由 HUMAN 决定转 public（`gh repo edit --visibility public`），
raw URL 立刻可读（`docs/market/index.json` 2116B，与仓内副本逐字节一致）；R45 另给仓库补上 `dsh-plugin` 等 topics（该列表的 CONTRIBUTING 要求「plugin 仓库建议带这个 topic」）。

## 其余渠道

| 渠道 | 入口 | 状态 | 说明 |
|---|---|---|---|
| **dsh-market（Workshop 商店）** | 由 community-plugins 生成 | `ready-after-channel-1` | 第一条 PR 合并后自动出现在商店 |
| **dsh.so** | 站点表单（无 API） | ✅ **已提交（HUMAN，2026-10-29）· 未收录** | 提交动作在它自己的后台开 issue，我们没有回执；**可机器复核的部分已经落盘**：三个 per-plugin JSON 端点（`/plugin/@author/<name>.json` 等）在提交后探测仍是 **404** → `indexed: false → status: submitted`。变成 `listed` 的唯一条件是那个端点回 200。审核者说明见 `docs/market/submissions/dsh-so-note.md` |

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

**提交后**：HUMAN 于 2026-10-29 通过站点表单提交（`--site dsh.so=human`）。产物里 `site_submissions[0].indexed = false`，三个端点全部 `http_status: 404`——**这是"还没收录"，不是"被拒"**。等它收录（或维护者回话）后重跑一次，`status` 会自动从 `submitted` 变 `listed`。

## 提交是怎么做的（可复核）

1. `record_market_channels.mjs` 先把条目追加进上游仓库的**副本**并跑**它们自己的**校验器（`community-index.cjs --check` + 9 条测试）；
2. fork 上游仓 → 建分支 → **文本插入**（不是 `JSON.stringify` 重排：第一版那样做会顺手改掉上游两处 `}\n,  {` 的旧格式，把一条追加变成 4 行无关删除，已重做）；
3. 推之前再对**将要推送的字节**跑一次它们的 gate；
4. 开 PR（正文见 `community-plugins-pr.md`）；
5. `record_market_channels.mjs --pr <channel>=<url>` 把 PR 的实时状态写进产物——**不是**「命令退出 0 就算收录」。

## 还需要 HUMAN 的两件（都不阻塞别人）

1. **dsh.so 提交表单**：包已经在 registry 上（`dsh-triage@0.2.0`），按 `awesome-lists.md` 的文案填一次即可。
2. **等维护者**：#65 待审、#193 已 `APPROVED` 待合并；`state=merged` 之后才算收录（那一步不需要我们做）。

（历史：R40 之前的唯一卡点是 npm 未发布；发布链的四条命令、`workspace:*` 与 org/OTP 的坑已写进 `docs/HANDOFF.md` §3/§4，别再按旧命令发。）

## 相关文件

- `docs/market/index.json` —— 已发布的 format-1 索引源（repo 内副本；raw URL 见产物 `publish.raw_url`）
- `docs/market/submissions/community-plugins-entry.json` —— 唯一被上游校验器接受的那份条目
- `docs/market/submissions/community-plugins-pr.md` —— PR 正文
- `docs/market/submissions/awesome-lists.md` —— 两个 awesome 列表 + dsh.so 的文案
- `docs/market/listing_zh.md` —— 上架总文案
