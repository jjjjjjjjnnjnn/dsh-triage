# 宣发事实卡与发布记录（dsh-triage）

> **流程**在 `docs/distribution/promotion-playbook.md`。这一页只放**本项目**的事实卡、资产清单、渠道状态与发布记录。
> **事实卡必须现取**：下面的数字由 `tests/governance/promotion-fact-card.test.ts` 与仓内文件复算，改一处不改另一处会红。
> **发布记录**的权威来源是 `docs/copy/outreach.json`（每条带 URL 与带时区的时间，全部 `d5_counts: false`）。

---

## 1. 事实卡（写任何对外文案时只从这里取）

| 项 | 值 | 谁能复算 |
|---|---|---|
| 是什么 | 给一个 DSH 组合做判断：插件为什么被拒或悄悄消失、升级会坏什么、候选在一次性 `DSH_HOME` 里实测 | `packages/plugin/README.md` 首屏 |
| 当前版本 | **0.3.11** | `packages/plugin/package.json` |
| 测试 | **1004** | README 徽章 + `pnpm test` |
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

## 3. 渠道状态（2026-11-18 复读）

| 渠道 | 状态 | 下一步 |
|---|---|---|
| 上游 Discussions 回答 | ✅ **5 条已发**（`#13609` / `#13374` / `#13292` / `#13627` / `#13581`） | 等回应；**不催、不重发** |
| 上游 D-1 提案 | ✅ 已发（`#13608`，Ideas） | 等回应 |
| 仓库页 | ✅ description / topics（5）/ homepage 已设 / **社交预览已上传** | — |
| awesome-dsh-plugin | ✅ 已收录 + icon 已上线 | 维护义务 `T-871`：描述与代码一致 |
| dsh.so | ✅ `L5 · Run tested` | 版本滞后是它的排期 |
| dsh-pluginmarket | 🟨 PR **#9368** open | 等维护者；不催 |
| walkinglabs（`#140`） | 🟨 open、零 review | **不再 ping** |
| npm | ✅ `latest=0.3.11` | npm 页 README = 仓内 `packages/plugin/README.md` |
| dev.to | ✅ 1 篇（`19 visitors, 1 star, 1,416 clones`） | 观察 24h / 1w 读数 |
| X / Reddit / HN / V2EX | ⏸ 未用 | HN / V2EX **禁 AI 文本**，只交事实卡；Reddit 需先读版规与 karma |

---

## 4. 已发布记录（权威来源是 outreach.json）

| 类型 | 数量 | 去哪看 |
|---|---|---|
| 上游回复 | 5 | `docs/copy/outreach.json`（`posted_kind: "reply"`） |
| 上游提案 | 1 | 同上（`thread: 13608`） |
| 文章 | 1 | 同上（`channel: "devto"`，`article_id: 5060085`） |

**读法**：这 7 条**没有一条**计入 D5。D5 只数 `#11813` 的 reactions 与第三方引用，
而一个我们自己开的帖 / 自己发的文，来源永远是我们自己。

---

## 5. 这一页怎么用

1. 写任何对外文案前，**只从 §1 取事实**；
2. 发之前按 `promotion-playbook.md` §4 的验证命令逐条过；
3. 发之后回填 `docs/copy/outreach.json`，再跑一次 `node scripts/check_listing.mjs --stamp <ISO> --tests 1004`；
4. 改了版本 / 测试数 / 平台边界，**同一轮**回来改这一页（有测试会红）。
