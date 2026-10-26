# 07 · 本机环境（machine 记录）

> **Stand**: v0.1.0-skeleton (2026-10-26)｜仓内一律相对路径，绝对路径只写在本文件

## 1. 运行环境

| 项 | 值 |
|---|---|
| OS | Windows（win32 x64 语义），PowerShell 5.1 控制台 |
| Node.js | **v24.15.0**（`C:\Program Files\nodejs\node.exe`），要求 ≥22.19 |
| pnpm | 12.15.0 |
| Git | 2.55.0.windows.5 |
| 仓根 | `C:\Users\rongj\Desktop\项目开发\DSH-Addition` |

## 2. DSH 相关

| 项 | 值 | 说明 |
|---|---|---|
| `DSH_HOME` | `C:\Users\rongj\.dsh` | 未设置环境变量时的默认值 |
| 开发用 profile | `web` | `profiles/web`（含 `package.json` / `cordis.patch.yml`） |
| **本机已装 DSH 版本** | **0.1.0-rc.6** | 从 `profiles/node_modules/@deepseek-ai/dsh/package.json` 实测 |
| 上游基线（开发目标） | **0.2.1-rc.2** | npm dist-tags.latest；admission 语义与 CLI 行为以它为准 |
| 本机已装 bundle | `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` | `profiles/web/package.json#dsh.profile.bundles` |

> ⚠️ 本机版本落后 8 个 rc。**写代码按 0.2.1-rc.2 的语义**（`engines.dsh` 优先、`plugin_manager`、Discover 索引源、`compatibility.json` 豁免），本机 rc.6 只作为「旧基线兼容」的观测样本。

## 3. 只读边界

| 路径 | 读 | 写 |
|---|---|---|
| `~/.dsh/profiles/<p>/package.json` | ✅ | ❌ |
| `~/.dsh/profiles/node_modules/*/package.json` | ✅ | ❌ |
| `~/.dsh/profiles/<p>/cordis.patch.yml` 与 `~/.dsh/cordis.patch.yml` | ✅ | ❌ |
| `~/.dsh/credentials*` | ❌ **永不读** | ❌ |
| `~/.dsh/sessions/**` | ❌（M5 之后按需、且需显式开关） | ❌ |
| 探测沙盒（`%TEMP%\dsh-triage-probe\<pkg>-<hash>`） | ✅ | ✅（可随时删除） |

## 4. 命令

```powershell
# 全链（提交前）
pnpm install
pnpm run verify

# 只看本机环境
node packages/plugin/dist/cli.js env

# 真跑落 SSOT（读本机 profile）
node scripts/scan_env.mjs

# 真实案例复现（隔离沙盒，输入已固化在 data/cases/<ID>/）
node scripts/record_case.mjs --case CASE-11080

# 0.2.x 隔离运行时（不写 ~/.dsh；可随时删）
node scripts/bootstrap_upstream.mjs --version 0.2.1-rc.3

# 门禁负对照（每道门都必须 FAIL）
node scripts/gate.mjs --mutate
```

## 4b. 0.2.x 沙盒（M2 前置）

本机 profile 是 `0.1.0-rc.6`，没有 `pluginInventory`。运行时信号只能在隔离环境里开发：

| 项 | 值 |
|---|---|
| 位置 | `%TEMP%\dsh-triage-env\<version>\`（`install/` 装包，`home/` 是 `DSH_HOME`） |
| 建立 | `node scripts/bootstrap_upstream.mjs --version 0.2.1-rc.3` |
| 证据 | `data/results/upstream-<version>-<stamp>.json` + `.sha256`（含安装版本、`pluginInventory` 存在性、`fiberPhase` 枚举、`dsh --version` 冒烟） |
| 清理 | 直接删 `%TEMP%\dsh-triage-env` |
| 边界 | 不注入任何真实凭据；不改真实 `~/.dsh`；不作安全结论 |

## 5. 已知环境陷阱

| 症状 | 原因 | 处置 |
|---|---|---|
| `pnpm install` 后包间导入失败 | 未 `pnpm build`（包导出指向 `dist/`） | `pnpm run build` |
| `node --test` 找不到测试 | Node < 22.19 或文件名不是 `*.test.ts` | 升级 Node / 改名 |
| 中文乱码 | 控制台编码 ≠ 文件编码（文件为 UTF-8 无 BOM） | 用 Node 读文件判断，不看控制台 |
| `scan_env` 报 `profile-not-found` | `DSH_HOME` 未设置且非默认位置 | `--dsh-home` / `--profile` 显式指定 |
| `probe` 报 sandbox 重叠 | `workRoot` 落在真实 `DSH_HOME` 内 | 换 `workRoot`（默认 `%TEMP%`） |
