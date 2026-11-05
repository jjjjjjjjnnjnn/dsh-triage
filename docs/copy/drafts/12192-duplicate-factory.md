<!-- facts: docs/copy/facts/2026-11-05-batch2.md -->
# #12192 · 重复 factory 注册的副本与冲突排查
<!-- channel: https://github.com/deepseek-ai/deepseek-harness/discussions/12192 · Chinese · ready-to-post -->
<!-- paste:start -->
提供一个排查方向供参考：重复 factory 注册通常表示同一个 bundle 被求值了两次，常见于市场安装的副本与本地 `link:` 副本同时存在。

你可以运行以下只读命令排查本地 profile 中的副本冲突：

```console
npx dsh-triage audit --all
npx dsh-triage why
```

- `npx dsh-triage audit --all` 会列出同名包并存的多份副本（包含两条路径与各自版本）以及 entry-id 冲突；
- `npx dsh-triage why` 会给出逐行的拒绝或冲突原因，帮助确认应当保留哪一份副本、移除哪一份。

需要说明的是，这只能帮你定位应该移除哪一份重复副本，工具本身不会修复或改变宿主启动时的隔离机制。

我维护 dsh-triage，上述排查命令由该只读工具提供。

以上判的是 npm 上已发布的 manifest，不是你那台机器；声明层放行不等于运行期一定无故障。
<!-- paste:end -->
