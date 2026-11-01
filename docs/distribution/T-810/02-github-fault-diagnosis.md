<!-- channel: GitHub — 真实“插件装上后未出现/消失”故障 Issue 针对性答疑 -->

# 草稿 02 · 故障 Issue 诊断答疑（英文）

> **适用场景**：仅在用户的具体问题属于“插件已安装但在重启后未出现/消失”时回复。
> 需替换方括号 `[ ]` 中的具体包名或模块 ID。

---

When an installed DSH plugin fails to appear after a restart, it usually stems from one of three common root causes:

**1. Missing `dsh.bundle` declaration**
If the package manifest lacks a `dsh.bundle` field, DSH treats it as a standard npm dependency rather than a profile layer, meaning no UI or hooks will be registered:

```console
$ node -p "require('./node_modules/[pkg]/package.json').dsh?.bundle ?? 'no dsh.bundle (not a layer)'"
```

**2. Row rejected at admission**
Admission evaluation occurs **per loader row**, not per bundle. Even if a bundle is valid, a specific row that imports your module might be refused if its `peerDependencies` or `engines.dsh` requirements conflict with your current DSH runtime. When rejected, DSH quietly drops the row:

```console
$ dsh-triage why "[module or entry id from log]"
$ dsh-triage audit            # profile overview and row-by-row status
$ dsh-triage audit --all      # full ledger with all evaluations
```

**3. Installed but failed during phase registration**
A plugin with compatible declarations can still fail during dynamic module loading (e.g. hoisting conflicts, unbuilt assets, or unmet runtime imports). `dsh-triage audit` tracks row lifecycle phases to highlight entries that exist in configuration but never reach the `active` state.

For a concrete example, see CASE-11080 in the repository (`data/results/why-case-CASE-11080-2026-10-26T12-00-00.000Z.json`), where checking bundle metadata alone showed no issues, but the specific entry row was blocked by strict peer pinning.

`dsh-triage` runs entirely locally and read-only (no telemetry or remote queries). Open source on GitHub: `https://github.com/jjjjjjjjnnjnn/dsh-triage`.

If you share the relevant log line and your current DSH version, happy to help pinpoint which step blocked it.

---

## 注意事项

- 仅在问题现象确为“插件已安装但未加载/未出现”时使用；
- 若对方已有明确错误堆栈并已定位，请勿重复发帖；
- 保持技术互助的真诚态度，聚焦帮对方解决具体排查步骤。
