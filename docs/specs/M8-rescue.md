# M8 · 急救箱（rescue）判据

> **Stand**: R82 (2026-11-05)｜**状态**: **A 段已实现**（只读计划 `rescue`），**B 段待做**（`--apply` / `--undo`）
> **这条 spec 回答一件事**：当一台机器起不来时，我们**能**给出什么答案、**不能**给出什么答案，
> 以及用什么证据证明「只读就是只读」。
> **来源**：R81 的同定位采证（`docs/10-adjacent-tools.md`、`data/results/adjacent-tools-2026-11-05T09-03-11.609Z.json`）。
> `Iliyasfwe/dsh-rescue` 的 `enter/exit/status` 证明了「只裁 `dsh.profile.bundles`」这条最小面是可行的；
> **我们只学机制，不抄代码**（MIT，独立实现）。

---

## 1. 为什么这句答案可以说，那句不可以说

| 想说的话 | 能不能说 | 为什么 |
|---|---|---|
| 「这些 bundle 是第三方的」 | **能** | 读 profile 的 `package.json` 就能分类，证据等级 `scanned` |
| 「这些 bundle 宣布了但根本没装上」 | **能** | 解析不到安装位置就是事实，不是猜测 |
| 「裁掉它们就能起来」 | **不能** | 启动成功要和宿主交互才谈得上；那要 `probe` 真跑，静态推不出来 |
| 「你的机器坏了」 | **不能** | 我们只能看见声明与安装位置，看不见运行期为什么崩 |

所以本命令的输出形态是**「如果你这台机器起不来，先裁这些第三方 bundle 的最小集合」**，
并且必须在输出里带一句边界（C5），外加指向 `dsh-triage probe` 的启动验证入口。

---

## 2. 判据（A 段）

| 编号 | 判据 | 由什么证明 |
|---|---|---|
| **C1** | 计划是**纯数据**：无时钟、无网络、无随机；同一输入两次调用逐字节相同 | 纯函数 `classifyBundles()` + 单测比较两次 `JSON.stringify` |
| **C2** | 分类只有三态：`official` / `third-party` / `unresolved`，规则见 §3，**不许第四态、不许猜** | 单测逐规则一条；负对照 N2 / N3 |
| **C3** | 计划里每条都带：bundle 名、声明形态（`dependencies` 里的原文或 `null`）、解析到的版本或 `null`、一句人话理由、**撤销描述符**（放回第 N 位 + 原始条目） | 单测断言字段非空且理由以句号结尾、不含错误码 |
| **C4** | 默认 **零写盘**：不写 plan、不写备份、不写 journal；目标 `package.json` 的 sha256 前后相同 | e2e：跑完 CLI 后重算 sha256 与产物里 `inputs.manifest_sha256` 相等；负对照 N1 |
| **C5** | 文本输出必须含边界句：只从声明层算、**不证明启动成功**、启动验证走 `probe` | e2e 断言中英两种 locale 各含一句；负对照 N4（删掉即红） |
| **C6** | 「没什么可裁」是**结论**（exit 0），与「读不到」（exit 3、不产出产物）分开；`bundles` 为空另有一句「这个 profile 没声明任何 bundle」 | e2e 三个 fixture 各一条 |
| **C7** | 证据等级只能是 `scanned`（读了 profile 文件）；**禁写 `declared`**，因为 `dsh.profile.bundles` 是配置不是声明 | `--json` 里 `evidence: "scanned"`；负对照把字符串改成 `declared` → 单测红 |
| **C8** | 产物带 `produced_by` / `generated_at` / `inputs.profile`（**只写 profile 名，不写用户绝对路径**）/ `inputs.manifest_sha256` / 复算命令 | `scripts/record_rescue.mjs` + 隐私断言（负对照 N7） |

---

## 3. 分类规则（唯一真相）

输入是 `<dsh-home>/profiles/<profile>/package.json` 的原文，加上磁盘上解析出的安装版本。

| 情况 | `origin` | 可裁 | 理由（输出原话） |
|---|---|---|---|
| 名字以 `@deepseek-ai/` 开头，`dependencies` 里是 registry 形态（`^1.2.3` / `~` / 精确 / `*` / 缺省） | `official` | 否 | 「官方 bundle，不属于救援范围」 |
| 名字**不以** `@deepseek-ai/` 开头（任意 scope 或无 scope） | `third-party` | **是** | 「第三方 bundle，可以暂时裁掉」 |
| `@deepseek-ai/` 开头，但 `dependencies` 里是本地形态（`link:` / `file:` / `workspace:` / 相对或绝对路径） | `third-party` | **是** | 「官方 scope 但装的是本地路径，属于你自己的代码」 |
| 磁盘上解析不到安装位置（不在 profile `node_modules`、也不在共享 `node_modules`） | `unresolved` | **是**（单独计数） | 「在 `dsh.profile.bundles` 里，但没装上」 |

**两条硬规则**：

1. **`unresolved` 不许并进 `third-party`**：前者是「配置与磁盘不一致」，后者是「非官方」。
   合并会让「你有 3 个第三方」这句话在两种完全不同的故障上都说出口。
2. **不重排、不去重、不改 `dependencies`**：A 段只读；B 段写盘时也只删 `dsh.profile.bundles` 里
   那几条，`dependencies` 一字不动（否则「撤销」就不再是一个数组操作）。

---

## 4. 明确不做（A 段）

| 不做 | 理由 |
|---|---|
| 写盘（含备份 / journal / 临时文件） | A 段的全部价值是「先看一眼」；写了盘就不再是只读 |
| 承诺启动成功 | 见 §1 |
| 碰 `dependencies` / `node_modules` / lockfile | 那会让撤销从「放回一行」变成「重装」 |
| 判断「哪个第三方是罪魁」 | 没有运行期证据；猜一个 = 假归因 |
| 读凭据 / 会话 / settings | 与 `env.ts` 同一条边界（`COMPLIANCE.md` §2） |

---

## 5. 证据口径

- 产物：`data/results/rescue-<stamp>.json` + `.sha256`（`scripts/lib/evidence.mjs#writeEvidence`）；
- `produced_by: "scripts/record_rescue.mjs"`；`inputs` 只写 `profile` 名与 `dsh_home` 的**占位符**（`(dsh-home)`），
  绝不写真实 home 路径；
- `inputs.manifest_sha256` 是**读到的原文**的 sha256 —— 只读的证明就是它没变；
- `recompute` 字段给出重跑命令（读者可自己复现）；
- 本命令的结论**不进**任何 verdict（不是 `go` / `blocked`），它是一个计划。

---

## 6. 负对照（每条都要真红，改回后终跑全绿）

| 编号 | 怎么把它弄红 | 期望 |
|---|---|---|
| **N1** | 让 `rescue` 在 dry-run 时**顺带**把格式化后的 JSON 写回（模拟"只读也写盘"） | e2e 的 sha256 断言红 |
| **N2** | 把第三方判定改成「名字里含 `dsh` 就算第三方」 | 条目数与 `removable` 集合变化的断言红 |
| **N3** | 把 `unresolved` 归并进 `third-party` | `origin` 取值断言红（三态变两态） |
| **N4** | 删掉边界句（文本输出） | C5 的 e2e 断言红 |
| **N5** | 读不到 profile | exit 3、stderr 有 `hint:`、`data/results` 无新文件 |
| **N6** | `bundles: []` | 输出「没声明任何 bundle」而不是「安全」，exit 0 |
| **N7** | 把 `dsh_home` 的真实绝对路径写进产物 | 隐私断言红（`Users|AppData|/home/` 命中） |
| **N8** | 给计划加一个 `Date.now()` 字段 | C1 的两次渲染 sha256 相同断言红 |

> N1 / N3 / N4 三条是**产品行为**的负对照；N5–N8 是**证据口径**的负对照。两类都要有，
> 否则「只读」这句话在最该被检查的地方没有任何人检查。

---

## 7. B 段（下一轮，未实现）

1. `--apply`：备份 (`<profile>/.dsh-triage/rescue/<stamp>/manifest.before.json`) → 原子替换 → journal（记录删掉的条目与原始下标）→ 回读校验；
2. 失败必回滚：写入中途注入一次失败，`package.json` 逐字节回到原样；
3. `--undo <journal>`：逐字节还原；如果用户在这期间又改过 profile → **拒绝覆盖**并明说；
4. SAFE MODE 入口（`T-855`）在 `--apply` 之上，不另开写入路径；
5. 负对照沿用 §6，另加三条：只读不写 / 失败必回滚 / undo 逐字节。
