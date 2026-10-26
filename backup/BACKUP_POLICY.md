# BACKUP_POLICY

> **Stand**: v0.1.0-skeleton (2026-10-26)

## 1. 真相源
- 代码与治理：Git（`main`，禁 force-push）。
- 结论证据：`data/results/*.json` + 同名 `.sha256`，随代码入库。
- 金标：`data/gold/*.json`，变更需 spec + HUMAN-SIGN。

## 2. 快照
- 关键决策点（里程碑通过 / 判据变更 / 发布前）在 `backup/snapshots/` 落同名快照 + `.sha256`：
  - `<name>.json`（状态：版本、门禁结果、SSOT 哈希清单）
  - `<name>.json.sha256`
- 快照由脚本生成（M2 起提供 `scripts/snapshot_state.mjs`），禁手写。

## 3. Tag 策略

| Tag | 含义 |
|---|---|
| `v0.1.0-skeleton` | M0 骨架 |
| `v0.2.0-m1` | admission 对等通过 |
| `v0.3.0-m2` | `why` 归因可用 |
| `v0.4.0-m3` | probe 隔离实测可用 |
| `v1.0.0` | 上架（catalog/hub/dsh.so 至少 2 渠道收录） |

## 4. 恢复
任一污染 → 以最近 tag + 快照恢复；新提交覆盖，**禁改写历史**。
