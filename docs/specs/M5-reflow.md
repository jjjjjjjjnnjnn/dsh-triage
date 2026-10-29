# spec · M5-a 回流（本地半边）：outcome 记录、0 PII、删除路径、先验注解

> **Stand**: R41 (2026-10-29)｜状态：**未开工（`T-501`）**，本文件先定判据与负对照
> **前置**：`docs/adr/0011-reflow-evidence-tier.md`（**proposed**）。本文档按 **A 案**写；B/C 的差异只在 §10 与 §13，其余各节三个方案共用。
> **依赖**：`docs/05-verdict-contract.md`（四态 / tier / 置信度）、`docs/specs/M2-capabilities.md`（「只交付事实与边界，不交付愿望」的写法）、`BS-05` / `BS-21` / `BS-22` / `BS-38`（结论只对本机本键成立）
> **一句话**：这一层只做「**记下来、能删掉、证明里面没有你**」。它**不**回答「别人装得上吗」。

## 1. 这一层回答什么、不回答什么

| 回答 | 不回答 |
|---|---|
| 我这台机器过去对某个 `包@版本 × 运行时` 判过什么 | 别人装不装得上（没有上传，`M5-a` 结构性做不到） |
| 这条判断的记录里有没有我的路径 / 用户名 / 环境变量 / 凭据 | 这个插件安全不安全（严禁行为 2：不给安全背书） |
| 我怎么把这些记录一条不剩地删掉 | 插件好不好用、值不值得装 |
| 先验与随后一次本机测量是否一致（A 案） | 先验是否让判断「更准」（没有 ground truth，见 ADR 0011 §4.2 / C6） |

**范围纪律**：本里程碑的任何字段，都必须是**本机四态结论及其派生物**。凡是「需要人群才能成立」的字段，一律留到上传里程碑。

## 2. 键（key）：一条记录归属于谁

一条 outcome 只对下面这个**七元组**成立，任何一位不同就是不同键：

```
key = (package, version, dsh, os, arch, node_major, profile_kind)
```

| 位 | 取值 | 为什么必须是精确值 |
|---|---|---|
| `package` | npm 包名（含 scope），≤214 字符 | 包名是唯一的；不做模糊匹配 |
| `version` | 精确版本（semver），禁区间、禁 `latest` | 结论只对这个构建成立（`BS-27` 的教训：便利样本不可外推） |
| `dsh` | 精确运行时版本，或 `null` | `BS-38`：同一 `包@版本` 在 0.2.1-rc.4 是 `go`、在 0.1.0-rc.6 是 `blocked`，**两次都对** |
| `os` | `win32` / `darwin` / `linux` / `freebsd` / `other` | 端口、路径、原生模块都不同 |
| `arch` | `x64` / `arm64` / `ia32` / `other` | 同上 |
| `node_major` | 整数 18–99 | 原生模块 ABI 按 major 分档 |
| `profile_kind` | `web` / `tui` / `headless` / `unknown` | `web` 面有 HTTP 与渲染，`tui`/`headless` 没有（`BS-23`） |

**禁**：`dsh` 为 `null` 的记录**不参与**先验匹配（键不完整），但仍允许写入（它是「读不到运行时」这条事实的样本）；`profile_kind = unknown` 同理。

## 3. 记录什么：字段白名单（唯一真相）

一行 = 一个 JSON 对象（JSONL），一行 = 一次 `probe` 或一次 `check` 的**一个判定对象**。

```jsonc
{
  "schema_version": 1,
  "id": "9f2c1e7ab34d05f68c1d2e3a4b5c6d7e",
  "at": "2026-10-29T10:00:00.000Z",
  "source": "check",
  "package": "dsh-status-rotator",
  "version": "0.38.0",
  "dsh_version": "0.2.1-rc.4",
  "os": "win32",
  "arch": "x64",
  "node_major": 24,
  "profile_kind": "web",
  "conclusion": "go",
  "reason_message_ids": ["admission.admitted", "admission.declared-only"],
  "evidence_tiers": ["declared", "measured-local"],
  "probe": null
}
```

| 字段 | 类型 | 取值域 / 上限 | 来源 | 为什么它在白名单里 |
|---|---|---|---|---|
| `schema_version` | 字面量 `1` | 固定 | 常量 | 迁移用；不是版本号自由文本 |
| `id` | string | 32 位小写 hex（`^[0-9a-f]{32}$`） | 本地随机 | 只用于「我记了几条 / 删了几条」与并发去重。**永不进仓**（§3.1） |
| `at` | string | ISO-8601 UTC，毫秒精度 | 调用方注入（本机时钟） | 双窗实验的切分依据（§13）；不许改用 registry 时间或文件 mtime |
| `source` | enum | `check` / `probe` | 命令 | 区分「声明层判定」与「隔离实测」，两者不可混算 |
| `package` | string | `^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$`，≤214 | verdict.subject.name | 键 |
| `version` | string | `semver.valid()` 且不含 `+build`，≤64 | verdict.subject.version | 键；`+build` 会带构建指纹 |
| `dsh_version` | string \| null | `semver.valid()`，≤64 | verdict.env.dsh | 键；`null` 表示读不到 |
| `os` | enum | 见 §2 | `process.platform` 映射 | 键 |
| `arch` | enum | 见 §2 | `process.arch` 映射 | 键 |
| `node_major` | integer | 18–99 | `process.versions.node` 的 major | 键 |
| `profile_kind` | enum | 见 §2 | 由 profile 的 app/行推断；读不出 → `unknown` | 键 |
| `conclusion` | enum | `go` / `risky` / `blocked` / `unknown` | verdict.conclusion | 唯一的判定结果 |
| `reason_message_ids` | string[] | ≤12 项，去重、升序，每项 `^(admission|collision|registry|runtime|remediation|missing|probe|tool|prior)\.[a-z0-9.-]+$` | `verdict.reasons[].messageId` | 归因形状；**只收 messageId，不收文案**（文案可内联信息） |
| `evidence_tiers` | string[] | ≤8 项，去重、升序，∈ `EvidenceTier` 枚举 | `verdict.evidence[].tier` | 让「这是声明还是实测」可见 |
| `probe` | object \| null | 见下 | probe 运行 | 只用**桶**，不用毫秒（§3.2） |

`probe` 子对象（仅 `source = "probe"` 时可非 `null`）：

| 字段 | 类型 | 取值域 |
|---|---|---|
| `total_ms_bucket` | enum | `lt5s` / `5to20s` / `20to60s` / `gte60s` |
| `boot_ms_bucket` | enum \| null | 同上；非 web 面为 `null` |

### 3.1 为什么允许随机 `id`（与严禁行为 5 的关系）

严禁行为第 5 条禁止的是**可复现产物**里的随机 ID（`data/results/**` 会被逐字节重算）。本地 outcome 库不是 SSOT：它不进仓、不进 `data/results/`、不进 CI。随机 `id` 是「删除证明」与「并发追加去重」的最低成本手段。**机器强制**：

- 门 `outcome-privacy` 断言 `data/results/**` 里**不出现** `"id": "<32 hex>"` 形态；
- `scripts/d4_report.mjs` 只写计数与 `input_sha256`，**拒绝**把任何记录原样写进产物；
- 任何把本地库复制进仓的行为，会同时被 `results-privacy` 的 home 形态与本节的新断言命中。

### 3.2 为什么计时只用桶

毫秒级的 `boot→sample` 是**高熵指纹**（`BS-32` 实测 3.5–9.6s、16.0/22.5/23.8s 这种组合足以区分机器与批次）。而这一层并不需要精度——需要精度的是 `probe` 自己的产物。四个桶的边界固定（5s / 20s / 60s），与 20s 预算口径对齐（`ADR-0006`）。

## 4. 明确禁止的字段（黑名单只是文档，执行靠白名单）

| 类别 | 例子 | 为什么禁 |
|---|---|---|
| 任何路径 | `profileDir`、store 根、`cwd`、`dshHome`、沙盒目录、`node_modules` 路径 | 直接就是用户名与目录结构（R3 A1 / R14 F-2 都真踩过） |
| 用户名 / 主机名 | `os.userInfo().username`、`os.hostname()` | 直接标识符 |
| 任何环境变量的**值** | `PATH`、`NPM_CONFIG_*`、代理、`*_TOKEN` | 值本身可能含凭据与内网地址（铁律 4） |
| 凭据 / 令牌 | `authorization` 头、`npm_*` token、cookie、`?token=` | 严禁行为 4 |
| 带凭据的 registry URL | `https://user:pass@host/...`、带 query 的端点 | `install.endpoints` 已经证明这类 URL 会被写进产物（R16/R19 修过两次） |
| 原始日志尾巴 | `install.key_line`、stderr、`error_tail`、launcher 原文 | 日志里有路径、URL、用户名、内部主机名，且是**自由文本** |
| 任何自由文本 | 插件描述、作者名、locale、错误消息正文、issue 链接 | 自由文本无法用白名单证明安全 |
| 机器/安装标识 | `install_id`、machine id、`contributor_id`、IP | `contributor_id` 只在 B 案需要（ADR 0011 §5 B7），本里程碑**不引入** |
| 仓库 / 主页 URL | `repository`、`homepage` | 可能是私有仓 |
| 目标环境之外的事实 | 已装集合、bundle 层、其它 profile 的名称 | 键已经足够；多一位就是多一个指纹位 |

## 5. `sanitizeOutcome()`：0 PII 是被**执行**的，不是被声明的

新增纯函数（`packages/core/src/outcome.ts`，`@dsh-triage/core` 导出）：

```ts
export type OutcomeRejection =
  | 'not-an-object' | 'unknown-field' | 'value-shape' | 'too-long' | 'bad-timestamp'

export function sanitizeOutcome(input: unknown): { ok: true; record: OutcomeRecord } | { ok: false; reason: OutcomeRejection; field: string | null }
```

规则（每一条都是可测的）：

1. **白名单投影（表外键 = 整条拒绝）**：按 §3 的字段表逐字段读取；只要出现**任何一个**表外键，就返回 `{ ok:false, reason:'unknown-field', field:'<第一个表外键名>' }` 且**不写行**。这里刻意选择「拒绝」而不是「丢掉多余键后继续」——多余键意味着调用方手里已经有不该有的数据，静默丢弃会让那条泄漏路径永远不被修。
2. **值域校验**：每个字符串按 §3 的正则/上限校验；数组按项校验；枚举按集合校验。任一失败 → `value-shape`。
3. **禁止形态扫描**（在值域之后、返回之前，对**所有**最终字符串值再扫一遍）：`/[A-Za-z]:[\\/]/`、`/\\\\[A-Za-z0-9._-]+\\/`、`/(^|[\s"=])\/(Users|home|root|tmp)\//`、`/file:\/\//i`、`~\//`、`/sk-[A-Za-z0-9]{20,}/`、`/ghp_[A-Za-z0-9]{20,}/`、`/npm_[A-Za-z0-9]{20,}/`、`/bearer\s/i`、`/token=/i`。命中 → `value-shape`。（包名含 `/` 是合法的，所以路径正则必须带盘符/前导斜杠/分隔符上下文，不能写成裸 `/`。）
4. **确定性**：函数内禁 `Date.now()` / `Math.random()` / `process.env` 读取；`at` 与 `id` 由调用方注入（与 `verdict.ts` 的 `generatedAt` 同一条纪律）。
5. **单行上限 1024 字节**：`Buffer.byteLength(JSON.stringify(record))` 超限 → `too-long`。这条上限本身就是一道防线：任何自由文本想在一条记录里塞进去，必须先撞上它。
6. **不修复、不猜测、不补默认值**：拒绝就拒绝。调用方把拒绝计数写到 stderr（`outcomes: 1 record rejected (unknown-field: profileDir)`），**绝不**改变 verdict、绝不改变退出码（§7）。

## 6. 0 PII 的三处机器强制

| 位置 | 检查什么 | 失败即红 |
|---|---|---|
| 单测（`tests/unit/outcome-sanitize.test.ts`） | 一条 hostile 输入矩阵：带 `profileDir` / 带 `os.hostname()` / 带 `sk-…` / 带 `file:///<盘符>/…` 形态 / 带 2000 字符日志尾巴 / 带非法包名 / 带 `+build` 版本 / 带 13 个 messageId；每条都断言 `ok:false` 且 `reason` 精确 | 断言空转即红 |
| 门 `outcome-privacy`（**作为 check 加进 `scripts/gate_governance.mjs`，不新增第 10 门**） | ① 扫 `tests/fixtures/outcomes/**` 里所有已提交的 JSONL，断言每行都能通过 §5 的规则（用与运行期**同一份** `sanitizeOutcome`，经 `dist/`）；② 断言 `data/results/**` 不出现 32 位 hex 的 `"id"`；③ 扫 `packages/core/src/outcome.ts` 与 `packages/plugin/src/outcomes/*.ts` 里不出现网络符号（§12） | 任一条 FAIL |
| 运行期 | 写盘前过 `sanitizeOutcome`；读盘（算先验 / purge 计数）前行级 `assertOutcomeLine`：**任何**未知键或非法值 → 该行计入 `rejected_lines` 并跳过（不崩、不修） | 由单测与 §14 N2/N9 覆盖 |

**为什么加 check 而不是加门**：`audit/gate_ledger.json` 的 `negative_control` 是冻结区（`docs/HANDOFF.md` §5），门的**数量**与负对照清单一动就要 HUMAN 复核；而 `--mutate` 的计数是**门**级的（9 门 / 9-9），在 `gate_governance` 里加 check 与之兼容。新 check 必须有自己的 `--mutate` 注入分支（照抄 `results-privacy` 注入 `data/results/injected.json:leak-simulation` 的写法），否则「全绿但什么都没查」的老坑会再踩一次。

> **需要 HUMAN 确认的一处**：若 `gate_governance` 的台账实际是按 **check** 粒度登记的，那么新增 check 等于改冻结台账 —— 实现时必须先跑一次 `node scripts/gate.mjs --mutate` 看 `gate_ledger.json` 是否要求同步；需要时就停下来问，**不要**为了让门变绿去改台账。

## 7. opt-in，默认关

| 项 | 精确值 |
|---|---|
| 配置键 | `outcomes`，取值 `off` \| `local` |
| 配置文件 | `<store>/config.json` = `{"schema_version":1,"outcomes":"off"\|"local"}` |
| 读取点 | **只有** CLI 侧：`packages/plugin/src/outcomes/config.ts#readOutcomeConfig()`，在 `check` / `probe` 组装产物**之后**、写盘之前调用一次 |
| 打开 | `dsh-triage outcomes --enable`（幂等；已开会再写一次同样的内容，不改 `created_at`） |
| 关闭 | `dsh-triage outcomes --disable`（只改 `outcomes` 为 `off`，**不删**已有记录） |
| 单次覆盖 | `dsh-triage check|probe --outcomes off\|local`（只对本次调用生效，**不落盘**） |
| 优先级 | 命令行旗标 > `config.json` > 默认 `off` |
| **不接受** | 环境变量。理由：环境变量会出现在 CI 日志、进程列表与 issue 粘贴里，「为什么它开始记录了」会变成无法回答的问题 |
| 关闭时的行为 | `check` / `probe` 的输出与退出码**不变**；**不创建目录、不创建文件、不 touch 任何 mtime**；连 `stat` 失败都不允许冒泡 |
| Host 半边 | **不写**（`compat_verdict` 工具、设置页 tab、`serve` 面板都不记录）。理由：那三处是「模型/界面触发的读取」，用户没有主动执行；在 Host 进程里做文件写入也扩大铁律 3 的边界 |

**fail-closed 规则**（每一条都要有单测）：

- `LOCALAPPDATA`（win32）为空、相对路径、或不可写 → `mode = off`，stderr 一行，`check` 仍 exit 0；
- `config.json` 读不出来 / JSON 坏了 / `outcomes` 值不在枚举内 → **按 `off` 处理**（坏配置不等于打开）；
- 目录存在但不可写 → `off` + stderr，**不重试、不换目录**（换目录等于在用户不知道的地方建文件）。

## 8. 存储：路径、格式、并发

| 平台 | store 根 | 理由 |
|---|---|---|
| win32 | `%LOCALAPPDATA%\dsh-triage\` | **不用 `%APPDATA%`**：roaming 会把日志同步到域配置文件/其它机器上，等于在我们不控制的地方多一份副本 |
| 其它 | `$XDG_DATA_HOME/dsh-triage/`（若设置了绝对路径），否则 `$HOME/.local/share/dsh-triage/` | XDG 惯例；两者都是「用户数据」而不是「配置」 |

文件（**只有两个**）：

| 文件 | 内容 | 写方式 |
|---|---|---|
| `config.json` | `{"schema_version":1,"outcomes":"off"\|"local"}` | 原子替换（写临时文件 + rename），只在 `--enable/--disable` 时 |
| `outcomes.jsonl` | 每行一条 §3 的记录 | **append-only**：`appendFileSync(path, line + "\n", { flag: 'a' })`；从不重写、从不排序、从不压缩 |

- 行尾统一 `\n`；不写 BOM（PS 5.1 的 `Set-Content -Encoding utf8` 老坑与这里无关，因为我们只用 Node 写）。
- **并发**：两个进程同时追加 → 两行都在、各自是完整 JSON（`O_APPEND` 语义 + 单次 `write` 写完一行 + 单行 ≤1024B）。**不加锁文件**：锁文件会成为「purge 之后还剩一个文件」的来源，直接违反 §11 的「什么都不剩」。
- **不写 `~/.dsh`**，三条理由：(1) 铁律 3 的本机只读边界；(2) `~/.dsh` 是上游拥有的目录，里面的文件会被上游工具读，我们放在那里的东西就不再只属于我们；(3) `~/.dsh` 会跟 profile 一起被复制/备份，而 outcome 是**跨 profile 的用户数据**，放进去会被按 profile 复制成多份。
- 目录权限：沿用系统默认（不在 Windows 上手工设 ACL —— 那需要管理员，且失败形态不可测）。**能说**「数据在用户自己的本地数据目录里」；**不能说**「即使同机其它用户也读不到」（这一条我们没测，`unmeasured`）。

## 9. 什么时候写一条

| 命令 | 写不写 | 说明 |
|---|---|---|
| `probe --execute` | **写 1 条** | 每个候选一次运行一条；`dry-run` **不写**（没有判定） |
| `check <pkg[@ver]...>` | **每个 subject 一条** | `check --all` 时按 subject 逐条；subject 数 > 200 → **整批不写**，stderr 写 `outcomes: skipped (subjects=250 > cap 200)`（宁可不记，也不写半批） |
| `why` / `audit` | **不写** | 它们描述的是已装集合，不是一个可比较的判定对象 |
| `badge` / `index` / `serve` / `compat_verdict` / 设置页 | **不写** | 见 §7 |
| 任何一次失败/异常 | 视情况 | 判定存在（哪怕是 `unknown`）就写；命令自己崩了（没有 verdict）就**不写** —— 「没有判定」不许伪装成 `unknown`（`stability_report` 的 `runs_without_artifact` 同一条纪律） |

**一次运行最多写 200 条**（`probe` 天然 1 条）。上限存在的理由：单条命令不得把用户的库一夜之间写大一个数量级。

## 10. 先验（A 案）：只做注解，位置固定

### 10.1 计算

`computeLocalPrior(records, key)`（纯函数，`packages/core/src/outcome.ts`）：

1. 只取 `key` **七位全等**的记录（§2）；
2. `n < 1` → 返回 `null`（调用方据此**不输出** `prior` 键）；
3. `counts` = 四态计数；`majority` = 严格多数（并列 → `null`，即「无众数」）；
4. `agreement` = `counts[majority] / n`（`majority` 为 `null` 时也是 `null`）；
5. 计算只用记录本身，**不读**任何网络、不读环境、不读时钟。

### 10.2 出现位置（唯一）

`dsh-triage check --explain` 的 `prior` 块；`--explain --json` 时是下面这个对象（`//` 后是说明）：

```jsonc
{
  "prior": {
    "schema_version": 1,
    "annotation_only": true,          // 恒为 true；不是布尔可选项
    "key": {
      "package": "dsh-status-rotator",
      "version": "0.38.0",
      "dsh": "0.2.1-rc.4",
      "os": "win32",
      "arch": "x64",
      "node_major": 24,
      "profile_kind": "web"
    },
    "source": "local-outcomes",
    "method": "outcome-log",          // 与 evidence[].method 同一套词汇
    "n": 3,
    "counts": { "go": 2, "risky": 0, "blocked": 1, "unknown": 0 },
    "majority": "go",
    "agreement": 0.6666666666666666,
    "tier": "measured-local",         // 既有枚举成员；不新增
    "evidence_id": "prior-local",
    "note_id": "prior.annotation-only"
  }
}
```

- **tier 字符串**：`measured-local`。它不是新 tier、也不进 `verdict.evidence[]`；它是「这台机器过去的实测」这一事实的标签。群体先验**不得**借用这个字符串（ADR 0011 §5 B1 需要新成员）。
- **不进 `verdict`**：`check --json`（不带 `--explain`）在「有先验 / 无先验」下**逐字节相同**（§14 N3）。
- **与本机结论无关地显示**：本机判断是 `go` / `risky` / `blocked` 时照样显示（先验与前测不一致这件事本身有信息量），但它在任何情况下都不参与判定（N3 就是拿「先验 100 次 go + 本机 blocked」打的）。
- **不出现的地方**：`conclusion`、`confidence`、`evidence[]`、`missingEvidence`、`remediation[]`、`audit`/`why` 的输出、`badge`、索引源、设置页 tab、`compat_verdict` 的返回值。
- **「没有」的形状**：键不存在（而不是 `null`/`{}`/`n:0`），与 `ADR-0011` §4.1 一致。
- 文案：`prior.annotation-only`（中英）必须含「不改变结论」这句；该 messageId 纳入门 `verdict-contract` 的命名空间白名单，按 §17 第 7 条的三处同改（`messages.ts` 中英 / 门正则 / `docs/05` §3）。

## 11. 删除路径：`dsh-triage outcomes --purge`

语义（逐条都是断言）：

| 项 | 语义 |
|---|---|
| 删什么 | `outcomes.jsonl`、`config.json`（存在才删）、以及未来任何我们写进该目录的文件（当前的集合是这两个；实现时用**目录列举**而不是硬编码文件名，这样将来加文件也不会漏删） |
| 删完做什么 | 若目录已空 → `rmdir` 该目录；若还有**别人的**文件（用户自己放的）→ **不删**，把相对文件名列进 `remaining[]` |
| 打印什么（文本） | `purged  42 outcome records · 2 files · directory removed` 换行 `store    absent`（或 `store    kept (1 file not ours: notes.txt)`） |
| 打印什么（禁止） | **不得**打印任何记录内容、包名、路径里的用户名。purge 的 stdout 里不允许出现记录里的任何字符串 |
| 退出码 | 成功 0；删不掉（权限）→ 1 + 说明；目标不存在 → **0**（no-op，不是错误） |
| 是否需要 opt-in | **不需要**。删除必须永远可用 |
| 是否联网 | 不 |
| 幂等 | 是。连续两次 `--purge`：第一次删光，第二次 `deleted_records: 0`、`noop: true`、exit 0 |
| 不删什么 | 什么都留不下 —— `remaining` 必须为空数组、`directory_removed` 必须为 `true`、`store_root_exists` 必须为 `false`，三者一起构成「什么都不剩」 |

`--json` 形状：

```jsonc
{
  "schema_version": 1,
  "purge": {
    "noop": false,
    "deleted_records": 42,
    "deleted_files": ["config.json", "outcomes.jsonl"],
    "rejected_lines_dropped": 1,
    "directory_removed": true,
    "remaining": []
  },
  "store_root_exists": false,
  "at": "2026-10-29T10:00:00.000Z"
}
```

> `deleted_files` 只给**文件名**（`path.basename`），不给绝对路径：这份输出最容易被用户贴进 issue。如果用户把它贴进 `data/results/`，`results-privacy` 既有的 home 形态断言（盘符 + `Users`、`/home/<名>/`、被压平的 `-Users-` 形态，见 `scripts/gate_governance.mjs`）也会打红 —— 但第一道防线是**我们根本不打印路径**。

`--status [--json]`（同族命令，用于「我到底记了多少」）：

```jsonc
{
  "schema_version": 1,
  "mode": "off",
  "records": 12,
  "rejected_lines": 0,
  "oldest_at": "2026-10-01T00:00:00.000Z",
  "newest_at": "2026-10-29T09:00:00.000Z",
  "store_root_exists": true
}
```

`mode` 取 `off`/`local` 二者之一；`records` 只数**通过校验**的行；`rejected_lines` 单列（不让坏行看起来像记录）。

## 12. 本地半边不含任何网络（硬规则）

- `packages/core/src/outcome.ts` 与 `packages/plugin/src/outcomes/**` **不得**引入：`node:http` / `node:https` / `node:net` / `node:dgram` / `node:tls` / `undici` / `axios` / 全局 `fetch` / `XMLHttpRequest`。本包零第三方依赖，所以这条扫描没有例外名单。
- 机器检查：门 `outcome-privacy` 的第 ③ 条（§6）。`--mutate` 有一条注入：在 `outcome.ts` 里塞一个 `void fetch` 字符串 → 门必红。
- **上传是另一个里程碑**，需要自己的 ADR（暂记 `0012`），并且至少要先解决：贡献者去重身份（ADR 0011 §5 B7）、聚合方与保留期、投诉/撤回通道、跨境与法务口径（HUMAN）。**本 spec 的任何字段都不得为未来的上传预留位置** —— 预留位就是「以后总会有人打开它」。

## 13. D4 在 A 案下怎么测（可计算的实验）

> 判据的**改写**本身由 `ADR-0011` 签字区授权；本节只定义怎么算。

| 项 | 定义 |
|---|---|
| 脚本 | `scripts/d4_report.mjs --store <dir> --cutoff <ISO> --stamp <ISO> [--strict]` |
| 输入 | 一份本地 `outcomes.jsonl`（操作者自己的）。脚本**只读**；不改库、不删库 |
| 双窗 | 先验窗 `[t0, cutoff)`、后测窗 `[cutoff, t1]`；`t0`/`t1` = 库里的最早/最晚 `at`，如实写进产物 |
| 配对 | 键（七元组，§2）在两个窗里都出现 ≥1 次 → 一对。只用**后测窗里第一条**（`at` 最小）记录的 `conclusion` 作为「后测」 |
| 分母 `pairs` | 配对数。单侧键（只在一个窗里出现）单列 `keys_one_sided`，**不进分母** |
| 并列 | 先验窗众数并列 → 该对 `inconclusive`，**从分子分母同时剔除**，单列 `ties` |
| 统计量 | `agreement = hits / pairs`（`hits` = 众数 == 后测结论）；同时给 Wilson 95% 区间（与 `d2_report` 同一实现，别重写） |
| 阈值 | `pairs ≥ 30` **且** `wilson_low ≥ 0.80` → `gate.passed = true`；`pairs < 30` → `gate.passed = false` + `reason = "insufficient-pairs"`，**拒绝判定**（照抄 `d2_report` 在真实启动 <10 时的做法） |
| 附加列 | `later_disagreements`：后测窗内同一键出现 ≥2 条且结论不同的键数。它给出**一致率的天花板**参考（C6：同一键本机重复测量本来就会不一致） |
| 产物 | `data/results/d4-<stamp>.json` + `.sha256`；`produced_by: "scripts/d4_report.mjs"`、`generated_at`、`schema_version: 1`；含 `pairs` / `hits` / `agreement` / `wilson` / `ties` / `keys_one_sided` / `later_disagreements` / `input_sha256` / `window` / `limits[]`；**不含**任何 `id` 或记录内容 |
| 复算 | 同一份库 + 同一 `cutoff` + 同一 `stamp` → 逐字节相同（所有集合排序、无时钟、无随机）。审阅者没有操作者的库时，用 `tests/fixtures/outcomes/d4-*.jsonl` 跑同一条命令复算**代码路径**（数值不同，形状相同） |
| `--strict` | 判定失败时 exit 1，且产物与 `.sha256` 先落盘（`T-317` 的同一决定） |

**今天能跑出多少对**：最多 13（`tests/fixtures/probe/matrix-r19.json` 的 13 个真实候选 × 1 个 dsh 版本）。所以 **`M5-a` 交付时 D4 必然是 `insufficient-pairs`（`unmeasured`）**，除非专门把候选扩到 ≥30 个 pin 版本再跑两轮。这句话必须写进产物与交接包，不许把「脚本能跑」当成「D4 通过」。

## 14. 负对照（14 条，每条都必须是可执行断言）

| # | 场景 | 期望 | 钉住的不变量 |
|---|---|---|---|
| N1 | 干净环境（无 store 目录）跑 `check` | exit 0；**store 目录之后仍不存在**；stdout/stderr 不变 | 默认关 = 真的什么都没发生（§7） |
| N2 | 输入带一个多余键 `profileDir`，值是 home 形态的 profile 路径 | `sanitizeOutcome` 返回 `{ok:false, reason:'unknown-field', field:'profileDir'}`，**不写行** | 白名单投影（§5.1） |
| N3 | 库里已有 100 条该键 `go`，本机 `check` 判 `blocked` | `check --json` 与「空库」**逐字节相同**；`conclusion` 仍是 `blocked`；带 `--explain` 时只有注解块 | 先验永不改结论（ADR 0011 §4.1、§5 B3） |
| N4 | 已有库、`--outcomes off` 跑一次 `check` | `outcomes.jsonl` 的 sha256 **不变**（连 mtime 都不动） | 「关」不等于「少写一点」（§7） |
| N5 | `outcomes --purge` 在**不存在**的 store 上 | exit 0；`noop:true`；`deleted_records:0`；**不创建目录** | 删除路径不能变成创建路径（§11） |
| N6 | `--enable` → 3 条记录 → `--purge` | `deleted_records:3`；`directory_removed:true`；`remaining:[]`；目录不存在；之后 `check` 仍不写 | 「什么都不剩」（§11） |
| N7 | 同 `包@版本`，先验是 `dsh 0.2.1-rc.4`，本机是 `0.1.0-rc.6` | `prior` 键**不存在**（不是 `null`）；结论不变 | 精确键（§2 / `BS-38`） |
| N8 | 先验 `profile_kind=web`，本机 `tui` | 同上 | 键的第七位（`BS-23`） |
| N9 | 记录里塞 2000 字符日志尾巴（放得进 `reason_message_ids` 以外的任何字段都不行；本用例走 `value-shape` 与 `too-long` 两条路） | 一律 `ok:false`；库文件不变 | 自由文本进不来（§5.3 / §5.5） |
| N10 | `LOCALAPPDATA` 设为空串 | `mode=off`；stderr 一行；`check` exit 0 且结论不变 | fail-closed（§7） |
| N11 | 两个进程各追加 1 条（并发） | 两行都在；每行可 `JSON.parse`；无截断 | append-only 与并发（§8） |
| N12 | 在 `outcome.ts` 里注入 `fetch(` | 门 `outcome-privacy` **红**；`--mutate` 也红 | 本地半边无网络（§12） |
| N13 | `--purge` 的 stdout 全文 | 不含任何已知包名、不含 `"`、不含路径分隔符 | 删除的输出本身不带数据（§11） |
| N14 | 记录写入失败（目录只读 / 磁盘满） | `check` exit 0、verdict 逐字节不变、stderr 一行 | 记录是旁路，永不改变判断（§5.6） |

另需一条**形状**断言（不是负对照）：`tests/fixtures/outcomes/*.jsonl` 必须至少覆盖四态结论各 1 条、`source=probe` 与 `source=check` 各 1 条，否则 §6 的门是在空集上通过。

## 15. 本 spec 里明确写 `unmeasured` 的东西

| 项 | 为什么是 `unmeasured` |
|---|---|
| 安装量 / 活跃键数 / 每键样本数 | 我们没有任何安装读数；仓库刚转 public，npm 下载量不等于用户数（`BS-07`） |
| 键密度（多少个键能到 `n≥20`） | 结构性需要跨机器聚合（ADR 0011 §7 F2） |
| D4 的一致率数值 | 最多 13 对 < 30，`d4_report` 会直接判 `insufficient-pairs` |
| 「同机其它用户读不到这个文件」 | 没有在 Windows ACL / POSIX 权限上做过实测 |
| 非 Windows 的 store 路径 | `%LOCALAPPDATA%` 有实测环境；`$XDG_DATA_HOME` / `~/.local/share` 只有代码路径，**没跑过** |
| 「先验让用户更早看到有用信息」 | 没有用户研究；属于产品判断，不是这一层的判据 |

## 16. 明确不在范围里

| 不做 | 归属 |
|---|---|
| 上传 / 服务端 / 跨用户聚合 / 群体先验 | 另一个里程碑 + 自己的 ADR（暂记 `0012`） |
| 遥测（调用次数、活跃度、崩溃上报） | 不做。`ROADMAP` §4 里「`compat_verdict` 调用（opt-in）」这一格在 M5-a **不实现** |
| 把 outcome 写进 `data/results/` | 不做。那是 SSOT（铁律 5），只由脚本真跑产出 |
| 改变任何 `conclusion` / `confidence` / `evidence[]` | 不做（A 案）；B 案要另签 |
| 自动清理 / 保留期 | 不做。删除只有一条路径：用户显式 `--purge`；不设 TTL（自动删除会让「我记了什么」不可复算） |
| 加密 | 不做。加密会带来密钥管理，而密钥管理正是铁律 4 的反面；数据是用户自己的四态结论，价值密度低 |

## 17. 实现清单（先测试、后实现；顺序不可换）

1. `packages/core/src/outcome.ts`：`OutcomeRecord`、`sanitizeOutcome`、`assertOutcomeLine`、`computeLocalPrior`（全纯函数，无 I/O）。
2. `tests/unit/outcome-sanitize.test.ts`：§14 的 N2 / N9 + hostile 矩阵 + `id` 正则 + 1024B 上限。
3. `tests/unit/outcome-prior.test.ts`：N3 / N7 / N8 + 众数并列 + `n=0` 时返回 `null`。
4. `packages/plugin/src/outcomes/{config,store,purge}.ts` + CLI 接线：N1 / N4 / N5 / N6 / N10 / N11 / N14。
5. `scripts/d4_report.mjs` + `tests/governance/d4-report.test.ts`：夹具复算 + `insufficient-pairs` 拒绝判定 + 产物字段表。
6. `gate_governance.mjs` 新增 check `outcome-privacy` + `--mutate` 注入；先跑一次看冻结台账是否要同步（§6 的提醒）。
7. `messages.ts` 新增 `prior.annotation-only`（中英）+ 门 `verdict-contract` 的 `prior.*` 白名单 + `docs/05` §3 一行（三处同改）。
8. 真跑一次（True run）：`scripts/record_outcomes.mjs --stamp <ISO>` 驱动 `check` 两次 + `probe --execute` 一次 + `outcomes --purge`，把**计数与形状**（不是记录）写成 `data/results/outcomes-<stamp>.json` + `.sha256`（`produced_by` / `generated_at` / `schema_version` 齐全，铁律 5），并写进 `audit/step_reviews.json` 的四轴。
