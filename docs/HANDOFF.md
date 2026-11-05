# HANDOFF · 交接入口

> **Stand**: R82 (2026-11-05，**急救箱两块都落地（A 只读计划 + B 写入面）**：新命令 `dsh-triage rescue`（M8）—— 三态分类 `official` / `third-party` / `unresolved`（**官方 scope 的 `unresolved` 只报告不裁**），默认**零写盘**；`--apply` 只改 `dsh.profile.bundles`（备份 → 原子替换 → 回读校验 → journal，任一步失败先回滚），`--undo` 逐字节还原并在 profile 被改过时拒绝覆盖；`read_only` / `byte_exact_restore` 都由 sha256 比出来；N1–N11 逐条真红后还原，终跑 **792 测试 / 9 门 ALL GREEN** · **判据/阈值一字未动**）｜R81 (2026-11-05，**同定位仓库研究 + 急救箱方向**：`scripts/record_adjacent_tools.mjs` 用 7 条固定查询采证 **140 个 DSH 相关仓库**（12 个 rescue/doctor 词面命中、6 个无许可证）+ `docs/10-adjacent-tools.md`（可学机制 / 不可抄代码 / 缺口）；下一阶段 `rescue` 计划、SAFE MODE、`profile snapshot` **分支优先**（`T-854`–`T-859`）· **判据/阈值一字未动**；**763 测试**)｜**R80 (2026-11-05，**文案通道 + 外部触达**：对外文案所有权交给外部 `copywriter`（Gemini）——`docs/copy/`（事实包 → 草稿 → 结构校验）+ `.agents/roles/copywriter.md` + `tests/governance/copy-channel.test.ts`（3 条）；同时扫 300 条最近更新的 upstream Discussions，挑出 4 条声明层候选（#10849 / #12210 / #10458 / #10759）与 1 条只能给排查命令的 #12192，按帖子状态与评论排除两条已被回答的（#8202 / #11687）；**判据/阈值一字未动**；**763 测试**)｜**R79 (2026-11-05，**采证 + 交付**：上游 `next` 从 `0.2.1-rc.5` 变成 **`0.2.2-rc.1`** → 真机重跑升级日卡片（**14/14**：192 单元 → **119 会被拒 / 73 判不了 / 0 会变好 / 0 像没事**）+ 已发布 `0.3.4` 的可用性 smoke **6/6**（`upgrade --to next --card` 的目标已是 `0.2.2-rc.1`）；D5 窗口内**第二份现场基线**（窗口 `10-28..11-03`、周下载 **1564**、`steady` 40.5%，日序列 `0/634/192/17/192/357/172` 仍是 10-29 爆发的回声，`BS-48`）→ 覆盖推进到 **`11-03`**、截止 **`2026-11-12`** · **判据/阈值一字未动**；**760 测试**)｜**R78 (2026-11-03，**维护 + 交接**：`backup/BACKUP_POLICY.md` 从 M0 起写着「快照由 `scripts/snapshot_state.mjs` 生成」而**那个脚本从未存在**、`backup/snapshots/` 只有 `.gitkeep`、也没有门禁看过 `backup/` → 脚本落地 + 两条治理检查（策略点名的脚本必须存在、每个快照必须能被 `.sha256` 验证，负对照真红）+ 交接快照；同时核对出 **tag 线从未启用**（表里 3 个里程碑 tag 一个都没打，记成 `T-848` **未签不打**）· 文案与证据对齐 `T-844`/0.3.4 已发布 · **判据/阈值一字未动**；**760 测试**)｜**R77（2026-11-03，发版 + 整理**：四包 **`0.3.4` 已发布**（`latest=0.3.4`，取证 **18/18 · `git_dirty=false`**；T-844 的复制修复随 `client.js` 到用户手里）+ CHANGELOG + 上架文案 / README 的版本号与测试数对齐（`check_listing` **17/17**）· 预检先如实报 `E401`、`npm login` 后才发 · §2 按既定口径只留最近十轮（R39–R66 的 **31 行**逐行归档并登记 `ARCHIVE_MANIFEST`）· **判据/阈值一字未动**；**760 测试**)｜**R76（2026-11-03，交付轮**：把「D5 窗口哪天必须再跑基线」从一句要人记住的话变成算得出来的数 —— `scripts/lib/d5-window-coverage.mjs`（纯函数）+ `scripts/d5_window_status.mjs`（只读）+ 11 条单测 + 2 条治理断言。实测：`last-week` 滞后 **1–2 天**（同日两次跑读到 2 与 1），所以「11-08 之前跑」会漏掉 **11-06**，而「11-03 那份 + 再跑一次」就能无缝拼上；**746 → 760 测试**)｜**下一件事：窗口内基线的第三跑，截止 **`2026-11-12`**（`node scripts/d5_window_status.mjs` 会自己说哪天到期；发布已完成，不要再发）→ 11-15 关窗**
> 任何人（人或 agent）接手，**只读本文件 + `PROJECT_RULES.md` + `INDEX.md` 三份**即可开工。

---

## 1. 五分钟检查（禁跳过）

```powershell
git status --short                  # 必须干净；有未提交改动先问来源
git log --oneline -3
pnpm install --frozen-lockfile
pnpm run verify                     # build → typecheck → test → gate，必须全绿
node scripts/gate.mjs --mutate      # 必须输出 NEGATIVE CONTROL PASSED · 9/9
```

基线不绿 → **先修基线，不叠加新功能**。

---

## 2. 当前批次

| 项 | 状态 |
|---|---|
| 急救箱 A+B：`rescue` 计划 / `--apply` / `--undo`（R82，2026-11-05） | **「GUI 起不来时先裁哪些第三方 bundle」有了一个可撤回的答案（交付轮；判据/阈值一字未动）**。① **判据先行**：`docs/specs/M8-rescue.md` C1–C12 + N1–N11。② **A 段（只读）**：纯函数 `classifyBundles()`（无盘无网、同输入同字节）+ 唯一读盘函数 `readProfileBundles()`（只读 `<profile>/package.json`）；三态 `official` / `third-party` / `unresolved`，官方 scope 但 `link:`/`file:`/`workspace:` 装的算第三方。③ **B 段（写入面）**：`--apply` 只改 `dsh.profile.bundles`，顺序固定为 **备份 → 原子替换 → 回读校验 → journal**，任一步失败**先回滚再抛错**；`--undo` 逐字节还原，profile 在救援后被改过则**拒绝覆盖**（exit 3，文件不动）。备份与 journal 跟 `fix` 同一个根：`<profile>/.dsh-triage/rescue/`。④ **一条 R82 现改的规则（HUMAN 点头）**：真跑时发现「解析不到的官方 bundle」也会被列出可裁——如果解析器没看懂某种布局（pnpm 非 hoisted），那等于把 `@deepseek-ai/dsh-base` 删掉。现在**官方 scope 的 `unresolved` 只报告、不裁**，第三方的不变。⑤ **证据**：`rescue-2026-11-05T09-32-00-752Z.json`（本机真实 profile：2 个官方 bundle · 可裁 0 · read-only）、`rescue-fixture-2026-11-05T09-32-25-410Z.json`（规则改前的合成 4 条）、`rescue-fixture-2026-11-05T09-46-54-876Z.json`（规则改后：3 条 → 可裁 1 / 官方 unresolved 1 只报告）、`rescue-cycle-2026-11-05T09-46-53-964Z.json`（apply→undo 循环：removed 1 · `byte_exact_restore: true` · `dependencies_unchanged: true`）。⑥ **11 条负对照逐条真红后逐字节还原**：N1 只读时顺手格式化 · N2 名字含 dsh 就算第三方 · N3 合并 `unresolved` · N4 删边界句（中英两条同时红）· N7 home 路径进 `--json` · N8 计划加 `generatedAt` · N9 去掉回滚（写后失败 → 文件停在被裁状态）· N10 用「重写等价内容」代替复制备份 · N11 去掉「profile 已被改动」检查。N5 / N6 由「读不到 → exit 3」「缺失 / 空数组两句分开」的断言承担。⑦ **两次自己踩的坑，都记在这**：(a) fixture 脚本用了 PowerShell 只读自动变量 `$HOME` / `$PROFILE`，赋值失败把文件写到 `C:\Users\rongj\profiles\`——逐项核对后整目录删除、改具名变量重做；(b) 用 `Get-Content -Raw` 改 README 会按 ANSI 误读、把中文写成乱码——`git checkout --` 还原后改用编辑器级替换，`git diff --stat` 复核只剩数字变化。**冻结项一字未动**：D5 三个阈值 / 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 同定位仓库研究 + 交接（R81，2026-11-05） | **把「急救箱」定位拆成可比较的能力面，并给出分支优先的集成路线（采证 + 交接轮；判据/阈值一字未动）**。① **可复算的采证**：新增 `scripts/record_adjacent_tools.mjs`（7 条固定查询、原始响应进 `data/fixtures/adjacent-tools/`、许可证 `null` 如实记）→ `data/results/adjacent-tools-2026-11-05T09-03-11.609Z.json`：**140 个 DSH 相关仓库**，词面分类 rescue 6 / doctor 6 / compatibility 6 / backup 10 / ops 4 / catalog 30 / context 10 / other 68；**12 个 rescue/doctor 命中**、**6 个无许可证**。② **研究页** `docs/10-adjacent-tools.md`：逐个点名 `dsh-rescue`（MIT，`enter/exit/status` 只裁 bundles、不动 dependencies）、`dsh-undo-savepoint`（SAFE MODE）、`dsh-backup`（整份 `~/.dsh` 快照/脱敏）、`dsh-win32`（Windows 失败面）、`dsh-plugin-gating-hub` / `dsh-harness-ops`（升级闸门 + 原子切换），并写清**我们已有 / 缺口**：归因与升级预检已够，缺的是「坏了之后的最小可逆动作」。③ **集成策略**：`rescue` 只读计划 → `--apply`/`--undo`（只改 bundles、备份 + journal + 原子写）、SAFE MODE、`profile snapshot`、互操作探测；**全部先走分支**（`feat/rescue-plan`），测试通过再并入主线；**只学机制不抄代码**，AGPL / 无许可证一律不复制。④ **可运行性**：`pnpm run verify` **763 测试 / 9 门 ALL GREEN**、`gate.mjs --mutate` 9/9、`check_listing` 17/17、`usability` 6/6（已发布 0.3.4）。**CI 有一处如实记录**：`41999863821` 首次 `render controls` 红（`expected blank, got inconclusive (no DOM observation)`，18.3s），同一提交**重跑全绿**；成因未归因 → `BS-60` + `T-860`（先加诊断，不改判定）。⑤ **交接**：§3 重写（下一步分支、D5 两个日期、模型纪律），快照 `snapshot-0.3.4-R81`。**冻结项一字未动**：D5 三个阈值 / 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 文案通道 + 外部触达（R80，2026-11-05） | **把「谁写文案」和「谁给事实」拆成两件事，并去上游找出能答的问题（交付轮；判据/阈值一字未动）**。① **文案所有权交给外部 `copywriter`（Gemini）**：新增 `docs/copy/README.md`（事实包 → 草稿 → 结构校验 → 发布四段）、`docs/copy/STYLE.md`（工程化文风 + 禁用话术）、`.agents/roles/copywriter.md`（输入/输出/禁区/验收）、`tests/governance/copy-channel.test.ts`（3 条：角色卡四节、事实包必须引用带 `.sha256` 的产物、草稿必须带 `<!-- facts: -->` 与 paste 块）。工程侧不再代写对外文案；缺事实包就不写。② **扫了 300 条最近更新的 upstream Discussions**（`UPDATED_AT` 倒序），按「声明层可答」筛出 5 条，并对点名的包真算：**#10849** `mcp-client` 四构建（`0.0.1-rc.1` denied 4 项 · `0.2.1-rc.5` **在 0.2.2-rc.1 上也 denied** 8 项 · `0.2.2-rc.1` admitted 8 项；标签 `latest=0.0.1-rc.1` / `next=0.2.2-rc.1`）· **#12210** `dsh@0.2.2-rc.1` / `cordis@4.1.0` / `cordis@4.0.5` 全 `unconstrained`（声明层看不见跨家族错配，支持作者的运行期断言提案）· **#10458** `presentation@0.2.1-rc.2` admitted / `@0.2.0-rc.2` denied（嵌套 app-boot 方向一致）· **#10759** `dsh-tools@0.2.0-rc.2` denied 10 项 / `0.2.1-rc.2` admitted 10 项（本仓有 `CASE-10759` 重建）· **#12192** 无包可算，只给重复副本/冲突排查命令。③ **两条不发**：`#8202` / `#11687` 的评论已经给出更具体的答案（`open` 不等于「没人答」）；**三条只备稿**：`#10458` / `#10759` / `#12192` 是 General 分类、没有 `isAnswered` 字段，`judgeReplyGate` 判 `unreadable`，按仓规不许当 `open`（`T-851`）。④ **已发 8 条**（每条都先确认产物 URL 200）：第一批 `#10849`（comment `19414393`，08:17:36Z）与 `#12210`（`19414394`，08:17:38Z）；第二批（`agy` / `gemini-3.8-flash-high` 写稿）`#12209`（`19414852`，08:45:44Z）· `#11149`（`19414853`）· `#12103`（`19414854`）· `#10458`（`19414856`）· `#10759`（`19414857`）· `#12192`（`19414860`）。General 分类没有 `isAnswered`，六条是在 HUMAN 明确点头 + 人工读完每条评论（评论数未增长）之后发的，并把这条例外写进 `outreach.json` 的 `policy`（`T-851` 仍要把它做成规则）。`d5_counts` 全部 false（D5 只数 `#11813`）。**冻结项一字未动**：D5 三个阈值 / 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门；**763 测试** |
| 采证 + 交付（R79，2026-11-05） | **两件时间敏感的事各做一次，判断一个字没动（采证 + 交付轮）**。① **升级日换了目标**：`@deepseek-ai/dsh` 的 `next` 从 `0.2.1-rc.5` 变成 **`0.2.2-rc.1`**（`latest` 仍是 `0.2.1-rc.5`）。`watch_next_release --baseline data/results,.watch-state` 本机真跑 → `changed`（`data/results/next-release-2026-11-05T07-34-44.456Z.json`）；真机重跑卡片 `--to 0.2.2-rc.1` **14/14**（`upgrade-card-2026-11-05T07-35-01.051Z.json`）：**192 单元 → 119 会被拒 / 73 判不了 / 0 会变好 / 0 像没事**，四桶自检与边界句全过；profile 仍是仓内沙盒 `0.2.1-rc.4`（产物 `limits` 写明不是用户机器）。② **已发布包再验一次**：匿名装 `dsh-triage@0.3.4` 在临时目录跑 `--help` / 无参 `status` / `audit` / `upgrade --to next --card` **6/6**（`usability-2026-11-05T07-35-16.214Z.json`），卡片印出的目标已是 `0.2.2-rc.1`。③ **D5 窗口内第二份现场基线**：`market-baseline-2026-11-05T07-35-31.003Z.json`（`inputs.offline=false`、`failures: []`），窗口 **`10-28..11-03`**、周下载 **1564**、`steady`（6/7 天，峰值 **40.5%**）；日序列 **`0 · 634 · 192 · 17 · 192 · 357 · 172`** —— 仍是 10-29 那次的回声（`BS-48`），按冻结口径 `threshold-met` 但**不是新需求证据**，`judgeD5` 仍 `pending`。④ **覆盖与截止日**：`d5_window_status` → covered **`11-01..11-03`** / missing 12 / **`next_run_by 2026-11-12`**（`d5-window-status-2026-11-05T07-36-24.115Z.json`）；三份入口文档的日期已随产物更新（治理断言会重算）。⑤ **判据/阈值一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门；**760 测试**，`--mutate` 9/9 |
| 维护 + 交接（R78，2026-11-03） | **一条从 M0 起就「读起来像已执行」的规则被兑现，两个从没人看过的缺口被记下来（维护/交接轮；判据/阈值一字未动）**。① **`backup/BACKUP_POLICY.md` 说快照由 `scripts/snapshot_state.mjs` 生成 —— 那个脚本不存在**：`backup/snapshots/` 只有一个 `.gitkeep`，而**没有任何门禁看过 `backup/`**，所以这条规则漂了整 77 轮没人发现。现在脚本落地（零依赖、不联网）：产物含版本 / git head 与脏树标记 / **门禁逐项结果** / **448 份 SSOT 产物的 sha256 清单** / 运行时，**刻意排除门禁耗时与绝对路径**（否则同一提交两次运行会不同）；`gate_governance` 新增两条检查——**策略里点名的脚本必须存在**、**每个快照必须能被 `.sha256` 验证**，负对照把脚本改名 → `backup-policy-scripts` 当场红，改回即绿。② **交接快照已生成**：`backup/snapshots/snapshot-0.3.4-<label>.json`（`git_dirty=true` —— 人类的两份宣传物料长期未跟踪，这条边界写进 policy 的 limits）。③ **第二个缺口：tag 线从未启用**。策略表列了 `v0.2.0-m1` / `v0.3.0-m2` / `v0.4.0-m3`，实测 `git tag` **只有 `v0.1.0-skeleton`**，而 M1–M5 早已交付。补打 tag 是**追溯性声明**（给旧提交贴「当时通过了」），所以**只记事实、不动手**：写成 `T-848`，**未签不打**。④ **顺手纠一处过期读数**：`ROADMAP` 的 M6 行还写「发布（0.3.3 已上线，`latest=0.3.3`）」→ 改成 0.3.4 + 干净树取证指针。⑤ **交接包**：§3 重写（工作区预期 / 唯一时间敏感项 / 别再重发 / 快照怎么用），旧 §3 里「发布待办」那段被替换成已完成记录。**冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 发版复验（R78-P，2026-11-03） | **预检拦住了重复发布，改跑取证再确认一次 18/18（HUMAN 执行）**。`pnpm run release:publish` 被 `version-already-published` 拦下（点名四个包 + 给两条出路），按它自己的提示跑 `node scripts/record_publish.mjs --version 0.3.4` → **18 项全绿**：四包 `latest=0.3.4`、四个 `rewritten` 无 `workspace:`、`dist-tags-agree`、匿名安装 2 秒 6 包、CLI 15 行、`import()` 6 名、`client-bundle` 39219B。**这份 `git_dirty=true`**（宣传物料在工作区里），所以文档仍引用干净树那份（`…T16-05-17.632Z`）；这一份的作用是「发布后再次独立确认」，不另开说法。**冻结项一字未动**：D5 三个阈值 / 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 发版（R77-P，2026-11-03） | **四包 `0.3.4` 真的发出去了，取证读了两遍才对（HUMAN 执行 OTP）**。① **第一次卡在「树不干净」**：`pnpm -r publish` 拒绝脏树（`ERR_PNPM_GIT_UNCLEAN`），脏的正是两份人类宣传物料（`03-x-en.md` 改动 + `reddit-and-hn-posts.md` 未跟踪）→ 用 `git stash push -u` 临时收起（**内容一字未改**），发完取完证再还原；这样做而不是 `--no-git-checks`，是因为后者会让产物记 `git_dirty=true`（R63 的证据口径）。② **四个包全部 `✅ Published`**：core → probe → signals → dsh-triage。③ **取证第一遍是红的**：`publish-2026-11-03T15-45-35.175Z.json` 的四个 `version` 与 `dist-tags-agree` 都还写着 `latest=0.3.3`（共 **6 项红**），而**同一份产物里匿名安装等 302 秒后成功**（19 次「还不在 registry」）→ 又是副本传播滞后，不是发布失败；④ **约 17 分钟后重跑**：`publish-2026-11-03T16-02-49.621Z.json` **18/18 全绿** —— 四个包 `0.3.4`、`latest=0.3.4`、四个 `rewritten` 无 `workspace:`、`dist-tags-agree`、匿名安装 1 秒 6 包、CLI 15 行、`import()` 6 个名字、**`client-bundle` 39219B + loader + slot**（T-844 真的在包里）。⑤ **两份产物都留**：红的那份是「读早了」的证据，不是废件。⑥ **另外手工核对了一次 tarball**（未落产物，命令可随时重跑）：`npm pack dsh-triage@0.3.4` 解开后 `package/client.js` 是 **39219 字符 / 40555 字节**，含 `data-copy-fallback` / `userSelect` / 两语言 `copyFallback` —— 也就是 T-844 的修复**真的在用户下载到的那个文件里**。（坑：PowerShell 的 `Get-Content -Raw` 默认按 ANSI 读，中文会假阴性，要用 UTF-8 读。） |
| 发版准备（R77，2026-11-03） | **四包 `0.3.4` 就位 + 整理归档（交付/维护轮；判据/阈值一字未动）**。① **为什么要发**：R76-C 修的「复制失败时命令留在屏幕上」是 `client.js` 里的改动，而 `client.js` 是**包内文件** —— registry 上的 `0.3.3` 不含它，用户不装新版本就永远看不到修复。② **票面**：四个 `package.json` 同升 `0.3.4`（core/signals/probe/plugin，R42 的教训：只升插件会让用户装到旧 core 并 `SyntaxError`）；`CHANGELOG` 新增 `[0.3.4]`，明写「一处可见修复、判定与 0.3.3 相同」，并**主动写清这一版不含什么**（`scripts/` 不在 `files` 里 → D5 窗口守卫不随包发）。③ **文案对账**：两份 README 的 `dsh-triage@0.3.3` → `0.3.4`、测试数 746 → **760**（徽章 alt / 徽章 URL / 正文三处）；`docs/market/submissions/README.md` 改成「**发布完成后才是 `latest`**」，上一版 0.3.3 的 21/21 取证指针保留 —— **在 `publish-*.json` 出现之前不许写「已发布」**。④ **机器检查**：`check_listing` **17/17**（`version-matches-manifest` 要求每个被点名的版本都等于 manifest 的 0.3.4，改漏一处即红）；`gate_release_pack` OK（四个包的文件清单与体积）；**发布预检如实判红 `E401`**（凭据失效，产物 `release-preflight-2026-11-03T15-42-00.000Z.json`）—— 这不是脚本坏了，是真没登录。⑤ **整理**：`docs/HANDOFF.md` §2 已 38 轮，按 R38 起的一贯口径**只留最近十轮（R67–R76）**，R39–R66 的 **31 行**逐行原文进 `_archive/2026-11-03_HANDOFF-batch-rows-R39-R66.md` 并登记 `ARCHIVE_MANIFEST`；证据指针 / 审核报告 / 未通过门槛行**未搬**。⑥ **一条自己踩的坑**：改写 §2 的第一版脚本从表格处开始复制、**把标题与 §1 整段丢了**；还原后重写，并在脚本里加了「写出前必须仍含标题 / Stand / §1 / §2 / §3」的守卫 —— 这类「搬一块顺手带走另一块」的事故只靠重读是防不住的。**冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 采证（R76-D，2026-11-03） | **D5 窗口内第二份现场基线：下载项仍是 `steady`，但形状还是 10-29 那次的回声（采证轮，判据/阈值一字未动）**。① 真跑 `data/results/market-baseline-2026-11-03T15-11-10.030Z.json`（`inputs.offline=false`、`failures: []`）：窗口 **`2026-10-27..2026-11-02`**（比 06:22 那份多一天）、周下载 **1392**、`download_shape=steady`、5/7 天有下载、峰值 61.3%→**45.6%**。② **日序列必须一起读**：`10-27:0 · 10-28:0 · 10-29:634 · 10-30:192 · 10-31:17 · 11-01:192 · 11-02:357` —— 634 之后仍是 192/17/192/357，**没有断**，所以 `BS-48` 那句「`steady` 不等于人」照旧成立；这份**不是**关窗读数，`judgeD5` 仍 `pending`。③ **它把覆盖推进了一天**：`11-01..11-02` 现在有现场读数，`d5_window_status` 的 `next_run_by` 从 `11-10` 推到 **`11-11`**（三份入口文档已同步，治理断言会盯着）。④ **顺带纠正一处自己的常数**：同一天 06:22 的跑滞后 2 天、15:11 的跑只滞后 **1 天** —— 所以「滞后 2 天」是**保守默认**而不是常数，模块注释与产物 `limits` 都改成 1–2 天并写明「保守一天早、绝不晚」。⑤ **重复读两遍的说法**：这份基线**不是新需求证据**，只是「窗口里有读数」的补证；D5 的三个数一个都没动。**冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 交付（R76-C，2026-11-03） | **T-844：复制失败时把修复命令留在屏幕上（HUMAN 点名要做的那条可见 UI 改动）**。① 问题原样：`client.js` 的修复格只渲染按钮，**命令文本只活在点击闭包里** —— 没有剪贴板或写入被拒时，命令在屏幕上**根本不可达**，失败只写进 `window.__dshTriage.clipboard`（没人读）。② 改法：`copyText(text, onResult)` 把结果同时给**探针标记**与**页面**；失败后修复格多渲染 `data-copy-fallback` 块（一句人话 `copyFallback` + `user-select: all` 的 `<code>` = 引擎自己那行）；页签用 `useState` 记住最后一次尝试。③ **三条断言方向不同**（这是本轮唯一的设计判断）：**正常屏不含命令**（否则「按钮复制的是引擎那行」无法验证）/ 失败后命令作为独立文本节点出现 / 成功时不出现；点击路由也钉住（给了 `onCopy` 就只走它）。④ **负对照**：`if (failed)` → `if (false && failed)` → 单元当场 **1 红**（19/20），改回 20/20。⑤ **真机**：Chromium `--label r76-t844` → **13 passed + `client: 200` + 3 unmeasured**（`screenshot`/`english-screen` 没请求、`clipboard-copy` 因沙盒 profile 无 fix 行），与 R75-P3 形状相同 = **正常屏没被改坏**。⑥ **边界如实写**：真机**没有**复制失败路径的见证，失败路径的证据是 vm 单测（`clipboard-copy` 仍 `unmeasured`）。**冻结项一字未动**：四桶 / `improved` 五门槛 / `admission.ts` / `data/gold/` / 20s / settle / readiness / 9 门 / D5 三个阈值 |
| 分发（R76-B，2026-11-03） | **#65 的冲突又解了一次，这次用「不改别人的字节」的做法（交付 + 分发轮，判据/阈值一字未动）**。① 现场：`gh pr view 65` 实测 **`CONFLICTING/DIRTY`**（上游 `a58eab2..c7bee93` 两个新提交：注册 `dsh-widget-board` + cohort 升级），R75 记的「MERGEABLE 等 review」对今天不成立。② **做法不是 `git rebase` 后手解冲突**：两边都往同一个 JSON 数组末尾追加，三方合并的冲突点正是「逗号与条目位置」。改成**取 `upstream/main` 的文件逐字节 + 只在最后一个 `}` 后插入我们那一条**，写盘前断言「条目数恰好 +1」「`dsh-triage` 是最后一条」→ `git diff upstream/main` 恒 **+12/-0**、1 文件。③ 用它自己的校验器复验：`node scripts/community-index.cjs --check` → **OK (152 entries)**、`node --test scripts/community-index.test.mjs` → **9/9**（两条读数由产物记录）。④ `force-with-lease` 推回后实测 **`MERGEABLE/BLOCKED`** —— `blocked` 是**仓库要求 review**，不是冲突；`reviewDecision` 仍空、`reviews` 仍 0。按 runbook §5 留了**一次**评论（`issuecomment-6607329040`），之后不再跟进。⑤ **一个读数陷阱**：推送后 **46 秒**读的产物里 `#193` 是 `mergeable_state: unknown`（GitHub 还在算），约 2 分钟后重读才是 `clean` —— **两份产物都留**，`unknown` 不是 `clean` 的别名。⑥ 产物 `market-channels-2026-11-03T15-04-52.304Z.json` 与 `…T15-05-38.106Z.json`；`merged` 仍 **0**。**冻结项一字未动**：D5 三个阈值 / 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 交付（R76-A，2026-11-03） | **「下一份基线最晚哪天跑」变成算得出来的数（交付轮；判据/阈值一字未动）**。① **被取代的那句话错了两处**：`AGENTS.md` / `INDEX.md` / `docs/HANDOFF.md` 三处都写着「11-08 之前跑第二份窗口内基线，否则前 7 天永久缺失」。拿两份现场件实测 —— `10-31T06-40` 的窗口是 `10-23..10-29`、`11-03T06-22` 是 `10-26..11-01`，**发布滞后稳定 2 天**（不是 0）；而**滚动窗口不需要一次覆盖 7 天**：相隔 ≤7 天的两跑无缝拼接。所以在 11-07 跑（字面建议）覆盖 `10-30..11-05`，恰好把 **11-06** 留成缺口；真正的截止日是 **`2026-11-10`**（**R76-D 的第二份现场基线把覆盖推进到 `11-02` 后，它变成 `11-11`**）。② **新纯函数** `scripts/lib/d5-window-coverage.mjs#judgeWindowCoverage`（+ 手写 `.d.mts`）：窗口日 `D` 可在 `R ∈ [D+lag, D+lag+6]` 的跑里取到，逐日给 `collect-now` / `upcoming` / `lost`，再算 `next_run_by` 与 `urgent`；**只有 `measured`（`inputs.offline === false`）算覆盖**，复算件明确 `ignored`。③ **只读脚本** `scripts/d5_window_status.mjs`：窗口起点从 **D5 证据链**取（不是「最新的 posted 日期」——第一版就是这么错的，会挑到 X 那条 11-02 的帖子，把窗口整体挪后一天，已修并写进注释）；与 `registry.json` 的同一帖子比 `epochMs`，不一致 **exit 2**；产物带 `lag_observed`（实测 2）；`urgent`/`lost` → **exit 1**。④ **11 条单测 + 2 条治理断言**：治理断言把三份文档里的日期与「按已提交产物重算出来的截止日」对撞（今天固定为最新一份现场件的日期，所以可复算；新基线进仓会让它红，逼文档跟着走）。**它第一次跑就真红**（三份文档都没有 `2026-11-10`）—— 这就是它存在的理由。⑤ **两条负对照各自真红**：把「最后可取日」改成 +1 天 → **6 绿 / 5 红**；让复算件也算覆盖 → **10 绿 / 1 红**；两次都逐字节还原、复跑 **11/11**。⑥ 产物 `data/results/d5-window-status-2026-11-03T14-59-39.111Z.json`（`covered 1 / missing 14 / next_run_by 2026-11-10 / verdict not-yet`）。**冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 交付（R75-P5，2026-11-03） | **两张 ADR 签字后落地（交付轮；判据/阈值一字未动）**。① **`T-811` Host 准入**：新纯函数 `packages/plugin/src/host-allow.ts#judgeHost`（10 条单测）+ `serve.ts` 的请求**第一步**判 Host、失败 **421**（不是 401：Host 错与 token 错是两件事）+ CLI 新增 `--host` / `--allow-host`（`--host 0.0.0.0` 不给 `--allow-host` → **启动即 exit 2** 并打印示例）+ 打印的 URL 一定是规则接受的名字。**默认路径零变化**（`127.0.0.1` / `localhost` 照旧）。**代价如实生效**：局域网 IP 默认打不开。② **`T-814` 1 秒复用**：`AUDIT_REUSE_MS = 1000`（常量，不做配置项）；`singleFlight` 换成 `reusableScan`，挂在**共享扫描层** —— `/api/summary` 与 `/api/audit` 共用同一个窗口（这正是 P4 复审抓到的「治错路由」）；`/api/summary` 的 body 带 `reused` / `age_ms`，`/api/audit` 走响应头（它的 body 必须与 `audit --json` 逐字节相同，R19）；**失败的扫描不缓存**（读不到要能重试）。③ **两处按实测偏离 ADR 原文，已写进两份 ADR 的实施记录**：`/api/audit` 的元数据走头不走 body；`[::1]` 仍在白名单但默认不监听。④ **731 → 746 测试**（+15：Host 纯函数 10 + 集成 5 —— 复审补了「端口 80 省略」与「打印的 URL 合法」两条）；9 门 ALL GREEN；`check_listing` 17/17。⑤ 签字记账在 `audit/SIGNOFF.md` 2026-11-03 行（原话「同意，继续」+ 未逐条复核的三项）。⑥ **复审（独立 adversary）判 FAIL 后修掉四处真缺陷**：`--port 80` 会拒绝每一条请求（浏览器省略默认端口）· `ssh -L` / 反代场景被挡（记入 ADR-0014 §3 并给出 `--allow-host localhost:<port>`）· 打印的 URL 在 `--host ::1` 与 `--allow-host name:port` 两种组合下不是合法 URL（新增纯函数 `panelAuthority` + 6 条用例）· CLI 那行「answers … only」重复 `127.0.0.1` 且漏掉 `[::1]`。**冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 判据记录（R75-P4，2026-11-03） | **两张 ADR 只写决策、不改行为（**当时**等 HUMAN 签字；P5 已签并落地）；复审抓到两处阻断级并已修**。① **`docs/adr/0014-host-header-allowlist.md`（proposed，`T-811`）**：默认绑定要求 `Host` ∈ `127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>`，不匹配 → **421**；`--host 0.0.0.0` 必须配 `--allow-host`，否则启动即 exit 2。**代价写在 ADR 里**：局域网 IP 默认打不开面板 —— 这是需要 HUMAN 点头的那一条。② **`docs/adr/0015-local-panel-rate-limit.md`（proposed，`T-814`）**：案 A（推荐）1 秒复用窗口 + `reused` / `age_ms`，案 B 明确不设限并写死理由；两案各自的代价都写清。③ **独立 reviewer 抓到两处阻断级**：**(a) ADR-0015 原本治错了路由** —— 面板「刷新」走 `/api/summary`（`serve.ts:1251 → :1001 → :1003`），`/api/audit` 只是 raw 页签的一次性读取（`:1151`），照原文实施会「验收全绿而问题原样保留」→ 改成挂在**共享扫描层**（`context.audit` / `singleFlight`），并要求两个路由各一条验收 + 一条「共享同一窗口」断言；**(b) `docs/SECURITY.md` §4.3 原有一句是假话**（「空 Origin 一律拒绝」对 `serve.ts` 不成立，只对 `host-audit-route.ts` 成立）→ 改成两个半边分开写，并点名 DNS rebinding 借的正是 `serve` 这一侧。④ **状态一致**：两张 ADR 的 Status、`SECURITY.md` 两处、`BACKLOG` 两行、`INDEX` 登记全部是「proposed / 等签字」，**没有一处**写成已实施；`packages/` 零改动（reviewer 用 grep 反向取证：`421` / `allow-host` / `AUDIT_REUSE` / `reused` 全仓 0 命中）。⑤ `check_listing` 17/17；**731 测试 / 9 门 ALL GREEN**（这是 P4 当时的数字；P5 落地后是 746）。⑥ **「`packages/` 零改动」只对 P4 当时成立**：P5 签字后已实施（Host 准入 + 1 秒复用），本条保留原样是因为它记录的是那一轮的证据。**冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 契约（R75-P2，2026-11-03） | **T-840：CI 上那条「恰好 1 次尝试」不是契约，是时钟粒度竞态（契约轮，判据/阈值一字未动）**。① **机制**：hook 的停止条件是 `Date.now() - started >= retryMs`，而测试给的是 `retryMs: 1` —— 首试若与 `started` 落在同一毫秒，`0 >= 1` 为假 → 睡 250ms 再试一次，于是拿到 2 个 `attempts`。② **实测**：同一进程（模块已缓存）连跑 40 次，`attempts[0].ms === 0` 与「2 个 attempts」**逐条对齐**（两轮 21/21、25/25）——因果成立；**但这个数字不是这条测试的翻红率**：测试每个用例新建 tree（冷 import），本机按该条件 40/40 都是 1 个 attempt，所以 **CI 那次红只能算「合理但未证明」**（CI 上冷 import 是否 <1ms 没有取证）。**本机绿不能证明稳定**。③ **修法**：`retryMs: 0`（`??` 不会把 0 吞成 20000，`0 >= 0` 恒真 ⇒ 构造上确定），断言仍是 `=== 1`；新增**反方向**测试（`retryMs: 50` → `attempts.length >= 2`、每条 `inactive-context`、`error.attempts` 一致）把「预算用尽才停」也钉住；**同模式残留两处一并收掉**（projection-missing 用例、`probe-hook-two-phase`）——它们不断言计数，但留着就是下一个抖动的种子。④ **诊断补上**：断言消息打印整个 `attempts` 数组（原来只打印 falsy，红一次无法归因）。⑤ **负对照两条**：期望改 2 → 真红（actual 1 / expected 2）；把产品码改成「永不重试」→ 只有反方向测试红、`retryMs: 0` 那条仍绿（说明两条各钉一个方向）。**没有**放宽成 `>= 1`。⑥ **730 → 731 测试**；`check_listing` 17/17。**冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 交付（R75-P3，2026-11-03） | **T-812 / T-813 的见证：一条补上、一条如实判「看不见」，并顺带修掉一个会让记录器挂死的缺陷（交付轮，零判据改动）**。① **T-812 的成功路径早就有真机证据**：5 份 `client-serve-*.json` 里 `clipboard-copy: passed`（真实鼠标事件点击 + 剪贴板读回 = 引擎自己那条命令）。本轮补的是**失败路径的单测**（`tests/unit/client-tab.test.ts`，三分支：无 `navigator` / 写入被拒 / 写入成功）：点击后 marker 必须如实写 `ok:false` + 原因；**负对照**把 `report(false, …)` 改成 `true` → 当场真红，改回即 19/19 绿。**边界如实写**：没有剪贴板时**命令在屏幕上仍不可达**（`client.js` 只渲染按钮，命令文本不进 DOM）→ 新票 `T-844`，本票**不含 UI 改动**。② **T-813 Firefox 装了，但没有 CDP**：`--browser <firefox.exe>` 真跑一次：`mount` / `visible` 直接是 `unmeasured`（detail = `browser never exposed a debugging port`），`summary-visible` / `upgrade-visible` 级联未测，另有 3 项按设计未请求（`screenshot` / `english-screen` / `clipboard-copy`）—— **共 10 项 `unmeasured`，一项 `failed` 都没有**；Host 侧 `bundle` / `install` / `boot` / `graph` / `upgrade-route` / `cleanup` 六项 `passed`，`client` 是 **`200`**；`T-813` 标 ⛔ 并写退出条件（给 probe 加 WebDriver BiDi 后端），`BS-46` 同步，**没有**在任何对外文档里写「Firefox 已验证」。③ **同一次尝试抓到的真缺陷**：Chromium 在页面目标消失后自己退出，Firefox 不会，而子进程继承了**管道 stdio** → 产物写完之后 node 进程仍活着（实测 15 分钟被外部超时杀掉，残留 `firefox.exe --user-data-dir=…cdp-user-data`）。修法 `stdio: 'ignore'` + `unref()`；重跑**正常退出**且读数不变，Chromium 真机 **17 步：13 项 `passed` + `client=200` + 3 项 `unmeasured`**（`screenshot` / `english-screen` 没请求；`clipboard-copy` 因为沙盒 profile 没有 fix 行）—— 与 11-02 那次形状相同，**不是回归**。④ **729 → 730 测试**；`check_listing` 17/17。**冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 分发（R75-P6，2026-11-03） | **#193 有一条真人回复并开出可执行的合并条件；补齐后 PR 已 `MERGEABLE/CLEAN`（交付轮，判据/阈值一字未动）**。 ① 维护者 `hdjekuue`（人类 `CONTRIBUTOR`）留言：仓库检查通过（MIT、`dsh-plugin` topic），**只差 `README.zh.md` 同位置的一行**，补上就合。 ② 我们做的：中文行加在**同一张表同一位置**（`lengrufeng2008/dsh-code-intel` 之后）、星数 `0 → 1`（`CONTRIBUTING.md` 要求「别用 0，除非真的是 0」）；**分支当时 43 个提交落后、`CONFLICTING`** → rebase 到 `upstream/main`，冲突只在我们那一行（保留上游新增的 4 行 + 追加我们那一行）。 ③ 推送后实测：`MERGEABLE / CLEAN`，`curate` 检查 **pass**（正是「两份 README 都要有」那条）；按维护者原话留了**一次**回复（不重复催）。 ④ **`#65` 反而变回 `CONFLICTING/DIRTY`**（上游又动了）：R74 的「别再 rebase，它不是冲突」对今天不成立，下一轮做一次 rebase 并复验；`#140` 未变。 ⑤ 产物 `market-channels-2026-11-03T14-20-00.000Z.json`（三条 PR 的 live 状态：`dirty` / `clean + APPROVED` / `clean`）。 ⑥ **边界**：`reviewDecision: APPROVED` 仍来自 `sourcery-ai`（bot），人类给的是**评论里的承诺**；`merged` 仍是 **0**，收录要等合并。 **冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 采证（R75-P1，2026-11-03） | **D5 窗口内的第一份市场基线：下载项第一次读到 `steady`（1035 / 4 天），但它是 10-29 爆发的回声，不能当 D5 达标（采证轮，判据/阈值一字未动）**。① **为什么要现在跑**：`record_market_baseline` 用的是 npm 的 `last-week`（**滚动 7 天**），关窗那天（`2026-11-15`）刷新只能看见 `11-08..11-14`，D5 窗口的前 7 天（`11-01..11-07`）**会永久缺失**；而上一份基线（`market-baseline-2026-10-31T06-40-00`）覆盖 `10-22..10-30`，**整个落在 D5 窗口之前**。② **真跑**：`data/results/market-baseline-2026-11-03T06-22-20.130Z.json`（现场件 `inputs.offline=false`，12 份原始响应进 `data/fixtures/market-baseline/2026-11-03T06-10-27.203Z/`）。读数：**周下载 1035 · `download_shape=steady` · 4/7 天有下载 · 峰值 61.3%** → 按冻结口径 `threshold-met`（`counts_as_demand: true`）。③ **必须一起说的边界（否则这个数会被读成 D5 达标）**：日序列是 `0 0 0 / 634 / 192 / 17 / 192` —— 634 之后三天是 **192 / 17 / 192**（两个 192 同值），**看起来仍像抓取方的回声**；`BS-48` 已写明「`steady` 只说明不像单日爬虫，**不等于人**」。④ **窗口边界**：这份基线的窗口是 **`2026-10-26..2026-11-01`**，只有 `11-01` 落在 D5 窗口内 → 它**不是**关窗读数；reactions 仍 **0/10**、外部引用仍 **0/1**，`judgeD5` 仍只会给 **`pending`**。⑤ **离线可复算**：`--fixtures` 重跑，`d5` / `categories` / `downloads` / `discussions` **逐项相同**（`SAME = true`，复算件在 `%TEMP%` 未进 SSOT）。⑤b **独立 verifier 复审抓到并修掉一处真缺陷**：产物里 `claims[].id` 写死成 `this-package-weekly-downloads-are-not-demand`，而 `statement` 在 `steady` 那天说 `counts as demand: true` —— **同一个对象自相矛盾**（id 是旧答案的硬编码副本）。修法是让 id 只命名主体（`this-package-weekly-downloads-verdict`），并新增治理测试：**同一个 subject 在 burst 与 steady 两组夹具下 id 必须相同**，且 id 不得出现 `not-demand` / `threshold-met` / `burst-not` / `counts-as` / `pass` / `fail`；负对照把 id 改回旧值 → **当场真红**（exit 1），改回即 5/5 绿。含矛盾 id 的旧产物（`06-10-27`）与其 fixtures 已删除，重跑件是 `06-22-20`（数字一字未变：1035 / steady / 4 天 / 61.3%）。⑥ `check_listing` **17/17**；**728 测试 / 9 门 ALL GREEN**。**冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 交接（R74，2026-11-02） | **只交接 + 补一页实测现状，不改行为**。① **换会话可用性检查**：`pnpm run verify` **728 测试 / 9 门 ALL GREEN**、`--mutate` **9/9**、`check_listing` **17/17**、CI `success`（run `41520036285`）；工作区只剩两个**人类宣传物料**（`docs/distribution/T-810/03-x-en.md` 改动、`docs/distribution/reddit-and-hn-posts.md` 未跟踪）——HUMAN 明确「用于宣传，不要管」。② **新增 `docs/distribution/pr-65-status.md`**：三条渠道 PR 的实测状态（`#65` **MERGEABLE/BLOCKED、零 review**；`#193` 的 `APPROVED` 来自 **bot**（`authorAssociation: NONE`）；`#140` **CLEAN、零 review**），并写清「合并会改变什么 / **不会**改变 D5 / 不许做的三件事（再 rebase、改内容换合并、重复催） / 一次性的评论模板 / 放弃条件」。**这一页的存在理由**：外部转述说「#65 仍冲突需解冲突」，按错的原因去修会做无用功。③ **`T-842` 两条采集路径都试过并堵死**：Reddit `.json` → **403**；`old.reddit.com` → **200 但内容是「Welcome to Reddit」拦截面**（`datetime=` 零命中）。剩下只有 CDP 真浏览器一条路，而 `render.ts` 的取值表达式写死，要动 probe 包 → 单独一轮。**④ 本轮没有任何判据/阈值/代码行为改动**（只有 docs + BACKLOG 状态）。**冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 交付（R73，2026-11-02） | **四个渠道的台账变成机器可查的，并当场更正两处转述（交付轮，判据/阈值一字未动）**。① **背景**：R56–R72 之间投放面从「一个 discussion」扩到四个渠道（GitHub `#11813` / X / `r/DeepSeek` / `r/DeepSeekHarness`），而只有 GitHub 那条被机器检查过（`T-810/registry.json`），其余活在 prose 表格里 —— 两种失败形状：**链接打错没人点**（R57 的「引用了不存在的产物」搬到 URL 上）与**推广悄悄变成证据**（11-15 最诱人的一句话是「我们发了四个地方，总该算吧」）。② **做法**：新增 `docs/distribution/channels.json`（平台 / 链接 / 日期 / `d5_counts` / `evidence` / `why_not_counted`）+ 纯函数 `scripts/lib/channels.mjs#judgeChannels`（10 条单测）+ `check_listing` **第 17 条** `channel-ledger-matches-reality`：**`d5_counts: true` 只允许一条**；其余每条必须写 `why_not_counted`（否则推广会看起来像需求）；URL 域必须与平台相符；计入 D5 的那条要与 `registry.json` 的 `posted_url` / `posted_on` **逐毫秒相同**；`00-README.md` 的表与台账**双向**对齐（表里有台账没有 = 无人检查的说法；台账有表里没有 = 读者看不见）。**三条定向负对照各自真红并保留产物**（把 Reddit 设成计入 `20-24-54` / 把 Reddit 域换成 x.com `20-24-59` / 删掉表里一行 `20-25-25`），终跑 **17/17**。③ **两处转述校正**（都不是我说的，但必须按证据记）：**(a)** 「`gate.mjs 6/6`」不成立 —— 仓里是 **9 门**（实测 `ALL GREEN · 9 gates`）；**(b)** 「PR #65 仍处于冲突状态」不成立 —— `gh pr view 65` 实测 `mergeable: MERGEABLE` / `mergeStateStatus: BLOCKED`，R60 已把冲突解掉，`BLOCKED` 的门槛是**等 review**，不是解冲突。④ **一处文档自相矛盾**：`00-README` 的 R58 注记写「三条回帖不发了——帖子已经有人答过」，而 R71 实测三条都 `isAnswered: false`（各有 1–2 条回复）；**决定不变**（不发），理由改成「已有人回复，再贴一份只会稀释信息」，并注明「没人接受答案 ≠ 没人回」。⑤ **718 → 728 测试**（+10 `channels`）；9 门 ALL GREEN；`--mutate` 9/9；`check_listing` **17/17**。**边界如实写**：Reddit 的正文与发布时间从本机读不到（`.json` 端点 403），那两条 `evidence` 只能是 `declared-url-reachable`、`posted_on` 留空（不猜时刻）。**冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 交付（R72，2026-11-02） | **D5 关窗的「怎么跑」写成一页，并把「可离线复算」这条硬规则补到 D5 上（交付轮，判据/阈值一字未动）**。① **runbook**：`docs/d5-close-runbook.md` —— 关窗（`2026-11-15T20:24:37Z`）当天四条命令（**刷新市场基线 → 读 D5 并抓原始读数 → 离线复算 → 登记**）、三个数各自的来源与陷阱、判定表照抄 spec、退出码含义（**`fail` 走 exit 1 是判定完成，不是脚本坏了**）、`pass` / `fail` / `unmeasurable` 三个分支各自做什么（`fail` → 执行 D，**禁止再加功能**）。② **写 runbook 的时候撞见两个真问题**：**(a) 下载那一项不是现场抓的** —— 它读最近一份 `market-baseline-*.json` 的 `d5` 块，不刷新就是拿 `10-31` 的数判 `11-15` 的窗；**(b) `--fixtures` 只读不写**，全仓没有任何东西会产出 D5 的 fixtures（R54 那份自检夹具是手写的）→ **关窗产物的离线复算是空路径**，而这正是仓规「进 `data/results` 的数必须可离线重算」要求的东西。补 `record_d5_evidence --fixtures-out <dir>`（抓 `reactions.json` / `references.json`）；`--dry-read` 与它同时给 → **exit 2 零文件**（预演不许留下证据）。真跑：capture → recompute 的 `d5_verdict` / `numbers` / `window` **逐项相同**，复算件名字是 `d5-selftest-*` 且 `self_test: true`（不可能被当测量指针）。③ **顺带发现 `T-841`**：`--baseline` 的默认值是「文件名排序最后那件」，**分不出测量件与离线复算件**——今天实测选中的就是 R52 的复算件（两者数字相同所以无害，关窗必须点名）。④ **708 → 710 → 718 测试**（+2 `d5-fixtures-out` / +8 `d5-baseline`）；9 门 ALL GREEN；`check_listing` 16/16。⑤ **同轮关掉 `T-841`**：`--baseline` 缺省原本按**文件名排序**取最后一份，分不出测量件与离线复算件（实测会选中 R52 的复算件）。新纯函数 `pickBaselineArtifact`：优先 `inputs.offline === false` 的**现场件**里最新的一份；只有复算件时退回并在 **stderr 明说**，产物新增 `inputs.baseline_kind`（`measured` / `recompute` / `unproven` / `explicit`）。三条真跑：默认现在选中 `06-40`（measured）/ 把四份现场件临时挪走 → `recompute` + 警告句 / 四份**逐字节还原**。**冻结项一字未动**：D5 三个阈值（10/1/20）/ 判定顺序 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 交付 + 流程断言（R71，2026-11-02） | **窗口期只做两件事：把三条回帖变成「30 秒可发」，把「升级日」的触发接上电；判据/阈值/冻结项一字未动（交付轮）**。① **A · 接触面**：给 `06/07/08` 三条回帖各加一个 `<!-- paste:start/end -->` **粘贴块**（块内只放将粘贴的字）并对齐当天产物；新记录器 `scripts/record_discussion_state.mjs`（`gh api graphql` 只读 `isAnswered`/`closed`/`updatedAt`/最后一条评论）先回答「还值得回吗」——**三条都 `open`**（`data/results/discussion-state-2026-11-02T19-13-45-223Z.json`）；新记录器 `scripts/record_remedy_probe.mjs` 用**同一个** `evaluateAdmission` 把「建议装哪个构建」也算出来：`@deepseek-ai/dsh-mcp-client@0.2.1-rc.5`（= 今天的 `next`）**admitted（8 项精确钉定）**，而 `0.1.0-rc.7` / `0.0.1-rc.1` 分别 `denied`（6 / 4 项）（`data/results/remedy-probe-2026-11-02T19-15-18-710Z.json`，同一次 registry 读里带 `dist_tags = latest 0.0.1-rc.1 / next 0.2.1-rc.5`）。**检查器第 16 条 `draft-claims-match-their-artifact`**：registry 每篇声明 `claims`（版本 / 桶 / 区间条数 / 标签值 / 粘贴块里必须出现的句子），由检查器**从被引产物复算**并**从粘贴块复算**两边对撞；**三条定向负对照各自真红且产物保留**（改版本 `19-18-22` / 改计数 `19-18-41` / 删边界句 `19-18-47`），终跑 **16/16**（`listing-2026-11-02T19-33-18.979Z.json`）。**这条断言第一次跑就抓到我自己三处漂移**（`^0.1.0-rc.7` 写了 7 次而产物是 6、`^0.0.1-rc.1` 5 次而产物 4、「等 13 项」对不上 13 行）——修法是改写法，不是放宽断言。**负对照还抓到一个真缺口**：把正文版本改错时断言**没红**（版本只被用来「找探针」，没被用来「验正文」），补「粘贴块必须写出 `pkg@version`」后才红。发帖 runbook 落 `docs/distribution/posting-runbook.md`（发前读什么 / 发后回填什么 / 不许做什么）。② **B · 触发**：`watch_next_release.mjs` 新增 `--baseline <dir,...>` + 纯函数 `pickNewestObservation`（+5 条单测）；**为什么必须有它**：CI 里 `--out` 只能是 `$RUNNER_TEMP`（CI 不许写 SSOT），旧实现只扫 `--out` → `previous` 恒 `null` → 永远报 `baseline`，**一个失忆的监听器**。新 workflow `.github/workflows/watch-upstream.yml`（每 6 小时 + 手动）：`--baseline data/results,.watch-state`，`.watch-state` 走 `actions/cache`（缓存不是提交）；**`unmeasured` → job 失败**（看不见 npm 不许报平安），`changed` → `::warning::` + step summary，**CI 里不跑卡片**（runner 没有 profile，那样生成的卡片会长得像对所有人说的话）。四条分支本机真跑：无基线 → `baseline` / 仓库基线 → `unchanged` 零产物 / 伪造旧基线 → `changed` + 产物 / 死端口 → exit 2 **零产物**；顺手修掉「外部基线的绝对路径会进产物」（改成只写 `(external)/<dirname>`，R67 同族）。③ **顺手修两处文档漂移**：`PROJECT_RULES.md` 的 Stand 还停在 R49、M6 行还写「R48 待做 T-806…T-809」（四项 R48 已交付）；`ROADMAP.md` W11 还写「剩 `npm publish 0.3.0` + T-810 草稿」（0.3.3 已发、`#11813` 已发）。④ **696 → 708 测试**；9 门 ALL GREEN；`check_listing` **16/16**；新盲区 **`BS-56`**（workflow 本机跑不了 / schedule best-effort / 60 天无活动会停 / 缓存失效会重复报）。**冻结项一字未动**：`admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 / D5 三个阈值 |
| 判据 + 交付（R70，2026-11-02） | **A、B 两件都做完（HUMAN 原话「A，B，同意，开始进行。」）**。**B（判据轮）**：D5 判定表第一行原本是「没有 `posted_on` **或**没有贴子 URL → `no-post`」，当 URL 明明在手上时这句话是**假话**（工具宣称「没人发帖」而它正拿着链接）。现在拆成两行：**没有 URL** → `no-post`；**有 URL 但窗口起点读不出** → `unmeasurable` + `reason: window-start-unreadable`；数字读不到 → `reason: number-unreadable`。**三个阈值（10/1/20）与判定顺序一字未动**；spec §3/§5/§6、`SIGNOFF.md`（HUMAN 原话）、单测 N2 改期望 + 新增 N2b + N8 同步。**A（交付轮）**：新增 `scripts/lib/load-sample.mjs`（`os.cpus()` 累计时间差——**不用 `os.loadavg()`**，Windows 恒 0 是 R37 的学费）+ `record_client_serve` 在整轮首尾采样，产物新增 `conditions.cpu.observed_busy_percent` 与运行窗口。真机跑 **13/17 passed**（其余是未启用的可选项），`tab_ms 919ms`、`route_ms 464`、`waited_ms 505`，**负载 39.1% / 24 核**。据此重算分布（n=21 → **22**，median 921 / p90 2439 / max 5557，形状不变），并把「39% 负载下仍 919ms」写进 `BS-54` 当作**反例**：中等负载不足以解释长尾，高负载仍未测、历史 4 次慢跑**没有条件读数可回溯**。**顺手抓到的真缺陷**：`--dsh-main` 缺省时被解析成**仓库根目录**，守卫只 `existsSync` 就放行 → `node <repo> plugin install` 报 `Cannot find module` 并记成 `install: failed`（R50 同族：配置没给却像产品坏了）；现在要求**必须是文件**，否则 exit 2 打印期望路径，错误调用产生的红产物已删除。**691 → 696 测试**；9 门 ALL GREEN；`check_listing` **15/15**（`18-58`）。**冻结项一字未动**：`admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 / D5 三个阈值 |
| 采证（R69，2026-11-02） | **X 线程发出 9 小时后重读 D5：仍是 0/10 · 0/1 · 634 burst（采证轮）**。① **为什么要重读**：`T-802` 的窗口还在走，而上一次读数是 R64 之前；「帖子发了会不会有人反应」只能靠重读。② **live 读取**（`gh api graphql` + `search/issues` + 基线日序列）：`pending` · reactions **0/10** · 外部引用 **0/1** · 周下载 634 且 `single-day-burst`（按 R52 口径**不算需求**）；窗口 `2026-11-01T20:24:37Z → 2026-11-15T20:24:37Z`。③ **必须一起说的边界**：D5 的 reactions 只数 **#11813 那个 discussion**，X 上的赞按口径不进这个数——所以这条只说明「跨平台没有回流到 discussion」，**不能**说明「没人看见」。④ **自查记一笔**：R65–R68 的部分产物 `generated_at` 用了递增的合成值（18:20 → 21:50），而真实 UTC 当时是 17:35 → 18:39，最多提前约 **3 小时**；没有任何判据比较 `generated_at` 与墙钟（正确，产物必须可复算），所以**读数不受影响**，但按时间排序时会显得靠后——从 R69 起改用真实时钟。⑤ 产物 `data/results/d5-evidence-2026-11-02T18-39-04-392Z.json`（`results-privacy` 复绿）。**冻结项一字未动**：D5 三个阈值 / `admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 |
| 交付（R68，2026-11-02） | **`BS-54` 收窄成分布：那个 9510ms 是负对照，真实运行中位 921ms（交付轮）**。① **盲区「没有分布」其实是「没人加起来」**：磁盘上已有 **36 份** `client-serve-*.json`、**25 次** `tab_ms`，而 `BS-54` 一直拿一次观测说话。新纯函数 `scripts/lib/latency-shape.mjs` + `scripts/record_client_latency.mjs` 汇总它们（**不新跑**），四条序列分开报：`summary.tab_ms` 真实运行 **n=21 · min 915 · median 921 · p90 2439 · max 5557**；负对照 **n=4 · median 7692.5 · max 9510**；`upgrade.route_ms`（引擎侧）n=5 · median 1107；`upgrade.waited_ms` n=4 · median 1531。② **两条结论必须一起说**：那个 9510ms 出自 `nc-bucket` 负对照，**不是真实运行的常态**（中位 0.92s，所以「打开就有一屏答案」多数情况成立）；但真实运行**确实有长尾**（p90 2.4s、最慢 5.6s），所以对外**不许**写「面板通常 1 秒」，也**不许**再把 9.5s 当产品时延。③ **分组是这轮唯一的判断题**：把 4 次负对照混进去算，p90 会从 **2439ms 变成 7157ms**（凭空多出 3 倍长尾）；只盯中位数又会得出「负对照也只慢到 7.7s，说明是机器慢」的误判。三条声称钉成 8 条单测：**单次观测不算分布** / **`unmeasured` 不是 0** / **负对照必须与真实运行分组**，外加 `n<10` 的 p90 标 `provisory`。④ **`BS-54` 只是收窄、没有关掉**：长尾的**成因仍未答**——产物不记录机器负载，四次慢的真实运行跨两个下午，与「同段还在跑另一个 Host + 安装」无法区分；也没有冷启动/热缓存分组。**因此没有动任何路由预算**（属判据轮，判据要等成因）。⑤ **683 → 691 测试**；9 门 ALL GREEN；`check_listing` **15/15**（`21-50`，测试数 691）；产物 `client-latency-2026-11-02T21-40-00.000Z.json`（含每组慢尾三例与文件名，可逐条复核）；报告 `audit/AUDIT_2026-11-02_R68.md`。**冻结项一字未动**：`admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 / D5 三个阈值 |
| 交付（R67，2026-11-02） | **把 R66 adversary 留下的三条待办做掉；D5 三个阈值一字未动（交付轮）**。① **`T-836`：D5 窗口起点不再接受不存在的时刻** —— `windowOf()` 之前用 `Date.parse`，它把 `2026-02-30T12:00:00Z` **滚成 3 月 2 日**并返回有限 epoch，于是窗口整体推后两天、判定照样算得出来且看起来合法；现在改用 `parseInstant`：`2026-02-30` / `2026-13-01` / 裸日期 / `99:99:99` 一律**不产出窗口**，而 `+01:00` 与 `Z` 两种拼法给出**同一个**窗口（单测 `deepEqual` 钉死）。**残留如实写**：无窗口时 `judgeD5` 报 `no-post`，对「日期是垃圾」不准确——CLI 入口（R66）已先挡，这里是第二道；拆 `unmeasurable` 要改判定顺序 + spec + 签字，本轮没做。② **`T-835`：记录器的打印路径 = 实写路径** —— 一天内同一个 bug 被抄了两次，根因是每个记录器各自拼输出；抽出 `scripts/lib/evidence.mjs#writeEvidence()`（写入 + 同目录 `.sha256` + 打印值由同一变量派生；已存在则拒绝覆盖），`record_d5_evidence` 改用它，`%TEMP%` 对照实测打印出的是**真实落盘路径**。**并做成机器检查**：任何**收 `--out`** 的脚本不得出现 `ssot data/results/` 硬编码打印（45 个收 `--out` 的脚本里只有 1 个命中、已修；其余 5 处硬编码的文件都不收 `--out`，打印是对的）。③ **`T-837`：两份手写日期必须指同一时刻** —— 新增治理测试，按 `post.url` 把最新 `d5-evidence-*` 产物与 `registry.json` 的 `posted` 条目对上，比 `parseInstant().epochMs`（比时刻不比字符串）。④ **顺手修掉一个隐私漏**：`--fixtures` 指向 `%TEMP%` 时，产物 `sources.reactions` 写了 `fixtures:C:\Users\<name>\…` —— **`results-privacy` 当场红**（红产物删除、未提交）；改成只写 fixture 目录名，重跑后匹配 `Users|AppData` = **0**。⑤ **677 → 683 测试**；9 门 ALL GREEN；`check_listing` **15/15**（`21-20`，测试数 683）；自检产物 `d5-selftest-2026-11-02T21-10-00-000Z.json`（`pending` · 3/10 · 0/1 · 634 burst，**fixtures 构造值、不是新测量**）。**冻结项一字未动**：`admission.ts` / 四桶 / `improved` 五门槛 / `data/gold/` / 20s / settle / readiness / 9 门 / D5 三个阈值 |
| 上一轮交接（R28，2026-10-29） | **本轮只交接，不改行为**：`git log -1` 就是本提交、`git status` 干净；**274 测试 / 9 门 / `--mutate` 9-9**；132 份产物全部被 147 步台账引用。**冻结项**：`--unsettled-timeout 20000`、hook `settle 15s`、readiness 5s、`boot→sample ≤20s`（现在判第一份样本）、`isUsableSample()`/`judgeProbe()`。**下一位的第一件事**：按 §3 的「D2 重跑」两条命令，用**新口径**重跑矩阵（R27 的红作废、也还没被替代）。**两条待签**：`ADR-0008` §剩余项（A′ / C 已勾、B 未签）+ `ADR-0009`（结论 A、B 未签） |
| 产品名 | **dsh-triage**（品牌：分诊台 / Triage） |
| 里程碑 | **M0 ✅** · **M1 金标对等 ✅（27 条）** · **M1 真实案例验收 ✅（D1：9/10）** · **M2-a P1+P2 ✅** · **M2-b 事实+差分 ✅（`BS-21`/`BS-22`）** · **M3 probe 执行器 ✅（R14）** · **M3 判据补全 ✅（R15/R16/R17）** · **D2 ✅（R18 首判 / R19 复算 / R29 新口径两批 12/12）** · **M3 稳定性分布 ✅（R31，36 次观测）** · **M4 形态 A ✅（`serve` v1）** · **M3 真实组合复制 ✅（T-304，R22）** · **M3 不可判等待收敛 ✅（`ADR-0008` E，R26）** · **M3 两阶段取样 ✅（T-312，R28）** · **M4-a ✅ 收口（R31 真机注册 / R33 可见性 + 同源结论）**；`namespace-diff`（T-303）仍缺（需 T-202a，`ADR-0009` 已签 A） · **M4-b ✅ 三件齐（R34 徽章 + 索引源；R36 `compat_verdict`）+ 索引源已托管（R38）** · **M5-a 本地半边 ✅（R41）**，上传/聚合待 `ADR-0012` · **M5-b ✅ 双边（R42 `upgrade --to`；R44 `improved` 真机 + registry 成功分支）**，`improved` 只有降级几何（`BS-42`） |
| 仓库 | `https://github.com/jjjjjjjjnnjnn/dsh-triage`（**public**（R38 由 HUMAN 决定），`main`） |
| CI | **6 job**：`verify (node 22)` · `verify (node 24)` · `verify (windows, node 24)` · `render controls (ubuntu, real browser)` · `gates can fail`（负对照 9/9）· `release readiness`（tag 触发） |
| 规模 | **611 测试** · **9 门禁** · 6 角色卡 · 3+1 模板 · **10 个真实案例（9 命中 / 1 显式 unknown）** · **27 条金标** · **334 份 SSOT 产物** · **355 步台账** · **53 条盲区** · **13 个真实插件候选（12 go / 1 装不上）** + **4 种组合复制形状（1 go / 3 unknown）** + **R44 混合组合四桶非空（3 改善）** + **R45 三篇案例帖 / 两份上架文案 / 文案检查器（12 条断言）** + **R47 市场基线 + 升级日卡片（真机 14/14）** + **R48 升级日入口四项（真机 26/26 + 离线复算 3/3 + README 首屏）** + **R49 一屏答案（`status` / `audit` 摘要 / 面板首屏；冒烟 17/17 + 复算 17/17 + 11 条对抗性）** + **R49 第二轮面板改版（搜索/筛选/排序/详情抽屉/主题/深链；冒烟 18/18）** + **R49 第三轮傻瓜模式（人话结论 + 一个按钮 + 简单/详细切换；发布预检查）** + **R49 第四轮自动修复（`fix` 计划/`--apply`/`--undo` + M7 判据）** + **R49 第五轮面板重做（独立 agent，去 AI 化）** + **R50 0.3.0 发布取证（20/20：registry 字节 = 本地 tarball / 匿名安装 / CLI / import）** + **R50 预检查三态化（+10 测试，含 `ENOENT` 红对照）** + **R51 DSH 设置页一屏答案（真机 10/10：`summary-visible` + 同源四计数；含两次自查出的红产物）** + **R52 D5 下载口径（形状纯函数 7 单测 + 端到端 4 测试；基线真跑 `failures: []` + 离线逐字节复算；rc.5 卡片 14/14；`T-810` 五篇草稿 + 第 9 条文案断言 12/12，含两条红产物与一条定向负对照）** + **R53 0.3.1 发版票（四包同升 + 文案 12/12 + 渠道复核 `listed 1` / `#65 DIRTY` + 设置页真机三跑 11/2、16/1、12/1；预检查如实报 `E401`）** + **R59 Question 覆盖率（Q&A 1545 / General 5786；头条 74/1545 = 4.8%；抽检 9/20 + HUMAN 5/5；`check_listing` 14/14，含 3 条定向负对照）** + **R60 分类器 v2 实验（开发集 20/20 / 互斥留出集 12/20，v1 7/20；未达 80%，不采用；生产仍 v1）** |
| 证据（R60） | `data/results/classifier-v2-2026-11-02T11-20-00-000Z.json`（`3e357e063cfe…`：dev v1 **9/20** / v2 **20/20**；holdout v1 **7/20** / v2 **12/20**；`decision: not-adopted`）· 留出集标签 `data/fixtures/question-coverage/2026-11-02T09-57-53-229Z/holdout-review.json`（种子 `20261103`，20 条，排除开发集）· 报告 `audit/RECON_2026-11-02_classifier-v2.md` · 盲区 `BS-53` |
| 证据（R59） | `data/results/question-coverage-2026-11-02T09-57-53-229Z.json`（`7354f39db3ab…`，8.1MB：Q&A 1545/1545 · General 5786/5786 · 头条 74/1545 = 4.8% · Wilson 3.8–6.0% · tier 47/27/89/164/90/178/950）· `question-coverage-recompute-2026-11-02T10-05-00-000Z.json`（`2d51b1666275…`，rows/counts/coverage 逐项相同）· `question-review-2026-11-02T10-10-00-000Z.json`（`285fc59e5ac5…`，agent 9/20 · HUMAN 5/5）· 快照 `data/fixtures/question-coverage/2026-11-02T09-57-53-229Z/`（qa 4.4MB 全文 / general 6.0MB 投影 / packuments 0.7MB / **1393 包**）· **三条红产物保留**：`listing-2026-11-02T10-10-00.000Z.json`（改数 47→48）· `listing-2026-11-02T10-20-00.000Z.json`（删「不是你的机器」）· `listing-2026-11-02T10-30-00.000Z.json`（把复算产物当测量指针）· 终跑 `listing-2026-11-02T10-40-00.000Z.json`（**14/14**）；外部文案复核后 `listing-2026-11-02T11-00-00.000Z.json` 仍 **14/14** · 报告 `audit/RECON_2026-11-02_question-coverage.md` |
| 证据（R53） | `data/results/listing-2026-11-01T10-10-00.000Z.json`（`237e80c0…`，**12/12**，version 0.3.1 / tests 529）· **三条红产物各自保留**：`listing-…T09-00-00`（`e11d9403…`，`submissions/README.md` 把 0.3.0 引到 0.2.0 的产物）· `listing-…T09-50-00`（`e66b8c5e…`，**我自己新写的那句话**把旧版本号写回正文）· `release-preflight-2026-11-01T10-20-00.000Z.json`（`30a998d9…`，`not-logged-in` 真 `E401`：version/workspace 两项绿）· `market-channels-2026-11-01T09-40-00.000Z.json`（`f992a029…`，`live 3` + **`listed 1`**：dsh.so 端点 200 / L5 / low，`#65 = DIRTY`）· **真机三跑**：`client-serve-2026-11-01T11-00-00`（`a33c8082…`，11/2）· `…T11-20-00`（`504b61b8…`，16/1，含 `break-after-install` 与真鼠标 `clipboard-copy`）· `…T11-40-00`（`faa502bf…`，12/1，`english-screen`） |
| 证据（R52） | `data/results/market-baseline-2026-10-31T06-40-00.000Z.json`（`fce85c32…`，`failures: []`：诊断 3,074 / 市场 513,534 / 装饰 552,956；形状 29 `steady` + 1 `single-day-burst` + 1 `no-record`；`d5.verdict = burst-not-demand`、`counts_as_demand = false`；854 条讨论 / 405 故障 / 256 零回复）· `market-baseline-2026-10-31T07-10-00.000Z.json`（`62080349…`，离线复算，归一化后逐字节相同）· **两条红产物各自保留**：`…T05-30-00`（`0a8cb7dd…`，npm 429 → 11 个包 `unreadable`）· `…T06-20-00`（`2403a632…`，GitHub 403 → `threads: 0`，促成「读不到就 exit 2、零产物」）· `upgrade-card-2026-10-31T09-00-00.000Z.json`（`809ba264…`，target `0.2.1-rc.5`，14/14，两次渲染同 sha256）· `listing-2026-10-31T10-40-00.000Z.json`（`9d5b8398…`，**12/12**，含 `drafts-cite-real-artifacts`）· `listing-2026-10-31T10-00-00.000Z.json`（`bcd265ba…`，**保留的红**：README「500 tests」已僵 + 我自己的草稿写了禁用话术）· `listing-2026-10-31T10-50-00.000Z.json`（`9843a7ca…`，**定向负对照**：登记了正文没提到的产物 → 红）· 草稿 `docs/distribution/T-810/`（5 篇 + `registry.json`，全部 `status: draft`，**一篇都没发**） |
| 证据（R51，含模拟用户测试与「会坏」屏） | `data/results/client-serve-2026-10-30T18-00-00.000Z.json` （**10/10**：bundle / install / boot / graph / client 200 / mount / visible / **summary-visible** / **same-source** / cleanup） · **模拟用户测试三跑**：`…T18-30-00`（11/11 基线，屏幕原文第一次被取回，925ms）、`…T19-00-00`（F1–F3 修后 11/11）、`…T19-30-00`（F4 修后 11/11） · **「会坏」屏**：`…T20-00-00`（`install: failed`——上游在安装阶段就拒绝声明不含当前 runtime 的 bundle，红产物保留）、`…T20-30-00`（14/14，`会坏 1`，抓到 F7/F8）、`…T20-50-00`（14/14 收口：`会坏 1` / 1 个复制按钮 / `same-source` 220·193·1·184） · 夹具 `tests/fixtures/client/breaking-plugin`（`engines.dsh: ">=9.0.0"`） · 报告 `audit/USER-TEST_2026-10-30_R51.md`（协议 / 结果 / F1–F8 / 屏幕原文 / 边界） · 单测 518 |
| 证据（R50） | `data/results/publish-2026-10-30T14-40-00.000Z.json`（**20/20**：`latest=0.3.0` / 四个 tarball sha512 = `dist.integrity` 逐字节 / 空 userconfig 下 `npm install dsh-triage@0.3.0` exit 0 / CLI 15 命令 / `import()` 导出 6 个名字）· `data/results/release-preflight-2026-10-30T15-20-00.000Z.json`（预检查自报：`npm user: jjjjjjjjnnjnn` 证明检查真的跑起来了；同一份里第 6 项**如实判红** `version-already-published`——0.3.0 已经发了，再发就是 403）· 根因对照：`tests/unit/release-preflight.test.ts` 里 `spawnSync('npm') → ENOENT` 的红对照 |
| 证据（R49） | `data/results/serve-smoke-2026-10-30T10-30-00.000Z.json`（**17/17**：token / 页面 / 列表 / 详情 / 穿越 400 / 跨源 403 / POST 403 / **`--no-audit` 两态 501** / `summary-first-screen` / `summary-parity-with-ledger` / 审计计时 / 脱敏 / 与 `audit --json` 逐项同源 / 「夹具必须出至少一条判定，否则同源证明不了什么」）· 独立复算 `--stamp 2026-10-30T10:45:00.000Z` 跑进临时目录：**17/17、检查 id 完全相同、`by_conclusion` 相同**（只差 `ms` 那两个数字）· **第二轮（用户反馈「不一目了然」）**：`data/results/serve-smoke-2026-10-30T11-40-00.000Z.json`（**18/18**，新增 `page-controls` 一条：`search` / `kind` / `conclusion` / `drawer` / `theme` / `data-sort` 必须同时存在——「HTTP 200 + 有字样」在页面只剩壳时也成立）· **第三轮（「看不懂、希望普通人也能用」）**：`data/results/serve-smoke-2026-10-30T12-10-00.000Z.json`（18/18，8 个控件）· **第四轮自动修复**：`data/results/fix-2026-10-30T13-20-00.000Z.json`（14/14：一次性 profile 上真跑 计划→dry-run 不写→apply→幂等→undo 逐字节）· **第五轮面板重做**：`data/results/serve-smoke-2026-10-30T13-10-00.000Z.json`（18/18）· 安全清单与三条红线见 `docs/SECURITY.md` |
| 证据（R48） | `data/results/upgrade-entry-2026-10-29T15-50-00.000Z.json`（**26/26**：引导三态 / `next`·`latest` 与 registry 逐字比对 / 关键字版与精确版本版**四桶计数相同** / 断网 exit 3 零桶 / `canary` exit 2 / `--out` 五种行为）· `data/results/upgrade-entry-2026-10-29T20-10-00.000Z.json`（**同一命令、新 rc 复跑仍 26/26**：上游在本轮内把 `next` 从 `0.2.1-rc.4` 换成 `0.2.1-rc.5`，解析与比对自动跟着新值走——这是「时点断言」最好的见证，S10）· `upgrade-entry-2026-10-29T15-40-00.000Z.json`（**保留的红产物**：记录器断言按英文标签匹配 zh 输出，产品行为正确）· `upgrade-entry-recompute-2026-10-29T16-00-00.000Z.json`（3/3 离线复算）· `listing-2026-10-29T16-20-00.000Z.json`（11/11）· `listing-2026-10-29T16-30-00.000Z.json`（红：把 119 改成 120）· `listing-2026-10-29T16-35-00.000Z.json`（红：删掉「不是你的机器」）· `listing-2026-10-29T17-00-00.000Z.json`（0.3.0 · 452 测试 · 11/11） |
| 证据（R45） | `data/results/listing-2026-10-29T08-40-00.000Z.json`（8/8：版本 / 区间 / 测试数 / 12 条证据路径 / 禁用话术 / 文章登记 / 两条边界）· `data/results/listing-2026-10-29T08-00-00.000Z.json`（**保留的红产物**：第一次跑抓到 `dsh-triage@0.1.0` 三处旧漂移）· `data/results/market-channels-2026-10-29T10-00-00.000Z.json`（`live 3` + **dsh.so 已提交未收录**：三个端点 404） |
| 证据（R44） | `data/results/upgrade-declarations-2026-10-29T07-05-00.000Z.json`（关键词命中 1584 扫描 / 202 今天被拒 / **前向 0** / 降级 113 / 都不放行 89）· `data/results/upgrade-mixed-2026-10-29T07-10-00.000Z.json`（四桶非空，30 项自检全过，`why` 交叉校验非空）· `data/results/upgrade-registry-live-2026-10-29T07-15-00.000Z.json`（成功分支 `facts = 2`，桶与计数不变）· `data/results/upgrade-mixed-2026-10-29T06-25-00.000Z.json`（**保留的红产物**：`control-has-no-new-denials` 旧定义恒假的唯一见证）· `data/results/market-channels-2026-10-29T07-20-00.000Z.json`（`merged = 0`） |
| 硬规则 | **每一步做完必须四轴审核 + 真跑落产物**，写入 `audit/step_reviews.json`（R49 起 **277 步**），由门 `step-review` 重算 sha256；授权/签署单独记在 `audit/SIGNOFF.md`。**R47 起分轮型**：判据轮每步一条，交付/分发轮轮末一条汇总（见 `.agents/README.md` §6） |
| **R39–R66 的批次行** | 已归档到 `_archive/2026-11-03_HANDOFF-batch-rows-R39-R66.md`（逐行原文，未改一字）。入口只保留最近十轮（**R67–R76**）+ 常设行 + 证据指针 |
| **R37–R38 的批次行** | 已归档到 `_archive/2026-10-29_HANDOFF-batch-rows-R37-R38.md`（逐行原文，未改一字）。入口只保留最近十轮（**R39–R49**）。 |
| **R29–R36 的批次行** | 已归档到 `_archive/2026-10-29_HANDOFF-batch-rows-R29-R36.md`（逐行原文，未改一字）。理由同下：入口文档只留最近十轮。 |
| **R14–R28 的批次行** | 已归档到 `_archive/2026-10-29_HANDOFF-batch-rows-R14-R28.md`（逐行原文，未改一字）：这一张表只保留最近十轮 + 常设行 + 证据指针，避免接手的人先翻十几轮历史 |
| 证据（R40） | `data/results/publish-2026-10-29T01-40-00.000Z.json`（20 项全绿：四个包 registry 字节 = 本地 tarball；空 userconfig 匿名安装 6 包；CLI 9 命令；`import()` 导出）· `data/results/market-channels-2026-10-29T02-00-00.000Z.json`（dsh.so `blocked`→`ready`，npm 200/0.1.0）· `data/results/market-channels-2026-10-29T02-10-00.000Z.json`（#193 `APPROVED` `CLEAN` 仍 open；#65 `BLOCKED`）· `data/results/agent-tool-ptc-2026-10-29T02-30-00.000Z.json`（**首次 ptc：两个错，原样保留**）· `data/results/agent-tool-ptc-2026-10-29T02-50-00.000Z.json`（**布尔状态静默成 `--`** 的见证）· `data/results/agent-tool-ptc-2026-10-29T03-05-00.000Z.json`（ptc 全绿：3/3 定义作答 + 完整拒因）· `data/results/agent-tool-native-2026-10-29T03-20-00.000Z.json`（对照：3/3 `tools.execute()`） |
| 证据（R29） | `data/results/probe-matrix-2026-10-28T08-40-00.000Z.json`（批次 A：n=20 / 真实 13 / 12 go / 清理 20-20 / 形状 6 / `boot→sample` **4.6–9.8s** / 16-16 在预算内；**`replacement_waited` 是修前语义，见 `BS-33`**）· `data/results/d2-2026-10-28T09-20-00.000Z.json`（`gate.passed=true`，`boot-budget` 12/12）· `data/results/probe-matrix-2026-10-28T09-40-00.000Z.json`（批次 B，`BS-33` 修后**权威**：结论同上，**4.0–5.5s**，20/20 `replacement_waited=false` + `reason=upgrade`）· `data/results/d2-2026-10-28T10-20-00.000Z.json`（`--strict` 跑出，`gate.passed=true`、exit 0） |
| 证据（R27） | `data/results/probe-matrix-2026-10-29T01-00-00.000Z.json`（post-E 批次 n=20 / 真实 13 / 清理 20-20 / 形状 6 / `expectation_misses=0`；`boot_to_sample` 10.0–22.5s，14/16 在 20s 内）· `d2-2026-10-29T01-30-00.000Z.json`（**`gate.passed=false`**：只有 `boot-budget` 红，11/12）· `probe-t309-mcp-isolated-a-2026-10-29T02-30-00.000Z.json`（同候选隔离复测 `boot→sample` 16.0s / `wait_ms` 10.6s）· `probe-t309-mcp-isolated-b-2026-10-29T02-40-00.000Z.json`（23.8s / 18.0s）· `probe-adr0008e-hook-error-2026-10-29T00-10-00.000Z.json`（真 hook `{error}`：`projection-missing`，`replacement_waited=true`、`waited_ms=5203`）· `probe-t315-node-linker-2026-10-29T00-40-00.000Z.json`（`nodeLinker: hoisted` 复制源 → `go`） |
| 证据（R26） | `data/results/probe-adr0008e-overrun-2026-10-28T22-30-00.000Z.json`（同一个不可判夹具：`boot` 步 **28.6s**、`replacement_waited=false`、`waited_ms=0`、`samples=1`、结论仍 `unknown` + `missing.inventory`；R23 同夹具 48.4s）· `probe-adr0008e-slow-2026-10-28T22-40-00.000Z.json`（导入 6s → 仍 `go`，`boot` 步 25.4s，行 `active`，渲染 5370ms）· `probe-adr0008e-real-2026-10-28T22-50-00.000Z.json`（真实候选 `dsh-status-rotator@0.38.0` → `go`，`boot→sample` 11.5s、`boot` 步 21.7s）· `d2-2026-10-28T23-00-00.000Z.json`（现有矩阵复算：`gate.passed=true`、`reliability 20/20`、`boot-budget` 12/12 真实候选） |
| 证据（R24） | `data/results/probe-settle-window-1s-2026-10-28T21-00-00.000Z.json`（`--unsettled-timeout 1000` → boot 26247ms，替换等待 1184ms，仍 unknown）· `probe-settle-window-5s-2026-10-28T21-10-00.000Z.json`（5000 → boot 33882ms，替换等待 5302ms，render 4671ms，仍 unknown）· `replacement-window-2026-10-28T21-30-00.000Z.json`（29 份产物：not-usable 4 / **replacements 0** / `measured_saving_ms=19092`） |
| 证据（R23） | `data/results/probe-boot-segments-template-2026-10-28T17-00-00.000Z.json`（go，boot 步 15741ms 逐段）· `probe-boot-segments-overrun-2026-10-28T17-10-00.000Z.json`（unknown，48384ms：sample 19128 + **替换等待 20276** + render 4502 + kill 2203）· `probe-boot-segments-copy-2026-10-28T17-20-00.000Z.json`（复制模式：profile 15336ms 与 boot 16217ms 分列）· `credential-sources-2026-10-28T19-00-00.000Z.json`（10 组审计：`live_and_leaking=[]`、`user-npmrc` 两种应答都 `neutralised`、其余四种 knob 未被读） |
| 证据（R22） | `data/results/probe-copy-profile-ok-2026-10-28T14-30-00.000Z.json`（`copy:upstream` → **go**：boot→sample 7.4s / 401 / 渲染 2182ms / 行 `active` / `candidate_registered=true` / `ignored_packages` 5 个 / `pnpm_policy=sandbox`）· `probe-copy-profile-unusable-2026-10-28T14-40-00.000Z.json`（`ERR_PNPM_FETCH_404` → **unknown**，三步：runtime/profile/cleanup）· `probe-copy-profile-dangling-2026-10-28T14-50-00.000Z.json`（install **exit 0** + `dangling_links` → **unknown**）· `probe-copy-profile-strict-2026-10-28T15-00-00.000Z.json`（源自带严格 workspace → `pnpm_policy=source` / `candidate_registered=false` → **unknown**，boot 三项 `unmeasured`） |
| 证据（R19） | `data/results/probe-real-dsh-cron-2026-10-28T09-30-00.000Z.json`（`ERR_PNPM_IGNORED_BUILDS` + `Ignored build scripts: …`）· `serve-smoke-2026-10-28T10-20-00.000Z.json`（13/13，含 `/api/audit` 与 CLI 逐条一致）· `probe-matrix-2026-10-28T11-40-00.000Z.json`（n=20 / 真实 13 / 形状 6 / 清理 20-20）· `d2-2026-10-28T12-10-00.000Z.json`（`gate.passed=true`）· `gates-2026-10-28T13-00-00.000Z.json` |
| 证据（R18） | `data/results/d2-2026-10-27T21-00-00.000Z.json`（D2 判定，`gate.passed=true`）· `probe-matrix-2026-10-27T20-30-00.000Z.json`（n=17 / 真实 10 / 失败形状 5 / 清理 17-17）· `probe-slow-normal-v2-2026-10-27T19-10-00.000Z.json`（导入慢 6s = go，`wait_ms` 7.3s）· `probe-slow-overrun-2026-10-27T19-20-00.000Z.json`（导入慢 20s = unknown，`settled:false`）· `probe-matrix-2026-10-27T19-30-00.000Z.json`（首个真实候选批次） |
| 证据（R17） | `probe-registry-whale-2026-10-27T17-05-00.000Z.json`（**R16 同一候选是 blocked → 现在 go**，boot 6.8s，`port_origin=allocated`）· `probe-slow-normal-2026-10-27T17-00-00.000Z.json`（慢但正常 = go，`settled=true`，`waited_ms=32`）· `probe-red-apply-fail-2026-10-27T17-10-00.000Z.json` / `probe-red-import-fail-2026-10-27T17-15-00.000Z.json`（负对照仍 blocked）· `probe-matrix-2026-10-27T17-20-00.000Z.json`（n=7 / real 2 全 go / cleanup 7-7 / boot 6.2–6.9s）· `gates-2026-10-27T18-00-00.000Z.json` |
| 证据（R16） | `serve-smoke-2026-10-27T14-16-05/07.000Z.json`（面板 8/8，含隐私修复前后）· `probe-registry-private-2026-10-27T14-33-57.000Z.json`（blocked，endpoints=`http://127.0.0.1:1/dsh-cost-meter`，install 78.9s）· `probe-matrix-2026-10-27T14-36-20.000Z.json`（n=6：go 2 / blocked 4，cleanup 6/6，boot 12.3–14.3s，`expectation_misses=1`）· `render-fixture-blank-2026-10-27T14-02-15.000Z.json`（CI 同一命令的本机落盘）· `gates-2026-10-27T14-42-00.000Z.json` |
| 证据（R15） | `probe-ok-render-2026-10-27T12-57-25.000Z.json`（boot→sample 8.7s，render 1785ms，readiness=host-url）· `probe-registry-ok-…12-59-01`（install 5.4s / boot 7.7s / render 3.9s）· `render-fixture-{blank,rendered,error,blocked}`（四形态对照） |
| 审核报告 | `audit/AUDIT_2026-10-31_R52.md`（本轮：D5 下载形状口径 / 采集器三处自抓缺陷 / rc.5 卡片 / T-810 草稿与第 9 条断言）· `audit/AUDIT_2026-10-30_R49.md`（T-310 安装归因 / T-406 面板 v1 / D2 扩容与预算口径）· `audit/AUDIT_2026-10-27_R18.md` · `audit/AUDIT_2026-10-27_R17.md`（端口自伤，含 R18 的纠错注记）· `AUDIT_2026-10-27_R16.md`· `R15`（四轴在 `step_reviews.json` R15-S1…S14）· `AUDIT_2026-10-28_R14.md` · `R13` · `R12` · `R10` · `R9` · `R8` · `R7` · `R6` · `R5` · `R4` · `R3` |
| 未通过的门槛 | **最终 9 门全绿、`--mutate` 9-9、D2 两批 `gate.passed=true`**（历史上两次门禁红都保留作证据：`gates-2026-10-28T11-00-00.000Z.json` 是 governance `index-references` 抓到 INDEX 裸文件名 + 6 份新产物未入账；21:30 那次是 R31 自找的 stamp 冲突，已修并删除中间录制）。**历史红项保留**：R27 的 `d2-2026-10-29T01-30-00.000Z.json`（旧口径，`boot-budget` 11/12）不许删、不许重解释。**仍开着的缺口**：① `BS-32` 抖动（三批空载 3.5–9.6s，但**有载/空载对照没做**；且 R27 的 22.5s 是旧口径，不能相减）；② `BS-27` 分母不可外推（12/13，Wilson 0.667–0.986，单机单运行时）；③ `T-303`/`T-202a` 的 `namespace-diff` 仍 `unmeasured`（`ADR-0009` 已按委托签 **A=维持**，除非重开 ADR）；④ `BS-29` 只审计六类来源、Windows、单 pnpm 版本；⑤ `T-315` 只剩 `strictPeerDependencies` 未测；⑥ `BS-30`/`BS-31` 复制模式从不构建原生模块、只搬四个声明文件；⑦ `BS-35` 浏览器半边的三条发现规则（exports / 裸包名 / `?rev=`）只能靠 `record_client_serve` 真跑回归，上游换 resolver 时本仓不会提前知道；⑧ `BS-34` 已修，但 R30 的旧产物读数作废 |
| **环境（本轮沿用）** | 仓内沙盒 `sandbox/upstream/0.2.1-rc.4`（git 忽略）；probe 沙盒在 `%TEMP%/dsh-triage-probe/<slug>`、渲染 profile 在 `%TEMP%/dsh-triage-render*`，跑完必删。本机浏览器：Chrome 154 / Edge 146（**`--dump-dom` 在本机不可用，必须走 CDP**） |

---

## 3. 下一位 agent 的第一件事

```powershell
pnpm install --frozen-lockfile; pnpm run verify; node scripts/gate.mjs --mutate
```

**验收标准**：第二条输出 `ALL GREEN · 9 gates`（当前 **792 测试**）；第三条最后一行 `NEGATIVE CONTROL PASSED · 9/9`。不满足即环境不可信。

**接手时的工作区预期**：**R79 之后是干净的**——人类那份宣传稿改写已在 `ac18c40` 提交（`docs: de-AI public-facing copy and align profile boundaries`）。
若又出现未提交改动，**先问来源**：人类宣传物料（`docs/distribution/T-810/03-x-en.md`、`docs/distribution/reddit-and-hn-posts.md`、两份 README 与上架文案）
**不要**改、不要替人提交、更不要为了让树变干净删掉。真正要发版时（`pnpm -r publish` 才需要干净树）用 `git stash push -u -- <路径>`，用完 `git stash pop`。

**唯一的时间敏感项（现在只剩一条，另一条已做完）**：

```powershell
node scripts/d5_window_status.mjs     # 它自己算「下一份基线最晚哪天跑」，当前是 2026-11-12
node scripts/record_market_baseline.mjs --stamp <真实UTC>   # 截止日或之前跑
```

理由与口径见 §2 的 R76 行（`last-week` 滞后 **1–2 天**、相隔 ≤7 天的两跑会无缝拼接）。
**`2026-11-15T20:24:37Z` 之后**按 `docs/d5-close-runbook.md` §0 四条命令关窗；`pass` / `fail` / `unmeasurable`
三个分支各有一套动作，**`fail` 就执行 D，禁止「再加一个功能试试」**。

**上游已经换版本了（R79 实测并已出证据）**：`@deepseek-ai/dsh` 的 `next` 从 `0.2.1-rc.5` 变成 **`0.2.2-rc.1`**
（`latest` 仍是 `0.2.1-rc.5`）。本机已真跑 `watch_next_release --baseline`（`changed`）并在真机重跑卡片
`--to 0.2.2-rc.1`（**14/14**，192 单元 → **119 会被拒 / 73 判不了 / 0 会变好 / 0 像没事**），
你**不需要再跑一遍**；只有上游**下一次**换版本时才重跑（`watch-upstream` 会给 `changed`）。
⚠️ 两份 README 里引用的还是旧的 `0.2.1-rc.5` 卡片（那份是历史真话，`check_listing` 仍会过）：
**不要为此动 README**，等 HUMAN 的文案定稿后再在单独一轮里换。

**文案找 Gemini（R80 起）**：对外文案（README / 上架 / 回帖 / 截图说明）由 `copywriter`（Gemini）写，
工程 agent 只提供 `docs/copy/facts/` 的事实包（产物 + sha256 + 精确数字 + 边界）。流程与红线见
`docs/copy/README.md`，文风见 `docs/copy/STYLE.md`；缺事实包不要动笔，模型不可用时只落事实包（`BS-58`）。
`docs/copy/drafts/` 只是草稿；发布仍按 `docs/distribution/posting-runbook.md`，回填见 `docs/copy/outreach.json`。

**发布已经做完（R77，HUMAN 执行）**：四包 `0.3.4` 全部 `✅ Published`，`latest=0.3.4`。取证读了两遍：
第一遍（`publish-2026-11-03T15-45-35.175Z.json`）**红** —— 四个 `version` 与 `dist-tags-agree` 还写着 `latest=0.3.3`，
而同一份产物里**匿名安装等 302 秒后成功**（19 次「还不在 registry」）→ 副本传播滞后，不是发布失败；
约 17 分钟后重跑（`publish-2026-11-03T16-05-17.632Z.json`，干净树 `git_dirty=false`）**18/18 全绿**。
**两份都留**（红的那份就是「读早了」的证据）。⚠️ **别因为预检报红就再发一次**：现在再跑 `release:publish`
会被 `version-already-published` 拦住，那是**正确**的；只需要取证时用 `node scripts/record_publish.mjs --version 0.3.4`。

**下一阶段的方向（R82 起，急救箱）**：**A 段（只读计划）与 B 段（写入面）都已交付** —— `dsh-triage rescue` /
`--apply` / `--undo`，判据见 `docs/specs/M8-rescue.md`（C1–C12 / N1–N11）。
**下一件是 SAFE MODE（`T-855`）**：把「先禁用第三方再重启」挂在 `rescue --apply` 之上，**不另开写入路径**；
面板侧只在 `audit` 判定存在第三方 bundle 时出现按钮。其后是 `profile snapshot`（`T-856`）、
Windows 失败面只读诊断（`T-857`）、互操作探测（`T-858`）、借用台账收尾（`T-859`，已在 `docs/09-open-source-borrowing.md` 落了三行）。
⚠️ **重启宿主这件事本身没有证据**：本轮只证明「文件改对了、能逐字节撤回」，**没有**证明裁掉之后宿主真的起得来
（那要 `probe --execute`，另一条命令）。任何对外说法都不许把这两件事混起来。
**分支优先**：A+B 都在 `feat/rescue-plan` 上完成并已 **fast-forward 并入 `main`**（`bd7135a`）；分支未删，便于对照。
合并前跑过 `pnpm run verify`（792 测试 / 9 门）+ `gate.mjs --mutate`（9/9），并有两个独立 verifier（A 段 7/7、B 段 11/11）只读复算产物与 CLI 行为。
**只学机制不抄代码**：MIT/Apache/BSD 只读实现思路，AGPL / 无许可证一律不复制；要引用代码只进 `quarantine/` 并登记 `vendor-manifest`。

**交接快照**：`backup/snapshots/snapshot-0.3.4-*.json`（`node scripts/snapshot_state.mjs --name <label>` 生成，
带 448 份 SSOT 产物的 sha256 清单与门禁逐项结果）。**R78 之前这个脚本根本不存在**——`BACKUP_POLICY.md`
从 M0 起就写着它，而 `backup/snapshots/` 只有 `.gitkeep`（详见 §2 的 R78 行）。

**然后看 §2 最上面那几条 R78 / R77 / R76 记录**。**还要确认 CI 是绿的**（这是本机看不见的一层）：

```powershell
gh run list --repo jjjjjjjjnnjnn/dsh-triage --limit 1
```
> **R53 环境事实**：本机现在**直连可用**（`gh` / `npm` 都通）。R39–R52 写的 `HTTPS_PROXY=http://127.0.0.1:19828` 那个代理**当前没在监听**——照抄会得到 `proxyconnect tcp: dial tcp 127.0.0.1:19828: connectex: No connection could be made`，那不是网络坏了，是代理没开。直连失败时再回头看那条代理。

验收：最新一次是 `completed  success`。红的话先看 `FAILING:` 那一行（门禁现在会把失败的 check 名列出来）。

## R75（2026-11-03，采证 + 加固 + 落地 · **交接**）

**状态**：**746 测试 / 9 门 ALL GREEN / `--mutate` 9/9**；`check_listing` **17/17**；CI `success`（`41608591346`）。
**D5 仍 `pending`**（reactions 0/10 · 外部引用 0/1 · 下载项在窗口外读到 `steady` 1035，见下）。

**换会话后从这里开始**：

```powershell
git status --short          # 预期：只剩两个宣传物料（03-x-en.md 改动 + reddit-and-hn-posts.md 未跟踪），不要动
pnpm install --frozen-lockfile
pnpm run verify             # 746 测试 / 9 门
node scripts/gate.mjs --mutate
gh run list --repo jjjjjjjjnnjnn/dsh-triage --limit 1   # 预期 success
```

**唯一的时间敏感待办（过了就补不回来）**：

```powershell
# 截止日看这条命令，不要凭记忆；当前是 2026-11-11
node scripts/d5_window_status.mjs
# 到期那天跑（stamp 必须带冒号）
node scripts/record_market_baseline.mjs --stamp <真实UTC>
```

理由（**R76 更正，原文有两处错**）：npm 的 `last-week` 是滚动 7 天，但
① 它**滞后 1–2 天**才发布（10-31 跑 → `..10-29`；11-03T06:22 跑 → `..11-01`；**同一天** 11-03T15:11 跑 → `..11-02`，
所以「滞后 2 天」只是保守值，不是常数），
② 一次跑不必覆盖整 7 天 —— **相隔 ≤7 天的两次跑会无缝拼上**。所以不是「11-08 之前」，
而是「**在 11-11 或更早再跑一次**」= 与 11-03 那两份接起来连续；若按字面在 11-07 跑，
覆盖 `10-30..11-05`，恰好把 **11-06** 留成缺口（要等 11-14 那跑才补得回来）。
算这件事的机器是 `scripts/d5_window_status.mjs`（`data/results/d5-window-status-*.json`）。
跑完把产物与 `.sha256` 提交，并在 `docs/HANDOFF.md` 补一行批次记录。

**然后**：**`2026-11-15T20:24:37Z` 之后**按 `docs/d5-close-runbook.md` §0 四条命令关窗
（刷新基线 → 读 D5 且 `--fixtures-out` → 离线复算 → 登记），`--baseline` 必须显式点名。
`pass` / `fail` / `unmeasurable` 三个分支见 runbook §4；**`fail` 就执行 D，禁止「再加一个功能试试」**。

**上游若发新 rc**：`watch-upstream`（每 6 小时）会给 `changed`；**卡片必须在真机上重跑**再引用（HANDOFF §3 已写死）。

**不要做的事**（每条都付过学费）：

- 不为「让 D5 好看」加功能或改判据（阈值 10/1/20、判定顺序、`admission.ts`、四桶、`improved` 五门槛全部冻结）；
- 不把 X / Reddit 热度算进 D5（`channels.json` 只允许一条 `d5_counts: true`）；
- 不再 rebase 三条渠道 PR（`#65` 是 `MERGEABLE/BLOCKED` 等 review，不是冲突）；
- 不动 `docs/distribution/T-810/03-x-en.md` 与 `docs/distribution/reddit-and-hn-posts.md`（人类宣传物料）；
- 关窗前重跑 D5 只会是 `pending`，**不算新证据**。

**P1 做了什么（一句话）**：在 D5 窗口内落了第一份市场基线，因为 npm 的 `last-week` 是**滚动 7 天**且
**滞后 2 天**——`R76` 更正了此处原先的「晚于 `11-08` 再跑，`11-01..11-07` 就永久缺了」：真正的截止日由
`scripts/d5_window_status.mjs` 算出（R76-A 时是 `2026-11-10`，R76-D 的第二份现场基线之后是 `2026-11-11`；
两次相隔 ≤7 天的跑即可无缝拼接），而不是记的。

**这一轮唯一必须一起读的三句话**：

1. 下载项**第一次读到 `steady`**（1035 / 4 天 / 峰值 61.3%）→ 冻结口径判 `threshold-met`；
2. 但它是 **10-29 爆发的回声**（`0 0 0 / 634 / 192 / 17 / 192`，两个 192 同值），`BS-48` 写明 `steady` **不等于人**；
3. 且它的窗口是 `10-26..11-01`，**只有 11-01 落在 D5 窗口内** → **不是关窗读数**，`judgeD5` 仍 `pending`。

**另外四件（各一句）**：

- **P3**：复制按钮的**失败路径**补了单测（成功路径早有 5 份真机 `clipboard-copy: passed`）；Firefox 装了但没有 CDP，真跑得到 `unmeasured`（**不是** `failed`）；同一次尝试抓到**记录器会挂死**（浏览器不自杀 + 继承的 stdio），已修。
- **P2**：CI 那条 `attempts.length === 1` 是**时钟粒度竞态**（`retryMs: 1` + 首试同毫秒），机制已证、**翻红率未证**；修法是 `retryMs: 0` + 一条反方向测试。
- **P4（当时）**：两张 **proposed** ADR（`T-811` Host 准入 / `T-814` 面板速率），**那一轮** `packages/` 零改动（P5 才落地）。
- **P5（签字后落地）**：两张 ADR 按推荐案实施 —— `Host` 不匹配 **421**（`--host` / `--allow-host` 新增，`0.0.0.0` 必须配 `--allow-host`）；两个扫描路由共享 **1 秒复用窗口**（`/api/audit` 的元数据走响应头，body 仍与 `audit --json` 逐字节相同）。**代价如实生效**：局域网 IP 默认打不开。

**下一位的第一件事**：先跑 `node scripts/d5_window_status.mjs` 读**算出来的截止日**（当前 **2026-11-11**），
在那天或之前再跑一次 `record_market_baseline`（第二份窗口内基线）；然后仍是 **`2026-11-15T20:24:37Z` 之后**
按 `docs/d5-close-runbook.md` §0 四条命令。
**同时**：`docs/adr/0014` 与 `0015` **已于 2026-11-03 签字并落地**（原话「同意，继续」，记账 `audit/SIGNOFF.md`）；
落地时的两处实测偏离（`/api/audit` 元数据走响应头、`[::1]` 默认不监听）写在两份 ADR 的「实施记录」里。

**本轮新增的坑**：

1. **`claims[].id` 会变成第二份过期的答案**：`this-package-weekly-downloads-are-not-demand` 写死，
   第一次读到 `steady` 就与 statement（`counts as demand: true`）自相矛盾。现在 id 只命名主体，
   并有治理测试钉死「同一 subject 在 burst / steady 下 id 必须相同」。
2. **`--stamp` 必须带冒号**（`2026-11-03T06:22:20.130Z`），写成文件名形状（`06-22-20.130Z`）会 exit 1 报 usage。
3. **「产物写完了」不等于「跑完了」**：浏览器不自杀时（Firefox），子进程继承的管道 stdio 会让 node 一直活着；
   第一次 Firefox 见证因此挂了 15 分钟才被外部超时杀掉。现在 `stdio: 'ignore'` + `unref()`，产物落盘即退出。
4. **「本机绿」不能证明一条断言稳定**：`probe-hook-error` 的 `attempts.length === 1` 在本机 40/40 绿，
   而它在 `retryMs: 1` 下是**时钟粒度竞态**（首试落在同一毫秒就会重试一次）。判断依据是停止条件与
   首试耗时，不是「我跑了几次都绿」。测试里凡是「数量」断言，预算必须给成确定值（`retryMs: 0`）。
5. **「安全规则对了」不等于「用户还能用」**：Host 准入没有一条绕过路径，但它第一版把
   **`--port 80`**（浏览器省略默认端口）和 **`ssh -L` / 反向代理**（端口变了）全挡死了。
   安全改动的验收必须同时列**正常路径清单**，不能只列攻击路径清单。
6. **面板有两个扫描入口**：`/api/summary`（刷新按钮）与 `/api/audit`（raw 页签）。改缓存/限速必须挂在
   **共享扫描层**（`context.audit`），只给一个路由加会「验收全绿而问题原样保留」——`T-814` 第一版就是这个形状。

## R74（2026-11-02，交接）

**状态**：**728 测试 / 9 门 ALL GREEN / `--mutate` 9/9**；`check_listing` **17/17**；CI `success`。
**D5 `pending`**（0/10 · 0/1 · 634 burst），窗口到 **`2026-11-15T20:24:37Z`**。

**换会话后从这里开始**：

```powershell
git status --short          # 预期：只剩两个宣传物料（03-x-en.md 改动 + reddit-and-hn-posts.md 未跟踪），不要动
pnpm run verify             # 728 测试 / 9 门
node scripts/gate.mjs --mutate
```

**唯一待办**（在此之前没有产品工作可做）：

1. **`2026-11-15T20:24:37Z` 之后**，按 `docs/d5-close-runbook.md` §0 跑四条命令（刷新市场基线 → 读 D5 并抓原始读数 → 离线复算 → 登记）。
   **关窗前重跑只是 `pending`，不算新证据。**
2. 上游若发新 rc：`watch-upstream`（每 6 小时）会给 `changed` + 两条命令；**卡片必须在真机上重跑**再引用。
3. 渠道 PR 只有一个动作：**一次**礼貌的 review 请求，然后等（`docs/distribution/pr-65-status.md`）。别再 rebase。

**不要做的事**（每一条都是已经付过学费的）：

- 不要为了「让 D5 好看」加功能或改判据；`fail` 之后按 ROADMAP 走 D，**禁止「再加一个功能试试」**；
- 不要动 `docs/distribution/T-810/03-x-en.md` 与 `docs/distribution/reddit-and-hn-posts.md`（人类宣传物料）；
- 不要把 Reddit / X 的热度算进 D5（`channels.json` 的 `d5_counts` 只允许一条）。

**本轮新增的坑**：

1. **「冲突」和「等 review」是两件事**：`mergeable: MERGEABLE` + `mergeStateStatus: BLOCKED` 说的是后者。
   外部转述把它们混在一起，会让人反复做无效的 rebase。判断依据只看这两个字段，不看别人怎么说。
2. **`APPROVED` 要看是谁批的**：`#193` 的批准来自 `sourcery-ai`、`authorAssociation: NONE`——机器人批准不等于解锁。
3. **Reddit 抓不到不是「没试」**：`.json` 403、`old.reddit.com` 返回「Welcome to Reddit」拦截面（340KB，`datetime=` 零命中）。
   再试之前先读 `T-842`，别重复劳动。

## R73（2026-11-02，交付轮）

**状态**：**728 测试 / 9 门 ALL GREEN / `--mutate` 9/9**；`check_listing` **17/17**；
**D5 `pending`**（0/10 · 0/1 · 634 burst），窗口到 `2026-11-15T20:24:37Z`。

**做了什么（两句话）**：

1. 四个渠道（GitHub / X / 两个 subreddit）从「prose 表格」变成机器可查的台账：
   `d5_counts: true` **只允许一条**，其余必须写 `why_not_counted` —— 推广不许悄悄变成证据。
2. 更正两处转述 + 一处文档自相矛盾（见下表），**决定都没改**，改的是理由与证据。

**下一位的第一件事**：仍是 **`2026-11-15T20:24:37Z` 之后**按 `docs/d5-close-runbook.md` §0 跑四条命令。

**本轮更正的两条转述**（记在这里，因为下一位也会听到它们）：

| 听到的说法 | 实测 | 怎么读 |
|---|---|---|
| 「`gate.mjs 6/6` 通过」 | `ALL GREEN · **9 gates**` | 仓里是 9 门；「6/6」这个数不存在，别引它 |
| 「PR #65 仍处于冲突状态，需要解冲突」 | `mergeable: MERGEABLE` / `mergeStateStatus: BLOCKED` | R60 已解冲突；`BLOCKED` = **等 review**，不是冲突。再多 rebase 一次不会让它合并 |

**本轮新增的坑**：

1. **推广与证据的门是可被写坏的，所以要做成字段**：`why_not_counted` 让「不计数」变成必须解释的动作。
   没有这个字段，11-15 那天最省力的读法就是把四个渠道的热度当成需求。
2. **读不到的东西要留空，不要填一个像样的值**：Reddit 的发布时间本机读不到（403），`posted_on` 就留 `null`
   并写 `date_note`。R64 的时区坑就是从「填一个看起来对的时间」开始的。
3. **`node -e` 里不要出现反引号**：PowerShell 会把 `` ` `` 当转义符吃掉，报错位置还指向字符串中间的 `:`，
   看起来像 JS 语法错、其实是 shell 吃字符。负对照里用 edit 工具改文件更稳。

## R72（2026-11-02，交付轮）

**状态**：**718 测试 / 9 门 ALL GREEN / `--mutate` 9/9**；`check_listing` **16/16**；
**D5 `pending`**（0/10 · 0/1 · 634 burst），窗口到 `2026-11-15T20:24:37Z`。

**做了什么（三句话）**：

1. 关窗那天怎么跑写成了一页：`docs/d5-close-runbook.md`（四条命令 + 三个数各自的陷阱 + 判定表 + 三分支）。
2. 写它的时候发现**关窗读数的离线复算路径是空的**（`--fixtures` 只读不写）→ 补 `--fixtures-out`，
   真跑 capture → recompute **逐项相同**，+2 条单测。
3. 又发现**默认基线会挑中离线复算件**（`T-841`）→ 选择器改为优先现场件，并在产物里写 `baseline_kind`，
   +8 条单测；把四份现场件临时挪走真跑了一次 `recompute` 分支（警告句打出来了，四份逐字节还原）。

**下一位的第一件事**：**`2026-11-15T20:24:37Z` 之后**按 `docs/d5-close-runbook.md` §0 跑四条命令。
关窗前跑仍然只是 `pending`。中间上游若发新 rc，`watch-upstream` 会给出 `changed` 与两条命令。

**本轮新增的坑**：

1. **「读数口径写死了」不等于「读数可复算」**：D5 的阈值、判定顺序、`unmeasurable` 语义都冻结了，
   但采集侧只**读** fixtures、从不**写**——于是唯一决定产品生死的那个数，重新验证只能靠重跑联网。
2. **同一份数字有两个来源时，默认值会替你选**：`--baseline` 缺省曾按文件名排序，**分不出测量件与离线复算件**
   （`T-841`，R72 已修：优先 `inputs.offline === false`，并把 `baseline_kind` 写进产物）。
   今天两者数字相同所以无害，换一天就是拿旧窗的数判新窗。
3. **`docs/distribution/T-810/03-x-en.md` 可能被人工改成宣传稿且未提交**——HUMAN 2026-11-02 明确
   「那个是用于宣传的，不要管」。**不要**把它当成 stray work 提交、还原或 `git stash`；
   交接时看到它脏着是常态，`check_listing` 在它脏着时仍应 16/16。

## R71（2026-11-02，交付轮 + 流程断言）

**状态**：**708 测试 / 9 门 ALL GREEN / `--mutate` 9/9**；`check_listing` **16/16**；
**D5 `pending`**（0/10 · 0/1 · 634 burst），窗口到 `2026-11-15T20:24:37Z`。
**这一轮没有发帖**（HUMAN 决定）：交付的是「随时可发」的包，不是帖子。

**做了什么（三句话）**：

1. **三条回帖从草稿变成可粘贴块**，块里每个数字都由 `check_listing` 第 16 条从被引产物复算；`claims` 写在
   `docs/distribution/T-810/registry.json`，改版本 / 改计数 / 删边界句各自真红。
2. **「建议装哪个构建」也过同一个引擎**：`record_remedy_probe.mjs` 算出 `@deepseek-ai/dsh-mcp-client@0.2.1-rc.5`
   （今天的 `next`）被判 `admitted`，而 `0.1.0-rc.7` / `0.0.1-rc.1` 是 `denied` —— 回帖从「你去查有没有新版本」
   变成「装这个，它放行」。
3. **监听器接上电**：`--baseline` + 定时 workflow；`unmeasured` 让 job **失败**，CI 里**不跑卡片**（runner 没有 profile）。
   **workflow 已真跑一次**（run `41511265795`：`unchanged` / 零产物 / job success）——所以「CI 里跑不起来」不再是猜测项。

**下一位的第一件事**：仍是 **D5 关窗读数**（`2026-11-15T20:24:37Z`）。中间如果上游发了新 rc，
`watch-upstream` 会给出 `changed` 与两条命令——**卡片必须在真机上重跑**再引用。

**本轮新增的坑**：

1. **负对照不红，不一定是断言太松，可能是控制选错了位置**：第一次把正文版本改错时断言没红，
   因为粘贴块里还有另一处正确写法；改成「把该版本整体改错」才红——而这一轮真正的缺口是
   「版本只被用来找探针，没被用来验正文」，补的是**生成侧**的检查，不是控制的强度。
2. **CI 里的「看不见」会伪装成「没有变化」**：`--out` 只能是临时目录，于是 `previous` 恒空、永远 `baseline`。
   任何「只在自己输出目录里找基线」的监听器，在 CI 里都等于失忆。
3. **外部路径要在这里就砍掉**：`--baseline` 指到 `%TEMP%` 时，绝对路径差点写进产物（`C:\Users\<name>`）；
   改成只写 `(external)/<dirname>`。R67 已经教过一次，同一个形状会换一个参数再来。
4. **CI 红不一定是你的改动**：这一轮第一个提交的 `verify (node 22)` 红在 `probe-hook-error` 的
   `attempts.length === 1`（时序断言），**同一内容的下一次运行全绿**，本机一直绿 → 记成 `T-840`。
   别为了让它变绿先把断言改松：先判断「恰好 1 次」是不是真契约。

## R70（2026-11-02，判据轮 + 交付轮）

**状态**：**696 测试 / 9 门 ALL GREEN / `--mutate` 9/9**；`check_listing` **15/15**（`18-58`）；
**D5 `pending`**（0/10 · 0/1 · 634 burst），窗口到 `2026-11-15T20:24:37Z`。

**B（判据改动，已批）**：`no-post` 从此只表示「真的没发帖」。有 URL 但窗口起点读不出 → `unmeasurable`，
理由先写在 `SIGNOFF.md` 里。阈值与判定顺序未动。

**A（负载记录）**：`conditions.cpu.observed_busy_percent` 与运行窗口进了 `client-serve` 产物；
首个带条件的真机跑是 **39.1% 负载 / 919ms**——中等负载不足以解释长尾，而历史 4 次慢跑无法回溯条件。

**下一位的第一件事**：仍是 **D5 关窗读数**（`2026-11-15T20:24:37Z`）。**关窗前重跑都是 `pending`，不算新证据。**

**本轮新增的坑**：
1. **缺省值指向「看起来合理的地方」最危险**：`--dsh-main` 缺省 = 仓库根目录，`existsSync` 通过，于是错误调用被记成产品失败。
2. **负载读数要写明它不是什么**：`os.loadavg()` 在 Windows 恒 0；产物里现在有 `loadavg_usable: false` 提醒下一个人。
3. **条件记录只对未来的运行有效**：历史慢跑没有负载读数，不能假装能归因。

## R69（2026-11-02，采证轮）

**读数**：D5 仍 `pending` —— **0/10 · 0/1 · 634 burst**（live，`d5-evidence-2026-11-02T18-39-04-392Z.json`）。
X 线程发出约 9 小时，discussion 侧没有任何回流。

**这条不能说明什么**：D5 的 reactions 只数 `#11813`，X 上的赞按口径不算；因此它只说「没有跨平台回流到讨论帖」，
不说「没人看见」。真正的判断仍在 **2026-11-15T20:24:37Z** 关窗，届时三源一起读。

**自查一条（记进坑表）**：R65–R68 的部分产物 `generated_at` 用了递增的**合成值**（18:20 → 21:50），
而真实 UTC 当时是 17:35 → 18:39，最多**提前约 3 小时**。没有判据比较 `generated_at` 与墙钟（这是对的：产物要可复算），
所以**读数不受影响**；但按时间排序时会显得靠后。从 R69 起改用真实时钟。

## R68（2026-11-02，交付轮）

**状态**：**691 测试 / 9 门 ALL GREEN / `--mutate` 9/9**；`check_listing` **15/15**（`21-50`，测试数 691）；
**D5 `pending`**（真实读数 0/10 · 0/1 · 634 burst），窗口到 `2026-11-15T20:24:37Z`。

**做了什么（两句话）**：
1. `BS-54` 说的「没有分布」，其实是**没人把已有的加起来**——36 份 `client-serve-*.json` 汇总后：真实运行
   **n=21 · 中位 921ms · p90 2439ms · 最慢 5557ms**，而那个 **9510ms 出自负对照**。
2. 三条声称钉进纯函数与单测：单次观测不算分布、`unmeasured` 不是 0、**负对照必须与真实运行分组**——
   混算会把 p90 从 2.4s 抬到 7.2s（凭空多出 3 倍长尾）。

**下一位的第一件事**：仍是 **D5 关窗读数**（`2026-11-15T20:24:37Z`）。

**本轮新增的坑**：
1. **盲区可能只是「没汇总」**：`BS-54` 挂了六轮，缺的不是测量而是加法。
2. **对照组会污染分布**：同一字段、同一函数，换个实验条件就是另一条序列；分组不是洁癖，是正确性。
3. **p90 要标 `provisory`**：n<10 的 p90 是「一两次运行穿了统计的外衣」。

## R67（2026-11-02，交付轮）

**状态**：**683 测试 / 9 门 ALL GREEN / `--mutate` 9/9**；`check_listing` **15/15**（`21-20`，测试数 683）；
**D5 `pending`**（真实读数仍是 0/10 · 0/1 · 634 burst），窗口到 `2026-11-15T20:24:37Z`。

**做了什么（三句话）**：
1. `judgeD5` 的窗口起点改用 `parseInstant`——`Date.parse` 会把 `2026-02-30` 滚成 3/2 并算出一个「看起来合法」的窗口。
2. 记录器统一 `writeEvidence()`，把「打印路径 = 实写路径」变成契约，并把「收 `--out` 却硬编码打印」做成治理测试。
3. `registry.posted_on` 与 D5 产物的 `window.posted_on` 现在必须指同一时刻（治理测试按 URL 配对、比 epoch）。

**顺带**：`--fixtures` 曾把绝对路径写进产物，`results-privacy` 真红过一次（已修，红产物未提交）。

**下一位的第一件事**：仍是 **D5 关窗读数**（`2026-11-15T20:24:37Z`）。

**本轮新增的坑**：
1. **「CLI 挡住了」不等于「纯函数安全」**：`judgeD5` 是导出函数，谁都能直接调；护栏要在数据流上。
2. **构造夹具也要过隐私门**：`%TEMP%` 路径进产物 = `C:\Users\<name>` 进公开仓库；夹具只写名字。
3. **「对的硬编码」和「错的硬编码」要能区分**：不是所有 `ssot data/results/` 都有错，收 `--out` 的才有。

## R66（2026-11-02，判据修复轮）

**这一轮的动作是「请别人来打自己」**：R65 的复审是我自审，只抓到一条；用户要求「再次审核」，所以开了两个
**独立上下文**的 agent——一个只按产物复算，一个专门骗过新检查。adversary 找到 **12 个缺陷、3 个高**，
三个高全部命中 R64/R65 刚写的规则本体。

**真实状态**：**677 测试 / 9 门 ALL GREEN / `--mutate` 9/9**；`check_listing` **15/15**（`19-50`，注册表摘要
`42ab4db9…`）；可用性 smoke **6/6**（`19-55`，已发布 `0.3.3`）；**D5 `pending`**，窗口到 `2026-11-15T20:24:37Z`。

**三个高（都已修，各有控制）**：

| # | 缺陷 | 修前 | 修后 |
|---|---|---|---|
| 1 | 不存在的日期 | `2026-02-30T12:00:00Z` → `ok:true, problems:[]`（`Date.parse` 把它滚成 3/2） | `parseInstant()` 民用字段往返校验 → 红 |
| 2 | `NaN` 被当成「不在未来」 | `2026-13-01` / `99:99:99` / `:60` 全过 | `Date.parse` 为 NaN 显式报错 |
| 3 | 双语 channel 由数组下标决定 | `Discussion on X` + X URL **误拒**、+ GitHub URL **误放** | 平台必须**恰好一个**，两个 → 红并列出集合 |

**最值得记的一条**：adversary 指出「仓内唯一的瞬时校验绑在 `registry.posted_on`（没人读），而真正驱动
D5 的 `--posted-on` 零校验」。实测：`2026-02-30` 会让 `judgeD5` 从 `pending` 变 **`fail`**，`2026-13-01`
变 **`no-post`**（有帖子被读成没发帖）。**校验要放在数据流上，不是放在文档里。**

**下一位的第一件事**：仍不变——**D5 关窗读数**（`2026-11-15T20:24:37Z`）。

**本轮新增的坑**：
1. **自审的半径很小**：我审出来 1 条，独立 adversary 一小时拿出 3 条高的。以后凡是「新写了一条判据/规则」，
   请一次 adversary 比自己再读三遍便宜。
2. **「更严格」也可能是错的**：R64 只认 `Z`、R66 之前只数位数——两次都是把「格式」当成「事实」。
   判据要回答「这个值是真的吗」，不是「它长得像不像」。
3. **护栏的位置和护栏本身一样重要**：日期校验写在了没人消费的字段上，等于没有。

## R65（2026-11-02，复审 + 交付轮）

**这一轮审的是 R64 自己写的规则**，因为 R64 的推送之后用户要求「再次审核，测试项目，确保项目可用性」。

**真实状态**：**666 测试 / 9 门 ALL GREEN / `--mutate` 9/9**；`check_listing` **15/15**（终跑 `18-40`，
`drafts_registry_sha256 = 42ab4db9…`）；可用性 smoke **6/6**（已发布包 `0.3.3`）；npm 四包 `latest=0.3.3`；
**D5 `pending`**，窗口到 `2026-11-15T20:24:37Z`。

**做了什么（三句话）**：
1. **修掉一个假话**：R64 只认 `Z` 结尾的 `posted_on`，于是本机（UTC+1）最自然的 `+01:00` 被拒，
   报错还说「不是带时区」——它明确指定了时区，`Date.parse` 与 UTC 写法同值。规则抽成
   `scripts/lib/posting.mjs`（+10 单测，`Z`/`±hh:mm` 都收，裸日期与未来仍拒）。
2. **四条控制真跑**：偏移量写法 → 绿（修复的正面证明）· 裸日期 → 红 · 未来 → 红 · 域不符 → 红；
   产物新增 `inputs.drafts_registry_sha256`，因为「改→跑→还原」的控制没有这个摘要就全都长成「15/15」。
3. **可用性 smoke**（`scripts/record_usability_smoke.mjs`）：匿名装已发布包，在临时目录里跑
   `--help` / 无参 `status` / `audit` / `upgrade --to next --card`，6/6；负对照 `9.9.9` 双红。

**下一位的第一件事**：不变——**D5 关窗读数**（`2026-11-15T20:24:37Z`）。关窗前重跑都是 `pending`。

**本轮新增的坑**：
1. **「更严格」也可能是错的**：只认 `Z` 看起来更安全，实际拒掉合法输入并给出错误原因。规则要按定义写，
   不是按「最紧」写。
2. **记录器的打印路径一天内抄错两次**：`watch_next_release.mjs`（R64 已修）→ `record_usability_smoke.mjs`（R65 又抄）。
   负对照用 `--out %TEMP%` 才看出来。已记 `T-835`。
3. **怀疑的正则 bug 要先跑再改**：`V2EX` 那次如果直接「修」，会把一条正确的规则改坏。

## R64（2026-11-02，交付轮）

**这一轮的真实状态**：**656 测试 / 9 门 ALL GREEN / `--mutate` 9/9**；`record_publish` **22 项**
（新增 `dist-tags-agree`）；`check_listing` **15/15**（第 13 条已改成按 channel 验域）；
npm 四包 `latest=0.3.3`（本轮实测，不是引用旧读数）；**D5 `pending`**，窗口到 `2026-11-15T20:24:37Z`。

**做了什么（四句话）**：
1. **X 线程发出去之后落地台账**：`registry.json` 的 `03-x-en.md` → `posted` + URL + `posted_on 2026-11-02T17:36:00.000Z`；
   时区按**本机 UTC+1** 换算（按 +08 会写成 10:36Z，差 7 小时，D5 窗口会跟着挪）。
2. **第 13 条断言从「只能是 discussion URL」改成「域必须与条目自己的 channel 声明一致」**：
   否则 X 上的帖子根本录不进来，台账就停在 `draft` 与事实不符（R56 同型）。`posted_on` 也收紧成
   **带时区的 ISO instant**——裸日期能过 `Date.parse`，却会把 14 天窗口挪最多 24 小时。
3. **`record_publish` 新增 `dist-tags-agree`**：四包 `latest` 互相一致 + 等于发布版本 + 不指向未发布版本；
   读不到记 `unmeasured`，不当「agree」。0.3.1 与 0.3.3 两次事故都是这个形状。
4. **新增 `scripts/watch_next_release.mjs`**：上游 `next` 一变就出产物 + 给出卡片命令；
   **读不到 registry 一律 `unmeasured` 并退出 2、零产物**——`unchanged` 也零产物（不制造每日噪声）。

**下一位的第一件事（按价值排序）**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **D5 关窗读数**（`2026-11-15T20:24:37Z`） | 唯一的产品判断；关窗前重跑都是 `pending`，不算新证据 | `node scripts/record_d5_evidence.mjs` |
| 2 | **分类器 v3 采用**（判据轮） | 干净留出集 17/20 已过门槛；换生产必须同轮重测覆盖率 + HUMAN 5 条盲标 + 第三组留出集 | `audit/RECON_2026-11-02_classifier-v3.md` |
| 3 | **`BS-54` 时延分布** | 现有 `client-serve-*.json` 里已有 **25 次 `tab_ms`**（17 次 ≈0.92s，4 次 1.4–2.5s，4 次 5.6–9.5s 且全在 11-02 12:41–12:57 一个窗口）→ 可以直接出分布，不必新跑 10 次 | `scripts/record_client_serve.mjs` 产物 |
| 4 | **民间渠道**（V2EX / 掘金 / B 站） | 物料就绪，但**发前必须重跑文中命令**；页面数字要与当期产物一致 | `docs/distribution/T-810/04-zh-longform.md` |

**本轮新增的三条坑（直接搬）**：
1. **本机是 UTC+1，不是 UTC+8**：用户给的钟点要先换算成带 `Z` 的 instant 再进台账。
   `posted_on` 差 7 小时不会报错，只会把 D5 窗口挪走——这正是第 13 条要挡的形状。
2. **`process.exit()` 紧跟在 `fetch` 后面会崩**：Windows 上 libuv 报
   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`，**退出码变 1**，于是「读取成功」看起来像失败
   （`watch_next_release.mjs` 首次真跑就踩到，已改成 `process.exitCode` + 让事件循环自己排空）。
3. **`--stamp` 用冒号，产物名才会被替换成横线**：把 `2026-11-02T17-50-00.000Z`（文件名形状）粘给
   `--stamp` 会被判「用法错误」exit 2，而那看起来像「断言没过」。

**仍然开着的（不许写成「已解决」）**：
- `BS-52` / `BS-53`（分类器天花板）/ `BS-54`（只有一个 9510ms 观测）/ `BS-55`（发布两层异步）
- `T-303` / `T-202a` 的 `namespace-diff` 仍 `unmeasured`（`ADR-0009` A）
- **频道三的「自动跑」还没做**：`watch_next_release.mjs` 是手动/可被调用的脚本，没有 cron、没有发帖
- **字符预算断言没做**：中文线程「单推 ≤140 字」目前没有机器在算（草稿在 stash，等它进仓时一起做）

## R63 交接（2026-11-02，最后一个动作就是写这段）

**交接时的真实状态**：**643 测试 / 9 门 ALL GREEN / `--mutate` 9/9 / `check_listing` 15/15**，工作区干净，CI `success`；
**npm 四包 `0.3.3` 全部发布、`latest=0.3.3`**，取证 **21/21**（`data/results/publish-2026-11-02T15-54-38.303Z.json`，
`git_dirty=false`、`head 0ad06c7`）；**D5 `pending`**（0/10 · 0/1 · 634 burst），窗口到 `2026-11-15T20:24:37Z`；
**#65 `MERGEABLE/BLOCKED`**（`merged 0`）。

**这一轮做了什么**（三句话）：① R61 记的「页面 fetch 一直 loading」查明是**探针在 ≈500ms 就收工**（加载态走失败视图，
终止条件把「有 error 元素」当判），修好后真机 **16/16**、四桶与 CLI 逐项相同；② 把「什么算已经回答了」抽成纯函数
（`judgeTabView` / `judgeUpgradeView`），顺带修掉四处让「没观测」看起来像结论的度量缺陷，并让 `record_publish`
开始验**浏览器半边**（`client-bundle`，T-829）；③ 0.3.2 / 0.3.3 两次发布各遇到一次**异步**（读副本滞后 ~4.5 分钟、
staged 提升 ~14 分钟），两次都先红后查清，修法是**等 + 重读**，不是改断言。

**下一位的第一件事（按价值排序）**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **R63 采用分类器 v3**（判据轮） | 干净留出集 17/20 已过 80% 门槛；换生产会改头条 **4.8%** → 必须 live 重测 + **第三组**互斥留出集 + HUMAN 5 条盲标 + README/`check_listing` #14 同轮 | `audit/RECON_2026-11-02_classifier-v3.md` · `scripts/lib/discussion-triage.mjs` |
| 2 | **D5 关窗读数**（`2026-11-15T20:24:37Z`） | 唯一的产品判断；关窗前再读都是 `pending`，不算新证据 | `node scripts/record_d5_evidence.mjs …` |
| 3 | **`BS-54` 时延分布** | 面板 summary 一次观测 **9510ms**；先要 N≥10 次 `tab_ms` 的 min/median/p90/max 才谈得上改预算 | `scripts/record_client_serve.mjs` · `client-serve-nc-bucket-…T12-49-11` |
| 4 | 可领取的小票 | T-811（`Host` 头白名单，要先出 ADR）/ T-814（面板速率上限）/ T-812 / T-813（浏览器见证）/ T-815（`fix --install`，HUMAN 已授权未动工）/ T-817（slot 枚举 spike） | `docs/BACKLOG.md` |

**本轮新增的四条坑（直接搬）**：
1. **「没等到」先问「我们等了多久」**：R61 的结论和两条读数（路由 815ms 就答、探针 500ms 收工）同时躺在产物里，
   矛盾却没被发现。凡是「一直 loading / 一直没反应」，先看 `waited_ms`，再谈产品。
2. **加载态不许借用失败态的 DOM 契约**：`data-triage-tab="upgrade-error"` + `kind="loading"` 让「有 error 元素」
   和「已经答错」变成同一件事（R51 / R61 / R62 各踩一次）。两个视图两个标记，规则在 `scripts/lib/ui-probe.mjs`，单测钉死。
3. **`evaluate()` 会吞掉非 JSON 字符串**：页面内诊断返回 `'http:…'` 被 `JSON.parse` 失败吞成 `null`，
   产物里的 `direct: null` **不是**「页面也超时」，是「这条诊断什么都没测到」。
4. **发布工具与 registry 之间有两层异步**：读副本（~4.5 分钟）与 staged→publish（~14 分钟）。
   **发布输出 = 请求被接受**，不是状态；「发没发出去」只能靠三条独立读**重读**（两个 packument 视图 / 版本端点 / tarball HEAD）。
   **`409 Cannot publish over previously staged version` ≠ 版本号废了** —— 先等 15 分钟再判断
   （`BS-55`、`audit/INCIDENT_2026-11-02_missing-signals-0.3.3.md` §7）。

**仍然开着的（不许写成「已解决」）**：
- `BS-52`（覆盖率建立在只读文本分类器上，抽检一致率 9/20）/ `BS-53`（纯关键词天花板约 60%）→ **v3 未采用**，生产仍是 v1
- `BS-54`（面板时延只有一次 9510ms 的观测，没有分布）
- `BS-55`（发布链分不清「还没传播」与「根本没写进去」；暂存提升没有时限承诺）
- `T-303` / `T-202a` 的 `namespace-diff` 仍 `unmeasured`（`ADR-0009` A）
- 0.3.3 的 `dsh-triage@0.3.3` 有过约 15 分钟装不上的窗口（已恢复；`CHANGELOG` 里有面向用户的说明）

## R62 交接（2026-11-02，最后一个动作就是写这段）

**交接时的真实状态**：**623 测试 / 9 门 ALL GREEN / `--mutate` 9/9**，工作区干净；0.3.1 四包在 npm
（`latest=0.3.1`），**0.3.2 已备票未发布**；**D5 `pending`**（0/10 · 0/1 · 634 burst），窗口到
`2026-11-15T20:24:37Z`；**#65 `MERGEABLE/BLOCKED`**（`merged 0`）。

**这一轮做了什么**（三句话）：把 R61 那条「页面 fetch 一直 loading」查到了底——**不是产品不回答，是探针在
≈500ms 就收工了**（加载态走失败视图，终止条件把「有 error 元素」当判；路由 Node 直连 815ms、页面内 fetch 也 200）。
把「什么算已经回答了」抽成纯函数（`judgeTabView` / `judgeUpgradeView`），`loading`/`pending` 一律不算判，
超预算记 `unmeasured` 并写清等了多久；产品侧把加载态从 `upgrade-error` 里分出来（`upgrade-loading`）。
修后真机 **16/16 全过**：`upgrade-visible: passed`（4 桶，1530ms）+ `upgrade-same-source: passed`（3/190/0/2 与 CLI 逐项相同）。

**续 · 0.3.2 已发布，并修掉发布链的假红**：HUMAN 跑 `pnpm run release:publish`，四包 `✅ Published`；
但链内紧随的 `record_publish` 在 5 分钟里产出**三份红**（14:10 / 14:14 / 14:15:09）——**不是发布失败**：
`npm view` 早已看到 `latest=0.3.2`，而**匿名/安装文档副本滞后约 4.5 分钟**（`npm install` 仍 `notarget`），
第四份零代码改动就 20/20。修法是**等**而不是放宽断言：`scripts/lib/registry-wait.mjs`（默认 5 分钟预算，
只对 `notarget`/`ETARGET` 这类传播形状重试，E401 之类立刻出结论），产物新增 `install.attempts` /
`waited_ms` / `wait_budget_ms` 与一句 `registry-propagation`。**九条单测 + 一次真机正对照**
（`--version 9.9.9 --wait-registry-ms 3000` → 2 次尝试 / 16969ms / 「real failure, not a wait」）。
权威证据 `data/results/publish-2026-11-02T14-24-39.944Z.json`（`git_dirty=false` / `head 6fde8da` / 20/20）。

**续 · 文案检查器抓到一条「永远通过的断言」**：`test-count-matches` 一直报 `0 claim(s)` —— 正则末尾的
`\b` 是 ASCII 词边界，跟在中文「测试」后面永远不成立，所以它从来没检查过任何东西，README 徽章里的
`tests: 542` 僵了三轮。修法是让正则匹配三种写法（中文 / `tests: N` / 徽章 `badge/tests-N`），并新增
**`test-count-is-not-vacuous`**：传了数字却一条声明都没找到 → 红。`check_listing` 由 14 条变 **15 条**，
两类红产物（徽章 542 / 正文 623）都保留（`listing-…T14-27-00` / `…T14-28-00`），终跑 `…T14-29-00` 15/15。

**续 3 · `T-829` 收口：发布证据开始验浏览器半边**：`0.3.2` 的「四桶页签真的到了用户手里」当时是**手读**
（`npm pack` + grep）确认的。现在 `record_publish` 装了包之后会读 `exports["./client"]`，要求文件**在装回来的树里存在**、
带 `__ModuleLoader__.load`、并**点名 `settings.plugins.tab`** —— 三条都是可机器判的（`scripts/lib/client-bundle.mjs`，
**10 条单测**，含「file 不在 tarball 里」「从不点名 slot」两个反向形状）。真机 **21/21**（新增 `client-bundle` 一项），
正对照（把入口指到不存在的文件）当场判红并逐字节还原。
**同轮准备 `0.3.3`**：**纯文档发布** —— README 在包内 `files` 里，npm 页面显示的是 README 里写的测试数，
所以 633/543 那类漂移会直接印在 npm 上；`0.3.3` 只改文档（测试数 643、发布链与浏览器半边的说明），
`dist/` 与 `client.js` 一字未动，判据/阈值/退出码全部与 `0.3.2` 相同。**发布仍需 HUMAN 跑 `pnpm run release:publish`**。

**续 4 · 0.3.3 部分发布 → 已可安装**：发布输出四个 `✅ Published`，registry 上先只有三个 ——
`@dsh-triage/signals@0.3.3` 的 version 与 tarball 都是 404，`record_publish` 重试 20 次 / 301 秒后判红。
**那个红是真的，但结论是「还没到」，不是「坏了」**：npm 的发布是 **staged → 异步提升**，约 14 分钟后自己落地；
期间重发会得到 `409 Cannot publish over previously staged version`（**不是「版本号废了」**）。
现在 `npm install dsh-triage@0.3.3` 空 userconfig 匿名装验过 exit 0（四包全 0.3.3）。
**剩余**：`dsh-triage` / `core` / `probe` 的 `latest` 在一次回滚里回到 0.3.2（signals 已是 0.3.3）→
`npm dist-tag add <pkg>@0.3.3 latest` 三条，然后 `node scripts/record_publish.mjs` 应 21/21。
现场与三条独立读数见 `audit/INCIDENT_2026-11-02_missing-signals-0.3.3.md`；新盲区 **`BS-55`：发布输出不是证据**。

**续 5 · 0.3.3 收口（`latest=0.3.3`）**：`npm dist-tag add` 把三个包对齐后重跑 `record_publish` → **21/21**
（`data/results/publish-2026-11-02T15-54-38.303Z.json`：`git_dirty=false` / `head 0ad06c7` / `attempts=1` /
匿名安装 exit 0 / 三个内部包 0.3.3 / **`client-bundle` 首次在真实发布上四项全绿**）。
四个包的 `latest` 现在都是 0.3.3。**留给下一个人的不是这个版本号，而是那条读法**：
「发布输出 = 请求被接受」，状态只能靠三条独立读（两个 packument 视图 / 版本 404 / tarball HEAD）**重读**得到。

**下一位的第一件事（按价值排序）**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **发 0.3.3**（T-830，HUMAN） | **纯文档发布**：README 在包内 `files` 里，npm 页面印的就是 README 的测试数；`0.3.3` 把它改成实测的 643，并写上发布链/浏览器半边的两处修复。`dist/` 与 `client.js` 一字未动 | `pnpm run release:publish`（自动 preflight → publish → record_publish；现在会验 `client-bundle`） |
| 2 | **R63 采用分类器 v3**（判据轮） | 干净留出集 17/20 已过门槛，但换生产会改头条 4.8% → 必须 live 重测 + 新种子 + HUMAN 5 条 + README/`check_listing` #14 同轮 | `audit/RECON_2026-11-02_classifier-v3.md` |
| 3 | **D5 关窗读数** | 窗口 `2026-11-15T20:24:37Z`；关窗前再读都是 `pending` | `node scripts/record_d5_evidence.mjs ...` |
| 4 | **`BS-54` 的时延分布** | 面板 summary 一次观测到 **9510ms**；先要 N≥10 次的 `tab_ms` 分布，才谈得上改预算 | `scripts/record_client_serve.mjs` · `client-serve-nc-bucket-…T12-49-11` |

**本轮新增的三条坑**：
1. **「没等到」先问「我们等了多久」**：R61 的结论和两条读数（路由 815ms 答、探针 500ms 收工）同时摆在产物里，
   矛盾却没被发现。凡是「一直 loading / 一直没反应」，先看 `waited_ms`，再谈产品。
2. **加载态不许借用失败态的 DOM 契约**：`data-triage-tab="upgrade-error"` + `kind="loading"` 让「有 error 元素」
   和「已经答错」变成同一件事——第三次踩（R51 `pending`、R61 `loading`、本轮 `visible` 把 pending 写成 passed）。
   现在两个视图两个标记，规则在 `scripts/lib/ui-probe.mjs`，单测钉死。
3. **`evaluate()` 会吞掉非 JSON 字符串**：页面内诊断当时返回 `'http:…'`，被 `JSON.parse` 失败吞成 `null`，
   产物里写的是 `direct: null`——**那不是「页面也超时」，那是「这条诊断什么都没测到」**。

**`BS-54`（新盲区）**：面板 summary 偶发 >9.5s（一次观测）；`pending` 现在记 `unmeasured`，不再伪装成 `passed`，
但「慢」本身还没有分布，对外不许说「面板通常 1 秒」。

## R61 交接（2026-11-02，最后一个动作就是写这段）

**交接时的真实状态**：**611 测试 / 9 门 ALL GREEN / `--mutate` 9/9**，工作区干净；0.3.1 四包在 npm（`latest=0.3.1`）；
**D5 `pending`**（0/10 · 0/1 · 634 burst），窗口到 `2026-11-15T20:24:37Z`；**#65 `MERGEABLE/BLOCKED`**（`merged 0`）。

**这一轮做了什么**（两句话）：做了分类器 v3（v2 + 中文/日志形状 + 问题否决），**干净留出集 17/20（85%）**，过 80% 但按你的决定**不采用**；
开始 T-818（四桶进页签），host handler / 页签 / 单测都完成，真机 **`upgrade-route` 200**，但**页面 fetch 一直 loading**，所以 T-818 仍是 🟨。

**下一位的第一件事（按价值排序）**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **定位 T-818 页面 fetch pending** | 路由 Node 直连 200、summary 同源 fetch 正常，只有升级请求 pending；不定位就只能停在 🟨 | `scripts/record_client_serve.mjs`（`upgrade_probe.direct`）· `packages/plugin/client.js`（`loadUpgrade`）· `client-serve-2026-11-02T14-40-00` |
| 2 | **R62 采用 v3 + 覆盖率重测** | v3 在干净留出集 17/20；换生产必须 live 重测 + 新种子抽检 + HUMAN 5 条 | `audit/RECON_2026-11-02_classifier-v3.md` · `classifier-v3-2026-11-02T12-50-00` |
| 3 | **D5 读数** | 窗口到 2026-11-15 | `node scripts/record_d5_evidence.mjs ...` |
| 4 | **#65 等 review / T-818 完成后发 0.3.2** | #65 已 MERGEABLE；页签是包内文件，要发版才到用户 | `docs/market/submissions/README.md` |

**本轮新增的三条坑**：
1. **第三个 exact 路由在这版 Host 上 404**：登记日志有、路由表里没有；改在已工作的 `/compat-triage/summary` 上用 `?upgrade=1` 分流，普通 summary 契约不变；
2. **页面 fetch pending 不能写成「离线降级」**：离线会显示一句失败话，不会永远 loading；Node 直连 200 也不能当成「点击后出四桶」；
3. **分类器 v3 的 17/20 是干净留出集**：v2 的开发集 20/20 是过拟合；v3 也没有采用，采用要另开 R62。

**`BS-53` 剩余**：v3 过了 80% 但未采用；采用前仍需 HUMAN 5 条 + live 重测。

## R60 交接（2026-11-02，最后一个动作就是写这段）

**交接时的真实状态**：**593 测试 / 9 门 ALL GREEN / `--mutate` 9/9 / `check_listing` 14/14**（待本轮收口复核），
工作区干净；0.3.1 四包在 npm（`latest=0.3.1`）；**D5 窗口计时中（到 `2026-11-15T20:24:37Z`）**。

**这一轮做了什么**（两句话）：按 R59 的 20 条分歧做了分类器 v2（通用失败动词 + 运行期/组合形状），
开发集 **20/20**；但互斥留出集只有 **12/20（60%）**（v1 7/20），**低于 80% 门槛，所以不采用**——
生产仍 v1，覆盖率 **4.8%** 与 README **9/20** 一字未动。

**下一位的第一件事（按价值排序）**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **分类器 v3**（判据轮） | v2 证明「加通用失败动词」有效（+5/20），但纯关键词到不了 80%；v3 必须先写 spec + **第三个互斥留出集** | `audit/RECON_2026-11-02_classifier-v2.md` · `scripts/lib/discussion-triage.mjs` |
| 2 | **重跑 D5 读数** | 窗口到 2026-11-15；三个数每天都在动 | `node scripts/record_d5_evidence.mjs --post ... --posted-on ...` |
| 3 | **`T-821` rebase #65** | 进 dsh-market 的唯一入口，仍是 `DIRTY` | fork `jjjjjjjjnnjnn/dsh-community-plugins` |
| 4 | **`T-818` 四桶进页签** | 0.3.2 的功能票；页签还只有「现状」 | `packages/plugin/src/host-*.ts` + `client.js` |

**本轮新增的三条坑**：
1. **开发集 20/20 不是准确率**：v2 的信号表就是照着那 20 条设计的；必须用**互斥留出集**；
2. **留出集一旦看过就不能再用**：v3 要新的第三个集合，否则只是第二个开发集；
3. **纯关键词的天花板约 60%**：下一步要么先做「问题 vs 故障」二分类（把 feature request / usage question 挡掉），要么引入本地小模型（需要新 ADR 与离线边界）。

**`BS-53`（新盲区）**：v2 的留出集 12/20，纯关键词方法到不了 80%；生产仍 v1，覆盖率数字未动。

**顺手（D5 窗口内重读）**：`data/results/d5-evidence-2026-11-02T12-00-00-000Z.json`（`a99b7481f6f4…`）——
**`pending`**：reactions **0/10** · 外部引用 **0/1** · 周下载 **634** 但 `single-day-burst`（**不算需求**）；**没有新证据**，三个阈值未动，窗口到 `2026-11-15T20:24:37Z`。

**顺手（T-821）**：#65 从 **`CONFLICTING/DIRTY`** rebase 成 **`MERGEABLE/BLOCKED`**（干净分支只 **+12/-0**、151 entries；上游 `community-index.cjs --check` **OK** + `node --test` **9/9**；`blocked` 是仓库要求 review，不是冲突）；`merged` 仍为 0。产物 `data/results/market-channels-2026-11-02T12-10-00.000Z.json`（`6134e6f75c8c…`）。

**续（分类器 v3 候选）**：v3 = v2 + 中文/日志形状（`卡着`、`401/403`、`400/损坏`、`提权`、`symlink`、`no text block`）+ **问题/功能请求否决**；开发集 **20/20**、留出集 1 **17/20**、**干净留出集 2 17/20（85%）**（v1 5/20、v2 15/20）。**过 80% 但未采用**——换分类器必须与新的覆盖率读数一起出现，需 **R62**：live 重测 + 新种子抽检 + HUMAN 5 条。产物 `data/results/classifier-v3-2026-11-02T12-50-00-000Z.json`（`4b0247e48c35…`）；报告 `audit/RECON_2026-11-02_classifier-v3.md`。

**T-818（🟨 进行中）**：四桶 handler + 页签第二屏（`/compat-triage/summary?upgrade=1`，默认不联网、点击才读 npm、10s 硬上限）+ 9 条单测完成；真机 **`upgrade-route` 200**（Node 直连），但页面 fetch 一直 `loading` → **`upgrade-visible: failed`**、`upgrade-same-source: unmeasured`。红产物 `data/results/client-serve-2026-11-02T14-40-00.000Z.json`（`3940b6d5…`）。下一步：定位页面 fetch 为什么 pending（summary 同源 fetch 正常，路由 Node 直连 200）。

## R59 交接（2026-11-02，最后一个动作就是写这段）

**交接时的真实状态**：**583 测试 / 9 门 ALL GREEN / `--mutate` 9/9 / `check_listing` **14/14**，工作区干净；
0.3.1 四包在 npm（`latest=0.3.1`）；**D5 窗口计时中（到 `2026-11-15T20:24:37Z`）**。

**这一轮做了什么**（三句话）：把「上游问题里我们能覆盖多少」从 12 条样本做成 **Q&A 全量 1544 + General 全量 5785** 的普查，
头条 **74/1545 = 4.8%**（Wilson 3.8–6.0%）；先签口径、再跑数据，中途按 50 条试点**修正一次**（未点名的上游包不进头条）；
README 新增一节，并用 `check_listing` 第 14 条把每个数字钉回产物 / 复算 / 抽检。

**下一位的第一件事（按价值排序）**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **分类器 v2**（判据轮） | 一致率 **9/20**，9 条分歧是运行期转述没命中关键词；头条是保守下界，但 tier 拆分不准 | `scripts/lib/discussion-triage.mjs` + `tests/unit/discussion-triage.test.ts` + 本轮 20 条 `review.json` |
| 2 | **重跑 D5 读数** | 窗口到 2026-11-15；三个数每天都在动 | `node scripts/record_d5_evidence.mjs --post ... --posted-on ...` |
| 3 | **`T-821` rebase #65** | 进 dsh-market 的唯一入口，仍是 `DIRTY` | fork `jjjjjjjjnnjnn/dsh-community-plugins` |
| 4 | **`T-818` 四桶进页签** | 0.3.2 的功能票；页签还只有「现状」 | `packages/plugin/src/host-*.ts` + `client.js` |

**本轮新增的四条坑（直接搬）**：
1. **`let x` 不是 `null`**：快照构建条件写 `=== null`，`undefined` 会静默跳过整个快照——产物看起来是绿的，复算当场 exit 1；
   初始化成 `null`，并加「没有 packuments 就 die」守卫；
2. **`undefined` 和 `null` 在 admission 里不是一回事**：`engines: null` 是**畸形声明**（denied），`engines: undefined` 才是「没声明」；
   快照要**省略**字段，不要 `?? null`；否则复算会把 `unconstrained` 翻成 `denied`（本轮 81 条）；
3. **抽检要盲标**：先读 title+body 给标签，再看分类器；本轮 9/20 的分歧里 9 条是同一类（运行期转述），先看分类器就会不自觉地跟着它；
4. **试点会暴露口径问题，不要跑完全量再发现**：50 条试点就抓到「上游过期 tag 被算成用户问题」，此时改口径是 HUMAN 决策 + 新记账，
   不是跑完后调参。

**`BS-52`（新盲区）**：分类器一致率只有 45%，而 tier 拆分依赖它；头条不受影响（误读只会少算），但「我们覆盖了哪一类问题」目前只能当粗略分布。

## R58 交接（2026-11-02，最后一个动作就是写这段）

**交接时的真实状态**：**548 测试 / 9 门 ALL GREEN / `--mutate` 9/9 / `check_listing` 13/13（8 篇草稿）**，
工作区干净，`main` = `origin/main`；0.3.1 四包在 npm 上（`latest=0.3.1`）；**D5 窗口计时中（到 `2026-11-15T20:24:37Z`）**。

**这一轮（R57）交付了什么**：把 12 条上游求助帖分层判定 + 对点到包名的帖子真算准入 →
`names-a-denial 7 · rules-out-declaration 1 · declares-nothing 3 · runtime 3`；报告 `audit/RECON_2026-11-02_upstream-help.md`；
另写了三条回帖草稿（`06/07/08`），**HUMAN 判断后决定不发**（对应帖子别人已经答过），草稿保留作样例、不再进待发队列。

### 下个会话的主任务：**大规模 Question 采证 → 覆盖率 → 写进 README**

**目标（一句话）**：在 Discussions 的 Q&A（+ General 里的故障帖）**大样本**上统计「**我们这套判断层能覆盖多少**」，
把结果写进 README，且**分母、区间、分类器误差都写清楚**。

**开工前必须先定口径（照 D5 的做法：先写死再看数据）**，落 `docs/specs/question-coverage.md`：

| 项 | 必须写死的内容 | 为什么 |
|---|---|---|
| 样本定义 | 分类（`Q&A`？`General`？两者？）、时间窗、抓取方式（GraphQL 分页、每页 100）、**总数 N 与抓取到的 M** | 没有分母的百分比就是口号 |
| 「能覆盖」的三档 | `names-a-denial`（能点名被拒的包）/ `rules-out-declaration`（能排除声明层）/ `declares-nothing`（只能说明没声明） | 三者价值不同，混成一个「覆盖率」会夸大 |
| 不可读 | 读不到 → 记 `unreadable`，**不进分母** | 读不到 ≠ 没有 |
| 区间 | 百分比必须带 **Wilson 95%**（仓库已有先例） | 单点估计会被当成承诺 |
| 分类器误差 | **人工抽检 ≥20 条**，记录一致率；错的样本要单独列出 | 分类器只读文本，R57 里 `#11421` 就判错过（运行期被读成组合问题） |
| 外推边界 | 只对**样本**成立；README 里禁止写「全网 / 所有问题」 | `BS-43` 的教训 |

**执行步骤**：
1. 写 `docs/specs/question-coverage.md`（口径，需 HUMAN 签字——同 D5 的规矩）；
2. `scripts/record_question_coverage.mjs`：GraphQL 分页抓 → 原始快照进 `data/fixtures/discussions/` → 复用 `scripts/lib/discussion-triage.mjs` 分类 →
   对能判的帖子复用 R57 的 `probePackage`（**帖子点名版本就按点名版本**）→ 产物 `data/results/question-coverage-<stamp>.json`；
   **403/429 一律 exit 2、零产物**（R52 的教训：读不到写成 0 会被读成「没人有问题」）；
3. 人工抽检 20 条并记 `manual_review.agree/total` + 错例清单；
4. README 加一节「这些问题里，我们这套能覆盖多少」：一句话 + 分母 + Wilson 区间 + 三档拆分 + 边界；
5. `check_listing` 加一条断言：README 里的百分比必须与产物里的数字**逐项相同**（改数不重跑即红）。

**验收**：产物带 `produced_by` / `generated_at` / `.sha256`；README 的每个数字都能指回产物；人工抽检一致率写在产物与 README 里；`--fixtures` 离线复算 rows/counts 逐项相同。

**四条不许踩的坑（R57 新增，直接搬过来）**：
1. **「不是 admitted」不等于「denies」**：`evaluateAdmission.status` 四态（`admitted / denied / unconstrained / indeterminate`），把后两者写成 denies 会造出「应用拒自己」；
2. **探针要用帖子里点名的版本**（`pkg@ver`），否则 latest 会换一个问题来答；
3. **裸名可能是另一个包**：`dsh-llm` ≠ `@deepseek-ai/dsh-llm`，同帖出现作用域名时裸名一律丢弃；
4. **分类器只读文本**：运行期现象常被读成组合问题——所以**抽检**不是可选项。

**顺手可做（不阻塞主任务）**：`T-821` rebase #65（还是 `DIRTY`）；D5 每日重跑一次读数。

## R57 交接（2026-11-02，最后一个动作就是写这段）

**交接时的真实状态**：**548 测试 / 9 门 ALL GREEN / `--mutate` 9/9 / `check_listing` 13/13**，工作区干净；
0.3.1 四包在 npm 上；帖子 `#11813` 已发；**D5 窗口计时中（到 `2026-11-15T20:24:37Z`）**。

**这一轮做了什么**（两句话）：把上游 12 条求助帖逐条判「我们能不能答」（分层 + 对包真算准入），
结论是 **7 条能点名被拒的包、1 条能排除声明层、3 条只能说明「没声明」、3 条不是我们的层**，报告在
`audit/RECON_2026-11-02_upstream-help.md`。

**下一位的第一件事**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **决定要不要回帖**（HUMAN） | 公开动作；报告 §6 给了顺序：`#8202`（最干净）→ `#10849`（tag 的故事）→ `#11687`（反向排除） | `audit/RECON_2026-11-02_upstream-help.md` §3/§6 |
| 2 | **重跑 D5 读数**（agent） | 窗口内每天一次，产物自带时间轴 | `node scripts/record_d5_evidence.mjs --post https://github.com/deepseek-ai/deepseek-harness/discussions/11813 --posted-on 2026-11-01T20:24:37.000Z` |
| 3 | **`T-821` rebase #65** | 进 dsh-market 的唯一入口，还是 `DIRTY` | fork `jjjjjjjjnnjnn/dsh-community-plugins` |
| 4 | **采证扩样** | 12 条是五组关键词的并集，不是全量；`#11421` 被文本分类误判成 `composition`（实际偏运行期） | `scripts/record_discussion_triage.mjs --ids <new ids>` |

**本轮新增的三条坑**：
1. **「不是 admitted」不等于「denies」**——`evaluateAdmission.status` 有四态（`admitted / denied / unconstrained / indeterminate`），
   把后两者写成「denies」会造出「应用拒自己」这种话；第一版就是这么错的；
2. **探针必须用帖子里点名的版本**（`pkg@ver`），否则 `latest` 会换一个问题来答（`#8202` 的 `0.1.0-rc.7` vs latest `0.0.1-rc.1`）；
3. **裸名可能是另一个包**：`dsh-llm` ≠ `@deepseek-ai/dsh-llm`。同帖出现作用域名时，裸名一律丢弃。

## R56 交接（2026-11-01，最后一个动作就是写这段）

**交接时的真实状态**：**542 测试 / 9 门 ALL GREEN / `--mutate` 9/9 / `check_listing` 13/13**，工作区干净；
0.3.1 四包在 npm 上（`latest=0.3.1`）；**帖子已发**（`#11813`）；**D5 正在计时：`pending`**，窗口到 **2026-11-15T20:24:37Z**。

**现在三个数的真实读数**（`data/results/d5-evidence-2026-11-01T22-00-00.000Z.json`）：reactions **0/10**、
外部引用 **0/1**、周下载 **634** 但 `single-day-burst`（**不算需求**）→ `counts_as_demand = false`。

**下一位的第一件事（按价值排序）**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **重跑 D5 读数**（agent，随时） | 三个数每天都在动，而判定只看窗口结束那一刻（或三数提前达标） | `node scripts/record_d5_evidence.mjs --post https://github.com/deepseek-ai/deepseek-harness/discussions/11813 --posted-on 2026-11-01T20:24:37.000Z` |
| 2 | **`T-821` rebase #65** | 它是进 dsh-market 的唯一入口，现在 `DIRTY` | fork `jjjjjjjjnnjnn/dsh-community-plugins`，分支 `feat/community-plugins-dsh-triage` |
| 3 | **`T-818` 四桶进页签** | 页签现在只有「现状」，没有「升级会坏」；0.3.2 的票 | `packages/plugin/src/host-*.ts` + 页签第四个区块（表格已经有了，加一张四桶表即可） |
| 4 | **把 04/05 也发出去**（HUMAN） | 中文长文与 B 站脚本已按新文案同步，但还没发 | `docs/distribution/T-810/04-zh-longform.md` · `05-bili-script.md` |

**本轮新增的四条坑**：
1. **别用 PowerShell 的 `Set-Content` 回写 UTF-8 文件**——它按控制台默认编码（本机 GBK）写，中文直接变乱码，
   `registry.json` 因此解析失败；要用 node / 编辑工具写，或 `git checkout --` 恢复后重做；
2. **重拍截图必须重录产物**：图换了而产物没换，`screenshot.sha256` 就对不上（本轮真踩到，`482433e5…` vs `9d4e8313…`）；
3. **断言要防「空转」**：registry 读不到时循环零次会**假绿**——第一条负对照就是这么被骗的；现在有显式守卫；
4. **D5 的窗口由 `posted_on` 决定**，它不是装饰字段；第 13 条断言（discussion URL + 过去的 ISO + draft 不许带 URL）就是为它设的。

**`BS-48` / `BS-51` 的剩余**：下载数含机器；外部引用只看得到 GitHub 搜索可见的那一小片（讨论区评论里的引用它数不到）。

## R55 交接（2026-11-01，最后一个动作就是写这段）

**交接时的真实状态**：**542 测试 / 9 门 ALL GREEN / `--mutate` 9/9**，工作区干净；0.3.1 四包在 npm 上
（`latest=0.3.1`，`publish-2026-11-01T18-00-00` **20/20**）；**投放包就绪但没发**（`T-810/registry.json` 五篇仍 `draft`）。

**这一轮做了什么**（两句话）：① 按用户要求把设置页从「一串文字」改成**三张表**（计数 / 问题 / 下一步），
判据与数字一个未动；② 顺着改表把记录器的 DOM 探针也改成**按行读回配对**，并把「标签与命令必须分开」那条断言
从「检查 ` — `」搬到「检查两个单元格」。

**下一位的第一件事（前两件是 HUMAN）**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **发帖**（HUMAN） | D5 的 reactions / 外部引用结构性地是 0，因为一篇都没发；口径已签（`SIGNOFF` R54 行） | `docs/distribution/T-810/01-show-your-plugins.md` → **Show Your Plugins!**（两张图拖进编辑框上传） |
| 2 | **开表**（agent） | 窗口从 `posted_on` 起算 14 天 | `node scripts/record_d5_evidence.mjs --post <URL> --posted-on <ISO>` |
| 3 | **`T-821` rebase #65** | `DIRTY` 的 PR 永远合不了，它是进 dsh-market 的唯一入口 | fork `jjjjjjjjnnjnn/dsh-community-plugins`，分支 `feat/community-plugins-dsh-triage` |
| 4 | **`T-818`「四桶」进页签** | 正门能力还没进 UI（0.3.2 的票） | `packages/plugin/src/host-*.ts` + 页签第二个按钮（现在是表格，加一张四桶表即可） |

**本轮新增的三条坑**：
1. **这个宿主不给我们的标记加样式，也不拦内联样式**——裸 `<table>` 会挤成一团（`行 219台账里声明过的行`），
   内联 `padding` / `whiteSpace` 有效；但**列宽是靠内容撑的**，「修复」「复制」这种窄列必须自己 `nowrap`；
2. **表格化会顺手把探针弄瞎**：`counts_text` 原来读一整段文字，搬进表格后会变成糊在一起的字符串 →
   必须给每个数值加 `data-count-*` 让探针读「键 → 值」；`issues` 也要从 `li` 改成兼容 `tr`；
3. **「两人分开」这类断言要跟着结构搬**，不能删：原来查文本里的 ` — `，现在查两个单元格——失败条件不变。

## R54 交接（2026-11-01，最后一个动作就是写这段）

**交接时的真实状态**：**542 测试 / 9 门 ALL GREEN / `--mutate` 9/9**，工作区干净；0.3.1 四包已在 npm 上（`latest=0.3.1`）；
**投放包已就绪但一篇都没发**（`docs/distribution/T-810/registry.json` 五篇全是 `status: draft`）。

**这一轮做了什么**（三句话）：① 把 D5 的三个数做成**可执行口径**（spec + 纯函数 + 8 条单测）和一个只读计量脚本，
其中两个 GraphQL 错误是我自己用 `--dry-read` 对真 API 读出来的；② 给真机记录器加了 `--screenshot`，拍到
**两张真截图**（真实沙盒 / 夹具「会坏」屏）——这是 Show Your Plugins 六条里唯一一直缺的硬前置；
③ 把草稿 01 从「回复 rc.5 讨论帖」改写成**中文的 Show Your Plugins 帖**，检查器当场抓到我写的禁用话术。

**下一位的第一件事（按顺序，前两件是 HUMAN）**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **签 D5 口径**（HUMAN） | spec 写着「签字前不得用于判定」；不签的话 D5 只能报数不能给 verdict | `docs/specs/D5-measurement.md` §6，签完记进 `audit/SIGNOFF.md` |
| 2 | **发帖**（HUMAN） | D5 的 reactions / 外部引用**结构性地是 0**，因为一篇都没发 | 贴 `docs/distribution/T-810/01-show-your-plugins.md` 到 **Show Your Plugins!**（两张图要上传成附件） |
| 3 | **开表**（agent） | 窗口从 `posted_on` 起算 14 天 | `node scripts/record_d5_evidence.mjs --post <URL> --posted-on <ISO>`，然后回填 `registry.json` |
| 4 | **`T-821` rebase #65** | `DIRTY` 的 PR 永远合不了；它是进 dsh-market 的唯一入口 | fork `jjjjjjjjnnjnn/dsh-community-plugins`，分支 `feat/community-plugins-dsh-triage` |
| 5 | **`T-818`「四桶」进页签** | 正门能力还没进 UI（0.3.2 的票） | `packages/plugin/src/host-*.ts` + `client.js` 第二个按钮 |

**本轮新增的四条坑**：
1. **`search/issues` 不索引 discussions**（`BS-51`）：外部引用只数得到 GitHub 上的 issue/PR；`references_seen = 3` 全是我们的 PR 时，结论是「GitHub 上没看到」，不是「没人用」；
2. **GraphQL 的 `reactionGroups.content` 是枚举**，不能 `{ name }`；花括号层数错了报的是「Expected one of SCHEMA…」——**别靠猜，跑 `--dry-read`**；
3. **截图必须在 `visible` 之后拍**：先确认页签渲染出答案再照，否则照片里是空壳（和 R49 的 CSP 事故同一种假绿）；
4. **「不含 X」那句话里也不能写 X**：`check_listing` 的禁用词表按字符串扫，不认意图——写「不写个人身份信息」而不是列举那些词。

**`BS-48` / `BS-51` 的剩余**：下载数含机器（稳态 20 也可能不是人）；外部引用只看得到 GitHub 搜索可见的那一小片。

## R53 交接（2026-11-01，最后一个动作就是写这段）

**交接时的真实状态**：**534 测试 / 9 门 ALL GREEN / `--mutate` 9/9**，工作区干净；**四个包 `0.3.1` 全部在 npm 上且 `latest` 都指向它**，`record_publish` **20/20**（`data/results/publish-2026-11-01T18-00-00.000Z.json`：`git_dirty=false`、`head a5506e0`、匿名安装 exit 0）。**发布当晚有过一次部分发布**（`core` 晚 2 分 47 秒，`latest` 那段时间装不上），现场与修复路径见 `audit/INCIDENT_2026-11-01_partial-publish.md`。

**这一轮做了什么**（三句话）：① 把 0.3.1 的票做好——四包同升、CHANGELOG、两份 README/两份上架文案/提交包全部对齐，
`check_listing` **12/12**，发布预检查如实报 **`E401`**（本机 npm 凭据失效，**发布前要 `npm login`**）；
② 顺手把渠道复核了一遍，拿到一条**真事实**：**dsh.so 已经收录我们**（`listed`，L5 · Run tested / security low），
以及一条**坏消息**：**#65 已经 `DIRTY`**（与上游 `main` 冲突，不 rebase 就永远合不了）；
③ 发布时撞上**部分发布**，当场用 `record_publish` 判红并补齐，然后把「发到一半」做成发布链的自动检查（`T-822`）。

**下一位的第一件事（按价值排序，选一个）**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **按 Show Your Plugins 发帖（HUMAN 发，agent 备料）** | D5 的另外两个数（reactions / 外部引用）**结构性地是 0**，因为一份样本都没发过 | 见下面的「R54 待办」+ `docs/BACKLOG.md` `T-810` |
| 2 | **`T-821` rebase #65** | 它是进 dsh-market（最大那条路）的唯一入口，`DIRTY` 等于死信 | fork `jjjjjjjjnnjnn/dsh-community-plugins`，分支 `feat/community-plugins-dsh-triage` |
| 3 | **`T-818`「四桶」进页签** | 正门能力还没进 UI；0.3.2 的票 | `packages/plugin/src/host-*.ts` + `client.js` 第二个按钮 |
| 4 | ~~发 0.3.1~~ | ✅ 已完成（`T-820`），四包 20/20 | `data/results/publish-2026-11-01T18-00-00.000Z.json`（干净树，`git_dirty=false`） |

**R54 待办（投放前必须先有的三件，缺一不可）**：
1. **写死 D5 读数口径**（`docs/specs/D5-measurement.md`，需 HUMAN 签字）：reactions = 帖子的 `reactions.totalCount`；
   外部引用 = **非本项目账号**发出的、指向我们仓库/产物的公开链接（排除我们自己的三条 PR）；downloads 复用 R52 的
   `download_shape`；窗口 = `posted_on + 14d`；**读不到就记 `unmeasurable`，不许记 0**。**先定口径再看数据**。
2. **`scripts/record_d5_evidence.mjs`**：GraphQL 读 reactions + Search API 读外部引用 + 引下载产物；
   429/403 → **exit 2 零产物**；`--fixtures` 离线逐字节复算；带「读不到 ≠ 0」与「burst ≠ 需求」两条负对照。
3. **真机截图**：官方六条**明确要求截图**，而全仓 `*.png/gif` = 0。给 `record_client_serve` 加 `--screenshot`，
   必须截到「人话结论 + 计数 + 要看的地方」，PNG 进 `docs/market/` 并在产物里记 bytes + sha256。
   帖子正文按 #2004 改写（**纯中文**，标题 `DSH | dsh-triage | …`，含项目地址 / 介绍 / 截图 / 集成方式 / **非官方声明**）。

**四条不许踩的坑（本轮新增）**：
1. **上游没有 per-rc 的 Discussion**——Announcements 只有 #1797 欢迎帖。唯一被官方承认的插件渠道是 **Show Your Plugins!**（#2004 六条：标题模板、项目地址、介绍、**截图**、集成方式、非官方声明、一项目一帖、按 upvote 排序）。草稿 01 的「回复在 rc.5 release thread 下」**结构上发不出去**，投放前必须改写；
2. **`record_market_channels` 不传 `--pr` 会得到 `live 0`**——那是「没问」，不是「PR 全没了」。同样地，`--site` 不传就没有 `site_submissions`；
3. **npm 凭据会过期**：`E401` 是**真结论**（`npm whoami` 同秒复现），不是 `could-not-run`。发布前 `npm login`，别把 401 改写成「检查没跑起来」——那是 R50 的反向错误；
4. **对外文档里出现 `包名@旧版本` 会被 `check_listing` 判红**，即使你是在引用别人的旧值。改写法（「仍是上一个版本」），**不许放宽正则**；
5. **`pnpm -r publish` 不是一次写**——四个包四次写，`core` 那次卡在 registry 暂存就只剩三个（`latest` 当场指向装不上的版本）。**发布后必须跑 `record_publish`**，只有 `anonymous-install` 与三个 `dependency:*` 全绿才算发成功；`release:publish` 现在会自动跑它（`T-822`）。

**`BS-48` 的剩余（写在这里，别当成已完成）**：形状能排除「单日爬虫」，排除不了「稳态的 20 次也是机器」；那一天的抓取方我们只有形状、没有归属；品类天花板同样只到「周合计 + 形状」。**新增一条读法**：dsh.so 收录**不产生下载**，别把它算进 D5。

## R52 交接（2026-10-31，最后一个动作就是写这段）

**交接时的真实状态**：**529 测试 / 9 门 ALL GREEN / `--mutate` 9/9**，工作区干净。

**这一轮做了什么**（两句话）：① 把「D5 的下载项」从**能被单日爬虫骗过去**改成**能被机器判定**——634 次周下载、
十天里只落在一天，按规则**不算需求**；② 把「升级日」的样本换成**真实存在的目标**（`0.2.1-rc.5`），并把它写成
五篇可以直接贴的草稿。

**下一位的第一件事（按价值排序，选一个）**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **发 0.3.1（HUMAN，OTP）** | 设置页那一屏是包内文件，registry 上的 0.3.0 不含它；不发用户永远看不到 | 终端 `pnpm -r publish` → `node scripts/record_publish.mjs --version 0.3.1` |
| 2 | **把 `01-rc5-discussion-reply.md` 贴到 rc.5 的 Discussion 下（HUMAN）** | D5 的另外两个数（reactions / 外部引用）**结构性地是 0**，因为一份样本都没发过；窗口到 ~11-13 | 贴完把 `registry.json` 的状态改 `posted` + URL，再跑一次 `record_market_baseline` |
| 3 | **`T-818`「四桶」进页签** | 正门能力还没进 UI；注意默认不联网、点击才读 registry、20s 上限、断网要有降级句 | `packages/plugin/src/host-*.ts` 加只读路由 + `client.js` 加第二个按钮 |
| 4 | **`T-815`（`fix` 的「装包」）** | 已获授权，但只在 `sandbox/` 隔离 profile，五步计划见 R49 段 | `docs/specs/M7-autofix.md` §5 |

**四条不许踩的坑（本轮新增）**：
1. **周下载合计不是需求**——`download_shape = steady` 之前，任何「我们有人用了」的说法都是假的；`BS-48` 写着还剩什么看不见；
2. **npm downloads API 的节奏是测出来的，不是猜的**：无 scope 的包能一次查多个（scoped 包不行，`400 scoped packages are not currently supported in bulk lookups`），按天端点预算约 11 次/窗口、恢复约 5s——所以是「批量 + 分端点节奏 + 429 不进 fixture」，不是「把重试次数调大」；
3. **GitHub 匿名额度用尽时返回 `403`，不是「没有讨论」**——读不到就必须 exit 2 且不落产物，否则 `pain_threads: 0` 会被读成「上游没有痛点」；
4. **记录的路径也可能是隐私**：离线的 `--fixtures` 曾把 `C:\Users\…` 写进 `data/results`（`results-privacy` 当场红），现在统一走 `portablePath()`。

**`BS-48` 的剩余（写在这里，别当成已完成）**：形状能排除「单日爬虫」，排除不了「稳态的 20 次也是机器」；那一天的抓取方
我们只有形状、没有归属；品类天花板同样只到「周合计 + 形状」。

## R51 交接（2026-10-30，最后一个动作就是写这段）

**交接时的真实状态**（`80ed55a`，本轮末提交）：**518 测试 / 9 门 ALL GREEN / `--mutate` 9/9**，工作区干净，`main` = `origin/main`。

**这一轮做了什么**（一句话）：把「一屏答案」从 CLI / 本地面板搬进 **DSH 设置页的页签**，然后**当用户去读它**——先造出「会坏」屏、英文屏与真实点击，再按读出来的毛病逐条修。

**下一位的第一件事（按价值排序，选一个）**：

| 顺序 | 任务 | 为什么是它 | 起点 |
|---|---|---|---|
| 1 | **发 0.3.1（HUMAN 动作）** | 页签是包内文件，registry 上的 0.3.0 **不含**这块 UI；不发版用户永远看不到 | 终端 `pnpm -r publish`（需 OTP）→ `node scripts/record_publish.mjs --version 0.3.1`（`--stamp` 可省） |
| 2 | **slot 枚举 spike** | 决定「插件列表行级徽章」能不能做：目前只有 `settings.plugins.tab` 有真机证据 | 真浏览器里枚举可用 slot，落 `data/results/spike-slots-<stamp>.json` |
| 3 | **「升级日四桶」做成页签第二个按钮** | 正门能力还没进 UI；但会读 registry，必须按需触发 + 20s 上限 + 明确标注 | `packages/plugin/src/host-*.ts` 加一条只读路由，页签加按钮 |
| 4 | **`T-815`（`fix` 的「装包」）** | 已获 HUMAN 授权，但**只在 `sandbox/` 隔离 profile**，五步计划见下面的 R49 段 | `docs/specs/M7-autofix.md` §5 |

**四条不许踩的坑（本轮新增，§4 也有行）**：
1. **别把「检查没跑起来」写成结论**——preflight 那次把 `spawnSync npm ENOENT` 报成「你的 token 401」（R50）；页签的 DOM 探针也差点把 `pending` 当答案（R51）。不跑就报 `could-not-run` / `unmeasured`。
2. **浏览器里的间距不能交给宿主 CSS**——`逐行归因dsh-triage why`、`不含…复制` 两处都是这么坏的；分隔符必须写进文本本身。
3. **`summary.rows` 是「声明行」，`audit --json` 的 `rows` 是「解析行」**（219 vs 192）。两个都叫 rows，比较时用哪一个必须显式写。
4. **记录器不许往产物里写绝对路径**——`extra-bundles` 的 `staged` 撞了 `results-privacy`，六份产物事后脱敏（台账写明）。

**`BS-47` 的剩余（写在这里，别当成已完成）**：真·runtime 升级路径只有「声明被改」的模拟；中文轮真鼠标点击到了按钮却没触发 handler（未归因，探针回落 `dom-click` 并标 `method`）；只测过 Edge headless 与 0.2.1-rc.4。

## R49 第 6 段：CI 修复 + T-816 交付 + T-815 已获授权、未动工

**交接时的真实状态**（`7c55109` 之后、本轮末提交前）：**510 测试 / 9 门 ALL GREEN / `--mutate` 9/9**，
工作区干净，`main` 与 `origin/main` 一致，**CI 已绿**（`gh run list` 最新一次 `completed/success`）。

1. **CI 红了两周，根因不是测试**：`.github/workflows/ci.yml` 第 97 行 `needs: verify    steps:`
   两个键写在一行 → **workflow 无法解析**，GitHub 显示"失败"但 **0 个 job**。拆行后立刻暴露出
   第二个真 bug：`governance/index-references` 把 `sandbox/`（**被 `.gitignore` 忽略**）当成断链——
   本机存在、CI 干净检出不存在。修法：**被 git 忽略的路径不算断链**（`scripts/gate_governance.mjs`
   的 `ignoredPrefixes()` / `isIgnored()`）。两条都已修并推送（`ac932d1`、`271b6f3`）。
2. **T-816 已交付**（你批准「1+2 都做」）：行级 admission 现在读 profile 自己的
   `compatibility.json`（上游 0.2.x 的精确版本豁免）。有精确豁免 → `blocked` 变 `go`，**保留**
   原有 unmet 理由并加一条 `admission-exempted`（warn）；文件读不懂 → 0 条豁免且**不可改写**。
   新增 `packages/core/src/exemption.ts` + `tests/unit/exemption.test.ts`（6 条），
   语义写进 `docs/04-admission-semantics.md`，授权写进 `audit/SIGNOFF.md`。
3. **T-815 已获你授权，但还没写**（这是下一位的第一件事）：「装包」这条修法要在 profile 里跑
   `pnpm install`。**你已明确同意在 `sandbox/` 的隔离 profile 上真跑，不碰 `~/.dsh`。**
   计划（照 `docs/specs/M7-autofix.md` §5 扩写即可）：

   | 步 | 做什么 | 判据 |
   |---|---|---|
   | 1 | 从 registry 解析一个**声明包含当前 runtime** 的精确版本（用 `packages/signals/src/npm.ts#fetchPackument`，逐字不回写） | 版本必须精确 semver 且其 `engines.dsh`/peer 包含 runtime；否则 `no-compatible-version` |
   | 2 | 只在包**已在 profile `dependencies`** 时写 manifest（备份 + journal） | 不在依赖里 → `unknown-install-shape`，不写 |
   | 3 | `fix --apply --install` 才真跑 `pnpm install`（默认不跑） | 无 `--install` 时只写清单，输出明确说"还没装" |
   | 4 | 装完**用同一引擎重跑** `loadAuditData`，那条 denial 必须消失 | 没消失 → 视为失败并回滚 |
   | 5 | 失败自动回滚（manifest + 备份），journal 记 before/after sha256 | `--undo` 仍能整条回滚 |

   现有可复用的东西：`fix.ts` 的 `planFixes/applyExemptionFixes/undoFix` 与每次运行独立的
   backups/journal；`scripts/record_fix_plan.mjs` 是"一次性 profile 上真跑"的模板，照它加一份
   `record_fix_install.mjs`（隔离 profile 副本 + 真安装 + 重跑判定 + 回滚），产物进 `data/results/`。
4. **两个已知缺口**（写在这里，别当成已完成）：
   - 摘要**没有单列**"靠豁免在跑"的行：`status` 里它们算 `go`，细节只在 `audit --all` 与面板详细视图；
   - `fix` 的 `pin` 分支目前只会报 `no-compatible-version`（没有 registry 解析）。

**下一位交接要点（三句话）**：① **先跑三条命令确认环境**（见 §1），再动 T-815；② **写盘功能必须有
记录器**——备份被覆盖那个 bug 是记录器抓到的，单测 mock 抓不到；③ **改完必须推送并看 CI**：
`gh run list --repo jjjjjjjjnnjnn/dsh-triage --limit 1`，本机 `gh` 已登录，`HTTPS_PROXY=http://127.0.0.1:19828`。

**本轮新增的三条坑（§4 也各有一行）**：YAML 两个键写一行会静默杀死整个 workflow；`.gitignore`
里的路径不能当引用检查；同一秒 `--apply` 两次会覆盖备份（已修）。

**R49 交接要点（三句话）**：① **正门现在是 `dsh-triage` 本身**——无参 = `status`，一屏回答「坏没坏 / 哪一条 / 敲什么」，`audit` 默认也只打摘要，全台账在 `--all`；面板 `serve` 首屏是同一份 summary（`/api/summary`），证据在页签里。② **判据一字未动**：`summary.ts` 是纯投影，`audit --json` 逐字节不变，四桶/`improved`/`admission.ts`/20s 全部原样；改摘要文案只影响人类可读输出。③ **面板第一次真的在浏览器里被打开过**（Edge headless 截图 + CDP 不需要）——CSP 那个 bug 说明「API 冒烟全绿」不等于「页面能用」，以后改面板必须至少跑一次 `msedge --headless --screenshot`。

**R49 提醒（面板安全）**：`docs/SECURITY.md` 写的是**威胁模型**，不是「已安全」的宣告。它明确不防：同机同用户的其它进程（token 在 URL 里，`ps` 可见）、DNS rebinding 之外的浏览器侧攻击、以及 `data/results` 里被人**故意**放进来的内容（我们只保证不越界读、不执行、不解析超大文件）。改面板时三条不许退：`resolveArtifact()` 的 realpath 包含性检查、`connect-src 'self'`、以及「关闭 = 501 而不是空账」。
满足即环境可信。**R48 四项已完成；0.3.0 已发布（R50）。现在只剩「判 D5」。**

1. ~~**HUMAN 动作：`npm publish` 0.3.0（四包）**~~ —— **R50 已关闭**：HUMAN 于 2026-10-30 在自己终端跑 `pnpm -r publish`，四包 0.3.0 上架；`record_publish` 全链 **20/20**（`data/results/publish-2026-10-30T14-40-00.000Z.json`）。README 里「0.3.0 on npm」不再是领先于 registry 的说法，那处唯一已知窗口已关。
   复算（不是待办）：
   ```powershell
   node scripts/record_publish.mjs --version 0.3.0        # --stamp 可省，默认当前时间
   ```
   **别把占位符 `<ISO>` 原样粘进 PowerShell**（`<` 是保留符，会先报 ParserError 再让人以为脚本坏了）。
2. **`T-810` 分发草稿（agent 起草 / HUMAN 发布）**：上游 rc Discussion 回复 ×3、GitHub 真实故障帖诊断 ×3、X 英文 ×1、中文长文 ×1、B站脚本 ×1。每篇只用真机产物（`data/results/upgrade-entry-2026-10-29T15-50-00.000Z.json`、README 首屏那张卡片）与真实案例；**只用项目口吻，不暴露个人身份**。
3. **D5 出口**（`docs/ROADMAP.md` §2）：2 周内 reactions ≥10 · 外部引用 ≥1 · **npm 周下载从 `no-record` 变成 ≥1**。不达标 → 执行 **D**，禁止「再加一个功能试试」。
4. **`M5-a` 上传/聚合仍未开工**：要另开 `ADR-0012`，HUMAN 签字前不许写任何上传代码。
5. **口径不变的三条**：`BS-42`（`improved` 只有降级几何，不许说「升级会修好」）· `BS-43`（`1584` 是 npm 关键词口径，**不许**说全量）· `BS-45`（dist-tag 的拒绝分支只有单测证据；「逐字相同」是时点断言）。
6. **分发侧依旧不在我们手里**：三条 PR 全开（#65 / #193 / #140）、`merged 0`；dsh.so **已提交未收录**。`submitted` / `APPROVED` 都不是收录。
7. **复算命令（不是待办）**：
   ```powershell
   node scripts/record_upgrade_entry.mjs --stamp <新 ISO>
   node scripts/record_upgrade_entry.mjs --stamp <新 ISO> --fixtures data/fixtures/upgrade-entry/<来源 stamp> --artifact data/results/upgrade-entry-<来源 stamp>.json
   node scripts/record_upgrade_card.mjs --stamp <新 ISO>
   node scripts/check_listing.mjs --stamp <新 ISO> --tests <实测测试数>
   ```
   验收：第一条 **26/26**；第二条 **3/3**（离线）；第三条 **14/14**；第四条 **11/11**（含 `readme-shows-real-card`）。

**R48 交接要点（三句话）**：① **四项已交付**：`--to next|latest`（解析值逐字等于 registry，断网零桶）、无参数引导（stderr、exit 2、不猜）、`--card --out`（原子写、拒覆盖、无残留）、README 首屏（真机卡片 + sandbox 标注 + 由产物驱动的数字断言）；② **判据一字未动**，四桶 / `improved` 五门槛 / `admission.ts` / 20s 全部原样；③ **剩下的全是 HUMAN 动作**：`npm publish 0.3.0` + `record_publish`，然后才是 `T-810` 与 D5。
**R45 提醒（文案侧）**：检查器只查机器可查的（版本 / DSH 区间 / 测试数 / 证据路径 / 禁用话术 / 文章登记 / 两条边界）。**语气与"这句话有没有证据支撑"仍是评审工作**。它第一次跑就抓到 `dsh-triage@0.1.0` 残留在三份对外文档里——**发版时要扫文案**，别只改 CHANGELOG。
**R44 提醒（`improved` 口径）**：`--expect-improved` 只断言「四桶非空 + 每个改善单元带两侧证据」，**不**断言方向；`target_relation = older`，产物 `source.composition` 明写这是**策展组合**（6 个真实包，声明原样未改，选谁是我们决定的）。**别**把 `improved` 读成「升级会修好」——那是 `BS-42`。
**R40 提醒（分发侧）**：渠道状态现在 `validated 1 · ready 4 · live 2 · merged 0`（`market-channels-2026-10-29T02-10-00.000Z.json`），dsh.so 的 `blocker` 已清空；**`ready` 不等于提交过**。`@dsh-triage/probe` 这类新 scoped 包发布后会有一段时间 registry 仍回 404（staging + 扫描），`npm publish` 重发会得到「cannot publish over the previously published versions」——那不是失败，是它已经在里面了。
**R38 提醒（分发侧）**：① 仓库已于 2026-10-29 由 HUMAN 决定 **public**；`docs/market/index.json` 的 raw URL 因此可用（`data/results/index-hosting-2026-10-29T22-00-00.000Z.json`），它是**首选**入口（跟着分支走）；gist 那条仍活着，作为仓库再次转 private 时的备份。② `submitted[].state=open` 是**已提交**，`merged` 才是**已收录**。③ 提交 PR 时用**文本插入**而不是 `JSON.stringify` 重排——第一版把上游两处旧格式顺手规范化，diff 从 +12 变成 +16/-4。
**ADR-0008 E 提醒（R26，R29 补一条读数规则）**：替换窗口现在是**`{error}` 专属**。`settled:false` 立即收敛，产物里是 `inventory.replacement_waited=false`——**别**把它读成「探针变快了 20s」就顺手去改 `--unsettled-timeout` 默认值（那仍是 20000，改它需新 ADR）。也**别**把 `isUsableSample()` 一起放宽：它同时被 judge 与断言使用，放宽它等于把「树还在动」判成 `blocked`。**`{error}` 那一侧现在有真机证据了**：`probe-adr0008e-hook-error`（真 hook 写 `projection-missing`，`replacement_waited=true`、`waited_ms=5203`）——但它**不是**一个正常候选样本（`sandbox.hook_config` 非空，用的是诊断开关 `--hook-config`），不许计入通过率。**墙钟是区间不是常数**：R26 三次真跑 `boot` 步 21.7–28.6s（sample 等待本身在 11.5–22.7s 之间波动，`BS-32`），对外只能说区间并指向 `timings.bootSegments`，不要说「一次 probe 30 秒」。**R29 起读字段要连 `replacement_reason` 一起看**：`upgrade` = T-312 的升级等待（可读 provisional），`unreadable` = E 的替换窗口，`null` = 完全没等；R28 的 `probe-t312-*` 与 R29 批次 A 产物里 `replacement_waited=true` 是**修前语义**，不代表 E 失效（`BS-33`）。

**D2 重跑（R29 已跑完，这是复算命令，不是待办）**：R29 用新口径（预算判**第一份**样本，T-312）跑了两批，`boot-budget` 都是 12/12、`gate.passed=true`：

```powershell
node scripts/record_probe_matrix.mjs --plan tests/fixtures/probe/matrix-r19.json --dsh-main sandbox/upstream/0.2.1-rc.4/install/node_modules/@deepseek-ai/dsh/lib/bin.js --install sandbox/upstream/0.2.1-rc.4/install --stamp <新 ISO>
node scripts/d2_report.mjs --matrix data/results/probe-matrix-<新 stamp>.json --stamp <新 ISO>
```

验收：矩阵 n=20 / 真实 13 / 清理 20-20 / 形状 6；`d2_report` 输出里 **`boot-budget` 是否 12/12**、`gate.passed` 是否为 `true`。**`--strict`（R29 起）**直接看退出码：判定失败 exit 1 且产物与 `.sha256` 已落盘；不带 `--strict` 时仍 exit 0，必须读 `gate.passed`。跑之前先 `Get-Process pnpm` 清残留（R23 的坑），并且**不要**在跑矩阵时并行跑测试/构建（R27 的 `real-mcp-connector` 22.5s 可能被自己的并发拖慢过，见 `BS-32`）。

**T-312 提醒（R28）**：`provisional: true` 的样本**不可判**（`settled:false`，只能 `unknown`）；预算判第一份（`timings.bootToSampleMs`），最终样本时刻在 `bootToFinalSampleMs`。**升级窗口必须从样本自报的 `settle_timeout_ms` 推**（+1s），改回固定常数会错过恰好卡在 hook 预算上的最终样本（R28 真踩）。

**R19 提醒**：安装失败**现在有原因**了（`install.diagnosis`），但别把 `ERR_PNPM_IGNORED_BUILDS` 说成「插件坏」——它往往只是 pnpm 的 build-script 审批策略（F35）。`key_line` 的取法有两条硬规则：**launcher 优先于诊断日志**（日志只有 67 字节，没有码），**`dsh:` 开头的行永远不算原因**（那是 launcher 在说它自己）。

**D2 提醒（R19 之后）**：D2 的**通过**只回答「probe 这件事能不能稳定跑」。**产品数字**现在是真实候选 **12/13 = 0.923**，Wilson 95% 只有 **0.667–0.986**，而且是手挑的便利样本——对外必须连区间一起说，不许只说「92% 成功率」。重算命令：`node scripts/d2_report.mjs --matrix data/results/probe-matrix-2026-10-28T11-40-00.000Z.json --stamp <iso>`。
**预算口径（R19 已签）**：`boot-budget` **只判 `real:true`** 的 run；永不 settle 的夹具结构上 ≈21s，单列在 `timing.fixtures_over_budget`。真实候选仍是 **100%** 必须 ≤20s（没有放宽成 90%）。别把它读成「预算不重要了」（`BS-28` / T-311）。

**端口提醒（R17 的教训）**：`buildProbePlan` 的哈希端口只是**偏好**；本机 `netsh int ipv4 show excludedportrange protocol=tcp` 排除 **53461–53560** 且会中途变化。现在 CLI 与 `record_probe` 都会先 `findFreePort()`，产物记 `sandbox.port_origin`。**不要**把端口写死回常量。

**想继续从开源里借**：`docs/09-open-source-borrowing.md` 先看，再动 T-113（attw 矩阵，前置是沙箱实测 loader 解析模式）。**借机制不抄代码**，真抄要先进 `quarantine/` + `vendor-manifest`。

先按 `.agents/prompts/task-packet.md` 列允许改动的文件，再动手。

**新会话开箱状态（R31 收尾）**：`git log -1` 就是交接提交，`git status` 干净；**296 测试 / 9 门 / `--mutate` 9-9**；`data/results` 的每份产物都被步台账引用；新会话**不许**为了「让门变绿」改阈值或删产物。四条最容易踩的禁令：① 不得读 `~/.dsh/credentials`、不得向沙盒注入真实凭据（铁律 4，T-202a 要先出 ADR）；② 判据/阈值改动必须 spec + HUMAN-SIGN（`audit/SIGNOFF.md` 记账，R19 的预算口径就是范例）；③ 沙盒目录名一律 basename slug —— 别再让绝对路径进产物（F-2 / R16 面板 smoke 又踩过）；④ 外部候选只能 pin 版本 + 临时沙盒执行，不 vendor（`docs/adr/0004`）；**许可只认元数据能证明的**（`SEE LICENSE IN LICENSE` 这种直接跳过，R19 真放弃过一个候选）。**R22 追加一条**：`--copy-profile` 只搬四个声明文件，**永远不要**顺手复制 `node_modules` / `.plugin-manager` / `.npmrc`（最后一个是凭据）。**R26 追加一条**：改 `packages/probe/src/host.ts` 后**先 `pnpm build`** 再跑 `record_probe`（它 import `dist/`），否则你测的是旧循环。

> D1 已于 R6 通过（9/10）；M2-a P2 于 R7 交付；R8 补副本来源与重复副本；R9 让「没声明」不再静默；R10 让 dist-tag 失步可见；R12 让相位来自真机（`data/results/inventory-live-2026-10-27T22-00-00.000Z.json`）并补齐 preset 维度。
> 复核口径十一条命令：`node scripts/d1_report.mjs --stamp <iso>`、`node scripts/render_inventory.mjs --snapshot data/fixtures/inventory/desktop-web-2026-10-26.json --dsh-home tests/fixtures/env/home --profile desktop --stamp <iso>`、`node scripts/record_live_inventory.mjs --dsh-home <sandbox>/home --profile upstream --install <sandbox>/install --stamp <iso>`、`node scripts/record_audit.mjs --dsh-home <sandbox> --profile desktop --stamp <iso>`、`node scripts/probe_live_sample.mjs --dsh-home <sandbox>/home --profile upstream --install <sandbox>/install --stamp <iso>`、`node scripts/record_registry.mjs --stamp <iso>`、`node scripts/record_probe.mjs --candidate tests/fixtures/probe/ok-plugin --dsh-main <sandbox>/install/node_modules/@deepseek-ai/dsh/lib/bin.js --install <sandbox>/install --label ok --expect go --browser <chrome> --stamp <iso>`（R17 另加 `--readiness-timeout <ms>` / `--unsettled-timeout <ms>`；R22 另加 `--copy-profile <name>` + `--dsh-home <home>`；**R26 另加 `--hook-config <json>`（诊断开关：产物记 `sandbox.hook_config`，该产物不得计入通过率）**）、`node scripts/record_render_fixture.mjs --mode blank --expect blank --stamp <iso>`（另三种：`rendered` / `error` / `blocked`）、`node scripts/record_probe_matrix.mjs --plan tests/fixtures/probe/matrix-r17.json --dsh-main <sandbox>/install/node_modules/@deepseek-ai/dsh/lib/bin.js --install <sandbox>/install --stamp <iso>`、`node scripts/record_serve_smoke.mjs --stamp <iso>`、**`node scripts/audit_credential_sources.mjs --dsh-main <sandbox>/install/node_modules/@deepseek-ai/dsh/lib/bin.js --stamp <iso>`（R23，离线，30 次 launcher 运行）**、**`node scripts/record_probe_matrix.mjs --plan tests/fixtures/probe/matrix-r19.json --dsh-main <sandbox>/install/node_modules/@deepseek-ai/dsh/lib/bin.js --install <sandbox>/install --stamp <iso>`**（R37 另加 `--load <n>`：起 n 个 CPU-busy worker 跑满整批并把 `load.observed_busy_percent` 写进产物；有载批**不能**与 build/test 并行）、**`node scripts/stability_report.mjs --matrix <A> --matrix <B> --stamp <iso>`**（R37 起按 `conditions[]` 分 idle/有载，并单列 `runs_without_artifact`）。**`node scripts/record_client_serve.mjs --dsh-main <sandbox>/install/node_modules/@deepseek-ai/dsh/lib/bin.js --install <sandbox>/install --stamp <iso>`（R31：真机六步 bundle/install/boot/graph/client/mount/cleanup；有浏览器时走 CDP 读 `window.__dshTriage`，无浏览器则 `mount=unmeasured`）**，**R51 起多三种用法**：`--extra-bundle tests/fixtures/client/breaking-plugin`（把一条被拒行放进 profile）、`--fixture-range ">=0.2.0" --break-after-install ">=9.0.0"`（装完之后才变坏）、`--lang en`（英文屏）；默认还会真点一次复制按钮并读回剪贴板，`method` 字段说明是真鼠标还是回落 `dom-click`**、**`node scripts/record_agent_tool.mjs --dsh-main <sandbox>/install/node_modules/@deepseek-ai/dsh/lib/bin.js --stamp <iso>`（R36：一次性 DSH home（`file:` 装四个 workspace 包）→ boot → 读 `tools.schemas()` → 调 `compat_verdict` 三次（`--call-go` / `--call-blocked` / `--absent` 可覆盖）→ 十一项断言）**。
> **对外口径（别再说过头）**：真机相位样本来自**仓内沙盒**（0.2.1-rc.4），不是用户的 `~/.dsh`（本机真实 profile 是 0.1.0-rc.6，没有 `pluginInventory`）。可以说「在一台真起的 0.2.1-rc.4 Host 上实测」，不能说「在用户机器上实测」。真机样本里没有 `failed` / `broken preset` / `conditional` 行——这三档只有夹具覆盖。R17 的 probe 真机样本全部来自这台 Windows 机器；Linux 只跑过渲染对照（CI `render-control`），**没跑过真 probe**。

> 每一步做完，先追加 `audit/step_reviews.json`（四轴 + 对抗性 + real_test 产物 sha256），再跑 `node scripts/gate_step_review.mjs`。漏了它，`pnpm run verify` 会红。


---

## 4. 坑（真实踩过的，别再踩）

| 症状 | 原因 | 处置 |
|---|---|---|
| `node --test` 找不到模块 | 没 `pnpm build`（包导出指向 `dist/`） | 先构建再测 |
| 标准 profile 报 27 条「entry id 冲突」 | 把「纯覆写」当撞车 | 已修，见 `docs/adr/0002`；别回退该判定 |
| `yaml` 把 `!!js` 当错误 | 未用 `parseDocument` + `doc.errors` | 已修（`core/ledger.ts`） |
| 提交标题带 `` | PowerShell 5.1 `Out-File -Encoding utf8` 写 BOM | 用 `git commit -m`，别用 `-F` 接 BOM 文件 |
| 门禁「全绿」但什么都没查 | 没跑 `--mutate` | 每轮必跑（CI 也跑） |
| CI 报找不到 `scripts/lib/kit.mjs` | `.gitignore` 的 `lib/` 匹配任意层级 | 已改 `**/dist/` + `packages/*/lib/` |
| `probe` 测试在 Linux 全红 | 硬编码 `C:/Temp`，POSIX 下非绝对路径 | 用 `tmpdir()` + `join()` |
| 误以为 `gate.mjs --mutate` 要 exit 1 | 单门才 exit 1；套件全 CAUGHT 才 exit 0 | 认最后一行 `NEGATIVE CONTROL PASSED` |
| SSOT 里出现 `C:\Users\<名>` | 只脱敏了 `env.profileDir`，漏了 `evidence[].source` | 已修 `redactVerdict` + `results-privacy` 门 |
| `npm` 命令刷 `Unknown project config` | `.npmrc` 放了 pnpm 专属键 | 已迁到 `pnpm-workspace.yaml` |
| Windows 上 `spawn('npm')` 报 EINVAL | 不能直接 spawn `.cmd` | 走 `ComSpec /c`（见 `gate_release_pack.mjs`） |
| 预检查说「你的 token 401，去 `npm login`」，但你 `npm whoami` 明明能打印用户名 | 检查**从没跑起来**：Windows 上 `execFileSync('npm')` 是 `spawnSync npm ENOENT`（Node 的 CVE-2024-27980 缓解，不解析 `.cmd`），老代码把**任何**失败都硬编码成 401。R50 实测：真跑一次 `node -e "execFileSync('npm',['whoami'])"` 看 `code`，别猜 | 三态：真 `E401`/`ENEEDAUTH` 才是没登录，其余一律 `check-could-not-run` 并原样引用观测行（`scripts/lib/npm-auth.mjs`）。**凡是「检查失败」都不许写成「结论失败」** |
| `node scripts/xxx.mjs --stamp <ISO>` 在 PowerShell 里先报 `"<"运算符是为将来使用而保留的` | 把占位符原样粘进了命令；`<`/`>` 是 PowerShell 保留符，`node` 根本没被执行 | 真要给 stamp 就写具体值（`2026-10-30T14:40:00.000Z`）；`record_publish` / `check_listing` 等脚本的 `--stamp` **可省略**，默认当前时间 |
| 以为「只判 bundle 就够了」，结果 `why` 说 no denials 而用户的工具确实没了 | 上游按 **row 的模块** 判 admission，`cordis.patch.yml` 里挂的行逃过 bundle 级检查 | 已修行级归因（CASE-11080）；新增行必须走 `rowTargets`/`resolveRows`，别绕过 |
| 从 GitHub 找不到上游 issue | `deepseek-ai/deepseek-harness` 的 `has_issues=false`，只有 Discussions | 抓 `https://github.com/<repo>/discussions`（HTML 可读）；GraphQL 需 token |
| 案例 JSON 一读就 `JSON.parse` 失败 | PowerShell `Set-Content -Encoding utf8` 写 **BOM** | 用 Node 写/读；或先剥 `\uFEFF` |
| 全新 clone 后 input sha256 对不上 | `core.autocrlf=true` 把 LF 变 CRLF | `data/cases/** eol=lf`（已在 `.gitattributes`） |
| 想用「贴 stdout」当一步的证据 | 门 `step-review` 只认 `data/results/` 里可重算 sha256 的产物 | `node scripts/gate.mjs --record --stamp <iso>` 把门禁结果本身也写成产物 |
| 重跑脚本后产物 sha256 变了、门 `step-review` 红 | 把**文件名用的**时间戳（`2026-10-26T00-00-00.000Z`）当 `--stamp` 传了；`Date.parse` 宽松接受它 | 已加校验：`--stamp` 必须是 ISO-8601（`2026-10-26T00:00:00.000Z`），否则 exit 2。**R40 又撞了两次**（`03:40` 是 R34 的时刻、`05:00` 是 R28 的时刻，两次都把已引用的产物覆盖掉）→ 现在 `gate.mjs --record` 在目标文件已存在时**拒绝写入并 exit 2**，e2e 测试 `tests/e2e/gate-record-collision.test.ts` 用真 CLI 钉住这条 |
| 用 PowerShell 改 `.mjs` 脚本，跑起来报语法错 / 门禁读到怪字符 | `Set-Content -Encoding utf8` 在 PS 5.1 下写 **BOM**（R6 实际踩到 `scripts/d1_report.mjs`） | 改代码只用编辑器/Node：`node -e "…writeFileSync(p, t.replace(/^\uFEFF/,''),'utf8')"`；提交前看首字节是否是 `EF BB BF` |
| 新脚本按传参目录跑，报 `ENOENT ...\<repo>\C:\Users\…` | `scripts/lib/kit.mjs` 的 `abs()` 是 **repo-root 相对**，直接把绝对路径塞进去会被拼接 | 传参路径先判 `isAbsolute()` 再决定是否 `abs()`（见 `scripts/d1_report.mjs` 的 `pathFor`） |
| `npm view`/registry 拿某个具体版本的 manifest 返回 **406** | 只发 `Accept: application/vnd.npm.install-v1+json` 时，版本端点不支持 | 具体版本用 `Accept: application/json`；packument 才用 install-v1 |
| 新写了一条 `reason`，`verdict-contract` 门报 “messageId must be a catalogue id” | 门里 `MESSAGE_ID` 是**白名单正则**（`admission|collision|runtime|remediation|missing`），新命名空间要同时改门 + `docs/05-verdict-contract.md` | 新增命名空间时三处同改：`messages.ts` 文案、`gate_verdict_contract.mjs` 正则、`docs/05` §契约表；这不是放宽阈值，是对齐已锁 spec |
| 给 `for (const [a, b] of [...])` 漏了 `]`，Node 只报 “Unexpected token 'of'” | 解构语法；报错位置指向 `of` 容易误导 | 写完 pair 循环先跑 `node --check <file>`（或直接跑一次 `tsc -b`） |
| PowerShell 里写 `node -e "…中文/单引号/正则…"` 反复报 ParserError | PS 5.1 会先解析一遍单引号与转义，中文和 `'` 很容易被吃掉 | 一次性脚本写成临时 `.mjs`（`%TEMP%\opencode\*.mjs`）再 `node` 执行；R8 两次踩到 |
| `findDuplicateCopies` 扫出 0 条，明明有两份 | 把 `env.profileDir`（profile 目录）当成了 `node_modules` 传进扫描器 | 扫描器的根必须是 `<profile>/node_modules` 与 `<dshHome>/profiles/node_modules`；R8 的单测抓到了 e2e 没抓到的这处 |
| 门「全绿」但文案里的 `{占位符}` 会原样打到用户脸上 | 只校验 messageId 存在，不校验 `params` 是否提供占位符 | R9 起门 `verdict-contract` 有 `placeholder-params-required`（缺 key / `null` / 空串都算缺）；新增文案后先跑一次单门 |
| `dsh --dump-config` 在 PowerShell 里「看起来 exit 1」 | `\| Select-Object -First N` 提前关管道，`cmd` 侧报 broken pipe | 判定 exit code 要么整段收完，要么用脚本 `spawnSync`（`probe_live_sample.mjs` 就是这么记的） |
| 沙盒 0.2.x「能 compose 不能 mount」 | `%TEMP%\dsh-triage-env\<ver>\home\profiles\<p>` 只有 `package.json`，没有 `node_modules` | 相位采样前置：先给沙盒 profile 装依赖；`pluginInventory` 只以 typert Remote 暴露，不能同进程直读 |
| 以为 `pluginInventory` 可以像普通 Cordis 服务那样 `ctx.get()` | 上游实现是 Remote-only，明确不声明同进程 merge | P1 要么在 Host 内走 loader 投影，要么走 Remote 客户端；README 原文见 `dsh-host-plugin-inventory` |
| 兼容通道把作者标注的「不兼容」读成「兼容」 | `dshReleases` 的键被手写成 `v0.1.7-alpha.2`，与运行时串按字节比较失败，退化到更宽的 `dsh: "*"` | 比较前归一化（去空白 / 去 `v`,`=` 前缀 / 过 `semver.valid`）；R9 复核抓到，已修并加单测 |
| 门「全绿」但 `--mutate` 的某一类注入根本没落地 | 注入目标（含占位符的 reason）在产物里不存在时被静默跳过 | R9 起：注入失败即判红，并加常态断言 `placeholder-copy-present`（产物必须真的用到含占位符的文案） |
| 「latest 落后」判断反了 | 用了 `semver.rcompare(a,b) > 0`，但 `rcompare` 的语义是**反向**（a 比 b 旧时才 > 0），于是「更新的版本」被判成最新 | 正向比较一律用 `compare(a,b) > 0`，降序排序用 `rsort`；单测 8 条当场抓到（`tests/unit/version-drift.test.ts`） |
| 用 PowerShell 改 `.ts`/`.mjs` 后文件头变成 `EF BB BF` | `Set-Content -Encoding utf8` 在 PS 5.1 写 BOM（R9/R10 各踩一次） | 改代码只用编辑器；批量替换后跑 `node -e` 检查首字节并剥 BOM，或直接写成临时 `.mjs` 执行 |
| 沙盒放 `%TEMP%` 被清理，或 profile 没依赖导致「能 compose 不能 mount」 | 沙盒默认位置在临时目录；profile 依赖要单独装 | R11 起沙盒固定在 `<repo>/sandbox/`（git 忽略），并用 `bootstrap_upstream.mjs --with-profile-deps` 一次装齐 |
| 探 HTTP 时「带 token 也 401」 | 带 token 的首个响应是 **303 + Set-Cookie**，Node `fetch` 不保存 cookie，跟随重定向后就 401 | 探活要 `redirect: 'manual'`，把 303 当「服务活着」；无 token 的 401 是另一个证据 |
| `child.kill()` 之后 Host 还在监听 3080 | Windows 上 `dsh web` 会带子进程，单杀父进程不够 | `taskkill /pid <pid> /T /F`，并以「端口不再应答」作为停止判据（别信 `exitCode`） |
| `dsh web --patch x.yml` 报 `error: unknown option '--patch'` | launcher flag 必须写在 profile 名**之前**：`dsh <name> ...` 会把后面的都当 app 参数透传（`passThroughOptions`） | 用 `dsh --profile upstream --patch <overlay>`（R12 实际踩到） |
| 一个 bundle 的行在 `audit` 里**整层消失**，且没有任何报错 | `package.json#dsh.bundle.patch` 允许**字符串或数组**；只读了字符串分支，`dsh-web-app`（数组形态，含 4 个 `presets/*.yml`）被静默跳过 | `readBundlePatchPaths` 支持两种形态；`declaresBundlePatch` 让畸形值变成错误而不是空层（R12 修，`undeclared` 195→4） |
| 声明行 `tool-bash` 与运行时 `include:tool-bash` 对不上，健康 Host 报几十条「缺失/未声明」 | loader 把 profile 的 `cordis.yml` 包在 `include` group 里，**运行时 id 带 group 前缀** | `indexRuntimeIds`/`resolveRuntimeId`：精确优先 → 唯一后缀匹配 → 多候选出 `runtime.ambiguous-entry`（R12 修，`missing` 96→0），别改成「按后缀粗暴匹配」 |
| 产物里出现 `C:/Users/<名>/...`，`results-privacy` 却没红 | 探针行的模块名被 loader 解析成 `file:///` URL 且**百分号编码**；只替换反斜杠路径的脱敏看不见它 | 脱敏先 `decodeURIComponent` 再同时替换 `\` 与 `/` 变体（`scripts/record_live_inventory.mjs`） |
| `gate_ssot` 报 hash 不匹配，肉眼看 `.sha256` 一模一样 | `.sha256` 文件必须是**纯 hash**：门拿整文件内容与 `sha256(text)` 比较，尾巴带文件名就红 | 只写 `${hash}\n` |
| 改了 `messages.ts` 的 `{占位符}` 之后，`data/results` 里老产物让门红 | `verdict-contract` 会用**当前** catalog 校验历史产物 | 用产出脚本按**同一 stamp** 重放该产物，并把新 sha256 同步进 `audit/step_reviews.json`（R12 对 R7 合成样本做过一次，附原因） |
| 以为 preset 行的 `fiberPhase: null` 和主列表一样是「声明了没加载」 | 上游文档：preset 行的相位是「组合活着时的 root fiber 相位；否则 null」，`null` 也覆盖「没有会话组合过它」 | 主列表照旧 `blocked`，preset 行判 `unknown`/`runtime.preset-no-fiber`（`docs/specs/M2-inventory.md` §3.1） |
| 自己的插件装上了却什么都没挂载，日志只有一行 `patch: entry "x" not found` | bundle 的 `cordis.patch.yml` 用了 `- id: x` 形态——那是**修改**已有 entry，不是插入；上游对未知目标口头警告后跳过（schema `includePatch` 原文） | 必须 `- insert:`；门 `namespace` 的 `rows-are-inserted` 已把这条钉死（R14 实测发现，我们自己也踩了） |
| probe 明明起了服务，HTTP 检查却全 `fetch failed` | 采样后立刻 `taskkill`，端口已经没了；就绪探测打在死端口上 | 就绪探测必须在杀树**之前**（`host.ts`：采样 → settle → 探测重试 → 杀树），R14 真机抓到 |
| probe 一跑就把用户浏览器弹出来 | Host 默认 `open` 浏览器，探针是后台进程 | app 参数加 `--no-open`；`--port` 也是 app 参数（launcher flag 与 app 参数位置别混） |
| 以为 CI 里没有浏览器，渲染断言只能 `unmeasured` | **前提错了**：GitHub ubuntu-latest 预装 Chrome/Chromium/Edge + xvfb（runner 镜像清单实测） | `ADR-0005`；CI 新增 `render-control` 作业跑三份对照，缺浏览器时**明确失败**而不是静默降级 |
| `dsh --profile <p> web --port N` 报 `too many arguments` | app 名不能当参数再给一次；profile 自己决定 app | 直接 `dsh --profile <p> --port N --no-open`，端口透传给 app |
| 以为 `chrome --headless --dump-dom URL` 能拿 DOM，结果 0 字节 + 挂满 60s | 本机 Chrome 154 / Edge 146 上 `--dump-dom` 与 `--screenshot` 都失效（不是参数写错） | 走 CDP：`--remote-debugging-port=0` + `<profile>/DevToolsActivePort` + `Runtime.evaluate`；Node 22 内置 `WebSocket` 就够（`packages/probe/src/render.ts`） |
| `mkdtempSync(join(root,'x-'))` 报 ENOENT | 父目录不存在时 mkdtemp 不会替你建 | 先 `mkdirSync(root,{recursive:true})`（render.ts 踩过） |
| 把 `NPM_CONFIG_REGISTRY` 指向死地址，安装却成功 | pnpm store 命中：装成功 ≠ 走网络，lockfile 甚至逐字节一致 | 判「网络形状」不能只看 exit code；R15 的 F18/F19 就是这一枪（`probe-registry-unreachable-*.json`） |
| 以为 `--registry`/env 覆盖能测私有源 | launcher 会把环境变量中和，pnpm 用自己的源 | 私有源形状要走 profile 级配置（T-305b） |
| `scripts/lib/live.mjs` 报 `ERR_MODULE_NOT_FOUND .../src/render.js` | 它直接 import `host.ts`，而 `host.ts` 新加的 `./render.js` 不会被类型剥离重写成 `.ts` | live.mjs 改为 re-export **构建产物** `packages/probe/dist/host.js`；跑 live 脚本前先 `pnpm build` |
| PowerShell 里 `node -e "…中文/反引号…"` 直接语法错 | 反引号在 PS 里是转义符，会先被吃掉 | 一次性脚本写成 `%TEMP%\opencode\*.mjs` 再 `node` 执行（R15 又踩一次） |
| 探针报「Host 起不来 / 超时 / 端口无应答」，候选看起来没问题 | **先查端口有没有落在 OS 排除段**：本机 `netsh int ipv4 show excludedportrange protocol=tcp` = 53461–53560，plan 的哈希选中 53506，Host 的 `webserver` 行 `listen EACCES` → 整棵树 `startup failed`（R17 真踩，正常候选被写成 blocked） | 端口每次都 `findFreePort()`；产物看 `sandbox.port_origin` 与 `boot.bind_failed_ports`；`probe.port-unavailable` = 探针环境问题，不是插件 |
| 同一个候选一会儿 `go` 一会儿 `blocked` | Windows 的端口排除段**会话中途会变**（R17：15:05 能起、15:20 起不来） | 别把「上次能跑」当成本次能跑；每次看产物里的端口与 `port_origin` |
| hook 报 `cannot get required service "loader" in inactive context`，以为是「树慢」 | 其实是**我们自己的 fiber 被 unload**（Cordis 把 `fiber.store` 置空），服务回来后它会**重跑 apply** | 别在同一个 dead ctx 里重试；靠代际保护 + 等一份可判样本（R17 的 `isUsableSample`） |
| 改了 `packages/probe/src/host.ts`，跑 `record_probe` 却没变化 | `record_probe` 与 `live.mjs` 都 import `packages/probe/dist/`（构建产物） | 先 `pnpm build` 再真跑（R17 踩了一次） |
| 产物里 `boot.url_printed/first_line/error_tail` 全是空 | boot 步骤在 `sample === null` 时**提前 return**，赋值写在 return 之后 | 新字段一律在 early return **之前**赋值（R17 踩了一次，单测没覆盖到） |
| 想看 launcher 为什么起不来，产物里却只有第一行 | 启动诊断打在 **stdout**，而 `error_tail` 只取了 stderr | 两流拼接后再截断，并对 `?token=` 脱敏（R17 已修） |
| `Set-Content -Encoding utf8` 给夹具写的 `package.json` 带 BOM，launcher 解析怪 | PS 5.1 的 utf8 一律带 BOM | 写夹具后用 Node 重写并 `replace(/^\uFEFF/,'')`（R17 的 slow-plugin 踩过） |
| 想让行慢一点，就在 `apply` 里 `await sleep()` | **没用**：Cordis 进入 `apply` 就把行标成 `active`（R18 实测 `wait_ms` 3.3s、行立刻 active），这种夹具证明不了 settle 路径 | 要造 `loading` 必须让**模块导入**慢：顶层 `await`（R18 的 `slow-plugin` / `slow-overrun-plugin`） |
| 把 D2 的「成功率」写成点估计 | 9/10 很容易被读成「90% 稳了」，但 n=10 的 Wilson 区间是 0.596–0.982（R19 的 13 个是 0.667–0.986） | 用 `scripts/d2_report.mjs`：它把区间、分母检查、清理、计时一起算，并在真实启动 <10 时**拒绝判定** |
| 以为「诊断日志里肯定有真正的错误」 | launcher 只在日志里写一行 `Command failed with exit code 1: pnpm add …`（**67 字节**）；`ERR_PNPM_*` 与解释只在 **stderr** | 归因顺序：launcher 输出优先、日志兜底，产物记 `diagnosis.source`（R19 F34）。只有错误码的行不算解释——继续往下找第一条 `label: detail` |
| 归因抓到了 `dsh: plugin command failed; diagnostics: …` | 那是 launcher 在说**它自己**，不是包管理器的原因 | 前向扫描跳过 `^dsh:` 与 `help:/hint:` 行（R19 实测 `synthetic-missing` 就踩了） |
| 成功安装的产物里出现「诊断」 | `runInstall` 以前对 `exit 0` 也算 `key_line`，于是本地夹具写着 `Already up to date`，看起来像失败 | `exit 0` 时 diagnosis 恒为 `{null,null,'none'}`（R19） |
| `ERR_PNPM_IGNORED_BUILDS` 被当成「插件坏」 | 它是 pnpm 11 的 build-script 审批策略：包**装上了**，只是构建脚本没跑（stdout 同时有 `+ pkg@ver`） | `probe.install-build-refused` + 专用 remediation；别把包管理器策略说成插件缺陷（R19 F35） |
| D2 的 `boot-budget` 被一个「永不 settle」的夹具判红 | 20s 预算与 20s 未稳定窗口**结构重叠**：`boot(≈5s)+settle 上限 15s ≈ 21s`，永远进不了 20s（R18 的 19.1s 是运气） | 预算只判 `real:true`；夹具耗时单列 `timing.fixtures_over_budget`（HUMAN 签，R19）；改默认窗口需 ADR（T-311） |
| 沙盒「清了环境变量」就以为没有凭据了 | pnpm 自己会读 `~/.npmrc`：装不上的候选会打印 `An authorization header was used: Bearer npm_[hidden]`，把**操作者的 token** 发给 registry（R20 实测 2/2） | `runInstall` 走 `sandboxNpmEnv()`，把 `npm_config_userconfig` 指向沙盒内空文件；产物 `install.registry_auth_used` 必须为 `false`。**别去读那个 npmrc**（铁律 4），只停止继承 |
| 以为「组合装成功了 = 组合可用」 | `{"x":"link:./not-here"}` 的 `plugin install` **exit 0** 并打印 `+ x <- not-here`，目标根本不存在（R20 F40） | T-304 已实现：`link:`/`file:` 逐个 stat，悬空 → `unknown` + `probe.profile-link-dangling`。**别**改成「看退出码就够了」 |
| 复制真实组合后 `plugin install` 一直 exit 1，被拒的是 `node-pty`/`koffi` 这类**组合自己的**包 | pnpm 的构建审批策略（R19 F35 同一形状）；模板路径里 pnpm 只报候选，所以以前没见过（R22 F41） | 沙盒 `pnpm-workspace.yaml` 写 `strictDepBuilds: false`（F43）：exit 0 且注册 bundle，但**不批准任何构建**；被跳过的包进 `install.ignored_packages`。`.npmrc` 里同名设置**无效** |
| 「ADR 已经签了」就顺手把默认值也改掉 | ADR-0008 的方案 E **授权的是做法**（`settled:false` 不再等替换），**不是**「改 `--unsettled-timeout` 的默认值」。两者是两件事 | **R26 已实施做法、默认值仍 20000**；改默认值是另一道签（方案 A），未授权 |
| 把 `provisional: true` 的样本当成可判样本 | 它是 hook 的**第一份**读数，`settled` 恒为 `false`；`measurementState` 据此判 `unsettled` → 只能 `unknown` | 想让它出 `go`/`blocked` 只有一条路：等最终样本（`inventory.upgraded=true`）。**别**在 `judgeProbe` 里为 provisional 开特例 |
| 以为「T-312 让 probe 变快了」 | 墙钟反而从 ≈28.6s 升到 ≈30.4s（多等最终样本） | 预算判的是**第一份样本**（`timings.bootToSampleMs`）；最终样本时刻在 `bootToFinalSampleMs`。对外只能说「答案更早」，不能说「更快」 |
| 升级窗口取固定值，结果恰好错过最终样本 | R28 第一版用固定 15s，`slow-overrun` 的最终样本 15.25s 才写完 → `upgraded` 误记 `false`（结论不变，但产物说谎） | 窗口 = 样本自报的 `settle_timeout_ms` + 1s；hook 版本换了就自动跟着变。**别**改回常数 |
| 把 `settled:false` 与 `{error}` 当成同一种「不可判」去删等待 | 两者的恢复机制不同（R17：`{error}` 是 dead context 被新 apply 取代；`settled:false` 是 hook 自己读完了但树还在动） | **R26 已按 `ADR-0008` E 落地**：`replacedEnough` 只在样本**不可读**时参与；`settled:false` 立即收敛。**别**顺手把 `isUsableSample()` 也放宽（那会把「树还在动」判成 `blocked`），也**别**把 `--unsettled-timeout` 默认值改掉 |
| 说「E 让 probe 变快了 20 秒」 | E 只删掉**本来就没买到任何东西**的那一段（29 份产物 `replacements_observed=0`）；同类夹具的 sample 等待本身在 11.5–22.7s 之间波动（`BS-32`），看起来就像「有时没变快」 | 引用时给区间与前后对照：同夹具 `boot` 步 48.4s（R23）→ 28.6s（R26），差额是被删掉的替换窗口；证据看 `timings.bootSegments` 与 `inventory.replacement_waited` |
| 用 pnpm 的 `An authorization header was used` 判断有没有凭据外发 | **这句话不是总会出现**：R23 实测「合成 token + 真实 userconfig」不打印它，靠日志会把一条活着的凭据来源判成「没问题」 | 用本地假 registry 记请求头（`scripts/audit_credential_sources.mjs`）；而且必须**异步 spawn**，`spawnSync` 会阻塞事件循环让同进程的假 registry 永远答不了（真踩三次 90s） |
| 跑完一次审计后下一轮 install 全挂 / 挂 90s | 上一轮被 kill 的 `pnpm add` 还活着，占着 store 锁（R23 实际遇到 `pnpm.exe` 残留进程） | 先 `Get-Process pnpm` 清残留再重跑；审计脚本自身用 `SIGKILL` + 超时兜底 |
| 以为「某来源没泄漏 = 是我们挡住了」 | 可能是那个旋钮**根本没被读**（R23：`globalconfig` / `XDG_CONFIG_HOME/pnpm/rc` / `PNPM_HOME` / `COREPACK_HOME` 都没被读） | 审计要分 `knob_honored`（源自己带 `registry=` 时有没有流量）与 `leaks_today` 两列，别把两件事混成一件 |
| 以为「boot 步的差额是 settle 15s」 | 分段实测（R23）：正常候选的差额是 **render 4.7s + 杀树 2.2–2.7s + 杀后 1.2s**；不可判的 48.4s 里主导项是**替换等待 20.3s**，而 hook 的 `wait_ms` 已含在 sample 里 | 看 `timings.bootSegments`；新增 await 必须加段，段之和要与 `steps[boot].ms` 对齐（≤100ms） |
| 复制组合后 boot 成功、HTTP 200，却报「候选零行」 | `plugin add` 在 pnpm **非 0** 退出时只写 `dependencies`，**不写 `dsh.profile.bundles`**（R22 F42）——「继续跑」会把包管理器策略算成插件缺陷 | 现在读回 `dsh.profile.bundles`：候选已注册 → 可 `go`（带 warn）；未注册 → `unknown` + `missing.probe`。**别**把 `row-missing` 留给这条路径 |
| 复制模式 `go` 被当成「在我机器上验证过」 | 沙盒**从不运行**组合依赖的构建脚本（`BS-30`）；副本也只搬四个声明文件（`BS-31`） | 对外口径：「声明层一致、依赖装齐、原生模块未构建」；链接/私有源场景只能是 `unknown` |
| 用 `--profile` 默认值覆盖了复制源的名字 | `Flags.profile` 默认 `web` 会让 `--copy-profile upstream` 被静默改名（R22） | CLI 用 `profileExplicit` 区分「显式给」与「默认值」；`record_probe` 同理 |
| 面板「感觉有点慢」却说不出哪里慢 | `/api/audit` 是同步扫描：本机 156 行 profile 实测 **376–690ms**，期间阻塞事件循环 | 响应头 `x-triage-audit-ms` 自带耗时（R20）；别把它做成轮询接口 |
| INDEX 里写一个新路由/裸文件名，`governance` 报 `index-references` 红 | 门把表格行里**任何**含 `/` 或以 `.json` 结尾的反引号 token 当路径 | 路由别用反引号写成 `/api/x` 形态，产物一律写全 `data/results/xxx.json`（R18 踩过 `go/(go+blocked)`，R19 又踩两次） |
| 失败形状数看起来很好（9 种） | 把 info 级原因（`probe.render-ok`、`probe.served`）也算成了形状 | 只数 `block` / `warn`（R18 已修在脚本里） |
| 看到 `replacement_waited=true` 就以为「E 失效了、替换窗口又回来了」 | **R28 起这个字段把 T-312 的升级等待也算在里面**（可读的 provisional 也会让循环再睡 250ms）；第一批矩阵 20/20 都是 `true` 且 `waited_ms == upgrade_waited_ms` | R29 已修（`BS-33`）：看 `replacement_reason`——`upgrade` = 升级等待、`unreadable` = E 的替换窗口、`null` = 没等。**R28 的 `probe-t312-*` 与 R29 批次 A 是修前语义**，不许拿它们判 E |
| 两批矩阵都 `boot-budget` 12/12，就写「probe 稳定了」 | 同一条 `dsh-mcp-connector@0.2.83` 在 R27 是 22.5s、R28 两次 `unknown`、R29 是 8.0s / 5.5s；两批整体快慢也不同（4.6–9.8s vs 4.0–5.5s，与并发负载/store 冷热有关） | 只说「这两批没踩线」并给区间（`BS-32`）；跑矩阵时**不要**并行跑测试/构建，数字才可比 |
| `d2_report` 命令成功（exit 0）= D2 通过 | 默认模式**判定失败也 exit 0**（R18 决定：失败也是数据） | 读产物 `gate.passed`；要退出码就用 `--strict`（R29/T-317，产物先落盘再 exit 1） |
| 想给浏览器半边写单测，就先上一个打包器/加个 `export` | `client.js` 是 Host 直接当 **classic script** 执行的（必须自己调 `window.__ModuleLoader__.load`），加 `export` 会让浏览器直接 SyntaxError；加打包器则多一层可能与契约漂移的构建 | 用 `node:vm` 跑**真实文件**：假 `window.__ModuleLoader__` 收集 factory、假 `require` 给 `react`/`react/jsx-runtime`、假 `ctx` 断言「不匹配 = 零注册」（`tests/unit/client-tab.test.ts`）。**别**为了可测试而改文件形态 |
| 以为 `nodeLinker: hoisted` 写进复制源就等于「pnpm 真切了」 | 共享 store / pnpm 版本都可能让配置不生效；R26 只是证明「这种形状不会把候选判丢」 | R30 起看 `install.node_layout`：`linker` 是**观测**，`declared` 是 pnpm 自己写下的值，两者分列；`absent` 不等于 `hoisted`。**R31 更正**：`.pnpm` 在两种布局下都存在，别拿它当判据；要看 `linker`/`virtual_store_links` |
| 浏览器半边装了却「页面里就是没有」 | 三条静默规则（R31 实测）：① `package.json#exports["./client"]` 缺了就丢，② profile patch 行的 `name` 是**子路径**（`dsh-triage/host`）也会丢，③ 资产裸 URL 一律 404（必须用启动文档给的 `?rev=` 组合 URL） | 行名写裸包名（`dsh-triage`）、`exports["./client"]` 必须在、验证走 `node scripts/record_client_serve.mjs`（六步：bundle/install/boot/graph/client/mount） |
| 「服务了 200 就算挂上了」 | 200 只证明 Host 组进图并服务了字节；client runner 有没有调 `apply`、slot 有没有接受注册是另一件事 | 看 `mount` 步骤读到的 `window.__dshTriage`；`registered:false` 会带 `contract-missing`/`contract-mismatch` 原因。**肉眼可见**仍未断言 |
| 把 R27 的 22.5s 和今天的 6.6s 相减 | 两者口径不同：R27 那次 `boot→sample` 是**旧口径（判最终样本）**，T-312 之后判**第一份**样本；同一候选的最终样本仍是 19.5–25.2s | 只比同口径的数；要分布就跑多批 + `scripts/stability_report.mjs`，它拒绝单矩阵 |
| 设置页里「看不到我们的 tab」，以为是客户端 bug | R33 实测：干净 home 的**首启「预览版说明」浮层**会挡在前面；而且上游把 `settings.plugins.tab` 的宿主 section 叫 **内置插件 / Built-in plugins**，点侧边栏那个「插件」打开的是**插件管理器**（另一个面，里面没有这个 slot） | 用 `scripts/record_client_serve.mjs` 的 `visible` 步：它逐跳记录 `dismiss-intro / open-settings / open-plugin-settings-section / open-tab`，找不到入口只出 `unmeasured` 并列出页面实际提供的控件。**别**写死选择器 |
| Host 半边「挂了但路由 404」 | 两个真机坑（R33）：① `ctx.baseUrl` 在这版 Cordis 里是**profile 目录**，不是 `cordis.yml` 的 URL；② `ctx.webServer` 只有在 `inject: ['webServer']` 且**默认导出也带 inject** 时才在 apply 时可用，`ctx.get('webServer')` 会返回 `undefined` | 看产物 `host_log`（脚本会把 Host 日志尾巴落盘）；`host.ts` 两条失败路径都 `console.log` 原因。**别**把 404 当成「路由没被 Host 接受」就换方案 |
| 以为「第三方包能像上游那样暴露一个 Remote」 | R33 实测：host 侧**可以**（手写 `./typert` manifest 会被 `ctx.typert` 接受，端点出现在 `ctx.typert.local.list()`）；浏览器侧**拿不到** —— `ctx.remote` 没有第三方命名空间，声明 `remote.<ns>` 会让整个客户端模块不执行 | 见 `docs/adr/0010`：我们走同源只读路由（`ctx.webServer.register` + `fetch`），不引 `zod`/打包器 |
| 做「只差一个键」的 A/B，结果两组差了两个变量 | R33 真踩：对照组的 `pnpm-workspace.yaml` 只有注释，但**只要这个文件存在**，探针就 `pnpm_policy=source` 并跳过自己的 `strictDepBuilds: false`，候选安装因构建审批失败 | 两组都显式写 `strictDepBuilds: false`，只留被测的键不同；读完产物先看 `sandbox.profile_copy.pnpm_policy`（`BS-36`） |
| 以为「工具在 `schemas()` 里 = 模型能调」 | `schemas()` 是**投影**，`register()` 成功只说明注册表收下了；两者都真，但都不等于一次真实调用能过管道 | R36 起 `record_agent_tool` 真的调三次，并把 `calls[].via` 记下来（`registry` = 走 `tools.execute()`；`definition` = 回落到直接调定义，含 `registry_refusal` 原因）。**别**把后者写成前者 |
| 拿「我本地 `check` 的结果」当 Host 内工具的期望 | 工具回答的是**它服务的那个 profile** 的运行时（R36 真踩：`dsh-mcp-connector@0.2.83` 在 0.2.1-rc.4 是 `go`、在操作者 `~/.dsh` 0.1.0-rc.6 是 `blocked`，两个都对） | 取期望必须同口径（同一 home/同一 profile），并在产物 `sandbox.calls[].expected` 落账（`BS-38`） |
| 以为第三方插件要注册工具就得引 `@deepseek-ai/dsh-tools` | 实测 `register()` 只校验 `output.render` / `output.schema`（受支持子集）/ `timeoutMs` / 保留名 `run_code`，**没有 marker**；`defineTool` 只是编译 DSL + 参数校验 | 用纯对象注册（本包因此零上游依赖）；代价是**参数校验要自己写**（`readPackageArgument`），并单测覆盖 `{}`/数字/`null`/字符串/空白 |
| 为了「让工具也能在无 web 面的 profile 里用」把 `tools` 塞进静态 `inject` | 静态 `inject` 是**整行**的门：加上 `tools` 后仍要求 `webServer`，headless 里两样都没有，工具照样不挂 | 两半各自 `ctx.inject([...], cb)`（上游 `dsh-plugin-market` 的写法），并**必须重跑** `record_client_serve` 八步回归证明路由没坏（R36） |
| 探针自己的临时目录删不掉，候选就被记成 `blocked` | R37 真机：Windows 持有句柄 → `rmSync` 抛 `EPERM` → 异常逃出 `bootAndSampleHost` → 判据只剩 `probe.boot-timeout` 一条路（那份产物 `probe-matrix-2026-10-29T15-30-00` 里 `real-unlag` 就是） | scratch 准备/清理失败**记录不抛**（`boot.setup_error` / `boot.scratch_cleanup_error`），`boot` 步抛任何异常记 `bootSetupError`，判据走 `probe.measurement-unavailable` → `unknown` + `missing.probe`。**别**在 `catch` 里顺手把样本丢掉 |
| 用 `os.loadavg()` 证明「机器有载」 | Windows 上它**恒为 0**，于是「有载批」只是标签 | 用 `os.cpus()` 的累计时间差算 `observed_busy_percent`（R37 起矩阵产物自带）；`--load <n>` 的 worker 数也要进产物 |
| 把「没写出产物的 run」当 `unknown` 统计 | 那是一次**没有判定**的运行，折进 `unknown` 会让分布少一条命、也会让「不可判」看起来像判定 | `stability_report` 起把 `no-artifact` 单列，并按机器条件（`conditions[]`）分组；矩阵摘要也照旧单列 |

| 把「已提交」写成「已收录」 | 两条 PR 只是 **open**：维护者仍可否掉；`merged` 才是收录 | 渠道状态只读 `market-channels-*` 产物的 `submitted[].state`（R38 起 `live` 只统计 OPEN pull） |
| PR 里混进无关 diff | R38 第一版用 `JSON.stringify` 重排上游 `community.json`，把两处旧格式规范化，一条追加变成 **+16/-4** | 往别人仓里加条目用**文本插入**，并对**将要推送的字节**跑一次它们的校验器；PR 开出后用 `gh pr diff` 复核 diff 规模 |
| `gh repo fork <repo> --clone=false --remote=false` 什么都不做 | `--remote` 与「给出仓库参数」互斥，gh 只打印用法然后退出；`catch` 里不打印就会白等 | 只用 `--clone=false`，并且**从仓外目录**执行（否则它会改写当前仓的 remote 名） |
| 轮询 fork 状态永远失败 | `gh api --jq .default_branch` 输出的是**裸文本**（`main`），不是 JSON；`JSON.parse('main')` 抛错并被 catch，就变成「一直没就绪」 | `--jq` 的返回值用 `gh(...).trim()` 读；只有**不带 `--jq`** 的输出才是 JSON |
| `git push` 报 `Failed to connect to github.com:443 after 21s`，但 `gh` / `Invoke-WebRequest` 都正常 | 这台机器的 443 直连不通，PowerShell/.NET 走系统代理（R38 实测 `127.0.0.1:19828`），而 git 是直连 | `git -c http.proxy=http://127.0.0.1:19828 -c https.proxy=http://127.0.0.1:19828 push`；端口可能变，查 `HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyServer` |
| 按 HANDOFF 的 `npm publish -w dsh-triage --access public` 发布，装不上 | **npm 不重写 `workspace:*`**（`pnpm pack`/`pnpm publish` 才会写成 `0.1.0`）。R40 真打 tarball 解出来看过：`dependencies` 原样是 `workspace:*`，用户 `npm i` 必然失败 | 用 `pnpm publish` 或 `npm publish <pnpm pack 出来的 tgz>`；发之前 `tar -xOf <tgz> package/package.json | grep workspace` 必须为空 |
| `npm publish @scope/pkg` 报 E404/E403 | `@dsh-triage` 这个 **scope/org 不存在**（不是包名被占）。`npm org ls dsh-triage` 回 `Scope not found` | 先在 npmjs.com 建**免费公开组织** `dsh-triage`（别点 $7 私有档，也别 Convert 个人账号）；建完 `npm org ls dsh-triage --json` 应回 `{"<user>":"owner"}` |
| `pnpm publish` 报 `ERR_PNPM_OTP_NON_INTERACTIVE` | npm 对写操作强制 OTP，而 agent 的 shell 不是交互终端 | 要么人在交互终端里跑（npm 会提示 `Enter OTP:`），要么 `--otp=<6位码>`（TOTP 30 秒窗口，聊天往返很容易过期 → `EOTP`）。**别**为此把 token 写进仓 |
| 刚发的新 scoped 包 `npm i` 回 404，重发又报 `cannot publish over the previously published versions` | npm 的 staged publishing：包已在 registry 里但还没可读（首次发布 `dsh-triage` 时还出现过 `0.0.0-stage` 占位版本） | 用 `https://registry.npmjs.org/<name>` 轮询 `versions`，出现目标版本再装；重发的 403 就是「已经有了」的证据，不是失败 |
| 以为 `mode: ptc` 会让 `tools.schemas()` 里看不到插件工具 | R40 真机：ptc 下 `schemas()` = `[compat_verdict, working_directory, run_code]`——插件工具**仍在投影里**，只是模型直调被拒（`only run_code is callable directly`） | 判「ptc 真的生效」看 `run_code` 是否出现，别要求自己的工具消失；调用路径看 `calls[].via` |
| 探针把对象形态的拒绝写成 `[object Object]` | hook 里 `String(error)` 对非 `Error` 对象就是这个结果（R40 第一次 ptc 真跑，三次调用的拒绝原因全是它） | 读 `code`/`name`/`message`，再退到 `JSON.stringify`，最后才 `Object.prototype.toString`（已修） |
| 产物的 step 状态显示成 `--`，`outcome` 却还是 `passed` | `record(id, status)` 收到布尔值（`true`/`false`）时既不是 `passed` 也不是 `failed`，报表按未知打印，判定也不数它 | 状态只允许 `'passed'`/`'failed'`，脚本已加硬断言（R40 踩了一次，产物保留） |
| 以为「target 等于当前运行时 ⇒ 拒的单元数必须是 0」 | **R44 真踩**：`dsh-plugin-gate` 今天就被拒（peer 钉 `^0.1.0-rc.6`），于是 `--to <current>` 也报 1 个 `would-be-denied`，旧检查恒假。R42 的模板 profile 上这条是**真空通过**（那里 0 拒），缺陷因此藏了两轮 | 真恒等式是「**没有单元新变坏**」：每个 `would-be-denied` 都必须 `already_denied_at_current: true`（红产物 `upgrade-mixed-2026-10-29T06-25-00.000Z.json` 保留作见证）。同理，`target-change-moves-the-list` 不能只看拒的增量——改善也是"列表动了" |
| 记录器在 `--registry` 下设了注解，产物里却一条都没有 | 它把**第一次（离线）判定**的 `impact`/`units` 写进文件，而 CLI 实际输出的是第二次（带注解）的视图 | 产物描述**这次真正跑出来的视图**，离线计数单列成 `offline_counts` 供比较（R44 修） |
| 策展 profile 的产物自称「模板 profile」，`declared_dependencies` 恒为 `null` | 一行 `String(value)` 拼写错误被 `catch { return null }` 吞掉——**空 catch 把程序缺陷伪装成"没有这个文件"** | 空 catch 只允许出现在"外部世界可能没有"的地方；读自己的证据要能区分"读不到"与"写错了"。R44 修，并让 `composition` 从 profile 自己的 `package.json` 推导而不是写死 |
| 装一批真实插件到 `npm install` 直接 `ERESOLVE`（react 18 与 19 同时在树里） | 这些包 peer 依赖 react 的不同大版本，而 npm 的解析器不接受同一棵树里两套 | 只想读声明、不 boot 时用 `--legacy-peer-deps` + `--ignore-scripts`（`scripts/prepare_upgrade_mixed_profile.mjs`）：peer **声明**照样在盘上，别的都不装 |
| `cordis.patch.yml` 写 `name: @scope/pkg`，探针报 `patch-invalid`（保留字符 `@`） | YAML 里以 `@` 开头的裸标量非法 | 作用域包名一律 `JSON.stringify()` 加引号（`name: "@scope/pkg"`），写夹具时脚本化生成而不是手写 |
| 用 PowerShell here-string 把含中文的 JS `\| node -` 送进 node，正则里的中文变成 `??` 并报 `Nothing to repeat` | PS 5.1 管道到原生进程按控制台代码页编码，非 ASCII 会被替换（R45 真踩：`/严禁\|不写/` 变成 `/??\|??/`） | 含中文的代码只用编辑器/`write` 落盘再跑；临时脚本要中文就走 `%TEMP%\opencode\*.mjs`（与 HANDOFF §4 的 PS 转义坑同源） |
| 在 Windows 上 `git clone` 别人的仓库后只改一行，`git diff --stat` 却是全仓改动 | `core.autocrlf=true` 让工作区是 CRLF、索引是 LF，一旦 `git config core.autocrlf false` 再比对就整仓「被修改」 | 给上游提 PR 时用 `git -c core.autocrlf=false clone`（R45 真踩：#140 的第一版 diff 从 +1 变成 597 行）。**提 PR 前一定看 `git diff --stat` 是不是恰好一行** |
| 批量字符串替换后，一个**别的**产物变成「不存在」，门报 `no-orphan-results` | 替换串太短、撞上了同一时钟的其他产物名：把 `T08-20-00` → `T08-40-00` 本意只改 `listing-…`，却同时把 R40 的 `probe-matrix-…T08-20-00` 改成了不存在的路径（R45 真踩，门当场抓红） | 替换要**锚定完整文件名**（带前缀 `listing-`），改完跑一次 `gate_step_review`；台账里 `real_test.artifact` 一律 `existsSync` 自检 |
| 外部注册表检查报「找到许可证文件，但无法确定 SPDX 标识」 | 仓库根 `package.json` **没有 `license` 字段**（只有 `packages/*` 有 MIT，根是 `private: true` 的 workspace），而 dsh.so 读的是**仓库根清单**；`LICENSE` 文本本身是标准 MIT（R45 实测） | 根清单加 `"license": "MIT"`（别改 LICENSE 文本——那不是问题所在）。同类检查器都会先看 manifest 再看许可证文件 |
| 外部安全扫描报「通过，但已扫描文件 0，达到 150 文件预算」 | 证据仓的体量：827 个 tracked 文件里 **309 `.json` + 232 `.sha256` + 112 `.md`**，`data/results` 就有 460 个；按路径顺序预算在 `data/`、`docs/` 用完，`packages/`/`scripts/` 的源码没轮到 | **不是源码不可扫**。要一份真扫源码的结果就提交 npm tarball（`files` 只有 `dist` + `client.js` + `cordis.patch.yml` + `README.md`）；同一插件别同时提仓库与 npm 两条 |
| `gate.mjs --record` 报「refusing to overwrite existing evidence」 | 选了一个历史上已用过的 stamp（本仓有 80+ 份 `gates-*`，11:00/13:00 这类整点很容易撞） | 换一个没被占用的 stamp；**不要**为了用某个 stamp 去删历史产物（R45 踩了一次：09-10 撞车 → 改用 09-30） |

---

| **CI 全红但其实没跑** | GitHub 显示 `failure`，点进去 0 个 job | `.github/workflows/ci.yml` 里 `needs: verify    steps:` 两个键写在同一行 → YAML 非法 | 拆行；**改 workflow 后一定看一次 run**（本机 `gh run list`） |
| **本机绿、CI 红** | `governance/index-references` 只在 CI 红 | INDEX 引用了 `sandbox/`，而它被 `.gitignore` 忽略：本机有、干净检出没有 | 门禁现在跳过被 git 忽略的引用；**别用它掩盖"文件真的不存在"** |
| **备份被后一次 apply 覆盖** | `--undo` 还原出"已修补"的文件 | 同一 stamp（同一秒）连跑两次 `fix --apply`，备份目录同名 | 每次运行独立的 backups/journal 目录（`runName` 后缀 `-2`），`tests/unit/fix.test.ts` 钉死 |

## 5. 冻结区（改之前必须问 HUMAN）

| 区域 | 原因 |
|---|---|
| `data/gold/admission-cases.json` | 金标；改它等于改判据 |
| `audit/gate_ledger.json` 的 `negative_control` | 门禁有效性的唯一证明 |
| `packages/core/src/admission.ts` 的规则顺序 | 与上游对等性由金标锁死 |
| `PROJECT_RULES.md` 的铁律 | 工程宪法 |
| `packages/plugin/cordis.patch.yml` 的行 id | 撞上游 id 会让整个 profile 起不来 |

---

## 6. 交接包模板

写完交接，把内容贴进本文件 §2（覆盖上一轮）并在 `audit/AI_DISCLOSURE_LOG.md` 追加一条。
模板见 `.agents/prompts/handoff-packet.md`；硬性要求：

1. 「下一位 agent 的第一件事」必须是**单条可执行命令**；
2. 证据必须落盘（SSOT + sha256），禁只贴 stdout；
3. 未完成项必须带 owner 与退出条件。

---

## 7. 角色与规则速查

| 需要 | 看 |
|---|---|
| 新会话开工指令 | `.agents/prompts/kickoff.md`（整块粘进新会话即可） |
| 领任务 / 派活 | `docs/BACKLOG.md` + `.agents/prompts/task-packet.md` |
| 审核 | `.agents/roles/reviewer.md` + `.agents/prompts/review-packet.md` |
| 对抗性证伪 | `.agents/roles/adversary.md` + `.agents/rules/adversarial_review.md` |
| 代码约定 | `docs/08-conventions.md` |
| 路线与决策门 | `docs/ROADMAP.md` |
| 环境事实 | `docs/07-environment.md` |
| 本轮审核结论 | `audit/AUDIT_2026-10-28_R14.md`（本轮，含 §6 对抗性小节）· `AUDIT_2026-10-27_R13.md` · `AUDIT_2026-10-27_R12.md` · `AUDIT_2026-10-27_R8.md`（含 §7 独立复核与修正）· `R7` · `R6` · `R5` · `R4` · `R3` |
| 每步审核台账 | `audit/step_reviews.json`（门 `step-review` 校验；四轴 + 对抗性 + 产物 sha256；R21 起 114 步） |
| 授权/签署台账 | `audit/SIGNOFF.md`（谁授权、谁执行、HUMAN 没逐条看的部分，三者分列） |

---

## 8. 仍未解除的项（带 owner + 退出条件）

> **D1 已于 R6 通过**（9/10，`data/results/d1-2026-10-26T12-00-00.000Z.json`），因此下表不含 D1；但 D1 的标签目前是**实现方自证**（`BS-14` / T-111），对外口径只能是「机器可复算的命中率」。

| 项 | owner | 退出条件 |
|---|---|---|
| **D5：升级日有没有人接**（R47 新增，**当前唯一在手上的产品判断**） | implementer + HUMAN | 一张真机升级卡片 + 一次公开样本，2 周内 **reactions ≥10 · 外部引用 ≥1 · 周下载 ≥20**。**不达标 → 执行 D**（承认它不是产品：作品集 + 上游 PR），禁止再加功能 |
| **R48「陌生人 60 秒」四项**（R48 新增） | implementer | `T-806` / `T-807` / `T-808` / `T-809` 各自判据见 `docs/BACKLOG.md`；四项全绿才允许 `T-810` 分发。**在此之前不发任何内容**（HUMAN 口径：产品优先） |
| **分发依赖 HUMAN 的动作**（R48 记录） | HUMAN | 发布动作（Discussions / X / Reddit / B站）与 npm 发布都在 HUMAN 手里；agent 只起草与复算。**只公开项目、不公开个人身份** |
| **`BS-43`：生态规模不可知**（R47 新增） | implementer | `1584` 是 npm 关键词命中口径，catalog 自称 7,557；`check_listing` 的 `listing-1584-is-qualified` 已机器强制限定词。**退出条件**：拿到一个可复核的全集分母（catalog 的 7,557 条可逐条解释） |
| **`BS-44`：需求不存在 vs 形态错**（R47 新增） | 只有 D5 能区分 | 见上一条 D5；在 D5 之前不许做留存类功能（boot 守卫等） |
| ~~**`upgrade` 的 `improved` 桶无真机见证**~~ **已完成（R44）** | implementer | ✅ **已达成**：`data/results/upgrade-mixed-2026-10-29T07-10-00.000Z.json` 里 `counts.improved = 3`，每个单元同时带 `current.unmet_at_current`（`failure: null`）与 `target.status = admitted`，四桶同时非空。**但形状是降级几何**（`target_relation: older`），见下一条 `BS-42` |
| **`upgrade --registry` 的成功分支无证据** ~~已解除（R44）~~ | implementer | ✅ **已达成**：`data/results/upgrade-registry-live-2026-10-29T07-15-00.000Z.json`（真联网 `facts = 2` / `failures = 0`，注解挂上而 `units[].bucket` 与离线跑逐条相同）。**边界**：网络快照不可逐字节复现，`limits[]` 已写明 |
| **`BS-42`：前向 `improved` 无真实样本**（R44 新增） | implementer（等生态变化） | 1584 个 dsh 包（**关键词命中口径**，见 `BS-43`）里「今天被拒 + 更新目标放行」= **0**。退出条件：出现一个真实发布、声明了未来 build 的包（例如 `^0.2.1`），且它的 latest 在下一版 dsh 上被真机验证；在那之前对外只能说「目标版本会放行它」，不许说「升级会修好」 |
| **dsh.so 表单未提交**（`ready` 不等于已提交） | HUMAN | ✅ **R45 已提交（HUMAN，2026-10-29）**，但**未收录**：三个 per-plugin JSON 端点探测 404（`site_submissions[0].indexed = false`）。**退出条件**：端点回 200（渠道状态自动变 `listed`）或维护者回话；在那之前 `submitted` 不许写成收录 |
| **M5-a 的上传/聚合未开工** | HUMAN 先选 + 先签 | 需另开 `ADR-0012`（去重身份 / 服务器 / 删除请求 / 保留期）。**R46 已把三案摆给 HUMAN 选**：**A** 只做手动导出（半天、零服务器、零风险，能让 `d4_report` 有真实输入）· **B** 最小上传（要一台托管 + 域名，2–4 天，含"关掉就不联网"的机器断言）· **C** 不做（保持现状）。在签之前不许写任何上传代码，也不许说「回流能提升判断」 |
| `T-111` label 自证（`BS-14`）：9 个命中无独立签署 | verifier + implementer | R7 起新案例由独立上下文签署 `label_verified_by` |
| `T-201 P3`：真 Remote 客户端（`pluginInventory/list` 走 `dsh-client-connection`） | implementer | token→cookie 握手已实测（303）；产出一份 `transport=remote` 的样本，且与 `in-process-projection` 那份逐行一致 |
| `B3` 边界（`BS-20`）：**preset** 的 `failed` / `broken preset` / `conditional` 三档仍无真机样本 | verifier | 沙盒里故意写坏一个 preset、加一条 `!!js` 门。**R14 已真机化主列表的 `failed`（apply 抛错）与 `null`（import 抛错）**——`inventory-live-2026-10-28T02-30-00.000Z.json`；preset 三档仍只有夹具 |
| `B1/B2` 静态侧不全（`BS-19`）：launcher 层与运行时动态挂载的行不在声明侧 | implementer | 与 T-202 一起做：给 `undeclared` 分类（动态 / launcher / 探针），而不是只给计数。**R12 已把 195 条噪声降到 3 条并可逐条解释（探针不再被评分）** |
| `T-202a` **agent/preset 作用域**的工具表面 | implementer | 在会话/组合作用域里读 preset 工具表面。**R14 的 probe 只到进程级（`BS-21` 未变）**；要真实会话须先解决铁律 4（不得读凭据）→ **R26 已出 ADR：`docs/adr/0009-agent-scope-reads.md`（proposed）**，HUMAN 勾 B 才开工，且必须满足其 6 条边界 |
| `T-401` DSH 设置面板（M4-a） | implementer | **R26 只做了只读契约 spike**（`docs/specs/M4-surface.md` §3.1 的 C1–C6，钉到上游 0.2.1-rc.4 的具体行号：`settings.plugins.tab` 插槽、`ctx.slots.register`、props 由 `inject` 提供、`remote.pluginInventory.list()` 形状、`ctx.effect`/`locale` 用法）。**未写 `client.js`**；退出条件：写出来后真机挂载出 `compat-triage` tab + 「契约不匹配 = 零注册」的单测 |
| `T-302` probe 的 `client-rendered` 断言 | implementer | ✅ **R15 交付、R16 扩到 Linux**：真浏览器 + CDP；无浏览器 `unmeasured`；CI `render-control` 每轮跑三份对照。剩余：不是视觉回归，canvas/icon-only 只能 `inconclusive` |
| `T-305` registry 候选的真实安装形状 | implementer | ✅ **R18 收口 + R19 扩容**：13 个真实 pin 候选安装 0.5–10.6s、boot 9.6–18.x s；1 个装不上（原因已于 R19 点名：pnpm build-script 审批） |
| `T-305b` 私有源 / 不可达 registry 的真实失败形状 | implementer | ✅ **R16 交付**：`--npmrc-registry` + `install.endpoints` 点名源（`probe-registry-private-2026-10-27T14-33-57.000Z.json`）。剩余：只在 Windows 上跑过这一次 |
| `T-308` 就绪窗口 / hook 时序（`BS-25`） | implementer | ✅ **R17 交付 + R18 补测**：端口向 OS 申请、判定分离、就绪同轮询、hook 代际保护、`startup failed` 原文归因；`slow-plugin`(6s)=go 与 `slow-overrun`(20s)=unknown 都有真机产物。**剩余**：Linux 等价端口排除段未测（`BS-27` 的跨平台部分） |
| `T-310` 安装失败归因 | implementer | ✅ **R19 交付**：`install.diagnosis{code,key_line,source}` + `probe.install-failed-code` / `probe.install-build-refused`；真机 3 种码（`IGNORED_BUILDS` / `NO_MATCHING_VERSION` / `RESOLVING_NPM_RESOLVER_NETWORK_ERROR`）可见，URL 去凭据/查询串。剩余：`peer` 冲突类错误未在真机出现（只有单测形状） |
| `T-311` 20s 预算 vs 未稳定窗口（`BS-28`） | implementer + arbiter | ✅ **R26（E）+ R28（T-312）两步收窄**：`settled:false` 不再等替换窗口；预算改判**第一份**样本（`slow-plugin` 5.4s 仍 `go`）。**未解除**：不可判墙钟 ≈30.4s（比 E 之后的 28.6s 略长，因为要等最终样本），`--unsettled-timeout` 仍 20000、`settle` 仍 15s；`A′`（settle→10s）与 `A″`（→8s）**未签且已实测有代价**（`dsh-mcp-connector` 会 `go`→`unknown`） |
| `T-316` 真 hook 的 `{error}` 夹具 | implementer | ✅ **R27 完成**：`--hook-config` 把 hook 的 `resolveFrom` 指向没有 projection 包的 profile，真实 hook 写出 `{error}/projection-missing`，执行器 `replacement_waited=true`/`waited_ms=5204`（窗口 5000）。**边界**：`inactive-context` 只有桩级证据（`tests/unit/probe-hook-error.test.ts`），不许说成真机回归 |
| `T-303` / `T-202a` 会话作用域读数 | verifier + implementer | ⛔ **R28 结论：当前不做（A 案）**。`docs/adr/0009` 已分析三案：B 只换来一个补证断言，代价是产品里永久存在一条读凭据路径，且 6 条边界挡不住下一问「帮我读 `~/.dsh`」。产物继续写 `namespace-diff: unmeasured`；**退出条件**：HUMAN 在 ADR-0009 签字区勾 B |
| `T-304` probe 只测空模板 profile | implementer | 用 profile 副本 + 依赖安装跑一次，回答「加到**我的**组合里会不会挂」 |
| `T-306` 非 web 表面的就绪判据 | implementer | ✅ **R15 已交付（web 面）**：`readiness.source=host-url` + 多端口 cleanup。剩余：tui/headless profile 仍靠 `--no-http` 人工出口 |
| `T-113` attw 式入口可加载性矩阵 | implementer | 先在沙箱实测 loader 解析模式（两种），再实现；否则会造假警告 |
| `T-114` `triage bisect`（VS Code 二分思路） | implementer | **前置 T-301 已于 R14 满足**：probe 能稳定启停一次 boot（11.8–13.8s） |
| `BS-16` 来源/副本扫描的边界：`overrides`/lockfile 手钉 / 两层以上嵌套不可见；未知版本不参与比较 | implementer | 出现误判先补样本再改扫描器；T-113 与 probe 是补全路径 |
| 0.2.x 真机 profile 未装在**用户机器**上（仓内沙盒已能挂载并采样） | implementer | R14 的 probe 已在沙盒里跑通一次 boot；「用户机器」要靠 T-304 的 profile 副本 |
| ~~npm 仍未发布~~ **已解除（R40）** | HUMAN（已做）+ agent（已验） | 四个包按序上架，匿名安装 + CLI 真跑通过（`data/results/publish-2026-10-29T01-40-00.000Z.json`）；下次发版见 §3 第 2 条 |
| **分发三条 PR 待审（#65 / #193 / #140）** | HUMAN + agent | 用 `node scripts/record_market_channels.mjs --pr …` 刷新；`state=merged` 才算收录，`closed` 要读理由。**R45 实测**：#193 `APPROVED` 但 `merged_at: null`（等维护者点合并）；#65 `BLOCKED`（等审）；#140（walkinglabs，R45 新开）`open`。**`merged = 0`** |
| **1.0 出口（`gate_release --publish` 已绿 + 2 渠道收录）** | HUMAN（合并）+ agent（保持 PR 干净） | `merged ≥ 2` 之后才允许把 1.0 写成"就绪"；在那之前 `T-601` 只能算"文案与提交完成"。**不许**用 `ready`/`submitted`/`APPROVED` 冒充收录 |
| **`T-601`/`T-602` 已完成但产物是草稿** | implementer | 三篇文章在 `docs/posts/`，**未发布**；发布前重跑 `check_listing` 与文中命令，数字变了就改文章（不是改检查器） |
| ~~仓库仍 private~~ **已解除（R38）** | HUMAN | 2026-10-29 按 HUMAN 决定转 **public**；转前已做密钥扫描（0 命中），历史里 2 个旧提交含操作者用户名（已披露） |
