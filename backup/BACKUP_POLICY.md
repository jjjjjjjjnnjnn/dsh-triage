# BACKUP_POLICY

> **Stand**: v0.3.4-published (2026-11-03, R78：快照脚本落地 + tag 现状核对)

## 1. 真相源
- 代码与治理：Git（`main`，禁 force-push）。
- 结论证据：`data/results/*.json` + 同名 `.sha256`，随代码入库。
- 金标：`data/gold/*.json`，变更需 spec + HUMAN-SIGN。

## 2. 快照
- 关键决策点（里程碑通过 / 判据变更 / 发布前后 / 交接）在 `backup/snapshots/` 落同名快照 + `.sha256`：
  - `<name>.json`（状态：版本、git head 与是否脏树、门禁逐项结果、**全部 SSOT 产物的 sha256 清单**、运行时）
  - `<name>.json.sha256`
- **快照由脚本生成，禁手写**：`node scripts/snapshot_state.mjs --name <label> [--stamp <ISO>]`（`--no-gates` 跳过门禁套跑）。
  **R78 更正**：这一行从 M0 起就写着「M2 起提供 `scripts/snapshot_state.mjs`」，而那个脚本**到 R78 都不存在**，
  `backup/snapshots/` 里只有 `.gitkeep`，也没有任何门禁看过 `backup/` —— 一条读起来像已执行、其实从未执行的规则。
  现在脚本落地，并且 `gate_governance` 有两条检查：**策略里点名的脚本必须存在**、**每个快照必须能被 `.sha256` 验证**。
- **快照不是备份**：备份是 git；快照说的是「这个提交上，绿是什么样」。门禁耗时与绝对路径被**刻意排除**，
  否则同一提交两次运行会得到不同的 body，违反确定性。
- **脏树**：`git_dirty: true` 表示快照描述的是带未提交改动的树（本仓长期有 HUMAN 的两份宣传物料未跟踪），
  恢复时必须连同那份工作副本一起看。

## 3. Tag 策略

| Tag | 含义 | 实况（R78 核对） |
|---|---|---|
| `v0.1.0-skeleton` | M0 骨架 | ✅ 已打 |
| `v0.2.0-m1` | admission 对等通过 | ❌ **从未打** |
| `v0.3.0-m2` | `why` 归因可用 | ❌ **从未打** |
| `v0.4.0-m3` | probe 隔离实测可用 | ❌ **从未打** |
| `v1.0.0` | 上架（catalog/hub/dsh.so 至少 2 渠道收录） | ⛔ 未达成（`merged 0` / `listed 0`） |

**R78 记录现状，不改承诺**：表里三个里程碑 tag 从未打过，而 M1–M5 早已交付（见 `PROJECT_RULES.md` 路线表）。
现在补打会是**追溯性声明**（给某个旧提交贴一个「当时通过了」的标签），所以本文件只记事实、不代替决定：
要么 HUMAN 决定从**当前**状态起向前打（例如 `v0.3.4-published`），要么承认 tag 线不启用。这个选择记在
`docs/BACKLOG.md` 的 `T-848`，**未签之前不打任何 tag**（打 tag 是写的动作，且 `main` 禁 force-push，打错只能加不能删）。

## 4. 恢复
任一污染 → 以最近 tag + 快照恢复；新提交覆盖，**禁改写历史**。
