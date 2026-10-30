# dsh-triage

**The judgment layer between "it installs" and "it works"** — for DeepSeek Harness plugins.

[![npm version](https://img.shields.io/npm/v/dsh-triage.svg)](https://www.npmjs.com/package/dsh-triage)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

DeepSeek Harness (DSH) already tells you whether a plugin *installs*. Nothing tells you whether it will *work* — with your dsh build, your OS, and the plugins you already have installed.

`dsh-triage` answers the question users actually ask: **"why did my plugin disappear?"** — and, before you install, whether a candidate survives your exact environment. Conclusions are computed locally, derived from named evidence, and printed with the source of every claim. When there is no evidence, the answer is `unknown` instead of a score.

`dsh-triage@0.3.0` on npm · one CLI + one profile bundle · read-only · talks to the network only when you ask it to read the npm registry.

---

## Upgrade day

Every dsh rc asks the same question: **what does *my installed set* lose if I move to it?**

<!-- upgrade-card: data/results/upgrade-card-2026-10-29T13-00-00.000Z.json -->
```console
$ dsh-triage upgrade --to next
# Upgrade day · 0.3.0

**upstream: 192 unit(s) (2 bundle + 190 row) against 0.3.0 — 119 would be denied · 73 cannot tell · 0 would improve · 0 look fine**

> profile `upstream` (live) · current 0.2.1-rc.4 · target is newer than current
> This judges the **declaration layer**: declared ranges against the target runtime, not runtime behaviour.

| bucket | count | meaning |
|---|---|---|
| `would-be-denied` | 119 | would be dropped — the target build denies this row/package |
| `cannot-tell` | 73 | cannot tell — not enough declaration evidence |
| `improved` | 0 | denied today, admitted at target — broken now, the target admits it |
| `likely-fine` | 0 | no declared conflict — not a promise that it runs after the upgrade |
```
<!-- /upgrade-card -->

**Where those numbers come from**: the in-repo sandbox profile (`sandbox/upstream/0.2.1-rc.4`, target `0.3.0`) — **not your machine**, and not a claim about your set. Your composition is the input that makes this worth running; the shape is what is reproducible here. Recompute with `node scripts/record_upgrade_card.mjs --stamp <ISO>`.

- `--to next` / `--to latest` resolve the target from npm `dist-tags` (one read, then the same judgement); `--to <exact version>` never touches the network.
- `--card --out card.md` writes exactly the bytes printed above to a file and prints the path, so the sample can travel to an issue.
- The card never says "the upgrade will fix it": an `improved` unit says **"the target admits it"**, because a declaration being admitted is not a measurement (`BS-42`).

## Why it exists

| What you see | What you conclude | What actually happened |
|---|---|---|
| A plugin was installed, nothing appeared | "the plugin is broken" | its `package.json` had no `dsh.bundle`, so it was installed as a plain dependency and never became a profile layer |
| Your MCP tools silently vanished | "MCP is flaky" | the loader **denied the row at admission** (declared range vs runtime) and dropped it from the composition |
| DSH will not boot at all | "my whole profile is corrupted" | a duplicate loader entry id, or a service-name collision — one bad row takes the boot down |

DSH does report each refusal, in the run log. What upstream lists as deferred work is the rest: a durable failure history, provenance, and runtime conflict detection (`docs/00-vision.md` §2). So the one log line that explains a missing tool is gone exactly when you go looking for it — after the restart.

Three things make attribution hard enough to need a tool:

1. **Admission is judged per loader row, not per bundle.** A bundle can pass while the row that imports your module is refused. Checking `package.json#dsh.bundle` alone answers the wrong question.
2. **A version that is declared compatible can still fail to import.** A hoisted `dsh-tools`, a stale `latest` tag, or a build script that pnpm skipped all produce "installed but not registered".
3. **Silence is not a pass.** A module that declares no `@deepseek-ai/dsh*` range and no `engines.dsh` gets no verdict from the declaration layer at all — unless something insists on saying so.

## Install

```sh
# CLI only — no DSH changes
npm install -g dsh-triage

# The DSH profile bundle (settings tab + Agent tool + local read-only route)
dsh plugin --profile web add dsh-triage
```

Node `>=22.19`. `dsh plugin` forwards its arguments to pnpm inside the profile directory, so `add` / `remove` / `why` behave exactly as pnpm does.

## Quickstart

The output below is from actual runs, trimmed for length. Absolute paths are shortened by hand; `--json` redacts them to `~` by default (`--no-redact` keeps them). Row counts and timings depend on your machine.

**1. Fingerprint the environment** — which dsh build, which profile, which bundles:

```console
$ dsh-triage env
dsh        0.1.0-rc.6
node       24.15.0 · win32/x64
profile    web (~/.dsh/profiles/web)
bundles    2
  - @deepseek-ai/dsh-base
  - @deepseek-ai/dsh-web-app
```

**2. Ask why something disappeared** — `why` walks every loader row, judges admission on the row, and names the row, the module and where the row came from:

```console
$ dsh-triage why
scanned 2 bundles · 156 loader rows · 128 import targets · dsh 0.1.0-rc.6 · profile web
[UNKNOWN] @deepseek-ai/cordis-plugin-hmr@1.0.16 — not enough evidence
  env      dsh 0.1.0-rc.6 · win32/x64 · profile web
  reason   loader row hmr imports @deepseek-ai/cordis-plugin-hmr (declared in bundle:@deepseek-ai/dsh-base)
  reason   row hmr imports @deepseek-ai/cordis-plugin-hmr, which declares no @deepseek-ai/dsh* range — silence here is not a pass
  fix      [report] ask the author to declare the @deepseek-ai/cordis-plugin-hmr peer range it actually needs, or run an isolated probe
  missing  any @deepseek-ai/dsh* peer range (or engines.dsh) from this row module
  evidence declared:row, measured-local:runtime
```

`--json` gives the same reasoning as data; `--strict` turns any non-`go` conclusion into exit code 1.

**3. Judge a candidate before installing** — declaration and runtime stay two separate pieces of evidence, and a blocked verdict ships with the commands that would unblock it:

```console
$ dsh-triage check dsh-cost-meter
[BLOCKED] dsh-cost-meter@1.9.44 — not usable as-is
  env      dsh 0.1.0-rc.6 · win32/x64 · profile web
  reason   engines.dsh >=0.2.0-rc.1 <0.3.0-0 does not include 0.1.0-rc.6
  fix      [allow-version] record an explicit version exemption for this exact pair -> dsh plugin --profile web allow-version dsh-cost-meter@1.9.44 --dsh-version 0.1.0-rc.6 --accept-risk
  fix      [pin-version] install a build whose declaration admits 0.1.0-rc.6 (profile: web)
  fix      [probe] exemption bypasses the declaration only; behaviour is still unproven
  fix      [upgrade-dsh] upgrade DSH: 1 requirement(s) need a newer runtime (needs at least 0.2.0-rc.1, running 0.1.0-rc.6)
  evidence declared:admission, measured-local:runtime, measured-registry:registry-tags
```

A package the registry cannot answer for exits 3 with the real reason — it does not turn into "probably fine".

**4. Ledger the set you already have** — entry ids, services, tools, commands, settings namespaces, and who owns each:

```console
$ dsh-triage audit
capability ledger · dsh 0.1.0-rc.6 · profile web
bundle:@deepseek-ai/dsh-base  (78 rows)
  agent  ->  @deepseek-ai/dsh-agent
  hmr    ->  @deepseek-ai/cordis-plugin-hmr  unknown
  ...
row admission: 0 go · 0 blocked/risky · 2 unknown · same engine as `why`
collisions: 0
```

`audit` and `why` share one engine on purpose: two commands that disagree about the same profile would be worse than either one alone. `--snapshot <file>` judges runtime phases from a recorded `pluginInventory` sample instead of the live profile.

**5. Measure a candidate in isolation** — dry-run by default, real only with `--execute`:

```console
$ dsh-triage probe dsh-status-rotator
probe plan (dry-run) for dsh-status-rotator
sandbox   DSH_HOME=<tmp>/dsh-triage-probe/dsh-status-rotator-<hash>
profile   web
port      62088
  install  node dsh plugin --profile web add dsh-status-rotator
  boot     node dsh --profile web --patch <generated overlay>
  http     <fetch> http://127.0.0.1:62088/ --redirect manual
  render   <browser> --headless=new --remote-debugging-port=0 <host url from stdout>
warn  installing a candidate may execute third-party build scripts; the plan is dry-run until --execute is passed
note  dry-run: nothing was spawned; pass --execute --dsh-main <path> to run it
```

`--execute` installs the candidate into its own `DSH_HOME`, boots it, checks the port while the tree is still alive, reads the mounted DOM through headless Chromium over CDP, reads the candidate row's phase, and always cleans up. Measured: `boot / http / client-render / inventory`. **Not** measured: tools/namespace diff — it is reported as `unmeasured`, never as a pass.

Two more commands you will see in `--help`:

- **`dsh-triage upgrade --to <version|next|latest>`** — before you move your dsh build, ask which loader rows and bundles the *target* runtime would deny, in four buckets (`would-be-denied` / `cannot-tell` / `improved` / `likely-fine`), with the same remediation text `why` uses. An exact version is judged fully offline; only the keywords `next` / `latest` read npm `dist-tags`, and registry lookups are annotations that cannot move a row between buckets. `--card` prints the paste-ready summary, `--card --out <file>` lands the same bytes on disk. It says "would be denied", never "will work".
- **`dsh-triage outcomes`** — the local outcome store for the reflow layer. **Off by default**: while it is off, no directory and no file is created. When you turn it on (`--enable`), it stores only a fixed field whitelist (no paths, no hostnames, no logs, no free text), and `--purge` leaves nothing behind. Nothing is uploaded anywhere; there is no network code on that path.

## How it decides

Every judgement is a verdict, and a verdict is a data structure with four possible conclusions:

| Conclusion | Means |
|---|---|
| `go` | the declarations admit this runtime (or, from `probe`, the candidate installed, booted, answered and its row is `active`) |
| `risky` | usable, with a specific caveat attached |
| `blocked` | a concrete, named refusal — always with at least one remediation step |
| `unknown` | not enough evidence to say either way — always with the list of what is missing |

The rules that keep this honest are enforced by a gate, not by discipline:

- Every verdict carries `evidence[]`, each entry with `tier / source / method / at`. The `confidence.basis` must be one of those tiers.
- Tiers: `declared` (what the author published), `scanned` (a static read of installed files), `measured-local` (this machine, this run), `measured-registry` (registry facts), `inferred` (reasoning, never a conclusion on its own).
- **No evidence ⇒ `unknown`** plus a non-empty `missingEvidence[]`. "I could not tell" is a first-class answer; it is not retried into a guess.
- Secondary channels are kept in their lane: `dsh.compatibility` and registry tag facts may add `info` / `warn` reasons, and may never move a conclusion in either direction — not up to `go`, not down to `blocked`.
- `go` from the declaration layer means "installable here", **not** "verified to run". Runtime evidence only comes from `probe`.
- It never says a plugin is safe. Nothing in the verdict enum expresses safety.

## What it does not do

- **No install / uninstall / rollback.** Upstream's `plugin_manager` owns the lifecycle. Outside an isolated probe sandbox, nothing here writes to `~/.dsh`.
- **No marketplace or catalog.** We can emit a format-1 index of versions measured `go` on this machine — that is a filter with a timestamp, not a ranking, and the format has no conclusion field to rank with.
- **No security review.** Malware and supply-chain questions belong to `dsh-vet`, `dsh-plugin-security-review`, or dsh.so's security tier. A probe executes candidate code inside a throwaway sandbox; executing code is the opposite of auditing it. We do **not** provide security assurances — no verdict in this tool means "safe to run".
- **No author-side lint.** Range-shape advice is shown to the person installing, as advice. It is not a report card filed against the author.
- **No model of whether a feature works.** It can show that a plugin booted and painted a screen. It cannot know whether the feature behind that screen is correct, wired to the right tool, or any good. tools/namespace diff stays `unmeasured` for exactly that reason.

## Evidence you can re-run

Nothing in this README is asserted without a producer in the repo.

| Claim | Reproduce it |
|---|---|
| build, typecheck, 494 tests, 9 gates | `pnpm run verify` |
| the gates can actually fail | `node scripts/gate.mjs --mutate` → `NEGATIVE CONTROL PASSED · 9/9` |
| admission semantics match upstream | `data/gold/admission-cases.json` — 27 signed goldens, enforced by the `admission-parity` gate |
| `why` finds the root cause in real failures | `node scripts/d1_report.mjs --stamp <iso>` → 10 real cases, 9 hits, 1 explicit `unknown` (`data/results/d1-*.json`) |
| the npm package really installs | `data/results/publish-2026-10-29T01-40-00.000Z.json` — anonymous install with an empty userconfig, six packages, CLI runs, registry bytes identical to the local tarballs |
| each step was reviewed | `audit/step_reviews.json` — four axes (correctness / reproducibility / licence / SSOT) plus an adversarial counter-example, sha256-recomputed by the `step-review` gate |

`data/results/` is the single source of truth. Every artifact is written by a script under `scripts/`, records `produced_by` and `generated_at`, and ships with a `.sha256`; a hand-written result fails the `ssot` gate. `dsh-triage serve` opens a read-only panel over that directory — loopback only, one-time token in the URL, cross-origin refused, `POST` answered 403 unless started with `--allow-execute` (which itself answers 501, because the action does not exist yet).

CI runs `verify` on Node 22 and 24, a Windows job, a real-browser render-control job on ubuntu, a job that proves every gate catches its injected violation, and a release-readiness job.

## Honest limits

- **One machine.** Every real probe behind the numbers was measured on a Windows host against one dsh runtime. Linux has only ever run the render controls in CI — it has never run a real probe.
- **12 of 13** real candidates started. That is a **convenience sample of hand-picked candidates**, not a success rate: Wilson 95% interval **0.667–0.986**. The honest sentence is "12 of 13 candidates we chose", never "92% of plugins work".
- **The 20-second number is a waiting budget, not wall clock.** The promise is `boot→sample ≤ 20s` on the first usable sample. Across 95 loaded real observations the median is 12.3s and p90 16.0s (observed CPU busy 58–94%), and across 35 idle observations the median is 4.9s. None crossed 20s — but at ~90% CPU the worst run reached 19.8s, so the margin is thin. A whole run is longer: the boot step alone measures 15.7–16.2s for a normal candidate, and a tree that never settles still ends in `unknown` after roughly 29–30s (`ADR-0008` E removed 20s of waiting that bought nothing; before it, the same fixture took 48.4s).
- **The sandbox is not your profile.** By default it is a template profile; `--copy-profile` copies your declarations only, never `node_modules` or `.npmrc`. It answers "does this boot and paint", not "does it fit my exact combination".
- **Nothing is claimed about non-Windows runtime behaviour**, other pnpm settings, or the credentials a candidate might want: the sandbox gets none, so a plugin that needs a key reports a false negative.
- The distribution status below describes one day's snapshot. It does not promise anything about tomorrow.

## Status and channels

- **npm** — `dsh-triage@0.3.0` published 2026-10-29, alongside `@dsh-triage/core`, `@dsh-triage/signals`, `@dsh-triage/probe`.
- **Pull requests are open, not merged** — [dsh-community-plugins #65](https://github.com/zhu1090093659/dsh-community-plugins/pull/65) (merge state `BLOCKED`, awaiting review) and [awesome-deepseekharness #193](https://github.com/awesome-deepseekharness/awesome-deepseek-harness/pull/193) (`APPROVED`, not merged). Submitted is not listed.
- **dsh.so** — submission package is ready; it has not been submitted.
- **No other channel has accepted this project** as of the snapshot above. If a directory claims otherwise, it is ahead of the evidence.

## Repository map

```
packages/core      admission semantics, env fingerprint, capability ledger, verdict  (pure, offline)
packages/signals   npm registry / dsh.so / hub catalog / local artifacts, each tagged with a tier
packages/probe     isolated probe plan + runner + render judgement over CDP
packages/plugin    dsh-triage: profile bundle, CLI, settings tab, Agent tool, local panel
scripts/           9 zero-dependency gates + the real-run producers behind data/results
data/gold          signed admission goldens (upstream parity)
data/results       SSOT artifacts + .sha256
```

## Contributing and handoff

Start at [`docs/HANDOFF.md`](docs/HANDOFF.md): five-minute baseline check, current batch, and the first thing to do next. The working rules are in [`PROJECT_RULES.md`](PROJECT_RULES.md), the role cards and task packets in [`.agents/README.md`](.agents/README.md). A step is not done until it has four-axis review **and** a re-runnable test whose artifact lands in `data/results/`.

## License

MIT — see [LICENSE](LICENSE). Plugin registry facts sourced from [dsh.so](https://www.dsh.so) are CC BY 4.0 and attributed where they are used.
