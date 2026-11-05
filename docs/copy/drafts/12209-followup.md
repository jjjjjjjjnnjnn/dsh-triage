<!-- facts: docs/copy/facts/2026-11-05-12209-followup.md -->

# 12209 · follow-up：接受「下架之后读数」的更正，并补四条代码层事实

- 渠道：GitHub Discussion `deepseek-ai/deepseek-harness#12209`（英文）
- 回复对象：`xinspark` 的 `discussioncomment-19415133`（回复在我们的 `discussioncomment-19414852` 下面）
- 状态：draft（写完即发，一条，不催）
- 检查：数字全部来自事实包里那两份 `update-trap-*` 产物；边界句原样保留

<!-- paste:start -->
Your correction is fair: because our earlier probe ran after the `0.12.x` line was unpublished, that reading cannot distinguish a correct comparison from having nothing older left to compare. In our own artifact, `dsh-win-pwsh7@0.2.6` now reads as `no-newer`, measuring your point with the same tool.

In `@deepseek-ai/dsh-plugin-manager@0.2.2-rc.1`, the comparison lives in `lib/types/versions.js:18-37`, where `newerVersions()` checks `semver.gt`. The data needed to fix this is already in the returned object (`publishedAt` from `time`, and `tags` from `dist-tags`). In addition, `update()` in `lib/types/index.js:742` independently requires `semver.gt(version, from)`, so a list-only fix leaves the explicit-version path unchanged.

Preferring `dist-tags.latest` alone has a measured counterexample: in a sample of 60 packages matching `dsh`, 22 have `latest` below their highest published version (such as `@deepseek-ai/dsh`). We suggest a narrower rule instead: treat a candidate as an update only when `semver.gt(candidate, installed)` and `time[candidate] > time[installed]`. Versions with higher semver but earlier publish timestamps can be treated as an older line rather than offered as an update.

Our sample of 60 packages found 0 live instances of the trap: the mechanism in code is real, but a live reproduction needs both lines to stay published, and our sample did not find one.

Recompute: `node scripts/record_update_trap.mjs --stamp 2026-11-05T10:46:00.000Z --search dsh --limit 60`

These readings are published metadata from npm, not your machine. Declaration and version metadata do not prove runtime health.
<!-- paste:end -->
