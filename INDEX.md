# 项目全局检索与知识索引中心

> **Stand**: v0.1.0-skeleton (2026-10-26)｜接手先读 `docs/AI_HANDOVER.md`｜路线见 `PROJECT_RULES.md` Roadmap

## 🔍 按需求快速索引

| 需求 | 路径 | 内容/状态 |
| :--- | :--- | :--- |
| **交接入口** | `docs/HANDOFF.md` | 五分钟检查 / 当前批次 / 下一位 agent 的第一件事 / 真实踩过的坑 |
| **执行计划** | `docs/ROADMAP.md` | 12 周阶段表 + 4 个决策门 + 指标看板 + 分发时间线 + kill criteria |
| **任务清单** | `docs/BACKLOG.md` | T-101…T-701（角色 / 依赖 / 验收 / 状态），可直接领取 |
| **Agent 框架** | `.agents/README.md` | 三入口 + 6 张角色卡 + 4 个模板 + 5 条硬性校验 |
| **开工指令** | `.agents/prompts/kickoff.md` | 新会话整块粘入即可开工（含三步命令与期望输出） |
| **审核报告** | `audit/AUDIT_2026-10-26_R3.md` | 四轴 + 对抗性；14 项修复 + 4 项 blocked |
| 接手清单 | `docs/AI_HANDOVER.md` | 真相源、冻结区、防幻觉、5 分钟检查 |
| 工程铁律 | `PROJECT_RULES.md` | 10 条铁律 + 严禁行为 + M0–M5 路线与出口门禁 |
| 设计地图 | `docs/DESIGN-MAP.md` | 六层架构 / 门与证据矩阵 / 数据模型 / 分发位 |
| 愿景与定位 | `docs/00-vision.md` | 「装得上 ≠ 跑得对」判断层；不做市场/启动器/杀软 |
| 竞品与上游归因 | `docs/01-competitors.md` | 12 个竞品 + 上游已吸收清单 + 实测下载量/星标 |
| 信号源评估 | `docs/02-signal-sources.md` | 信号/格式/频率/可信度/许可/适配成本 |
| 失败分类法 | `docs/03-failure-taxonomy.md` | 9 类失败：机制 / 症状 / 谁接得住 / 空白 |
| admission 语义 | `docs/04-admission-semantics.md` | 上游判定规则逐条复刻 + 金标夹具口径 |
| Verdict 契约 | `docs/05-verdict-contract.md` | 结论/证据/置信度/替代方案 JSON 契约 |
| 工程约定 | `docs/08-conventions.md` | 模块边界/命名/错误/确定性/扩展方式/评审清单 |
| 决策记录 | `docs/adr/0001-result-over-exceptions.md` + `docs/adr/0002-override-is-not-a-collision.md` + `docs/adr/0003-zero-dep-gates-with-mutation.md` | Result 优先 / 覆写不是撞车 / 零依赖门禁+负对照 |
| 路线 | `docs/06-roadmap.md` | M0–M5 周级拆解 + 下载量阶梯 + 分发动作 |
| 本机环境 | `docs/07-environment.md` | Node/pnpm/DSH 版本、profile 路径、只读边界 |
| 模块 spec | `docs/specs/M0-skeleton.md`、`docs/specs/M1-why.md` | 判据先行、负对照、诚实边界 |
| 判断引擎 | `packages/core/src/`（admission / env / ledger / verdict） | 纯函数、零网络、可离线 |
| 信号适配 | `packages/signals/src/`（npm / dsh.so / local-artifacts） | 每个信号带 tier + 出处 |
| 隔离实测 | `packages/probe/src/`（plan） | M3：默认 dry-run，独立 DSH_HOME |
| 用户安装件 | `packages/plugin/`（`dsh-triage`） | bundle + patch + bin CLI + Web 面板（M4） |
| 门禁 | `scripts/gate_*.mjs` + `scripts/gate.mjs` | 7 门：admission 对等 / verdict 契约 / SSOT / 治理 / 命名 / 发布 |
| 真跑落盘 | `scripts/scan_env.mjs` | 扫本机 profile → `data/results/*.json` + `.sha256` |
| 测试 | `tests/` | `node --test`（TS 直跑，零测试框架依赖） |
| 金标 | `data/gold/admission-cases.json` | 真实 npm 声明快照 + 人工签署 |
| 隔离 | `quarantine/QUARANTINE_POLICY.md` + `quarantine/vendor-manifest.json` | 双门制 + 许可真相源 |
| 归档 | `_archive/ARCHIVE_MANIFEST.md` | 只进不出 |
| 备份 | `backup/BACKUP_POLICY.md` | snapshots + `.sha256` + tag 策略 |
| 合规 | `COMPLIANCE.md` + `audit/AI_DISCLOSURE_LOG.md` | 本地优先 + 披露 + 数据许可 |
| 说明 | `README.md`（英主）+ `README.zh-CN.md` | 双语文档，口径一致 |
| 上架 | `docs/market/listing_zh.md` | 应用市场/目录提交文案 |

## 🏷️ Tags
`#DSH` `#DeepSeekHarness` `#PluginCompat` `#Diagnostics` `#LocalFirst` `#EvidenceFirst` `#NoQuarantineOfTrust`
