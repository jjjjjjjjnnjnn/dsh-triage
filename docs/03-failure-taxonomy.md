# 03 · 失败分类法 v1（机制 / 症状 / 谁接得住 / 空白）

> **Stand**: v0.1.0-skeleton (2026-10-26) | 每条结论都附来源；无来源的推测不得进入本表

分级：**已覆盖**（有工具/上游能答）、**半覆盖**（能发现不能归因 / 只在特定场景）、**空白**（无人接）。

| # | 失败类 | 机制（源码级） | 用户看到 | 谁接得住 | 空白 |
|---|---|---|---|---|---|
| F1 | **装了没反应：不是 bundle** | `dsh plugin add` 后只有声明 `dsh.bundle.patch` 的包会进入 `dsh.profile.bundles`，否则只是一条普通依赖（上游 CLI 会打一行 warning） | 「装成功了但什么都没有」 | 上游 warning（易被忽略） | ❗ 归因 + 修复建议（把它从 dependencies 变 bundle，或换包） |
| F2 | **启动被拒 → 工具静默消失** | admission：`engines.dsh` 优先，否则 `@deepseek-ai/dsh*` peer 全 AND；不满足 → 该行变 `disabled: true` 被摘掉，模块不 import，工具不注册 | 「MCP 工具凭空少了几个」 | 上游会报告 refusal，但**无 UI、无归因、无历史** | ❗ 「哪一行被拒 / 少了哪些工具 / 怎么修」 |
| F3 | **entry id 撞车 → 整个 profile 起不来** | loader 要求同一组合内**行定义**唯一；重复定义（同 id、不同模块）直接抛（真实案例：第三方管理器占用 `plugin-manager` 行 id，导致 0.1.6+ 无法启动）。⚠️ **注意**：`- id: hmr` + `disabled: true` 这种**纯覆写**是正常机制，不是撞车——本仓曾按「id 分组」误判，在标准 profile 上产生 27 条假阳性（见 `docs/adr/0002`） | 「升级后 DSH 直接打不开」 | 无（报错指向 loader，不指向插件） | ❗ 装前 entry id 占用检查 + 冲突方点名 |
| F4 | **服务/工具/命令/settings 命名空间冲突** | `ctx.tools.register` 同名抛错、`commands.register` 同名失败、service 重复注册失败 | 「某个插件一装，另一个功能就坏」 | `dsh-plugin-conflict-guard`（仅动态插件、内存态、正则） | ❗ 组合级台账 + 装前判断（覆盖静态 bundle） |
| F5 | **声明不可判（无声明）** | 无 `engines.dsh` 且无 dsh peer → admission 无约束放行。实测样本 n=195：**29% 属于此类**，5.6% 当前运行时会被拒 | 「有时能装有时不能」 | 无 | ❗ 只能靠隔离实测（probe）；本仓把结论降级为 `unknown` |
| F6 | **声明超前/滞后（rc 抖动）** | 精确钉死某个 rc（如 `0.2.0-rc.2`）或要求更新 rc（如 `>=0.2.1-rc.3`）→ 每次升级都有一批插件失配 | 「升级 DSH 后一半插件失效」 | 上游 install 门 + 豁免机制 | ❗ 升级影响清单 + 「退到哪个插件版本」 |
| F7 | **白屏但 HTTP 200** | 浏览器半边崩溃，服务端仍返回 200；`curl /` 健康检查看不见 | 「页面全白，但服务是活的」 | `dsh-plugin-guard` 的 client render 信号（它明确记录过这个坑） | ❗ 归类到 probe 的 `client-rendered`断言（本仓已写入计划） |
| F8 | **构建脚本被拦 → 半装状态** | pnpm 阻止未批准的 build script；上游会列 `pendingBuilds`，但残留文件与「装了等于没装」的中间态仍常见 | 「装了一半，报错看不懂」 | 上游报错 | ❗ 状态判定：算「已装未生效」并给 allowBuilds 指引 |
| F9 | **配置层覆盖导致静默失效** | profile patch / home patch 的后置层会整段替换同 id 的 `config`；候选插件的关键 config 被吞 | 「设置改了没效果」 | 无 | ❗ 覆写提示（后继里程碑） |

## 分辨力说明（避免过度承诺）

- F2/F6 我们能在**本机确定性复现**（纯计算，零网络）。
- F5 我们**不能**给结论，只能说 `unknown` 并要求 probe——这正是 probe 存在的理由。
- F9 依赖对 patch 层语义的进一步研究，M2 之后再排期，当前只登记不实现。
