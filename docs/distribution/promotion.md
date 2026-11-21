# 宣发事实卡与发布记录（dsh-triage）

> **唯一宣传状态机在本地知识库 `Promotion/` 总线（Promotion Bus）**
> （`C:\Users\rongj\Desktop\本地知识库\知识库内容\Promotion\`）：排期 `queue/`、台账 `ledger/`、事实卡 `facts/`、评论回收 `inbound/`、每日读数 `reach/` 都在那里，
> 用 `kb promo status` / `kb promo plan dsh-triage` / `kb promo record` 统一查询与登记。
> 本文件与 `docs/distribution/promotion-playbook.md` 只保留**事实卡与人读副本**；这里**不是渠道状态机**，与总线不一致时以总线为准并回来修正。

> **流程**在 `docs/distribution/promotion-playbook.md`。这一页只放**本项目**的事实卡、资产清单与本机发布记录。
> **事实卡必须现取**：下面的数字由 `tests/governance/promotion-fact-card.test.ts` 与仓内文件复算，改一处不改另一处会红。
> **发布记录**的权威来源是 `docs/copy/outreach.json`（每条带 URL 与带时区的时间，全部 `d5_counts: false`）。

---

## 1. 事实卡（写任何对外文案时只从这里取）

| 项 | 值 | 谁能复算 |
|---|---|---|
| 是什么 | 给一个 DSH 组合做判断：插件为什么被拒或悄悄消失、升级会坏什么、候选在一次性 `DSH_HOME` 里实测 | `packages/plugin/README.md` 首屏 |
| 当前版本 | **0.3.11** | `packages/plugin/package.json` |
| 测试 | **1011** | README 徽章 + `pnpm test` |
| 装（插件） | `dsh plugin --profile web add dsh-triage` | 市场条目 `install` 字段 |
| 装（CLI） | `npm i -g dsh-triage` | `packages/plugin/package.json` 的 `bin` |
| 许可 | MIT | `LICENSE` |
| 平台 | **只有 Windows 实测**；Linux / macOS 未测 | `BS-67` |
| 默认行为 | 只读；写盘只在 `--apply`（先备份、可 `--undo` 逐字节还原） | `packages/plugin/README.md` §边界 |
| 位置 | `github.com/jjjjjjjjnnjnn/dsh-triage` · `npmjs.com/package/dsh-triage` | — |

**必须自己说的三条边界**（说了加分，不说会被当吹牛）

1. **不判安全**：它做本地兼容性与准入推演，不是恶意代码 / 供应链审计。
2. **声明层放行 ≠ 运行期无故障**：`admitted` 只说声明的区间接受目标构建。
3. **没有遥测**：所以没有任何「多少人在用」的数字；只有 GitHub 14 天窗口与 npm 的包计数。

**不许出现的说法**：100% 兼容 · 升级会修好 · 装了就没事 · 全网唯一 · 把下载量 / clone / 排名当用户数。

---

## 2. 资产清单

| 资产 | 尺寸 / 位置 | 现状 |
|---|---|---|
| 市场图标 | 180×180 · `docs/market/icon.png` | ✅ 已上线（PR #16311 合并，`/plugins.json` 有 `icon`） |
| **社交预览** | **1280×640** · `docs/market/social-preview-1280x640.png` | ✅ **已上线**（R119 经 Settings 上传，取回 1280×640 且与本地同字节数）：https://repository-images.githubusercontent.com/1434269271/c4ddf724-f4a8-4bed-9d8b-d4885ec26850 |
| dev.to 封面 | 1200×630 · `docs/copy/assets/2026-11-17-npm-downloads.png` | ✅ 已用于已发布的文章（图由 `data/results/traffic-2026-11-17T13-04-28-424Z.json` 的日序列生成） |
| README 截图 | 3 张 · `docs/market/screenshot-0.3.1-*.png` | ✅ 在 README 折叠线上 |

**生成方式**：图标与社交预览是手写 SVG → 本机 Chrome 无头渲染（`--headless=new --screenshot`）。
**不要用**图片模型生成带数字的图（会漂）；图表必须从产物生成。

---

## 3. 渠道状态（2026-11-19 复读；机器可读状态以知识库总线为准）

| 渠道 | 状态 | 下一步 |
|---|---|---|
| 上游 Discussions 回答 | ✅ **7 条已发**（`#13609` / `#13374` / `#13292` / `#13627` / `#13581` + `#13730` **两条**：主评论 + 对 `TheVicky1` 的嵌套回复） | 等回应；**不催、不重发** |
| 上游 D-1 提案 | ✅ 已发（`#13608`，Ideas） | 等回应 |
| 仓库页 | ✅ description / topics（5）/ homepage 已设 / **社交预览已上传** | — |
| awesome-dsh-plugin | ✅ 已收录 + icon 已上线 | 维护义务 `T-871`：描述与代码一致 |
| dsh.so | ✅ `L5 · Run tested` | 版本滞后是它的排期 |
| dsh-pluginmarket | 🟨 PR **#9368** open | 等维护者；不催 |
| walkinglabs（`#140`） | 🟨 open、零 review | **不再 ping** |
| npm | ✅ `latest=0.3.11` | npm 页 README = 仓内 `packages/plugin/README.md` |
| dev.to | ✅ 1 篇（`19 visitors, 1 star, 1,416 clones`）+ **2 条评论回复**（`3lj78` / `3lj79`） | 两条回复由浏览器发出、无草稿，已登记总线台账；不再补发 |
| X | ✅ 1 条线程（根帖 + 3 条回复，`2123100339024883727`） | 已发，不再补发；下一次必须记 `/status/<id>` |
| Reddit | ✅ **1 次答问**（`2026-11-19T18:10Z`，`r/DeepSeekHarness`，[comment](https://www.reddit.com/r/DeepSeekHarness/comments/1xvzrrh/a_good_plugins_for_coding/19svsnh16ksg1/)）：对他人帖的回答，不是新投稿；`post_json` 读回 `removed_by_category` 为空、可见，未放链接、未求赞 | 权威记录是总线台账 `pst-2026-11-19-024`；跨项目 7 天警告对答问不适用，不据此再发新帖 |
| HN / V2EX | ⏸ 未用 | **禁 AI 文本**，只交事实卡与提纲；正文由本人写、本人发 |
| 宣传总线（知识库 `Promotion/`） | ✅ **唯一状态机**：dsh-triage v0.3.11 · fact verified | `kb promo status` / `kb promo plan dsh-triage` / `kb promo record`；本页只是人读副本 |

---

## 4. 已发布记录（权威来源是 outreach.json）

| 类型 | 数量 | 去哪看 |
|---|---|---|
| 上游回复 | 7 | `docs/copy/outreach.json`（含 `#13730` 两条；全部 `d5_counts: false`） |
| 上游提案 | 1 | 同上（`thread: 13608`） |
| 文章 | 1 | 同上（`channel: "devto"`，`article_id: 5060085`） |
| dev.to 评论回复 | 2 | 同上（`posted_outside_channel`，`3lj78` / `3lj79`）+ 总线台账 `pst-2026-11-19-019/020` |
| Reddit 答问 | 1 | 总线台账 `pst-2026-11-19-024`（`visible`，无链接）；总线是权威，本仓 `outreach.json` 是 copy 通道审计副本，不重复登记 |

**合计 12 条**（7 上游回复 + 1 提案 + 1 文章 + 2 评论回复 + 1 Reddit 答问）。

**读法**：这 12 条**没有一条**计入 D5。D5 只数 `#11813` 的 reactions 与第三方引用，
而一个我们自己开的帖 / 自己发的文，来源永远是我们自己。

---

## 5. 这一页怎么用

1. 写任何对外文案前，**只从 §1 取事实**；
2. 发之前按 `promotion-playbook.md` §4 的验证命令逐条过；
3. 发之后用 `kb promo record --project dsh-triage --channel <id> --url <url> --outcome <...> --method <...> --result <...>` 登记到总线，再回填 `docs/copy/outreach.json`（仓库侧审计副本）；
4. 改完数字再跑一次 `node scripts/check_listing.mjs --stamp <ISO> --tests <当前数>`；单一入口见 `docs/AGENT-WORKFLOW.md`，流程以知识库 `Promotion/PLAYBOOK.md` 为准。
5. 改了版本 / 测试数 / 平台边界，**同一轮**回来改这一页（有测试会红）。
