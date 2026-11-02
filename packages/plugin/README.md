# dsh-triage · 本地插件兼容分诊台

**在「装得上」与「跑得对」之间建立确定性判定层 —— 面向 DeepSeek Harness 插件生态**  
*The diagnostic & pre-flight judgment layer for DeepSeek Harness (DSH) plugins.*

[![npm version](https://img.shields.io/npm/v/dsh-triage.svg)](https://www.npmjs.com/package/dsh-triage)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

DSH 原生管理插件的下载与安装，但无法在安装前推演该插件是否与你本机的 DSH 版本、操作系统及**已安装的插件组合**兼容。

`dsh-triage` 专注于排查插件的静默失效根因，并在升级前或安装前提供确定性的准入推演与冲突定位。

---

## 常用命令 / Commands

```bash
# 全局安装 CLI
npm install -g dsh-triage

# 升级日前瞻预检：升到目标版本，当前已装插件哪些会被拦截？
dsh-triage upgrade --to next --card

# 一键体检：一屏输出当前环境配置状态与异常诊断
dsh-triage status

# 逐行归因：查明插件无法加载或被拦截的准入根因
dsh-triage why

# 安装前预检：评估候选插件是否满足当前环境准入
dsh-triage check dsh-cost-meter

# 全量台账：列出已装插件、声明槽位、工具与服务映射清单
dsh-triage audit

# 启动本地可视化诊断面板
dsh-triage serve
```

---

## DSH 设置页集成 / Profile Bundle

```bash
dsh plugin --profile web add dsh-triage
```

装入当前 Profile 后，即可在 DSH **“设置页 → 兼容性分析”** 查阅图形化体检结论、问题列表与一键复制修复命令，或作为 Agent 工具（`compat_verdict`）供 AI 助手主动自检。

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
| `--to <version\|next>` | `upgrade` 命令中指定推演的目标版本 |
| `--card` | 输出 Markdown 格式的升级摘要卡片 |
| `--execute` | `probe` 命令中实际拉起隔离沙盒进程执行实测 |

---

## 核心边界承诺 / Boundaries

- **不提供安全背书**：聚焦于兼容性与准入阻断推演，不替代恶意代码或供应链安全审计；
- **不篡改用户数据**：除临时隔离沙盒外，绝不篡改用户的 `~/.dsh` 配置；
- **绝不生造成绩**：无证据时如实判定为 `unknown`，每条结论均附带可追溯的证据链条。

---

## 开源许可 / License

MIT License. 引用自 [dsh.so](https://www.dsh.so) 的注册表事实数据遵循 CC BY 4.0 协议并已在引用处注明。
