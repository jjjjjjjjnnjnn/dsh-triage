# 上架文案（中文，直接可用）

> **Stand**: R62 (2026-11-02)｜**提交前只需确认两个链接活得起来**（仓库 public / npm 已发布 `0.3.2`）——其余数字都是实测，且由 `node scripts/check_listing.mjs` 校验。
> 英文对应版见 `docs/market/listing_en.md`；提交包与渠道状态见 `docs/market/submissions/README.md`；长文见 `docs/posts/`。

## 一句话

**在升级新版本前，一键预检你已安装的插件哪些会被准入规则拦截。**

## 正门：升级日

每次 DSH 发新 rc，问题都很具体：**我这 20 多个插件，升上去还有几个能用？**

```sh
dsh-triage upgrade --to next      # 目标从 npm dist-tags 解析（读一次），然后走同一条判定
dsh-triage upgrade --to 0.2.1-rc.5
```

输出是一张**按你本地已装集合**推演的诊断卡片，四桶分区：`would-be-denied`（存在版本拦截）、`cannot-tell`（未明确声明区间）、`improved`（目标版本放行）、`likely-fine`（无声明冲突）。每个被拦截的条目均附带**具体原因与修复命令**，附一句能直接复制到 Issue/Discussions 的摘要卡片；`--card --out card.md` 把同一份摘要原样落到文件并打印路径。不带 `--to` 时不作判定，仅提示**当前版本**与**可选目标**。

**它答的是别人答不了的那一问**：插件市场告诉你「这个包能不能装」，注册表告诉你「它在干净沙盒里跑不跑得起来」，只有本机诊断能告诉你「**你当前这套插件组合**升上去是否存在兼容性中断」。

## 简介（≤120 字）

DSH 插件分诊台：一条命令查出「插件为什么静默消失」——哪一行在准入（admission）阶段被拒、缺了哪些依赖能力、该执行哪条命令修复；安装新插件前在**隔离的 DSH_HOME** 沙盒中真装真启动，把证据落盘；升级前全面预检目标版本会拦截谁。

## 正文

### 你是不是遇到过

- 装完插件，**什么入口都没有**；
- MCP 工具**凭空少了几个**，重启也没用；
- 升级 DSH 之后，**部分功能无法加载**；
- 页面**全白**，但 `curl` 端口响应正常。

这些都不是玄学，是四类可判定的工程机制问题：缺少 `dsh.bundle`（作为普通依赖安装，未挂载到 Profile 层）、准入评估判定依赖版本不满足（声明区间不含当前运行时）、Loader Entry ID 命名冲突（导致加载中断）、前端浏览器渲染异常（HTTP 探活正常但页面未渲染 DOM）。

### 它能做什么（全部已交付，不是路线图）

```sh
dsh-triage why                     # 归因：拦截条目 + 影响 + 可直接复制的修复命令
dsh-triage check <包>              # 装前预检：go / blocked / unknown + 原因 + 修复
dsh-triage                         # 一屏诊断：是否存在异常 / 哪一条 / 修复建议（等同 status）
dsh-triage audit                   # 当前组合：默认输出诊断结论摘要（全量台账使用 --all）
dsh-triage probe <包> --execute --dsh-main <...>   # 隔离实测：启动 / HTTP / 渲染 / 台账，测试后自动清理
dsh-triage upgrade --to <版本|next|latest>   # 升级预检：目标版本会对哪些插件产生准入阻断（四桶分析；精确版本全程离线）
dsh-triage badge <包>              # 把历史实测证据渲染成 shields 风格 SVG 状态徽章
dsh-triage index --out <文件>      # format-1 索引源：仅收录实测 go 的版本，经上游校验器验证
dsh-triage serve                   # 本地面板：只读、只绑 127.0.0.1、Token + HttpOnly cookie
dsh-triage outcomes                # 本地回流（默认关闭；开启亦零网络，--purge 彻底清理）
dsh-triage env                     # 环境指纹
```

装进 Profile 之后还有两项能力：

- **设置页集成「兼容分诊台」标签**：数据与 CLI **同源**（基于同一本地只读接口，不另作推导）；
- **`compat_verdict` Agent 工具**：让 AI 助手在装插件前主动自检「这个候选插件是否兼容当前环境」。

### 它不做什么

- **不提供安全背书**（防恶意软件与供应链审计请用专门安全工具）；
- **不修改你的 profile**：不安装到你的 profile、不卸载现有插件、不执行回滚（由上游 `plugin_manager` 原生管理）；
- 缺少证据如实判定为**未明确**（`unknown`），不作无事实依据的猜测。

### 为什么可信

每条结论均附带证据等级：`declared` / `scanned` / `measured-registry` / `measured-local` / `inferred`。
判断规则与上游准入语义**逐条对等**，由 **27 条金标**锁死（含 npm 真实声明快照）；`probe` 的每条断言均配有对抗性负对照，测试完成后强制清理环境。

**诚实的边界（请一起读）**：

- 真实候选的实测通过率为 **12/13 = 0.923**（Wilson 95% **0.667–0.986**，属于手挑的便利样本，测于单机单运行时）；
- `boot→sample` 空载中位数 **4.9s**、有载 **12.3s**（p90 16.0s），均未超出 20s 预算——但预算承诺的是「等待至第一份可用样本」，并非「探针全流程 20 秒」；
- 升级影响清单中 `improved`（今天拒、目标放行）目前只有“回到插件钉定的版本”这一种真机形态：扫描范围是 **npm 关键词检索命中的 1584 个包**（基于关键词检索而非全量普查），其中 202 个「当前被拦截」的条目中，能被**更新版本**自动放行的为 **0** 个。因此我们严谨表述为「目标版本会放行它」，绝不说「升级会修好」。

## 当前状态（提交前看一眼）

`0.3.2` 已发布到 npm（四包 `@dsh-triage/core` / `signals` / `probe` + `dsh-triage`，同一版本一起升；新增设置页的「升级预检」四桶页签，判定与 `0.3.1` 完全相同）。M0–M6 的**构建侧**已完成；**分发侧**：三条 PR 待审、`merged 0`（#65 已 rebase、**`MERGEABLE`**，`blocked` 是仓库要求 review、不是冲突；#193 已 approved 且 clean；#140 clean、无 review），但 **dsh.so 已经收录**：`L5 · Run tested`（对 `0.2.1-rc.5`）、安全档 `low`、首次索引 2026-10-29。那个 L5 是 dsh.so 在自己的干净沙盒里跑的一次结果，不是「你的机器上能用」；收录也不等于有人用。详见 `docs/market/submissions/README.md`。

- format-1 索引源（公开 URL，已逐字节校验）：`https://raw.githubusercontent.com/jjjjjjjjnnjnn/dsh-triage/main/docs/market/index.json`
- 徽章：`dsh-triage badge <包>` 生成 SVG（只读已有测量，没有测量就是 `not measured`，不做分数）

## 关键词

`dsh` `dsh-plugin` `deepseek-harness` `compat` `diagnostics` `plugin-health` `triage`

## 安装

```sh
npm i -g dsh-triage                       # 只用 CLI
dsh plugin --profile web add dsh-triage   # 装进 profile：设置页标签 + Agent 工具
```

要求 Node ≥ 22.19、DSH `>=0.2.0-rc.1 <0.3.0-0`（本机实测 0.2.1-rc.4）。

## 许可与数据署名

代码 MIT。本仓**没有**使用 dsh.so 的数据（索引源只读 npm registry 元数据），因此无需 CC BY 署名；若将来引入其信号，署名会补在这里。
