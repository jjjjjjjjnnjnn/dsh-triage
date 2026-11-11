# dsh-triage · 本地插件兼容分诊台

**DeepSeek Harness (DSH) 插件本地诊断与升级预检工具**  
*The diagnostic & pre-flight judgment layer for DeepSeek Harness (DSH) plugins.*

[![npm version](https://img.shields.io/npm/v/dsh-triage.svg)](https://www.npmjs.com/package/dsh-triage)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

DSH 负责插件的下载与安装，但装好后会不会被准入规则拦截、升级后哪些插件会失效，原生日志往往不会直接给出归因。

`dsh-triage` 是本地诊断与升级预检工具，用于定位插件静默失效的具体原因，并在升级前推演对当前插件组合的兼容性影响。

---

## 常用命令 / Commands

```bash
# 全局安装 CLI
npm install -g dsh-triage

# 升级前预检：升到目标版本，当前已装插件哪些会被拦截
dsh-triage upgrade --to next --card

# 一键体检：一屏查看当前环境状态与问题摘要
dsh-triage status

# 逐行归因：定位插件被拦截或无法加载的具体准入原因
dsh-triage why

# 安装前预检：评估候选插件是否满足当前环境准入
dsh-triage check dsh-cost-meter

# 查看台账：列出已装插件、声明槽位与服务映射
dsh-triage audit

# 启动本地可视化诊断面板
dsh-triage serve
```

---

## DSH 设置页集成 / Profile Bundle

```bash
dsh plugin --profile web add dsh-triage
```

装入当前 Profile 后，即可在 DSH **“设置页 → 兼容性分析”** 查看可视化体检结论、问题列表与复制修复命令，或作为 Agent 工具（`compat_verdict`）供 AI 助手自检。

---

## 退出状态码 / Exit Codes

| 状态码 | 含义 |
|---|---|
| `0` | 执行成功，所有判定通过（`go`）或处于非严格模式 |
| `1` | 发现不满足准入项或存在冲突（需指定 `--strict` 时生效） |
| `2` | 命令行参数或选项错误 |
| `3` | 依赖数据或远端元数据无法获取 |

---

## 常用参数 / Flags

| 参数 | 说明 |
|---|---|
| `--json` | 输出机器可解析的 JSON 格式数据 |
| `--strict` | 当存在非 `go` 结论时以退出码 1 退出 |
| `--profile <name>` | 指定分析的 Profile 名称（默认为 `web`） |
| `--dsh-home <path>` | 覆盖默认的 `$DSH_HOME` 路径 |
| `--to <version|next>` | `upgrade` 命令中指定推演的目标版本 |
| `--card` | 输出 Markdown 格式的升级摘要卡片 |
| `--execute` | `probe` 命令中实际拉起隔离沙盒进程执行实测 |

---

## 工具边界 / Boundaries

- **不提供安全背书**：本工具聚焦于本地兼容性与准入规则推演，不替代恶意代码或供应链安全审计；
- **默认只读，写入只在 `--apply`**：检查与预检不写盘；`fix --apply` 只改 `<profile>/compatibility.json`，`rescue --apply` 只改 `dsh.profile.bundles` 那几行，都是先备份、原子写、记 journal、可 `--undo` 逐字节还原；除独立的临时测试沙盒外不碰别的目录；
- **无证据不猜**：信息不足时如实标为 `unknown`，每条结论均附带明确的证据类型。

---

## 开源许可 / License

MIT License. 引用自 [dsh.so](https://www.dsh.so) 的注册表事实数据遵循 CC BY 4.0 协议并已在引用处注明。
