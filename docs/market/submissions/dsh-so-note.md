# dsh.so 提交 · 审核者说明（reviewer note）

> 用途：提交到 dsh.so 时贴进备注栏。它不是营销文案，是**逐条解释扫描器会看到什么**，避免人工复核把正常实现当成风险。
> 事实来源：本仓 `docs/adr/`、`data/results/` 的产物、`COMPLIANCE.md`。所有陈述都能在仓库里指到具体文件。

## 1. 这个包是什么

`dsh-triage` 是一个 DSH profile bundle + CLI：**只读**地判断「某个插件在这个运行时上会不会被准入」，以及在隔离的 `DSH_HOME` 里真装真启动一次，把 boot / HTTP / 渲染 / 台账落成证据。

它**不装、不卸、不回滚**（那是上游 `plugin_manager` 的事），也**不提供安全背书**——不判恶意代码，不判"是否安全"。这一点写在 README 的「不做什么」里，是产品边界，不是免责声明。

## 2. 扫描器可能标记的几类模式，以及为什么它们是正常的

| 扫描会看到 | 在哪里 | 为什么存在 | 约束 |
|---|---|---|---|
| `child_process` / `taskkill /T /F` | `packages/probe/src/host.ts` | 启动的 Host 会带子进程；Windows 上单杀父进程不够，端口仍被监听（实测 R14）。停止判据是「端口不再应答」，不是退出码 | **只杀自己刚 spawn 的那棵树**（pid 来自本次 spawn），不扫描、不杀无关进程 |
| `rmSync(..., {recursive:true})` | `packages/probe/src/host.ts`、`packages/plugin/src/outcomes/purge.ts` | ① 探针的临时目录跑完必须删干净（失败会被记录成 `scratch_cleanup_error`，不会假装成功）；② `outcomes --purge` 只删**我们自己建的**目录 | 路径由本进程创建并持有；`--purge` 之外不删任何用户文件 |
| `fetch` / `https` | `packages/signals/src/`、`packages/plugin/src/fit.ts` | 读 npm registry 的**元数据**（版本、声明），用来判断 author 声明了什么 | 默认离线；`check --registry` / `upgrade --registry` 才联网；**不下载 tarball、不发任何用户数据** |
| 本地 HTTP 服务（带 token） | `packages/plugin/src/serve.ts` | 本地只读证据面板：只绑 `127.0.0.1`、token + HttpOnly cookie、跨源 403、POST 默认 403 | 不监听 `0.0.0.0`；`--allow-execute` 也只回 501 |
| 启动外部包（探针） | `packages/probe/src/exec.ts` | 这是产品核心：「在隔离环境里真装真启动一次」 | 独立 `DSH_HOME`（`%TEMP%/dsh-triage-probe/*` 或仓内沙盒）；**`npm/pnpm install` 带 `--ignore-scripts`**，不跑任何第三方安装钩子；`npm_config_userconfig` 指向沙盒内空文件，**不继承操作者凭据**（R20 实测修复）；跑完必删 |
| 读 `package.json` / `cordis.patch.yml` | `packages/core/src/` | 判断的全部输入就是这些声明文件 | 只读；不写用户的 `~/.dsh` |
| `process.env` 读取 | `packages/plugin/src/`、`packages/probe/src/host.ts` | 读 `DSH_HOME` / `HOME` 定位 profile；读 locale | **不读任何凭据文件**（铁律 4，`docs/adr/0004-external-candidate-boundary.md`）；有一个离线审计产物 `data/results/credential-sources-*.json` 记录"哪些环境旋钮真的被读到" |

## 3. 数据与网络：明确的三条

1. **不收集遥测**：没有上传、没有账号、没有唯一 id；`outcomes`（本地回流）**默认关**，开着也零网络，`--purge` 删干净。
2. **不读凭据**：不打开 `~/.dsh/credentials*`、不读 `~/.npmrc`；探针把 npm user config 指向沙盒内空文件（`sandboxNpmEnv`），并把这个事实写进每份产物（`install.registry_auth_used`）。
3. **不判安全**：README 与 `docs/00-vision.md` 都写明"不提供安全背书"。如果 dsh.so 的扫描结果与我们的声明冲突，以你们的扫描为准——我们不会声称"已通过安全审查"。

## 4. 关于"扫描预算 150 个文件、已扫描 0 个"（R45 实测）

提交检查时 dsh.so 报：安全扫描 `通过`（0 Critical / 0 Warning），但**已扫描文件 0，达到 150 文件预算**。

原因是仓库形态而不是源码不可扫：本仓 **827 个 tracked 文件**里 **309 个 `.json` + 232 个 `.sha256` + 112 个 `.md`**（`data/results/` 就是 460 个证据文件，这是产品的一部分：每份产物都带 sha256，由门禁重算），按路径顺序 `data/` 与 `docs/` 先把 150 的预算吃完了，`packages/` 与 `scripts/` 里的 85 个 `.ts` 没轮到。

如果需要一个**真正扫过源码**的结果，请改为扫描 npm tarball：`dsh-triage@0.3.0` 的 `files` 只有 `dist/`、`client.js`、`cordis.patch.yml`、`README.md`（`dist/*.js` 是编译产物，AST 可分析），与仓库源码一一对应（`scripts/record_publish.mjs` 会逐字节比对 registry 与本地 tarball）。

## 5. 可以核对的入口

- 只读边界与外部候选取用：`docs/adr/0004-external-candidate-boundary.md`
- 沙盒构建审批（为什么不批准任何构建）：`docs/adr/0007-sandbox-build-policy.md`
- 探针的等待预算（20s 承诺的是什么）：`docs/adr/0006-probe-budget-promise.md`
- 凭据来源审计（本地假 registry 实测）：`data/results/credential-sources-2026-10-28T19-00-00.000Z.json`
- 发布验证（匿名安装 + 字节比对）：`data/results/publish-2026-10-30T05-00-00.000Z.json`
- 合规声明：`COMPLIANCE.md`
