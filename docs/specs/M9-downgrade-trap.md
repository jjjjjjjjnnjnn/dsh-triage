# M9 · 更新提示指向旧代码（downgrade trap）判据

> **Stand**: R84 (2026-11-05)｜**状态**: **已实现**（`packages/core/src/update-order.ts` + `audit --registry`）｜两处实施偏差见 §7
> **这条 spec 回答一件事**：当上游管理器用 **semver 大小**决定「有没有更新」时，我们的工具能补什么证据，
> 以及补进来的东西**不许**改变任何已有结论。
> **来源**：Discussion `deepseek-ai/deepseek-harness#12209`（作者 `xinspark`，DSH `0.2.2-rc.1`），
> 以及我们自己的代码复读与抽样：`data/results/update-trap-2026-11-05T10-40-00-000Z.json`、
> `data/results/update-trap-2026-11-05T10-46-00-000Z.json`。

---

## 1. 现象与为什么它属于我们

上游 `@deepseek-ai/dsh-plugin-manager@0.2.2-rc.1` 的 `newerVersions()` 只做
`semver.valid(v) !== null && semver.gt(v, installed)`，再 `sort(semver.rcompare)`；`time` 与 `dist-tags`
读进来只用于**标注**（`publishedAt` / `tags`），不参与判定。客户端 `updateCandidate()` 取这个降序列表里
第一个「声明了 bundle + 未弃用 + 非预发布」的。

后果：**任何一次「版本号回退式重编号」**（`0.12.x` → `0.2.0`）都会让「更新」按钮指向旧代码；而如果旧构建的
`engines.dsh` 不被当前运行时接受，它在启动时被静默跳过 —— 用户点一下更新，最后可能**一个插件都不剩**。

这属于我们的判断层：我们已经在做的 `admission` 能回答「这个构建会不会被拒」，缺的那一半是
**「这个候选到底是新的还是旧的」**。发布顺序（`time`）与版本顺序（semver）不一致时，后者不是证据。

## 2. 边界（写进代码里的）

1. **只出证据，不改结论**：`downgrade-candidate` 与 `latest-lags` 都是 `measured-registry` 级次要证据，
   不得把 `go` 降成 `blocked`、不得把 `unknown` 升成 `go`（与 `compat-channel` / `version-drift` 同一条纪律）；
2. **只读 registry**：不发安装、不写 profile、不碰 `node_modules`；
3. **不做「哪个版本该装」的推荐**：我们给候选与时间，不给「装这个就没事」；
4. **不代替上游修复**：这是给用户看的事实，不是给上游的补丁；
5. **不追 BU 级覆盖率**：抽样只报样本，不说「生态里有多少包会中招」。

## 3. 判据

| 编号 | 判据 | 由什么证明 |
|---|---|---|
| **M9-C1** | `trap` 的定义：存在已发布候选 `c` 使 `semver.gt(c, installed)`，且 `time[c] < time[installed]`；**并且 `c` 是高于 installed 的最高 semver**（否则报的不是「管理器会给的那个」） | 纯函数 `judgeDowngradeTrap()` + 单测逐条 |
| **M9-C2** | 四个状态严格分开：`trap` / `no-trap`（有更高 semver，但发布更晚）/ `no-candidate`（没有任何更高 semver）/ `unmeasured`（读不到 packument、`time` 缺失或无法解析） | 单测各一条；`unmeasured` **不得**输出成「没有陷阱」|
| **M9-C3** | `latest-lags` 是**独立**字段：`dist-tags.latest` 指向的版本低于该包已发布的最高版本 → 记下来（这是「只信 latest 会漏更新」的证据，不是陷阱） | 单测：`latest` 落后但发布顺序正常 → `trap` 为否、`latest_lags` 为是 |
| **M9-C4** | 输出是纯数据、可复算：无时钟、无网络以外的输入；同一 packument 两次渲染逐字节相同 | 单测比较两次 `JSON.stringify` |
| **M9-C5** | 证据挂载点：**`audit --registry`**（显式联网开关）打印在摘要之后、并进 `audit --json` 的 `update_order` 键；**默认 `audit` 不读网、`--json` 逐字节不变** | e2e：默认 payload 不含 `update_order` 且其余键不变（N6） |
| **M9-C6** | 产物：`produced_by` / `generated_at` / `inputs` / `limits` / 复算命令；抽样必须写明「一条搜索查询的前 N 个包，不是普查」 | `scripts/record_update_trap.mjs`（已存在，见 §5） |
| **M9-C7** | 与 `version-drift` 不重复：`version-drift` 回答「标签失步」，本项回答「候选比已装旧」；两者同时出现时**并排**输出，不合并成一句话 | 单测：同一包同时命中两种 → 两条证据各自存在 |

## 4. 负对照（必须真红）

| 编号 | 构造 | 期望 |
|---|---|---|
| **N1** | 同线 patch：`installed 0.2.5`，候选 `0.2.6`，发布时间更晚 | `trap = false` |
| **N2** | 回退式重编号：`installed 0.2.6`，候选 `0.12.3` 且发布时间早 | `trap = true`（且 `days_older > 0`） |
| **N3** | 候选 semver 更高但发布更晚 | `trap = false`（这条与 N2 方向相反，防止「一律报陷阱」） |
| **N4** | packument 读不到 | `unmeasured`，**不是** `no-candidate` |
| **N5** | `time` 里缺候选的时间戳 | `unmeasured`，不许按 semver 猜 |
| **N6** | 把这条证据挂上之后重跑 `audit --json` | 所有 `conclusion` / `reasons` 与挂载前**逐字节相同**（证明只加证据） |

## 5. 已有的采证器（不算实现）

`scripts/record_update_trap.mjs` 已经在用，产出两份 SSOT：

| 产物 | 读数 |
|---|---|
| `data/results/update-trap-2026-11-05T10-40-00-000Z.json` | 4 个指定包：`traps 0 / 4`；`dsh-win-pwsh7@0.2.6` → `no-newer`；`@deepseek-ai/dsh@0.2.1-rc.5` 的最高候选 `0.2.2-rc.1` 发布于它**之后** 5.8 天 |
| `data/results/update-trap-2026-11-05T10-46-00-000Z.json` | npm 搜索 `dsh` 的前 60 个包：`traps 0 / 60`（`no-newer` 38 · `no-trap` 22），其中 **22 个**包的 `latest` 低于最高已发布版本 |

**两条必须一起说的边界**：
1. 抽样**没有找到活的陷阱实例**——机制在代码里是真的，但要复现必须「同一线的两条版本线都还发布着」；
2. 因此本项的价值不是「抓到了多少」，而是**当一个包真的回退重编号时，我们能在用户点按钮之前说出「这个更高」不等于「更新」**。

## 6. 实现时要动的文件（预估）

- `packages/core/src/version-drift.ts`（新纯函数 `judgeDowngradeTrap()`，或同目录新模块 `update-order.ts`）；
- `packages/plugin/src/cli.ts`（`check --explain` 与 `audit --all` 的次要证据区，各一处）；
- `tests/unit/update-order.test.ts`（M9-C1…C7）；
- `tests/governance/`：金标 `audit --json` 前后逐字节相同的断言（N6）。

**不做**：不改 `admission.ts`、不改四桶、不改 `improved` 五门槛、不改 `data/gold/`、不改任何阈值。

---

## 7. 实施记录（R84）· 两处按实测偏离 spec 原文

1. **状态从「三态」变「四态」**：原文只列 `trap` / `no-candidate` / `unmeasured`。实现时发现
   「有更高 semver，但发布更晚」既不是 `no-candidate`（有候选）也不是 `trap`（不是陷阱），
   硬塞进前两者都会让输出说一句假话。新增 **`no-trap`**，并把 N1 / N3 两条方向相反的负对照
   各自钉住一个方向（`true ? 'trap'` → N1/N3 红；`false ? 'trap'` → N2 红）。
2. **挂载点从 `check --explain` + `audit --all` 改成 `audit --registry`**：
   - `check <pkg@ver>` 判的是**候选**，它不知道「已装的是哪个」；在那里算「候选比已装旧」需要用户
     再给一个版本号 —— 那是另一条命令的形状，不是 `--explain`。硬做会让 `check` 的输出多一个
     「你猜的已装版本」输入；
   - `audit` 的契约是**离线**。把 registry 读进默认路径会让所有自动化依赖 npm 可达，并破坏
     「`audit --json` 与面板同源、逐字节不变」。所以改成 `--registry` 显式开关（与 `upgrade --registry`
     同一个旗标名），默认路径零变化（N6 钉住）；
   - `latest-lags`（C3）在 `check --explain` 里**已经**由 `version-drift` 的 `latest-behind`
     报告，再写一行等于同一件事说两遍 —— 按 C7「并排但不合并」的纪律，本项不再重复输出。

**落地清单**：`packages/core/src/update-order.ts`（`judgeUpdateOrder`）· `packages/core/src/index.ts`（导出）·
`packages/plugin/src/cli.ts`（`collectUpdateOrders` / `renderUpdateOrder` / `audit --registry`，中英 usage）·
`packages/plugin/src/audit-data.ts`（`update_order` 仅在显式提供时出现）· `tests/unit/update-order.test.ts`（12 条）·
`tests/e2e/audit-registry.test.ts`（N6）· `scripts/record_update_order.mjs` + 产物
`data/results/update-order-2026-11-05T11-30-00-000Z.json`（live 3 行 `no-trap` + 5 条纯函数用例全过）。

**证据边界**：live 半边读的是**本机沙箱 profile**（`sandbox/upstream/0.2.1-rc.4/home`，`profile=upstream`），
三行都是 `no-trap`；活陷阱实例在 R83 的 60 包抽样里 **0 个**，本轮也没有找到 —— 这项能力的价值是
「真出现回退重编号时，能在用户点按钮之前说出『更高 ≠ 更新』」，不是「抓到了多少」。
