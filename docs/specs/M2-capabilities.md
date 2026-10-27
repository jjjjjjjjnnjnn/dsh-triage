# spec · M2-b 能力层（工具注册表：事实 + 因果差分）

> **Stand**: R13 (2026-10-27)｜上游 `@deepseek-ai/dsh@0.2.1-rc.4`｜状态：**事实层已交付**，判断层受三条硬边界限制（§2）
> 证据：`data/results/capabilities-2026-10-27T23-30-00.000Z.json`（`outcome=expectation-not-met`，这就是本文档要解释的那条结论）· `data/results/inventory-live-2026-10-27T22-00-00.000Z.json`

## 1. 这一层想回答什么

相位层（`docs/specs/M2-inventory.md`）能说「这一行有没有跑起来」。用户嘴里的「工具不见了」还差一步：**行是 active，但工具没注册上**。理想形态是「声明了工具 X 但注册表里没有 X」。

## 2. 三条硬边界（都实测过，不是推测）

| # | 边界 | 取证 | 后果 |
|---|---|---|---|
| B1 | **插件不静态声明工具名** | `dsh-tool-bash` / `dsh-tool-fs` / `dsh-plugin-manager` / `dsh-skill-filesystem` 的 `package.json` 里没有 `dsh` 字段；`bash` 只出现在构建产物 `defineTool({ name: 'bash' })` 里 | 「声明了但没注册」**不可判**。要判就得我们自带一张「插件→工具」映射表——那是猜，违反 `PROJECT_RULES.md` 的铁律 |
| B2 | **工具注册在 agent / preset 作用域** | 进程级探针调 `ctx.tools.schemas()` 只拿到 **1** 个工具（`working_directory`）；preset 里的 `tool-bash` 等行是 `active`，但它们的工具不在这份清单里 | 进程级探针只能读**全局层**。要读某个 preset 的表面，需要真实会话或 M3 probe |
| B3 | **`ptc` 把模型可见面折叠成 `run_code`** | 不强制 native 视图时，`schemas()` 只返回 `run_code`；`ctx.tools.presentAs('native')` 是公开 API，但它改的是**调用者 scope** 的呈现，不是注册表内容 | 采样必须记录 `presentation`，否则「只有 1 个工具」会被读成「这个部署没有工具」 |

**因此本层交付的是事实与差分，不是「缺失工具」结论**：

- 事实：注册表在某一刻**能看到**的工具名清单（含读取失败的区分：`registry: null` ≠ 空清单）；
- 差分：两次采样之间谁消失、谁新增——这是 T-114（bisect）缺的原语；
- 边界：读不到的那部分**写在产物里**（`boundary.cannot_judge` / `cannot_reach` / `cannot_see_mode`），不是静默。

## 3. 契约（防御式解析）

```ts
interface CapabilitySnapshot {
  registry: 'tools' | null      // null = 没有工具服务；不是「0 个工具」
  tools: { name: string; description: string | null }[]   // 按 name 升序
  sampledAt: string
  transport: 'remote' | 'in-process-projection' | null
  unjudged: string[]            // 本轮不读：commands / skills / settings
  readError: string | null      // 读失败的**原因**，与空清单分开
  presentation: string | null   // 这次读是在哪种呈现下拿到的
  presentationError: string | null
}
```

拒绝条件（`capabilities-invalid`，每条都带位置）：

- `capabilities` 不是对象 / `tools` 不是数组；
- 工具没有 `name`（空串或非字符串）；
- 同一份快照里同名工具出现两次（Host 本身会拒绝重复注册，出现即说明样本是手工拼的）；
- `registry` 既不是 `'tools'` 也不是 `null`；
- `transport` 不在枚举内。

## 4. 差分（`diffCapabilities`）

| 字段 | 含义 |
|---|---|
| `removed` | 基线有、第二次没有（升序） |
| `added` | 基线没有、第二次有（升序） |
| `unchanged` | 两次都在的**数量**（用来证明比较不是空对空） |

差分**不是结论**：同一份 `removed` 在「你关掉了这一行」和「某个无关插件崩了」两种情形下都成立。谁产生这份差分由调用方声明（`experiment.disabled_patch_row`）。

## 5. 因果实验（`scripts/record_live_capabilities.mjs`）

| 步 | 做什么 |
|---|---|
| A | 按部署原样启动沙箱 Host，采一次能力清单 |
| B | 用 launcher overlay **禁用一行**（`--disable <patch-row-id>`，注意是 patch 里的 id，不是运行时的 `include:<id>`），再采一次 |
| C | 差分 + 记录实验前提（禁用了哪一行、它的运行时 id 与禁用后的相位） |
| D | 若给了 `--expect`，记录 `expectation_met`；**不满足是发现，不是基础设施故障** |

## 6. 负对照

| 场景 | 期望 |
|---|---|
| 没有工具服务 | `registry: null` 且 `tools: []`，**不得**与「有服务但 0 个工具」混为一谈 |
| 读取抛错 | `read_error` 非空 + 记录器把该条判成 blocker（`registry-read`），不得当成空清单 |
| 工具同名两次 | 拒绝解析（`capabilities-invalid`），不得静默去重 |
| 期望未达成 | 产物 `outcome=expectation-not-met` + `expectation_met=false`，脚本 exit 1 |
| 两次采样完全相同 | `removed`/`added` 为空、`unchanged` = 两次都在的数量（证明比较发生了） |

## 7. 已知盲区

- **B2 是主要盲区**：进程级探针读不到 preset 作用域的工具。R13 的实测就是这条：期望 `read/write/edit/read_image` 在禁用 `tool-fs` 后消失，实际两次都只有 `working_directory`——**不是实验失败，是这条路到此为止**。
- 工具名与「谁的」之间没有公开归属信息：`schemas()` 不给注册方，所以即使读到了 preset 表面，也只能说「这个名字在/不在」，不能说「是谁提供的」。
- `commands` / `skills` / `settings` 本轮**不读**（`unjudged`），不得声称已覆盖。

## 8. 下一步（前置已明确）

要跨过 B2，只有两条路，都不在本轮：

1. **真实会话上下文**：在 Host 里挂一个最小的 agent 会话（需要模型凭据 → 标 HUMAN 决策）；
2. **M3 probe**：在隔离 `DSH_HOME` 里真装真跑，用 `--patch` 控制组合，再在会话层采样——这与 T-301/T-114 同一条路。
