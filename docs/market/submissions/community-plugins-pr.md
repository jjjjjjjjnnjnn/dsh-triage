# dsh-community-plugins · PR 正文

> 用法：`gh pr create --repo zhu1090093659/dsh-community-plugins --base main --head feat/community-plugins-dsh-triage --title "feat(community-plugins): add dsh-triage" --body-file docs/market/submissions/community-plugins-pr.md`
>
> 前置条件（否则条目里两个链接都是 404）：仓库已 public，或 `dsh-triage` 已发布到 npm。

## 正文

```markdown
## What

Adds one entry to `community.json`: **分诊台 / Triage** (`dsh-triage`).

Pre-install judgement and post-mortem attribution for DeepSeek Harness profiles:

- `dsh-triage why` — one command answers "why did my tool disappear": rows denied by admission,
  modules that failed to import, capabilities declared but never registered;
- `dsh-triage probe` — installs a pinned candidate inside an isolated `DSH_HOME` and records
  boot / http / render / inventory evidence (default dry-run; never touches the user's profile);
- `dsh-triage audit` + a read-only settings tab showing the same conclusions as the CLI;
- `compat_verdict` agent tool so a model can ask "does this candidate fit this profile?" before
  installing anything.

It never installs into your profile or removes plugins, never reads credentials, and never claims a plugin is safe —
the verdict vocabulary is `go` / `risky` / `blocked` / `unknown` with per-claim evidence tiers.

- Repo: https://github.com/jjjjjjjjnnjnn/dsh-triage
- npm: `dsh-triage`
- DSH compatibility: `engines.dsh: >=0.2.0-rc.1 <0.3.0-0`; measured on 0.2.1-rc.4 (Windows).
  (CONTRIBUTING.md prefers an open range; widening the upper bound is a declaration-surface change, handled separately.)
- Licence: MIT.

## Checklist (from CONTRIBUTING.md)

- [x] `pnpm community:check` → `community-index: OK (120 entries)`
- [x] `node --test scripts/community-index.test.mjs` → 10 pass / 0 fail (the upstream repo's own suite; measured 2026-11-10: `ℹ pass 10 / ℹ fail 0`)
- [x] required fields filled: `id`, `name`, `nameEn`, `author`, `description`, `descriptionEn`,
      `repo`, `npm`, `category`, `subcategory`
- [x] one entry, one commit, Conventional Commit message, no emoji
- [x] the entry sits at its ascending `id` position (`dsh-triage` → index 101, between `dsh-translate` and `dsh-tui`)

## Note on ordering

CONTRIBUTING.md step 1 now says to insert one object into the `community.json` array at its
ascending `id` position, and states there is no `rank` field — the array order is the store order.
This PR does exactly that: the entry is placed at index 101, between `dsh-translate` and `dsh-tui`,
and introduces no new field. `node scripts/community-index.cjs --check` now asserts ascending order
(`community.json: entries must be sorted by id: <a> comes before <b>`), and it passes.
```
