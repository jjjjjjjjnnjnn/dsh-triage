# 文案通道 · Copy channel

> **谁写**：Gemini（外部文案 agent）。**谁给事实**：工程侧（DeepSeek agent）。
> **为什么分开**：文案最贵的错误不是「不好看」，是**数字好看但不对**。所以本仓的规则是
> **事实先于文字**：没有事实包的文案不写，没有产物指针的数字不出现。

---

## 1. 分工（一句话）

| 角色 | 负责 | 不负责 |
|---|---|---|
| **Gemini**（`copywriter`） | 措辞 / 结构 / 标题 / 中英转换 / 截图说明 / 设计草稿 | 发明数字、改判据、决定发不发、回填 `data/results` |
| **工程 agent**（DeepSeek） | 真跑产物 / 算出数字 / 给命令与边界 / 机器校验 | 在没有事实包时写对外文案 |
| **HUMAN / arbiter** | 决定发不发、以谁的身份发 | 替模型猜一个数字 |

**模型纪律（HUMAN 2026-11-05）**：opencode 里**只用 DeepSeek**；文案由外部 `agy` 调用
`gemini-3.8-flash-high` 生成（`agy --model gemini-3.8-flash-high --print=<prompt>`），prompt 里只给事实包与规则。
不要把 opencode 的 Gemini 供应商当文案通道（实测会因余额失败，见 `BS-58`）。

## 2. 流向（只有一条）

```
工程侧：docs/copy/facts/<ticket>.md        事实包（产物路径 + sha256 + 精确数字 + 边界 + 命令）
   ↓
Gemini：docs/copy/drafts/<ticket>.md       草稿（paste 块 + 声明 claims）
   ↓
机器：node scripts/check_listing.mjs ...    对 T-810 系草稿复算声明
      npx node --test tests/governance/copy-channel.test.ts   对事实包/草稿做结构校验
   ↓
发布：docs/distribution/posting-runbook.md 的规则（先读状态、发完回填）
```

**事实包是唯一允许的数字来源。** 草稿里出现事实包以外的数字，视为缺陷，不是「润色」。

## 3. 事实包的格式（工程侧写）

```markdown
# <ticket> · <一句话场景>

- 渠道 / 语言 / 受众：
- 帖子状态：open / answered / closed / unreadable（读法见 `scripts/lib/discussion-state.mjs`）
- 产物：
  - `data/results/<file>.json`（sha256 `<hex>`）
- 精确数字：
  - `<package>@<version>` → `admitted|denied|unconstrained|unreadable`，`<n>` 项 peer/engines
- 可以说什么：
  - …
- 不可以说：
  - 「升级会修好」/「装了就没事」/「100% 兼容」/ 任何没有产物的比例
- 边界句（必须原样进正文）：`以上判的是 npm 上已发布的版本，不是你那台机器。`
```

## 4. 草稿的格式（Gemini 写）

- 顶部一行 `<!-- facts: docs/copy/facts/<ticket>.md -->`；
- 正文放在 `<!-- paste:start -->` 与 `<!-- paste:end -->` 之间，**块内只放将粘贴的字**；
- 每条数字都能在事实包里找到；
- 边界句原样保留；
- 结尾不写个人身份，用项目口吻。

## 5. 红线（机器会查的）

1. **没有产物指针的数字** → 不写；
2. **把声明层放行写成运行期保证**（「升级会修好」「装了就没事」）→ 禁止；
3. **把推广当证据**：D5 只数 `#11813` 的 reactions 与外部引用，其他渠道的回复不进 D5（`docs/distribution/channels.json`）；
4. **发到已被回答的帖子**：`answered` → 不发；`unreadable` → 不许当成 `open`；
5. 不写个人身份（邮箱 / 微信 / 个人主页），不承诺响应时间，不催维护者。

## 6. 相关文件

- 角色卡：`.agents/roles/copywriter.md`
- 文风与禁用话术：`docs/copy/STYLE.md`
- 已发记录：`docs/copy/outreach.json`（thread / comment URL / `posted_on` / 引用的产物 / 是否计入 D5）
- 发帖规则：`docs/distribution/posting-runbook.md`
- 上架文案的机器校验：`scripts/check_listing.mjs`（17 条）
- 本通道的结构校验：`tests/governance/copy-channel.test.ts`
