# spec · M2-a 运行时台账（`pluginInventory` 相位）

> **Stand**: R7 (2026-10-27)｜上游基线 `@deepseek-ai/dsh@0.2.1-rc.2`，取证同时覆盖 `0.2.1-rc.3`｜状态：契约已锁定（A 级）；**P2 已交付**（`audit --snapshot` + 门 `inventory-contract` + `scripts/render_inventory.mjs`），**P1 与真机采样仍待**（见 §8）
> 证据：`data/results/upstream-0.2.1-rc.3-2026-10-26T00-00-00.000Z.json`（沙箱实测）＋ `data/results/inventory-2026-10-27T00-00-00.000Z.json`（合成样本判定）＋ npm tarball 原文（见 §2 来源列）

## 1. 为什么需要这一层

M1 只能回答「**声明层**为什么被拒」。它结构上看不见：

- 声明通过但 `apply()` 抛错 → 行存在、能力不在；
- 声明通过但运行时版本比包要求新/旧，被 loader 禁用（CASE-11080 就是这一类，只是它恰好也能被行级 admission 静态捕获）；
- 行被 `disabled: true` 或祖先 group 关掉；
- 声明与实跑不一致（行在、相位 `failed`）。

这一层给出**相位**，也就是用户嘴里的「它到底跑没跑起来」。

## 2. 契约（A 级：从生成产物读出，不凭记忆）

| 项 | 值 | 来源 |
|---|---|---|
| Remote 方法 | `pluginInventory/list` → `Promise<RemoteResult<PluginInventorySnapshot>>` | `@deepseek-ai/dsh-host-plugin-inventory@0.2.1-rc.2` 的 `lib/typert.remote-client.d.ts` |
| 传输 | Typert Remote：Host 侧 `@deepseek-ai/dsh-api-gateway`，客户端线 `@deepseek-ai/dsh-client-connection`（HTTP-up / WebSocket-down）；也可在进程内直接 `ctx.pluginInventory` | 同上 + npm 包描述 |
| 许可 | MIT（上游） | 包 `license` 字段 |
| 版本差异 | `0.1.0-rc.6` **没有**该服务；`0.2.1-rc.2` / `rc.3` 有 | 本机 profile 实测 + 沙箱实测 |

```ts
interface PluginInventorySnapshot {
  managementAvailable?: boolean
  entries: {
    entryId: string
    moduleName: string               // 行 import 的模块说明符
    meta?: { title?: string | LocalizedString; description?: string; icon?: string; error?: string }
    enabled: boolean                 // 有效启用态（含祖先 group）
    fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
  }[]
  agentPresets?: {
    id: string; name?: string; isDefault: boolean; broken?: string
    rows: { entryId: string | null; moduleName: string; enabled: boolean | 'conditional'; condition?: string; fiberPhase: … }[]
  }[]
}
```

> `fiberPhase` 的枚举顺序与拼写以生成的 zod schema 为准，`scripts/bootstrap_upstream.mjs` 每次运行都会**从安装产物重新读取**并写入 SSOT，防止我们抄错或上游改名。

## 3. 相位到结论的映射（实现判据）

| 相位 / 状态 | 结论 | reason | remediation |
|---|---|---|---|
| `active` | 不产生 verdict（bundle 已判） | — | — |
| `failed` | `blocked` | `runtime.fiber-failed` | `disable-entry` / `report` |
| `null` 且 `enabled: true` | `blocked` | `runtime.no-fiber` | `disable-entry` + `report`（这就是 CASE-11080 的 `phase=no-fiber`） |
| `null` 且 `enabled: false` | `risky`（**不是** blocked） | `runtime.disabled` | `disable-entry`（提示是显式禁用，不是失败） |
| `enabled: false` 任何相位 | `risky` | `runtime.disabled` | 同上 |
| `pending` / `loading` / `unloading` | 不产生 verdict（瞬态；重复采样会抖） | — | — |
| 快照里没有、声明里有、且 id 能唯一对上 | `unknown` | `runtime.missing-entry` | `probe`（要 M3 才能定） |
| 声明里的 id 对上**多个**运行时行（同名 row 在不同 group 下） | `unknown`，**不猜归属** | `runtime.ambiguous-entry` | `probe`；缺 `missing.row-identity` |
| 快照里有、声明里没有（且该行 `enabled`） | `risky`（信息级） | `runtime.undeclared-entry` | `report`（可能来自 preset 或动态挂载；被禁用的行只报 `runtime.disabled`，不重复判「在跑」） |

### §3.1 preset 维度（T-112）

上游把 preset 行的 `fiberPhase` 定义为「组合活着时的 root fiber 相位；否则为 null」。因此 preset 行**不能**照抄主表：主表的 `null` + 启用 = CASE-11080（声明了没加载），preset 的 `null` 只是「没有会话组合过它」。判法因此单列一行一档：

| preset 行状态 | 结论 | reason | remediation |
|---|---|---|---|
| preset `broken`（读不出组合） | `unknown`（仍列出，带原因） | `runtime.preset-unjudged` | `probe`；缺 `missing.preset-phase` |
| `enabled: 'conditional'` | `unknown`（只有会话上下文能求值） | `runtime.preset-conditional` | `probe`；缺 `missing.preset-context` |
| `enabled: true` 且 `fiberPhase: failed` | `blocked` | `runtime.preset-fiber-failed` | `disable-entry` + `report` |
| `enabled: true` 且 `fiberPhase: null` | `unknown`（**不是** blocked：可能是从未组合，也可能是拿到 fiber 前失手） | `runtime.preset-no-fiber` | `probe`；缺 `missing.preset-phase` |
| `enabled: false` | 不产生 verdict（组合选择；`minimal` preset 就是由这些行组成的） | — | — |
| 同一 entry 在不同 preset 下相位不同（仅计 `enabled: true` 的行） | `risky`（信息级），**两侧分别成立** | `runtime.preset-divergence` | `report`；禁止取更乐观的那个值 |

### §3.2 id 形态（真机实测，R12）

loader 把 profile 的 `cordis.yml` 包在 `include` group 里，所以 patch 行 `tool-bash` 运行时叫 `include:tool-bash`。比对规则：**精确 id 优先 → 唯一 `*:<id>` 后缀匹配 → 多个候选一律 `runtime.ambiguous-entry`，绝不挑一个**。比对还必须**同包**（`packageNameOf` 归一到包名）：只比 id 时，声明 `tools` 会被一条 `other:tools`（加载 `@other/pkg`）满足，真缺失被野行抵消成「一切正常」。做过这两条之前，同一份健康 Host 会产出 96 条「声明了但不在」（假阴）+ 195 条「在跑但没声明」（假阳）。

**硬约束**：

1. `fiberPhase` 是 `measured-local` 证据，必须带 `at`（采样时间）与 `profile`；不得标成 `declared`；
2. 结论**不得**升格为安全结论（铁律 §严禁行为 2）；证据的 `method` 必须与真实传输一致——进程内投影写 `readPluginInventory (in-process projection)`，只有真的走 Remote 才写 `plugin-inventory/list`，未声明传输写 `inventory snapshot (transport unstated)`；
3. 同一 `entryId` 在不同 preset 下相位不同 → 以 preset 维度分开出 verdict，禁止取「最乐观值」。

## 4. 传输路径（先做便宜的，不逆向鉴权）

| 路径 | 优点 | 风险 | 顺序 |
|---|---|---|---|
| **P1 进程内**：`packages/plugin/src/host.ts` 注册 `compat_inventory` 工具，用 `ctx.pluginInventory.list()` | 零传输层逆向；类型来自 peer 依赖 | 需要在 DSH 里跑（agent 工具调用） | ① 先做 |
| **P2 快照文件**：`audit --snapshot <file>` 读 P1 导出的 JSON | 离线可测、可复现、可上 CI（fixture） | 用户要多一步 | ① 同批 |
| **P3 直连网关**：CLI 用 `dsh-client-connection` 连本机 Host | CLI 一条命令拿到实时相位 | 网关地址/主体（principal）鉴权未验证；**未验证前禁止实现** | ② 取证后再定 |

P1/P2 的 schema 校验必须是**防御式**的：未知字段进 `raw` 不猜测（同 `docs/02 §3.3`）。

## 5. 验收判据（T-201 出口）

| # | 判据 | 方式 |
|---|---|---|
| B1 | `audit` 能显示每行 `active / failed / null(disabled)` | ✅ R12：沙箱真跑（194 行，167 active / 27 disabled），`data/results/inventory-live-2026-10-27T22-00-00.000Z.json` |
| B2 | 静态声明与运行时快照交叉校验，能列出「声明了但没注册」 | ✅ R12：`missing=0`、`undeclared=3`（include 根 group + 2 条动态挂载），Host 侧与 CLI 侧结论逐行一致（`cross_check.agree=true`） |
| B3 | 快照缺项 → `unknown`，绝不 `go`。注意：单行 `fiberPhase` 为 `null`/缺失**不是**「相位缺失」，而是 §3 的 `no-fiber` → `blocked`（fixture `phase-key-absent-is-no-fiber` 锁死） | 负对照：删掉快照字段 |
| B4 | 采样时间与 profile 进入证据，且 JSON 脱敏 | `results-privacy` 门 + e2e 断言；R12 另修 `file:///` 百分号编码路径的泄漏 |
| B5 | 新门 `inventory-contract` 可被 `--mutate` 打红 | `node scripts/gate.mjs --mutate` |

## 6. 负对照

| 场景 | 期望 |
|---|---|
| 快照为空数组 | 每个「声明有」的行出 `unknown`，不得静默 |
| `fiberPhase: null` + `enabled: true` | `blocked`（真失败），不得当「没启用」放过 |
| `fiberPhase: null` + `enabled: false` | `risky`，文案必须说「被显式禁用」 |
| `fiberPhase: failed` | `blocked` + `disable-entry` |
| 快照字段名被上游改名 | 门禁红（schema 断言），而不是静默降级 |
| 同一 entry 在 preset 里 `conditional` | 不判 `go`，标 `unknown` + 需要会话上下文 |
| preset 行 `enabled: true` + `fiberPhase: null` | `unknown`（**不是** blocked：`null` 也覆盖「没有会话组合过它」） |
| preset 读取失败（`broken`） | 仍列出该 preset，出 `unknown` + 原因 |
| 同一 entry 在两个 preset 下相位不同 | 两侧分别出结论 + 一条 `runtime.preset-divergence`，不取更乐观值 |
| 声明 id `x`、运行时 id `include:x` | 视为同一行（唯一后缀匹配）；两个候选时出 `runtime.ambiguous-entry`，不挑 |
| 快照声明 `transport` 但值是未知字符串 | 拒绝解析（`inventory-invalid`），而不是照单全收 |
| 进程内投影的快照 | 证据 `method` 不得写 `plugin-inventory/list` |

## 7. 已知盲区

- 相位是**采样瞬间**的事实，不适合回答「昨晚为什么挂了」——那需要 M3 的 probe 与（后续）事故报告；
- `agentPresets` 只在部署组合了 preset roster 时出现，缺失不等于没有插件；
- 不能从相位推断「工具是否可用」：工具可能注册在 `active` 的插件里，而它自身抛错（需 tools/commands 快照，T-202）；
- **采样需要挂一行探针**（`--patch` launcher 层）。探针行会出现在快照里，产物用 `excluded` 显式排除并写理由；因此「快照行数 = 部署行数 + 1」是预期形态；
- `runtime.preset-no-fiber` 无法区分「从未组合」与「组合后拿到 fiber 前失手」——两者在快照里都是 `null`，只有 M3 probe 能分开。

## 8. 实现记录（R7 起，R12 2026-10-27 补齐 P1）

| 层 | 状态 | 代码 / 证据 |
|---|---|---|
| P1 进程内投影 | ✅ **R12 已交付** | `scripts/probe_hooks/inventory-hook.mjs` 在沙箱 Host 内调用上游导出的 `readPluginInventory(ctx)`（与 Remote 方法同一个函数），等树稳定后落盘；`scripts/record_live_inventory.mjs` 负责挂载、采样、杀树、交叉校验与脱敏 |
| P1 Remote 客户端（真 `pluginInventory/list`） | ⬜ 未做（P3） | 需要 `dsh-client-connection` + token→cookie 的 principal 验证；本轮只做到「同一函数、进程内」，产物已如实标注 `transport=in-process-projection` |
| P2 快照文件（`audit --snapshot <file>`） | ✅ 已交付 | `packages/core/src/inventory.ts` + `packages/plugin/src/cli.ts`；`tests/unit/inventory.test.ts` + `tests/e2e/inventory-cli.test.ts` |
| 判定产物（合成） | ✅ 已交付 | `scripts/render_inventory.mjs` → `data/results/inventory-2026-10-27T00-00-00.000Z.json`（`sample.kind=synthetic`；夹具不变，R12 用当前引擎重放） |
| 判定产物（真机） | ✅ **R12 已交付** | `data/results/inventory-live-2026-10-27T22-00-00.000Z.json`（`sample.kind=live`，`transport=in-process-projection`（快照内亦带），194 行（探针已排除），`outcome=sampled`，`cross_check.agree=true`） |
| 门 `inventory-contract` | ✅ 已交付 | fixtures 回放 §3、上游 `fiberPhase` 枚举比对、中英文案存在性、`evidence_method_not` 断言；`--mutate` 可打红 |
| `agentPresets` 维度（§3 硬约束 3） | ✅ **R12 已交付（T-112）** | 按 preset 分行判：`conditional` / `failed` / `no-fiber` / `broken` / 跨 preset 分歧；禁用的 preset 行不刷屏 |

**验证边界（必读）**：
- B1/B2 现在有**真机**证据，但产地是**仓内沙盒** `sandbox/upstream/0.2.1-rc.4`，不是用户的 `~/.dsh`（本机真实 profile 是 0.1.0-rc.6，没有 `pluginInventory`）。对外口径：**「在一台真起的 0.2.1-rc.4 Host 上实测过」**，不能说「在用户机器上实测过」。
- 该真机样本里没有 `failed` 行、没有 `conditional` preset 行、没有 broken preset——这三档只由夹具与负对照覆盖（`data/results` 的合成样本 + `tests/fixtures/inventory/cases.json`）。
- 合成样本夹具：`data/fixtures/inventory/desktop-web-2026-10-26.json`；重放用的最小 profile：`tests/fixtures/env/home/profiles/desktop/package.json`。
