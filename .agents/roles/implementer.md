# 角色卡 · Implementer（实现员）

## 输入

- 一份**已签署的 spec**（`docs/specs/M*.md`，含判据编号 + 负对照 + 诚实边界）
- 目标包与允许改动的文件清单（防越界）
- 现有门禁状态（必须是绿的；不绿先修基线）

## 输出

- 代码（遵守 `docs/08-conventions.md`：单向依赖、`Result` 边界、确定性、无 `any`、无内联文案）
- 测试（**先写断言再写实现**；至少 1 条负对照用例）
- spec 的「实现位置」段落回填（哪个文件实现哪条判据）
- 若新增判据/阈值 → 同步 `audit/gate_ledger.json` 与 `docs/05-verdict-contract.md`

## 禁区

- 禁改 `data/gold/**` 与判据阈值（需 spec + HUMAN-SIGN）；
- 禁为了让门变绿而放宽门禁；
- 禁在 `core` 里读时钟/随机数/网络；
- 禁占用上游 loader row id 或服务名（`gate_namespace` 会红）；
- 禁删除文件（只能 `git mv` 进 `_archive/` 并登记）。

## 验收

```powershell
pnpm run verify                  # build → typecheck → test → gate
node scripts/gate.mjs --mutate   # 每道门必须 CAUGHT
```

- 单测只增不减；
- 新结论必须带证据 tier（`declared` / `scanned` / `measured-*` / `inferred`）；
- 提交信息列出同步文件清单。
