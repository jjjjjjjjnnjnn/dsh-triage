# 采证 · 上游求助帖能不能用本项目回答（R57）

> **样本**：12 条（`#11687 #11458 …` 见下表），来自 `deepseek-ai/deepseek-harness` Discussions 的关键词检索
> （「插件消失 / 无法启动 / incompatible / plugin not found / 升级之后」五组查询，取并集，2026-10-11 至 11-01）。
> **产物**：`data/results/discussion-triage-2026-11-02T12-10-00-000Z.json`（`5485b240…`）
> **原始快照**：`data/fixtures/discussions/2026-11-02T11-30-00-000Z.json`（可 `--fixtures` 离线复算，rows/counts/answers 逐项相同）
> **脚本**：`scripts/record_discussion_triage.mjs` + 纯函数 `scripts/lib/discussion-triage.mjs`（6 条单测）

---

## 1. 结论先说

**12 条里 9 条落在我们能判的层上，3 条不是我们的领域。** 但这 9 条不是同一种「能答」：

| 我们能给的东西 | 条数 | 含义 |
|---|---|---|
| **点名被拒的包与区间**（`names-a-denial`） | **7** | 可以直接回：「你这条行会被拒，因为声明的区间不含 rc.5」——并给出包名与区间 |
| **排除声明层**（`rules-out-declaration`） | **1** | 这条崩溃**不是**声明层造成的（它点名的插件都 admits rc.5），要往运行期/组合方向查——**这同样是有用的回答，而且是我们最容易避免「乱背锅」的一条** |
| **只能说明「没声明」**（`declares-nothing`） | **3** | 包存在、什么都没声明——不能算兼容，也不能算被拒 |
| **不是我们的层**（`runtime`） | 3 | 网关 503 / 安装器写锁 / cookie 累积 |

> **一句最重要的**：`#11687`（升级 rc.5 后启动崩溃，报「1 required plugin did not activate」）——社区最常见的
> 归因是「插件版本不兼容」，但实测它点名的两个第三方插件 **admits rc.5**。**声明层不是凶手**。如果我们在那条
> 帖子下贴一张「119 个行会被拒」的卡片，就是答非所问。

## 2. 十二条逐条

| # | 标题（截断） | 层 | 判定 | 我们实际能说 | 探针读数（target `0.2.1-rc.5`） |
|---|---|---|---|---|---|
| 11687 | 升级 rc.5 后第三方插件冲突导致启动崩溃 | admission | answerable | **排除声明层** | `@linxin666/dsh-web-all@0.4.13` **admits** · `dsh-better-sidebar@0.28.2` **admits** |
| 11421 | 社区插件带入旧版 Web UI 组件抢先加载 | composition | partially | 需要他们的 profile（`audit --all`） | `@deepseek-ai/dsh-client-ui-theme@0.2.1-rc.3` **declares nothing** |
| 11288 | 会话目录残留明文世代文件 → workspaceController 不可用 | runtime | partially | 先排除声明层，再还给他们 | `dsh-workspace@0.0.1` declares nothing |
| 11080 | 升级静默禁用版本不匹配的插件，原因只在 stderr | admission | answerable | **点名被拒的包** | `@deepseek-ai/dsh-hooks-claude-code@0.0.1-rc.5` **denies** |
| 10908 | Windows 无法添加工作区：workspaceController unavailable | runtime | partially | 只能排除声明层 | （帖内无包名） |
| 10849 | `dsh-mcp-client` 的 `latest` 指向 0.0.1-rc.1，装裸名被拒 | admission | answerable | **点名被拒的包 + 说明是 tag 的锅** | `@deepseek-ai/dsh-mcp-client@0.0.1-rc.1` **denies**（同 `dsh-llm` / `dsh-tools`） |
| 10759 | 安装可以遮蔽运行时包；启动失败后 profile 被重置 | admission | answerable | 点名被拒的包 | `dsh-livedocs@0.2.3` admits · `@deepseek-ai/dsh-tools@0.2.0-rc.2` **denies** · `dsh-agent@0.1.0-rc.6` **denies** |
| 10458 | 嵌套 `dsh-app-boot` 用自己的版本判兼容 | admission | answerable | 点名被拒的包（并解释是副本解析） | `@sagmans/dsh-tui@0.16.0` admits · `@deepseek-ai/dsh-app-boot@0.1.0-rc.6` **denies** |
| 10201 | rc.2 升级破坏了可用的安装（hooks dist-tags / 回滚 / 重复解析） | admission | answerable | 点名被拒的包 | `@deepseek-ai/dsh-hooks-claude-code@0.0.1-rc.5` **denies** · `dsh-llm@0.0.1-rc.5` **denies** |
| 8202 | `@deepseek-ai/dsh-mcp-client@0.1.0-rc.7` 与 0.2.0-rc.1 不兼容 | admission | answerable | **按帖子里点名的版本判** | `@deepseek-ai/dsh-mcp-client@0.1.0-rc.7` **denies** |
| 7590 | `@xmanrui/dsh-im` 与 `@liustack/modlens` 在 0.1.7-alpha.2 上不兼容 | admission | answerable | 只能说「没声明」——**与我们的 CASE-7590 一致** | 两个都 **declares nothing** |
| 7317 | 升级后插件不兼容导致无法启动 | admission | answerable | 点名被拒的包 | `@deepseek-ai/dsh-app-boot@0.1.0-rc.6` **denies**；`@deepseek-ai/dsh@0.2.1-rc.5` declares nothing |

## 3. 可直接回帖的三条（都已有机器读数）

1. **#8202**：帖子点名 `@deepseek-ai/dsh-mcp-client@0.1.0-rc.7` → 我们**按它点名的版本**判出 **denies 0.2.1-rc.5**。
   能回一句「这条行会被拒，区间是 X」＋一条可复算命令。**这是最干净的一条。**
2. **#10849**：`latest` 指向 `0.0.1-rc.1`，裸名安装拿到旧构建 → 被拒。这条正好是我们 T-109 的分布信号，
   能回「问题不在你的区间，在 tag」。
3. **#11687**：反向回答——**声明层不是凶手**。回帖必须说「你这两个插件都 admits rc.5，所以别在声明层找」，
   否则就是把人引向错误方向。

## 4. 不能答的三条（别去回）

`#10908` / `#11288` / `#11421`：网关 503、世代文件、旧版 Web UI 组件抢先加载。我们能做的只有**排除声明层**
（`dsh-triage why` 看不到被拒的行），修复在运行期/上游。**在这些帖子里贴升级卡片 = 答非所问。**

## 5. 这套判定的边界（写死，别忘）

1. **探针判的是「已发布的最新版」**，除非帖子自己点名了版本（#8202 那种）。对方实际装的是哪个版本，我们不知道；
2. **没有他们的 profile**：`names-a-denial` 是对**包**的判定，不是对**他们那台机器**的判定。回帖必须写「如果你装的是这个版本」；
3. **分类只读文本**：`#11421` 明明是运行期现象，却因为出现「抢先/覆盖」被判成 `composition`——文本分类会错，所以每条都带 `reason` 供人复核；
4. **搜索 API 不索引 discussions**（`BS-51`）：这 12 条是用 GitHub Discussions 的 GraphQL 检索拿的，不是全文索引，样本不是全量。

## 6. 下一步（要不要回帖）

回帖是一个**公开动作**，属于 HUMAN 决定（本轮只采证）。如果要回，建议顺序：**#8202（最干净）→ #10849（tag 的故事）→ #11687（反向排除）**，
每条都附一条可复算命令，并且**只写项目口吻**（`docs/BACKLOG.md` T-810 的规则）。这三条草稿可以直接从本报告的表格扩写。
