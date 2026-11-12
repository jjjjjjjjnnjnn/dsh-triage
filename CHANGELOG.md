# Changelog

All notable public changes to `dsh-triage`. The project's internal round log lives in
`docs/HANDOFF.md`; this file only records what a user of the package would notice.

Versions follow semver. `0.x` means the CLI flags and the verdict contract can still change;
when they do, the change is written here with the reason, not just the diff.

## [0.3.9] — 2026-11-12

> **Behaviour: the command line stopped reporting blockers that were not there, and it stopped
> judging a composition it had not read.** No admission rule, threshold, bucket or exit code changed.

- **Installed plugins are no longer reported as blocked because of a stale cache.** On a DSH Desktop
  install the CLI read `@deepseek-ai/dsh` from the pnpm hoisted shared cache (`0.1.0-rc.6`) while the
  Host was running `0.2.2-rc.1` out of `app.asar`. Eight plugins — including `dsh-triage` itself —
  were denied confidently and wrongly. The version and the `@deepseek-ai/*` manifests now come from the
  archive the Host actually loads; a package the archive does not ship is reported as "cannot be
  verified" instead of "not installed" (`docs/specs/M14-kernel-asar.md`).
- **The composition now comes from the same archive as the version.** The row set was still read from
  the cached bundle patches, so a row id present in both the cached and the running `dsh-base` patch was
  reported as an entry-id collision (`llm-deepseek`). Every kernel-owned bundle now contributes its
  `package.json` and all of its `dsh.bundle.patch` files from the archive; bundles the archive does not
  ship are read from disk exactly as before (`docs/specs/M16-composition-source.md`). Measured on one
  real desktop profile: collisions 1 → 0, judged rows 55 → 93, exit code 1 → 0.
- **The one screen says zero when there is nothing to do.** `status` used to print "detected N
  compatibility anomalies" counting rows that merely never declared a range. It now separates
  `actionable` (denied + collision + duplicate copy + unreadable) from `unjudged`, and the word
  "anomaly" is not used when nothing is actionable (M15).
- **What this does NOT claim**: the archive is only probed on the desktop shell with this account's
  default home. A global npm install, a Linux desktop build and CI have no archive, so they keep the
  previous behaviour — and the previous numbers. `docs/specs/M14-kernel-asar.md` §6 and
  `M16-composition-source.md` §7 state the three blind spots (`BS-67`, `BS-69`, `BS-70`).
- **Test count on the npm page: 971.**

## [0.3.8] — 2026-11-12

> **Documentation only: the installed README and the help text were both incomplete.** No code changed.
> The admission rules, the four buckets, the `improved` thresholds, every threshold, every exit code and
> `audit --json` are what `0.3.7` shipped.

- **The installed README's flag table listed 8 of 37 flags.** `packages/plugin/README.md` is the page
  `npm view dsh-triage readme` serves, and its table quietly omitted `--results`, `--out`, `--snapshot`,
  `--explain`, the whole probe-tuning group and the entire `outcomes` verb set. Anyone who never ran
  `--help` formed their idea of the CLI from that table. It now documents all 37, and a governance
  assertion keeps it that way.
- **The Chinese help text listed 18 of 37 flags.** `HELP_ZH` had not received a flag since R15, so a
  `--locale zh` reader could not discover `--execute` at all — `probe` did not exist for them. Both help
  texts now agree, and a test pins the two sets equal in both directions.
- **Four recorders printed a path they did not write.** With `--out %TEMP%` they reported
  `data/results/…` while writing elsewhere. Same bug class as `0.3.2`'s registry-wait fix: one helper
  (`displayPath`) now derives the printed path from the written one, and the assertion matches the shape
  rather than one literal.
- **The English half of the boundary sentence is gone.** Both READMEs' English overview and
  `CONTRIBUTING` still said nothing is ever written to `~/.dsh`; `0.3.6` had already retired that claim.
- **Test count on the npm page: 924.**

## [0.3.7] — 2026-11-11

> **Documentation only: the installed README told you something untrue.** No code changed. The
> admission rules, the four buckets, the `improved` thresholds, every threshold, every exit code and
> `audit --json` are what `0.3.6` shipped.

- **The boundary sentence now matches the code.** Every README said `dsh-triage` is read-only and
  "never modifies `~/.dsh`". That was true until `0.3.0` added `fix --apply`, which writes
  `<profile>/compatibility.json`, and `0.3.3` added `rescue --apply`, which writes
  `dsh.profile.bundles`. Both take a backup, write a journal and undo byte-for-byte with `--undo` — but
  the sentence never said so. Everything else is still read-only, and `--apply` is never the default.
- **Test count on the npm page: 905.**

## [0.3.6] — 2026-11-11

> **One visible fix: fewer confident accusations.** The admission rules, the four buckets, the
> `improved` evidence thresholds, every threshold, every exit code and `audit --json` are what
> `0.3.5` shipped. All four packages move together.

- **A duplicate copy is only a finding when it can actually collide.** `0.3.5` counted every
  "same package, two versions" pair as a collision. On a real profile that produced **13 findings, all
  of them ordinary libraries** (`@babel/runtime` 7.29.13 / 7.29.7, `semver`, `@types/node`), and
  **none** of them was a `dsh.profile.bundles` entry or a `@deepseek-ai/dsh*` package — which is
  what a hoisted `node_modules` looks like on every machine, not a compatibility risk. A pair is now
  reported as a collision only when it can take part in DSH's own loading: it is a declared profile
  bundle, or its name is under the `@deepseek-ai/dsh` scope. Everything else still appears in
  `duplicates[]`, explicitly marked `surface: false`, so nothing is hidden — it just no longer
  occupies the first screen. On the machine this was found on, the count went 13 → 0, and the screen
  now shows the five genuinely undeclared entries instead.
- **Test count on the npm page: 891** (badge and prose together). `0.3.5` claimed 876.

## [0.3.5] — 2026-11-09

> **Two wrong answers, one of them the product's whole point, and no judgement change.** The admission
> rules, the four buckets, the `improved` evidence thresholds, every threshold, every exit code and
> `audit --json` are what `0.3.4` shipped. All four packages move together.

- **The DSH Desktop settings tab opens again.** Desktop renders the tab at `dsh-app://app` and forwards
  its fetches through the shell's `forwardWebRequest()`, which deletes `origin`, `sec-fetch-site`, `host`
  and `cookie` before the request reaches the Host. Every read-only route in this package refused that
  request with `403 · request carries no same-origin evidence` — the guard was refusing the one caller it
  exists for. The tab now labels itself with `x-dsh-triage-client: settings-tab`, and a request with
  **both** standard signals missing is served only when that label is present and exactly right.
  This is a caller label, not authentication: a cross-site page cannot send a custom header without a
  CORS preflight, and these routes never answer `OPTIONS`. A request that still carries `Origin` or
  `Sec-Fetch-Site` is judged exactly as before — the label buys nothing there.
- **The runtime version is read from the runtime that is running.** `loadEnv()` used to read
  `@deepseek-ai/dsh` out of `~/.dsh/profiles/node_modules`, which is a shared dependency cache. On the
  machine this was found on that copy said `0.1.0-rc.6` while the Host was executing `0.2.2-rc.1`, so
  **every** plugin declaring `engines.dsh >= 0.2.x` was reported incompatible — a full screen of
  confident, wrong answers. The version now comes from the package the Host was started from (resolved
  from the process entry point), falling back to the profile and shared copies, and the verdict says
  which one answered: `dsh 0.2.2-rc.1 (kernel)` versus `dsh 0.1.0-rc.6 (inferred)`. From a plain shell
  the CLI can only see the cached copy, so it says `(inferred)` instead of asserting it as fact.
- **Bundles that ship with the kernel are no longer reported as "not installed".** `@deepseek-ai/dsh-base`,
  `@deepseek-ai/dsh-web-app` and the `dsh-experimental-*` bundles live inside the kernel's own
  `node_modules`, which the bundle resolver never searched (reported upstream as issue #1). It searches
  now, and each layer records whether it came from the kernel, the profile, or the shared layer. Bundles
  that really are absent still warn — that check was not weakened.
- **Test count on the npm page: 846** (badge and prose together). `0.3.4` claimed 760.

## [0.3.4] — 2026-11-03

> **One visible fix, and no judgement change.** The four buckets, the `improved` evidence thresholds, every
> admission rule, every threshold, every exit code and `audit --json` are what `0.3.3` shipped. All four
> packages move together.

- **A failed "copy fix" no longer leaves you with nothing.** In the settings tab the fix command used to live
  only inside the copy button. On a browser without `navigator.clipboard`, or where a permissions policy
  denies `clipboard-write`, the button silently did nothing and the command was **not on screen anywhere** —
  the only trace was a marker in `window.__dshTriage` that no person reads. Now a failed copy prints the
  command under the button as selectable text (`user-select: all`) together with one plain sentence, in
  both languages. A successful copy still prints nothing, so "the button copies the engine's own line"
  stays checkable.
- **What this release does not contain.** The D5 measurement guard (`scripts/d5_window_status.mjs`) that
  tells an operator when the next market baseline must run is a repository tool: `scripts/` is not inside
  the published package, so nothing about it reaches your install.
- **Test count on the npm page: 760** (badge and prose together). `0.3.3` claimed 643.

## [0.3.3] — 2026-11-02

> **Documentation-only.** Nothing in `dist/` or `client.js` changed; every judgement, threshold, exit
> code and payload is what `0.3.2` shipped. This release exists because `README.md` is inside the
> package's `files`, so the npm page shows whatever test count the README claims — and that number had
> drifted (633 on the page, 643 in the suite) while a checker that was supposed to catch it had never
> matched a single claim.

- **The npm page's test count is now the measured one** (643), badge and prose together.
- **The release evidence now checks the browser half.** `record_publish` installs the package and, in
  addition to running the CLI and `import()`, resolves `exports["./client"]` inside the installed tree
  and requires the file to exist, carry the client-runner contract, and name `settings.plugins.tab`.
  Until this, "the four-bucket screen reached users" was confirmed by hand (`npm pack` + grep).
- **A note on the 0.3.3 window itself.** For about fifteen minutes after the publish, `@dsh-triage/signals@0.3.3`
  was accepted but not yet promoted by the registry: the version was unreadable `(404)` while a re-publish
  answered `409 Cannot publish over previously staged version`. During that window `dsh-triage@0.3.3` could not
  install, because it pins `signals@0.3.3` exactly. Both ends are now readable and `latest` on all four
  packages is `0.3.3`; nothing in this release's content changed. Recorded because a version you cannot install
  is worth telling people about, even briefly.
- **The release chain waits for the registry instead of calling a successful publish red.** 0.3.2's
  publish produced three red artifacts in five minutes because npm's anonymous/install document lagged
  ~4.5 minutes behind the write; the fourth run, with no code change, was green. The chain now retries
  only that failure shape within a budget and records how long it waited.

## [0.3.2] — 2026-11-02

> The release that puts **升级预检** on the settings page: the same four buckets `dsh-triage upgrade --to next`
> prints in a terminal, one click away, for the composition you actually have installed.
> **No judgement changed**: the four buckets, the `improved` evidence thresholds, every admission rule, every
> threshold, every exit code and `audit --json` are what `0.3.1` shipped. All four packages move together again.

- **A second screen in the tab, on demand.** `分诊台` now has a **升级预检** button. Pressing it asks the
  `next` dist-tag and shows `会被拒 / 判不了 / 会变好 / 像没事` with the count for each, plus the boundary
  sentence — *declaration layer only; not a runtime measurement, and your profile is not touched*.
- **Nothing is read from npm until you press it.** Opening the tab never contacts the registry. The click is
  the only thing that does, the read is capped at 10 seconds, and an unreadable registry produces a sentence
  instead of a zero-filled table (a zero table reads as "nothing will break").
- **"Still reading" no longer looks like "it failed".** The loading sentence used to be rendered through the
  failure view, so anything observing the screen — including our own test harness — could not tell a wait from
  an error. Two states, two marks now.
- **The four numbers on screen are the CLI's four numbers.** They come from the same `judgeUpgradeImpact` call
  and are compared against `dsh-triage upgrade --to next` on the same profile before this release was recorded.

## [0.3.1] — 2026-11-01

> The release that puts the one-screen answer **inside DSH**. `0.3.0` shipped it in the CLI and in the
> local panel; `0.3.1` puts the same answer on the settings page — `Settings → Plugins → 分诊台`.
> **No judgement changed**: the four buckets, the `improved` evidence thresholds, every admission rule,
> every threshold, every exit code and `audit --json` are what `0.3.0` shipped. All four packages move
> together again (a plugin that imports something a newer core exports fails at load).

- **The settings tab answers in one screen.** A new read-only route `GET /compat-triage/summary` carries
  a host-computed projection — `buildProfileSummary()`, the same function `dsh-triage status` and the
  panel's `/api/summary` call — so the tab cannot drift from the CLI. It prints the verdict, the counts,
  at most three "things to look at" with a copy button, and what to run next. Both locales travel in the
  payload: the browser half must not translate judgement language itself, because the wording of a
  conclusion is part of the conclusion.
- **A row that breaks *after* install now has a screen.** Staged with a real fixture
  (`engines.dsh: ">=9.0.0"`), not a mock: the tab shows it as `would-be-denied` with the reason and the
  remediation command.
- **Four failures get four different sentences**: route missing (404), profile unreadable (409), a
  payload without `summary` (version skew), and a dead process (fetch threw). An empty composition says
  out loud that `--dsh-home` / `--profile` is usually pointing at the wrong place — a zero-filled table
  reads as "nothing is wrong", which is the one mistake this product must not make.
- **Six wording fixes** found by reading the screen the way a stranger would: the subordinate `原因:`
  marker, the `—` separator, a duplicated line, a stray `messageId`, `· 复制` in front of the copy
  button, and a plural pronoun used for a single row.

The download-shape rule landed in the same window (`scripts/lib/download-shape.mjs`, plus tests) but it
is a measurement tool for this repository: nothing in the published packages reads it, and no package
behaviour depends on it.

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
  `node scripts/release_preflight.mjs` checks login, one version across the four, visibility, build,
  whether anything still left a `workspace:` spec for the publish tool to rewrite, and whether this
  version is already on the registry (re-publishing it only yields a 403).
  An expired npm token used to surface as `404 Not found`; it now says "not logged in — run npm login".
  And a check that never ran no longer masquerades as that sentence: on Windows `npm` is `npm.cmd`,
  which cannot be spawned without a shell, and the old code reported the resulting `ENOENT` as
  "your token returned 401" — sending an operator off to re-login with working credentials. The three
  outcomes (logged in / not logged in / could not ask) are now separate, with a test that pins it.


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
