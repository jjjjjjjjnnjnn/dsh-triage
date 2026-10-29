# M6 · 升级日（正门）· 判据先行

> **Stand**: R48 (2026-10-29)｜**状态**：判据已定，**渲染已实现（T-801 ✅）**、**入口已收口（T-806 / T-807 / T-808 ✅）**、**README 首屏已落地（T-809 ✅）**：`packages/core/src/upgrade-card.ts` + `packages/core/src/upgrade-target.ts` + CLI `upgrade --card [--out]` / `--to next|latest` / 无参数引导 + 单测 + 真机 `data/results/upgrade-card-2026-10-29T13-00-00.000Z.json`（14/14）与 `data/results/upgrade-entry-2026-10-29T15-50-00.000Z.json`（26/26）
> **上一层的判据不动**：四桶、`improved` 五条门槛、`admission.ts` 规则顺序全部沿用 `docs/specs/M5-upgrade.md`；本文**只规定渲染与交付形态**，不新增任何判断。

---

## 1. 为什么需要这一层

`upgrade --to` 在 R42 就建好了，但输出是**工程报告**（`renderUpgradeImpact`：四桶逐单元 dump reason / now / missing / fix / registry 注解）。它对调试很好，对「升级日」不好：

- 第一屏看不到结论，用户要先读十几行再自己数；
- 没法直接贴进 issue / Discussion（那是这个场景里唯一的社会动作）；
- 没有边界句，容易被读成「升级会修好」（`BS-42`）。

**所以这一层不是新功能，是把已经正确的判断换一个门口。**

## 2. 契约（8 条）

| # | 判据 | 反例（必须能被拒） |
|---|---|---|
| **C1** | **首行必须是结论**：`<目标版本> · <总数> 个单元：<N> 会被拒 · <N> 判不了 · <N> 会变好 · <N> 像没事` | 首行是「usage: …」或空行 |
| **C2** | 四桶计数**只来自** `judgeUpgradeImpact` 的 `counts`，卡片不重新分类 | 卡片自己算了一个数、与 `counts` 不等 |
| **C3** | `--card` 输出**纯 markdown**，可直接粘贴；含复算命令与产物名 | 输出 terminal 彩色 / 含「按任意键」 |
| **C4** | **边界句强制**：卡片必须写「目标版本会放行它」，并禁止出现「升级会修好 / 升级即修复」 | 出现 `升级会修好` |
| **C5** | **确定性**：同输入 → 同字节（`sha256` 稳定） | 两次渲染 sha256 不同 |
| **C6** | **脱敏**：不出现绝对路径、用户名、`<dshHome>` | 出现 `C:\Users\<名>` |
| **C7** | **退出码沿用** `--strict`（有 `would-be-denied` 且 `--strict` → 1），`--card` 不改退出码 | `--card` 让 exit code 变了 |
| **C8** | **不隐式判定**：没有 `--to` 时**不产出任何桶**、exit 2，并报出「当前运行时 + 可选目标」。`--to <精确版本>` **完全离线**；只有 `--to next` / `--to latest` 才读 npm `dist-tags`（一次只读 GET，15s 超时） | 无 `--to` 却打印了报告；无网络却报出了 `next` 的值 |
| **C9** | **dist-tag 只决定判哪个版本，不决定怎么判**：解析值必须是 `dist-tags[tag]` 的**逐字原文**且是精确 semver（`v0.3.0` 被拒，不改写），然后交给同一个 `judgeUpgradeImpact`。tag 不存在 / 值不精确 / 网络不可达 → **exit 3，零桶**；`--to <精确版本>` 与未知关键字（`canary`）都不联网 | 把 `v0.3.0` 归一化成 `0.3.0`；断网时退出 0 或产出桶；`--to canary` 发起网络请求 |
| **C10** | **卡片可落盘且不覆盖**：`--card --out <file>` 的字节与 `--card` 的 stdout **逐字节相同**，先写临时文件再改名；目标已存在 → **exit 2**；写不进去 → **exit 3 且不留半截**；stdout 只打印路径（在 cwd 之下时为相对路径） | 文件与 stdout 不同字节；静默覆盖；失败后留下 `.tmp-*`；把 `C:\Users\…` 打进 stdout |

## 3. 负对照（每条都要能红）

| # | 构造 | 期望 |
|---|---|---|
| N1 | `--card` 且 `counts.total = 0` | 输出一句「这个 profile 没有可判单元」，退出码 3，**不渲染空表** |
| N2 | 把卡片里的桶计数 +1 | 单测断言 `counts` 与卡片一致 → 红 |
| N3 | 把边界句删掉 | `card-keeps-boundary` 断言 → 红 |
| N4 | 把「目标版本会放行它」改成「升级会修好」 | 禁用话术断言 → 红 |
| N5 | 传入含 `C:\Users\x\...` 的 profile 路径 | 输出中不出现该串（脱敏生效） |
| N6 | 同一 impact 渲染两次 | sha256 相同 |
| N7 | `--card --json` 同时给 | 明确二选一（`--json` 优先并给一行 stderr 说明），不许两个都打印 |
| N8 | 无 `--to` | 引导（stderr）+ exit 2，**stdout 空、不产出桶** |
| N9 | `--to next` 且 registry 不可达 | exit 3 + 「请显式给版本」，stdout 空，**不产出任何桶**（注意：这是 T-806 定死的行为，与 `--registry` 注解失败不同——注解失败只让清单不变） |
| N10 | `--strict` + 有拒 | exit 1，且卡片先写完 |
| N11 | `improved` 单元存在但缺两侧证据 | 沿用 M5 的五条门槛 → 该单元进 `cannot-tell`，卡片如实反映 |
| N12 | 目标版本等于当前版本 | 卡片写 `target = current`，不把已有坏账说成「升级造成」 |
| N13 | 卡片贴到没有 `data/results` 产物的机器上复算 | 命令仍可执行（`upgrade --to` 自足），不依赖本仓产物 |
| N14 | `dist-tags.next = "v0.3.0"`（或 `=0.3.0` / `0.3` / `^0.3.0`） | 拒绝（`tag-not-exact`），**不改写**、不回退到 `latest`（单测） |
| N15 | `dist-tags` 没有 `next`，只有 `latest` | 拒绝（`tag-missing`）并列出实际存在的 tag，不生造目标（单测） |
| N16 | `--to canary`（断网环境） | exit 2（不是 3），证明**没有发起**网络请求 |
| N17 | 无 `--to` 且 registry 不可达 | `targets unknown`，**不出现任何版本号** |
| N18 | `--card --out` 指向已存在的文件 / 父路径是普通文件 | exit 2 且原文件字节未变 / exit 3 且无 `.tmp-*` 残留（Windows 上目录只读拦不住属主写入，这是**替代构造**） |

## 4. 诚实边界

1. **声明层**：四桶判的是「声明 vs 目标运行时」，**不做运行期实测**（那是 `probe` 的活，成本 5–20s/次，不可能对一个 profile 的每个单元都做）；
2. **不是预测**：`likely-fine` 只表示「声明上不冲突」，不代表「升级后真的能跑」；
3. **`improved` 只有降级几何**（`BS-42`）：今天没有「升到更新版本变好」的真实样本，所以措辞只能是「目标版本会放行它」；
4. **集合是本机的**：换一台机器、换一个 profile，结论会不同——这正是它相对于市场 / 注册表的价值，也是它的边界。

## 5. 不做

- 不打分、不排序成「推荐升级」；
- 不做全网兼容矩阵（`dsh.so` 已占位，见 `docs/00-vision.md` §3）；
- 不在卡片里做交互（那是 `serve` / 设置页的事）。

## 6. 验收（D5 之前）

**已达成（R47 渲染）**：

1. ✅ `packages/core/src/upgrade-card.ts` 纯函数 + 10 条单测（`tests/unit/upgrade-card.test.ts`，覆盖 C1–C6 与 N1/N2/N4/N6/N11/N12），全部真跑；
2. ✅ `scripts/record_upgrade_card.mjs` 在沙盒 `upstream` 上真跑：**14/14 自检**，产物 `data/results/upgrade-card-2026-10-29T13-00-00.000Z.json`（192 单元 / 119 拒 / 73 判不了 / 0 改善 / 0 像没事；两次渲染同 sha256；无 home 路径）；
3. ✅ 门禁全绿，四桶判据一字未动。

**已达成（R48 入口）**：

4. ✅ **入口三条路径都有产物**：`scripts/record_upgrade_entry.mjs` 真机 **26/26**（`data/results/upgrade-entry-2026-10-29T15-50-00.000Z.json`）——引导三态（有 profile / 无 profile / 无网络）、`--to next|latest` 的解析值与 registry 逐字比对、以及「同一组合用精确版本重判，四桶计数一字不变」；
5. ✅ **单测钉住纯函数**：`tests/unit/upgrade-target.test.ts`（6 条：只认两个关键字 / 逐字不改写 / 三种拒绝 / 纯函数），`tests/e2e/upgrade-cli.test.ts`（引导三态、断网、未知关键字、`--out` 五种行为）；
6. ✅ **离线复算**：`--fixtures data/fixtures/upgrade-entry/<stamp>` 只重算依赖网络的那两条断言（`data/results/upgrade-entry-recompute-2026-10-29T16-00-00.000Z.json`，3/3）；
7. ✅ **README 首屏**：两份 README 各带一块 `<!-- upgrade-card -->` 标记的**真机卡片**（四桶表 + 边界句 + **sandbox 标注** + 复算命令），`check_listing.mjs` 的 `readme-shows-real-card` 从被引用的产物里读回数字逐项比对——改一个数或删掉沙盒标注即红（两条红产物保留：`listing-2026-10-29T16-30-00.000Z.json` / `listing-2026-10-29T16-35-00.000Z.json`）；
8. ⬜ 卡片样本在对应 rc 的 Discussion 里原样粘贴（**D5 的动作，尚未执行**）。

**真机读数（沙盒 `upstream` → 0.3.0）**：`119 会被拒 / 73 判不了 / 0 改善 / 0 像没事` —— 这正是 `BS-42` 的现场：全仓模板 profile 的行都精确钉 `0.2.1-rc.4`，所以「升到更新的版本」在今天没有任何改善样本，卡片只能如实写「目标版本会放行它」而不能说「升级会修好」。
