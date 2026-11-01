<!-- channel: upstream GitHub Discussions — 「Show Your Plugins!」分类（#2004 六条规则） -->
<!-- 状态: draft（未发布）。发布前必须重跑文中的命令，并确认图片路径仍存在。 -->

# 草稿 01 · Show Your Plugins 帖（纯中文，可直接贴）

> **发之前核对四件事**：① 分类必须是 **Show Your Plugins!**（不是 Announcements，上游没有 per-rc 的讨论帖）；
> ② 标题保持 `DSH | 项目名 | 一句话` 的形状；③ 两张截图都要上传成附件（GitHub 讨论区把仓库相对路径当普通链接，
> 图在正文里显示不出来）；④ 数字若已过期，先重跑第 6 节的命令。
>
> **不写个人身份信息**（邮箱 / 即时通讯号 / 个人站点），也不写渠道夸大类的话术。

---

**标题**：`DSH | dsh-triage | 升级 rc 之前，先看你这套已装集合会坏什么`

**正文**（从下一行开始贴）：

> 非官方项目，由社区成员独立开发和维护。
>
> 项目地址：https://github.com/jjjjjjjjnnjnn/dsh-triage ｜ npm：`dsh-triage@0.3.1`（四包同版本）

## 它回答哪个问题

每次 DSH 发新版，真正难受的不是「装不上」，而是装完之后某一行被 admission 挡掉、插件静默消失，日志里只留下一句看不懂的话。

`dsh-triage` 只做一件事：把**你当前这套已装集合**拿去对一个目标版本判一遍，告诉你哪些行会被拒、哪些判不了、哪些会被放行。判的是**声明层**（peer 区间 / `engines.dsh`），不是运行期实测。

## 它不做什么（先说清楚）

- 不做运行期实测——那是它另一个命令 `probe` 的事，单次 5–20 秒，默认 dry-run；
- 不判断插件好不好用，也不提供任何安全背书；
- 不改你的 profile、不写 `~/.dsh`；只有你让它读 npm registry 时才联网。

## 怎么用（三条命令）

```console
$ dsh-triage upgrade --to next --card   # 对下一个 rc 判一遍，输出可粘贴的卡片
$ dsh-triage status                     # 我现在的组合里有没有已经坏掉的
$ dsh-triage audit                      # 逐行台账（--all 出全量）
```

装法：

```console
$ npm i -g dsh-triage                          # 只用 CLI
$ dsh plugin --profile web add dsh-triage      # 装进 DSH：设置页多一个「分诊台」页签
```

## 截图（真机：真 Host + 真浏览器，Edge headless）

**第一张：有东西会坏的时候长什么样。**（图片见附件 1：`screenshot-0.3.1-breaking.png`）

> 屏里那个 `dsh-breaking-fixture` 是**我们自己造的夹具**：它在安装时声明 `engines.dsh: ">=0.2.0"`，装完之后把已安装的 manifest 改写成 `>=9.0.0`。用它演示「装完才坏」那一屏长什么样——**它不是你的机器，也不是真实插件**。真实的判定数字会随你的组合变化，这正是它值得跑一次的原因。

**第二张：什么都不坏的时候。**（图片见附件 2：`screenshot-0.3.1-real.png`）

> 同一个页签，一份真实的沙盒 profile：`行 219 · 有判定 184 · 正常 0 · 会坏 0 · 判不了 184`。注意「判不了 184」不是通过——**不声明支持区间的行不算通过，只能算判不了**。

## 和 DSH 的集成方式

- **一个 profile bundle**：`dsh plugin --profile web add dsh-triage` 之后，设置页 → 内置插件 → 分诊台。结论由宿主侧一条**只读**路由 `/compat-triage/summary` 算好，浏览器只负责显示；界面语言跟随宿主的 locale 绑定，不在前端翻译判据。
- **一个 Agent 工具** `compat_verdict`：装之前让 Agent 自己查一次。
- **CLI 独立可用**：不装 bundle 也能跑全部子命令。

## 复算（数据都在仓里，带 sha256）

- 升级卡片：`data/results/upgrade-card-2026-10-31T09-00-00.000Z.json` ——
  `node scripts/record_upgrade_card.mjs --stamp <ISO> --to 0.2.1-rc.5`
- 设置页那一屏（上面两张图的同一次运行）：`data/results/client-serve-2026-11-01T18-50-00.000Z.json`

## 边界（诚实版）

- 实测只发生在一台 Windows 主机、一个 DSH 运行时（0.2.1-rc.4）。Linux 只跑过 CI 里的渲染对照，**没有跑过真探针**。
- 「13 个候选里 12 个起得来」是**手挑的便利样本**，Wilson 95% 区间 **0.667–0.986**；诚实说法是「我们挑的 13 个里有 12 个」。
- **20 秒是等待预算**（`boot→sample`），不是整次运行的墙钟。
- 卡片上的「目标版本会放行它」**不是**「升级之后就没事了」：声明层放行不是实测。
- 沙盒不是你的 profile；`--copy-profile` 只复制声明文件，不复制 `node_modules` 与 `.npmrc`。

MIT。判错了就把产物和你的 profile 布局贴到仓库 issue 里，我们按同一套判据复算。

---

## 发布后回填

- `registry.json` → 本篇 `status: posted` + `posted_url` + `posted_on`；
- 立刻跑一次基线（D5 的计时钟从**发帖那一刻**开始）：
  `node scripts/record_d5_evidence.mjs --post <讨论 URL> --posted-on <ISO>`，产物是 `data/results/d5-evidence-*.json`；
- 口径写在 `docs/specs/D5-measurement.md`：reactions ≥10 · 外部引用 ≥1 · 周下载 ≥20（且 `download_shape = steady`）。
