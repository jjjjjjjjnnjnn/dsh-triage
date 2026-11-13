# awesome-dsh-plugin 收录（R104）

> **PR**：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14880
> **提交形状**：一个文件 —— `data/plugins/jjjjjjjjnnjnn__dsh-triage--packages-plugin.yml`
> **状态**：**`MERGED`（2026-11-13T17:46:06Z，merge commit `e68d7bc`）** / `+6-0` / `changed_files 1` / **0 reviews**（维护者直接合了，没有留 review）。合并前是 `open` / `MERGEABLE` / `CLEAN` / 两个 check 全绿（R104 记载）
> **渠道台账**：`docs/distribution/channels.json` 的 `awesome-dsh-plugin-14880`（`d5_counts: false`）
>
> **两件不同的事（R109 实测，2026-11-13T18:55Z）**：
> ① **仓库收录 = 已发生**：`data/plugins/jjjjjjjjnnjnn__dsh-triage--packages-plugin.yml` 在 `main`（`c004b4c`），`README.md` / `README.zh.md` 都有这一条（17:50Z 由 `sync-readme` 重生成）。
> ② **网站在线 = 还没发生**：`https://awesome-dsh-plugin.com/plugins.json`（10,778 条）里**没有**这一条；最近一次 `github-pages` 部署是 `4bf5ca5`（**17:44:13Z**，早于合并），而 `Build site from README` 的 `workflow_run`（**run 43477377365**，17:54:17Z）一直 `pending`、**0 job**。
> ③ **不是我们这一条的问题**：同一批 17:50 合并的 `dsh-subor-startup`（#15040）与 `dsh-secret-guard`（#15036）在 `/plugins.json` 里**同样缺席**，而更早合并的 `ai-terminal-pet` 在 —— 说明是构建卡住，不是条目被拒。
> ④ **已留言**：#14880 的 [issuecomment-6861985619](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14880#issuecomment-6861985619)（一条，只报构建状态，并给出 `workflow_dispatch` + `skip_probes: true` 的捷径）。**对方不 dispatch 就只能等** —— 我们没有任何能触发它构建的权限。

---

## 1. 为什么是这张表

它与之前三条 PR 的**机制不同**：

| 列表 | 数据源 | 一个 PR 改什么 | 会不会与别人相撞 |
|---|---|---|---|
| `awesome-dsh-plugin/awesome-dsh-plugin` | `data/plugins/<owner>__<repo>.yml`，**README 由脚本生成** | 只新增**一个文件** | **不会**（条目文件永不重名） |
| `awesome-deepseekharness/awesome-deepseek-harness` | 手写 `README.md` 表格 | 一行 | 会（同一段落追加） |
| `walkinglabs/awesome-deepseek-harness-plugins` | 手写 `README.md` 列表 | 一行 | 会 |
| `dsh-community-plugins` | `community.json`（按 id 升序） | 一条 JSON | 会（需要按 id 插入） |

它自己的 `contributing.md` 写明了这个设计理由：以前所有人往同一个位置追加，合并一个 PR 就撞掉下一个；改成一条目一文件后才不再相撞。这对我们意味着**一次提交、零 rebase 风险**。

## 2. 提交内容（逐字）

```yaml
url: https://github.com/jjjjjjjjnnjnn/dsh-triage/tree/main/packages/plugin
name: jjjjjjjjnnjnn/dsh-triage#dsh-triage
category: dev
description:
  en: 'Read-only judgment layer for DSH profiles: ...'
  zh: '只读的 DSH 插件判断层：...'
```

**为什么 `url` 指到子目录**：仓库是 monorepo，而 `dsh.bundle` 只在 `packages/plugin/package.json` 里（`ABI` 上，别人装的是那个包）。该表明确支持 monorepo 子包：`url` 指子目录、`name` 用 `owner/repo#subname`、文件名用 `owner__repo--packages-plugin.yml`。

**为什么没有 `tarball:`**：已发布在 npm（`dsh-triage@0.3.9`），而 `repository.url` 指回本仓 → 列表会**自动**从 registry 解析 npm 映射（手写 `npm:` 字段反而会被校验拒绝）。`tarball:` 只在「不发 npm」时才需要。

**为什么描述里没有数字**：该表把每句描述当作**对代码的声明**逐条核对；写「46 个工具、六大领域」就得真有。我们写了四件事，每件都能指到命令：`why`/`audit` 的行级归因、`upgrade --to` 的四桶、`probe` 的隔离实测、两个 `--apply` 的接缝与逐字节 `--undo`。

## 3. 它自己的门槛，逐条核过

| 要求（来源：它的 `contributing.md`） | 我们的读数 |
|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ `packages/plugin/package.json` 有 `dsh.bundle.patch: ./cordis.patch.yml`，且同目录就有那个文件 |
| 只声明 `dsh.client` 不行 | ✅ 我们两个都有（`client.platform: web`），因此可装 |
| 仓库 ≥ 1 天 | ✅ 创建于 2026-10-26（远过门槛）；未归档、非 private |
| 仓库有真实代码 | ✅ 4 个包 + 971 测试 |
| `dsh-plugin` topic | ✅ 已在（`gh api .../topics` 复读：`compatibility, deepseek-harness, diagnostics, dsh, dsh-plugin`） |
| 描述称职、无营销词 | ✅ 四条行为描述，零数字、零最高级 |
| 一个 PR ≤ 3 条 | ✅ 1 条 |
| 不是元包（只有依赖清单） | ✅ `dsh-triage` 自己有 CLI、面板、Host 路由与 Agent 工具 |
| 依赖指向原作者 | ✅ 不适用（不是聚合包） |

**门禁的枚举深度也核过**：它的 `check-submission.mjs` 最多看 `MAX_TREE_PKGS = 40` 个 `package.json`，而我们的树里只有 **26** 个，`packages/plugin/package.json` 排在**第 9**——不会被漏掉。

## 4. 维护义务（这张表会长期被扫）

它的 `contributing.md` 与 `scan-decay.mjs` 定期扫：

- **仓库消失 / 归档 / 长期停更 → 标记并移除**；
- **描述与实际不符 → 打回（`held: author`）**；
- **同类的更好实现出现 → 由维护者替换**（不是先来后到）。

我们这边的对应动作（写进 `docs/BACKLOG.md` 的 `T-871`）：

1. **每次改 `packages/plugin/package.json` 或 CLI 行为**：回头核那一行描述；描述里不许出现代码里没有的东西。
2. **每次发版**：确认 `repository.url` 仍指回本仓（它决定 npm 映射能不能解析）。
3. **`dsh.bundle` 与 `cordis.patch.yml` 不许拆**：那是「可安装」的定义，拆了门禁会拒。
4. **描述要改就改自己的条目**：只动 `data/plugins/jjjjjjjjnnjnn__dsh-triage--packages-plugin.yml`，**不要手改 README**（README 是生成的，手改会撞到邻居）。
5. **不要为「更靠前」反复提 PR**：条目按 `owner/repo` 排序，位置不是我们能争取的。

## 5. 与 D5 的关系（红线）

这条 PR **不计入 D5**：`docs/specs/D5-measurement.md` §1 只数三样 —— `#11813` 的 reactions、GitHub search 找到的**第三方**引用、市场基线的周下载。一个 awesome-list 的收录 PR 三者都不是，把它算进去等于**改判据**。

它真正的作用是：让**别人**有可能引用我们——那是 D5 的「外部引用」那一项唯一合理的来源。**2026-11-13T17:46:06Z：合并发生了**（merge commit `e68d7bc`，`+6-0` / 1 文件，**没有 review**）。所以「CI 绿」确实是前置条件而不是收录 —— 但这一次它真的被收录了。生效之后 `T-871` 从「承诺」变成「义务」：描述与代码必须长期一致（见 §4 五条），否则 decay 扫描会把它移掉。
