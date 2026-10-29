# Changelog

All notable public changes to `dsh-triage`. The project's internal round log lives in
`docs/HANDOFF.md`; this file only records what a user of the package would notice.

Versions follow semver. `0.x` means the CLI flags and the verdict contract can still change;
when they do, the change is written here with the reason, not just the diff.

## [0.1.1] — 2026-10-29

> Status: packed, installed and verified locally; **awaiting `npm publish`** (the tarball is not on
> the registry yet — see `docs/HANDOFF.md` §3). Until it is, `npm i -g dsh-triage` still resolves
> to `0.1.0`.

Documentation release. **No behaviour change** — the CLI, the verdict contract, the gates and
every threshold are identical to `0.1.0`.

- Rewrote `README.md` / `README.zh-CN.md` around verifiable claims: every command shown exists
  in `--help`, every number points at a producer in the repository, and every sample output
  comes from a real run on the maintainer's machine (paths shortened by hand).
- Added the four-state verdict table (`go` / `risky` / `blocked` / `unknown`), the five evidence
  tiers, and the rule that secondary channels may never move a conclusion.
- Added an explicit "what it does not do" list (install / uninstall / rollback, marketplace,
  security review, author-side lint, feature model) and an honest-limits section: one Windows
  host, a convenience sample of 13 candidates (12 started, Wilson 95% 0.667–0.986), and the
  fact that 20 seconds is a *waiting* budget, not wall clock.
- Stated the channel status exactly: npm published; both pull requests open (one approved,
  neither merged); dsh.so ready but **not submitted**. "Submitted" is not "listed".

## [0.1.0] — 2026-10-29

First public release. Four packages, published in dependency order:

| Package | Role |
|---|---|
| `dsh-triage` | CLI, DSH profile bundle (settings tab + Agent tool + read-only local route) |
| `@dsh-triage/core` | admission semantics, environment fingerprint, capability ledger, verdict assembly (pure, offline) |
| `@dsh-triage/signals` | npm registry / catalog / local-artifact signals, each with an evidence tier |
| `@dsh-triage/probe` | isolated probe plan + runner + CDP render judgement |

What it can answer at this version:

- `why` — why a plugin disappeared: the loader row that was denied at admission, the module
  that failed to import, or the capability that was declared but never registered.
- `check` — whether a candidate's declarations admit your exact dsh build, with the registry's
  dist-tag facts as secondary evidence and the remediation commands attached to a `blocked`.
- `audit` — a capability ledger of the installed set: entry ids, services, tools, commands,
  settings namespaces, duplicates and collisions.
- `probe` — install a candidate into its own `DSH_HOME`, boot it, check the port while the tree
  is alive, read the mounted DOM through headless Chromium over CDP, read the row's phase, and
  always clean up. Dry-run by default.
- `serve` — a read-only local panel over `data/results/` (loopback only, one-time token,
  cross-origin refused).
- `badge` — a shields-style SVG rendered only from recorded measurements (`not measured` when
  there is no evidence).
- `index` — a format-1 index of versions measured `go` on this machine: a filter with a
  timestamp, not a ranking.
- `compat_verdict` — an Agent tool that answers the same question inside a DSH session, through
  the same engine as `check`.

Known limits at this version are listed in the README and in `audit/blind_spots.json`; the
public ones are: `namespace-diff` is `unmeasured`, real probes have only run on Windows, and
the sandbox never receives credentials (so a plugin that needs a key reports a false negative).
