# M8 · 急救箱（rescue）判据

> **Stand**: R82 (2026-11-05)｜**状态**: **A 段（只读计划）与 B 段（`--apply` / `--undo`）均已实现**
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
| 非官方，且磁盘上解析不到安装位置 | `unresolved` | **是**（单独计数） | 「在 `dsh.profile.bundles` 里，但没装上」 |
| **官方 scope**，且磁盘上解析不到安装位置 | `unresolved` | **否** | 「官方 bundle 没装上：只报告，不裁」 |

> **为什么官方 scope 的 `unresolved` 不裁（R82 真跑时改的一条）**：解析不到最常见的原因不是「用户没装」，而是**我们自己的解析器没看懂那种布局**（非 hoisted store、嵌套副本）。在这种情况下把
> `@deepseek-ai/dsh-base` 从 `dsh.profile.bundles` 里删掉，是这个命令能做的最具破坏性的一件事。
> 第三方 bundle 的「没装上」不一样：文件已经和磁盘不一致，而且撤销只差一条 `--undo`。

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

## 7. B 段（写入面）——**R82 已实现**

| 编号 | 判据 | 由什么证明 |
|---|---|---|
| **C9** | `--apply` 只改 `dsh.profile.bundles`；`dependencies` 与其余键逐字节保持（除 `bundles` 数组本身） | 单测与 e2e 都断言 `dependencies` deepEqual；e2e 还比对 apply 前后的键集 |
| **C10** | 写入顺序固定：**备份 → 原子替换 → 回读校验 → journal**；任一步失败必须**先回滚再抛错** | 注入「写后失败」的测试（`afterWrite`）断言原始字节回来了、且没有留下 journal |
| **C11** | `--undo` **逐字节还原**，并在 profile 于救援后被改动过时**拒绝覆盖** | 单测比 sha256；e2e 改一行后 undo 必须 exit 3 且文件不变 |
| **C12** | 默认（无 `--apply`）仍然**零写盘**：连 `<profile>/.dsh-triage/` 目录都不产生 | 单测断言目录不存在；A 段的 C4 仍然成立 |

补充负对照：

| 编号 | 怎么把它弄红 | 期望 |
|---|---|---|
| **N9** | 去掉 `catch` 里的回滚（`copyFileSync(backup, file)`） | 「写后失败」的测试红（文件停在被裁过的状态） |
| **N10** | 把 undo 改成「重写等价内容」而不是复制备份 | 逐字节断言红 |
| **N11** | 去掉 undo 的「profile 已被改动」检查 | 拒绝覆盖的测试红（Missing expected exception） |

**存储位置**：`<profile>/.dsh-triage/rescue/<stamp>/package.json`（备份）与 `<profile>/.dsh-triage/rescue/<stamp>.json`（journal），
与 `fix` 的 `.dsh-triage/{journal,backups}` 同一个根，撤销只有一套查找规则。
**不做**：不重启宿主（重启是 `T-855` 的 SAFE MODE 入口），不装/卸包，不动 `node_modules` 与 lockfile。
