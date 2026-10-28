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

It never installs or removes plugins, never reads credentials, and never claims a plugin is safe —
the verdict vocabulary is `go` / `risky` / `blocked` / `unknown` with per-claim evidence tiers.

- Repo: https://github.com/jjjjjjjjnnjnn/dsh-triage
- npm: `dsh-triage`
- DSH compatibility: `engines.dsh: >=0.2.0-rc.1 <0.3.0-0`; measured on 0.2.1-rc.4 (Windows).
- Licence: MIT.

## Checklist (from CONTRIBUTING.md)

- [x] `pnpm community:check` → `community-index: OK (148 entries)`
- [x] `node --test scripts/community-index.test.mjs` → 9 pass / 0 fail
- [x] required fields filled: `id`, `name`, `nameEn`, `author`, `description`, `descriptionEn`,
      `repo`, `npm`, `category`, `subcategory`
- [x] one entry, one commit, Conventional Commit message, no emoji

## Note on `rank`

CONTRIBUTING.md step 1 says "append one object with the next free `rank`", but `rank` is neither in
the required/optional field lists of `scripts/community-index.cjs` nor present in any current
entry, so this PR follows the validator (the file's own shape) instead of adding a field nothing
reads. Happy to add it if the intent is to introduce one.
```
