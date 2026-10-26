# 01 · 竞品与上游归因（实测，2026-10-26）

> **Stand**: v0.1.0-skeleton (2026-10-26) | 数据来源：npm registry API（周下载 = `last-week` 窗口）、GitHub API、dsh.so 站点与数据接口、上游 npm 包 README。C 级（推测）结论一律不入表。

## 1. 生态体量

| 指标 | 数值 | 来源 |
|---|---|---|
| npm 上 `dsh-plugin` 关键词包数 | **10,348** | `registry.npmjs.org/-/v1/search?text=keywords:dsh-plugin` |
| 核心 `@deepseek-ai/dsh` 周下载 | **333,455** | npm downloads API |
| dsh.so 注册表收录 | 22,180（21,827 已扫描 / 21,572 沙盒安装 / 13,034 运行实测） | dsh.so 首页 |
| 上游当前版本 | `0.2.1-rc.2` | npm dist-tags |

## 2. 下载量梯队（周下载，实测）

| 排名 | 包 | 周下载 | 类别 |
|---|---|---|---|
| 1 | `dshmarket` | **175,241** | 市场（关键路径） |
| 2 | `dsh-whale-widget` | 53,699 | 装饰 |
| 3 | `dsh-pet` | 46,041 | 娱乐 |
| 4 | `@michengai/dsh-skills-manager` | 26,049 | 管理 |
| 5 | `dsh-cost-meter` | 24,941 | 计量 |
| 6 | `@noob-stupid/dsh-plugin-console` | **3,792** | **升级门控 + 内嵌市场 + 回滚（安全类目第一）** |
| 7 | `dsh-undo-savepoint` | 1,148 | 崩溃救援 |
| 8 | `dsh-doctor` | 709 | 诊断 |
| 9 | `dsh-plugin-guard` | 128 | 隔离 + 回滚 |
| 10 | `@swell05/dsh-whale-tank` | 29 | 开发沙盒 + 体检 |
| — | `dsh-safe` | 6 | **空名占位（v0.0.1）** |

**读法**：榜首是「位置」赢的（Desktop 的 Settings→Plugins 首选市场 + 目录被当索引源分发），不是功能赢的。安全类目天花板目前 **3.8k**，与榜首差 46 倍。

## 3. 上游已经吸收了什么（决定我们不能做什么）

| 时间点 | 上游动作 | 后果 |
|---|---|---|
| 0.1.6-alpha.2 | 内置 `plugin-manager`（装/卸/启停/回滚） | `dsh-web-plugin-manager` 归档（其行 id `plugin-manager` 撞车，会让 0.1.6+ profile **完全无法启动**） |
| 0.1.7 | install 前检查声明兼容 | `nzl153/dsh-preflight` **归档**（README 原话：「DSH 0.1.7 起安装和启动插件时会自行检查兼容性，这个工具不再更新」） |
| 0.2.x | Discover 市场 + 自定义索引源（format 1） | 「做市场」的路被封；但**发布索引源**成为分发渠道 |
| 0.2.x | 版本豁免 `compatibility.json` + `allow-version` | 「给个开关」的路被封；我们只负责**告诉你该不该开** |

## 4. 逐个竞品（只列机制与边界）

| 项目 | 星级/下载 | 做什么 | 结构上看不到什么 |
|---|---|---|---|
| **dsh.so**（站点 + 数据 API，CC BY 4.0） | 22,180 条记录 | 单插件 × dsh 版本的 L1–L5 验证、安全档、榜单 | 干净沙盒单环境；**看不到你的已装集合**；发布时验证 ≠ 运行期行为；无本机归因 |
| **`@noob-stupid/dsh-plugin-console`** | 3,792/wk | 框架升级门控、失败自动回滚、内嵌多源市场 | 版本契约层；不做组合台账与能力归因 |
| **`dsh-plugin-guard`** | 128/wk | 快照 + boot 健康检查 + 自动回滚 + 事故报告（明确声明**不做静态分析**） | 反应式；只判「起不起得来」，需真跑 |
| **`dsh-undo-savepoint`** | 1,148/wk | 配置/插件代码撤销、SAFE MODE、离线 CLI | 事后撤销；不解释根因 |
| **`dsh-doctor`** | 709/wk | 确定性诊断与恢复 | 覆盖面广但停在「症状级」；无组合/无跨用户数据 |
| **`dsh-plugin-conflict-guard`** | 未上 npm（★4） | 仅动态插件（`cordis_define`/`cordis_run`）装前冲突检测，正则提取能力 | 内存台账（重启即丢）、只覆盖动态插件 |
| **`dsh-plugin-gating-hub`** | ★113 | 框架升级门控 + 版本兼容注册表 | 版本维度，非组合维度 |
| **`dsh-plugin-check`** | ★26（作者侧） | 仓库合规检查（清单/patch/构建陷阱/hub 收录） | 作者侧；不判用户环境 |
| **`dsh-whale-tank`** | 29/wk | 独立 `DSH_HOME` 沙盒 + 三阶段体检（静态/受限动态/LLM 审查） | 面向「开发前体检」，不是日常判断层；无回流 |
| **`nzl153/dsh-preflight`** | ★2（**已归档**） | 装前对撞 profile + 读日志还原根因 | 命中过正题，但**被上游声明门吃掉**，且未上 npm |
| **`LX2000WASD/dsh-web-plugin-manager`** | ★66（**已归档**） | UI 管理 + 质量门 + 冲突分析 | 被上游管理器吃掉；行 id 撞车是反面教材 |
| **`dsh-suite` / `dsh-toolbox` / `conflict-guardian`** | ★63 / ★30 / ★1 | 目录 + 兼容自测 / 预检工具箱 / 启动期冲突检测 | 均为目录或规则层，无组合数据与归因语料 |

## 5. 我们的位置（一句话对照）

- **dsh.so 回答**：这个插件在**某个**干净环境里装得上吗？
- **上游回答**：这个插件在**声明上**与你当前运行时兼容吗？
- **我们回答**：它在你**这台机器、这套 profile、这一堆插件**里，会不会静默消失 / 撞车 / 白屏；如果会，**是谁干的、怎么修**。

## 6. 声明覆盖率实测（支撑「不能只做声明检查」）

抽样 195 个带 `dsh-plugin` / `dsh` 关键词的包，按上游 admission 语义实算（`engines.dsh` 优先 → 否则 dsh peer 全 AND → prerelease 参与）：

| 结果 | 数量 | 占比 |
|---|---|---|
| 会放行（声明通过） | 127 | 65.1% |
| 会被拒（声明失配） | **11** | **5.6%** |
| 无任何声明（不可判） | **57** | **29.2%** |

被拒真实例子：`dsh-web-search-pro`（peer 钉死 `<0.2.1-0`）、`dsh-github-copilot`（`engines.dsh: 0.2.0-rc.2`）、`dsh-find-plugin`（只覆盖 0.1.x）、`@huanlin/dsh-plugin-better-locale`（`^0.1.5-rc.2`）、`dsh-tiddlywiki`（要求 `>=0.2.1-rc.3`，超前声明）。

**结论**：只做声明检查 → 只覆盖 5.6% 的失败面，还会被上游吃掉；**29% 不可判才是一天的正事**，而这只能靠 probe 与人群数据。
