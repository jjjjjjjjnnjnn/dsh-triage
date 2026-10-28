# T-304 profile-copy fixtures

Two profiles that are **supposed to be unusable**, so the probe has a negative control for
"the copy could not be made to work" (which must be `unknown`, never `blocked`).

| Fixture | What it proves | Measured shape |
|---|---|---|
| `unusable/profiles/web` | A dependency of the copied profile cannot be installed → `probe.profile-copy-unusable` | `dsh plugin install` exits non-zero (`ERR_PNPM_*`) |
| `dangling/profiles/web` | A `link:` target that does not exist → `probe.profile-link-dangling` | `dsh plugin install` exits **0** (R20 fact F40) |

Both are used as `--dsh-home` roots, so the source profile is
`<fixture>/profiles/web`. They are never installed themselves: the probe copies the
declarations into its own sandbox and installs there.
