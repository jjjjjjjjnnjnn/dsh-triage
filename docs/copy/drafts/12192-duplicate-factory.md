<!-- facts: docs/copy/facts/2026-11-05-outreach.md -->
# #12192 · 重复 factory 注册的副本与冲突排查
<!-- channel: https://github.com/deepseek-ai/deepseek-harness/discussions/12192 · Chinese · prepare-only -->
<!-- paste:start -->
提供一个排查方向供参考：重复 factory 注册通常是因为同一个 bundle 被求值了两次，常见于市场安装的副本与本地 `link:` 副本同时存在。

需要明确的是，下面的工具只能帮你定位应该移除哪一份重复插件副本，不能修复或改变宿主「单个插件失败就中止整体启动」的隔离机制。

你可以在本地运行以下命令定位冲突来源：

```console
npx dsh-triage audit --all
npx dsh-triage why
```

- `dsh-triage audit --all` 会列出同名包并存的重复副本（包含两条路径与各自版本）以及 entry id 冲突；
- `dsh-triage why` 会给出逐行的拒绝或冲突原因，便于确认保留哪一份副本、移除哪一份副本。

边界：我们没有你本机 profile 的读数，此工具也无法修改宿主的启动隔离行为。以上判的是 npm 上已发布的 manifest，不是你那台机器；声明层放行不等于运行期一定无故障。
<!-- paste:end -->
