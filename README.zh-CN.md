# dsh-triage — DSH 插件判断层（分诊台）

**分诊台 / Triage** · [`github.com/jjjjjjjjnnjnn/dsh-triage`](https://github.com/jjjjjjjjnnjnn/dsh-triage)

> **状态**：`R15` —— **10 个真实案例已复现（9 命中 / 1 有意 miss）**，D1 决策门以 `data/results/d1-*.json` 机器判定通过；行级 admission 归因 + **运行时相位归因**（`audit --snapshot`）+ **副本来源归因**，以及 **隔离实测执行器**：把候选装进独立 `DSH_HOME`、真起一次、在**进程还活着时**探端口、**用无头 Chromium 经 CDP 判断页面到底有没有挂载出内容**、读候选行的相位、无论成败都清理。仓里带真机样本——包含两份红样本（import 期 / apply 期失败）和一份**白屏对照**（证明渲染判定会红）。**27 条签署过的金标**、188 个测试、9 道门禁。**尚未测**：工具/命名空间 diff——产物里如实写 `unmeasured`，不冒充通过。
>
> DSH 已经能告诉你插件**装不装得上**。没有人告诉你它在你**这套环境**里**跑不跑得对**——你的 dsh 版本、你的系统、你另外那 12 个插件。

## 我们正视的四个真实现象

| 现象 | 你以为 | 实际发生 |
|---|---|---|
| 装完了，什么都没有 | 插件坏了 | `package.json` 没有 `dsh.bundle`，被当成普通依赖装了，从来没进 profile 层 |
| MCP 工具静默消失 | MCP 不稳定 | loader 在 **admission** 阶段拒绝了这一行（声明区间 vs 运行时），整行被摘掉 |
| DSH 直接起不来 | 整个 profile 废了 | loader entry id 重复，或服务名撞车——一行坏，全盘不启动 |
| 白屏但 HTTP 200 | 服务器没事？ | 浏览器半边崩了，对 `/` 做健康检查看不见 |

上游文档写得很直白：被拒绝的行会变成 `disabled: true` 的脱离行——*"every refusal is reported"*，但没有 UI、没有归因、没有持久历史。

## `dsh-triage` 做什么

```
$ dsh-triage why
拒绝    dsh-web-search-pro@0.2.1
       原因   peer @deepseek-ai/dsh-tools@>=0.2.0-rc.2 <0.2.1-0 不含 0.1.0-rc.6
       ...    还有 9 条原因；加 --json 看完整列表
       修复   为这个精确版本对记录一次显式豁免 -> dsh plugin --profile web allow-version dsh-web-search-pro@0.2.1 --dsh-version 0.1.0-rc.6 --accept-risk
              改装一个声明含 0.1.0-rc.6 的版本 / 升级 DSH
```

- **`why`**：把「工具消失 / 白屏 / 起不来」定位到具体某一行，并给出可直接执行的修复命令。确定性、离线、只读。
- **`check <包名>`**：装前判断 `可装 / 有风险 / 不可用 / 未知`，附证据与替代方案（退哪个版本、先禁哪个插件）。
- **`audit`**：当前集合的命名空间台账——entry id / 服务 / 工具 / 命令 / 设置命名空间，谁占了什么。
- **probe**：`dsh-triage probe <包名@版本> --execute --dsh-main <路径>` 在独立 `DSH_HOME` 里真装、真启动，**杀树之前**探端口，**用无头 Chromium 判断页面有没有挂载出可见内容**，读候选行相位，无论成败都清理。已测：`boot / http / client-render / inventory`。**未测**（产物写 `unmeasured`，绝不冒充通过）：工具/命名空间 diff（T-303）。沙盒是模板 profile，不是你现有组合的副本（T-304）——所以它回答的是「起不起得来、画面有没有出来」，不是「装进我这套组合会不会挂」。候选按 ADR-0004 只在临时沙盒执行，源码不进仓。

## 诚实边界

- **不提供安全背书**。恶意代码 / 供应链审计交给 `dsh-vet`、`dsh-plugin-security-review` 或 [dsh.so](https://www.dsh.so) 的安全档。
- **不替代官方插件管理器**，也不重做快照/回滚（那是 `@deepseek-ai/dsh-plugin-manager` 与 `dsh-plugin-guard` 的活）。
- 每条结论都带证据等级——`declared`（作者声明）/ `scanned`（静态扫描）/ `measured-local`（本机实测）/ `measured-registry`（注册表实测）/ `inferred`（推断）。不知道就说 `unknown`，绝不编一个看起来专业的评分。

## 安装

```sh
# 只用 CLI（不动 DSH）
npm i -g dsh-triage

# 装进 DSH profile（Web 面板，M4）
dsh plugin --profile web add dsh-triage
```

## 仓库结构

治理先行，与工作区同级项目同构：铁律 / 门禁 / SSOT / 审计台账 / 隔离区 / 只进不出归档。

```
packages/core      admission 语义 / 环境指纹 / 能力台账 / verdict（纯函数、离线）
packages/signals   npm registry · dsh.so · hub catalog · 本机工具产物（带证据等级）
packages/probe     隔离实测计划与执行器（M3）
packages/plugin    dsh-triage：profile bundle + patch + bin CLI + Web 面板（M4）
scripts/           七道门禁 + 真跑落盘（零依赖，永远可跑）
data/gold          人工签署的金标夹具（admission 对等基准）
data/results       SSOT：脚本产出 JSON + .sha256
```

定位看 [`docs/00-vision.md`](docs/00-vision.md)；九类失败看 [`docs/03-failure-taxonomy.md`](docs/03-failure-taxonomy.md)；生态实测数据看 [`docs/01-competitors.md`](docs/01-competitors.md)（22,180 条注册表 / 10,348 个 npm 包 / 榜首 175k 周下载）。

## 许可

MIT。数据署名：来自 [dsh.so](https://www.dsh.so) 的插件注册表事实为 CC BY 4.0。
