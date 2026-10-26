# spec · M1 `why` 归因（与 admission 对等）

> **Stand**: v0.1.0-skeleton (2026-10-26) | 状态：进行中（实现已有，验收待真实案例）

## 1. 用户故事

> 「我装了个插件，MCP 工具凭空少了三个。我不想读日志，我想知道是谁干的、怎么修。」

## 2. 判据

| # | 判据 | 验收方式 |
|---|---|---|
| A1 | 能列出**被 admission 拒绝的行**，并指名是 `engines.dsh` 还是某个 `@deepseek-ai/dsh-*` peer | `dsh-triage why` 输出含 `admission.unmet.*` |
| A2 | 能给出**可直接复制**的修复命令（`allow-version` / 指定版本 / 升级或降级 dsh） | 输出含 `dsh plugin --profile <p> allow-version …` |
| A3 | 能区分四态：被拒 / 无声明（unknown）/ 放行 / 冲突 | `--json` 中 `conclusion` 覆盖 |
| A4 | entry id 撞车能被点名（跨 bundle 与同源） | 构造两份 patch 冲突 → `why` 报 `blocked` |
| A5 | 全程零网络、只读本机 | 断网运行仍成功；`~/.dsh` mtime 不变 |
| A6 | 输出确定性 | `--stamp` 固定 → 两次输出逐字节相同 |

## 3. 真实案例验收（必须做，否则不算完成）

选一个**真实发生**的「工具静默消失」案例（自述或社区 issue），要求：

1. 记录：插件名/版本、当时 dsh 版本、症状、用户当时的猜测；
2. 用 `why` 跑一次，判断是否命中根因；
3. 命中标准：输出点名的行 = 真实根因行，且修复命令执行后症状消失；
4. 证据落 `data/results/why-case-<date>.json`（脱敏）+ `.sha256`。

**未命中**时禁止调参糊过去，必须写清：缺哪个信号、需要 probe 还是需要 S2 台账。

## 4. 负对照

| 场景 | 期望 |
|---|---|
| 全部插件声明健康 | 输出「no denials」，不得编造 warning |
| 插件无任何声明 | 结论 `unknown` + `missing.probe`，不得写成 `go` |
| 运行时版本读不到 | 结论 `unknown` + `missing.runtime`，不得默认放行 |
| 两个 bundle 同 id | `blocked` + 点名两个 owner |

## 5. 已知盲区

- 无法看到 import 失败 / apply 抛错的**行级**原因（需要 S2 台账或 stderr 归因）——M2 解决；
- 无法判断「声明通过但运行期没注册工具」（F4/F7）——M3 probe 解决；
- 无法解释 patch 后置层覆盖 config 导致的静默失效（F9）——未排期。
