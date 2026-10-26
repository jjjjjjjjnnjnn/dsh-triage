# spec · M0 骨架

> **Stand**: v0.1.0-skeleton (2026-10-26) | 状态：✅ 已交付（待 HUMAN 复核金标签名）

## 1. 判据（完成定义）

| # | 判据 | 验收命令 |
|---|---|---|
| C1 | 仓结构可解释：治理/隔离/SSOT/归档/文档齐全 | 人工对 `AGENTS.md` 架构图 |
| C2 | 四个包可构建（core/signals/probe/plugin） | `pnpm run build` |
| C3 | 类型严格（strict + noUncheckedIndexedAccess + erasableSyntaxOnly） | `pnpm run typecheck` |
| C4 | 单测与契约测试全绿 | `pnpm run test` |
| C5 | 6 道门禁全绿 | `pnpm run gate` |
| C6 | **每道门禁都能 FAIL**（负对照） | `node scripts/gate.mjs --mutate` |
| C7 | 真跑落盘 SSOT（本机 profile 扫描） | `node scripts/scan_env.mjs` |
| C8 | 治理台账机器可校验 | `tests/governance/ledgers.test.ts` |

## 2. 负对照设计（证明门不是装饰）

| 门 | mutate 注入 | 期望 |
|---|---|---|
| `admission-parity` | 把一条 admitted 用例的 manifest 改成 `0.0.1` | exit 1 |
| `verdict-contract` | 注入 `blocked` 且 `remediation: []` | exit 1 |
| `ssot` | 篡改第一条结果的哈希 | exit 1 |
| `governance` | 在索引引用里塞一个幽灵路径 | exit 1 |
| `namespace` | 把行 id 改成 `plugin-manager` | exit 1 |
| `release` | 把 core 版本改成 `not-semver` | exit 1 |

## 3. 诚实边界（本阶段没做）

- `probe` 只有计划生成，**没有执行器**（M3）；
- Web 面板、徽章、索引源、Agent 工具**均未实现**（M4）；
- 运行时台账（S2）**未接入**，`audit` 目前只读 patch 静态声明；
- `check` 只判声明层，`admitted` ≠ 可用；
- 本机 DSH 为 0.1.0-rc.6，M0 的真跑样本来自旧基线；0.2.x 语义由金标覆盖。
