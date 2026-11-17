# OPERATIONS · 运营交接（2026-11-17，R116 → 下一会话）

> 这一页是给**下一个会话**的运营入口。产品侧已冻结：D5 判 `fail`，仓库按 `docs/11-d-path.md` 走 D 线（作品集 + 上游贡献 + 维护）。
> **运营只做分发与触达，不加功能。** 先读 `docs/research/2026-11-17-traffic-audit.md`，再跑 §2 的命令。

---

## 1. 不可动的边界

| 不动 | 原因 |
|---|---|
| D5 的三个阈值（10 / 1 / 20）、`admission.ts`、四桶、`improved` 五门槛、`data/gold/`、20s 预算 | 判据/阈值冻结；改动需要 spec + HUMAN-SIGN |
| 不新增命令 / 面板页 / 判据 | D-3 维护模式只允许：安全修复、上游适配、CI、回归 smoke |
| 不买 star、不刷下载、不自己引用自己 | D5 的判据会排除；且那是伪造证据 |
| 不 force push、不再 ping `#140` | 维护者明确要求；`#140` 零 review 是对方的选择 |
| 不把 clone / 下载读成人数 | 见 §5；这是上一轮被打回过一次的读法 |

**谁做什么**：agent 写草稿、跑记录器、提交可逆的目录条目；**HUMAN 决定发不发、打不打 tag、切不切公开仓**。

---

## 2. 接手 30 分钟（先确认稳定，再谈运营）

```powershell
git status --short                  # 预期：dsh-triage/ 干净
pnpm install --frozen-lockfile
pnpm run verify                     # 995 测试 / 10 门
node scripts/gate.mjs --mutate      # 10/10
node scripts/handover_check.mjs     # 10/10
node scripts/record_traffic.mjs --stamp (node -e "console.log(new Date().toISOString())")
```

最后一条会写一份 `data/results/traffic-*.json`，与基线
`data/results/traffic-2026-11-17T13-04-28-424Z.json` 对比。**先看 views / uniques，再看 stars；不要把 clone 和 npm 下载放进第一眼。**

如果 `render controls` 红了：那是 `T-860` 的已知形状（浏览器没开调试端口，15052ms / 15076ms），见 §7。**重跑一次**，不要改 `expect blank`。

---

## 3. 当前状态（2026-11-17 实测）

| 面 | 状态 |
|---|---|
| 发布 | **0.3.11**，`npm latest=0.3.11`；`v0.3.11` GitHub Release 已打；npm 页面 = 仓内 `packages/plugin/README.md`（逐字节） |
| 公开仓 | `ebdf333`，tree 与容器 `HEAD:dsh-triage` 逐字节相同；CI 6/6 绿 |
| 仓库设置 | `homepage = https://www.npmjs.com/package/dsh-triage`；topics 5 个；无 Discussions |
| 市场 | `awesome-dsh-plugin` 有条目（`0.3.10` 滞后）；**icon 已于 2026-11-17T17:08:43Z 合并并上线**（PR #16311，`/plugins.json` 里有 `icon`）；`dsh.so` **L5 passed**（`0.3.10` 滞后）；`dsh-pluginmarket` PR **#9368** 仍 open |
| 上游回答 | **R118 已发 3 条**（`#13609` / `#13374` / `#13292`，`outreach.json` 有 URL 与时间）；`#13031` / `#12932` 隔 1–2 天再发 |
| 外部互动 | issue **#1**（`CyrusCCSY`，真 bug）已跟进 0.3.11；1 star / 0 fork / 0 watch |
| 流量基线 | 14 天 **47 浏览 / 19 唯一**；**1,416 clone / 327 唯一**（30×）；npm 31 天 **2,996**；第三方引用 **0** |
| 门禁 | **995 测试 / 10 门 / 10-10**；**646 份 SSOT / 695 步台账 / 75 条盲区** |
| 交接快照 | `backup/snapshots/snapshot-0.3.11-handoff-R116-final.json` |

---

## 4. 下一批动作（P1：先草稿，后发布）

| # | 动作 | 产物 | 谁发 |
|---|---|---|---|
| 1 | **D-1 上游归因**：admission 拒绝时缺归因，用 issue #1 做真实案例 | ✅ **R117 已发**：`https://github.com/deepseek-ai/deepseek-harness/discussions/13608`（**Ideas**；上游 issue 已关）。事实包 `2026-11-17-d1-attribution.md`；回填 `outreach.json` | 等上游回应（不催） |
| 2 | **上游故障帖回复**：插件消失 / 升级后起不来 | ✅ **R118 已发 3 条**（`#13609` / `#13374` / `#13292`）；剩 `#13031` / `#12932` 隔 1–2 天 | **HUMAN**（若要改口径） |
| 3 | **一篇透明数据帖**：「19 个访客、1 个 star、1,416 次 clone」 | 渠道已定 **dev.to**；正文与配图由 agent 出，**发布需要 human 的账号或 API key** | **HUMAN** |

**验收**：草稿都带 `<!-- facts: -->` 与粘贴块；每个数字指到带 `.sha256` 的产物；`node scripts/check_listing.mjs --tests 995` 仍 17/17。发完回填 `docs/copy/outreach.json`（`d5_counts: false`）。

---

## 5. 4 周度量

每周跑一次 `record_traffic`，只看四个数：

| 指标 | 基线（2026-11-17） | 4 周目标 |
|---|---:|---:|
| 仓库唯一访客 / 14 天 | **19** | **100** |
| Star | **1** | **10** |
| 第三方引用（D5 口径） | **0** | **3** |
| 外部 issue / PR | **1** | **3** |

> 目标不高是故意的：19 → 100 已经要求到达翻五倍。**npm 下载与 clone 不进这四个数。**

---

## 6. 现在能做什么、不能做什么

**能**：写草稿、跑记录器、提交目录条目（可逆）、跟进真实 issue、回答上游故障帖（HUMAN 发）、维护版本与文案一致性。

**不能**：加功能、改判据、买量、重复发同一篇内容、把「没人来」解释成「文案不好」再改一轮首屏。

---

## 7. 已知坑（这一轮踩过的）

| 坑 | 现象 | 处理 |
|---|---|---|
| `T-860` `render controls` 偶发红 | `inconclusive · the browser never opened a debugging port · 15052ms` | 重跑失败的 job；**不要把 `expect blank` 放宽**；产物会带 `browser_stderr` |
| `record_market_channels` 不带 `--pr` | `summary.live = 0`，看起来像「PR 全没了」 | 那是「没问」；带上 `--pr` 重跑；本文件已写进 `submissions/README.md` |
| 发布后立刻 `record_publish` | `version:<pkg>` / `dist-tags-agree` 红 | 副本滞后；**红产物保留**，几分钟后重跑 18/18 |
| `--stamp` 写成未来时间 | 产物 `generated_at` 比真实 UTC 晚 | 一律用 `new Date().toISOString()`；不要手打。这一轮因此删过 6 份产物 |
| 切公开仓追 `behind 0` | 记录切面要写产物 → 产物要提交 → 切面立刻老一步 | **构造**；只在内容变化后切一次；HANDOFF §3 已改成只写流程、不写哈希 |
| `check_listing` 只认 `dsh-triage@<ver>` | `latest=0.3.9` 这种写法 17/17 照样绿 | 已知盲区；R114 靠人眼抓到。要补断言时先写真红对照 |
| PowerShell 重定向 `npm view` | 读出来像 UTF-16 乱码 | 用 `npm pack` 解出 README，或 `fetch('https://registry.npmjs.org/dsh-triage')` 读 `.readme` |
| `dsh.so` / `awesome-dsh-plugin` 版本滞后 | 它们仍写 0.3.10 | 那是它们的索引排期；不要为了对齐去改我们的版本 |

---

## 8. 文件地图

| 要做什么 | 看哪里 |
|---|---|
| 流量分析与计划 | `docs/research/2026-11-17-traffic-audit.md` |
| 流量记录器 | `scripts/record_traffic.mjs`；基线 `data/results/traffic-2026-11-17T13-04-28-424Z.json` |
| 发帖规则 / 命令包 | `docs/distribution/posting-runbook.md`、`docs/distribution/answer-kit.md` |
| 文案通道 | `docs/copy/README.md`、`docs/copy/STYLE.md`、`docs/copy/facts/`、`docs/copy/drafts/` |
| 市场与渠道状态 | `docs/distribution/awesome-dsh-plugin.md`、`docs/distribution/pr-65-status.md`、`docs/market/submissions/README.md` |
| 维护模式四类事 | `docs/11-d-path.md` §D-3、`docs/HANDOFF.md` §3 5c |
| 任务清单 | `docs/BACKLOG.md`（`T-871` 长期义务；`T-855`–`T-858` ⛔） |

---

## 9. 需要 HUMAN 拍板

1. **发哪几篇草稿**（D-1 / 5 条回复 / 数据帖）——agent 只写，不替发。
2. **市场 `icon`**：需要一张 180×180 的方图；没有图就继续回退作者头像。
3. **公开仓再切**：运营改动提交后是否切；只在内容变化后切，不为 `behind 0` 切。
