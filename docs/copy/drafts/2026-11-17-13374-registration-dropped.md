# #13374 · Desktop update drops third-party registration

> **渠道**：`deepseek-ai/deepseek-harness` Discussions · **回复**（不是新帖）
> **状态**：**已发（2026-11-17）** —— https://github.com/deepseek-ai/deepseek-harness/discussions/13374#discussioncomment-19690589
> **事实**：`docs/copy/facts/2026-11-17-three-replies.md`
> **链接**：**不带**（这条的价值是状态分辨法，不是某个命令）

<!-- facts: docs/copy/facts/2026-11-17-three-replies.md -->

<!-- paste:start -->

Your finding is the one that matters, and it is worth naming the four states separately, because from the UI they all look like "the plugin is installed":

1. the package is in the profile's `dependencies`
2. its name is in `dsh.profile.bundles`
3. a copy is resolvable on disk
4. the loader actually composed it

Your case is (3) true, (1) false. #13609 is the same seam with (1) true and (2) false. In both, "files on disk" only proves (3), and composition reads (2), in that order.

A read that separates them, from the profile directory:

```bash
node -e "const p=require('./package.json');console.log('dep', p.dependencies?.['dsh-opencode-session']);console.log('bundles', p.dsh?.profile?.bundles)"
ls node_modules/dsh-opencode-session/package.json
ls ../node_modules/dsh-opencode-session/package.json    # the shared layer above the profile
```

The third path is the one that bites on Windows: if an older copy of the same package sits in the shared layer, the loader may resolve that copy and your fresh install looks like it did nothing. Comparing the `version` in both `package.json` files is the fastest way to see a shadow.

On the lock: the handle belongs to the Electron process, so "close DSH" has to mean the whole process (tray included), not the window — you already found that, and it is worth keeping in the report because the UI's own retry does not say it.

One caveat about the recovery you used: `dsh plugin --profile desktop add <path>` should write both the dependency and the bundle entry. A manual `pnpm add` inside the profile writes only the dependency, which reproduces #13609's seam — so if someone "fixes" it that way, the plugin will be installed and still not composed.

Boundary: this reads published manifests and local files, not your machine. Declaration-layer admission does not prove runtime health.

<!-- paste:end -->

## 自检

- 四条状态来自本事实包（`dsh.profile.bundles` 是独立字段、组合按数组取层、三层 root）。
- 没有重复他们已写的根因与恢复步骤，只补「怎么一眼分开四种状态」。
- 无链接；「共享层里的旧副本会遮蔽」是可核对的说法（`ls` 两条路径），不是断言他们的机器上有。
