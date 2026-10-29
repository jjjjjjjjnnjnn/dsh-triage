# 案例与说明（posts）

> 状态：**三篇都是草稿，尚未在任何平台发布**（R45 撰写）。发布前请重新跑一遍文末的复算命令——文中的数字都来自 `data/results/` 的产物，产物是网络/真机快照。
> 这里的文章只写「可复算的事实 + 明确边界」，不写没有证据的效果承诺。

| # | 文件 | 主题 | 主要证据 |
|---|---|---|---|
| 1 | `01-tool-disappeared.md` | 插件装好后静默消失：行级 admission 归因 | `data/results/why-case-CASE-11080-2026-10-26T12-00-00.000Z.json` |
| 2 | `02-white-screen.md` | HTTP 200 但白屏：按 DOM 判，不按状态码判 | `data/results/render-fixture-blank-2026-10-27T12-58-42.000Z.json` · `data/results/render-fixture-rendered-2026-10-27T12-58-49.000Z.json` |
| 3 | `03-before-you-upgrade.md` | 升级前问一句：四桶 + 生态前向 0（含 `BS-42` 边界） | `data/results/upgrade-mixed-2026-10-29T07-10-00.000Z.json` · `data/results/upgrade-declarations-2026-10-29T07-05-00.000Z.json` · `data/results/upgrade-registry-live-2026-10-29T07-15-00.000Z.json` |

## 发布前检查（每条都要过）

1. 文中每个 `data/results/*.json` 路径存在（`node scripts/check_listing.mjs` 会校验）；
2. 测试数 / 门数 / 版本号与仓库一致（同一脚本）；
3. 引擎区间与 `packages/plugin/package.json#engines.dsh` 一致；
4. 不出现「安全 / 无恶意 / 100% 兼容 / 提升速度」这类没有证据的话术；
5. 第 3 篇的边界段落（`BS-42`：前向 `improved` 0/1584）**不许删**——那是本文最重要的一句话。
