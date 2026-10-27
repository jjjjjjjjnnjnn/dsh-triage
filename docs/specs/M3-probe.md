# M3 · probe 执行器契约（T-301）

> **Stand**: R14 (2026-10-27) | 实现：`packages/probe/src/exec.ts` + `scripts/record_probe.mjs` | 门禁：`tests/unit/probe-exec.test.ts` + 门 `step-review`（不新增第 10 道门）
> **上游基线**：仓内沙盒 `@deepseek-ai/dsh` 0.2.1-rc.4（证据见 §2） | **默认 dry-run**，真跑必须显式 `--execute`

---

## 1. 目标与非目标

**目标**：回答一个静态声明答不了的问题——**把候选插件真装进一个隔离的 `DSH_HOME`，它起不起得来、它的行有没有真的活着。**

**非目标（IS-NOT，一条都不许越）**：

| 不做 | 原因 |
|---|---|
| 不判「安全 / 无恶意」 | `COMPLIANCE.md` §5；probe 只答「装得上 / 跑不跑得起来」 |
| 不判「功能正确 / UI 可用」 | 本层只到 boot + HTTP + 行相位；`client-rendered`（T-302）与 `namespace-diff`（T-303）本轮**未测**，产物必须标 `unmeasured` |
| 不写真实 `~/.dsh` | `PROJECT_RULES.md` 铁律 3；沙盒必须是独立的 `DSH_HOME`，且与真实 home 不重叠（`validateProbePlan` 已强制） |
| 不注入真实凭据 | 铁律 4；候选需要 key 时如实记「未验证」而不是猜 |
| 结论不带「用户机器」口径 | 证据来自**仓内沙盒**；产物写 `runtime.source` |

---

## 2. 实测事实（R14，0.2.1-rc.4，不是文档抄来的）

| # | 事实 | 怎么测的 |
|---|---|---|
| F1 | launcher 语法：`dsh --profile <p> --patch <overlay>`（flags 在 profile 名**之前**） | `dsh --help`；R12 已踩过坑 |
| F2 | 安装语法：`dsh plugin --profile <p> add <spec>` → 转发 pnpm；profile **首次使用时初始化**（模板 = `@deepseek-ai/dsh-base` bundle） | `dsh plugin --help`；孤立 `DSH_HOME` 实测 |
| F3 | **bundle 的 `cordis.patch.yml` 必须用 `insert:`**。裸 `- id: x / name: y` 是「修改 entry x」，上游对未知目标只写 stderr 警告然后跳过：`dsh: warning: patch: entry "triage-probe-ok" not found` | 第一次真机 boot：fixture 行消失 |
| F4 | 三种相位形状各有其名：干净挂载 → `active`；**import 期抛错** → `enabled:true + fiberPhase:null`；**apply 期抛错** → `fiberPhase:"failed"` | 三个 fixture 同 profile 采样：`{active:95, null:4, failed:1}` |
| F5 | 起服务到拿到样本：**6.1 / 7.2 / 7.7 / 8.2 / 9.8 s**（五次，含冷启） | `scripts/lib/live.mjs` 的 `host.seconds` |
| F6 | 本地路径安装：**490–635 ms**（离线、pnpm 已缓存）；真实 registry 安装**本轮未测**，不得假设 |
| F7 | 最小 probe profile **没有 `agentPresets`**（`host_summary.presets = null`），工具注册表全局层读到 **25** 个工具 | 同上，`capabilities.tools.length` |
| F8 | 行 id 在运行时带 group 前缀：声明 `triage-probe-ok` → 运行时 `include:triage-probe-ok` | R12 的 `resolveRuntimeId` 已归一，本轮再次实测 |
| F9 | **就绪探测必须在杀树之前做**。第一版在采到样本后立即 `taskkill`，随后的 HTTP 检查全部 `fetch failed`（端口已死） | 真机绿跑当场暴露；改为「采样 → settle 1s → 探测（重试 5s）→ 杀树」后得到 HTTP 401 |
| F10 | `--port` 不是 launcher flag，而是 **app 参数**：`dsh --profile <p> --patch <o> --port 53052 --no-open` 有效；不带 `--no-open` 探针会打开用户浏览器 | 实测：`--port` 透传后 `dsh web: http://127.0.0.1:53997/?token=…` 并尝试启动浏览器 |
| F11 | 沙盒没有 token → 只想探活时状态码是 **401 或 404**（`redirect:'manual'`）；「端口有应答」不等于「UI 正常」 | 实测两轮：401（`web` 模板）/ 404（更小的 profile） |
| F12 | `client-rendered` / `namespace-diff` 本轮**不可测**，产物必须 `unmeasured` | 未跑浏览器、工具表面在 agent 作用域（BS-21） |

**F3 是产品级发现**：`packages/plugin/cordis.patch.yml` 原本正是这个形状——装上去这一行会被**静默丢弃**。R14 已修，并在门 `namespace` 增加 `rows-are-inserted`（双向自测：改回非 insert 即红）。

---

## 3. 步骤机

```
runtime → install → boot → http → inventory → cleanup
   │         │        │      │        │          │
   └ 读版本   └ 装候选  └ 起 Host └ 探端口  └ 读相位  └ 必删
```

| 步 | 输入 | 成功判据 | 失败码 |
|---|---|---|---|
| `runtime` | `--dsh-main <path>`（本轮显式传，不猜 PATH） | `node <main> --version` 有输出且可解析 | `probe.runtime-unavailable` |
| `install` | 候选 spec（路径 / tarball / npm spec） | 退出码 0 且 profile 的 `package.json` 里出现该包 | `probe.install-failed` |
| `boot` | profile 名 + 探针 overlay | 探针写出样本文件（不是「进程还活着」） | `probe.boot-timeout` |
| `http` | `plan.port` | `redirect:'manual'` 下收到 2xx/3xx/401（303+token、401 无 token 都算活） | `probe.http-unreachable` |
| `inventory` | 样本 | 候选模块对应**恰好一条**运行时行 | `probe.row-missing` / `probe.row-inactive` |
| `cleanup` | 沙盒路径 | 目录不存在且端口不再应答 | `probe.cleanup-incomplete`（`risky`，不改测量结论） |

**硬规则**：

1. `cleanup` 在 `finally` 里执行；任何一步抛错都不许跳过清理；
2. 探针样本是**唯一**的相位来源，执行器不得自己猜相位；
3. 探针行自身必须从评分行里剔除（`excluded`），否则「候选行」与「我们自己的 instrument」会混在一起（R12 的坑）；
4. 候选行的识别口径：`moduleName === candidatePackageName` 且**唯一**；0 条 → `row-missing`，≥2 条 → `unknown`（不猜）。

---

## 4. 计时契约（分段，禁止用总时长糊）

| 段 | 预算 | 超时 | 实测 |
|---|---|---|---|
| `install` | 不计入 20s（网络与 pnpm 波动不可控） | 本地 60s / registry 180s | 0.58–0.64s（本地） |
| `boot → sample` | **≤ 20s**（M3 出口门禁） | 120s（可配） | 11.8 / 12.3 / 13.8s（带 web app 三次） |
| `http` | ≤ 5s（样本落盘后、杀树之前） | 5s | 1s settle + 1 次探测命中 401 |
| `cleanup` | ≤ 5s | 10s | 15–17ms |
| 总时长 | 只记录，不设判据 | — | — |

> `timings.bootToSampleMs` 取 `host.seconds`（spawn→样本）；`steps[boot].ms` 是整步墙钟（含 settle、就绪探测与杀树后等待，实测约 20s）。预算只看前者，两者都进产物，避免「用总时长糊」。 

`install` 超预算时**不得**把总时长写成结论；产物里 `timings` 分段记账。

---

## 5. 断言 → 结论映射

产物 `assertions[]` 每项带 `status ∈ passed / failed / unmeasured`。**未测的断言必须出现在产物里并标 `unmeasured`**，不许省略。

| assertion | 本轮状态 | 依据 |
|---|---|---|
| `boot-sampled` | 测 | 样本文件存在且可解析 |
| `http-served` | 测 | `redirect:'manual'` 的状态码 |
| `inventory-active` | 测 | 候选行的 `fiberPhase` |
| `cleanup-complete` | 测 | 目录 + 端口双重判据 |
| `client-rendered` | **unmeasured**（T-302） | 本层不跑浏览器，HTTP 200 ≠ 有画面（BS-03） |
| `namespace-diff` | **unmeasured**（T-303） | 工具表面在 agent/preset 作用域（R13 的 `BS-21`） |

结论：

| 情形 | conclusion | confidence.basis |
|---|---|---|
| 四步全过 + 候选行 `active` | `go` | `measured-local`（high） |
| 候选行 `failed` / `null` / 不存在 | `blocked` | `measured-local`（high） |
| install / boot / http 失败 | `blocked` | `measured-local`（high） |
| 清理不干净 | `risky`（结论仍引自测量） | `measured-local` |
| 运行时与候选声明不匹配 / 候选行 ≥2 条 / 样本读不出 | `unknown` + `missingEvidence` | `measured-local` |

**永远不出现**：`go` 被读成「能正常使用」。渲染时 `go` 的文案必须带「仅 boot + HTTP + 行相位」的限定（见 §7）。

---

## 6. 产物 schema（`data/results/probe-<stamp>.json`）

```jsonc
{
  "schema_version": 1,
  "produced_by": "scripts/record_probe.mjs",
  "generated_at": "2026-10-27T00:00:00.000Z",
  "candidate": { "spec": "tests/fixtures/probe/ok-plugin", "package": "triage-probe-fixture-ok", "kind": "path" },
  "runtime": { "source": "sandbox/upstream/0.2.1-rc.4/install", "version": "0.2.1-rc.4", "dsh_main": "<repo>/…/bin.js" },
  "sandbox": { "home": "<temp>/…", "profile": "probe", "overlap_check": "disjoint", "env_scrubbed": true },
  "steps": [{ "id": "install", "status": "passed", "ms": 640, "argv": ["<node>", "<dsh-main>", "plugin", "--profile", "probe", "add", "<candidate>"] }],
  "timings": { "install_ms": 640, "boot_to_sample_ms": 6100, "http_ms": 120, "cleanup_ms": 40 },
  "assertions": [{ "id": "boot-sampled", "status": "passed", "detail": "wait_ms=3742" }, { "id": "client-rendered", "status": "unmeasured", "detail": "T-302" }],
  "inventory": { "transport": "in-process-projection", "entries": 98, "candidate_rows": [{ "entryId": "include:triage-probe-ok", "phase": "active" }], "excluded": ["include:triage-probe-ok"?] },
  "verdict": { "conclusion": "go", "reasons": [], "evidence": [], "missingEvidence": [] },
  "limits": ["no security judgement", "no client render check", "sandbox runtime, not the user's machine"]
}
```

约束：

- 脱敏：任何绝对路径先过 `makeRedactor`（R13 的 `file:///` + 百分号编码坑）；
- 确定性：同输入同结论；时序只进 `timings`，不参与判定；
- 可重算：`.sha256` 是**纯 hash**（R12 的坑）。

---

## 7. 文案与命名空间

新增 `probe.*` 原因码（**三处同改**：`messages.ts` 中英 / 门 `verdict-contract` 白名单 / `docs/05` §3）：

`probe.served`（info）· `probe.row-active`（info）· `probe.row-inactive`（block）· `probe.row-missing`（block）· `probe.install-failed`（block）· `probe.boot-timeout`（block）· `probe.http-unreachable`（block）· `probe.runtime-mismatch`（warn→unknown）· `probe.cleanup-incomplete`（warn）

`go` 的渲染必须包含限定：**「仅证明 boot + HTTP + 行相位，不证明功能」**。

---

## 8. 负对照（必须能红）

| # | 注入 | 期望 |
|---|---|---|
| N1 | 沙盒 home = 真实 `~/.dsh` | 拒绝执行（`sandbox-overlaps-real-home`） |
| N2 | 不传 `--execute` | 只打印计划，**不 spawn 任何进程**（e2e 断言） |
| N3 | install 失败 | `blocked` + `probe.install-failed`，且清理仍执行 |
| N4 | boot 不写样本 | `blocked` + `probe.boot-timeout`，不把「进程活着」当成功 |
| N5 | HTTP 不应答 | `blocked` + `probe.http-unreachable` |
| N6 | 候选行不存在 | `blocked` + `probe.row-missing` |
| N7 | 候选行 `failed` | `blocked` + `probe.row-inactive`，并点名相位 |
| N8 | 候选行匹配到 2 条 | `unknown`，不猜 |
| N9 | 清理失败 | `risky` + `probe.cleanup-incomplete`，测量结论不变 |
| N10 | 把 `unmeasured` 断言写成 `passed` | 单测红（`client-rendered` 必须留在 `unmeasured`） |

---

## 9. 未决

| 项 | 状态 |
|---|---|
| registry 候选的真实安装时长与失败形状 | 本轮未测（只有本地路径）；下一轮补 |
| `client-rendered`（T-302） | 未测，产物自曝 |
| `namespace-diff`（T-303） | 需要 agent/preset 作用域（T-202a） |
| 多候选 / 矩阵模式 | 不做（一次一个候选，`bisect` 由 T-114 负责） |
