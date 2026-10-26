# QUARANTINE_POLICY（隔离区双门制）

> **Stand**: v0.1.0-skeleton (2026-10-26)

## 为什么要隔离
本项目的输入是**别人的插件产物**（npm tarball / git 仓库 / 本地目录）。这些产物不可信，且带各种许可证。任何时候都不能让它们直接进入 `packages/`、`data/gold/` 或在本机执行。

## 双门制

| 门 | 动作 | 产物 |
|---|---|---|
| **入口门** | 下载 → 落 `quarantine/raw/<pkg>@<ver>/` → 计算 sha256 → 在 `vendor-manifest.json` 登记（名称 / 版本 / 来源 URL / LICENSE 正文摘要 / 取用范围 / 是否可引用） | `vendor-manifest.json#entries[]` |
| **裁决门** | 只读分析后写 `adjudications.json`：`allowed-use`（可引用结论）/ `read-only`（只可参考思想）/ `blocked`（禁止任何形式复用） | `adjudications.json#decisions[]` |

## 硬规则

1. **未登记不得使用**：任何 `packages/` 代码引用外部产物前，必须先在 manifest 里有登记 + 裁决。
2. **不执行不可信代码**：`quarantine/raw/**` 内的代码**永不** `import`／`require`／`child_process` 执行。分析只允许读文件字节。
3. **tarball 只读**：解包用 `tar` 到 `quarantine/raw/`，不跑 `npm install`、不跑 `prepare` 脚本。
4. **许可证红线**：GPL/AGPL/NC/无 LICENSE → `read-only` 或 `blocked`；代码禁抄进 `packages/`，思想可学。
5. **重物 git 忽略**：`quarantine/raw/**` 不入库（见 `.gitignore`），只入库 manifest 与裁决。
6. **清理**：`quarantine/raw/**` 可随时删（它是缓存，不是证据）；裁决与 sha256 是证据，只进不出。
