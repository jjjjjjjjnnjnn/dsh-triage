# upstream-attribution · 上游 issue 的事实包：admission 拒绝时缺少归因

> **用途**：`docs/11-d-path.md` 的 D-1（上游贡献）。**只在 D5 判定为 `fail` 之后才发**。
> 工程侧只给事实；英文措辞由外部 `agy --model gemini-3.8-flash-high` 写，HUMAN 决定发不发。

- **渠道 / 语言 / 受众**：`deepseek-ai/deepseek-harness` 的 issue（不是 discussion），英文，维护者与插件作者
- **帖子状态**：**未发**（这不是对某条帖子的回复；`judgeReplyGate` 不适用）
- **这次要做什么**：把「admission 拒绝时用户拿不到可行动的归因」这件事，用**已经落盘的证据**说清楚，
  并给出最小改法；**不提我们的工具、不要求他们采用我们的代码**
- **产物**（本文的数字只允许来自这里）：
  - `data/results/d1-2026-10-26T12-00-00.000Z.json`（sha256 `b998b7cc95b04be87e59332ec031da1fe2fab34430a63aa44e6476edaa7d27f8`）
  - `data/results/question-coverage-2026-11-02T09-57-53-229Z.json`（sha256 `7354f39db3ab48fbaa4d515d408c9b2aed5197854313781cba3b840f1e98e8c4`）
  - `data/results/market-baseline-2026-11-05T10-45-00.000Z.json`（sha256 `b91b627455deaa5b22752b700db2dbcf540ac0e8cb39db2b20496f2fa4eb5076`）
  - `data/results/remedy-probe-2026-11-05T08-01-23-093Z.json`（sha256 `132cec21ca9a89c230616a760065486e6fdda72ced7b89f28857a769278c4f54`，`#10849` 的四个构建）
  - `data/results/remedy-probe-2026-11-05T08-03-35-886Z.json`（sha256 `63b046e9c2cac5a151c5dc8a50d18a5e3b3ffe09ff1fa20bddcc36ecc8c96eac`，`#10458` 的 presentation 两代）
  - `data/results/remedy-probe-2026-11-05T08-06-24-136Z.json`（sha256 `50455dfb5db76bc75985bf4284eb74125869fbeb65e1ca5f7b4e699cf78e989c`，`#12210` 的 `dsh` / `cordis`）
  - `data/results/rescue-2026-11-05T09-32-00-752Z.json`（sha256 `690f43f2d5422e2180015af4aacbcb9ae34026c41372c1fb496e87dc3aa95393`）
  - `data/gold/admission-cases.json`（27 条与上游语义逐条对等的金标；本仓门 `admission-parity` 锁死）

## 精确数字

- **真实案例 10 例，9 命中 / 1 显式 `unknown`**（`hit_rate 0.9`，门槛 8/10）——命中的定义是
  「点名的那一行就是真实根因」，不是「文本看起来像」。
- **27 条 admission 金标**与上游 `@deepseek-ai/dsh-app-boot` 的语义逐条对等（`engines.dsh` 优先 →
  否则 `@deepseek-ai/dsh*` peer 全 AND → prerelease 参与 → 空/非法区间视为不兼容）。
- **Q&A 分类样本 1545 条**：能从**声明层**给出答案的 **74 条（4.8%）**，Wilson 95% **3.8–6.0%**；
  七档 **47 / 27 / 89 / 164 / 90 / 178 / 950**；其中 **950 条**是**分类器没匹配到任何层信号**（`layer=unknown`，
  零信号）——**不能**写成「与声明层无关 = 与我们无关」；R88 的复核把这一档、`needs-their-profile` 与
  `probe-unreadable` 逐条拆开（`data/results/extension-candidates-2026-11-05T16-50-00.000Z.json`）。
  433 个唯一包被探针覆盖，901 次尝试，370 次读不到。
- **最近 876 条讨论**：**379 条是故障（43.26%）**，零回复占比 **67.55%**。
- **三个帖子上的实测差异**（同一套公开声明，不同构建）：

| 帖子 | 构建 | 声明层结论 | 依据 |
|---|---|---|---|
| `#10849` | `@deepseek-ai/dsh-mcp-client@0.2.2-rc.1` | `admitted` | 8 条 peer 全部精确钉到 `0.2.2-rc.1` |
| | `@0.2.1-rc.5` | `denied` | 8 条 peer 全部钉到 `0.2.1-rc.5` |
| | `@0.1.0-rc.7` | `denied` | 6 条 `^0.1.0-rc.7` |
| | `@0.0.1-rc.1` | `denied` | 4 条 `^0.0.1-rc.1` |
| `#10458` | `@deepseek-ai/dsh-agent-tool-presentation@0.2.1-rc.2` | `admitted` | 1 条 peer：`dsh-tools@0.2.1-rc.2` |
| | `@0.2.0-rc.2` | `denied` | 1 条 peer：`dsh-tools@0.2.0-rc.2` |
| `#12210` | `@deepseek-ai/dsh@0.2.2-rc.1` | `unconstrained` | 自己不是插件，不声明对运行时的区间 |
| | `@deepseek-ai/cordis@4.1.0` / `@4.0.5` | `unconstrained` | 同上——**跨家族错配在声明层看不见** |

- **一件事能省多少诊断**：`rescue` 在真实 profile 上只读跑一次，把「哪些 bundle 是第三方、哪些宣布了却没装上」
  分成三态（官方 / 第三方 / 解析不到）并给撤销描述符；同一份逻辑的合成 fixture 是 3 条 → 可裁 1 / 官方
  `unresolved` 1（只报告不裁）。说明「配置与磁盘不一致」这一层完全可以机器分类。

## 可以说什么

- 拒绝是**正确的**（我们复算的 27 条金标与上游语义一致，没有一条分歧）；问题在**拒绝之后的归因**：
  用户看到的是「denied / 装不上 / 行被禁用」，看不到「哪一份副本、被谁带进来、哪一条 peer 挡住了它」。
- 用 `#10849` 与 `#10458` 说明：**同一个包、两个构建，差别只是一条 peer 的精确版本**。这类问题在声明层是可判的，
  但用户拿不到那句话，于是只能贴日志问人。
- 用 `#12210` 说明**声明层的边界**：`dsh` 与 `cordis` 都是 `unconstrained`，跨家族错配在声明层看不到——
  这正是我们**不**声称能判的那一类，也说明「不要用声明层答案覆盖运行期问题」。
- 用 876 / 379 / 67.55% 说明这不是个别现象：故障帖里三分之二零回复。
- 我们自己的实现与它踩过的坑可以公开：行级归因需要读三处（profile manifest、解析落地位置、嵌套副本），
  并且**必须区分「没装上」与「装的是本地路径」**——`rescue` 的规则改动就是这么来的（官方 scope 的
  `unresolved` 只报告不裁，因为解析不到更可能是解析器没看懂布局）。

## 不可以说

- **不能说「上游错了」**：27 条金标零分歧；这是能力缺口，不是缺陷。
- **不能把我们做成「建议你们采用我们的工具」**：D-1 是把机制交出去，不是 BD；issue 里不出现安装命令。
- 不能给「多少比例的用户会遇到」这类比例（样本是 1545 条 Q&A + 876 条讨论，不是普查）。
- 不能把声明层结论说成运行期保证（`unconstrained` ≠ 能跑；`admitted` ≠ 跑得对）。
- 不能提任何我们没测过的平台 / 版本组合（本机只测 Windows + 单 pnpm 版本 + Node 24）。
- 不能把这次贡献和 D5 的失败绑在一起卖惨：issue 里不出现 D5、不出现「我们没人用」。

## 边界句（必须原样进正文）

> This is a declaration-layer analysis of published npm artifacts, not a runtime guarantee, and not a report
> about your machine: `admitted` means the declared ranges accept the target build — nothing more.

---

## 附：为什么这份事实包现在只是「备」的

`docs/adr/0013-upgrade-day-front-door.md` §5.2 写死：D5 不达标 → 执行 D，不做第 N 个功能。
在 `2026-11-15T20:24:37Z` 的判定出来之前，本文件与 `docs/11-d-path.md` 都只是**备用件**，
不得对外引用。判定为 `pass` 时它们转成 A/C 支线的素材（`T-803` / `T-804`），不删。
