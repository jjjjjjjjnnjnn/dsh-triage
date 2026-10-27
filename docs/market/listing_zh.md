# 上架文案（中文，直接可用）

> **Stand**: v0.1.0-skeleton (2026-10-26)｜提交前请把「当前状态」段落改成本轮真实状态，禁提前写完成

## 一句话

**装之前判断该不该装，装完坏了告诉你为什么。**

## 简介（≤120 字）

DSH 插件分诊台：一条命令查出「工具为什么静默消失」——哪一行在 admission 阶段被拒、缺了哪些能力、该敲哪条命令修；装新插件前先判断它在你**这套 dsh 版本 + 系统 + 已装插件**里会不会出事。

## 正文

### 你是不是遇到过

- 装完插件，**什么都没有**；
- MCP 工具**凭空少了几**个，重启也没用；
- 升级 DSH 之后，**半个 profile 起不来**；
- 页面**全白**，可 `curl` 还是 200。

这些都不是玄学，是四类可判定的机制问题：没有 `dsh.bundle`（装了但没进 profile 层）、admission 把整行摘掉（声明区间不含你的运行时）、loader entry id 撞车（整个 profile 不启动）、浏览器半边崩溃（`/` 健康检查看不见）。

### 它能做什么

```sh
dsh-triage why            # 归因：被拒的行 + 影响 + 可直接复制的修复命令
dsh-triage check <包名>   # 装前判断：可装 / 有风险 / 不可用 / 未知
dsh-triage audit          # 能力台账：entry id / 服务 / 工具 归谁所有
dsh-triage probe <包名>   # 隔离实测计划（默认 dry-run，不碰你的 profile）
```

### 它不做什么

- **不提供安全背书**（恶意代码请用 `dsh-vet` / dsh.so 安全档）；
- 不替代官方插件管理器，也不重做快照/回滚；
- 不知道就说 **未知**，绝不编一个「看起来专业」的分数。

### 为什么可信

每条结论都带证据等级：`declared`（作者声明）/ `scanned`（静态扫描）/ `measured-registry`（注册表实测）/ `measured-local`（本机实测）/ `inferred`（推断）。判断规则与上游 `@deepseek-ai/dsh-app-boot` 的 admission 语义**逐条对等**，并由 21 条金标夹具锁死（含 8 条 npm 真实声明快照）。

## 当前状态（提交前必改）

`v0.1.0` 骨架：引擎 / 门禁 / CLI 的 `why`·`audit`·`check` 可用；Web 面板、隔离实测执行器、徽章、索引源按路线图落地（`docs/ROADMAP.md`）。

## 关键词

`dsh` `dsh-plugin` `deepseek-harness` `compat` `diagnostics` `plugin-health` `triage`

## 安装

```sh
npm i -g dsh-triage              # 只用 CLI
dsh plugin --profile web add dsh-triage   # 装进 profile（Web 面板，M4）
```

## 许可与数据署名

代码 MIT。注册表事实来自 [dsh.so](https://www.dsh.so)（CC BY 4.0），展示处已署名。
