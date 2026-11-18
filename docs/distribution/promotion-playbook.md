# 宣发 playbook（dsh-triage 版）

> **来源**：`ai-terminal-pet/docs/PROMOTION-PLAYBOOK.md`（2026-11-18 通读后适配）。保留的是**方法**：
> 事实卡现取、渠道逐条验证、去 AI 化写作、24h/1w 测量。换掉的是**渠道与红线**——我们是插件生态里的判断层，
> 不是桌面应用；而且 D5 已判 `fail`，**不能靠加功能换曝光**。
>
> **这份文件不写某一次的数字**。每一次的数字在 `docs/distribution/promotion.md` 的事实卡里，用命令现取。
> **它也不是判据**：D5 的三个阈值（10 / 1 / 20）、判定顺序、`admission.ts`、四桶全部冻结，本文件一个字都没改。

---

## 0. 开始前的四个前置条件

1. **事实卡现取**：版本、测试数、产物数用项目自己的命令打印（§5）。本文不提供数字。
2. **每个渠道先读当期规则**：上游 `CONTRIBUTING.md`、market 的 `contributing.md`、版块的 `about/rules`。
3. **登录 / 2FA / 验证码由本人完成**；平台明令禁止 AI 文本的（HN / V2EX），**不代写**。
4. **网络先验证**：能打开站点不等于能调它的 API（`curl -v` 看 TLS，别把 DNS 问题当账号问题）。

---

## 1. 渠道矩阵（我们的生态，按「每单位努力换来的可见性」排）

| 顺序 | 渠道 | 能做什么 | 不能做什么 | 验证方式 | 谁 |
|---|---|---|---|---|---|
| **1** | **上游 Discussions 的故障帖** | 给一条以只读命令开头的长答案 | 在已答帖下重复发；同一分钟连发多条；为推广而答 | `gh api graphql` 读 `comments.totalCount` 必须为 0；发完回填 `outreach.json` | agent 备稿 + 发（HUMAN 授权） |
| 2 | **仓库页**（description / topics / social preview / README 首屏） | 决定「点进来 30 秒懂不懂」 | 把下载量写进首屏；承诺运行期 | `gh api repos/... --jq .homepage`；社交预览取回 1280×640 比对 | agent |
| 3 | **市场目录**（awesome-dsh-plugin / dsh.so / dsh-pluginmarket） | 提交条目、补 `icon`、改一行描述 | 催合并；改别人的索引；把「已合并」说成「已上线」 | 站点 `/plugins.json` 的字段 + 详情页 200 | agent 提交，维护者合并 |
| 4 | **npm** | 包版本、README（npm 页面渲染的就是它） | 把下载总量当用户数；改旧版本的数字 | `npm view` / `npm pack` 逐字节比对 | agent |
| 5 | **dev.to** | 可 API 发布（需 key）；长文 + 封面图 | 一天发多篇同义内容；把自家文章算成第三方信号 | `GET /api/articles/<id>` 读回标题/时间 | agent |
| 6 | **X / 即刻** | 短帖 / 线程，GIF 或图 | 同一条既 GIF 又图；未登录访客看不到就以为被删 | `publish.twitter.com/oembed?url=` | agent 起稿，HUMAN 发 |
| 7 | **Reddit** | 按版规发链接或文本 | 同一天同文案连发多版；绕过站级过滤 | 帖 JSON 的 `removed_by_category`；`/new/` 是否出现 | HUMAN |
| 8 | **HN / V2EX** | **只交事实卡** | **明文禁止 AI 生成正文（含润色）——不代写、不发** | 不适用 | HUMAN |
| 9 | **awesome 列表** | 一行描述 + 表单/PR | 用 PR/API 绕过「仅 collaborator」的入口 | 表单页是否 `Action restricted` | HUMAN |

**顺序的道理**：先让「能被搜到」和「30 秒懂」成立，再引人来；反过来就是把半成品摊在门口。

---

## 2. 去 AI 化的写作规则

原方案的四条结构照搬：**一个具体场景 → 它具体是什么 → 一条可复现的数字 → 一条它做不到的事 → 一个具体问题**。
中文 150–250 字、英文 120–200 词；第一人称、短句、具体名词；一条链接放在正文靠后。

**删掉**：破折号连用、三段排比、`强大 / 无缝 / 优雅 / 赋能 / 一站式`、`不是 X 而是 Y`、`不仅…而且…`、
emoji 当小标题、只列功能没有场景、**把下载量 / 排名 / star 当成绩**。

**我们额外要守的三条**（本仓独有，写在 `docs/copy/README.md` §5）：

1. 没有产物指针的数字**不写**；
2. 声明层放行**不等于**运行期保证（「升级会修好」「装了就没事」是禁语）；
3. 边界句原样保留（中英各一句，见 `docs/copy/facts/*.md`）。

---

## 3. 一次宣传的固定顺序

```
0. 事实卡（命令现取，见 promotion.md）
1. 资产：社交预览 1280×640、封面图、截图（都从产物生成，不手绘数字）
2. 仓库设置（description / topics / social preview）
3. 上游回答（有故障帖就答，没有就不发）
4. 市场条目（icon / 描述 / 版本一致性）
5. 长文（dev.to 或同类）
6. 24 小时 / 1 周测量（record_traffic）
```

同一主题一周内不要重复发；同一文案不要在同一天进两个社区。

---

## 4. 每个渠道的验证命令

### 4.1 上游回答

```powershell
# 发之前：还开着吗、还有人没回吗
node scripts/record_discussion_state.mjs --ids <id>
# 发之后：真的贴上去了吗
gh api graphql -f query='…comments(first:5){totalCount nodes{author{login}}}'
```

判据：`comments.totalCount` 从 0 变成 1，作者是我们，时间戳带时区。**不计入 D5**（`d5_counts: false`）。

### 4.2 仓库页面

```powershell
gh api repos/jjjjjjjjnnjnn/dsh-triage --jq '{description, homepage, topics}'
# 社交预览：GitHub 没有 API，只能走 Settings UI；取回后比尺寸
```

判据：`homepage` 非空、`topics` 含 `dsh-plugin`；社交预览取回成功且 **1280×640**。

### 4.3 市场目录

```powershell
# 站点实际渲染了什么（不是「我们提交了什么」）
node -e "fetch('https://awesome-dsh-plugin.com/plugins.json').then(r=>r.json()).then(j=>{const a=j.plugins||j;const o=a.find(x=>x.name==='dsh-triage#dsh-triage');console.log(o.version,o.icon)})"
```

判据：`icon` 非空、`version` 落在站点自己的刷新节奏上（**滞后不是我们的缺陷**）。

### 4.4 dev.to

```powershell
# 发布（需要 DEVTO_API_KEY）
node scripts/… # 见 docs/copy/drafts 的 devto 草稿说明
# 读回
node -e "fetch('https://dev.to/api/articles/<id>',{headers:{accept:'application/vnd.forem.api-v1+json'}}).then(r=>r.json()).then(j=>console.log(j.title,j.published_at))"
```

判据：标题、`published_at` 带时间；**自家文章不计入 D5**。

### 4.5 Reddit（我们目前没发，规则先记下）

- 发之前读 `https://old.reddit.com/r/<sub>/about/rules`，看账号 karma 与注册时间；
- 发之后必须查 `GET https://www.reddit.com/r/<sub>/comments/<id>.json?raw_json=1`：
  `removed_by_category: "reddit"` = 站级过滤（走 modmail），`"moderator"` = 版规（读 `mod_reason_title`）；
- **不要重发、不要换标题再发**。

---

## 5. 测量

### 5.1 我们已经有的

```powershell
node scripts/record_traffic.mjs --stamp <UTC>      # 浏览 / clone / npm 日序列 / 两个第三方条目
node scripts/record_market_baseline.mjs --stamp <UTC>  # 品类与上游痛点分布
```

判据读数：**唯一访客**是到达的主指标；**clone 与下载不进这四个数**（写进 `docs/research/2026-11-17-traffic-audit.md`）。

### 5.2 我们**没有**的那一条（已探测，如实记）

原方案里最有价值的一个派生指标是 **`latest share`**：
`最新两个版本 的下载 / 全部版本 的下载`，爬虫队形 3–10%、真人 50%+。

**2026-11-18 实测：npm 公开 API 不提供按版本下载量。**

```
GET https://api.npmjs.org/downloads/point/last-week/dsh-triage@0.3.11   → 404 package not found
GET https://api.npmjs.org/downloads/range/last-week/dsh-triage          → 只有按天，没有 versions
```

所以这条指标在我们的渠道里**不可得**（原项目可能是从 Release 资产下载量或私有数据算的）。
替代读数用我们已有的形状判据：`download_shape`（单日爆发 vs 稳态）+ 发布日峰值占周下载的比例。
**结论**：不要在任何对外文案里引用 `latest share`，也不要伪造一个近似值。

### 5.3 每个渠道看什么

| 时间 | 看什么 |
|---|---|
| 24 小时 | 该渠道带来的 referrer、有没有新 issue、评论里问得最多的一个问题 |
| 1 周 | 唯一访客变化、有没有第三方引用（D5 口径）、哪个渠道带来第一个外部 issue |

**只加一个渠道**：没有回声的渠道停掉，把力气加到有回声的那个。

---

## 6. 与冻结区的兼容性（这一节是「确认兼容」）

| 原方案的做法 | 在我们这里 | 依据 |
|---|---|---|
| 用「订阅 / 安装 / 用户数」讲增长 | **禁止**：只能讲唯一访客、第三方向量，且必须标口径 | `docs/specs/D5-measurement.md`、`BS-48` |
| 为曝光加一个小功能 | **禁止**：D5 `fail` 后走 D-3 维护模式 | `docs/11-d-path.md` §D-3 |
| 在多个社区同日同文 | **禁止**：一周内不重复、同日不进两个社区 | 原 playbook §3 + 本仓 `posting-runbook.md` §4 |
| HN / V2EX 代写 | **禁止**：只交事实卡 | 平台规则；`docs/copy/README.md` |
| 刷 star / 互赞 / 买下载 | **禁止**：判据会排除，且属伪造证据 | `PROJECT_RULES.md` 严禁行为 3 |
| 市场条目「已合并」=「已上线」 | **禁止**：两者分开记 | `BS-75` |
| awesome 列表入口关闭就绕过 | **禁止**：记录状态、等入口 | 原 playbook §7.5 |

---

## 7. 交接清单

- [ ] 事实卡现取，数字与 `packages/plugin/package.json` / README 徽章一致（`tests/governance/promotion-fact-card.test.ts` 会复算）
- [ ] 每个渠道的当期规则已读，入口可用（`Action restricted` 就停）
- [ ] 素材已生成且尺寸正确（社交预览 1280×640；封面 1200×630）
- [ ] 文案按 §2 自检：无营销词、有限制、有一个具体问题、边界句原样
- [ ] 发布后验证：评论计数 / 市场字段 / dev.to 读回
- [ ] 回填 `docs/copy/outreach.json`（`d5_counts: false`）
- [ ] 24 小时 / 1 周各跑一次 `record_traffic`，只加一个渠道
