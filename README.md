# dsh-triage — the judgment layer for DeepSeek Harness plugins

**分诊台 / Triage** · `github.com/jjjjjjjjnnjnn/dsh-triage`

> **Status**: `R6` — **10 real cases replayed (9 hits, 1 deliberate miss)**; the D1 decision gate is now machine-judged from `data/results/d1-*.json`; row-level admission attribution, 8 machine-enforced gates. The Web panel, probe runner and badges land per [`docs/ROADMAP.md`](docs/ROADMAP.md).
> DSH (DeepSeek Harness) already tells you whether a plugin *installs*. Nobody tells you whether it will *work* — with **your** dsh version, **your** OS, and **your** other 12 plugins.

## The problem we take seriously

| Symptom | What users think | What actually happened |
|---|---|---|
| A plugin installed, but nothing appears | "The plugin is broken" | Its `package.json` had no `dsh.bundle`, so it was installed as a plain dependency — never became a profile layer |
| My MCP tools silently vanished | "MCP is flaky" | The loader **denied the row at admission** (declared range vs runtime) and dropped it from the composition |
| DSH won't boot at all | "My whole profile is corrupted" | A duplicate loader entry id, or a service name collision — one bad row takes the boot down |
| The page is white but HTTP is 200 | "Server is fine?" | The browser half crashed; a health check on `/` cannot see it |

DSH's own docs say it plainly: a denied row becomes a detached `disabled: true` row — *"every refusal is reported"*, but there is no UI, no attribution, and no durable history.

## What `dsh-triage` does

```
$ dsh-triage why
BLOCKED  dsh-web-search-pro@0.2.1 — 不可用
  env      dsh 0.1.0-rc.6 · win32/x64 · profile web
  reason   peer @deepseek-ai/dsh-tools@>=0.2.0-rc.2 <0.2.1-0 不含 0.1.0-rc.6
  ...      9 more reason(s); pass --json for the full list
  fix      [allow-version] 为这个精确版本对记录一次显式豁免 -> dsh plugin --profile web allow-version dsh-web-search-pro@0.2.1 --dsh-version 0.1.0-rc.6 --accept-risk
  fix      [pin-version] 改装一个声明含 0.1.0-rc.6 的版本（profile: web）
  fix      [probe] 豁免只绕过声明；行为仍未实测
  fix      [upgrade-dsh] 升级 DSH：10 条要求需要更新的运行时（至少 0.2.0-rc.2，当前 0.1.0-rc.6）
  evidence declared:admission, measured-local:runtime
```

- **`why`** — attribute "disappeared tools / white screen / won't boot" to a specific row, with the fix command. Deterministic, offline, read-only.
- **`check <pkg>`** — verdict before install: `go` / `risky` / `blocked` / `unknown`, with evidence and alternatives (which version still fits, which plugin to disable first).
- **`audit`** — namespace ledger of your current set: entry ids, services, tools, commands, settings namespaces, and who owns what.
- **probe** *(M3)* — install the candidate into an isolated `DSH_HOME`, boot it, and record `boot / http / inventory / namespace-diff`. Opt-in, never on your real profile.

## Honest boundaries

- We do **not** provide security assurances. Malware/supply-chain audits belong to `dsh-vet`, `dsh-plugin-security-review`, or [dsh.so](https://www.dsh.so)'s security tier.
- We do **not** replace the official plugin manager, and we do **not** implement snapshots/rollback (that is `@deepseek-ai/dsh-plugin-manager`'s and `dsh-plugin-guard`'s job).
- Every conclusion carries an evidence tier — `declared`, `scanned`, `measured-local`, `measured-registry`, `inferred`. When we do not know, we say `unknown` instead of inventing a score.

## Install

```sh
# CLI only (no DSH changes)
npm i -g dsh-triage

# The DSH profile bundle (Web panel; M4)
dsh plugin --profile web add dsh-triage
```

## Repo layout

Governance-first, same shape as the sibling projects in this workspace: mandates, gates, SSOT results, audit ledgers, quarantine, archive-only removals.

```
packages/core      admission semantics / env fingerprint / capability ledger / verdict  (pure, offline)
packages/signals   npm registry · dsh.so · hub catalog · local tool artifacts           (tiered evidence)
packages/probe     isolated DSH_HOME probe plan + runner (M3)
packages/plugin    dsh-triage: profile bundle + patch + bin CLI + Web panel (M4)
scripts/           six gates + real-run SSOT producers (zero deps, always runnable)
data/gold          signed golden fixtures (admission parity)
data/results       SSOT: script-produced JSON + .sha256
```

Read [`docs/00-vision.md`](docs/00-vision.md) for positioning, [`docs/03-failure-taxonomy.md`](docs/03-failure-taxonomy.md) for the nine failure classes, and [`docs/01-competitors.md`](docs/01-competitors.md) for the measured ecosystem state (22,180 registry entries · 10,348 npm packages · 175k weekly downloads at the top).

## License

MIT. Data attribution: plugin registry facts from [dsh.so](https://www.dsh.so) are CC BY 4.0.
