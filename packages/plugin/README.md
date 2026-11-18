# dsh-triage

**DSH 插件：装得上，不等于跑得对。**

升级前一条命令，看清你这套插件会坏哪几个；插件装完就消失时，逐行指出被哪条准入规则拦住。

[![npm version](https://img.shields.io/npm/v/dsh-triage.svg)](https://www.npmjs.com/package/dsh-triage)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![tests: 1002 passed](https://img.shields.io/badge/tests-1002%20passed-success.svg)](https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/scripts/gate.mjs)

```bash
npm i -g dsh-triage
dsh-triage upgrade --to next --card   # 升级前：哪些插件会被拦、为什么、怎么修
dsh-triage why                        # 装完消失：哪一行、被哪条规则拒
```

- **升级日预检**：按你本地已装集合推演，输出四桶（会被拒 / 判不了 / 会变好 / 像没事），每条拒绝都带可执行修复；
- **静默失效归因**：插件装完在界面里消失、日志没报错，逐行给出准入原因；
- **装前判断**：新插件与现有组合会不会撞 Entry ID / 服务名；
- **隔离实测（可选）**：在一次性 `DSH_HOME` 里真装、真启动、取 HTTP 与渲染证据，跑完即删。

装进 DSH 设置页（与 CLI 同一条数据）：

```bash
dsh plugin --profile web add dsh-triage
```

设置页 →「分诊台」：一屏结论、最多 3 条要看的地方、复制即用的修复命令。

---

## 快速上手

```bash
npm i -g dsh-triage

dsh-triage upgrade --to next --card   # 升级前预检，输出可粘贴的卡片
dsh-triage status                     # 一屏结论（不带参数时默认就是它）
dsh-triage why                        # 逐行归因：为什么没加载
dsh-triage check dsh-cost-meter       # 装前判断一个候选
dsh-triage serve                      # 本地 Web 面板
```

`serve` 默认只响应 `127.0.0.1` / `localhost` / `[::1]`（`Host` 不匹配一律 **421**）。局域网访问需显式 `--host <IP>`；经 `ssh -L` 或反向代理改端口时，加 `--allow-host localhost:<端口>`。同一秒内重复刷新复用前次扫描（`reused: true`）。

---

## 判定契约

| 结论 | 含义 |
|---|---|
| `go` | 声明与当前运行时匹配；或 `probe` 实测安装、启动、响应正常且条目为 `active` |
| `risky` | 基本可用，但有明确标记的潜在限制 |
| `blocked` | 有确定性阻断项，无法正常加载；**必定给至少一条可执行修复** |
| `unknown` | 声明或证据不足；**必定列出缺的具体信息** |

证据等级：`declared`（作者声明）· `scanned`（本机文件静态扫描）· `measured-local`（本机真实执行）· `measured-registry`（npm 公开元数据）· `inferred`（推导，不单独作结论）。

---

## 边界

- **不提供安全背书**：本工具不提供安全背书；它聚焦本地兼容性与准入推演，不替代恶意代码或供应链安全审计。
- **默认零写盘，写盘只在 `--apply`**：`status` / `why` / `audit` / `upgrade` / `check` / `serve` 不写盘；`fix --apply` 只改 `<profile>/compatibility.json`，`rescue --apply` 只改 `dsh.profile.bundles` 那几行，都是先备份、原子写、记 journal、可 `--undo` 逐字节还原。
- **真机实测是可选的**：`probe --execute` 在一次性隔离 `DSH_HOME` 里跑，跑完即删，不碰你自己的 profile。
- **无证据不猜**：信息不足时如实给 `unknown`，并列出缺什么。

---

## 常用参数

| 参数 | 说明 |
|---|---|
| `--json` | 输出机器可解析的 JSON |
| `--strict` | 存在非 `go` 结论时以退出码 1 退出 |
| `--profile <name>` | 指定 Profile（默认 `web`） |
| `--dsh-home <path>` | 覆盖默认的 `$DSH_HOME` |
| `--to <version\|next\|latest>` | `upgrade` 的目标；`next` / `latest` 才联网 |
| `--all` | `audit` 打印全量台账（默认摘要） |
| `--apply` | `fix` 执行写入；`rescue` 移除列出的 bundle |
| `--undo <journal>` | `fix` / `rescue` 依 journal 逐字节回滚 |
| `--locale <en\|zh>` | 输出语言（默认 `zh`，或读 `$DSH_TRIAGE_LOCALE`） |
| `--no-redact` | `--json` 保留绝对路径（默认脱敏成 `~`） |
| `--stamp <iso>` | 固定时间戳，让输出可复现 |
| `--snapshot <file>` | `audit` 按 `pluginInventory` 快照判相位；`upgrade` 判冻结组合快照 |
| `--explain` | `check` 显示判定背后的 registry 标签事实 |
| `--registry` | `upgrade` 标注目标版本的已发布构建；`audit` 补发布顺序证据 |
| `--card` | 输出 Markdown 升级摘要卡片 |
| `--out <file>` | `badge` 写 SVG；`upgrade --card` 写卡片并打印路径 |
| `--execute` | `probe` 实际拉起隔离沙盒 |
| `--dsh-main <path>` | `probe --execute` 使用的 DSH launcher |
| `--no-http` | `probe --execute` 无 web 面时跳过就绪等待 |
| `--browser <path>` | `probe --execute` 渲染检查用的 Chromium 系浏览器 |
| `--readiness-timeout <ms>` | 树已稳定时的就绪预算（默认 5000） |
| `--unsettled-timeout <ms>` | 树仍在组合时的就绪窗口（默认 20000） |
| `--copy-profile <name>` | `probe` 在该 profile 的副本里实测 |
| `--port <n>` | `serve` 绑定端口（0 = 自动选空闲端口） |
| `--host <addr>` | `serve` 绑定地址（默认 `127.0.0.1`） |
| `--allow-host <name>` | `serve` 额外允许的 Host 名 |
| `--results <dir>` | `serve` / `badge` 的证据目录 |
| `--allow-execute` | `serve` 允许面板执行动作（默认纯只读） |
| `--no-audit` | `serve` 只列产物，不读当前 profile |
| `--audit` | `serve` 暴露 `GET /api/audit`（与 CLI 同一条引擎） |
| `--outcomes <off\|local>` | `check` / `probe` 本地记录本次判定 |
| `--enable` / `--disable` | `outcomes` 打开 / 关闭本地回流存储 |
| `--purge` | `outcomes` 删除本工具存过的记录与目录 |
| `--status` | `outcomes` 现有记录条数（默认行为） |

---

## 退出状态码

| 状态码 | 含义 |
|---|---|
| `0` | 执行成功，判定为 `go` 或非严格模式 |
| `1` | 存在不满足准入项或冲突（`--strict` 时生效） |
| `2` | 参数或选项错误 |
| `3` | 依赖数据或远端元数据无法获取 |

---

## 许可

MIT。`@dsh-triage/signals` 带一个 dsh.so 适配器（`packages/signals/src/dshso.ts`），其数据接口遵循 CC BY 4.0，适配器显示该类记录时附署名；本包自身只读 npm registry 元数据，不显示 dsh.so 数据。
