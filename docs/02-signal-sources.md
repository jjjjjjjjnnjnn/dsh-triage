# 02 · 信号源评估表

> **Stand**: R5 (2026-10-26) | 每接入一个信号必须登记：格式 / 频率 / 可信度 / 许可 / 适配成本

## 1. 分层

| 代号 | 层 | 内容 | 谁产生 |
|---|---|---|---|
| **S1** | 本机契约 | profile `package.json`、`dsh.profile.bundles`、`node_modules/*/package.json`（engines / peers / `dsh.bundle`）、pnpm-lock | 本机文件 |
| **S2** | 运行时台账 | loader entries + fiber 相位（`pluginInventory/list`）、`tools.schemas()`、`commands.list()`、`settings.describe()`、`skills.list()`、slot 注册 | 运行中的 DSH |
| **S3** | 实测 | probe：`boot / http / render / inventory / namespace-diff` | 本仓 `packages/probe`（M3） |
| **S4** | 注册表 | dsh.so L1–L5 与安全档、npm 元数据、hub catalog v0.4、market format-1（`engines.dsh`） | 第三方 API |
| **S5** | 群体先验 | opt-in 匿名 `(plugin@ver × dshVer × os × node × setHash) → outcome` | 本仓回流（M5） |

## 2. 逐源评估

| 信号 | 格式 | 更新频率 | 可信度（tier） | 许可 | 适配成本 | 备注 |
|---|---|---|---|---|---|---|
| profile 清单 / bundles | JSON | 每次装/卸 | `measured-local`（本机事实） | 本机数据 | 低 | `packages/core/src/env.ts` |
| 已装包 engines/peers | JSON（package.json） | 每次装/卸 | `declared` | 本机数据 | 低 | admission 输入 |
| `dsh.bundle.patch` 存在性 | JSON 字段 | 每次发版 | `declared` | 本机数据 | 低 | 判 F1（装了没反应） |
| bundle patch 行（id/name/insert） | YAML | 每次发版 | `declared` | 本机数据 | 中（YAML 解析） | entry id 撞车检查 |
| loader 相位（active/failed/…） | Remote 调用 | 实时 | `measured-local` | 上游 MIT | 中（Typert Remote，见 `docs/specs/M2-inventory.md`） | S2，M2 接入；契约已锁定（0.2.1-rc.2/rc.3 实测） |
| 工具/命令/settings 命名空间 | 运行时 API | 实时 | `measured-local` | 上游 MIT | 中 | S2，M2 接入 |
| probe 结果 | 本仓 JSON | 每次实测 | `measured-local` | 本仓 MIT | 高（隔离/超时/清理） | M3 |
| dsh.so 安装认证 `/data/install/<slug>.json` | JSON | 随批次 | `measured-registry` | **CC BY 4.0（须署名）** | 低 | 只做先验，禁止改写语义 |
| dsh.so 安全档 `/artifact/<slug>.json` | JSON | 每日 | `measured-registry` | CC BY 4.0 | 低 | 仅引用，不承担安全结论 |
| dsh.so 全量索引 `/plugins-index.json` | JSON（~6 MB） | 随部署 | `measured-registry` | CC BY 4.0 | 中（体积/CDN） | 用于榜单与先验 |
| npm packument | JSON | 实时 | `declared` | registry 条款 | 低 | `packages/signals/src/npm.ts` |
| hub catalog `dsh-hub-index/v0.4` | JSON（~2.8 MB） | 每日 | `scanned` | MIT（仓库） | 中 | 收录状态 |
| market format 1（`engines.dsh`） | JSON | 10 分钟缓存 | `declared` | 各家自定 | 低 | 与 admission 交叉校验 |
| guard 事故报告 / whale-tank `vet-result.json` / savepoint 快照 | JSON/JSONL（**schema 未验证**） | 事件驱动 | 先按 `inferred`，验证后升级 | 各自许可 | 中 | 只发现不裁决（`packages/signals/src/local.ts`） |

## 3. 接入规则（硬性）

1. **每个信号必须自带 `source` + `method` + `at`**，缺一不得进入 verdict（门禁 `verdict-contract`）。
2. **tier 不得越级**：dsh.so 的结论永远是 `measured-registry`，不得标成 `measured-local`（BS-06）。
3. **禁止把第三方 schema 当稳定契约**：字段读取必须防御式（见 `dshso.ts` 的 `projectInstallVerification`），未知字段进 `raw` 不猜测。
4. **CC BY 4.0 署名**：任何展示 dsh.so 数据的面（CLI/面板/徽章/榜单）必须署名，不得改写结论含义。
5. **零网络默认**：CLI 的 `why` / `audit` 不联网；只有 `check` 访问 npm，且失败即降级（不编造）。

## 4. 待验证清单（M2 前必须做完）

- [ ] guard 事故报告的真实路径与字段（当前 `packages/signals/src/local.ts` 只做发现）
- [ ] whale-tank `vet-result.json` 的稳定性（是否随版本变动）
- [x] `pluginInventory/list` 在 0.1.x / 0.2.x 的字段差异 —— 0.1.0-rc.6 无此服务；0.2.1-rc.2/rc.3 字段一致，契约见 `docs/specs/M2-inventory.md`（沙箱实测 `data/results/upstream-*.json`）
- [ ] dsh.so `/data/install/*.json` 的 `state` 枚举是否与文档一致（当前实现容错为 `unknown`）
- [ ] hub catalog 的 `dshWorkshop` manifest 与 `dsh.bundle` 的关系
- [ ] Typert 网关的本地鉴权模型（P3 直连前必须取证；未验证不得实现）
