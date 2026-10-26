# 08 · 工程约定（AI 可维护性契约）

> **Stand**: v0.1.0-skeleton (2026-10-26)
> 目的：让「换一个 AI 接手 / 半年后回来看」仍然能安全改动。所有条款都是可检查的，不是倡议。

## 1. 模块边界（依赖方向单向，禁止回环）

```
plugin (CLI / DSH entry)  →  probe
        │                    │
        ├────────────→ signals ─┐
        └────────────→ core  ←──┘        （core 不依赖任何内部包）
```

| 包 | 允许 | 禁止 |
|---|---|---|
| `core` | `node:fs/promises`（仅 `env.ts`）、`semver`、`yaml` | 网络、`child_process`、DSH 内部模块、`Date.now()` 参与结论 |
| `signals` | `fetch`（注入）、读本机文件 | 判定结论（它只产出证据） |
| `probe` | 纯计划生成（M0–M1）；M3 起 `child_process` | 触碰真实 `DSH_HOME` |
| `plugin` | 编排 core/signals/probe、读写配置 | 复制 core 的判定逻辑 |

**判据**：`core` 必须能在无网络、无 DSH 的机器上单独测试通过。

## 2. 命名

| 对象 | 规则 | 例 |
|---|---|---|
| 包名 | `dsh-triage` 或 `@dsh-triage/*` | `@dsh-triage/core` |
| loader 行 id | 必带 `compat-` 前缀，**永不**使用上游保留 id | `compat-verdict` |
| cordis 服务名 | 以 `compat` 起头 | `compatVerdict` |
| 错误码 | kebab-case，稳定不重命名 | `profile-not-found` |
| 原因码 | `<域>-<细节>` | `admission-denied-peer` |
| 消息 id | `<域>.<键>`，必须存在于 `messages.ts` | `admission.unmet.peer` |
| 证据 id | 简短、稳定、可去重 | `admission` / `runtime` / `npm-1.2.3` |

## 3. 错误处理（两套，不许混用）

| 场景 | 形态 | 理由 |
|---|---|---|
| 纯函数（判定/解析/合并） | 返回值或 `AdmissionResult` 等判别联合 | 调用方不必 try/catch，测试简单 |
| 触碰 IO 的边界（`loadEnv`、`parsePatchYaml` …） | `Result<T, CoreError>`（**不抛异常**） | 错误码可枚举，CLI 能给出可执行提示 |
| 程序员错误（如 `mergeVerdicts([])`） | `throw` | 调用方写错了，静默返回更危险 |

**禁止**：用 `catch {}` 吞掉错误；用 `any`；用字符串拼接错误类型。

## 4. 确定性（可复现是可测性的前提）

1. 所有集合输出必须排序（`localeCompare`）；
2. 时间戳只从 `generatedAt` / `--stamp` 注入，`core` 内不得读时钟；
3. 不得用随机 ID；探测沙盒名用 `sha256(candidate)[0..8]`；
4. 同输入 → 同输出，且单测必须显式断言（见 `tests/unit/verdict.test.ts`）。

## 5. 类型纪律

- `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `erasableSyntaxOnly`；
- 包内相对导入必须带 `.js` 后缀（NodeNext ESM）；
- 不用 `enum`（`erasableSyntaxOnly` 禁止）、不用参数属性；
- 公共 API 必须有 JSDoc，并写明**不变量**与**盲区**；
- 类型只在 `types.ts` 定义一次，其他文件 `import type` 复用。

## 6. 如何扩展（三种常见改动）

### 6.1 新增一条判断规则
1. 在 `docs/03-failure-taxonomy.md` 登记失败类（机制 + 症状 + 谁接得住 + 空白）；
2. 在 `packages/core/src/verdict.ts` 增加 reason（`code` + `messageId`），**不写内联散文**；
3. 在 `messages.ts` 加 `en` / `zh` 两条；
4. 在 `tests/unit/verdict.test.ts` 加断言（含「必须给 remediation / missingEvidence」）；
5. 跑 `pnpm run verify`。

### 6.2 新增一个信号源
1. 在 `docs/02-signal-sources.md` 填表（格式/频率/tier/许可/适配成本）；
2. 在 `quarantine/vendor-manifest.json` 登记许可与使用范围；
3. `packages/signals/src/<name>.ts`：防御式字段读取 + 一个 `*Evidence()` 函数；
4. **禁止**在该模块里给出结论；结论只能由 `core/verdict` 产生；
5. 测试用注入的 `fetch`，不联网。

### 6.3 新增一道门禁
1. `scripts/gate_<id>.mjs` + `scripts/lib/kit.mjs` 的 `runGate`；
2. 在 `audit/gate_ledger.json` 登记（`id/script/enforces/negative_control/requires_build/owner`）；
3. **必须**实现 `--mutate` 且该模式必须 exit 1；
4. CI 会跑两次：正常（必须绿）+ mutate（必须红）。

## 9. 序列化边界（隐私与可分享性）

**规则**：任何离开本机的输出（`data/results/**`、`--json`、未来徽章/索引源）必须在**序列化边界**脱敏，而不是在引擎里改路径。

| 面 | 是否脱敏 | 实现 |
|---|---|---|
| `data/results/*.json`（会进公开仓） | **必须** | `scripts/scan_env.mjs` → `core.redactVerdict` |
| CLI `--json`（会被贴进 issue） | **默认脱敏**，`--no-redact` 可关 | `packages/plugin/src/cli.ts#safeVerdicts` |
| CLI 文本输出（本机显示） | 不脱敏（便于本地复制路径） | `renderVerdict` |
| `docs/07-environment.md`（machine 记录） | 不脱敏（按项目约定集中存放） | 人工维护 |

脱敏范围包括 `env.profileDir` **与** `evidence[].source`（R3 审核的真事故：只脱敏前者仍会泄露 home）。回归保护：`gate_governance` 的 `results-privacy` + `tests/e2e/cli.test.ts`。

## 10. 新增门禁的两条硬要求（R3 起）

1. **必须能被注入故障打红**（`--mutate`），且 `gate.mjs --mutate` 输出 `NEGATIVE CONTROL PASSED · N/N`；
2. 若门禁需要构建产物，在 `audit/gate_ledger.json` 里标 `requires_build: true`，`--fast` 会跳过它。

## 7. 评审清单（提交前自检）

- [ ] `pnpm run verify` 全绿（build → typecheck → test → gate 7 门）
- [ ] `node scripts/gate.mjs --mutate` 输出 `NEGATIVE CONTROL PASSED · 7/7`
- [ ] 新结论带证据 tier 与 remediation / missingEvidence
- [ ] 没有新增 `any`、没有 `catch {}`、没有内联用户文案（文案进 `messages.ts`）
- [ ] 新输出面已按 §9 在序列化边界脱敏
- [ ] `INDEX.md` / `AGENTS.md` 架构图 / `audit/AI_DISCLOSURE_LOG.md` 已同步
- [ ] 若要删除文件：已 `git mv` 进 `_archive/` 并登记
- [ ] 若新增数据源/依赖：`vendor-manifest.json` + `COMPLIANCE.md` 已更新
