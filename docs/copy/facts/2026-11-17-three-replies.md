# three-replies · 三条上游故障帖的事实包（13609 / 13374 / 13292）

> **用途**：R118 回答轮。三条都是 `deepseek-ai/deepseek-harness` 的 **General** 讨论，发文时**均为 0 回复**
> （2026-11-17 复读：`#13609` 0 / `#13374` 0 / `#13292` 0）。
> **只回帖，不另发新帖**；发完回填 `docs/copy/outreach.json`（`d5_counts: false`）。
> **投递顺序**：本轮先发这三条，`#13031` 与 `#12932` 隔 1–2 天再发（同仓连发会被读成刷屏）。

- **渠道 / 语言 / 受众**：上游 Discussions 的回复；`#13609` 英文、`#13374` 英文（原帖双语）、`#13292` 中文（原帖中文）
- **链接纪律**：只允许 **1–2 条**回复带本仓链接；本轮只在 `#13609` 带（那里的命令本身就是答案）

## 产物（本事实包所有仓内数字只允许来自这里）

| 产物 | sha256 | 它提供什么 |
|---|---|---|
| `data/results/audit-2026-11-13T18-25-00.000Z.json` | `9b4ee49403fcaa90362dbf73b71ba32e0134c57f5f5dfeabb4bed1d52a8bfe94` | 真机 profile 的读数形状（246 行 / 93 条判定 / 0 错误；289 项配置、0 冲突） |
| `data/results/rescue-2026-11-05T09-32-00-752Z.json` | `690f43f2d5422e2180015af4aacbcb9ae34026c41372c1fb496e87dc3aa95393` | `dsh.profile.bundles` 的三态分类（官方 / 第三方 / 解析不到） |
| `data/results/upgrade-declarations-2026-10-29T07-05-00.000Z.json` | `a5e501de662ae74e2786f062a5198fcd148167a44102f08a9783fbbe8c3cd6cb` | 1,584 个包的关键词扫描：202 今天被拒、前向改善 0 |
| `data/results/remedy-probe-2026-11-05T08-01-23-093Z.json` | `132cec21ca9a89c230616a760065486e6fdda72ced7b89f28857a769278c4f54` | 同一个包四个构建的准入差异（8 条 peer 精确钉定） |

## 代码层事实（写之前逐条核过，不是回忆）

1. **`dsh.profile.bundles` 在 profile 的 `package.json` 里**，路径是 `dsh.profile.bundles`（`packages/core/src/env.ts#parseProfileManifest`：`record.dsh.profile.bundles`）。
   **`dependencies` 与它是两个字段**：依赖被写入 ≠ bundle 被选中。
2. **组合按 `dsh.profile.bundles` 的顺序取层**（`packages/plugin/src/load.ts:83`「Bundle layers, in `dsh.profile.bundles` order」）。
   所以「依赖在、数组里没有」= **装了但从未参与组合**，这与 `#13609` 观察到的现象一致。
3. **区间算术（实测调用本仓 `evaluateRange`）**：
   - `^0.1.0-rc.3` 对 `0.2.2-rc.3` → **不满足**
   - `^0.2.1-rc.3` 对 `0.2.2-rc.3` → 满足
   - `0.2.1-rc.3` 对 `0.2.2-rc.3` → 不满足
   这是 `#13292` 的机制：caret 在 `0.x` 上只放行 `<0.2.0`，**升宿主不会放宽插件自己写的区间**。

## 可以说什么

- 三条帖子的**症状是真的**，而且都能归到「声明层 / 组合层」这条线上：哪一份副本、谁带进来、哪条约束挡住。
- 可以给**只读**核对步骤（读 `package.json` 的三个字段、看 `node_modules` 里的实际版本、看重启后是哪一层在组合）。
- 可以说「手工 `pnpm add` 会把依赖补回来，但**不会**把名字写回 `dsh.profile.bundles`」——这是 `#13374` 与 `#13609` 共有的同一道缝。
- 可以对 `#13609` 的更新路径给**假设**，并明确标注是假设（更新时按名字找「当前选中」，Git spec 可能匹配不上）。

## 不可以说

- 不说「这是上游的 bug」——`#13609` 的复现已经指出 registry 路径正常、Git spec 路径异常，那是他们的结论，我们只补**可核对的判据**。
- 不把声明层结论说成运行期保证；不说「装上就好了」。
- 不在 `#13292` 里劝人重装整套 profile（他们已经修好并验证过）。
- 不提任何我们没测过的平台组合（本仓只测 Windows + 单 pnpm 版本 + Node 24）。
- 不在一条回复里塞第二个链接、不贴无关文章。

## 边界句（每条正文都要有对应的一句）

- 英文：`Boundary: this reads published manifests and local files, not your machine. Declaration-layer admission does not prove runtime health.`
- 中文：`边界：以上判的是声明层与磁盘上的文件，不是你那台机器；声明层放行不等于运行期一定无故障。`
