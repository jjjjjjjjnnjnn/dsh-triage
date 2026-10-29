# Listing copy (English, ready to paste)

> **Stand**: R47 (2026-10-29). Numbers are measured, and `node scripts/check_listing.mjs` re-checks them
> against the repo (version, DSH range, evidence paths). Chinese counterpart: `docs/market/listing_zh.md`.
> Channel status lives in `docs/market/submissions/README.md`; long-form posts in `docs/posts/`.

## One line

**Before you take the next rc, see what it does to *your* set.**

## Front door: upgrade day

Every DSH release asks one concrete question: **I have two dozen plugins installed — how many still work after the bump?**

```sh
dsh-triage upgrade --to 0.2.1-rc.4
```

The answer is a table computed against **your installed set**, partitioned four ways: `would-be-denied`, `cannot-tell`,
`improved`, `likely-fine`. Every row that would be dropped comes with the reason and the fix command, plus a summary
you can paste straight into the issue thread.

**That is the question nobody else can answer.** A marketplace says whether a package installs; a registry says whether
it runs in a clean sandbox; only your machine says which of *your* rows breaks on the way up.

## Short description (for form fields)

The judgment layer for DeepSeek Harness plugins: name the loader row that was silently dropped and why, judge a candidate before installing it, and list what a target DSH build would deny.

## Body

### The four symptoms

- you install a plugin and **nothing happens**;
- MCP tools **quietly disappear**, restart changes nothing;
- after a DSH upgrade **half the profile will not start**;
- the page is **completely blank** while `curl` still returns 200.

None of these are mysterious: a package without `dsh.bundle` never joins the profile layer, admission drops a row whose declared range excludes your runtime, a loader entry id collision takes the whole profile down, and a crashed browser half is invisible to a health check.

### What it does (shipped, not a roadmap)

```sh
dsh-triage why                     # who got dropped, why, and the exact fix
dsh-triage check <pkg[@version]>   # go / blocked / unknown before you install
dsh-triage audit                   # row-level verdicts for the installed set, plus copy provenance
dsh-triage probe <pkg> --execute --dsh-main <...>   # isolated boot / http / render / inventory, always cleaned up
dsh-triage upgrade --to <version>  # which rows a target DSH build would deny (four buckets, offline by default)
dsh-triage badge <pkg>             # shields-style SVG rendered from recorded evidence
dsh-triage index --out <file>      # format-1 market index of versions measured "go", validated by the upstream validator
dsh-triage serve                   # read-only local evidence panel, 127.0.0.1 only, token + HttpOnly cookie
dsh-triage outcomes                # local outcome store, off by default, no network, --purge leaves nothing
dsh-triage env                     # environment fingerprint
```

Installed as a profile bundle it also adds a **settings tab whose numbers come from the same read-only route the CLI
uses**, and a **`compat_verdict` agent tool** so an agent can ask "does this candidate fit this runtime?" before
touching anything.

### What it does not do

- **no security endorsement** (use a scanner for that);
- no install / remove / rollback (upstream `plugin_manager` owns that);
- no score when the evidence is missing — the answer is `unknown`, never a plausible-looking number.

### Why you can check it

Every conclusion carries an evidence tier: `declared` / `scanned` / `measured-registry` / `measured-local` /
`inferred`. The admission rules are a line-by-line parity implementation of upstream's, locked by **27 gold cases**
including real npm declaration snapshots; every `probe` assertion has a negative control.

**Honest boundaries (read these too)**

- real-candidate pass rate is **12/13 = 0.923** (Wilson 95% **0.667–0.986**): a hand-picked convenience sample on
  one machine and one runtime;
- `boot→sample` median is **4.9s idle / 12.3s under load** (p90 16.0s), both under the 20s budget — but the budget
  is a *waiting* budget for the first judgeable sample, not "one probe takes 20 seconds";
- in the upgrade list, `improved` (denied today, admitted at the target) is only witnessed in the **downgrade**
  geometry: the scan covers the **1584 packages npm keyword search returns** (`dsh-plugin-catalog` advertises 7,557
  entries; we have not verified that independently, so this is not a census), and **0** of the 202 denied today are
  admitted by a *newer* build. We say "the target admits it", never "upgrading fixes it".

## Current status

`0.2.0` is published on npm (four packages released together). Build side covers M0–M6. Distribution: three pull
requests are open (#65 awaiting review, #193 approved but unmerged, walkinglabs #140 just opened), `merged: 0`, and
the dsh.so form was **submitted by a human** — but its three per-plugin JSON endpoints still return 404, so the status
is `submitted`, **not** `listed`.

- format-1 index source (public URL, byte-verified): `https://raw.githubusercontent.com/jjjjjjjjnnjnn/dsh-triage/main/docs/market/index.json`
- Badge: `dsh-triage badge <pkg>` renders an SVG from recorded measurements; no measurement renders `not measured`.

## Keywords

`dsh` `dsh-plugin` `deepseek-harness` `compat` `diagnostics` `plugin-health` `triage`

## Install

```sh
npm i -g dsh-triage                       # CLI only
dsh plugin --profile web add dsh-triage   # into a profile: settings tab + agent tool
```

Requires Node ≥ 22.19 and DSH `>=0.2.0-rc.1 <0.3.0-0` (measured on 0.2.1-rc.4).

## Licence and data attribution

MIT. This repository does **not** use dsh.so data (the index source reads npm registry metadata only), so no CC BY
attribution is required; if that changes, attribution will be added here first.
