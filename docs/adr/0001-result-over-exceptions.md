# ADR 0001 · 纯函数返回值，IO 边界用 `Result`

> **状态**：已采纳（2026-10-26） | 影响面：`packages/core`

## 背景

判断引擎会大量被 CLI / Web 面板 / Agent 工具 / 未来的索引源生成器复用。如果核心逻辑抛异常，每个调用点都要 try/catch，而且「失败原因」会退化成字符串，无法稳定测试与本地化。

## 决定

1. **纯函数**（判定、解析、合并、渲染）返回普通值或判别联合，不抛异常；
2. **触碰 IO 的边界**（`loadEnv`、`parsePatchYaml` …）返回 `Result<T, CoreError>`，错误码是可枚举的 kebab-case 常量；
3. **程序员错误**（如 `mergeVerdicts([])`）仍然 `throw`——静默返回空结论比崩溃更危险。

## 后果

- CLI 能给可执行提示（`profile-not-found` → 提示 `--dsh-home`）；
- 测试无需 `assert.throws`，直接断言 `ok/error`；
- 代价：调用方要写 `if (!result.ok)`，但 TypeScript 会强制你处理。

## 替代方案（未采纳）

- 全部抛异常：错误码不可枚举，i18n 文案无法与错误一一对应；
- 全部返回 `undefined`：无法区分「不存在」与「失败」。
