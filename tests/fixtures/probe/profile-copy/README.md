# T-304 profile-copy fixtures

Two profiles that are **supposed to be unusable**, so the probe has a negative control for
"the copy could not be made to work" (which must be `unknown`, never `blocked`).

| Fixture | What it proves | Measured shape |
|---|---|---|
| `unusable/profiles/web` | A dependency of the copied profile cannot be installed → `probe.profile-copy-unusable` | `dsh plugin install` exits non-zero (`ERR_PNPM_*`) |
| `dangling/profiles/web` | A `link:` target that does not exist → `probe.profile-link-dangling` | `dsh plugin install` exits **0** (R20 fact F40) |
| `strict/profiles/web` | The source profile's own workspace file asks pnpm to fail on unapproved builds; the sandbox must not overwrite it → `pnpm_policy=source`, `unknown` | `strictDepBuilds: true` → bundle not registered |
| `node-linker/profiles/web` | T-315: the source asks for `nodeLinker: hoisted`; does row identification survive? | `pnpm_policy=source`, install exit 0, one `active` row, `go` (F49) |

**Boundary on `node-linker`**: the artifact proves "a copied profile asking for hoisted does not make
the probe lose the candidate row". It does **not** record the resulting `node_modules` layout, so it
does not prove pnpm actually switched linkers.

Both are used as `--dsh-home` roots, so the source profile is
`<fixture>/profiles/web`. They are never installed themselves: the probe copies the
declarations into its own sandbox and installs there.
