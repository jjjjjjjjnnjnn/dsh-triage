# 分发渠道 · 提交包（submissions）

> **状态（R38，2026-10-29 实测）**：`validated 1 · ready 1 · live 0`。
> 证据：`data/results/market-channels-2026-10-29T18-40-00.000Z.json`（由 `scripts/record_market_channels.mjs` 真跑，含每个渠道的规则来源、我们能不能现在就过、以及唯一那个卡点）。
> **索引源已经在真实公开 URL 上**：`data/results/index-hosting-2026-10-29T18-10-00.000Z.json`。

## 一个卡点，不是三个 bug

四个渠道里有三个要求「有公开可访问的来源」；我们两个都没有（同一份实测）：

| 事实 | 实测值 |
|---|---|
| 源码仓库 | `jjjjjjjjnnjnn/dsh-triage` —— **private**（`gh api repos/… --jq .private` → `true`） |
| npm 包 | `dsh-triage` —— **未发布**（registry `GET /dsh-triage` → **404**） |

所以「D3 两渠道收录」现在缺的不是文案，而是**一次动作**：把仓库转 public，或发布 npm 包。两者都会让条目指向一个活得起来的地方；在此之前提交等于给用户一个 404 链接，比不收录更糟。

## 渠道清单

| 渠道 | 入口 | 我们能做的 | 现在状态 |
|---|---|---|---|
| **dsh-community-plugins**（dsh-market Workshop 的唯一真相源） | `zhu1090093659/dsh-community-plugins` → `community.json` | 条目已写好并**用它自己的校验器跑过**（`community-index: OK (148 entries)` + 其 9 条测试全绿） | `validated`（等公开链接就能提 PR） |
| **dsh-market（Workshop 商店）** | 由上一个渠道生成 | 无需单独提交 | `ready-after-channel-1` |
| **awesome-deepseekharness/awesome-deepseek-harness** | PR 加一行 | 文案已备好 | `blocked`（要求公开来源） |
| **walkinglabs/awesome-deepseek-harness-plugins** | PR 加一行 | 文案已备好 | `blocked`（CONTRIBUTING 原文要求「publicly accessible」） |
| **dsh.so** | 站点表单（无 API） | 文案已备好 | `blocked`（需要已发布的 npm 包） |

## 解锁后怎么提交（每条都是可直接复制的动作）

### 1. dsh-community-plugins（推荐先做这个：它同时喂 dsh-market）

```powershell
# 前置：仓库已 public 或 npm 已发布（条目里的 repo/npm 必须活得起来）
$dir = "$env:TEMP\dsh-community-plugins"
git clone --depth 1 https://github.com/zhu1090093659/dsh-community-plugins.git $dir
node -e "const fs=require('fs');const p=process.argv[1]+'/community.json';const a=JSON.parse(fs.readFileSync(p,'utf8'));a.push(JSON.parse(fs.readFileSync('docs/market/submissions/community-plugins-entry.json','utf8')));fs.writeFileSync(p,JSON.stringify(a,null,2)+'\n')" $dir
node "$dir/scripts/community-index.cjs" --check        # 期望：community-index: OK (... entries)
node --test "$dir/scripts/community-index.test.mjs"    # 期望：9 pass
git -C $dir checkout -b feat/community-plugins-dsh-triage
git -C $dir add community.json
git -C $dir commit -m "feat(community-plugins): add dsh-triage (pre-install judgement and post-mortem attribution)"
git -C $dir push origin HEAD
gh pr create --repo zhu1090093659/dsh-community-plugins --base main --head feat/community-plugins-dsh-triage --title "feat(community-plugins): add dsh-triage" --body-file docs/market/submissions/community-plugins-pr.md
```

**提交前请先确认**：条目里的 `repo` 与 `npm` 真的可访问（`gh api repos/jjjjjjjjnnjnn/dsh-triage --jq .private` 应为 `false`，或 `curl -s -o NUL -w "%{http_code}" https://registry.npmjs.org/dsh-triage` 应为 `200`）。

### 2. 两个 awesome 列表

见 `docs/market/submissions/awesome-lists.md`（两条 entry 行 + PR 正文；都要求公开来源）。

### 3. dsh.so

站点表单，需要已发布的 npm 包；文案见 `docs/market/submissions/awesome-lists.md` 的 "dsh.so" 一节。

## 为什么不自动开 PR

`gh` 有 `repo` 权限，开 PR 在技术上可行。但四个渠道里三个会先检查「链接是否公开可访问」，而现在**必然**不通过——那样的 PR 是噪声，也会消耗一次维护者的注意力。**这一条是本轮唯一的保留动作**：等仓库 public 或 npm 发布后再跑上面第 1 条命令（本人执行或让 agent 执行均可）。

## 相关文件

- `docs/market/index.json` —— 已发布的 format-1 索引源（repo 内副本，与 gist 同字节）
- `docs/market/submissions/community-plugins-entry.json` —— 唯一被上游校验器接受的那份条目
- `docs/market/submissions/community-plugins-pr.md` —— PR 正文
- `docs/market/submissions/awesome-lists.md` —— 两个 awesome 列表 + dsh.so 的文案
- `docs/market/listing_zh.md` —— 上架总文案（R38 已补索引源 URL 与徽章）
