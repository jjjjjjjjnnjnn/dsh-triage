# 装好的插件第二天不见了：一条命令查出「哪一行被摘掉」

> 状态：**未发布**（草稿，R45）。所有数字来自本仓 `data/results/` 的产物，可按文末命令复算。
> 素材：GitHub Discussion #11080（DeepSeek Harness），本仓案例 `CASE-11080`。

## 现象

一位用户升级 DSH 之后，`@deepseek-ai/dsh-hooks-claude-code@0.2.1-rc.2` 的 hooks 全停了：

- 删除保护不响；
- 每轮提示的路由注释没了；
- 改完文件不做结构检查；
- 界面上**什么提示都没有**，插件管理器里那一行看起来还在。

他手上唯一的线索是一行 stderr：

```
dsh: disabling profile plugin row ... incompatible ...
```

`di_loader_list` 显示那一行 `phase=no-fiber`、`disabled=true`。

## 机制：不是插件坏了，是它没被「准入」

DSH 的 loader 在组装 profile 时会为每一行做一次**声明求值**（admission）：这个包的 `engines.dsh` 或它对 `@deepseek-ai/dsh-*` 的 peer 声明，是否包含当前运行时版本？

- 包写的是 `0.2.1-rc.2`（精确钉）；
- 运行时升到了 `0.2.1-rc.3`；
- 精确钉不包含 rc.3 → 这一行被**摘掉**；
- 摘掉发生在挂载之前，所以没有运行时错误、没有页面报错，只有一行 stderr。

这类失败最难受的地方是：**症状和原因不在同一层**。用户看到的是"hooks 不工作"（功能层），原因在"peer 区间不含当前运行时"（声明层）。

## 一条命令把归因说出来

```sh
dsh-triage why
```

在这一份复现出来的 profile 上，它给的是逐行的结论，而不是「没有发现冲突」：

```
@deepseek-ai/dsh-hooks-claude-code   blocked
  admission.row-scope       这条结论属于 loader 行 `<row id>`（不是整个 bundle）
  admission.unmet.peer      @deepseek-ai/dsh-tools 0.2.1-rc.2（当前 0.2.1-rc.3）
  … 共 9 条未满足的 peer 声明
  fix [pin-version] / [downgrade-dsh] / [allow-version] / [disable-entry]
```

两个细节值得说：

1. **判 bundle 是不够的。** 这个插件的 bundle 声明看起来没问题，被摘掉的是 `cordis.patch.yml` 里的**行**。只按 bundle 判会得到「一切正常」，而用户的工具确实没了。本仓的案例库就是为了锁住这一点（`CASE-11080` 的命中判据就是「点名到行」）。
2. **「今天是拒还是升级弄坏的」是两件事。** 如果这个包在**当前**运行时上就已经被拒，那它不是被这次升级弄坏的——`upgrade --to` 的产物里有一个独立字段 `already_denied_at_current` 就是为了不把旧账算到升级头上。

## 怎么自己复核

```sh
# 复现这个案例（隔离沙盒，不碰你的 ~/.dsh）
node scripts/record_case.mjs --case data/cases/CASE-11080 --stamp <ISO>
# 产物：data/results/why-case-CASE-11080-<stamp>.json
```

复核时要看的是 `hit.verdict`（是否点名到真实根因）与 `verdicts[]` 里的 `messageId`，不是截图。
本仓 10 个真实案例里 9 个命中、1 个是**有意保留的 miss**（两个插件都不声明任何 DSH peer，失败在运行期 API 漂移——我们的信息通道不全，不是声明层天花板）。

## 诚实边界

- 这条命令说的是「**按声明，这一行不会被准入**」，不是「这个插件的功能一定坏」；反过来，声明通过也不等于功能正常——那是 `probe` 的活。
- 判断规则与上游 admission 语义逐条对等，由 **27 条金标**（含 npm 真实声明快照）锁死；规则顺序改动会直接打红门禁。
- 命中率对外只能说「**机器可复算**的 9/10」，因为这 9 个标签目前是同一批人签的（`BS-14`）。

## 如果你正遇到「插件不见了」

按这个顺序，三条命令就够：

```sh
dsh-triage why            # 谁被摘了、为什么、怎么修
dsh-triage audit          # 当前组合的行级结论 + 副本来源
dsh-triage check <包>     # 装下一个之前先问一次
```

如果 `why` 说「没有任何行被拒」，而你的工具确实没了，那问题不在 admission——去看运行期（相位、注册表），那需要 `audit --snapshot` 或 `probe` 的样本，你的 issue 里请带上那份产物。
