# 上架文案（中文，直接可用）

> **Stand**: R38 (2026-10-29)｜**提交前只需确认两个链接活得起来**（仓库 public / npm 已发布）——其余数字都是本轮实测。
> 英文对应版见 `README.md`；索引源与提交包见 `docs/market/submissions/README.md`。

## 一句话

**装之前判断该不该装，装完坏了告诉你为什么。**

## 简介（≤120 字）

DSH 插件分诊台：一条命令查出「工具为什么静默消失」——哪一行在 admission 阶段被拒、缺了哪些能力、该敲哪条命令修；装新插件前先在**隔离的 DSH_HOME** 里真装真启动，把证据落盘。

## 正文

### 你是不是遇到过

- 装完插件，**什么都没有**；
- MCP 工具**凭空少了几个**，重启也没用；
- 升级 DSH 之后，**半个 profile 起不来**；
- 页面**全白**，可 `curl` 还是 200。

这些都不是玄学，是四类可判定的机制问题：没有 `dsh.bundle`（装了但没进 profile 层）、admission 把整行摘掉（声明区间不含你的运行时）、loader entry id 撞车（整个 profile 不启动）、浏览器半边崩溃（`/` 健康检查看不见）。

### 它能做什么（全部已交付，不是路线图）

```sh
dsh-triage why                 # 归因：被拒的行 + 影响 + 可直接复制的修复命令
dsh-triage check <包>          # 装前判断：go / blocked / unknown + 原因 + 修复
dsh-triage audit               # 当前组合：行级 admission 结论 + 副本来源 + 相位
dsh-triage probe <包> --execute --dsh-main <...>   # 隔离实测：boot / http / 渲染 / 台账，跑完必清理
dsh-triage badge <包>          # 把「已经记录过的那次运行」渲染成 shields 风格 SVG
dsh-triage index --out <文件>  # format-1 索引源：只收实测 go 的版本，用上游校验器验证
dsh-triage serve               # 本地面板：只读、只绑 127.0.0.1、token + HttpOnly cookie
```

装进 profile 之后还有两件：

- **设置页里的「分诊台」标签**：数字与 CLI **同源**（同一条只读路由，不是另算一遍）；
- **`compat_verdict` Agent 工具**：让 Agent 在装之前自己问一次「这个候选适合我这个运行时吗」。

### 它不做什么

- **不提供安全背书**（恶意代码请用专门的扫描器）；
- 不安装 / 不卸载 / 不回滚（上游 `plugin_manager` 已接管）；
- 不知道就说 **未知**，绝不编一个「看起来专业」的分数。

### 为什么可信

每条结论都带证据等级：`declared` / `scanned` / `measured-registry` / `measured-local` / `inferred`。
判断规则与上游 `@deepseek-ai/dsh-app-boot` 的 admission 语义**逐条对等**，由 **27 条金标**锁死（含 npm 真实声明快照）；`probe` 的每条断言都有负对照（**39 条**），失败即清理。

**诚实的边界**：真实候选的通过率是 **12/13 = 0.923**（Wilson 95% **0.667–0.986**，手挑的便利样本，单机单运行时）；`boot→sample` 在有载机上中位数 **7.4s**、空载 **4.9s**，两侧都没越过 20s 预算。对外只说这个区间，不说「92% 稳了」。

## 当前状态（提交前看一眼）

`0.1.0` 已于 2026-10-29 发布到 npm（`0.1.1` 是纯文档更新，行为相同）。M0–M4 的**构建侧**已完成：CLI 全套 + 隔离实测执行器 + 设置页标签 + 徽章 + format-1 索引源 + `compat_verdict` Agent 工具。**分发侧**：两条 PR 待前端合并（#65 等审 / #193 已 approved 未合并），dsh.so 只是 `ready`、**尚未提交**。详见 `docs/market/submissions/README.md`。

- format-1 索引源（公开 URL，已校验）：`https://gist.githubusercontent.com/jjjjjjjjnnjnn/3c77dfcb61affb60eb3508f87ca53bea/raw/index.json`
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
