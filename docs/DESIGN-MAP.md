# DESIGN-MAP · 六层架构与门/证据矩阵

> **Stand**: R5 (2026-10-26)

## 1. 分层

| 层 | 名称 | 内容 | 包/位置 |
|---|---|---|---|
| **L0** | 数据与契约 | admission 语义、verdict 契约、金标夹具、消息目录 | `core/src/admission.ts` `types.ts` `messages.ts` `data/gold/` |
| **L1** | 判断引擎 | 判定 → 原因 → 证据 → 替代方案（纯函数、离线）；**bundle 级 + 行级**两路 admission 归因 | `core/src/verdict.ts` `ledger.ts` |
| **L2** | 信号适配 | 本机契约 / 注册表 / 外部工具产物（tier 明确） | `signals/src/*` |
| **L3** | 编排与界面 | CLI、DSH 装载行、Web 面板（M4）、Agent 工具（M4） | `plugin/src/*` |
| **L4** | 实测 | 隔离 `DSH_HOME` 的计划与执行 | `probe/src/*` |
| **L5** | 回流与分发 | 匿名 outcome、群体先验、徽章、format-1 索引源 | M5 |

## 2. 门 / 证据矩阵

| 门 | 守什么 | 证据形式 | 负对照 |
|---|---|---|---|
| `admission-parity` | 与上游 admission 语义逐条对等 | 27 条金标（含 8 条 npm 真快照；R14 新增 6 条） | `--mutate` 破坏 admitted 用例 |
| `verdict-contract` | 结论不得退化成黑箱分数 | `data/results/*.json` 逐条校验 | 注入「blocked 无 remediation」 |
| `ssot` | 结论只由脚本产出且可校验 | `produced_by` + `.sha256` | 篡改哈希 |
| `governance` | 索引/台账/隔离区/密钥 | 引用存在性、登记完整性 | 引用幽灵路径 |
| `namespace` | 不撞上游行 id/服务名 | patch 行 id + 包名 + service 前缀 | 把行 id 改成 `plugin-manager` |
| `release` | 发布件完整性（吃自己狗粮） | 每个包声明 `engines.dsh` | 破坏版本号 |

## 3. 数据模型

```
EnvFingerprint ──┐
                 ├─→ Verdict { conclusion, confidence, reasons[], evidence[], remediation[], missingEvidence[] }
CapabilityClaim ─┤        ▲
ProbeRun ────────┘        │
                     SignalTier: inferred < declared < scanned < measured-registry < measured-local
```

四条记录（口径见 `docs/05-verdict-contract.md`）：

- `EnvFingerprint`：谁的机器（dsh/node/os/profile/bundles/installed）
- `CapabilityClaim`：EntryClaim（id/name/disabled/group/source/depth）
- `RowDeclaration`（R4）：patch row 的模块 + 解析到的包清单/版本（行级 admission 的输入）
- `ProbeRun`（M3）：stages + outcome + durationMs
- `Verdict`：结论 + 证据 + 替代方案

## 4. 分发面（同一个引擎，四种外壳）

| 外壳 | 用户价值 | 状态 |
|---|---|---|
| `dsh-triage why/check/audit` | CLI，零网络 | M0 已有（`why`/`audit` 基础版） |
| Web 面板（`settings.plugins.tab`） | 在 DSH 内直接看到判断 | M4 |
| 作者徽章（SVG） | README 曝光 → 自然获客 | M4 |
| format-1 索引源 | 按本机环境过滤的 Discover 列表 | M4 |
| `compat_verdict` Agent 工具 | Agent 装前自查 | M4 |

## 5. 决策台账

| ID | 决策 | 依据 |
|---|---|---|
| D-01 | 不做市场/启动器/杀软 | 上游与多家已占位（`docs/01-competitors.md` §3） |
| D-02 | 只做声明检查不算产品 | `nzl153/dsh-preflight` 因上游吸收而归档 |
| D-03 | `unconstrained` 必须降级为 `unknown` | 29.2% 抽样无声明（`docs/01-competitors.md` §6） |
| D-04 | 门禁零第三方依赖 | 门禁失效比没有门禁更危险 |
| D-05 | probe 默认 dry-run | 安装会执行第三方脚本（`COMPLIANCE.md` §5） |
| D-06 | 产品名 `dsh-triage` | npm 未占用；语义即「分诊」（该不该装 / 为什么坏） |
