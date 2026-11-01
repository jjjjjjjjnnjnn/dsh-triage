<!-- channel: upstream GitHub Discussions — 「Show Your Plugins!」分类（#2004 六条规则） -->
<!-- 状态: draft（未发布）。发布前请确认图片附件存在，并按需复算文中的命令。 -->

# 草稿 01 · Show Your Plugins 帖（中文）

> **发帖前检查**：
> 1. 分类选择：**Show Your Plugins!**；
> 2. 标题符合格式：`DSH | dsh-triage | 一句话描述`；
> 3. 附件上传：将 `docs/market/screenshot-0.3.1-mixed.png` 与 `screenshot-0.3.1-real.png` 上传为帖子附件；
> 4. 遵守社区规范：不留私人联系方式与非官方夸大性宣传。

---

**标题**：`DSH | dsh-triage | 升级新版本前，一键预检你已安装的插件哪些会被准入拦截`

**正文**（从下一行开始复制）：

> 非官方项目，由社区成员独立开发和维护。
>
> 项目地址：https://github.com/jjjjjjjjnnjnn/dsh-triage ｜ npm：`dsh-triage@0.3.1`（四包同版本）

## 解决的问题

在 DSH 生态里，升级到新 rc 之后插件「静默消失」是最常见的故障之一：界面没有报错弹窗，功能就是不见了。上游其实会在启动日志里报告那次准入拒绝，但它只是滚动日志里的一行、重启之后翻不到——你看到的是「插件没了」，不是「某一行被拒了」。

这通常源于 DSH 的 **Admission（准入）** 机制：插件在 `package.json` 中声明的 `peerDependencies` 如果精确锁定了旧版本（例如 `@x@0.2.1-rc.4`），当宿主升级到 `0.2.1-rc.5` 时，版本区间不再匹配，该行在启动加载时会被直接摘除。

`dsh-triage` 就是为了在升级前消除这种信息差而开发的轻量预检工具。它直接读取**你当前机器上的实际已装插件组合**，对照目标版本进行静态声明推演，清晰列出哪些插件会被准入拦截、哪些判不了、哪些能够正常放行。

## 快速上手

```console
# 1. 针对下一个候选版本做升级预检，输出结构化卡片
$ dsh-triage upgrade --to next --card

# 2. 检查当前已装环境中是否存在已被准入拦截的行
$ dsh-triage status

# 3. 查看环境准入台账（使用 --all 输出完整明细）
$ dsh-triage audit
```

**安装方式**：

```console
# 作为全局 CLI 独立使用
$ npm i -g dsh-triage

# 或装进 DSH profile（在设置页中直接集成可视化面板）
$ dsh plugin --profile web add dsh-triage
```

## 界面与效果预览

**图 1：三种典型问题同时出现时**（附件：`screenshot-0.3.1-mixed.png`）

> 屏上是 `行 222 · 有判定 185 · 会坏 1 · 撞车 1 · 判不了 184`，与上面那句「有 2 个东西会出问题」对上（1 个会坏 + 1 个撞车）。三行分别是三类最常见的形态：
>
> 1. **会被版本区间拒**——`dsh-breaking-fixture`（原因 `engines.dsh >=9.0.0 不含 0.2.1-rc.4`），这一行带「复制」，复制出来的是能贴进终端的修复命令；
> 2. **两个插件抢同一个位置**——`compat-demo-shared`（原因：两行抢同一个 entry id，来自 `bundle:dsh-collide-fixture-a` 与 `bundle:dsh-collide-fixture-b`，profile 可能起不来）。这一类不带修复按钮：**要摘掉哪一个得你来定**，工具只负责把两个主人点出来；
> 3. **判不了**——`@deepseek-ai/cordis-plugin-timer` 没声明支持区间，工具不猜。
>
> 诚实说明：**这三条都是我们自己的测试夹具**（`dsh-breaking-fixture` 装完之后把声明改写成 `>=9.0.0`；`dsh-collide-fixture-a/b` 故意抢同一个 entry id），用来演示「一屏里同时出现多类问题」长什么样。它们不是你的机器，也不是真实插件。

**图 2：没有发现会被拦的行——但这不等于全部通过**（附件：`screenshot-0.3.1-real.png`）

> 真实沙盒环境：`行 219 · 有判定 184 · 正常 0 · 会坏 0 · 判不了 184`。注意那个 `正常 0`：**没有任何一行被确认为「放行」**。`会坏 0` 只说明这次没发现拒绝；`判不了 184` 是那些没声明 `engines.dsh` 或 peer 区间的行——工具不会把沉默算成通过，也不会替你猜。撞车与重复副本这两行**只在真的存在时才出现**，所以这张图里没有。

## 与 DSH 的集成方式

- **DSH 设置页页签**：执行 `dsh plugin --profile web add dsh-triage` 后，在“设置页 → 内置插件 → 分诊台”即可查看，数据由宿主本地只读路由 `/compat-triage/summary` 统一提供，界面简洁且与命令行同源。
- **Agent 工具 `compat_verdict`**：注册为标准 Agent 工具，支持 AI Agent 在安装插件前主动调用自查。
- **独立 CLI**：无需依赖 DSH 运行时，可独立在终端中执行所有分析子命令。

## 工作机制与边界

- **静态声明预检**：主要看 `package.json` 里的 `engines.dsh` 与 `peerDependencies`；`dsh.compatibility` / `dshReleases` 和 profile 的 `compatibility.json`（精确版本豁免）只作**次要证据**，不能单独把结论改好。判定发生在声明层，不等于运行期一定没问题。
- **纯本地只读**：不修改本地任何 profile 配置，不写入 `~/.dsh`，除解析 `next`/`latest` 标签外无需网络连接，零隐私上报。
- **可复算证据**：
  - 升级卡片判定依据：`data/results/upgrade-card-2026-10-31T09-00-00.000Z.json`（可由命令 `node scripts/record_upgrade_card.mjs --stamp <ISO> --to 0.2.1-rc.5` 复算）；
  - 图 1 那次真机运行（三类问题混合的演示）：`data/results/client-serve-2026-11-01T21-30-00.000Z.json`；
  - 图 2 那次真机运行（真实沙盒）：`data/results/client-serve-2026-11-01T18-30-00.000Z.json`。

欢迎试用体验，有任何建议或 issue 欢迎在仓库交流！
