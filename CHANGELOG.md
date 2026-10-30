# Changelog

All notable public changes to `dsh-triage`. The project's internal round log lives in
`docs/HANDOFF.md`; this file only records what a user of the package would notice.

Versions follow semver. `0.x` means the CLI flags and the verdict contract can still change;
when they do, the change is written here with the reason, not just the diff.

## [0.3.0] — 2026-10-29

> The "stranger in 60 seconds" release: the upgrade-day card becomes reachable from a shell without
> knowing a version string. **No judgement changed**: the four buckets, the `improved` evidence
> thresholds, every admission rule and every threshold are byte-for-byte what 0.2.0 shipped. All four
> packages move together again (a plugin that imports something a newer core exports fails at load).

- **`dsh-triage upgrade --to next` / `--to latest`** — the target is resolved from npm `dist-tags`
  (one read of `@deepseek-ai/dsh`), then judged by the *same* engine with the *same* exact version.
  The resolved version is the registry's own string, verbatim: `v0.3.0` is refused rather than
  rewritten to `0.3.0`, because a card that disagrees with the registry is a lie about evidence.
  Unreachable registry or a missing tag → exit 3 with no bucket at all. An exact version stays
  **fully offline**, including `--to 9.9.9`.
- **`upgrade` with no `--to`** — no longer a bare usage line. It reports your current runtime, the
  targets that exist (`next` / `latest`), and still exits 2: without a target there is nothing to
  judge, and an empty report would read as "nothing will break". If the registry cannot be reached,
  the line says `unknown` instead of inventing a version.
- **`upgrade --card --out <file>`** — writes exactly the bytes a bare `--card` prints, atomically
  (temp file + rename), prints the path (relative when it is under the working directory, so a pasted
  log carries no home directory), refuses to overwrite an existing file (exit 2), and leaves nothing
  half-written when the target cannot be written (exit 3).
- **Both READMEs now open with the real card** and the command that produced it; a check
  (`readme-shows-real-card` in `scripts/check_listing.mjs`) re-reads the cited artifact and fails the
  copy if a bucket count, the sandbox annotation or the recompute command drifts.

### First screen is the answer (R49, 2026-10-30)

> Still part of `0.3.0`: it had not been published when this landed. **No judgement changed** — the
> buckets, the `improved` thresholds, every admission rule, `audit --json` and every exit code are
> untouched. Only what a person reads first changed.

- **`dsh-triage` with no subcommand is now `status`.** It prints the verdict, the counts, the rows to
  look at, and the commands to run — in that order. It used to print a 36-line usage screen and exit 0.
- **`audit` prints the summary by default.** The full ledger (170 lines on a real profile) moved behind
  `audit --all`. `audit --json` is byte-for-byte unchanged: scripts that parse it see no difference.
- **The counts say what was actually judged.** `156 rows (2 judged)` — the other 154 declare no
  `@deepseek-ai/dsh*` range at all, and the summary says so out loud instead of counting them as
  passing. A profile that yields **zero** rows is reported as `attention` ("usually the wrong
  `--dsh-home` or `--profile`"), never as a clean bill.
- **`serve` opens on the answer.** Conclusion banner, six counters, one card per thing to look at
  (with a copy button for the exact fix command), and the next three commands. The `data/results`
  artifacts and the raw `audit --json` payload are one click away under two tabs (`#evidence`,
  `#raw` deep links). The panel now reads the current profile by default; `--no-audit` keeps the old
  artifacts-only mode, and **both** routes answer `501` in it rather than an empty ledger.
- **Fixed while building it**: the panel's CSP (`default-src 'none'`) was also blocking the page's own
  `fetch()` calls, so the first screen rendered empty in a real browser while every HTTP smoke check
  stayed green. `connect-src 'self'` is now set, with a regression test. Two more "looks clean but
  isn't" cases were closed the same way: an empty composition, and a listing route that parsed
  arbitrarily large files.
- **Security**: `docs/SECURITY.md` now states the threat model, what is refused (with the test that
  proves it), and what is explicitly *not* defended. Seeing it in practice: 20 traversal spellings,
  symlink/junction escapes, files over 2MB, cross-origin reads, near-miss tokens, and concurrent
  refreshes are all refused or collapsed into a single scan.

- **The panel is now usable, not just readable** (same round, after the first screenshot pass): search
  by name / kind / subject, filter by kind and by conclusion, sort any column, open an artifact in a
  side drawer with copy buttons for its name, `sha256` and full JSON, and "copy this verdict" which
  puts the verdict, counts, rows and next commands on the clipboard as plain text. Six counters are
  clickable and filter the issue list; `l` cycles the theme, `/` jumps to search, `r` re-reads the
  profile, `Esc` closes the drawer. `#artifact=<name>` and `#theme=light` make a view linkable.
- **Two interface defects found the same way**: the injected copy table was missing three keys
  (`allKinds`, `allConclusions`, `kbdHint`), so both dropdowns and the keyboard hint rendered blank —
  a structural test now compares every `COPY.<key>` the page reads against the injected blob; and
  `color-scheme: light dark` left the canvas dark in light mode (white cards floating on black).

### A first-time user gets one sentence and one button (R49, 2026-10-30)

- **The panel opens in a simple view.** One plain sentence ("Nothing is broken, but 2 things we could
  not judge. It usually still starts."), one primary button, and one everyday sentence per problem.
  `Detailed` in the corner switches to the full UI — search, filters, sortable table, drawer.
- **Plain language is part of the data, not the UI.** `summary.plain` and `issue.plain` are fields the
  tests can assert on: when the verdict is not "ok", the plain sentence may not say "all good", and the
  rows that declare no DSH range are still mentioned — in everyday words, not by deletion.
- **The CLI says the same thing twice.** `dsh-triage` prints the plain sentence first, then the precise
  statement the record uses; the counts keep the honest `rows (judged)` split.
- **Publishing is self-explaining.** All four packages set `publishConfig.access=public`, and
  `node scripts/release_preflight.mjs` checks login, one version across the four, visibility and build.
  An expired npm token used to surface as `404 Not found`; it now says "not logged in — run npm login".


### Autofix: the tool can now repair one thing, and refuses the rest (R49, 2026-10-30)

- **`dsh-triage fix`** prints a plan and writes nothing. `--apply` writes only items the plan marked
  ready; `--undo <journal>` restores the previous bytes exactly. `--json` carries the same plan.
- **One write exists today**: an exact-version exemption in the profile's `compatibility.json`, in the
  format upstream writes (2-space JSON, sorted keys, trailing newline), and only when the installed
  runtime actually reads that file. On a runtime that does not (0.1.0-rc.6 does not), `fix` says so
  instead of writing a file nothing reads.
- **Refusals are part of the feature**: a non-exact version, a package whose install shape we do not
  know, a compatibility file this tool did not write — each is reported, not "repaired". Editing a
  plugin's own `engines.dsh` to silence the loader is deliberately absent: that would be lying to the
  loader, and the next reinstall undoes it anyway.
- Two real defects were found by recording the write path instead of mocking it: a second `--apply`
  in the same second used to overwrite the first backup (so `--undo` restored the *patched* file), and
  backup directories could not be created at all because an ISO stamp contains `:`.

### The panel, redesigned (R49, 2026-10-30)

- Visual pass, done by a separate agent and reviewed against real browser screenshots: the card wall,
  shadows, gradients and emoji are gone; two type sizes plus one number; colour only for
  normal / undecided / broken; `问题` and `命令` are one column instead of two competing panels.
- The six counters are one hairline row; they still filter the issue list when clicked, and they are
  hidden in the simple view.
- Issue rows use words (`被拒` / `判不了` / `重复`) instead of symbols, and keep the exact engine
  sentence one click away in the detailed view.
- Deep links combine now: `#theme=dark&advanced&evidence`, plus `#artifact=<name>` opening the drawer.


## [0.2.0] — 2026-10-30

> Published to npm on 2026-10-30; anonymous install verified (`data/results/publish-2026-10-30T05-00-00.000Z.json`).
> **All four packages moved to 0.2.0 together**: `@dsh-triage/core` gained the outcome module, and a
> plugin that imports `assertOutcomeLine` from a 0.1.0 core fails at import time. Publishing only
> `dsh-triage` would produce a package that cannot start; the anonymous-install check in
> `scripts/record_publish.mjs` is what catches that, and it is why the release is four publishes.

Two new commands. Existing commands, the verdict contract, the gates and every threshold are
unchanged.

- **`dsh-triage upgrade --to <version>`** — before moving your dsh build, ask which loader rows and
  bundles the *target* runtime would deny. Four buckets that partition the profile
  (`would-be-denied` / `cannot-tell` / `improved` / `likely-fine`), the same remediation text `why`
  prints, and the same admission engine with the runtime swapped — there is no second set of range
  rules. Offline by default. Registry lookups are annotations and cannot move a row between
  buckets. It says "would be admitted/denied", never "will work".
- **`dsh-triage outcomes`** — the local outcome store behind the reflow layer. **Off by default**:
  while off, no directory and no file is created. When on, it stores a fixed field whitelist (no
  paths, hostnames, logs or free text) and `--purge` leaves nothing behind. Nothing is uploaded;
  there is no network code on that path.

Also: `check --explain` can now show a local prior as an **annotation** (`prior` block) that never
changes the verdict — `check --json` is byte-identical with or without one.

## [0.1.1] — 2026-10-29

Documentation release. **No behaviour change** — the CLI, the verdict contract, the gates and
every threshold are identical to `0.1.0`. Published to npm on 2026-10-29; anonymous install
verified (`data/results/publish-2026-10-29T10-10-00.000Z.json`).

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
