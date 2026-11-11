# T-810 · 分发物料与草稿指南

> **定位**：面向外部社区的产品分发与技术推广草稿集合（8 篇物料 / 回帖 + 机器校验登记表 `registry.json`）。
> **执行原则**：Agent 负责物料起草与机器可算性校验，真实发布由 HUMAN 操作。

---

## 核心数据与事实基准

所有分发文案严格基于仓内实测产物，数据与命令必须完全可复算，杜绝虚假与夸大宣传：
1. **数据一致性**：文中所引用的卡片数据、基线数据及截图必须与 `registry.json` 中登记的真实产物哈希完全一致；
2. **命令可执行**：每篇草稿必须提供读者可直接复现或自测的命令（如 `dsh-triage upgrade --to ...`、`dsh-triage audit`）；
3. **合规红线**：
   - 严禁断言“升级能解决一切兼容问题”（目前真机数据中 `improved` 桶为 0）；
   - 严禁宣称“覆盖全量插件”（我们统计口径为 npm 关键词检索匹配的 1,584 个包）；
   - 严禁宣称“官方推荐或官方认证”（保持独立开源项目定位）；
   - 严禁泄露个人隐私信息（邮箱、个人联系方式或个人主页）。

---

## 渠道分发矩阵与规划

| 序号 | 文件 | 渠道目标 | 定位与核心说明 |
|---|---|---|---|
| 1 | `01-show-your-plugins.md` | 上游官方 GitHub Discussions (`Show Your Plugins!`) | 严格遵守上游 `#2004` 六条规范（标题格式、仓库地址、功能说明、两张真机截图附件、集成方式、独立项目声明） |
| 2 | `04-zh-longform.md` | 中文开发者技术社区（V2EX / 掘金 / 博客） | 硬核技术解析风格：深入 DSH 准入（Admission）底层机制，剖析 192 个单元在 rc.5 上的准入表现与预检实践 |
| 3 | `02-github-fault-diagnosis.md` | GitHub 实际故障 Issue 排查答疑 | 仅在用户真实遭遇“插件装上后消失/未加载”时回复，给出 3 步排错命令与自动化诊断方案 |
| 4 | `03-x-en.md` | X / Twitter 线程（4 连推） | 开发者传播：聚焦痛点数据（192 单元中有 119 被拦截）、机制解析、一行预检命令与开源地址（中文主选/英文备选，适配免费账号） |
| 5 | `05-bili-script.md` | B 站 60–90 秒短视频口播脚本 | 痛点共鸣与快节奏演示：配合终端与界面真实录屏，流畅口播准入原理与一键自查 |
| 6 | `06-reply-8202-mcp-client.md` | 上游 Discussion #8202 答疑回复 | 针对点名版本（`0.1.0-rc.7`）锁定 0.1 导致在 0.2.x 被拒的归因与豁免/换版建议 |
| 7 | `07-reply-10849-dist-tag.md` | 上游 Discussion #10849 答疑回复 | 针对裸名安装时 `latest` 标签失步指向旧版本的归因，指明解决主体与显式安装建议 |
| 8 | `08-reply-11687-not-declaration.md` | 上游 Discussion #11687 答疑回复 | 反向回答：两款第三方插件准入均通过，指明故障出在运行期导入/初始化而非准入拦截 |

### 🌐 已发布的社区矩阵跟踪

| 平台 | 目标板块 / 账号 | 帖子链接 | 发布状态 |
|---|---|---|---|
| **GitHub** | 上游官方 Discussions (`Show Your Plugins!`) | https://github.com/deepseek-ai/deepseek-harness/discussions/11813 | ✅ 已发布（D5 监测窗口中） |
| **X (Twitter)** | 个人开发者账号 | https://x.com/jjjj1955714/status/2117306628227940741 | ✅ 已发布（4 连推线程） |
| **Reddit** | `r/DeepSeek` | https://www.reddit.com/r/DeepSeek/comments/1xm84py/understanding_deepseek_harness_plugin_admission/ | ✅ 已发布（Resource 规范帖） |
| **Reddit** | `r/DeepSeekHarness` | https://www.reddit.com/r/DeepSeekHarness/comments/1xm88ex/understanding_deepseek_harness_plugin_admission/ | ✅ 已发布（定向专属圈子） |

> **R58 交接注记（HUMAN 决定 · R94 已改变）**：第 6/7/8 篇（三条回帖）**原本不发**——对应帖子已经有人答过。
> 三份文件当时**保留作样例**（它们演示了「按帖内点名版本判」与「反向排除声明层」两种回答形状）。
>
> **R73 更正一处措辞**：上面那句「已经有人答过」不准确。R71 用 `record_discussion_state` 实测（`2026-11-02T19:13Z`）：
> 三条帖子都是 `isAnswered: false`、`closed: false`，各有 1–2 条回复 —— 也就是说**没有人给出被接受的答案**，
> 但已经有人回过。当时的决定（不发）理由应读作「已有人回复，再贴一份只会稀释信息」，而不是「已经解决了」。
>
> **R94（2026-11-11）改为发出去，理由不是「该推了」**：三条各自对应一个**可复算的具体答案**，而 11-02 时
> 它们引用的目标 `0.2.1-rc.5` 还是当天的 `next`；11-05 之后 `next` / `latest` 都已移动（现读见
> `docs/copy/facts/2026-11-11-t810-registry-drift.md`）。所以发之前做的是**修订**，不是重写：判定数字一个没改
> （它们本来就是按 `0.2.1-rc.5` 判的），只换掉「就是现在的 `next`」这类已经失效的句子，并补一句
> 「换目标请自己用 `check` 重跑」。三篇正文由外部 `agy --model gemini-3.8-flash-high` 依事实包修订；
> 工程侧只给事实包、并用 `check_listing` 的 `draft-claims-match-their-artifact` 挡住「修订把数字改掉」。
>
> **三条回帖不计入 D5**（`channels.json` 里唯一 `d5_counts: true` 仍是 `#11813`）：D5 数的是那一条的
> reactions 与外部引用；在别人的帖下答问不产生 reaction，也不该被当成达标手段。它们的作用是有机会换来
> 「外部引用 ≥1」——若 11-15 关窗时仍是 0，那就是一条要如实记录的结果。
>
> **R73 台账**：四个渠道的机器可查版本在 `docs/distribution/channels.json`（平台 / 链接 / 日期 / **是否计入 D5**），
> 由 `check_listing` 第 17 条复算；本页那张表与它必须逐条对齐，否则检查器红。
>
> **R94 新增：三条上游答问（2026-11-11 已发，均为答问、不是发布）**
>
> 它们**不写进 `channels.json`**，因为那份台账的口径是「每条 = 一次发布 = 一个 URL」，而这三条是在别人的
> 帖下答问；把答问塞进发布台账会让「发了很多地方」看起来像需求。它们的机器可查版本在
> `data/results/posted-replies-2026-11-11T13-40-00.000Z.json`（逐条校验：URL 可解析、作者是本账号、
> 正文长度、线程是否已有被接受的答案）。
>
> | Discussion | 回帖 | 角色 |
> |---|---|---|
> | #8202 | https://github.com/deepseek-ai/deepseek-harness/discussions/8202#discussioncomment-19542005 | 按帖内点名版本（`0.1.0-rc.7`）判 `denied`，给出换版建议 |
> | #10849 | https://github.com/deepseek-ai/deepseek-harness/discussions/10849#discussioncomment-19542006 | `latest` 标签失步的归因；裸名会解析到旧构建 |
> | #11687 | https://github.com/deepseek-ai/deepseek-harness/discussions/11687#discussioncomment-19542007 | 反向回答：两款第三方插件准入都通过，问题不在声明层 |

---

## 发布后跟踪步骤

1. **更新登记表**：在 `registry.json` 中将对应文件的 `status` 修改为 `posted`，并记录发布时间 `posted_on` 与链接 `posted_url`；
2. **记录外部数据**：
   ```powershell
   node scripts/record_d5_evidence.mjs --post <帖子URL> --posted-on <ISO时间戳>
   ```
3. **更新交接看板**：在 `docs/HANDOFF.md` 中同步社区反馈与下载情况。
