# ADR 0004 · 外部候选的取用边界（probe 第一次真装第三方）

> **状态**：已采纳（2026-10-28，HUMAN 授权见 `audit/SIGNOFF.md` R15 条目） | 影响面：`packages/probe/**`、`scripts/record_probe.mjs`、`quarantine/vendor-manifest.json`、`COMPLIANCE.md`

## 背景

M3 的执行器在 R14 只测过**本地 fixture**（`tests/fixtures/probe/*`）：安装耗时 490–635ms，走的是本地路径、不碰网络、不执行任何第三方构建脚本。

但 D2（probe 可行性）的判据是「成功率 ≥90%、单次 ≤20s」，分母必须是**真实 registry 候选**。R15 起 npm 上已有 25+ 个已发布 DSH 插件（`keywords:dsh-plugin`），第一个真实候选一装，就同时触发三件此前没发生过的事：

1. **执行第三方代码**：`dsh plugin add` 会跑 pnpm，候选的 `postinstall` 之类脚本会在沙盒里真执行；
2. **联网取物**：tarball 来自 registry，可能来自作者私有源；
3. **许可与归属**：我们不是分发者，但产物里会出现别人的包名/版本/许可。

`PROJECT_RULES.md` 铁律 6 要求「外部插件产物先落 `quarantine/` 并登记 `vendor-manifest`」——那条规则针对的是**要进 `packages/` 的代码**。probe 不进代码，但它确实执行别人的代码。这条边界此前没有写过，所以必须先写清楚再动手。

## 决定

1. **精确钉定**：候选只能是 `name@x.y.z`、tarball + integrity、或本地路径。禁止 `latest`、范围、`*`——否则「跑的是哪个版本」不可复算。
2. **只进临时沙盒**：安装在独立 `DSH_HOME`（系统临时目录下的 `dsh-triage-probe/<slug>-<digest>`），与真实 `~/.dsh` 不相交（`validateProbePlan` 强制），跑完 `finally` 必删。
3. **不注入凭据**：子进程环境统一过 `scrubbedEnv()`（丢弃 `*API_KEY*` / `*TOKEN*` / `*SECRET*` / `*PASSWORD*` / `*CREDENTIAL*` / `*_AUTH*`）。需要 key 才能跑的候选，结论只能是 `unknown`/`unmeasured`，不许拿真实 key 换一个绿。
   > **R20 修订（实测补充，边界不变、实现变严）**：`scrubbedEnv()` 只清环境变量，**挡不住 `~/.npmrc`**——pnpm 自己会读它。R20 黑盒对照：同一条装不上的候选，默认环境 2/2 打印 `An authorization header was used: Bearer npm_[hidden]`，把操作者的 token 发给 registry；把 `npm_config_userconfig` 指向沙盒内空文件后 2/2 消失。因此 `runInstall` 现在经 `sandboxNpmEnv()` 重定向 user config，产物记 `install.registry_auth_used`。**代价（诚实写明）**：沙盒**不继承**操作者的 npm 用户配置（含镜像），需要私有源/镜像的候选会走 profile 级 `.npmrc`（T-305b）或直接失败。
4. **不 vendor**：候选源码**不落仓**、不进 `packages/`、不进 `quarantine/`。`vendor-manifest.json` 只登记元数据条目（`kind: "probe-candidate"`，`usage: "reference-only, never vendored"`），字段=包名/精确版本/license/`dist.integrity`/取用日期。
5. **产物只记元数据**：`data/results/probe-*.json` 记 spec、版本、integrity、license、unpackedSize、耗时、断言与结论；不记候选源码、不记文件清单内容。绝对路径与 `?token=` 一律脱敏。
6. **不给安全背书**：probe 只回答「装得上 / 起得来 / 画面有没有出来」。产物 `limits[]` 必须包含「no security judgement」。
7. **失败即证据**：网络失败、安装超时、私有源 404 都是被测形状，落盘为 `probe.install-failed` 而不是「基础设施故障」；**重试必须记 `attempts`**，不许把第二次成功写成第一次。

## 后果

- T-305 可以开始积累真实分母，D2 不再只有 `n=1`（本地 fixture）；
- 代价：`verify` 仍然**不联网**（真跑只在人工记录步骤里发生，产物落 SSOT 后门禁只重算 sha256）；
- 新增隐私面：Host 自打印的 URL 带 `?token=`，脱敏规则必须覆盖（`results-privacy` 门已有路径脱敏，token 形态是本轮新增的负对照）。

## 替代方案（未采纳）

| 方案 | 为什么不 |
|---|---|
| 先把候选 tarball 落 `quarantine/` 再装 | quarantine 是「要进仓的代码」的隔离区；probe 的执行体是**临时沙盒**，把几百 MB tarball 搬进仓只会让仓变成缓存，且不改变风险 |
| 只测本地 fixture | 没有真实分母，D2 的「≥90%」永远无法证伪 |
| 手工 `npm pack` + import | 绕过了产品真正走的安装路径（`dsh plugin add` → pnpm），测的不是用户会遇到的事 |
| 用容器隔离候选 | 本机没有容器运行时；引入它会与「零依赖、本机可复现」冲突，可作为将来加固项 |
