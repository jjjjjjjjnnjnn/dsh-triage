# dsh-triage

The judgment layer for DeepSeek Harness plugins — **find out why a plugin silently disappeared, and whether a candidate will survive your environment.**

DSH 0.2.x already tells you whether a plugin *installs*. It does not tell you whether it will *work* with your dsh version, your OS, and the other 12 plugins you already have.

## Use

```sh
# attribute the damage: which row was denied, and what to run next
dsh-triage why

# judge a candidate before installing
dsh-triage check dsh-cost-meter
dsh-triage check dsh-web-search-pro@1.4.2 --json

# capability ledger: who owns which loader entry / namespace
dsh-triage audit

# isolated probe plan (dry-run; execution lands in M3)
dsh-triage probe dsh-cost-meter
```

Exit codes: `0` ok · `1` findings (only with `--strict`) · `2` usage · `3` unavailable.

## Flags

| Flag | Meaning |
|---|---|
| `--json` | machine-readable output |
| `--all` | include non-blocking findings |
| `--strict` | exit 1 when a conclusion is not `go` |
| `--profile <name>` | profile name (default `web`) |
| `--dsh-home <path>` | override `$DSH_HOME` |
| `--locale en\|zh` | output language (default `zh`, or `$DSH_TRIAGE_LOCALE`) |
| `--stamp <iso>` | fixed timestamp for reproducible output |
| `--execute` | (probe) really run the plan — not implemented before M3 |

## What it will never do

- Provide security assurances (use `dsh-vet` / dsh.so's security tier).
- Replace the official plugin manager, or re-implement snapshots/rollback.
- Invent a score. Every conclusion is `go` / `risky` / `blocked` / `unknown`, with evidence tiers (`declared`, `scanned`, `measured-registry`, `measured-local`, `inferred`).

## DSH profile bundle

```sh
dsh plugin --profile web add dsh-triage
```

The bundle mounts a single namespaced row (`compat-verdict`). The Web panel and the `compat_verdict` agent tool land in M4; until then the row registers nothing, on purpose.

MIT. Data attribution: dsh.so registry facts are CC BY 4.0.
