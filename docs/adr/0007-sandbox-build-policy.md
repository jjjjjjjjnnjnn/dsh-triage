# ADR 0007 · 沙盒的构建审批口径（T-304 / T-315）

> **状态**：**R22 已实现，本 ADR 追认**。改动范围**仅限探针沙盒内的包管理器设置**；不触碰任何判定阈值，也不代表批准任何第三方构建。
> **影响面**：`packages/probe/src/profile-copy.ts`（`applySandboxBuildPolicy`）、`packages/probe/src/exec.ts`（`install.ignored_packages` / `build_refused_profile_only` / `candidate_registered`）、`docs/specs/M3-probe.md` §8.5。

## 背景（全部实测，2026-10-28）

1. **T-304 要回答「加到我的组合里会不会挂」**：做法是把真实 profile 的四个声明文件复制进沙盒、装一次副本依赖、再装候选（`M3-probe.md` §8.5 / F38–F39）。
2. **复制真实组合后 `dsh plugin install` 退出 1**：`ERR_PNPM_IGNORED_BUILDS`，被拒名单是**组合自己的**原生依赖（`@deepseek-ai/dsh-subprocess-local` / `@google/genai` / `koffi` / `node-pty` / `protobufjs`），候选根本不在名单里（F41）。
3. **更麻烦的是注册**：`dsh plugin add` 把依赖写进 `package.json`，但 `dsh.profile.bundles` **只在包管理器退出 0 后才更新**。实测（F42）：非 0 退出时 `dependencies` 有候选、`bundles` 没有 → Host 起来了但候选零行 → 如果照旧往下判，会得到 `row-missing` / `blocked`，即**把包管理器策略算成插件缺陷**。
4. **不是环境问题也不是候选问题**：同一台机器、模板 profile 的探针一直是 `go`；只有「复制真实组合」才触发，因为模板里只有候选自己的依赖。
5. **能关掉这个错误的只有两个旋钮**（F43 实测对照）：
   - `pnpm-workspace.yaml` 里 `strictDepBuilds: false` → 同一操作 **exit 0**、`bundles` 正确更新、**且仍然不运行任何构建脚本**（`onlyBuiltDependencies` 保持为空，`Ignored build scripts:` 照旧打印）；
   - `.npmrc` 里同名设置 → **无效**（exit 1）。

## 决定

**探针沙盒在自己的 `pnpm-workspace.yaml` 里写 `strictDepBuilds: false`，把「未批准的构建」从致命错误降为提示；除此之外什么都不做。**

四条边界，全部可机器检查：

1. **只在源 profile 没有 `pnpm-workspace.yaml` 时写**。用户自带 workspace 文件时一律不覆盖，产物记 `profile_copy.pnpm_policy = "source"`；此时若仍然 `ERR_PNPM_IGNORED_BUILDS`，结果只能是 `unknown`。
2. **不批准任何构建**。`onlyBuiltDependencies` 保持为空，`pnpm approve-builds` 从不被调用，`dangerouslyAllowAllBuilds` 从不被设置。被跳过的包逐个进 `install.ignored_packages`。
3. **不改变任何判定**。构建被跳过这件事以 `warn` 形式进 verdict（`probe.profile-build-refused`）；如果因此启动不起来，`boot` 步的失败**降级为 `unknown`**（`abortedAt === 'boot'` 才降级），候选自己的安装失败与行相位失败照旧 `blocked`。
4. **必须读回组合**。`install` 步在「组合侧构建被拒」时不能凭退出码放行，要读 `dsh.profile.bundles` 确认候选真的进了组合（`candidate_registered`）；读不出或不含候选 → `unknown`。

## 不采纳的方案

| 方案 | 为什么不 |
|---|---|
| **A. 在沙盒里批准这些构建**（`pnpm approve-builds` / `onlyBuiltDependencies` / `dangerouslyAllowAllBuilds`） | 等于在探针里执行第三方原生构建脚本。ADR-0004 明确「不 vendor、不判安全」，而构建脚本是比安装脚本更强的执行面。为了一个可用性数字扩大执行面，是本项目明确反对的交易 |
| **B. 覆盖用户的 `pnpm-workspace.yaml`** | 会把用户的设置偷换成我们的，且用户可能**故意**要求严格构建。那正是 `BS-31` 说的边界：测不了就说 `unknown` |
| **C. 退出 1 也继续 boot，让行相位决定** | 实测（F42）会得到 `row-missing`，把策略问题判成插件问题。这是本轮之前真会发生的错误结论 |
| **D. 只做模板组合，不做复制** | 就把 T-304 取消了；「加到我的组合里」才是产品问题 |
| **E. 在候选侧也放宽 `IGNORED_BUILDS`** | R19 的语义（装上但没构建 = 不能在这里跑）是对的，且模板路径靠它抓过真候选。本轮只放宽**组合侧**，且必须读回注册 |

## 后果

- **诚实**：复制模式的 `go` 现在有准确定义——「声明层一致、依赖装齐、原生模块**未**构建」。这条缝登记为 `BS-30`，产物里同时给 `ignored_packages` 与 `pnpm_policy`。
- **代价**：多一个沙盒内的文件（`pnpm-workspace.yaml`），多三个产物字段，多一条 warn 文案（`probe.profile-build-refused`）。
- **不做的事**：不改 `settle` / `--unsettled-timeout` / `boot→sample` 预算；不改 `probe.install-build-refused` 在模板路径的语义；不把 `unknown` 升成 `go`。
- **待办**：`T-313` 必须把 `pnpm-workspace.yaml` 与 pnpm 其它可继承设置一并纳入凭据/配置来源审计（本文件是本 ADR 引入的新配置面）。

## 签字区（HUMAN）

```
[x] 追认 R22 已实施的口径（不批准构建、只降错误；源 workspace 不覆盖；读回注册）
[ ] 授权方案 A（在沙盒里批准构建）  ← 未授权，且与 ADR-0004 冲突
[ ] 撤销本 ADR（退回 `unknown` 优先）  ← 未授权
```

> 追认依据：R22 真机三形状产物（`probe-copy-profile-ok` / `-unusable` / `-dangling` / `-strict`）与 F41–F43 的对照实验。**HUMAN 尚未逐条复核**，本行与 `audit/SIGNOFF.md` 同时记录这一点。
