# spec · M2-a 运行时台账（`pluginInventory` 相位）

> **Stand**: R4 (2026-10-26)｜上游基线 `@deepseek-ai/dsh@0.2.1-rc.2`，取证同时覆盖 `0.2.1-rc.3`｜状态：契约已锁定（A 级），实现未开始（T-201 待领）
> 证据：`data/results/upstream-0.2.1-rc.3-2026-10-26T00-00-00.000Z.json`（沙箱实测）＋ npm tarball 原文（见 §2 来源列）

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
| 快照里没有、声明里有 | `unknown` | `runtime.missing-entry` | `probe`（要 M3 才能定） |
| 快照里有、声明里没有 | `risky`（信息级） | `runtime.undeclared-entry` | `report`（可能来自 preset 或动态挂载） |

**硬约束**：

1. `fiberPhase` 是 `measured-local` 证据，必须带 `at`（采样时间）与 `profile`；不得标成 `declared`；
2. 结论**不得**升格为安全结论（铁律 §严禁行为 2）；
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
| B1 | `audit` 能显示每行 `active / failed / null(disabled)` | 沙箱里真跑一次快照 |
| B2 | 静态声明与运行时快照交叉校验，能列出「声明了但没注册」 | fixture + 沙箱各一次 |
| B3 | 相位缺失时结论是 `unknown`，不是 `go` | 负对照：删掉快照字段 |
| B4 | 采样时间与 profile 进入证据，且 JSON 脱敏 | `results-privacy` 门 + e2e 断言 |
| B5 | 新门 `inventory-contract` 可被 `--mutate` 打红（8/8） | `node scripts/gate.mjs --mutate` |

## 6. 负对照（必须在实现前就写好）

| 场景 | 期望 |
|---|---|
| 快照为空数组 | 每个「声明有」的行出 `unknown`，不得静默 |
| `fiberPhase: null` + `enabled: true` | `blocked`（真失败），不得当「没启用」放过 |
| `fiberPhase: null` + `enabled: false` | `risky`，文案必须说「被显式禁用」 |
| `fiberPhase: failed` | `blocked` + `disable-entry` |
| 快照字段名被上游改名 | 门禁红（schema 断言），而不是静默降级 |
| 同一 entry 在 preset 里 `conditional` | 不判 `go`，标 `unknown` + 需要会话上下文 |

## 7. 已知盲区

- 相位是**采样瞬间**的事实，不适合回答「昨晚为什么挂了」——那需要 M3 的 probe 与（后续）事故报告；
- `agentPresets` 只在部署组合了 preset roster 时出现，缺失不等于没有插件；
- 不能从相位推断「工具是否可用」：工具可能注册在 `active` 的插件里，而它自身抛错（需 tools/commands 快照，T-202）。
