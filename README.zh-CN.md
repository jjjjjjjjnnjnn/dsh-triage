# dsh-triage · 分诊台

**在「装得上」和「跑得对」之间做判断层** —— 面向 DeepSeek Harness 插件。

[![npm version](https://img.shields.io/npm/v/dsh-triage.svg)](https://www.npmjs.com/package/dsh-triage)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

DeepSeek Harness（DSH）已经能告诉你插件**装不装得上**。没有人告诉你它在你**这套环境**里**跑不跑得对**——你的 dsh 版本、你的系统、你已经装上的那些插件。

`dsh-triage` 回答用户真正在问的那句话：**「我的插件为什么不见了？」**；以及装之前那个问题：这个候选在你这套环境里活不活得下来。结论在本地算出，每条都带着它来自哪份证据；**没有证据就出 `unknown`**，不会编一个看起来专业的分数。

npm 上 `dsh-triage@0.2.0` · 一个 CLI + 一个 profile bundle · 只读 · 只有你让它读 npm registry 时才联网。

---

## 为什么需要它

| 你看到的 | 你以为 | 实际发生 |
|---|---|---|
| 插件装完了，什么都没出现 | 「插件坏了」 | 它的 `package.json` 没有 `dsh.bundle`，被当成普通依赖装了，从来没进 profile 层 |
| MCP 工具静默消失 | 「MCP 不稳定」 | loader 在 **admission** 阶段拒绝了这一行（声明区间 vs 运行时），整行被摘出组合 |
| DSH 直接起不来 | 「整个 profile 废了」 | loader entry id 重复，或服务名撞车——一行坏，全盘不启动 |

上游确实会把每次拒绝写进运行日志；被列为 deferred work 的是剩下的部分：持久的失败史、provenance、运行期冲突检测（见 `docs/00-vision.md` §2）。于是那条能解释「工具去哪了」的日志，正好在你回头找它的时候已经没了——重启之后。

归因之所以难到需要工具，是因为三件事：

1. **admission 是按 loader 行判的，不是按 bundle 判的。** bundle 通过，引入你那个模块的行仍可能被拒；只查 `package.json#dsh.bundle` 回答的是另一个问题。
2. **声明兼容的版本仍可能 import 失败。** `dsh-tools` 被 hoist 遮蔽、`latest` 标签失步、pnpm 跳过了构建脚本——都长成「装上了，但没注册上」。
3. **沉默不等于通过。** 一个模块既没声明 `@deepseek-ai/dsh*` 区间也没声明 `engines.dsh` 时，声明层本来什么都不会说——除非有东西坚持把它说出来。

## 安装

```sh
# 只用 CLI —— 不动 DSH
npm install -g dsh-triage

# 装进 DSH profile（设置页 tab + Agent 工具 + 只读本地路由）
dsh plugin --profile web add dsh-triage
```

要求 Node `>=22.19`。`dsh plugin` 把参数原样转给 profile 目录里的 pnpm，所以 `add` / `remove` / `why` 的行为与 pnpm 一致。

## 快速上手

下面的输出都来自真实运行，为长度做了裁剪：绝对路径是手工缩写的（`--json` 默认把路径脱敏成 `~`，`--no-redact` 才保留原样），行数和耗时随机器不同。

**1. 先看环境**——哪个 dsh 构建、哪个 profile、哪几个 bundle：

```console
$ dsh-triage env
dsh        0.1.0-rc.6
node       24.15.0 · win32/x64
profile    web (~/.dsh/profiles/web)
bundles    2
  - @deepseek-ai/dsh-base
  - @deepseek-ai/dsh-web-app
```

**2. 问「它为什么不见了」**——`why` 走遍每一条 loader 行，在行上判 admission，并点名这一行、这个模块、以及这一行是从哪来的：

```console
$ dsh-triage why
scanned 2 bundles · 156 loader rows · 128 import targets · dsh 0.1.0-rc.6 · profile web
[UNKNOWN] @deepseek-ai/cordis-plugin-hmr@1.0.16 — 证据不足
  env      dsh 0.1.0-rc.6 · win32/x64 · profile web
  reason   loader row hmr 引入 @deepseek-ai/cordis-plugin-hmr（声明于 bundle:@deepseek-ai/dsh-base）
  reason   row hmr 引入的 @deepseek-ai/cordis-plugin-hmr 没有声明任何 @deepseek-ai/dsh* 区间——沉默不等于通过
  fix      [report] 请作者补上 @deepseek-ai/cordis-plugin-hmr 实际需要的 peer 区间，或做一次隔离实测
  missing  该 row 模块声明的 @deepseek-ai/dsh* peer 区间（或 engines.dsh）
  evidence declared:row, measured-local:runtime
```

`--json` 把同一套推理当数据给出；`--strict` 让任何非 `go` 的结论变成退出码 1。

**3. 装之前先判候选**——声明与运行时是两条独立的证据，而被判 `blocked` 时一定附上能解开的命令：

```console
$ dsh-triage check dsh-cost-meter
[BLOCKED] dsh-cost-meter@1.9.44 — 不可用
  env      dsh 0.1.0-rc.6 · win32/x64 · profile web
  reason   engines.dsh >=0.2.0-rc.1 <0.3.0-0 不含 0.1.0-rc.6
  fix      [allow-version] 为这个精确版本对记录一次显式豁免 -> dsh plugin --profile web allow-version dsh-cost-meter@1.9.44 --dsh-version 0.1.0-rc.6 --accept-risk
  fix      [pin-version] 改装一个声明含 0.1.0-rc.6 的版本（profile: web）
  fix      [probe] 豁免只绕过声明；行为仍未实测
  fix      [upgrade-dsh] 升级 DSH：1 条要求需要更新的运行时（至少 0.2.0-rc.1，当前 0.1.0-rc.6）
  evidence declared:admission, measured-local:runtime, measured-registry:registry-tags
```

registry 读不到的包，退出码 3、并写出真实原因——它不会变成「大概是好的」。

**4. 给已装集合记账**——entry id、服务、工具、命令、设置命名空间，谁占了什么：

```console
$ dsh-triage audit
capability ledger · dsh 0.1.0-rc.6 · profile web
bundle:@deepseek-ai/dsh-base  (78 rows)
  agent  ->  @deepseek-ai/dsh-agent
  hmr    ->  @deepseek-ai/cordis-plugin-hmr  unknown
  ...
row admission: 0 go · 0 blocked/risky · 2 unknown · same engine as `why`
collisions: 0
```

`audit` 与 `why` 共用一个引擎，这是刻意的：两个命令对同一个 profile 各说各话，比只有其中一个更糟。`--snapshot <file>` 用一份录下来的 `pluginInventory` 样本判运行期相位，而不是读活着的 profile。

**5. 在隔离环境里实测**——默认 dry-run，只有加 `--execute` 才真跑：

```console
$ dsh-triage probe dsh-status-rotator
probe plan (dry-run) for dsh-status-rotator
sandbox   DSH_HOME=<tmp>/dsh-triage-probe/dsh-status-rotator-<hash>
profile   web
port      62088
  install  node dsh plugin --profile web add dsh-status-rotator
  boot     node dsh --profile web --patch <generated overlay>
  http     <fetch> http://127.0.0.1:62088/ --redirect manual
  render   <browser> --headless=new --remote-debugging-port=0 <host url from stdout>
warn  installing a candidate may execute third-party build scripts; the plan is dry-run until --execute is passed
note  dry-run: nothing was spawned; pass --execute --dsh-main <path> to run it
```

`--execute` 会把候选装进独立的 `DSH_HOME`、起一次、**在树还活着时**探端口、用无头 Chromium 经 CDP 读挂载出来的 DOM、读候选行的相位，然后无论成败都清理。已测：`boot / http / client-render / inventory`。**未测**：工具/命名空间 diff——产物里写 `unmeasured`，绝不写成通过。

`--help` 里还有两条：

- **`dsh-triage upgrade --to <版本>`** —— 升级 dsh 之前先问：**目标运行时**会拒掉哪些 loader 行与 bundle，四桶（`would-be-denied` / `cannot-tell` / `improved` / `likely-fine`），修复文案与 `why` 同源。默认离线；registry 查询只是注解，**不能**把行从一个桶挪到另一个桶。它只说「会被拒」，不说「会不会坏」。
- **`dsh-triage outcomes`** —— 回流层的本地记录。**默认关闭**：关着的时候不建目录、不建文件。开启后（`--enable`）只存固定的字段白名单（无路径、无主机名、无日志、无自由文本），`--purge` 什么都不剩。**没有任何上传**，这条路径上没有联网代码。

## 它怎么判定

每个判断都是一个 verdict，而 verdict 是一个带四种可能结论的数据结构：

| 结论 | 含义 |
|---|---|
| `go` | 声明允许这个运行时（若来自 `probe`：装上了、起来了、有应答、候选行是 `active`） |
| `risky` | 可用，但有一条具体的保留 |
| `blocked` | 一条具体、点名的拒绝——一定附至少一条修复路径 |
| `unknown` | 证据不足以判——一定附「缺什么」 |

让这些说法不至于退化成口号的，是门禁而不是自觉：

- 每条 verdict 带 `evidence[]`，每项有 `tier / source / method / at`；`confidence.basis` 必须是其中一个 tier。
- tier 五种：`declared`（作者发布的声明）/ `scanned`（对已安装文件做静态读取）/ `measured-local`（这台机器、这一次运行）/ `measured-registry`（registry 事实）/ `inferred`（推断，永不单独构成结论）。
- **没有证据就是 `unknown`**，且 `missingEvidence[]` 非空。「我判不出来」是一等答案，不会被重试成一个猜测。
- 次要通道各守其位：`dsh.compatibility` 与 registry 标签事实只能加 `info` / `warn` 原因，**不得**把结论往上抬成 `go`，也不得往下压成 `blocked`。
- 声明层的 `go` 意思是「这里装得上」，**不是**「验证过能跑」；运行期证据只有 `probe` 能给。
- 它从不说某个插件是安全的——结论枚举里根本没有「安全」这一档。

## 它不做什么

- **不做装 / 卸 / 回滚。** 生命周期归上游 `plugin_manager`；除隔离探针沙盒外，这里任何代码都不写 `~/.dsh`。
- **不做市场 / 目录。** 可以导出一份格式 1 的索引，只收本机实测 `go` 的版本——那是一个带时间戳的筛选，不是排名，而且这个格式里压根没有结论字段可用来排名。
- **不做安全审查。** 恶意代码与供应链问题归 `dsh-vet`、`dsh-plugin-security-review` 或 dsh.so 的安全档。探针会在一次性沙盒里执行候选代码——执行代码与审计代码是相反的事。**本工具不提供安全背书**：任何一条结论都不等于「可以放心运行」。
- **不做作者侧 lint。** 区间形状建议是给装机的人看的建议，不是记在作者账上的报告卡。
- **不建模功能是否可用。** 它能证明插件起来了、画面出来了；它不知道画面背后的功能对不对、接没接上该接的工具、好不好用。工具/命名空间 diff 一直 `unmeasured`，正是因为这个理由。

## 可以自己重跑的证据

这份 README 里没有哪条主张是「说了就算」的，每条都有产出它的东西。

| 主张 | 怎么复现 |
|---|---|
| 构建、类型检查、430 个测试、9 道门 | `pnpm run verify` |
| 这些门真的会红 | `node scripts/gate.mjs --mutate` → `NEGATIVE CONTROL PASSED · 9/9` |
| admission 语义与上游逐条对等 | `data/gold/admission-cases.json` —— 27 条人工签署金标，由 `admission-parity` 门锁死 |
| `why` 在真实故障上点中根因 | `node scripts/d1_report.mjs --stamp <iso>` → 10 个真实案例、9 命中、1 条显式 `unknown`（`data/results/d1-*.json`） |
| npm 包真的装得上 | `data/results/publish-2026-10-29T01-40-00.000Z.json` —— 空 userconfig 的匿名安装、六个包、CLI 可跑、registry 字节与本地 tarball 完全一致 |
| 每一步都被审过 | `audit/step_reviews.json` —— 四轴（正确性 / 可复现 / 合规许可 / SSOT 一致）+ 对抗性反例，由 `step-review` 门重算 sha256 |

`data/results/` 是唯一真相源：每份产物都由 `scripts/` 下的脚本写出，带 `produced_by` 与 `generated_at`，并配 `.sha256`；手填的结果过不了 `ssot` 门。`dsh-triage serve` 在这个目录上开一个只读面板——只绑回环、URL 里一次性 token、拒绝跨源、默认 `POST` 回 403（加 `--allow-execute` 也只回 501，因为那个动作还不存在）。

CI 跑 Node 22 与 24 的 `verify`、一个 Windows 作业、一个 ubuntu 上的真浏览器渲染对照作业、一个「证明每道门都能抓到自己注入的违规」的作业，以及一个发布就绪检查作业。

## 诚实的边界

- **只有一台机器。** 这些数字背后的真机探针全部测于一台 Windows 主机、一个 dsh 运行时。Linux 只跑过 CI 里的渲染对照，**从没跑过真探针**。
- **13 个真实候选里 12 个起得来。** 这是**手挑的便利样本**，不是成功率：Wilson 95% 区间 **0.667–0.986**。诚实说法是「我们挑的 13 个里有 12 个」，永远不是「92% 的插件都能用」。
- **20 秒是等待预算，不是墙钟。** 承诺是 `boot→sample ≤ 20s`（判第一份可用样本）。95 次有载真实观测中位数 12.3s、p90 16.0s（观测占用 58–94% CPU），35 次空载观测中位数 4.9s；**没有一次越过 20s**——但在 ~90% CPU 下最慢一次到 19.8s，余量很薄。整次运行更长：正常候选光 `boot` 步就 15.7–16.2s，而始终不稳定的树仍然要 ~29–30s 才收敛到 `unknown`（`ADR-0008` E 删掉了买不到任何东西的 20s 等待；删之前同一夹具 48.4s）。
- **沙盒不是你的 profile。** 默认是模板 profile；`--copy-profile` 只复制你的声明文件，绝不复制 `node_modules` 或 `.npmrc`。它回答的是「起不起得来、画面出不出来」，不是「塞进我这套组合会不会挂」。
- **对非 Windows 的运行期行为、其它 pnpm 设置，不做任何断言**；沙盒里也没有凭据，所以要 key 的插件会得到一次假阴性。
- 下面的分发状态是某一天的快照，不对明天作任何承诺。

## 当前状态与渠道

- **npm** —— `dsh-triage@0.2.0` 已于 2026-10-29 发布，同批还有 `@dsh-triage/core`、`@dsh-triage/signals`、`@dsh-triage/probe`。
- **PR 开着，但没有合并** —— [dsh-community-plugins #65](https://github.com/zhu1090093659/dsh-community-plugins/pull/65)（合并状态 `BLOCKED`，等审）与 [awesome-deepseekharness #193](https://github.com/awesome-deepseekharness/awesome-deepseek-harness/pull/193)（`APPROVED`，未合并）。提交过 ≠ 被收录。
- **dsh.so** —— 提交包已就绪，尚未提交。
- **除上面这些之外，没有别的渠道已收录本项目**（以上面那份快照为准）。如果某个目录说得更乐观，那是它比证据跑得快。

## 仓库结构

```
packages/core      admission 语义 / 环境指纹 / 能力台账 / verdict（纯函数、离线）
packages/signals   npm registry / dsh.so / hub catalog / 本机产物，每项带证据等级
packages/probe     隔离实测计划 + 执行器 + CDP 渲染判定
packages/plugin    dsh-triage：profile bundle、CLI、设置页 tab、Agent 工具、本地面板
scripts/           9 道零依赖门禁 + 产出 data/results 的真跑脚本
data/gold          人工签署的 admission 金标（上游对等基准）
data/results       SSOT 产物 + .sha256
```

## 参与与交接

从 [`docs/HANDOFF.md`](docs/HANDOFF.md) 开始：五分钟基线检查、当前批次、下一位要做的第一件事。工作规则在 [`PROJECT_RULES.md`](PROJECT_RULES.md)，角色卡与任务包在 [`.agents/README.md`](.agents/README.md)。一步改动只有同时具备**四轴审核**和**可重跑的测试产物**（落进 `data/results/`）才算做完。

## 许可

MIT —— 见 [LICENSE](LICENSE)。来自 [dsh.so](https://www.dsh.so) 的插件注册表事实为 CC BY 4.0，使用处已署名。
