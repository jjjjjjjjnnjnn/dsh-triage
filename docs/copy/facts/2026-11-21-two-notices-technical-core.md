# 事实包：两条 GitHub 通知的技术内核核实（2026-11-21）

> **来源**：AgentBus `REC-20261121-016`（#14013）与 `REC-20261121-017`（#13730）。
> **主责**：dsh-triage；`REC-016` 明确要求「动笔前先核验我们的产物是否真支持这个说法」。
> **本仓只做技术核实与事实包**：发帖/回帖归 `agent-promotion`，本轮**不回帖**。
> 事实包先行；所有数字都指到带 `.sha256` 的产物。

---

## 1. #13730 — macOS 独立印证，四桶卡预测成立

**通知说法**：SylviaBio 在 #13730 补了 macOS Apple Silicon 的独立案例 —— rc.5 应用 + profile 里 rc.3 的 `dsh-cua-bundle`，空工作区/空历史/无法选模型；回滚 rc.3 后恢复。这是「版本漂移 + 兼容性判定」的**第二个独立印证**。

**核实（读产物，不凭印象）**：

| 读数 | 值 | 产物 |
|---|---|---|
| 本机已装集合升 rc.5 的四桶 | 201 单元 = **0 拒 / 80 判不了 / 0 改善 / 121 像没事** | `upgrade-card-2026-11-19T09-10-00.000Z.json` |
| 本机 audit 判定 | **79 条 verdict 全 `unknown` / 0 `denied`** | `audit-2026-11-19T09-25-00.000Z.json` |
| rc.3 精确 pin 在 rc.5 上的准入 | 四个 pin：**3 denied / 1 unconstrained** | `remedy-probe-2026-11-19T06-54-24-786Z.json` |
| 本机负对照 | desktop profile **0 个官方版本 pin**，19 依赖 / 22 bundle 全按名字声明 | `updater-drift-2026-11-19T06-56-13-204Z.json` |

**结论**：差异可解释且被产物钉住 —— **本机没事是因为没有精确 pin**（卡片 0 拒、audit 0 denied），**有 rc.3 pin 的机器会坏**（三个 rc.3 构建在 rc.5 上 denied）。四桶卡「声明层准入」预测的正是这个场景。第三个独立现场是 RealLearnAI 的 Windows rc.1 实例（`discussion-state-2026-11-21T16-04-50-189Z.json`、`docs/copy/facts/2026-11-21-13730-third-party-verification.md`）。

**边界**：这些是**声明层**判定，不是运行期实测；我们没在 SylviaBio 的 macOS 机器上跑过，也没在 Windows 之外的 host 上执行过命令。`BS-77` 跨平台边界仍 open。

---

## 2. #14013 — takomitkm 的方向对，但判据语义要纠正

**通知说法**：takomitkm 答「某个旧插件没声明 engines.dsh → 激活前被拒 → profile 挂载失败 → Desktop 回退无插件启动 → 文件在磁盘、界面不显示」，建议逐个装插件定位。方向与 triage 的「声明层 vs 运行期」判断一致。

**核实（这是本轮的关键内核）**：takomitkm 说「缺 `engines.dsh` → **被拒**」，而我们的引擎对缺声明判的是 **`unknown`（判不了）**，不是 `denied`：

- `audit-2026-11-19T09-25-00.000Z.json`：本机 79 条 verdict **全 `unknown` / 0 `denied`**，`row-unconstrained` 出现 152 次 —— 这些都是「没写区间」的行，我们的结论是「判不了」，不是「不兼容」。
- `remedy-probe-2026-11-19T06-54-24-786Z.json` 里的 denied 全部带**精确 peer 未满足**（如 `dsh-session@0.2.2-rc.3` 对 rc.5），而那个 bundle 自身是 `unconstrained` —— 被拒的是「写了且不满足的行」，不是「没写的行」。
- 两条 gold 语义（`data/gold/admission-cases.json`、`docs/04-admission-semantics.md`）：`unconstrained → unknown + missing.peer-declaration`（T-107），`blocked` 需要明确的声明冲突。

**结论**：方向一致（都在区分「声明层准入」与「运行期挂载」），但**不能照抄 takomitkm 的「缺声明 = 被拒」** —— 那会把我们判 `unknown` 的行说成 `denied`，与冻结的 admission 语义冲突。答问若引用，应说：

> 缺 `engines.dsh` / DSH peer 在我们这里判「判不了」（unknown，不是不兼容）；写了区间但不覆盖当前构建才是「被声明拒绝」（denied）。你看到的「磁盘上有、界面没有」是声明层与运行期不一致的形状，定位方法（逐个装、重启、记录）是对的。

**边界**：「profile 挂载失败 → Desktop 回退无插件启动」是 takomitkm 对**上游 Desktop 行为**的猜测，我们没有上游启动流程的读数，也没有在对方机器上实测；不替他确认这个因果链。`BS-68`（0 项需要处理 ≠ 一切正常）与 `BS-77`（跨平台零执行面读数）仍 open。

---

## 3. 归属与动作

| 通知 | 主责 | 协作 | 本轮动作 |
|---|---|---|---|
| #13730 | dsh-triage | agent-tech 核实产物 | 核实完成 → 写本事实包 + 回写 AgentBus `fact` 记录；不回帖 |
| #14013 | dsh-triage | agent-promotion 管答问节奏 | 核实完成 → 写本事实包 + 回写 AgentBus `fact`/`lesson` 记录（纠正判据语义）；本仓不回帖 |

**发帖/回帖权归 `agent-promotion`**，本仓库 Agent 只交事实与快照。#14013 的澄清帖已由浏览器代操作发出（`discussioncomment-19800578`，`REC-20261121-014`），答问节奏见 `Promotion/reports/answer-prep-2026-11-22.md`。

---

## 4. 产物指针（数字都带 `.sha256`）

- `data/results/upgrade-card-2026-11-19T09-10-00.000Z.json`
- `data/results/audit-2026-11-19T09-25-00.000Z.json`
- `data/results/remedy-probe-2026-11-19T06-54-24-786Z.json`
- `data/results/updater-drift-2026-11-19T06-56-13-204Z.json`
- `data/results/discussion-state-2026-11-21T16-04-50-189Z.json`

**复算命令**：

```powershell
node scripts/check_listing.mjs --stamp <UTC> --tests 1011
node --test tests/governance/copy-channel.test.ts
```

**AgentBus 回写**：用 `kb bus record add` 写两条 `fact` 记录（#13730 核实结论 / #14013 判据纠正），`audience` 含 `agent-tech`、`agent-promotion`；随后 `kb validate` + `kb bus index`。
