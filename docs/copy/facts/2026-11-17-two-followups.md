# two-followups · 两条上游故障帖的事实包（13627 / 13581）

> **用途**：R118 的第二批回复。两条都是 `deepseek-ai/deepseek-harness` 的 **General** 讨论，
> 发文时**均为 0 回复**（2026-11-17 复读）。两篇作者都已给出根因与 workaround，所以我们**只补他们没做的那一步**：
> `#13627` 补「哪一份副本赢了、以及只改一半会怎样」；`#13581` 补「陈旧 junction 对组合层的后果」。
> **不带新的链接**（本轮链接额度 2 条，已用掉 1 条在 `#13609`；这里最多再用 1 条）。

- **渠道 / 语言 / 受众**：上游 Discussions 回复，英文，维护者与插件作者

## 产物

| 产物 | sha256 | 它提供什么 |
|---|---|---|
| `data/results/audit-2026-11-13T18-25-00.000Z.json` | `9b4ee49403fcaa90362dbf73b71ba32e0134c57f5f5dfeabb4bed1d52a8bfe94` | 真机 profile 的读数形状（246 行 / 93 条判定 / 0 错误；289 项配置、0 冲突） |
| `data/results/desktop-panel-2026-11-12T22-20-00.000Z.json` | —（带 `.sha256`） | 面板与 CLI 同源（`panel 289/0/0` = `cli 289/0/0`） |
| `data/results/rescue-2026-11-05T09-32-00-752Z.json` | `690f43f2d5422e2180015af4aacbcb9ae34026c41372c1fb496e87dc3aa95393` | `dsh.profile.bundles` 的三态分类 |

## 代码层事实（写之前核过）

1. **同一个包名可以在三处各有一份副本**：profile 的 `node_modules`、profile 上一层的共享 `node_modules`、以及**内核**（桌面壳里是 `app.asar` 内的树）。
   来源标签是 `kernel` / `profile` / `shared`（`packages/plugin/src/load.ts`）。
2. **内核自带的 bundle 不在 profile 的 `node_modules` 里**，所以「profile 磁盘上没有」**不等于**「没安装」——
   本仓在 issue #1 上踩过这条，修法是让版本与 manifest 都从**运行中的内核**读，而不是从共享缓存里的旧副本读。
3. **只改一半会更坏**：把版本来源换成内核、但 manifest 仍读旧副本，会把本来满足的行判成 `blocked`；反过来只换 manifest 不换版本，误报原样保留。
   所以「core rows 从 app 先解析」这条建议必须**同源**改造：版本、manifest、patch 层要来自同一处。
4. `dsh.profile.bundles` 是**选中**；`dependencies` 是**装了什么**；`node_modules` 里的副本是**能不能解析**。三者各自独立。

## 可以说什么

- `#13627`：他们的链条是对的；补一句「为什么移除 `package.json` 里的条目没用」（副本仍在，解析仍赢），以及「core rows 从 app 先解析」这一步的**代价与同源要求**。
- `#13581`：补一句「陈旧 junction 不只是让安装失败」——只要那个 junction 还指向存在的目录，**加载器仍可能解析到它**，于是「卸载了但还能被组合」；如果目标已删，则是另一种「解析失败」的形状。
- 两条都可以说「我们已经在自己那侧实现了同一个判断，可以分享判据」，但**不要求他们采用**。

## 不可以说

- 不说「上游设计错了」：`#13627` 的遮蔽是结构后果，`#13581` 是 pnpm 与 Windows 的交互；两篇作者都写清了机制。
- 不给「删掉这些目录就好」的通用建议而不提风险（`#13581` 已警告 `Remove-Item -Recurse` 会顺着 junction 删源目录）。
- 不说「升级到某版就好了」——我们不知道。
- 不重复他们已给的 workaround。

## 边界句

> Boundary: this reads manifests and local files, not your machine; declaration-layer admission does not prove runtime health.
