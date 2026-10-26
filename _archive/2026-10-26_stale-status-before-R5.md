# 归档快照 · R5 前过期状态行（2026-10-26）

> 为什么归档而不是丢弃：铁律 7「只进不出」。本轮把散落在 19 个文件里的过期状态表述统一改写，
> 原文照抄在此留痕，便于日后追溯「当时我们以为项目在哪一步」。

## 1. 统一改写的内容

| 旧表述 | 新表述 | 影响文件 |
|---|---|---|
| `> **Stand**: v0.1.0-skeleton (2026-10-26)` | `> **Stand**: R5 (2026-10-26)` | `docs/00–08-*.md`、`docs/DESIGN-MAP.md`、`docs/AI_HANDOVER.md`、`docs/HANDOFF.md`、`docs/ROADMAP.md` |
| `**Stand**: R4 (2026-10-26)` | `**Stand**: R5 (2026-10-26)` | `docs/HANDOFF.md`、`AGENTS.md` |
| `"stand": "v0.1.0-skeleton (2026-10-26)"` | `"stand": "R5 (2026-10-26)"` | `audit/gate_ledger.json`、`quarantine/vendor-manifest.json` |

## 2. 逐条修正的过期事实（不是措辞，是数字/状态错）

| 文件 | 原文（过期） | 现文 | 为什么过期 |
|---|---|---|---|
| `docs/06-roadmap.md` | M0 行写「目录、治理、**6 道门禁**」「**7 门** 在 `--mutate` 下全部能 FAIL」 | 8 道门禁 / 8 门 | M0 当时 6 门 → R3 增到 7 → R4 增到 8 |
| `docs/AI_HANDOVER.md` | 「M0 完成（骨架 + **7 门**）… M1 进行中」 | 「M0 ✅（8 门 / 57 测试）… 真实案例 4/10」 | 状态落后两轮，且与 HANDOFF 分叉 |
| `PROJECT_RULES.md` | M0 行「47 测试 / 7 门全绿 / 7/7 CAUGHT」 | 「现为 8 门 / 8-8 CAUGHT，门数随 R4 增长」 | 同上 |
| `README.md` | Status: `v0.1.0-skeleton` (M0)，只说骨架 | `R5`：4 个真实案例复现（4 命中）、行级归因、8 门 | 对外第一屏不能停留在骨架状态 |
| `README.zh-CN.md` | 同上（中文） | 同上 | 同上 |
| `AGENTS.md` | 「M1 真实案例验收 ✅ 1 例命中」 | 「4/10 例（4 命中）」 | R5 新增 3 例 |

## 3. 判定为「不归档」的文件及理由（避免下次重复讨论）

| 文件 | 判定 | 理由 |
|---|---|---|
| `audit/AUDIT_2026-10-26_R3.md` / `R4.md` | **保留，不归档** | 带日期的审核证据；删档会让「当时发现了什么」不可回溯（铁律 7 + 铁律 3 的精神） |
| `data/results/*.json` | **保留** | SSOT，全部被 `audit/step_reviews.json` 引用；`gate step-review` 会拦住孤儿 |
| `docs/06-roadmap.md` | **保留** | 与 `docs/ROADMAP.md` 有重叠，但它是「下载量阶梯 + 分发清单 + 指标」的唯一载体；合并属于结构改动，留作 T-110（需 HUMAN 签字） |
| `docs/specs/M0-skeleton.md` | **保留** | 已交付里程碑的判据原文，属历史契约而非过期状态 |
